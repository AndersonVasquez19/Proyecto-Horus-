// Cálculos puros del Resumen (sin React ni red: los cargan también las pruebas de Node). Todo sale de datos que entrega la API; cuando
// un dato falta o no es coherente, el resultado es null («No disponible»): nunca un cero ni una cifra inventada.
import type { OperationalStats, PreregistrationStats } from './operationalStats';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

// Porcentaje con un decimal. null si no hay base para calcularlo (total 0): no se muestra «0 %» donde no hay datos.
export function percentOf(part: number, total: number): number | null {
  if (!count(part) || !count(total) || total === 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

// Texto «12,5 %» (es-PE); «—» cuando no hay base de cálculo.
export const formatPercent = (value: number | null) => value === null ? '—' : value.toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' %';

// --- Preinscripciones por estado -------------------------------------------------------------------------------------------------
// Los estados son excluyentes y NO forman un embudo acumulativo: validada puede pasar a descartada o desistida (ver las transiciones de
// backend/src/preinscripciones/preinscripciones.rules.ts), de modo que quien hoy figura como descartada pudo haber sido validada. Por eso
// se presenta una distribución por estado actual y no una tasa de conversión.
export type PreregistrationSegment = { key: 'recibidas' | 'validadas' | 'convertidas' | 'descartadas' | 'desistidas'; label: string; hint: string; value: number; percent: number | null };

const SEGMENTS: readonly Pick<PreregistrationSegment, 'key' | 'label' | 'hint'>[] = [
  { key: 'recibidas', label: 'Recibidas', hint: 'Solicitudes sin revisar' },
  { key: 'validadas', label: 'Validadas', hint: 'Aprobadas, aún sin matrícula' },
  { key: 'convertidas', label: 'Convertidas', hint: 'Ya pasaron a matrícula' },
  { key: 'descartadas', label: 'Descartadas', hint: 'Rechazadas por la administración' },
  { key: 'desistidas', label: 'Desistidas', hint: 'La persona desistió' },
];

export function preregistrationSegments(stats: PreregistrationStats): PreregistrationSegment[] {
  return SEGMENTS.map(segment => ({ ...segment, value: stats[segment.key], percent: percentOf(stats[segment.key], stats.total) }));
}

// --- Origen de las consultas ------------------------------------------------------------------------------------------------------
// `stats/actividad` cuenta por día TODAS las consultas (contactos) y, dentro de ellas, las que tienen origen «chatbot». El resto
// (total − chatbot) es todo lo que no llegó por el chatbot: formulario web y registro manual. Es una partición completa de las consultas
// del periodo; no mide visitas al sitio ni conversaciones del chatbot que no dejaron datos de contacto.
export type ChannelSplitData = { total: number; chatbot: number; otros: number; chatbotPercent: number | null; otrosPercent: number | null };

export function channelSplit(series: readonly { total: number; chatbot: number }[]): ChannelSplitData | null {
  let total = 0, chatbot = 0;
  for (const day of series) {
    // Un día con más mensajes del chatbot que mensajes totales contradice el contrato: no se afirma ninguna distribución.
    if (!day || !count(day.total) || !count(day.chatbot) || day.chatbot > day.total) return null;
    total += day.total; chatbot += day.chatbot;
  }
  const otros = total - chatbot;
  return { total, chatbot, otros, chatbotPercent: percentOf(chatbot, total), otrosPercent: percentOf(otros, total) };
}

// --- Chatbot ----------------------------------------------------------------------------------------------------------------------
// Bloque `metrics` de GET /admin/chatbot/sin-respuesta (backend/src/admin/chatbot/admin-chatbot.service.ts): agregados de las últimas
// `dias` jornadas que no dependen de `page`, `limit` ni `search`. «Resuelta» significa que el asistente encontró información publicada
// con la que responder; no mide la satisfacción de la persona ni sustituye la atención del equipo.
export type ChatbotMetrics = { dias: number; interacciones: number; resueltas: number; sinRespuesta: number; conIa: number; conCatalogo: number };

export function parseChatbotMetrics(data: unknown): ChatbotMetrics | null {
  if (!object(data) || !object(data.metrics)) return null;
  const m = data.metrics;
  if (!(['dias', 'interacciones', 'resueltas', 'sinRespuesta', 'conIa', 'conCatalogo'] as const).every(key => count(m[key])) || (m.dias as number) < 1) return null;
  const metrics = m as unknown as ChatbotMetrics;
  // Cada interacción está resuelta o no; y cada modo es un subconjunto de las interacciones.
  if (metrics.resueltas + metrics.sinRespuesta !== metrics.interacciones) return null;
  if (metrics.conIa + metrics.conCatalogo > metrics.interacciones) return null;
  const { dias, interacciones, resueltas, sinRespuesta, conIa, conCatalogo } = metrics;
  return { dias, interacciones, resueltas, sinRespuesta, conIa, conCatalogo };
}

// Porcentaje de interacciones con respuesta; null si no hubo interacciones (no hay base).
export const chatbotResolvedPercent = (metrics: ChatbotMetrics) => percentOf(metrics.resueltas, metrics.interacciones);

// --- Cotizaciones por estado ------------------------------------------------------------------------------------------------------
export const QUOTE_STATES: readonly (readonly [string, string])[] = [['borrador', 'Borrador'], ['enviada', 'Enviada'], ['aceptada', 'Aceptada'], ['rechazada', 'Rechazada'], ['anulada', 'Anulada']];

// «Abiertas» = borrador o enviada (mismo criterio que los reportes comerciales).
export function quoteSummary(porEstado: Record<string, number>) {
  const value = (key: string) => (count(porEstado[key]) ? porEstado[key] : 0);
  const total = QUOTE_STATES.reduce((sum, [key]) => sum + value(key), 0);
  return { total, abiertas: value('borrador') + value('enviada') };
}

// --- Indicadores (KPI) ------------------------------------------------------------------------------------------------------------
export type KpiTone = 'blue' | 'teal' | 'gold' | 'purple';
export type KpiDefinition = {
  key: string; title: string;
  value: number | null | undefined; // undefined: sin datos aún / error; null: el módulo no está disponible
  sub: string; icon: string; tone: KpiTone; section: string; action: string;
};

export function overviewKpis(data: OperationalStats | null, preregistrations: PreregistrationStats | null): KpiDefinition[] {
  const academic = data?.stats.academico, messages = data?.stats.mensajes;
  return [
    { key: 'estudiantes', title: 'Total de estudiantes', value: academic?.estudiantes, sub: 'Incluye estudiantes archivados', icon: 'user', tone: 'blue', section: 'estudiantes', action: 'Ver estudiantes' },
    { key: 'ediciones', title: 'Ediciones abiertas', value: academic?.edicionesActivas, sub: 'Abiertas y sin archivar', icon: 'calendar', tone: 'teal', section: 'ediciones', action: 'Ver ediciones' },
    { key: 'matriculas', title: 'Matrículas registradas', value: academic?.matriculasRegistradas, sub: 'Activas y anuladas', icon: 'book', tone: 'blue', section: 'matriculas', action: 'Ver matrículas' },
    { key: 'vigentes', title: 'Matrículas vigentes', value: academic?.matriculasVigentes, sub: 'Con estado activa', icon: 'check', tone: 'teal', section: 'matriculas', action: 'Ver matrículas' },
    // Sin datos de preinscripciones (backend anterior, módulo sin migrar o bloque incoherente) la tarjeta dice «No disponible»; no muestra cero.
    { key: 'preinscripciones', title: 'Preinscripciones por revisar', value: !data ? undefined : preregistrations ? preregistrations.pendientesRevision : null,
      sub: preregistrations ? preregistrations.total + ' en total · ' + preregistrations.validadas + ' validadas' : data ? 'No disponible' : 'Solicitudes recibidas sin revisar',
      icon: 'user-plus', tone: 'purple', section: 'preinscripciones', action: 'Ver preinscripciones' },
    { key: 'consultas', title: 'Consultas pendientes', value: messages?.pendientes, sub: 'Nuevas y en proceso', icon: 'mail', tone: 'gold', section: 'mensajes', action: 'Ver consultas' },
  ];
}
