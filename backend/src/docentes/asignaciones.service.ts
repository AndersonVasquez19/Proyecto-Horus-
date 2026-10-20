import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DocenteAsignacion, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AsignacionesQueryDto, CreateAsignacionDto, DocenteAsignacionesQueryDto, ReactivacionAsignacionDto, RetiroAsignacionDto, RolAsignacionDto, SustitucionAsignacionDto } from './docentes.dto';
import { recordHistory } from './docentes.history';
import { assertEditionAcceptsTeachers, assertTeacherActive, PRINCIPAL_EXISTS, translateDatabaseError } from './docentes.rules';

const MESSAGES = {
  unique: 'El docente ya tiene una asignación en esa edición o la edición ya tiene un principal activo. Consulta el estado actual.',
  outdated: 'La gestión de docentes no está disponible. Solicita revisar la estructura académica.',
  concurrent: 'Otra operación modificó el equipo docente. Consulta la versión actual antes de repetir.',
};

// Resumen mínimo de cada lado: el docente sin documento, correo ni teléfono, y la edición con su curso. Quien necesite los datos
// personales los consulta en GET /admin/docentes/:id (docentes:leer).
const include = {
  docente: { select: { id: true, nombres: true, apellidos: true, especialidad: true, activo: true } },
  convocatoria: { select: { id: true, nombre: true, estado: true, archivado_at: true, fecha_inicio: true, fecha_fin: true, curso: { select: { id: true, titulo: true, tipo: true } } } },
} as const;
type Row = Prisma.DocenteAsignacionGetPayload<{ include: typeof include }>;
const calendar = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
export const viewAsignacion = (row: Row) => ({ ...row, convocatoria: { ...row.convocatoria, fecha_inicio: calendar(row.convocatoria.fecha_inicio), fecha_fin: calendar(row.convocatoria.fecha_fin) } });
const pagination = (q: { page: number; limit: number }, total: number) => ({ page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });
const stateFilter = (estado: 'activas' | 'retiradas' | 'todas'): Prisma.DocenteAsignacionWhereInput => estado === 'activas' ? { estado: 'activa' } : estado === 'retiradas' ? { estado: 'retirada' } : {};
const staleMessage = 'La asignación cambió desde que la abriste. Consulta la versión actual antes de guardar.';

@Injectable()
export class AsignacionesService {
  constructor(private readonly prisma: PrismaService) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) { return translateDatabaseError(error, MESSAGES); }
  }

  // Toda escritura usa la misma transacción READ COMMITTED y el orden de bloqueo del módulo de Ediciones y Matrículas:
  // curso → edición, y después docente → asignación. Así se serializa con el cierre, la cancelación o el archivo de la edición.
  private write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.execute(() => this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }

  private async lockEdition(tx: Prisma.TransactionClient, id: number) {
    const edition = await tx.convocatoria.findUnique({ where: { id }, select: { curso_id: true } });
    if (!edition) throw new NotFoundException('La edición no existe.');
    await tx.$queryRaw`SELECT id FROM cursos WHERE id = ${edition.curso_id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM convocatorias WHERE id = ${id} FOR UPDATE`;
    return tx.convocatoria.findUniqueOrThrow({ where: { id }, select: { id: true, estado: true, archivado_at: true } });
  }

  private async lockTeacher(tx: Prisma.TransactionClient, id: number) {
    const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM docentes WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('El docente no existe.');
    return tx.docente.findUniqueOrThrow({ where: { id }, select: { id: true, activo: true } });
  }

  private async lockAssignment(tx: Prisma.TransactionClient, id: number, revision: number) {
    const initial = await tx.docenteAsignacion.findUnique({ where: { id }, select: { convocatoria_id: true } });
    if (!initial) throw new NotFoundException('La asignación no existe.');
    const edition = await this.lockEdition(tx, initial.convocatoria_id);
    await tx.$queryRaw`SELECT id FROM docente_asignaciones WHERE id = ${id} FOR UPDATE`;
    const before = await tx.docenteAsignacion.findUniqueOrThrow({ where: { id } });
    if (before.revision !== revision) throw new ConflictException(staleMessage);
    return { before, edition };
  }

  private async assertNoPrincipal(tx: Prisma.TransactionClient, convocatoria_id: number, exceptId?: number) {
    const other = await tx.docenteAsignacion.findFirst({ where: { convocatoria_id, rol: 'principal', estado: 'activa', ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (other) throw new ConflictException(PRINCIPAL_EXISTS);
  }

  private async assertNoAssignment(tx: Prisma.TransactionClient, docente_id: number, convocatoria_id: number) {
    const existing = await tx.docenteAsignacion.findUnique({ where: { docente_id_convocatoria_id: { docente_id, convocatoria_id } }, select: { estado: true } });
    if (existing) throw new ConflictException(existing.estado === 'activa' ? 'El docente ya está asignado a esta edición.' : 'El docente ya tuvo una asignación retirada en esta edición. Reactívala en lugar de crear otra.');
  }

  private async apply(tx: Prisma.TransactionClient, id: number, revision: number, data: Prisma.DocenteAsignacionUpdateManyMutationInput) {
    const result = await tx.docenteAsignacion.updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } });
    if (!result.count) throw new ConflictException(staleMessage);
    return tx.docenteAsignacion.findUniqueOrThrow({ where: { id }, include });
  }

  private history(tx: Prisma.TransactionClient, item: DocenteAsignacion, actor: number, operacion: 'creacion' | 'edicion' | 'cambio_estado' | 'sustitucion', campos: string[], extra: { anterior?: string; nuevo?: string; motivo?: string } = {}) {
    return recordHistory(tx, { entidad: 'asignacion_docente', id: item.id, actor, operacion, campos, revision: item.revision, ...extra });
  }

  // --- Lecturas ---------------------------------------------------------------------------------------------------------

  list(q: AsignacionesQueryDto) {
    const where: Prisma.DocenteAsignacionWhereInput = { ...stateFilter(q.estado), ...(q.convocatoria_id ? { convocatoria_id: q.convocatoria_id } : {}), ...(q.docente_id ? { docente_id: q.docente_id } : {}), ...(q.rol ? { rol: q.rol } : {}) };
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.docenteAsignacion.findMany({ where, include, orderBy: [{ rol: 'asc' }, { docente: { apellidos: 'asc' } }, { docente: { nombres: 'asc' } }, { id: 'asc' }], take: q.limit, skip: (q.page - 1) * q.limit }),
        this.prisma.docenteAsignacion.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items: items.map(viewAsignacion), pagination: pagination(q, total) };
    });
  }

  listByTeacher(docente_id: number, q: DocenteAsignacionesQueryDto) {
    const where: Prisma.DocenteAsignacionWhereInput = { docente_id, ...stateFilter(q.estado) };
    return this.execute(async () => {
      const [teacher, items, total] = await this.prisma.$transaction([
        this.prisma.docente.findUnique({ where: { id: docente_id }, select: { id: true } }),
        this.prisma.docenteAsignacion.findMany({ where, include, orderBy: [{ convocatoria: { fecha_inicio: 'desc' } }, { id: 'desc' }], take: q.limit, skip: (q.page - 1) * q.limit }),
        this.prisma.docenteAsignacion.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      if (!teacher) throw new NotFoundException('El docente no existe.');
      return { ok: true, items: items.map(viewAsignacion), pagination: pagination(q, total) };
    });
  }

  detail(id: number) {
    return this.execute(async () => {
      const item = await this.prisma.docenteAsignacion.findUnique({ where: { id }, include });
      if (!item) throw new NotFoundException('La asignación no existe.');
      return { ok: true, item: viewAsignacion(item) };
    });
  }

  // --- Escrituras -------------------------------------------------------------------------------------------------------

  create(dto: CreateAsignacionDto, actor: number) {
    return this.write(async tx => {
      const edition = await this.lockEdition(tx, dto.convocatoria_id);
      assertEditionAcceptsTeachers(edition);
      assertTeacherActive(await this.lockTeacher(tx, dto.docente_id));
      await this.assertNoAssignment(tx, dto.docente_id, dto.convocatoria_id);
      const rol = dto.rol ?? 'participante';
      if (rol === 'principal') await this.assertNoPrincipal(tx, dto.convocatoria_id);
      const item = await tx.docenteAsignacion.create({ data: { docente_id: dto.docente_id, convocatoria_id: dto.convocatoria_id, rol }, include });
      await this.history(tx, item, actor, 'creacion', ['docente_id', 'convocatoria_id', 'rol'], { nuevo: 'activa' });
      return { ok: true, item: viewAsignacion(item) };
    });
  }

  changeRole(id: number, dto: RolAsignacionDto, actor: number) {
    return this.write(async tx => {
      const { before, edition } = await this.lockAssignment(tx, id, dto.revision);
      assertEditionAcceptsTeachers(edition);
      if (before.estado !== 'activa') throw new ConflictException('Solo se cambia el rol de una asignación activa.');
      if (before.rol === dto.rol) throw new ConflictException('La asignación ya tiene ese rol.');
      if (dto.rol === 'principal') await this.assertNoPrincipal(tx, before.convocatoria_id, id);
      const item = await this.apply(tx, id, dto.revision, { rol: dto.rol });
      await this.history(tx, item, actor, 'edicion', ['rol']);
      return { ok: true, item: viewAsignacion(item) };
    });
  }

  // Retirar siempre se permite (también en una edición ya cerrada o archivada) para poder corregir un equipo mal registrado.
  // La fila, el motivo y la fecha se conservan; no se borra nada.
  retire(id: number, dto: RetiroAsignacionDto, actor: number) {
    return this.write(async tx => {
      const { before } = await this.lockAssignment(tx, id, dto.revision);
      if (before.estado !== 'activa') throw new ConflictException('La asignación ya está retirada.');
      const item = await this.apply(tx, id, dto.revision, { estado: 'retirada', retirado_at: new Date(), retiro_motivo: dto.motivo });
      await this.history(tx, item, actor, 'cambio_estado', ['estado', 'retirado_at', 'retiro_motivo'], { anterior: 'activa', nuevo: 'retirada', motivo: dto.motivo });
      return { ok: true, item: viewAsignacion(item) };
    });
  }

  reactivate(id: number, dto: ReactivacionAsignacionDto, actor: number) {
    return this.write(async tx => {
      const { before, edition } = await this.lockAssignment(tx, id, dto.revision);
      assertEditionAcceptsTeachers(edition);
      if (before.estado !== 'retirada') throw new ConflictException('La asignación ya está activa.');
      assertTeacherActive(await this.lockTeacher(tx, before.docente_id));
      const rol = dto.rol ?? before.rol;
      if (rol === 'principal') await this.assertNoPrincipal(tx, before.convocatoria_id, id);
      const item = await this.apply(tx, id, dto.revision, { estado: 'activa', retirado_at: null, retiro_motivo: null, rol });
      await this.history(tx, item, actor, 'cambio_estado', ['estado', 'retirado_at', 'retiro_motivo', ...(rol !== before.rol ? ['rol'] : [])], { anterior: 'retirada', nuevo: 'activa', motivo: dto.motivo });
      return { ok: true, item: viewAsignacion(item) };
    });
  }

  // Sustitución: retira la asignación actual y crea la del sustituto en una sola transacción (o ambas o ninguna). La nueva fila
  // apunta a la retirada con sustituye_a_id y hereda su rol, salvo que se indique otro. Retira primero para liberar el principal único.
  substitute(id: number, dto: SustitucionAsignacionDto, actor: number) {
    return this.write(async tx => {
      const { before, edition } = await this.lockAssignment(tx, id, dto.revision);
      assertEditionAcceptsTeachers(edition);
      if (before.estado !== 'activa') throw new ConflictException('Solo se sustituye una asignación activa.');
      if (dto.docente_id === before.docente_id) throw new BadRequestException('El docente sustituto debe ser distinto del docente actual.');
      assertTeacherActive(await this.lockTeacher(tx, dto.docente_id));
      await this.assertNoAssignment(tx, dto.docente_id, before.convocatoria_id);
      const retirada = await this.apply(tx, id, dto.revision, { estado: 'retirada', retirado_at: new Date(), retiro_motivo: dto.motivo });
      const rol = dto.rol ?? before.rol;
      if (rol === 'principal') await this.assertNoPrincipal(tx, before.convocatoria_id);
      const nueva = await tx.docenteAsignacion.create({ data: { docente_id: dto.docente_id, convocatoria_id: before.convocatoria_id, rol, sustituye_a_id: id }, include });
      await this.history(tx, retirada, actor, 'cambio_estado', ['estado', 'retirado_at', 'retiro_motivo'], { anterior: 'activa', nuevo: 'retirada', motivo: dto.motivo });
      await this.history(tx, nueva, actor, 'sustitucion', ['docente_id', 'convocatoria_id', 'rol', 'sustituye_a_id'], { nuevo: 'activa', motivo: dto.motivo });
      return { ok: true, item: viewAsignacion(nueva), anterior: viewAsignacion(retirada) };
    });
  }
}
