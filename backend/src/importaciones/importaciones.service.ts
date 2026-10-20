import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';
import { EstudiantesService } from '../estudiantes/estudiantes.service';
import { CreateEstudianteDto } from '../estudiantes/estudiantes.dto';
import { MatriculasService } from '../matriculas/matriculas.service';
import { can } from '../permissions/policy';
import { canonical, detectMapping, mapCsv, readCsv } from './csv';
import { ArchivoImportacionDto, ConfirmarImportacionDto, PreviewImportacionDto } from './importaciones.dto';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Row = { fila: number; datos: CreateEstudianteDto; estado: 'aceptable' | 'omitida' | 'rechazada'; errores: string[]; avisos: string[]; estudiante_id: number | null };
type Receipt = { id: string; actor: number; input: string; state: string; expires: number };

@Injectable()
export class ImportacionesService {
  constructor(private readonly prisma: PrismaService, private readonly students: EstudiantesService, private readonly enrollments: MatriculasService, private readonly config: ConfigService) {}

  private async execute<T>(operation: () => Promise<T>) {
    try { return await operation(); }
    catch (e) {
      if (isSchemaOutdated(e)) throw new ServiceUnavailableException('La importación requiere las migraciones académicas de capacidad e importaciones.');
      if (isUniqueViolation(e) || (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(e.code))) throw new ConflictException('Hay una importación repetida o un cambio concurrente. No se guardó este lote; consulta el resultado y genera una nueva vista previa.');
      // Nunca registrar excepciones Prisma con parámetros que puedan contener datos personales.
      if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) throw new ServiceUnavailableException('No se pudo completar el lote. La transacción se revirtió. Solicita revisar la disponibilidad de la base de datos.');
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException('No se pudo completar el lote. Consulta el resultado antes de repetir.');
    }
  }
  inspect(dto: ArchivoImportacionDto) {
    const parsed = readCsv(dto);
    const columns = parsed.rows[parsed.encabezado - 1];
    return { ok: true, columnas: columns, encabezado: parsed.encabezado, mapeo: detectMapping(columns), muestra: parsed.rows.slice(0, 20), codificacion: parsed.codificacion, separador: parsed.separador };
  }
  editions(q: Parameters<MatriculasService['editions']>[0]) { return this.enrollments.editions(q); }
  private signature(payload: string) { return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update('importacion-academica-v1:' + payload).digest('base64url'); }
  private sign(receipt: Receipt) { const payload = Buffer.from(JSON.stringify(receipt)).toString('base64url'); return payload + '.' + this.signature(payload); }
  private verify(token: string, actor: number, input: string): Receipt {
    try {
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) throw new Error();
      const expected = Buffer.from(this.signature(payload)), received = Buffer.from(signature);
      if (received.length !== expected.length || !timingSafeEqual(expected, received)) throw new Error();
      const r = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Receipt;
      if (r.actor !== actor || r.input !== input || r.expires < Date.now() || !/^[0-9a-f-]{36}$/.test(r.id)) throw new Error();
      return r;
    } catch { throw new ConflictException('La vista previa venció, fue modificada o pertenece a otra cuenta. Genera una nueva.'); }
  }
  private input(dto: PreviewImportacionDto) {
    return digest([dto.nombre, dto.mime, dto.contenido, dto.convocatoria_id, dto.encabezado, dto.codificacion, dto.mapeo ? ['doc_numero', 'nombres', 'apellidos', 'email', 'telefono', 'tipo_persona'].map(k => dto.mapeo![k as keyof typeof dto.mapeo] ?? null) : null]);
  }
  private async analyze(tx: Prisma.TransactionClient, dto: PreviewImportacionDto, lock: boolean) {
    const parsed = mapCsv(dto);
    const edition = lock ? await this.enrollments.lockEdition(tx, dto.convocatoria_id) : await tx.convocatoria.findUnique({ where: { id: dto.convocatoria_id } });
    if (!edition) throw new BadRequestException('La edición seleccionada no existe.');
    const course = await tx.curso.findUnique({ where: { id: edition.curso_id }, select: { id: true, titulo: true } });
    if (!course) throw new BadRequestException('El curso de la edición no existe.');
    const documents = parsed.data.map(r => r.cells[parsed.mapeo.doc_numero]).filter(v => /^[0-9]{8}$/.test(v));
    let existing = await tx.estudiante.findMany({ where: { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: { in: documents } }, orderBy: { id: 'asc' } });
    if (lock) {
      for (const s of existing) await tx.$queryRaw`SELECT id FROM estudiantes WHERE id = ${s.id} FOR UPDATE`;
      // Solo IDs bloqueados. Una inserción concurrente de un DNI ausente hará fallar UNIQUE y revertirá el lote.
      existing = await tx.estudiante.findMany({ where: { id: { in: existing.map(s => s.id) } }, orderBy: { id: 'asc' } });
    }
    const matriculas = await tx.matricula.findMany({ where: { convocatoria_id: edition.id, estudiante_id: { in: existing.map(s => s.id) } }, orderBy: { id: 'asc' } });
    const occupied = await tx.matricula.count({ where: { convocatoria_id: edition.id, estado: 'activa' } });
    const imported = await tx.importacionAcademica.findUnique({ where: { archivo_sha256_convocatoria_id: { archivo_sha256: createHash('sha256').update(Buffer.from(dto.contenido, 'base64')).digest('hex'), convocatoria_id: edition.id } } });
    if (imported) throw new ConflictException('Este archivo ya se importó en esta edición. Consulta el resultado de la operación ' + imported.id + '.');
    const counts = new Map<string, number>();
    for (const r of parsed.data) { const d = r.cells[parsed.mapeo.doc_numero]; counts.set(d, (counts.get(d) || 0) + 1); }
    const byDni = new Map(existing.map(s => [s.doc_numero, s])), byStudent = new Map(matriculas.map(m => [m.estudiante_id, m]));
    const rows: Row[] = parsed.data.map(({ cells, fila }) => {
      const data = Object.fromEntries(Object.entries(parsed.mapeo).filter(([k]) => k !== 'tipo_persona').map(([k, i]) => [k, cells[i] ?? '']));
      const dtoStudent = plainToInstance(CreateEstudianteDto, data);
      const errors = validateSync(dtoStudent).flatMap(e => Object.values(e.constraints || {}));
      const s = byDni.get(dtoStudent.doc_numero), m = s ? byStudent.get(s.id) : undefined;
      const row: Row = { fila, datos: dtoStudent, estado: 'aceptable', errores: errors, avisos: [], estudiante_id: s?.id ?? null };
      if (cells.length !== parsed.columns.length) errors.push('El número de columnas no coincide con el encabezado.');
      if (cells.some(c => /^[=+@-]/.test(c.trimStart()) && !/^\+?[\d ()-]+$/.test(c.trim()))) errors.push('La fila contiene una fórmula o contenido activo. Sustitúyelo por texto plano.');
      if ((counts.get(dtoStudent.doc_numero) || 0) > 1) errors.push('DNI duplicado dentro del archivo; revisa todas sus filas.');
      const person = parsed.mapeo.tipo_persona === undefined ? '' : canonical(cells[parsed.mapeo.tipo_persona] || '');
      if (parsed.mapeo.tipo_persona !== undefined && !['estudiante', 'alumno', 'participante'].includes(person)) errors.push('Solo se importan personas identificadas como estudiantes, alumnos o participantes.');
      if (cells.some(c => /\b(docente|ponente|instructor|expositor)\b/i.test(c))) errors.push('Posible docente o ponente. Revisa y excluye esta fila.');
      if (s?.archivado_at) errors.push('El estudiante está archivado. No se restaura automáticamente.');
      if (s) row.avisos.push('Estudiante existente: se conserva su ID y no se actualizan sus datos.');
      if (s && ['nombres', 'apellidos', 'email', 'telefono'].some(k => (dtoStudent[k as keyof CreateEstudianteDto] || '') !== (s[k as 'nombres' | 'apellidos' | 'email' | 'telefono'] || ''))) row.avisos.push('Los datos del archivo difieren de los registrados; revisa la identidad.');
      if (errors.length) row.estado = 'rechazada';
      else if (m) { row.estado = 'omitida'; row.avisos.push(m.estado === 'anulada' ? 'Matrícula anulada: no se reactiva durante la importación.' : 'Ya tiene una matrícula activa en esta edición.'); }
      return row;
    });
    const accepted = rows.filter(r => r.estado === 'aceptable'), available = edition.capacidad === null ? null : Math.max(0, edition.capacidad - occupied);
    const blockers: string[] = [];
    if (edition.archivado_at || edition.estado !== 'abierta') blockers.push('La edición debe estar abierta y sin archivar.');
    if (available === null) blockers.push('La edición no tiene capacidad definida.');
    else if (accepted.length > available) blockers.push('Cupos insuficientes para importar todas las filas aceptables. Divide o corrige el archivo.');
    if (!accepted.length) blockers.push('No hay filas aceptables para importar.');
    const summary = { importados: accepted.length, omitidos: rows.filter(r => r.estado === 'omitida').length, rechazados: rows.filter(r => r.estado === 'rechazada').length, estudiantes_nuevos: accepted.filter(r => !r.estudiante_id).length };
    const state = digest([edition, course, existing, matriculas, occupied, rows]);
    return { rows, accepted, edition, course, summary, blockers, available, state };
  }
  preview(dto: PreviewImportacionDto, actor: number) {
    return this.execute(async () => {
      const r = await this.prisma.$transaction(tx => this.analyze(tx, dto, false), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
      const comprobante = this.sign({ id: randomUUID(), actor, input: this.input(dto), state: r.state, expires: Date.now() + 15 * 60000 });
      return { ok: true, filas: r.rows, resumen: r.summary, bloqueos: r.blockers, destino: { id: r.edition.id, nombre: r.edition.nombre, curso: r.course.titulo, capacidad: r.edition.capacidad, disponibles: r.available }, comprobante };
    });
  }
  confirm(dto: ConfirmarImportacionDto, actor: number) {
    if (dto.confirmar !== true) throw new BadRequestException('Debes confirmar explícitamente la importación.');
    const receipt = this.verify(dto.comprobante, actor, this.input(dto));
    return this.execute(() => this.prisma.$transaction(async tx => {
      const r = await this.analyze(tx, dto, true);
      if (receipt.state !== r.state) throw new ConflictException('Los datos académicos o los cupos cambiaron desde la vista previa. No se guardó este lote. Vuelve a previsualizar.');
      if (r.blockers.length) throw new ConflictException(r.blockers.join(' '));
      const account = await tx.adminUser.findUniqueOrThrow({ where: { id: actor }, select: { rol: true, activo: true } });
      if (!account.activo || !can(account.rol, 'importaciones:aplicar') || !can(account.rol, 'estudiantes:crear') || !can(account.rol, 'matriculas:crear')) throw new ForbiddenException('No tienes permiso para aplicar esta importación.');
      const operation = await tx.importacionAcademica.create({ data: { id: receipt.id, archivo_sha256: createHash('sha256').update(Buffer.from(dto.contenido, 'base64')).digest('hex'), convocatoria_id: r.edition.id, actor_id: actor, ...r.summary } });
      for (const row of r.accepted) {
        const id = row.estudiante_id || (await this.students.createInTransaction(tx, row.datos)).id;
        await this.enrollments.createInTransaction(tx, { estudiante_id: id, convocatoria_id: r.edition.id, convocatoria_revision: r.edition.revision }, actor, 'Importación académica ' + operation.id);
      }
      return { ok: true, operacion: operation.id, resumen: r.summary, filas: r.rows.map(row => ({ fila: row.fila, estado: row.estado === 'aceptable' ? 'importada' : row.estado, errores: row.errores, avisos: row.avisos })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000, maxWait: 5000 }));
  }
  result(id: string) {
    return this.execute(async () => {
      const item = await this.prisma.importacionAcademica.findUnique({ where: { id }, select: { id: true, convocatoria_id: true, actor_id: true, createdAt: true, estado: true, importados: true, omitidos: true, rechazados: true, estudiantes_nuevos: true } });
      if (!item) throw new BadRequestException('La operación todavía no consta como confirmada. Comprueba las matrículas antes de volver a importar.');
      return { ok: true, item };
    });
  }
}
