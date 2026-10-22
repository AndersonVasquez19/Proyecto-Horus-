// Reglas puras del proceso de atención de consultas (sin base de datos ni NestJS). Todo se deriva de columnas que ya existen
// (`attention_records.estado/responsable/notas/respuesta/historial`, `contactos.estado`, `cotizaciones.estado`): no hay migración.
//
// Recorrido real de una consulta (cada paso corresponde a algo que el sistema SÍ registra):
//   nuevo         consulta recibida, nadie la ha revisado.
//   en_proceso    revisada o asignada (`responsable`) y en seguimiento; aquí se anotan las gestiones y se prepara la respuesta.
//   atendido      cerrada: hay respuesta guardada o una nota que explica cómo se atendió.
//   archivado     fuera del trabajo diario; se puede reabrir.
// «Intento de comunicación» y «respuesta enviada» NO son estados: son entradas del `historial` con su propio resultado (iniciado, aceptado,
// fallido, incierto). «Aceptado» significa que el proveedor de correo aceptó el mensaje; no prueba que el cliente lo haya recibido ni leído.

export const MESSAGE_STATES = ['nuevo', 'en_proceso', 'atendido', 'archivado'] as const;

// Horas a partir de las cuales una consulta sin cerrar se considera «antigua». Es el mismo valor que usa HORUS Assistant
// (asistente.rules.ts lo reexporta): el filtro del listado y el conteo del asistente no pueden discrepar.
export const HORAS_CONSULTA_ANTIGUA = 48;

// Estados a los que se puede pasar DESDE cada estado (sin contar quedarse en el mismo, que siempre se permite para anotar notas o respuesta).
// Una consulta que ya fue revisada no vuelve a «nuevo»: «nuevo» significa «nadie la ha visto». Reabrir un caso cerrado lo deja «en_proceso».
export const MESSAGE_TRANSITIONS: Readonly<Record<(typeof MESSAGE_STATES)[number], readonly string[]>> = Object.freeze({
  nuevo: ['en_proceso', 'atendido', 'archivado'],
  en_proceso: ['atendido', 'archivado'],
  atendido: ['en_proceso', 'archivado'],
  archivado: ['en_proceso', 'atendido'],
});

const isKnown = (state: string): state is (typeof MESSAGE_STATES)[number] => (MESSAGE_STATES as readonly string[]).includes(state);

// Un estado histórico desconocido (datos anteriores) no bloquea al administrador: puede pasar a cualquiera de los cuatro estados actuales.
export function allowedTransitions(from: string): string[] {
  return isKnown(from) ? [...MESSAGE_TRANSITIONS[from]] : MESSAGE_STATES.filter(state => state !== from);
}

export const TRANSITION_MESSAGE = (from: string, to: string) => 'Una consulta en «' + from + '» no puede pasar a «' + to + '». Estados permitidos desde aquí: ' + allowedTransitions(from).join(', ') + '.';
export const CLOSE_WITHOUT_EVIDENCE = 'Para marcar la consulta como atendida registra la respuesta o una nota que indique cómo se atendió.';
export const ARCHIVE_WITH_OPEN_QUOTES = 'La consulta tiene cotizaciones abiertas (en borrador o enviadas y vigentes). Resuélvelas o anúlalas antes de archivarla.';
export const SEND_ON_ARCHIVED = 'La consulta está archivada. Reábrela antes de enviar una respuesta.';

// Devuelve el motivo del rechazo, o null si el cambio es válido. Un guardado que no cambia el estado nunca se rechaza por estas reglas
// (así se pueden editar notas, responsable o respuesta, y los datos anteriores no quedan atrapados).
export function checkMessageChange(input: { from: string; to: string; respuesta: string; notas: string }): string | null {
  const { from, to } = input;
  if (from === to) return null;
  if (!allowedTransitions(from).includes(to)) return TRANSITION_MESSAGE(from, to);
  if (to === 'atendido' && !input.respuesta.trim() && !input.notas.trim()) return CLOSE_WITHOUT_EVIDENCE;
  return null;
}

type Tracked = { responsable: string; notas: string; respuesta: string };
// Nombres de los campos que cambian (nunca sus valores: el historial no guarda copias de datos ni de textos privados).
export function changedFields(previous: Tracked | null, next: Tracked): string[] {
  return (['responsable', 'notas', 'respuesta'] as const).filter(field => (previous?.[field] ?? '') !== next[field]);
}

export const QUOTE_STATES_SUMMARY = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada'] as const;
export interface QuotesSummary { total: number; abiertas: number; por_estado: Record<(typeof QUOTE_STATES_SUMMARY)[number], number> }

// Resumen (solo conteos) de las cotizaciones vinculadas a una consulta. «Abiertas» = borrador o enviada: todavía requieren una decisión.
export function summarizeQuotes(groups: ReadonlyArray<{ estado: string; _count: { _all: number } }>): QuotesSummary {
  const por_estado = { borrador: 0, enviada: 0, aceptada: 0, rechazada: 0, anulada: 0 };
  for (const group of groups) if (group.estado in por_estado) por_estado[group.estado as keyof typeof por_estado] += group._count._all;
  return { total: Object.values(por_estado).reduce((sum, value) => sum + value, 0), abiertas: por_estado.borrador + por_estado.enviada, por_estado };
}
