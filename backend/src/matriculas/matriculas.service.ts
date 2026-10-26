import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Convocatoria, Matricula, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';
import { can } from '../permissions/policy';
import { AnularMatriculaDto, ConfirmarCumplimientoDto, CreateMatriculaDto, EdicionesMatriculaQueryDto, MatriculasQueryDto, ReactivarMatriculaDto } from './matriculas.dto';
import { CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';

const student = { id: true, nombres: true, apellidos: true, doc_numero: true, archivado_at: true } as const;
const edition = { id: true, curso_id: true, nombre: true, estado: true, capacidad: true, archivado_at: true, revision: true, fecha_inicio: true, fecha_fin: true, curso: { select: { id: true, titulo: true, tipo: true } } } as const;
const relations = { estudiante: { select: student }, convocatoria: { select: edition } } as const;
const calendar = <T extends { fecha_inicio: Date | null; fecha_fin: Date | null }>(item: T) => ({ ...item, fecha_inicio: item.fecha_inicio?.toISOString().slice(0, 10) ?? null, fecha_fin: item.fecha_fin?.toISOString().slice(0, 10) ?? null });
const serialize = <T extends { convocatoria: { fecha_inicio: Date | null; fecha_fin: Date | null } }>(item: T) => ({ ...item, convocatoria: calendar(item.convocatoria) });
const pagination = (q: CursosConvocatoriaQueryDto, total: number) => ({ page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });

@Injectable()
export class MatriculasService {
  constructor(private readonly prisma: PrismaService) {}
  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('El estudiante ya tiene una matrícula en esta edición. Consulta su detalle; una matrícula anulada se reactiva.');
      if (isSchemaOutdated(error)) throw new ServiceUnavailableException('La gestión de matrículas no está disponible. Solicita revisar la estructura académica y la migración de capacidad.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code)) throw new ConflictException('Otra operación modificó los datos académicos. Consulta la versión actual antes de repetir.');
      throw error;
    }
  }
  list(q: MatriculasQueryDto) {
    const terms = (q.search || '').split(/\s+/).filter(Boolean);
    const where: Prisma.MatriculaWhereInput = {
      ...(q.estudiante_id ? { estudiante_id: q.estudiante_id } : {}), ...(q.convocatoria_id ? { convocatoria_id: q.convocatoria_id } : {}),
      ...(q.curso_id ? { convocatoria: { curso_id: q.curso_id } } : {}), ...(q.estado ? { estado: q.estado } : {}),
      ...(terms.length ? { AND: terms.map(term => ({ OR: [{ estudiante: { nombres: { contains: term } } }, { estudiante: { apellidos: { contains: term } } }, { estudiante: { doc_numero: { contains: term } } }, { convocatoria: { nombre: { contains: term } } }, { convocatoria: { curso: { titulo: { contains: term } } } }] })) } : {}),
    };
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.matricula.findMany({ where, include: relations, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }), this.prisma.matricula.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items: items.map(serialize), pagination: pagination(q, total) };
    });
  }
  editions(q: EdicionesMatriculaQueryDto) {
    const where: Prisma.ConvocatoriaWhereInput = { ...(q.curso_id ? { curso_id: q.curso_id } : {}), ...(q.search ? { OR: [{ nombre: { contains: q.search } }, { curso: { titulo: { contains: q.search } } }] } : {}) };
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.convocatoria.findMany({ where, select: { ...edition, _count: { select: { matriculas: { where: { estado: 'activa' } } } } }, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }), this.prisma.convocatoria.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items: items.map(({ _count, ...item }) => ({ ...calendar(item), ocupados: _count.matriculas, disponibles: item.capacidad === null ? null : Math.max(0, item.capacidad - _count.matriculas) })), pagination: pagination(q, total) };
    });
  }
  detail(id: number) {
    return this.execute(async () => {
      const item = await this.prisma.matricula.findUnique({ where: { id }, include: relations });
      if (!item) throw new NotFoundException('La matrícula no existe.');
      return { ok: true, item: serialize(item) };
    });
  }
  history(id: number, q: CursosConvocatoriaQueryDto) {
    return this.execute(async () => {
      if (!await this.prisma.matricula.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('La matrícula no existe.');
      const where = { entidad: 'matricula' as const, entidad_id: id };
      const [items, total] = await this.prisma.$transaction([
        this.prisma.academicoHistorial.findMany({ where, orderBy: { id: 'desc' }, take: q.limit, skip: (q.page - 1) * q.limit }), this.prisma.academicoHistorial.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items, pagination: pagination(q, total) };
    });
  }
  async lockEdition(tx: Prisma.TransactionClient, id: number) {
    const initial = await tx.convocatoria.findUnique({ where: { id }, select: { curso_id: true } });
    if (!initial) throw new NotFoundException('La edición no existe.');
    // Mismo orden que ConvocatoriasService: curso → edición → estudiante → matrícula.
    await tx.$queryRaw`SELECT id FROM cursos WHERE id = ${initial.curso_id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM convocatorias WHERE id = ${id} FOR UPDATE`;
    return tx.convocatoria.findUniqueOrThrow({ where: { id } });
  }
  private async lockStudent(tx: Prisma.TransactionClient, id: number, admission: boolean) {
    const rows = await tx.$queryRaw<{ id: number; archivado_at: Date | null }[]>`SELECT id, archivado_at FROM estudiantes WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('El estudiante no existe.');
    if (admission && rows[0].archivado_at) throw new ConflictException('El estudiante está archivado. Restáuralo antes de matricular o reactivar.');
  }
  private async admit(tx: Prisma.TransactionClient, item: Convocatoria, revision: number) {
    if (item.revision !== revision) throw new ConflictException('La edición cambió desde que la consultaste. Actualiza sus datos y cupos antes de continuar.');
    if (item.archivado_at || item.estado !== 'abierta') throw new ConflictException('Solo se admiten matrículas y reactivaciones en ediciones abiertas sin archivar.');
    if (item.capacidad === null) throw new ConflictException('La edición no tiene capacidad definida. Configúrala antes de matricular o reactivar.');
    const occupied = await tx.matricula.count({ where: { convocatoria_id: item.id, estado: 'activa' } });
    if (occupied >= item.capacidad) throw new ConflictException('La edición no tiene cupos disponibles.');
  }
  private async audit(tx: Prisma.TransactionClient, item: Matricula, actor: number, operacion: 'creacion' | 'anulacion' | 'cambio_estado', before?: Matricula, motivo?: string) {
    const account = await tx.adminUser.findUniqueOrThrow({ where: { id: actor }, select: { rol: true } });
    await tx.academicoHistorial.create({ data: { entidad: 'matricula', entidad_id: item.id, origen: 'panel', actor_id: actor, actor_rol: account.rol,
      operacion, estado_anterior: before?.estado, estado_nuevo: item.estado, revision: item.revision, motivo,
      campos: before ? ['estado'] : ['estudiante_id', 'convocatoria_id', 'estado', 'cumplimiento'] } });
  }
  create(dto: CreateMatriculaDto, actor: number) {
    return this.execute(() => this.prisma.$transaction(tx => this.createInTransaction(tx, dto, actor), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
  // El llamador conserva la misma transacción para todo el lote. Sin transacciones anidadas.
  async createInTransaction(tx: Prisma.TransactionClient, dto: CreateMatriculaDto, actor: number, motivo?: string) {
    const convoc = await this.lockEdition(tx, dto.convocatoria_id);
    await this.lockStudent(tx, dto.estudiante_id, true);
    if (await tx.matricula.findUnique({ where: { estudiante_id_convocatoria_id: { estudiante_id: dto.estudiante_id, convocatoria_id: dto.convocatoria_id } }, select: { id: true } })) throw new ConflictException('El estudiante ya tiene una matrícula en esta edición. Consulta su detalle; una matrícula anulada se reactiva.');
    await this.admit(tx, convoc, dto.convocatoria_revision);
    const item = await tx.matricula.create({ data: { estudiante_id: dto.estudiante_id, convocatoria_id: dto.convocatoria_id }, include: relations });
    await this.audit(tx, item, actor, 'creacion', undefined, motivo);
    return { ok: true, item: serialize(item) };
  }
  // Confirmación administrativa del cumplimiento (cumplido / no_cumplido / vuelta a pendiente). Solo roles con matriculas:confirmar
  // (gerente y coordinadora); MySQL rechaza además un confirmador SECRETARIA. Bloqueo: curso → edición → estudiante → matrícula,
  // el mismo orden que el resto del módulo. Con un certificado vigente el cumplimiento no se toca: primero se anula el certificado.
  confirm(id: number, dto: ConfirmarCumplimientoDto, actor: number) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const initial = await tx.matricula.findUnique({ where: { id }, select: { convocatoria_id: true, estudiante_id: true } });
      if (!initial) throw new NotFoundException('La matrícula no existe.');
      await this.lockEdition(tx, initial.convocatoria_id);
      await this.lockStudent(tx, initial.estudiante_id, false);
      await tx.$queryRaw`SELECT id FROM matriculas WHERE id = ${id} FOR UPDATE`;
      const before = await tx.matricula.findUniqueOrThrow({ where: { id } });
      const account = await tx.adminUser.findUniqueOrThrow({ where: { id: actor }, select: { rol: true } });
      if (account.rol !== 'GERENTE_GENERAL' && account.rol !== 'COORDINADORA_INSTITUCIONAL' || !can(account.rol, 'matriculas:confirmar')) throw new ForbiddenException('No tienes permiso para confirmar el cumplimiento.');
      if (before.revision !== dto.revision) throw new ConflictException('La matrícula cambió desde que la abriste. Consulta su versión actual antes de continuar.');
      if (before.estado !== 'activa') throw new ConflictException('Solo se confirma el cumplimiento de matrículas activas.');
      if (before.cumplimiento === dto.cumplimiento) throw new ConflictException('La matrícula ya tiene ese cumplimiento. Consulta su detalle.');
      if (before.cumplimiento !== 'pendiente' && !dto.motivo) throw new BadRequestException('Indica el motivo para corregir una confirmación de cumplimiento.');
      if (await tx.certificado.count({ where: { matricula_id: id, estado: 'vigente' } })) throw new ConflictException('La matrícula tiene un certificado vigente. Anúlalo antes de cambiar el cumplimiento.');
      const confirmed = dto.cumplimiento !== 'pendiente';
      const item = await tx.matricula.update({ where: { id }, include: relations, data: {
        cumplimiento: dto.cumplimiento, revision: { increment: 1 },
        confirmado_por: confirmed ? actor : null, confirmado_rol: confirmed ? account.rol as 'GERENTE_GENERAL' | 'COORDINADORA_INSTITUCIONAL' : null, confirmado_at: confirmed ? new Date() : null,
      } });
      await tx.academicoHistorial.create({ data: { entidad: 'matricula', entidad_id: id, origen: 'panel', actor_id: actor, actor_rol: account.rol,
        operacion: 'confirmacion', estado_anterior: before.cumplimiento, estado_nuevo: item.cumplimiento, revision: item.revision, motivo: dto.motivo,
        campos: ['cumplimiento', 'confirmado_por', 'confirmado_rol', 'confirmado_at'] } });
      return { ok: true, item: serialize(item) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
  annul(id: number, dto: AnularMatriculaDto, actor: number) { return this.change(id, dto, actor, false); }
  reactivate(id: number, dto: ReactivarMatriculaDto, actor: number) { return this.change(id, dto, actor, true); }
  private change(id: number, dto: AnularMatriculaDto | ReactivarMatriculaDto, actor: number, reactivate: boolean) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const initial = await tx.matricula.findUnique({ where: { id }, select: { convocatoria_id: true, estudiante_id: true } });
      if (!initial) throw new NotFoundException('La matrícula no existe.');
      const convoc = await this.lockEdition(tx, initial.convocatoria_id);
      await this.lockStudent(tx, initial.estudiante_id, reactivate);
      await tx.$queryRaw`SELECT id FROM matriculas WHERE id = ${id} FOR UPDATE`;
      const before = await tx.matricula.findUniqueOrThrow({ where: { id } });
      if (before.revision !== dto.revision) throw new ConflictException('La matrícula cambió desde que la abriste. Consulta su versión actual antes de continuar.');
      if (before.estado !== (reactivate ? 'anulada' : 'activa')) throw new ConflictException('La matrícula ya tiene ese estado. Consulta su detalle.');
      if (reactivate) {
        const account = await tx.adminUser.findUniqueOrThrow({ where: { id: actor }, select: { rol: true } });
        if (!can(account.rol, 'matriculas:editar')) throw new ForbiddenException('No tienes permiso para reactivar matrículas.');
        await this.admit(tx, convoc, (dto as ReactivarMatriculaDto).convocatoria_revision);
      } else if (await tx.certificado.count({ where: { matricula_id: id, estado: 'vigente' } })) throw new ConflictException('La matrícula tiene un certificado vigente. Debe resolverse antes de anularla.');
      const item = await tx.matricula.update({ where: { id }, data: { estado: reactivate ? 'activa' : 'anulada', revision: { increment: 1 } }, include: relations });
      await this.audit(tx, item, actor, reactivate ? 'cambio_estado' : 'anulacion', before, dto.motivo);
      return { ok: true, item: serialize(item) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
}
