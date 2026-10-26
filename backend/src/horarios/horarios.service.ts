import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { formatTime, parseTime, ZONA_HORARIA } from '../common/lima-time';
import type { ReemplazoHorariosDto } from './horarios.dto';
import {
  assertScheduleEditable, byDayAndTime, countLabel, diaNombre, diffTramos, isScheduleEditable, STALE, translateDatabaseError, validateTramos, type TramoGuardado,
} from './horarios.rules';

type EditionRow = { id: number; nombre: string; estado: string; archivado_at: Date | null; revision: number };
type HorarioRow = { id: number; dia_semana: number; hora_inicio: Date; hora_fin: Date };

const editionSelect = { id: true, nombre: true, estado: true, archivado_at: true, revision: true } as const;
const horarioSelect = { id: true, dia_semana: true, hora_inicio: true, hora_fin: true } as const;
const tramo = (row: HorarioRow): TramoGuardado => ({ id: row.id, dia_semana: row.dia_semana, hora_inicio: formatTime(row.hora_inicio), hora_fin: formatTime(row.hora_fin) });

// Contrato de lectura y de reemplazo (docs/procedimientos/horarios-ediciones.md). `convocatoria.revision` es la que el cliente debe enviar
// en el siguiente PUT; `modificable` indica si la edición admite cambios de horario (no archivada ni cancelada).
export function viewHorarios(edition: EditionRow, rows: HorarioRow[]) {
  return {
    ok: true as const,
    convocatoria: { id: edition.id, nombre: edition.nombre, estado: edition.estado, archivada: !!edition.archivado_at, revision: edition.revision, modificable: isScheduleEditable(edition) },
    zona_horaria: ZONA_HORARIA,
    items: rows.map(tramo).sort(byDayAndTime).map(t => ({ id: t.id, dia_semana: t.dia_semana, dia: diaNombre(t.dia_semana), hora_inicio: t.hora_inicio, hora_fin: t.hora_fin })),
  };
}

@Injectable()
export class HorariosService {
  constructor(private readonly prisma: PrismaService) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) { return translateDatabaseError(error); }
  }

  // Lectura consistente (una instantánea REPEATABLE READ): la edición y sus horarios de un mismo momento. 404 si la edición no existe.
  async list(convocatoria_id: number) {
    return this.execute(async () => {
      const [edition, rows] = await this.prisma.$transaction([
        this.prisma.convocatoria.findUnique({ where: { id: convocatoria_id }, select: editionSelect }),
        this.prisma.convocatoriaHorario.findMany({ where: { convocatoria_id }, select: horarioSelect }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      if (!edition) throw new NotFoundException('La edición no existe.');
      return viewHorarios(edition, rows);
    });
  }

  // Reemplazo atómico del conjunto completo. Todo ocurre en UNA transacción READ COMMITTED con el orden de bloqueo común a Ediciones,
  // Matrículas y Preinscripciones (curso → edición), así que dos reemplazos simultáneos, o un reemplazo y una edición/cierre/archivo de la
  // misma edición, se serializan: el segundo espera y, como la revisión ya cambió, recibe 409 sin escribir nada. Dentro solo se usa `tx`.
  // Si cualquier paso falla (validación, revisión, base de datos), no se aplica ningún cambio: ni horarios, ni revisión, ni historial.
  async replace(convocatoria_id: number, dto: ReemplazoHorariosDto, actor: number) {
    const next = validateTramos(dto.horarios.map(h => ({ dia_semana: h.dia_semana, hora_inicio: h.hora_inicio, hora_fin: h.hora_fin })));
    return this.execute(() => this.prisma.$transaction(async tx => {
      const initial = await tx.convocatoria.findUnique({ where: { id: convocatoria_id }, select: { curso_id: true } });
      if (!initial) throw new NotFoundException('La edición no existe.');
      await tx.$queryRaw`SELECT id FROM cursos WHERE id = ${initial.curso_id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM convocatorias WHERE id = ${convocatoria_id} FOR UPDATE`;
      const before = await tx.convocatoria.findUniqueOrThrow({ where: { id: convocatoria_id }, select: editionSelect });
      if (before.revision !== dto.revision) throw new ConflictException(STALE);
      assertScheduleEditable(before);

      const currentRows = await tx.convocatoriaHorario.findMany({ where: { convocatoria_id }, select: horarioSelect });
      const { remove, add, unchanged } = diffTramos(currentRows.map(tramo), next);
      // Idempotente: reenviar el mismo conjunto no cambia la revisión ni deja historial.
      if (unchanged) return { ...viewHorarios(before, currentRows), cambios: false };

      // Primero se retiran los tramos que ya no figuran: así un tramo que conserva día e inicio pero cambia el fin no choca con el UNIQUE.
      if (remove.length) await tx.convocatoriaHorario.deleteMany({ where: { convocatoria_id, id: { in: remove } } });
      if (add.length) await tx.convocatoriaHorario.createMany({ data: add.map(t => ({ convocatoria_id, dia_semana: t.dia_semana, hora_inicio: parseTime(t.hora_inicio), hora_fin: parseTime(t.hora_fin) })) });
      const bumped = await tx.convocatoria.updateMany({ where: { id: convocatoria_id, revision: dto.revision }, data: { revision: { increment: 1 } } });
      if (!bumped.count) throw new ConflictException(STALE);

      const edition = await tx.convocatoria.findUniqueOrThrow({ where: { id: convocatoria_id }, select: editionSelect });
      const rows = await tx.convocatoriaHorario.findMany({ where: { convocatoria_id }, select: horarioSelect });
      const account = await tx.adminUser.findUnique({ where: { id: actor }, select: { rol: true } });
      // Historial académico de la edición, en la misma transacción: quién, cuándo, la revisión resultante y cuántos tramos había y hay.
      // Solo nombres de campos y recuentos, nunca datos personales.
      await tx.academicoHistorial.create({ data: {
        entidad: 'convocatoria', entidad_id: convocatoria_id, origen: 'panel', actor_id: actor, actor_rol: account?.rol, operacion: 'edicion',
        campos: ['horarios'], revision: edition.revision, estado_anterior: countLabel(currentRows.length), estado_nuevo: countLabel(rows.length),
      } });
      return { ...viewHorarios(edition, rows), cambios: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 20000 }));
  }
}
