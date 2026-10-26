// «Mi Día» (Fase 4C-B). Módulo puro, sin React ni red (lo cargan también las pruebas de Node). Interpreta la respuesta de
// GET /api/admin/asistente/resumen (backend/src/asistente/asistente.service.ts) y decide qué se puede mostrar.
//
// Reglas:
//  - Solo conteos. Este módulo copia únicamente los campos que «Mi Día» muestra; nunca nombres, correos, teléfonos ni DNI (el servidor
//    tampoco los envía) y deja fuera, a propósito, las «personas únicas» de `indicadores_atencion`.
//  - Una respuesta con otra forma no se muestra a medias: `parseMyDay` devuelve null y la pantalla informa «formato inesperado».
//  - Un área que falla o no está disponible se muestra como tal («—»), nunca como cero.
//  - Defensa en profundidad: además de `acceso.secciones_autorizadas` (lo que el servidor consultó con el rol vigente), cada área exige
//    que la sesión tenga sus permisos de lectura. Si los permisos se retiraron después, el área deja de mostrarse aunque la respuesta
//    anterior la traiga. La autorización real sigue siendo del backend.

export const MY_DAY_AREAS = ['atencion', 'chatbot', 'cotizaciones', 'preinscripciones', 'aperturas', 'ediciones', 'matriculas'] as const;
export type MyDayArea = (typeof MY_DAY_AREAS)[number];

// Mismos permisos que SECTION_PERMISSIONS (backend/src/asistente/asistente.rules.ts): test:my-day los contrasta.
export const AREA_READ: Readonly<Record<MyDayArea, readonly string[]>> = Object.freeze({
  atencion: ['mensajes:leer'],
  chatbot: ['chatbot_consultas:leer'],
  cotizaciones: ['cotizaciones:leer'],
  preinscripciones: ['preinscripciones:leer'],
  aperturas: ['convocatorias:leer', 'preinscripciones:leer'],
  ediciones: ['convocatorias:leer'],
  matriculas: ['matriculas:leer'],
});

// Sección del panel donde se resuelve cada área y su dirección general (sin filtros que el destino no interprete). `description` resume lo que el
// servidor cuenta en esa área (consultas fijas de asistente.data.ts y reglas de asistente.rules.ts; test:my-day contrasta los datos clave).
// «Apertura de ediciones» e «Inicio de ediciones» son áreas distintas del backend (`aperturas` y `ediciones`) aunque ambas se resuelven en Ediciones.
export const AREA_INFO: Readonly<Record<MyDayArea, { title: string; description: string; section: string; href: string; destination: string }>> = Object.freeze({
  atencion: { title: 'Consultas', description: 'Consultas nuevas y en proceso, y las que superan 48 horas sin cerrar.', section: 'mensajes', href: '/admin/messages', destination: 'Mensajes' },
  chatbot: { title: 'Chatbot', description: 'Preguntas del chatbot público que hoy no se pudieron responder con el contenido publicado.', section: 'chatbot', href: '/admin/dashboard?section=chatbot', destination: 'Consultas del chatbot' },
  cotizaciones: { title: 'Cotizaciones', description: 'Enviadas con la validez vencida, enviadas que esperan respuesta y borradores que aún no se envían al cliente.', section: 'cotizaciones', href: '/admin/dashboard?section=cotizaciones', destination: 'Cotizaciones' },
  preinscripciones: { title: 'Preinscripciones', description: 'Recibidas por revisar en ediciones planificadas o abiertas, y validadas que todavía no son matrícula.', section: 'preinscripciones', href: '/admin/dashboard?section=preinscripciones', destination: 'Preinscripciones' },
  aperturas: { title: 'Apertura de ediciones', description: 'Ediciones planificadas que ya alcanzaron su mínimo de preinscripciones validadas. La apertura no es automática.', section: 'ediciones', href: '/admin/dashboard?section=ediciones', destination: 'Ediciones' },
  ediciones: { title: 'Inicio de ediciones', description: 'Ediciones que siguen planificadas aunque su fecha de inicio ya llegó (día de Lima).', section: 'ediciones', href: '/admin/dashboard?section=ediciones', destination: 'Ediciones' },
  matriculas: { title: 'Matrículas', description: 'Matrículas activas de ediciones cerradas que esperan la confirmación de cumplimiento.', section: 'matriculas', href: '/admin/dashboard?section=matriculas', destination: 'Matrículas' },
});

// Pendientes cuyo destino admite hoy un filtro propio (MessageInbox lee ?estado=). Los demás llevan a la dirección general del área.
const PENDING_LINKS: Readonly<Record<string, string>> = Object.freeze({
  mensajes_nuevos: '/admin/messages?estado=nuevo',
  mensajes_en_proceso: '/admin/messages?estado=en_proceso',
});

export type Severity = 'alta' | 'media' | 'info';
export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = Object.freeze({ alta: 'Prioridad alta', media: 'Prioridad media', info: 'Seguimiento' });

export interface MyDayPending {
  id: string; area: MyDayArea; severidad: Severity; titulo: string; cantidad: number; detalle: string;
  permiso: string;       // permiso que sirve para resolverlo
  puedeActuar: boolean;  // calculado por el servidor con el rol vigente
}
export type AreaStatus = { estado: 'ok' } | { estado: 'no_disponible' | 'error'; motivo: string };

export interface MyDaySummary {
  generadoEn: string;
  fechaOperativa: string; // AAAA-MM-DD, día de Lima
  zona: string;
  areas: MyDayArea[];     // autorizadas por el servidor (conocidas por este panel), en el orden de MY_DAY_AREAS
  estados: Record<MyDayArea, AreaStatus>;
  pendientes: MyDayPending[];
  truncados: boolean;
  atencion: { hoy: number; pendientes: number } | null;
  chatbot: { mensajesHoy: number } | null;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isArea = (value: unknown): value is MyDayArea => typeof value === 'string' && (MY_DAY_AREAS as readonly string[]).includes(value);
const SEVERITIES: readonly string[] = ['alta', 'media', 'info'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(value: unknown): value is string {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function readStatus(value: unknown): AreaStatus | null {
  if (!object(value)) return null;
  if (value.estado === 'ok') return { estado: 'ok' };
  if ((value.estado === 'no_disponible' || value.estado === 'error') && text(value.motivo, 300)) return { estado: value.estado, motivo: value.motivo };
  return null;
}

// Interpreta la respuesta. null = formato inesperado (no se muestra nada de ella).
export function parseMyDay(value: unknown): MyDaySummary | null {
  if (!object(value) || value.ok !== true) return null;
  if (!validDate(value.fecha_operativa) || !text(value.zona_horaria, 64)) return null;
  if (typeof value.generado_en !== 'string' || !Number.isFinite(Date.parse(value.generado_en))) return null;
  if (!object(value.acceso) || !Array.isArray(value.acceso.secciones_autorizadas)) return null;
  const authorized = value.acceso.secciones_autorizadas;
  if (!authorized.every(key => typeof key === 'string') || new Set(authorized).size !== authorized.length) return null;
  // Un área que este panel no conoce (backend más nuevo) se ignora junto con sus pendientes: no sabríamos qué permiso exige.
  const areas = MY_DAY_AREAS.filter(area => authorized.includes(area));
  if (!object(value.secciones) || !object(value.resumen) || typeof value.resumen.pendientes_truncados !== 'boolean') return null;
  const estados = {} as Record<MyDayArea, AreaStatus>;
  for (const area of areas) {
    const status = readStatus(value.secciones[area]);
    if (!status) return null;
    estados[area] = status;
  }
  if (!Array.isArray(value.pendientes)) return null;
  const pendientes: MyDayPending[] = [];
  for (const row of value.pendientes) {
    if (!object(row) || typeof row.area !== 'string') return null;
    if (!isArea(row.area)) continue;
    // Un pendiente de un área no autorizada o que no se consultó bien indica una respuesta incoherente: no se confía en ninguna parte.
    if (!areas.includes(row.area) || estados[row.area].estado !== 'ok') return null;
    if (!text(row.id, 80) || !SEVERITIES.includes(row.severidad as string) || !text(row.titulo, 300) || !count(row.cantidad)
      || !text(row.detalle, 500) || !text(row.permiso, 80) || typeof row.puedeActuar !== 'boolean') return null;
    pendientes.push({ id: row.id, area: row.area, severidad: row.severidad as Severity, titulo: row.titulo, cantidad: row.cantidad, detalle: row.detalle, permiso: row.permiso, puedeActuar: row.puedeActuar });
  }
  const indicators = object(value.indicadores_atencion) ? value.indicadores_atencion : null;
  const registered = indicators && object(indicators.consultas_registradas) ? indicators.consultas_registradas : null;
  const bot = indicators && object(indicators.chatbot) ? indicators.chatbot : null;
  return {
    generadoEn: value.generado_en, fechaOperativa: value.fecha_operativa, zona: value.zona_horaria,
    areas, estados, pendientes, truncados: value.resumen.pendientes_truncados,
    atencion: registered && count(registered.hoy) && count(registered.pendientes) ? { hoy: registered.hoy, pendientes: registered.pendientes } : null,
    chatbot: bot && count(bot.mensajes_hoy) ? { mensajesHoy: bot.mensajes_hoy } : null,
  };
}

export interface MyDayView {
  areas: MyDayArea[];
  pendientes: (MyDayPending & { accionable: boolean })[];
  atencion: MyDaySummary['atencion'];
  chatbot: MyDaySummary['chatbot'];
}

// Lo que la sesión actual puede ver de un resumen ya validado. `can` es el de la navegación del panel (permisos de la sesión).
export function visibleMyDay(summary: MyDaySummary, can: (permission: string) => boolean): MyDayView {
  const areas = summary.areas.filter(area => AREA_READ[area].every(permission => can(permission)));
  return {
    areas,
    // Accionable solo si el servidor lo indica Y la sesión conserva el permiso para resolverlo.
    pendientes: summary.pendientes.filter(item => areas.includes(item.area)).map(item => ({ ...item, accionable: item.puedeActuar && can(item.permiso) })),
    atencion: areas.includes('atencion') ? summary.atencion : null,
    chatbot: areas.includes('chatbot') ? summary.chatbot : null,
  };
}

export const pendingLink = (item: Pick<MyDayPending, 'id' | 'area'>) => PENDING_LINKS[item.id] ?? AREA_INFO[item.area].href;

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
export function queueSummary(view: Pick<MyDayView, 'pendientes'>): string {
  const total = view.pendientes.length, high = view.pendientes.filter(item => item.severidad === 'alta').length;
  if (!total) return 'Nada por revisar en tus áreas.';
  return plural(total, 'punto', 'puntos') + ' para revisar' + (high ? ', ' + plural(high, 'de prioridad alta', 'de prioridad alta') : '') + '.';
}

// «Domingo, 25 de octubre de 2026». El día ya viene calculado en Lima: se formatea en UTC para no desplazarlo.
export function formatOperatingDate(fecha: string): string {
  const match = DATE.exec(fecha);
  if (!match) return fecha;
  const label = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    .toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const formatLimaTime = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
