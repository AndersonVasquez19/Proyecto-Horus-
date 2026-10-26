// Horarios recurrentes de una edición (GET/PUT /admin/convocatorias/:id/horarios). Módulo puro, sin React ni red: lo cargan también las
// pruebas de Node. El servidor tiene la última palabra; aquí solo se avisa antes de enviar y se interpretan sus respuestas.
export const WEEK_DAYS: Readonly<Record<number, string>> = Object.freeze({ 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' });
export const MAX_SLOTS = 21;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export interface ScheduleSlot { dia_semana: number; hora_inicio: string; hora_fin: string }
export interface ScheduleItem extends ScheduleSlot { id: number; dia: string }
export interface ScheduleEdition { id: number; nombre: string; estado: string; archivada: boolean; revision: number; modificable: boolean }
export interface ScheduleResult { ok: boolean; convocatoria: ScheduleEdition; zona_horaria: string; items: ScheduleItem[]; cambios?: boolean }
// Fila del formulario: todo como cadena (así llegan de los campos) y una clave estable para React.
export interface DraftSlot { key: string; dia_semana: string; hora_inicio: string; hora_fin: string }

let sequence = 0;
export const newSlotKey = () => 's' + (++sequence);
export const emptySlot = (): DraftSlot => ({ key: newSlotKey(), dia_semana: '1', hora_inicio: '', hora_fin: '' });
export const draftFrom = (items: readonly ScheduleSlot[]): DraftSlot[] => items.map(item => ({ key: newSlotKey(), dia_semana: String(item.dia_semana), hora_inicio: item.hora_inicio, hora_fin: item.hora_fin }));

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSlot = (value: unknown): value is ScheduleItem => isObject(value) && Number.isInteger(value.id) && Number.isInteger(value.dia_semana)
  && (value.dia_semana as number) >= 1 && (value.dia_semana as number) <= 7 && typeof value.hora_inicio === 'string' && TIME.test(value.hora_inicio)
  && typeof value.hora_fin === 'string' && TIME.test(value.hora_fin) && typeof value.dia === 'string';

// Una respuesta que no cumple el contrato no se muestra a medias: devuelve null y la pantalla ofrece reintentar.
export function parseSchedule(data: unknown): ScheduleResult | null {
  if (!isObject(data) || !isObject(data.convocatoria) || !Array.isArray(data.items) || !data.items.every(isSlot)) return null;
  const edition = data.convocatoria;
  if (!Number.isInteger(edition.id) || !Number.isInteger(edition.revision) || (edition.revision as number) < 1 || typeof edition.nombre !== 'string'
    || typeof edition.estado !== 'string' || typeof edition.archivada !== 'boolean' || typeof edition.modificable !== 'boolean') return null;
  return { ok: true, convocatoria: edition as unknown as ScheduleEdition, zona_horaria: typeof data.zona_horaria === 'string' ? data.zona_horaria : 'America/Lima', items: data.items as ScheduleItem[], ...(typeof data.cambios === 'boolean' ? { cambios: data.cambios } : {}) };
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const dayOf = (row: DraftSlot) => (/^[1-7]$/.test(row.dia_semana) ? Number(row.dia_semana) : 0);

export interface ScheduleErrors { rows: Record<string, string>; general: string }
// Mismas reglas que el servidor: día 1–7, HH:MM, fin posterior al inicio, sin duplicados ni solapamientos el mismo día y máximo 21 tramos.
// Intervalos [inicio, fin): un tramo puede empezar justo cuando termina otro.
export function scheduleErrors(rows: readonly DraftSlot[]): ScheduleErrors {
  const result: ScheduleErrors = { rows: {}, general: rows.length > MAX_SLOTS ? 'Una edición admite como máximo ' + MAX_SLOTS + ' horarios.' : '' };
  const valid: DraftSlot[] = [];
  for (const row of rows) {
    if (!dayOf(row)) result.rows[row.key] = 'Elige un día de la semana.';
    else if (!TIME.test(row.hora_inicio) || !TIME.test(row.hora_fin)) result.rows[row.key] = 'Indica la hora de inicio y la de fin.';
    else if (minutes(row.hora_fin) <= minutes(row.hora_inicio)) result.rows[row.key] = 'La hora de fin debe ser posterior a la de inicio.';
    else valid.push(row);
  }
  for (let i = 0; i < valid.length; i++) for (let j = i + 1; j < valid.length; j++) {
    const a = valid[i], b = valid[j];
    if (dayOf(a) !== dayOf(b) || result.rows[a.key] || result.rows[b.key]) continue;
    if (a.hora_inicio === b.hora_inicio && a.hora_fin === b.hora_fin) result.rows[b.key] = 'Este horario está repetido.';
    else if (minutes(a.hora_inicio) < minutes(b.hora_fin) && minutes(b.hora_inicio) < minutes(a.hora_fin)) result.rows[b.key] = 'Se solapa con otro horario del mismo día.';
  }
  return result;
}
export const hasScheduleErrors = (errors: ScheduleErrors) => !!errors.general || Object.keys(errors.rows).length > 0;

// El cuerpo conserva el orden de las filas: `indice` de un 422 HORARIO_INVALIDO se corresponde con la posición en este arreglo.
export const schedulePayload = (rows: readonly DraftSlot[], revision: number) => ({ revision, horarios: rows.map(row => ({ dia_semana: Number(row.dia_semana), hora_inicio: row.hora_inicio, hora_fin: row.hora_fin })) });

const canonical = (rows: readonly Pick<DraftSlot, 'dia_semana' | 'hora_inicio' | 'hora_fin'>[]) => rows.map(row => `${Number(row.dia_semana)}|${row.hora_inicio}|${row.hora_fin}`).sort().join(';');
// ¿El borrador difiere del conjunto guardado? Ignora el orden y las claves.
export const scheduleChanged = (rows: readonly DraftSlot[], saved: readonly ScheduleSlot[]) => canonical(rows) !== canonical(saved.map(item => ({ dia_semana: String(item.dia_semana), hora_inicio: item.hora_inicio, hora_fin: item.hora_fin })));

export const sortSlots = <T extends Pick<DraftSlot, 'dia_semana' | 'hora_inicio'>>(rows: readonly T[]): T[] => [...rows].sort((a, b) => Number(a.dia_semana) - Number(b.dia_semana) || a.hora_inicio.localeCompare(b.hora_inicio));

export function describeSlot(slot: Pick<ScheduleSlot, 'dia_semana' | 'hora_inicio' | 'hora_fin'>) {
  return `${WEEK_DAYS[slot.dia_semana] ?? 'Día ' + slot.dia_semana}, de ${slot.hora_inicio} a ${slot.hora_fin}`;
}

export type ServerScheduleIssue = { codigo: string; message: string; rows: Record<string, string> };
// Interpreta el cuerpo de un 422 de horarios y señala las filas afectadas. `HORARIO_INVALIDO` trae `tramos` con el índice enviado;
// duplicados y solapamientos traen `conflictos` con el contenido de cada tramo (se buscan por día y horas). Cualquier otra forma: null.
export function serverScheduleIssue(body: unknown, rows: readonly DraftSlot[]): ServerScheduleIssue | null {
  if (!isObject(body) || typeof body.codigo !== 'string' || !/^HORARIO_(INVALIDO|DUPLICADO|SOLAPADO)$/.test(body.codigo)) return null;
  const message = typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join(' · ') : 'El servidor rechazó los horarios.';
  const marks: Record<string, string> = {};
  if (Array.isArray(body.tramos)) for (const tramo of body.tramos) {
    const row = isObject(tramo) && Number.isInteger(tramo.indice) ? rows[tramo.indice as number] : undefined;
    if (row) marks[row.key] = 'La hora de fin debe ser posterior a la de inicio.';
  }
  const find = (value: unknown) => isObject(value) ? rows.find(row => dayOf(row) === value.dia_semana && row.hora_inicio === value.hora_inicio && row.hora_fin === value.hora_fin) : undefined;
  if (Array.isArray(body.conflictos)) for (const conflict of body.conflictos) {
    if (!isObject(conflict)) continue;
    const text = conflict.tipo === 'solapamiento' ? 'Se solapa con otro horario del mismo día.' : 'Este horario está repetido.';
    for (const row of [find(conflict.primero), find(conflict.segundo)]) if (row) marks[row.key] = text;
  }
  return { codigo: body.codigo, message, rows: marks };
}
