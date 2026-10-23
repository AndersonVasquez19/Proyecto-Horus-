import type { Permission } from '../permissions/permissions';
import { can, canAll } from '../permissions/policy';
import type { PreinscripcionesStats } from '../admin/stats/stats.academic';
import { HORAS_CONSULTA_ANTIGUA } from '../attention/attention-rules';

// Reglas DETERMINISTAS de HORUS Assistant: puras, sin base de datos ni NestJS ni IA. Cada pendiente nace de un conteo real y de una regla
// escrita aquí; el modelo de lenguaje (opcional) solo puede redactar lo que estas reglas ya decidieron.

export const HORAS_MENSAJE_ANTIGUO = HORAS_CONSULTA_ANTIGUA; // una sola fuente: el filtro `antiguas=si` del listado de consultas usa el mismo valor
export const MAX_PENDIENTES = 20; // tope de seguridad: con todas las reglas activas hay a lo sumo 12

export type SectionKey = 'atencion' | 'chatbot' | 'cotizaciones' | 'preinscripciones' | 'aperturas' | 'ediciones' | 'matriculas';

// Permisos que el servidor exige para CONSULTAR cada sección (todos). Sin ellos la sección no se consulta ni se menciona.
export const SECTION_PERMISSIONS: Readonly<Record<SectionKey, readonly Permission[]>> = Object.freeze({
  atencion: ['mensajes:leer'],
  chatbot: ['chatbot_consultas:leer'],
  cotizaciones: ['cotizaciones:leer'],
  preinscripciones: ['preinscripciones:leer'],
  aperturas: ['convocatorias:leer', 'preinscripciones:leer'],
  ediciones: ['convocatorias:leer'],
  matriculas: ['matriculas:leer'],
});

export const SECTION_KEYS = Object.keys(SECTION_PERMISSIONS) as SectionKey[];

// Tablas de origen de cada sección (para registrar de dónde sale cada dato).
export const SECTION_SOURCES: Readonly<Record<SectionKey, readonly string[]>> = Object.freeze({
  atencion: ['contactos', 'attention_records'],
  chatbot: ['chatbot_interacciones', 'chatbot_preguntas_sin_respuesta'],
  cotizaciones: ['cotizaciones'],
  preinscripciones: ['preinscripciones', 'convocatorias'],
  aperturas: ['convocatorias', 'preinscripciones'],
  ediciones: ['convocatorias'],
  matriculas: ['matriculas', 'convocatorias'],
});

export const authorizedSections = (role: unknown): SectionKey[] => SECTION_KEYS.filter(key => canAll(role, SECTION_PERMISSIONS[key]));

// ---- Agregados que entrega la fuente de datos (solo números: ningún nombre, correo, teléfono, DNI ni texto libre) ----

export interface MensajesAgg {
  total: number; nuevos: number; enProceso: number;
  antiguos: number;            // nuevos o en proceso con más de HORAS_MENSAJE_ANTIGUO horas
  personasPendientes: number;  // correos distintos entre los pendientes (nuevos + en proceso)
  recibidosHoy: number;        // consultas registradas hoy (filas de contactos)
  personasUnicasHoy: number;   // correos distintos entre las registradas hoy
  recibidosHoyChatbot: number; // las registradas hoy con origen «chatbot» (visitantes que dejaron sus datos)
}
export interface ChatbotAgg {
  interaccionesHoy: number; resueltasHoy: number; sinResolverHoy: number; conIaHoy: number;
  preguntasSinRespuestaVigentes: number;
}
export interface CotizacionesAgg { porEstado: Record<string, number>; vencidas: number }
export interface AperturasAgg { listasParaApertura: number }
export interface EdicionesAgg { abiertas: number; planificadasConInicioVencido: number }
export interface MatriculasAgg { porConfirmarCumplimiento: number }

export interface SectionData {
  atencion: MensajesAgg;
  chatbot: ChatbotAgg;
  cotizaciones: CotizacionesAgg;
  preinscripciones: PreinscripcionesStats;
  aperturas: AperturasAgg;
  ediciones: EdicionesAgg;
  matriculas: MatriculasAgg;
}

export type Severidad = 'alta' | 'media' | 'info';
export interface Pendiente {
  id: string; area: SectionKey; severidad: Severidad; titulo: string; cantidad: number; detalle: string;
  permiso: Permission;      // permiso que sirve para resolverlo
  puedeActuar: boolean;     // ¿la cuenta lo tiene? Si no, solo es informativo
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Rule = (data: any, role: unknown) => Omit<Pendiente, 'area' | 'puedeActuar'>[];
const item = (id: string, severidad: Severidad, titulo: string, cantidad: number, detalle: string, permiso: Permission) => ({ id, severidad, titulo, cantidad, detalle, permiso });

const RULES: { [K in SectionKey]: (data: SectionData[K]) => ReturnType<Rule> } = {
  atencion: d => [
    ...(d.antiguos > 0 ? [item('mensajes_antiguos', 'alta', `${plural(d.antiguos, 'mensaje sin cerrar', 'mensajes sin cerrar')} desde hace más de ${HORAS_MENSAJE_ANTIGUO} horas`, d.antiguos,
      'Mensajes en estado nuevo o en proceso cuya fecha de recepción supera el plazo.', 'mensajes:editar' as Permission)] : []),
    ...(d.nuevos > 0 ? [item('mensajes_nuevos', 'media', `${plural(d.nuevos, 'mensaje nuevo', 'mensajes nuevos')} sin atender`, d.nuevos,
      'Mensajes sin seguimiento iniciado.', 'seguimiento_mensajes:editar' as Permission)] : []),
    ...(d.enProceso > 0 ? [item('mensajes_en_proceso', 'info', `${plural(d.enProceso, 'mensaje en proceso', 'mensajes en proceso')}`, d.enProceso,
      'Con seguimiento iniciado y todavía sin cerrar.', 'seguimiento_mensajes:editar' as Permission)] : []),
  ],
  chatbot: d => d.sinResolverHoy > 0 ? [item('chatbot_sin_resolver', 'info', `${plural(d.sinResolverHoy, 'consulta', 'consultas')} del chatbot sin respuesta hoy`, d.sinResolverHoy,
    'Preguntas que el chatbot no pudo resolver con el contenido publicado. Revísalas en «Consultas del chatbot».', 'chatbot_consultas:leer' as Permission)] : [],
  cotizaciones: d => [
    ...(d.vencidas > 0 ? [item('cotizaciones_vencidas', 'alta', `${plural(d.vencidas, 'cotización enviada con validez vencida', 'cotizaciones enviadas con validez vencida')}`, d.vencidas,
      'Enviadas, sin respuesta registrada y con la fecha de validez ya pasada.', 'cotizaciones:editar' as Permission)] : []),
    ...((d.porEstado.enviada ?? 0) > 0 ? [item('cotizaciones_enviadas', 'media', `${plural(d.porEstado.enviada, 'cotización enviada', 'cotizaciones enviadas')} esperando respuesta`, d.porEstado.enviada,
      'Incluye las vencidas.', 'cotizaciones:editar' as Permission)] : []),
    ...((d.porEstado.borrador ?? 0) > 0 ? [item('cotizaciones_borrador', 'info', `${plural(d.porEstado.borrador, 'borrador', 'borradores')} de cotización sin enviar`, d.porEstado.borrador,
      'Cotizaciones creadas que todavía no se han enviado al cliente.', 'cotizaciones:enviar' as Permission)] : []),
  ],
  preinscripciones: d => [
    ...(d.pendientesRevision > 0 ? [item('preinscripciones_por_revisar', 'media', `${plural(d.pendientesRevision, 'preinscripción recibida', 'preinscripciones recibidas')} por revisar`, d.pendientesRevision,
      'Solicitudes sin validar de ediciones planificadas o abiertas.', 'preinscripciones:editar' as Permission)] : []),
    ...(d.validadas > 0 ? [item('preinscripciones_por_convertir', 'media', `${plural(d.validadas, 'preinscripción validada', 'preinscripciones validadas')} sin convertir en matrícula`, d.validadas,
      'Validadas que todavía no son matrícula.', 'preinscripciones:convertir' as Permission)] : []),
  ],
  aperturas: d => d.listasParaApertura > 0 ? [item('ediciones_listas_para_abrir', 'alta', `${plural(d.listasParaApertura, 'edición alcanzó', 'ediciones alcanzaron')} el mínimo de preinscritos validados`, d.listasParaApertura,
    'La apertura no es automática: la confirma Gerencia o Coordinación.', 'convocatorias:editar' as Permission)] : [],
  ediciones: d => d.planificadasConInicioVencido > 0 ? [item('ediciones_inicio_vencido', 'media', `${plural(d.planificadasConInicioVencido, 'edición planificada cuya', 'ediciones planificadas cuya')} fecha de inicio ya llegó`, d.planificadasConInicioVencido,
    'Siguen en estado planificada con fecha de inicio igual o anterior a hoy.', 'convocatorias:editar' as Permission)] : [],
  matriculas: d => d.porConfirmarCumplimiento > 0 ? [item('matriculas_por_confirmar', 'media', `${plural(d.porConfirmarCumplimiento, 'matrícula activa', 'matrículas activas')} de ediciones cerradas sin confirmar cumplimiento`, d.porConfirmarCumplimiento,
    'Requieren la confirmación administrativa de Gerencia o Coordinación.', 'matriculas:confirmar' as Permission)] : [],
};

const ORDER: Record<Severidad, number> = { alta: 0, media: 1, info: 2 };

// Pendientes de las secciones realmente consultadas. Ordenados por severidad (estable) y acotados a `max`.
export function buildPendientes(data: Partial<SectionData>, role: unknown, max = MAX_PENDIENTES): { items: Pendiente[]; truncated: boolean } {
  const all: Pendiente[] = [];
  for (const key of SECTION_KEYS) {
    const section = data[key];
    if (section === undefined || section === null) continue;
    for (const entry of (RULES[key] as (d: unknown) => ReturnType<Rule>)(section)) all.push({ ...entry, area: key, puedeActuar: can(role, entry.permiso) });
  }
  const sorted = all.map((value, index) => ({ value, index })).sort((a, b) => ORDER[a.value.severidad] - ORDER[b.value.severidad] || a.index - b.index).map(entry => entry.value);
  return { items: sorted.slice(0, max), truncated: sorted.length > max };
}

// Texto del resumen SIN IA: siempre disponible, redactado con las mismas cifras.
export function basicText(fecha: string, pendientes: Pendiente[], truncated: boolean): string {
  if (!pendientes.length) return `Hoy (${fecha}, hora de Lima) no hay pendientes en las áreas a las que tu cuenta tiene acceso.`;
  const high = pendientes.filter(p => p.severidad === 'alta').length;
  const head = `Hoy (${fecha}, hora de Lima) tienes ${plural(pendientes.length, 'punto', 'puntos')} para revisar${truncated ? ' (se muestran los más importantes)' : ''}`
    + (high ? `, ${high === 1 ? '1 de ellos urgente' : `${high} de ellos urgentes`}.` : '.');
  return [head, ...pendientes.map(p => `• ${p.titulo}.`)].join('\n');
}
