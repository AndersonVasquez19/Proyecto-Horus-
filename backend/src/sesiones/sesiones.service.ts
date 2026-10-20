import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateSesionDto, EdicionSesionesQueryDto, EstadoSesionDto, SesionesQueryDto, UpdateSesionDto } from './sesiones.dto';
import { recordSessionHistory } from './sesiones.history';
import {
  ASSIGNMENT_RETIRED, assertEditionAcceptsSessions, assertModalityFits, assertTransition, assertValidInterval, changedFieldNames, FROZEN_FIELDS, outsidePeriod,
  requireReason, STALE, TEACHER_INACTIVE, TEACHER_NOT_ASSIGNED, transitionNeedsReason, translateDatabaseError,
} from './sesiones.rules';
import { formatDate, formatTime, hasStarted, limaToUtc, parseDate, parseTime, slotLabel, ZONA_HORARIA } from './sesiones.time';

// Reloj inyectable (solo las pruebas lo sustituyen): «marcar como realizada» compara con la hora de Lima de ESTE instante.
export const SESIONES_CLOCK = Symbol('SESIONES_CLOCK');

// Resumen mínimo: el docente sin documento, correo ni teléfono, y la edición con su curso. Los datos personales se consultan en
// GET /admin/docentes/:id (docentes:leer).
const include = {
  convocatoria: { select: { id: true, nombre: true, estado: true, archivado_at: true, fecha_inicio: true, fecha_fin: true, curso: { select: { id: true, titulo: true, tipo: true } } } },
  asignacion: { select: { id: true, rol: true, estado: true, docente: { select: { id: true, nombres: true, apellidos: true, especialidad: true, activo: true } } } },
} as const;
type Row = Prisma.SesionGetPayload<{ include: typeof include }>;

const calendar = (value: Date | null) => value ? formatDate(value) : null;

// Contrato para el futuro calendario: fecha y horas en hora de Lima (`zona_horaria`), más el instante UTC de inicio y fin ya calculado,
// de modo que ningún cliente tenga que adivinar la zona. `docente` es null si la sesión no tiene docente definido; `docente.vigente`
// indica si el docente sigue activo y con su asignación vigente (una sesión con docente no vigente conserva su historial pero hay que
// reasignarla para reprogramarla). `fuera_de_periodo` avisa si la fecha cae fuera de las fechas de la edición.
export function viewSesion(row: Row) {
  const fecha = formatDate(row.fecha), inicio = formatTime(row.hora_inicio), fin = formatTime(row.hora_fin);
  const edition = { ...row.convocatoria, fecha_inicio: calendar(row.convocatoria.fecha_inicio), fecha_fin: calendar(row.convocatoria.fecha_fin) };
  return {
    id: row.id, convocatoria_id: row.convocatoria_id, asignacion_id: row.asignacion_id, titulo: row.titulo,
    fecha, hora_inicio: inicio, hora_fin: fin, zona_horaria: ZONA_HORARIA, inicio_utc: limaToUtc(fecha, inicio).toISOString(), fin_utc: limaToUtc(fecha, fin).toISOString(),
    modalidad: row.modalidad, lugar: row.lugar, enlace_url: row.enlace_url, estado: row.estado, cancelada_at: row.cancelada_at, cancelacion_motivo: row.cancelacion_motivo,
    observaciones: row.observaciones, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
    docente_id: row.asignacion?.docente.id ?? null,
    docente: row.asignacion ? { ...row.asignacion.docente, asignacion_id: row.asignacion.id, rol: row.asignacion.rol, asignacion_estado: row.asignacion.estado, vigente: row.asignacion.estado === 'activa' && row.asignacion.docente.activo } : null,
    convocatoria: edition,
    fuera_de_periodo: outsidePeriod(fecha, edition),
  };
}

const pagination = (q: { page: number; limit: number }, total: number) => ({ page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });
const order = (direction: 'asc' | 'desc'): Prisma.SesionOrderByWithRelationInput[] => [{ fecha: direction }, { hora_inicio: direction }, { id: direction }];

@Injectable()
export class SesionesService {
  constructor(private readonly prisma: PrismaService, @Optional() @Inject(SESIONES_CLOCK) private readonly clock: () => Date = () => new Date()) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) { return translateDatabaseError(error); }
  }

  // Toda escritura usa la misma transacción READ COMMITTED y el orden de bloqueo de Ediciones, Matrículas y Docentes:
  // curso → edición, y después docente. Cada transacción usa UNA sola conexión (el pool es de 2): dentro solo se usa `tx`.
  // El bloqueo de la edición serializa todas las escrituras de sus sesiones y las del equipo docente, el cierre, la cancelación y el archivo
  // de la edición; el del docente serializa las sesiones de un mismo docente aunque sean de ediciones distintas y con su activación o
  // desactivación. Así, dos solicitudes simultáneas no pueden crear a la vez dos sesiones solapadas: la segunda espera y ve a la primera.
  private write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.execute(() => this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 20000 }));
  }

  private async lockEdition(tx: Prisma.TransactionClient, id: number) {
    const edition = await tx.convocatoria.findUnique({ where: { id }, select: { curso_id: true } });
    if (!edition) throw new NotFoundException('La edición no existe.');
    await tx.$queryRaw`SELECT id FROM cursos WHERE id = ${edition.curso_id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM convocatorias WHERE id = ${id} FOR UPDATE`;
    return tx.convocatoria.findUniqueOrThrow({ where: { id }, select: { id: true, estado: true, archivado_at: true, curso: { select: { modalidad: true } } } });
  }

  // Docente que va a dictar la sesión: existe, está activo y tiene una asignación ACTIVA en esta edición (la clave compuesta de la tabla
  // garantiza además que esa asignación es de esta edición). Bloquea la fila del docente: se serializa con otras sesiones suyas y con su
  // desactivación. Devuelve la asignación a la que se vincula la sesión.
  private async resolveTeacher(tx: Prisma.TransactionClient, docente_id: number, convocatoria_id: number): Promise<number> {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM docentes WHERE id = ${docente_id} FOR UPDATE`;
    if (!locked.length) throw new NotFoundException('El docente no existe.');
    const teacher = await tx.docente.findUniqueOrThrow({ where: { id: docente_id }, select: { activo: true } });
    if (!teacher.activo) throw new ConflictException(TEACHER_INACTIVE);
    const assignment = await tx.docenteAsignacion.findUnique({ where: { docente_id_convocatoria_id: { docente_id, convocatoria_id } }, select: { id: true, estado: true } });
    if (!assignment) throw new ConflictException(TEACHER_NOT_ASSIGNED);
    if (assignment.estado !== 'activa') throw new ConflictException(ASSIGNMENT_RETIRED);
    return assignment.id;
  }

  // Política de solapamientos (intervalos [inicio, fin), mismo día de Lima, sesiones programadas o realizadas; las canceladas no ocupan):
  //  1. un docente no puede tener dos sesiones simultáneas, ni siquiera en ediciones distintas;
  //  2. una edición no puede tener dos sesiones simultáneas (su grupo de estudiantes es uno solo), con o sin docente.
  // Debe llamarse con los bloqueos de la edición y del docente ya tomados.
  private async assertNoConflicts(tx: Prisma.TransactionClient, p: { convocatoria_id: number; docente_id: number | null; fecha: string; inicio: string; fin: string; exceptId?: number }) {
    const rows = await tx.sesion.findMany({
      where: {
        fecha: parseDate(p.fecha), estado: { not: 'cancelada' }, hora_inicio: { lt: parseTime(p.fin) }, hora_fin: { gt: parseTime(p.inicio) },
        ...(p.exceptId ? { id: { not: p.exceptId } } : {}),
        OR: [{ convocatoria_id: p.convocatoria_id }, ...(p.docente_id ? [{ asignacion: { docente_id: p.docente_id } }] : [])],
      },
      select: { id: true, convocatoria_id: true, titulo: true, fecha: true, hora_inicio: true, hora_fin: true, estado: true, asignacion: { select: { docente_id: true } } },
      orderBy: order('asc'), take: 10,
    });
    if (!rows.length) return;
    const conflictos = rows.map(row => ({
      id: row.id, convocatoria_id: row.convocatoria_id, titulo: row.titulo, fecha: formatDate(row.fecha), hora_inicio: formatTime(row.hora_inicio), hora_fin: formatTime(row.hora_fin), estado: row.estado,
      tipo: [...(row.convocatoria_id === p.convocatoria_id ? ['edicion'] : []), ...(p.docente_id && row.asignacion?.docente_id === p.docente_id ? ['docente'] : [])],
    }));
    const byTeacher = conflictos.some(c => c.tipo.includes('docente')), byEdition = conflictos.some(c => c.tipo.includes('edicion'));
    throw new ConflictException({
      statusCode: 409, error: 'Conflict', codigo: 'CONFLICTO_HORARIO', conflictos,
      message: byTeacher && byEdition ? 'El horario se solapa con otra sesión del docente y con otra de la misma edición.'
        : byTeacher ? 'El docente ya tiene otra sesión en ese horario.' : 'La edición ya tiene otra sesión en ese horario.',
    });
  }

  // --- Lecturas ---------------------------------------------------------------------------------------------------------

  private filters(q: { estado?: string; desde?: string; hasta?: string; docente_id?: number; convocatoria_id?: number }): Prisma.SesionWhereInput {
    if (q.desde && q.hasta && q.desde > q.hasta) throw new BadRequestException('La fecha inicial no puede ser posterior a la final.');
    return {
      ...(q.convocatoria_id ? { convocatoria_id: q.convocatoria_id } : {}),
      ...(q.docente_id ? { asignacion: { docente_id: q.docente_id } } : {}),
      ...(q.estado ? { estado: q.estado as 'programada' | 'realizada' | 'cancelada' } : {}),
      ...(q.desde || q.hasta ? { fecha: { ...(q.desde ? { gte: parseDate(q.desde) } : {}), ...(q.hasta ? { lte: parseDate(q.hasta) } : {}) } } : {}),
    };
  }

  async list(q: SesionesQueryDto) {
    const where = this.filters(q);
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.sesion.findMany({ where, include, orderBy: order(q.orden), take: q.limit, skip: (q.page - 1) * q.limit }),
        this.prisma.sesion.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items: items.map(viewSesion), pagination: pagination(q, total) };
    });
  }

  async listByEdition(convocatoria_id: number, q: EdicionSesionesQueryDto) {
    const where = this.filters({ ...q, convocatoria_id });
    return this.execute(async () => {
      const [edition, items, total] = await this.prisma.$transaction([
        this.prisma.convocatoria.findUnique({ where: { id: convocatoria_id }, select: { id: true } }),
        this.prisma.sesion.findMany({ where, include, orderBy: order(q.orden), take: q.limit, skip: (q.page - 1) * q.limit }),
        this.prisma.sesion.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      if (!edition) throw new NotFoundException('La edición no existe.');
      return { ok: true, items: items.map(viewSesion), pagination: pagination(q, total) };
    });
  }

  async detail(id: number) {
    return this.execute(async () => {
      const item = await this.prisma.sesion.findUnique({ where: { id }, include });
      if (!item) throw new NotFoundException('La sesión no existe.');
      return { ok: true, item: viewSesion(item) };
    });
  }

  // --- Escrituras -------------------------------------------------------------------------------------------------------

  async create(dto: CreateSesionDto, actor: number) {
    assertValidInterval(dto.hora_inicio, dto.hora_fin);
    return this.write(async tx => {
      const edition = await this.lockEdition(tx, dto.convocatoria_id);
      assertEditionAcceptsSessions(edition);
      const modalidad = dto.modalidad ?? edition.curso.modalidad;
      if (!modalidad) throw new UnprocessableEntityException('Indica la modalidad de la sesión: el curso no tiene una definida.');
      const lugar = dto.lugar || null, enlace = dto.enlace_url || null;
      assertModalityFits(modalidad, lugar, enlace);
      const asignacion_id = dto.docente_id ? await this.resolveTeacher(tx, dto.docente_id, edition.id) : null;
      await this.assertNoConflicts(tx, { convocatoria_id: edition.id, docente_id: dto.docente_id ?? null, fecha: dto.fecha, inicio: dto.hora_inicio, fin: dto.hora_fin });
      const created = await tx.sesion.create({ data: {
        convocatoria_id: edition.id, asignacion_id, titulo: dto.titulo, fecha: parseDate(dto.fecha), hora_inicio: parseTime(dto.hora_inicio), hora_fin: parseTime(dto.hora_fin),
        modalidad, lugar, enlace_url: enlace, observaciones: dto.observaciones || null,
      }, include });
      await recordSessionHistory(tx, { id: created.id, actor, operacion: 'creacion', revision: created.revision, nuevo: 'programada',
        campos: ['convocatoria_id', 'titulo', 'fecha', 'hora_inicio', 'hora_fin', 'modalidad', ...changedFieldNames({ asignacion_id: asignacion_id ?? undefined, lugar: lugar ?? undefined, enlace_url: enlace ?? undefined, observaciones: dto.observaciones || undefined })] });
      return { ok: true, item: viewSesion(created) };
    });
  }

  // Edición parcial con revisión. Cambiar fecha, horas o docente es reprogramar: exige motivo, se vuelve a comprobar al docente y los
  // solapamientos, y el historial registra la programación anterior y la nueva. Una realizada solo admite corregir título y
  // observaciones (con motivo); una cancelada no se modifica. Enviar valores iguales a los actuales no cambia nada.
  async update(id: number, dto: UpdateSesionDto, actor: number) {
    const { revision, motivo, ...fields } = dto;
    if (!changedFieldNames(fields).length) throw new BadRequestException('Indica al menos un campo para editar.');
    return this.write(async tx => {
      const initial = await tx.sesion.findUnique({ where: { id }, select: { convocatoria_id: true } });
      if (!initial) throw new NotFoundException('La sesión no existe.');
      const edition = await this.lockEdition(tx, initial.convocatoria_id);
      const before = await tx.sesion.findUniqueOrThrow({ where: { id }, include });
      if (before.revision !== revision) throw new ConflictException(STALE);
      if (before.estado === 'cancelada') throw new ConflictException('La sesión está cancelada y no se modifica. Para programar esa clase, crea una sesión nueva.');
      assertEditionAcceptsSessions(edition);

      const previous = { fecha: formatDate(before.fecha), inicio: formatTime(before.hora_inicio), fin: formatTime(before.hora_fin), docente: before.asignacion?.docente.id ?? null };
      const next = {
        titulo: fields.titulo ?? before.titulo, fecha: fields.fecha ?? previous.fecha, inicio: fields.hora_inicio ?? previous.inicio, fin: fields.hora_fin ?? previous.fin,
        modalidad: fields.modalidad ?? before.modalidad,
        lugar: fields.lugar === undefined ? before.lugar : fields.lugar || null,
        enlace: fields.enlace_url === undefined ? before.enlace_url : fields.enlace_url || null,
        observaciones: fields.observaciones === undefined ? before.observaciones : fields.observaciones || null,
        docente: fields.docente_id === undefined ? previous.docente : fields.docente_id,
      };
      const changed = [
        ...(next.titulo !== before.titulo ? ['titulo'] : []), ...(next.fecha !== previous.fecha ? ['fecha'] : []), ...(next.inicio !== previous.inicio ? ['hora_inicio'] : []),
        ...(next.fin !== previous.fin ? ['hora_fin'] : []), ...(next.modalidad !== before.modalidad ? ['modalidad'] : []), ...(next.lugar !== before.lugar ? ['lugar'] : []),
        ...(next.enlace !== before.enlace_url ? ['enlace_url'] : []), ...(next.observaciones !== before.observaciones ? ['observaciones'] : []),
        ...(next.docente !== previous.docente ? ['asignacion_id'] : []),
      ];
      if (!changed.length) return { ok: true, item: viewSesion(before) };
      if (before.estado === 'realizada') {
        const frozen = changed.filter(name => (FROZEN_FIELDS as readonly string[]).includes(name === 'asignacion_id' ? 'docente_id' : name));
        if (frozen.length) throw new ConflictException('Una sesión realizada no cambia su fecha, horario, docente ni modalidad. Si la marcaste por error, reábrela con su motivo.');
        requireReason(motivo, 'Indica el motivo: la sesión ya fue realizada.');
      }
      assertValidInterval(next.inicio, next.fin);
      assertModalityFits(next.modalidad, next.lugar, next.enlace);

      const rescheduled = changed.some(name => ['fecha', 'hora_inicio', 'hora_fin'].includes(name)), teacherChanged = changed.includes('asignacion_id');
      let asignacion_id = before.asignacion_id;
      if (rescheduled || teacherChanged) {
        requireReason(motivo, 'Indica el motivo de la reprogramación.');
        // Reprogramar o cambiar de docente es programar: el docente (el actual o el nuevo) debe estar activo y asignado a la edición.
        asignacion_id = next.docente ? await this.resolveTeacher(tx, next.docente, edition.id) : null;
        await this.assertNoConflicts(tx, { convocatoria_id: edition.id, docente_id: next.docente, fecha: next.fecha, inicio: next.inicio, fin: next.fin, exceptId: id });
      }

      const result = await tx.sesion.updateMany({ where: { id, revision }, data: {
        ...(changed.includes('titulo') ? { titulo: next.titulo } : {}), ...(changed.includes('fecha') ? { fecha: parseDate(next.fecha) } : {}),
        ...(changed.includes('hora_inicio') ? { hora_inicio: parseTime(next.inicio) } : {}), ...(changed.includes('hora_fin') ? { hora_fin: parseTime(next.fin) } : {}),
        ...(changed.includes('modalidad') ? { modalidad: next.modalidad } : {}), ...(changed.includes('lugar') ? { lugar: next.lugar } : {}),
        ...(changed.includes('enlace_url') ? { enlace_url: next.enlace } : {}), ...(changed.includes('observaciones') ? { observaciones: next.observaciones } : {}),
        ...(teacherChanged ? { asignacion_id } : {}), revision: { increment: 1 },
      } });
      if (!result.count) throw new ConflictException(STALE);
      const item = await tx.sesion.findUniqueOrThrow({ where: { id }, include });
      await recordSessionHistory(tx, { id, actor, operacion: rescheduled ? 'reprogramacion' : 'edicion', campos: changed, revision: item.revision, motivo,
        ...(rescheduled ? { anterior: slotLabel(previous.fecha, previous.inicio, previous.fin), nuevo: slotLabel(next.fecha, next.inicio, next.fin) } : {}) });
      return { ok: true, item: viewSesion(item) };
    });
  }

  // Cambio de estado (ver assertTransition). Cancelar se permite siempre, también en una edición archivada, para poder limpiar su
  // calendario; marcar como realizada exige que la hora de inicio (en Lima) ya haya llegado. Nada se borra.
  async changeState(id: number, dto: EstadoSesionDto, actor: number) {
    const { revision, estado: to, motivo } = dto;
    return this.write(async tx => {
      const initial = await tx.sesion.findUnique({ where: { id }, select: { convocatoria_id: true } });
      if (!initial) throw new NotFoundException('La sesión no existe.');
      const edition = await this.lockEdition(tx, initial.convocatoria_id);
      const before = await tx.sesion.findUniqueOrThrow({ where: { id }, include });
      if (before.revision !== revision) throw new ConflictException(STALE);
      assertTransition(before.estado, to);
      if (to !== 'cancelada') assertEditionAcceptsSessions(edition);
      if (transitionNeedsReason(to)) requireReason(motivo, to === 'cancelada' ? 'Indica el motivo de la cancelación.' : 'Indica el motivo para reabrir la sesión.');
      if (to === 'realizada' && !hasStarted(formatDate(before.fecha), formatTime(before.hora_inicio), this.clock())) {
        throw new ConflictException('La sesión aún no ha comenzado (hora de Lima): no puede marcarse como realizada.');
      }
      const result = await tx.sesion.updateMany({ where: { id, revision }, data: {
        estado: to, ...(to === 'cancelada' ? { cancelada_at: this.clock(), cancelacion_motivo: motivo } : {}), revision: { increment: 1 },
      } });
      if (!result.count) throw new ConflictException(STALE);
      const item = await tx.sesion.findUniqueOrThrow({ where: { id }, include });
      await recordSessionHistory(tx, { id, actor, operacion: 'cambio_estado', revision: item.revision, anterior: before.estado, nuevo: to, motivo,
        campos: to === 'cancelada' ? ['estado', 'cancelada_at', 'cancelacion_motivo'] : ['estado'] });
      return { ok: true, item: viewSesion(item) };
    });
  }
}
