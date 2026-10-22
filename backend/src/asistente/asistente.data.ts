import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { certificadosStats, preinscripcionesStats } from '../admin/stats/stats.academic';
import { messageJoin, messageState } from '../attention/message-state';
import { retentionCutoff } from '../chatbot/chatbot-privacy';
import { isAdminRole, type AdminRole } from '../permissions/roles';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated } from '../database/serialization';
import { formatDate } from '../sesiones/sesiones.time';
import type { DayWindow, WeekWindow } from './asistente.time';
import {
  HORAS_MENSAJE_ANTIGUO, type AperturasAgg, type ChatbotAgg, type CotizacionesAgg, type EdicionesAgg, type MatriculasAgg, type MensajesAgg, type SectionData, type SectionKey, type SesionesAgg,
} from './asistente.rules';

// Fuente de datos de HORUS Assistant. ÚNICO lugar donde el asistente toca la base: consultas fijas, parametrizadas y de solo lectura que
// devuelven CONTEOS. Ninguna selecciona nombres, correos, teléfonos, DNI ni texto libre, y ningún texto del modelo llega aquí.
export const ASISTENTE_DATA = 'ASISTENTE_DATA';
export interface AsistenteAccount { activo: boolean; rol: AdminRole | null }
export interface AsistenteDataSource {
  account(id: number): Promise<AsistenteAccount | null>; // rol VIGENTE de la base (nunca del token)
  read<K extends SectionKey>(section: K, window: DayWindow, now: Date): Promise<SectionData[K] | null>; // null = módulo no disponible (estructura desactualizada)
}

// Lectura adicional de las consultas conversacionales: sesiones de la semana (solo conteos por estado y por día; ni docentes ni cursos).
export const ASISTENTE_CONSULTA_DATA = 'ASISTENTE_CONSULTA_DATA';
export interface SesionesSemanaAgg {
  programadas: number; realizadas: number; canceladas: number;
  programadasPorDia: { fecha: string; cantidad: number }[]; // solo días con sesiones programadas, en orden
}
export interface ConsultaDataSource extends AsistenteDataSource {
  sesionesSemana(week: WeekWindow): Promise<SesionesSemanaAgg | null>; // null = módulo no disponible
}

const n = (value: unknown) => Number(value ?? 0);

@Injectable()
export class PrismaAsistenteData implements ConsultaDataSource {
  constructor(private readonly prisma: PrismaService) {}

  async account(id: number): Promise<AsistenteAccount | null> {
    const row = await this.prisma.adminUser.findUnique({ where: { id }, select: { activo: true, rol: true } });
    return row ? { activo: row.activo !== false, rol: isAdminRole(row.rol) ? row.rol : null } : null;
  }

  async read<K extends SectionKey>(section: K, window: DayWindow, now: Date): Promise<SectionData[K] | null> {
    try { return await (this.readers[section] as (w: DayWindow, d: Date) => Promise<SectionData[K]>)(window, now); }
    // Estructura de base desactualizada (migraciones pendientes): «no disponible», nunca ceros inventados. Otro error se propaga.
    catch (error) { if (isSchemaOutdated(error)) return null; throw error; }
  }

  // Misma regla que «sesiones» de hoy: DATE de Lima, ediciones no archivadas. Una sola consulta agrupada por día y estado.
  async sesionesSemana(week: WeekWindow): Promise<SesionesSemanaAgg | null> {
    try {
      const rows = await this.prisma.sesion.groupBy({
        by: ['fecha', 'estado'], where: { convocatoria: { archivado_at: null }, fecha: { gte: week.desdeDb, lte: week.hastaDb } }, _count: { _all: true },
      });
      const total = { programada: 0, realizada: 0, cancelada: 0 } as Record<string, number>;
      const perDay = new Map<string, number>();
      for (const row of rows) {
        total[row.estado] = (total[row.estado] ?? 0) + row._count._all;
        if (row.estado === 'programada') perDay.set(formatDate(row.fecha), (perDay.get(formatDate(row.fecha)) ?? 0) + row._count._all);
      }
      return {
        programadas: total.programada ?? 0, realizadas: total.realizada ?? 0, canceladas: total.cancelada ?? 0,
        programadasPorDia: [...perDay].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, cantidad]) => ({ fecha, cantidad })),
      };
    } catch (error) { if (isSchemaOutdated(error)) return null; throw error; }
  }

  private readonly readers: { [K in SectionKey]: (window: DayWindow, now: Date) => Promise<SectionData[K] | null> } = {
    atencion: (window, now) => this.mensajes(window, now),
    chatbot: (window, now) => this.chatbot(window, now),
    cotizaciones: window => this.cotizaciones(window),
    preinscripciones: () => preinscripcionesStats(this.prisma),
    aperturas: () => this.aperturas(),
    ediciones: window => this.ediciones(window),
    sesiones: window => this.sesiones(window),
    matriculas: () => this.matriculas(),
    certificados: () => certificadosStats(this.prisma),
  };

  // Una sola consulta agregada. «Consultas registradas» = filas de contactos; «personas únicas» = correos distintos (sin distinguir
  // mayúsculas ni espacios); «chatbot» = las registradas con origen «chatbot» (el visitante dejó sus datos). El estado administrativo sale
  // del seguimiento si existe (messageState), igual que el Resumen.
  private async mensajes(window: DayWindow, now: Date): Promise<MensajesAgg> {
    const stale = new Date(now.getTime() - HORAS_MENSAJE_ANTIGUO * 3_600_000);
    const open = Prisma.sql`${messageState} IN ('nuevo', 'en_proceso')`;
    const today = Prisma.sql`m.createdAt >= ${window.desdeUtc} AND m.createdAt < ${window.hastaUtc}`;
    const [row] = await this.prisma.$queryRaw<Record<string, bigint | number | null>[]>(Prisma.sql`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${messageState} = 'nuevo' THEN 1 ELSE 0 END) AS nuevos,
      SUM(CASE WHEN ${messageState} = 'en_proceso' THEN 1 ELSE 0 END) AS en_proceso,
      SUM(CASE WHEN ${open} AND m.createdAt < ${stale} THEN 1 ELSE 0 END) AS antiguos,
      COUNT(DISTINCT CASE WHEN ${open} THEN LOWER(TRIM(m.email)) END) AS personas_pendientes,
      SUM(CASE WHEN ${today} THEN 1 ELSE 0 END) AS hoy,
      COUNT(DISTINCT CASE WHEN ${today} THEN LOWER(TRIM(m.email)) END) AS personas_hoy,
      SUM(CASE WHEN ${today} AND m.origen = ${'chatbot'} THEN 1 ELSE 0 END) AS hoy_chatbot
      ${messageJoin}`);
    return {
      total: n(row?.total), nuevos: n(row?.nuevos), enProceso: n(row?.en_proceso), antiguos: n(row?.antiguos), personasPendientes: n(row?.personas_pendientes),
      recibidosHoy: n(row?.hoy), personasUnicasHoy: n(row?.personas_hoy), recibidosHoyChatbot: n(row?.hoy_chatbot),
    };
  }

  // Mensajes del chatbot = interacciones (preguntas del visitante). No guardan identidad: NO se pueden contar personas, y no se intenta.
  private async chatbot(window: DayWindow, now: Date): Promise<ChatbotAgg> {
    const today = { createdAt: { gte: window.desdeUtc, lt: window.hastaUtc } };
    const [interaccionesHoy, resueltasHoy, conIaHoy, preguntasSinRespuestaVigentes] = await Promise.all([
      this.prisma.chatbotInteraccion.count({ where: today }),
      this.prisma.chatbotInteraccion.count({ where: { ...today, resuelta: true } }),
      this.prisma.chatbotInteraccion.count({ where: { ...today, modo: 'ia' } }),
      this.prisma.chatbotPreguntaSinRespuesta.count({ where: { updatedAt: { gte: retentionCutoff(now) } } }),
    ]);
    return { interaccionesHoy, resueltasHoy, sinResolverHoy: interaccionesHoy - resueltasHoy, conIaHoy, preguntasSinRespuestaVigentes };
  }

  private async cotizaciones(window: DayWindow): Promise<CotizacionesAgg> {
    const [groups, vencidas] = await Promise.all([
      this.prisma.cotizacion.groupBy({ by: ['estado'], _count: { _all: true } }),
      // validez es un DATE: «vencida» = anterior al día de hoy en Lima.
      this.prisma.cotizacion.count({ where: { estado: 'enviada', validez: { lt: window.fechaDb } } }),
    ]);
    const porEstado: Record<string, number> = {};
    for (const group of groups) porEstado[group.estado] = (porEstado[group.estado] ?? 0) + group._count._all;
    return { porEstado, vencidas };
  }

  // Ediciones planificadas con mínimo de apertura cuyo número de preinscripciones validadas (validada + matriculada) ya lo alcanza.
  private async aperturas(): Promise<AperturasAgg> {
    const editions = await this.prisma.convocatoria.findMany({
      where: { estado: 'planificada', archivado_at: null, minimo_apertura: { not: null } }, select: { id: true, minimo_apertura: true }, take: 500,
    });
    if (!editions.length) return { listasParaApertura: 0 };
    const counts = await this.prisma.preinscripcion.groupBy({
      by: ['convocatoria_id'], where: { estado: { in: ['validada', 'matriculada'] }, convocatoria_id: { in: editions.map(edition => edition.id) } }, _count: { _all: true },
    });
    const byEdition = new Map(counts.map(row => [row.convocatoria_id, row._count._all]));
    return { listasParaApertura: editions.filter(edition => (byEdition.get(edition.id) ?? 0) >= (edition.minimo_apertura ?? Infinity)).length };
  }

  private async ediciones(window: DayWindow): Promise<EdicionesAgg> {
    const [abiertas, vencidas] = await Promise.all([
      this.prisma.convocatoria.count({ where: { estado: 'abierta', archivado_at: null } }),
      this.prisma.convocatoria.count({ where: { estado: 'planificada', archivado_at: null, fecha_inicio: { lte: window.fechaDb } } }),
    ]);
    return { abiertas, planificadasConInicioVencido: vencidas };
  }

  // fecha/hora de las sesiones son hora de pared de Lima (DATE/TIME): se comparan con el DATE de hoy en Lima, sin conversión de zona.
  private async sesiones(window: DayWindow): Promise<SesionesAgg> {
    const scope = { convocatoria: { archivado_at: null } };
    const [hoyProgramadas, hoyRealizadas, atrasadasSinCerrar] = await Promise.all([
      this.prisma.sesion.count({ where: { ...scope, fecha: window.fechaDb, estado: 'programada' } }),
      this.prisma.sesion.count({ where: { ...scope, fecha: window.fechaDb, estado: 'realizada' } }),
      this.prisma.sesion.count({ where: { ...scope, fecha: { lt: window.fechaDb }, estado: 'programada' } }),
    ]);
    return { hoyProgramadas, hoyRealizadas, atrasadasSinCerrar };
  }

  private async matriculas(): Promise<MatriculasAgg> {
    return { porConfirmarCumplimiento: await this.prisma.matricula.count({ where: { estado: 'activa', cumplimiento: 'pendiente', convocatoria: { estado: 'cerrada', archivado_at: null } } }) };
  }
}
