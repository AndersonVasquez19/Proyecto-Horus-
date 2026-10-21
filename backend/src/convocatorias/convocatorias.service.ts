import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Convocatoria, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';
import { ArchivoConvocatoriaDto, CierreConvocatoriaDto, ConvocatoriasQueryDto, CreateConvocatoriaDto, CursosConvocatoriaQueryDto, RecepcionPreinscripcionDto, UpdateConvocatoriaDto } from './convocatorias.dto';
import { validateEdition, validateTransition } from './convocatorias.rules';
import { ESTADOS_PARA_APERTURA, MINIMO_APERTURA_NUEVAS, validateOpeningMinimum } from '../preinscripciones/preinscripciones.rules';

const course = { id: true, titulo: true, tipo: true, estado: true } as const;
const calendar = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const serialize = <T extends Convocatoria>(item: T) => ({ ...item, fecha_inicio: calendar(item.fecha_inicio), fecha_fin: calendar(item.fecha_fin) });
const pagination = (q: CursosConvocatoriaQueryDto, total: number) => ({ page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });
// Identificador opaco para el público (128 bits aleatorios, 32 hex): la API pública no expone ids secuenciales.
const publicCode = () => randomBytes(16).toString('hex');

@Injectable()
export class ConvocatoriasService {
  constructor(private readonly prisma: PrismaService) {}
  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Ya existe una edición con esos datos. Revisa también las archivadas.');
      if (isSchemaOutdated(error)) throw new ServiceUnavailableException('La gestión de ediciones no está disponible. Solicita revisar la estructura académica.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new ConflictException('Otra operación modificó la edición. Consulta la versión actual antes de repetir.');
      throw error;
    }
  }
  list(q: ConvocatoriasQueryDto) {
    const where: Prisma.ConvocatoriaWhereInput = {
      ...(q.archivo === 'activos' ? { archivado_at: null } : q.archivo === 'archivados' ? { archivado_at: { not: null } } : {}),
      ...(q.curso_id ? { curso_id: q.curso_id } : {}), ...(q.estado ? { estado: q.estado } : {}),
      ...(q.search ? { OR: [{ nombre: { contains: q.search } }, { curso: { titulo: { contains: q.search } } }] } : {}),
    };
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.convocatoria.findMany({ where, include: { curso: { select: course } }, orderBy: [{ fecha_inicio: 'desc' }, { id: 'desc' }], take: q.limit, skip: (q.page - 1) * q.limit }),
        this.prisma.convocatoria.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items: items.map(serialize), pagination: pagination(q, total) };
    });
  }
  courses(q: CursosConvocatoriaQueryDto) {
    const where: Prisma.CursoWhereInput = q.search ? { titulo: { contains: q.search } } : {};
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.curso.findMany({ where, select: course, orderBy: [{ titulo: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit }), this.prisma.curso.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items, pagination: pagination(q, total) };
    });
  }
  detail(id: number) {
    return this.execute(async () => {
      const item = await this.prisma.convocatoria.findUnique({ where: { id }, include: { curso: { select: course } } });
      if (!item) throw new NotFoundException('La edición no existe.');
      return { ok: true, item: serialize(item) };
    });
  }
  private async lockCourse(tx: Prisma.TransactionClient, id: number) {
    const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM cursos WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('El curso asociado no existe.');
  }
  private async uniqueName(tx: Prisma.TransactionClient, curso_id: number, nombre: string, id?: number) {
    if (await tx.convocatoria.findFirst({ where: { curso_id, nombre, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw new ConflictException('Ya existe una edición con ese nombre para el curso. Revisa también las archivadas.');
  }
  private async history(tx: Prisma.TransactionClient, item: Convocatoria, actor: number, operacion: 'creacion' | 'edicion' | 'cambio_estado' | 'archivado' | 'restauracion', campos: string[], before?: Convocatoria) {
    const account = await tx.adminUser.findUnique({ where: { id: actor }, select: { rol: true } });
    await tx.academicoHistorial.create({ data: { entidad: 'convocatoria', entidad_id: item.id, origen: 'panel', actor_id: actor, actor_rol: account?.rol, operacion,
      campos, revision: item.revision, estado_anterior: before?.estado, estado_nuevo: item.estado } });
  }
  create(dto: CreateConvocatoriaDto, actor: number) {
    validateEdition(dto, 0, false);
    return this.execute(() => this.prisma.$transaction(async tx => {
      await this.lockCourse(tx, dto.curso_id);
      await this.uniqueName(tx, dto.curso_id, dto.nombre);
      // Toda edición NUEVA exige 10 preinscripciones validadas para abrirse (sin excepciones ni parámetros del cliente: el DTO rechaza
      // `minimo_apertura`). Las anteriores a la migración conservan NULL = sin requisito. Nace con la recepción de preinscripciones
      // cerrada: Gerencia o Coordinación la habilitan explícitamente.
      const item = await tx.convocatoria.create({ data: { ...dto, fecha_inicio: new Date(dto.fecha_inicio + 'T00:00:00Z'), fecha_fin: new Date(dto.fecha_fin + 'T00:00:00Z'), minimo_apertura: MINIMO_APERTURA_NUEVAS, codigo_publico: publicCode() }, include: { curso: { select: course } } });
      await this.history(tx, item, actor, 'creacion', ['curso_id', 'nombre', 'fecha_inicio', 'fecha_fin', 'capacidad']);
      return { ok: true, item: serialize(item) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
  update(id: number, dto: UpdateConvocatoriaDto, actor: number) {
    const { revision, ...fields } = dto;
    if (!Object.values(fields).some(value => value !== undefined)) throw new BadRequestException('Indica al menos un campo para editar.');
    return this.change(id, revision, actor, 'edicion', async (tx, before) => {
      if (before.archivado_at || !['planificada', 'abierta'].includes(before.estado)) throw new ConflictException('Solo se editan ediciones planificadas o abiertas sin archivar.');
      const merged = { fecha_inicio: dto.fecha_inicio ?? calendar(before.fecha_inicio), fecha_fin: dto.fecha_fin ?? calendar(before.fecha_fin), capacidad: dto.capacidad ?? before.capacidad };
      const occupied = await tx.matricula.count({ where: { convocatoria_id: id, estado: 'activa' } });
      validateEdition(merged, occupied, before.estado === 'abierta');
      if (dto.nombre !== undefined) await this.uniqueName(tx, before.curso_id, dto.nombre, id);
      return { ...fields, ...(dto.fecha_inicio !== undefined ? { fecha_inicio: new Date(dto.fecha_inicio + 'T00:00:00Z') } : {}), ...(dto.fecha_fin !== undefined ? { fecha_fin: new Date(dto.fecha_fin + 'T00:00:00Z') } : {}) };
    });
  }
  open(id: number, revision: number, actor: number) {
    return this.change(id, revision, actor, 'cambio_estado', async (tx, before) => {
      validateTransition(before.estado, 'abierta', !!before.archivado_at);
      const occupied = await tx.matricula.count({ where: { convocatoria_id: id, estado: 'activa' } });
      validateEdition({ ...before, fecha_inicio: calendar(before.fecha_inicio), fecha_fin: calendar(before.fecha_fin) }, occupied, true);
      // Mínimo de apertura: SOLO cuentan las preinscripciones validadas (o ya matriculadas), nunca las simples solicitudes recibidas.
      // Se cuenta con el bloqueo de la edición ya tomado; validar, descartar, desistir y convertir toman el mismo bloqueo antes de
      // cambiar de estado, así que el recuento es firme frente a validaciones simultáneas. Al llegar a 10 la edición NO se abre sola:
      // esta operación la confirma Gerencia o Coordinación.
      if (before.minimo_apertura !== null) {
        const counted = await tx.preinscripcion.count({ where: { convocatoria_id: id, estado: { in: [...ESTADOS_PARA_APERTURA] } } });
        validateOpeningMinimum(before.minimo_apertura, counted);
      }
      return { estado: 'abierta' };
    });
  }
  // Habilita o cierra la RECEPCIÓN de preinscripciones. No abre ni cierra la edición, ni la cierra sola al llegar al mínimo o al abrirla.
  setReception(id: number, dto: RecepcionPreinscripcionDto, actor: number) {
    return this.change(id, dto.revision, actor, 'edicion', async (_tx, before) => {
      if (before.preinscripcion_estado === dto.estado) throw new ConflictException('La recepción de preinscripciones ya tiene ese estado.');
      if (dto.estado === 'abierta') {
        if (before.archivado_at || !['planificada', 'abierta'].includes(before.estado)) throw new ConflictException('Solo una edición planificada o abierta, sin archivar, puede recibir preinscripciones.');
        if (!before.capacidad) throw new ConflictException('Define la capacidad de la edición antes de recibir preinscripciones.');
        return { preinscripcion_estado: 'abierta', ...(before.codigo_publico ? {} : { codigo_publico: publicCode() }) };
      }
      return { preinscripcion_estado: 'cerrada' }; // cerrar la recepción siempre se permite
    });
  }
  close(id: number, dto: CierreConvocatoriaDto, actor: number) {
    return this.change(id, dto.revision, actor, 'cambio_estado', async (_tx, before) => {
      validateTransition(before.estado, dto.estado, !!before.archivado_at);
      return { estado: dto.estado };
    });
  }
  archive(id: number, dto: ArchivoConvocatoriaDto, actor: number) {
    return this.change(id, dto.revision, actor, dto.archivado ? 'archivado' : 'restauracion', async (_tx, before) => {
      if (!['cerrada', 'cancelada'].includes(before.estado)) throw new ConflictException('Cierra o cancela la edición antes de archivarla.');
      if (!!before.archivado_at === dto.archivado) throw new ConflictException('La edición ya tiene ese estado de archivo.');
      return { archivado_at: dto.archivado ? new Date() : null };
    });
  }
  private change(id: number, revision: number, actor: number, operation: 'edicion' | 'cambio_estado' | 'archivado' | 'restauracion', prepare: (tx: Prisma.TransactionClient, item: Convocatoria) => Promise<Prisma.ConvocatoriaUpdateManyMutationInput>) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const initial = await tx.convocatoria.findUnique({ where: { id }, select: { curso_id: true } });
      if (!initial) throw new NotFoundException('La edición no existe.');
      // Orden común a todas las escrituras: curso → edición. READ COMMITTED evita reutilizar una instantánea anterior al bloqueo.
      await this.lockCourse(tx, initial.curso_id);
      await tx.$queryRaw`SELECT id FROM convocatorias WHERE id = ${id} FOR UPDATE`;
      const before = await tx.convocatoria.findUniqueOrThrow({ where: { id } });
      if (before.revision !== revision) throw new ConflictException('La edición cambió desde que la abriste. Conserva tus cambios y consulta la versión actual antes de guardar.');
      const data = await prepare(tx, before);
      const result = await tx.convocatoria.updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } });
      if (!result.count) throw new ConflictException('Otra operación modificó la edición. Consulta la versión actual.');
      const item = await tx.convocatoria.findUniqueOrThrow({ where: { id }, include: { curso: { select: course } } });
      await this.history(tx, item, actor, operation, Object.keys(data).filter(key => data[key] !== undefined), before);
      return { ok: true, item: serialize(item) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
}
