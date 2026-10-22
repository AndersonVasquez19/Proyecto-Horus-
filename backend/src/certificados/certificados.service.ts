import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Certificado, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';
import { can } from '../permissions/policy';
import { CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';
import { AnularCertificadoDto, CertificadosQueryDto, EmitirCertificadoDto, SustituirCertificadoDto } from './certificados.dto';
import { VERIFICATION_URL_ENV, resolveVerificationBase, verificationUrl } from './certificados.config';
import { renderCertificatePdf } from './certificados.pdf';
import { CERTIFICATE_NOT_FOUND, checkEmission, generateCode, normalizeCode, publicView, snapshotOf } from './certificados.rules';

const day = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;
const view = <T extends Certificado>(row: T) => ({ ...row, convocatoria_fecha_inicio: day(row.convocatoria_fecha_inicio), convocatoria_fecha_fin: day(row.convocatoria_fecha_fin) });
const pagination = (q: CursosConvocatoriaQueryDto, total: number) => ({ page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });
const CODE_ATTEMPTS = 5;

type Tx = Prisma.TransactionClient;
type Rol = Prisma.AcademicoHistorialUncheckedCreateInput['actor_rol'];

// Emisión, anulación y sustitución de certificados (flujo: estudiante → matrícula → cumplimiento confirmado → certificado).
// - Los datos del estudiante, el curso y la edición se COPIAN al emitir y no cambian después.
// - Nada se borra: un certificado se anula (con quién, cuándo y por qué) y, si hace falta, se sustituye por otro.
// - Un solo vigente por matrícula: lo garantiza MySQL (columna generada + UNIQUE); el servicio lo comprueba antes para dar un 409 claro.
// - Cada cambio escribe su historial en la MISMA transacción. Orden de bloqueo: curso → edición → estudiante → matrícula → certificado,
//   el mismo que usan Matrículas y Convocatorias, para no provocar interbloqueos.
@Injectable()
export class CertificadosService {
  constructor(private readonly prisma: PrismaService) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Otra operación modificó los certificados de esta matrícula. Consulta la versión actual antes de repetir.');
      if (isSchemaOutdated(error)) throw new ServiceUnavailableException('La gestión de certificados no está disponible. Solicita revisar la estructura académica.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code)) throw new ConflictException('Otra operación modificó los datos académicos. Consulta la versión actual antes de repetir.');
      throw error;
    }
  }

  // ---- Consulta --------------------------------------------------------------------------------------------------------------
  list(q: CertificadosQueryDto) {
    const terms = (q.search || '').split(/\s+/).filter(Boolean);
    const where: Prisma.CertificadoWhereInput = {
      ...(q.matricula_id ? { matricula_id: q.matricula_id } : {}), ...(q.estado ? { estado: q.estado } : {}),
      ...(q.convocatoria_id ? { matricula: { convocatoria_id: q.convocatoria_id } } : {}),
      ...(q.estudiante_id ? { matricula: { estudiante_id: q.estudiante_id, ...(q.convocatoria_id ? { convocatoria_id: q.convocatoria_id } : {}) } } : {}),
      ...(terms.length ? { AND: terms.map(term => ({ OR: [{ estudiante_nombres: { contains: term } }, { estudiante_apellidos: { contains: term } }, { estudiante_doc_numero: { contains: term } }, { curso_titulo: { contains: term } }, { convocatoria_nombre: { contains: term } }, { codigo_verificacion: { contains: term.toUpperCase() } }] })) } : {}),
    };
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.certificado.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }), this.prisma.certificado.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items: items.map(view), pagination: pagination(q, total) };
    });
  }
  detail(id: number) {
    return this.execute(async () => {
      const item = await this.prisma.certificado.findUnique({ where: { id }, include: { sustituido_por: { select: { id: true } } } });
      if (!item) throw new NotFoundException('El certificado no existe.');
      const { sustituido_por, ...rest } = item;
      return { ok: true, item: { ...view(rest), sustituido_por_id: sustituido_por?.id ?? null } };
    });
  }
  history(id: number, q: CursosConvocatoriaQueryDto) {
    return this.execute(async () => {
      if (!await this.prisma.certificado.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('El certificado no existe.');
      const where = { entidad: 'certificado' as const, entidad_id: id };
      const [items, total] = await this.prisma.$transaction([
        this.prisma.academicoHistorial.findMany({ where, orderBy: { id: 'desc' }, take: q.limit, skip: (q.page - 1) * q.limit }), this.prisma.academicoHistorial.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items, pagination: pagination(q, total) };
    });
  }
  // Verificación PÚBLICA por código. Un código con formato inválido y uno inexistente responden igual (404, mismo texto): no se
  // distingue qué falló. La respuesta no incluye el DNI ni datos internos (ver publicView).
  async verify(rawCode: unknown) {
    const code = normalizeCode(rawCode);
    if (!code) throw new NotFoundException(CERTIFICATE_NOT_FOUND);
    return this.execute(async () => {
      const row = await this.prisma.certificado.findUnique({ where: { codigo_verificacion: code }, select: {
        estado: true, estudiante_nombres: true, estudiante_apellidos: true, curso_titulo: true, curso_tipo: true, curso_duracion: true,
        convocatoria_nombre: true, convocatoria_fecha_inicio: true, convocatoria_fecha_fin: true, emitido_at: true, sustituido_por: { select: { id: true } },
      } });
      if (!row) throw new NotFoundException(CERTIFICATE_NOT_FOUND);
      return publicView(row);
    });
  }

  // PDF administrativo de un certificado ya emitido (vigente o anulado). Sin DNI: se piden solo los campos que el documento muestra.
  // El estado se lee al generar y queda impreso; la URL del QR sale de la configuración validada, nunca de la solicitud.
  async pdf(id: number, env: Record<string, unknown> = process.env, now: Date = new Date()) {
    const row = await this.execute(() => this.prisma.certificado.findUnique({ where: { id }, select: {
      codigo_verificacion: true, estado: true, estudiante_nombres: true, estudiante_apellidos: true, curso_titulo: true, curso_tipo: true, curso_duracion: true,
      convocatoria_nombre: true, convocatoria_fecha_inicio: true, convocatoria_fecha_fin: true, emitido_at: true, sustituido_por: { select: { id: true } },
    } }));
    if (!row) throw new NotFoundException('El certificado no existe.');
    const base = resolveVerificationBase(env[VERIFICATION_URL_ENV]);
    if (base.ok === false) throw new ServiceUnavailableException('La dirección pública de verificación de certificados no está configurada correctamente. Solicita al administrador del sistema revisar la configuración.');
    const { sustituido_por, ...data } = row;
    const buffer = await renderCertificatePdf({ ...data, sustituido: sustituido_por !== null }, { verificationUrl: verificationUrl(base.base, row.codigo_verificacion), generatedAt: now });
    return { buffer, fileName: 'certificado-' + row.codigo_verificacion + '.pdf' };
  }

  // ---- Escritura -------------------------------------------------------------------------------------------------------------
  emit(dto: EmitirCertificadoDto, actor: number) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const rol = await this.actorRole(tx, actor, ['certificados:emitir']);
      await this.lockChain(tx, dto.matricula_id);
      const item = await this.emitLocked(tx, dto.matricula_id, actor, rol, { revision: dto.matricula_revision });
      return { ok: true, item: view(item) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }

  annul(id: number, dto: AnularCertificadoDto, actor: number) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const rol = await this.actorRole(tx, actor, ['certificados:anular']);
      const matricula_id = await this.matriculaOf(tx, id);
      await this.lockChain(tx, matricula_id);
      const current = await this.lockCertificate(tx, id);
      if (current.estado !== 'vigente') throw new ConflictException('El certificado ya está anulado.');
      const item = await this.voidLocked(tx, current, actor, rol, dto.motivo);
      return { ok: true, item: view(item) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }

  // Anula el vigente y emite otro apuntando al anterior, todo en UNA transacción (si falla la emisión, el anterior sigue vigente).
  // También sirve para un certificado ya anulado que nadie sustituyó. Usa los datos ACTUALES del estudiante y de la edición:
  // es la vía para corregir un nombre o un DNI mal copiado. Exige poder anular y emitir.
  substitute(id: number, dto: SustituirCertificadoDto, actor: number) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const rol = await this.actorRole(tx, actor, ['certificados:anular', 'certificados:emitir']);
      const matricula_id = await this.matriculaOf(tx, id);
      await this.lockChain(tx, matricula_id);
      const current = await this.lockCertificate(tx, id);
      if (await tx.certificado.count({ where: { sustituye_a_id: id } })) throw new ConflictException('Este certificado ya fue sustituido. Consulta el certificado vigente de la matrícula.');
      const previous = current.estado === 'vigente' ? await this.voidLocked(tx, current, actor, rol, dto.motivo) : current;
      const item = await this.emitLocked(tx, matricula_id, actor, rol, { replaces: previous.id, motivo: dto.motivo });
      return { ok: true, item: view(item), anterior: view(previous) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }

  // ---- Internos --------------------------------------------------------------------------------------------------------------
  private async actorRole(tx: Tx, actor: number, permissions: Parameters<typeof can>[1][]) {
    const account = await tx.adminUser.findUniqueOrThrow({ where: { id: actor }, select: { rol: true } });
    if (!permissions.every(permission => can(account.rol, permission))) throw new ForbiddenException('No tienes permiso para esta operación sobre certificados.');
    return account.rol;
  }
  private async matriculaOf(tx: Tx, certificateId: number) {
    const found = await tx.certificado.findUnique({ where: { id: certificateId }, select: { matricula_id: true } });
    if (!found) throw new NotFoundException('El certificado no existe.');
    return found.matricula_id;
  }
  private async lockChain(tx: Tx, matriculaId: number) {
    const initial = await tx.matricula.findUnique({ where: { id: matriculaId }, select: { estudiante_id: true, convocatoria: { select: { id: true, curso_id: true } } } });
    if (!initial) throw new NotFoundException('La matrícula no existe.');
    await tx.$queryRaw`SELECT id FROM cursos WHERE id = ${initial.convocatoria.curso_id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM convocatorias WHERE id = ${initial.convocatoria.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM estudiantes WHERE id = ${initial.estudiante_id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM matriculas WHERE id = ${matriculaId} FOR UPDATE`;
  }
  private async lockCertificate(tx: Tx, id: number) {
    await tx.$queryRaw`SELECT id FROM certificados WHERE id = ${id} FOR UPDATE`;
    return tx.certificado.findUniqueOrThrow({ where: { id } });
  }
  private async record(tx: Tx, entry: { id: number; actor: number; rol: Rol; operacion: 'emision' | 'anulacion' | 'sustitucion'; anterior?: string; nuevo: string; campos: string[]; motivo?: string }) {
    await tx.academicoHistorial.create({ data: { entidad: 'certificado', entidad_id: entry.id, origen: 'panel', actor_id: entry.actor, actor_rol: entry.rol, operacion: entry.operacion,
      estado_anterior: entry.anterior, estado_nuevo: entry.nuevo, campos: entry.campos, motivo: entry.motivo } });
  }
  private async voidLocked(tx: Tx, current: Certificado, actor: number, rol: Rol, motivo: string) {
    const item = await tx.certificado.update({ where: { id: current.id }, data: { estado: 'anulado', anulado_por: actor, anulado_at: new Date(), anulacion_motivo: motivo } });
    await this.record(tx, { id: item.id, actor, rol, operacion: 'anulacion', anterior: 'vigente', nuevo: 'anulado', campos: ['estado', 'anulado_por', 'anulado_at', 'anulacion_motivo'], motivo });
    return item;
  }
  // Requiere haber llamado a lockChain. `revision` (solo en la emisión directa) compara con la que vio quien emite.
  private async emitLocked(tx: Tx, matriculaId: number, actor: number, rol: Rol, options: { revision?: number; replaces?: number; motivo?: string }) {
    const matricula = await tx.matricula.findUniqueOrThrow({ where: { id: matriculaId }, include: {
      estudiante: { select: { nombres: true, apellidos: true, doc_pais: true, doc_tipo: true, doc_numero: true } },
      convocatoria: { select: { estado: true, nombre: true, fecha_inicio: true, fecha_fin: true, curso: { select: { titulo: true, tipo: true, duracion: true } } } },
    } });
    if (options.revision !== undefined && matricula.revision !== options.revision) throw new ConflictException('La matrícula cambió desde que la consultaste. Revisa su cumplimiento antes de emitir el certificado.');
    const check = checkEmission({ matricula, estudiante: matricula.estudiante, convocatoria: matricula.convocatoria });
    if (check.ok === false) throw check.kind === 'conflict' ? new ConflictException(check.message) : new UnprocessableEntityException(check.message);
    if (await tx.certificado.count({ where: { matricula_id: matriculaId, estado: 'vigente' } })) throw new ConflictException('La matrícula ya tiene un certificado vigente. Anúlalo o sustitúyelo en lugar de emitir otro.');
    let code = '';
    for (let attempt = 0; attempt < CODE_ATTEMPTS && !code; attempt++) {
      const candidate = generateCode();
      if (!await tx.certificado.findUnique({ where: { codigo_verificacion: candidate }, select: { id: true } })) code = candidate;
    }
    if (!code) throw new ConflictException('No se pudo generar un código único. Repite la operación.');
    const item = await tx.certificado.create({ data: { matricula_id: matriculaId, codigo_verificacion: code, emitido_por: actor, sustituye_a_id: options.replaces ?? null, ...snapshotOf({ matricula, estudiante: matricula.estudiante, convocatoria: matricula.convocatoria }) } });
    await this.record(tx, { id: item.id, actor, rol, operacion: options.replaces ? 'sustitucion' : 'emision', nuevo: 'vigente', motivo: options.motivo,
      campos: ['matricula_id', 'codigo_verificacion', 'estado', 'estudiante', 'curso', 'convocatoria', ...(options.replaces ? ['sustituye_a_id'] : [])] });
    return item;
  }
}
