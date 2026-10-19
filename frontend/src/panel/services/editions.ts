export type EditionState = 'planificada' | 'abierta' | 'cerrada' | 'cancelada';
export interface EditionCourse { id: number; titulo: string; tipo: string; estado: string }
export interface Edition {
  id: number; curso_id: number; curso: EditionCourse; nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  capacidad: number | null; estado: EditionState; archivado_at: string | null; revision: number; createdAt: string; updatedAt: string;
}
export interface EditionList<T = Edition> { ok: boolean; items: T[]; pagination: { page: number; limit: number; total: number; pages: number } }
export interface EditionForm { curso_id: string; nombre: string; fecha_inicio: string; fecha_fin: string; capacidad: string }
export const EMPTY_EDITION: EditionForm = { curso_id: '', nombre: '', fecha_inicio: '', fecha_fin: '', capacidad: '' };
export const EDITION_STATES: Record<EditionState, string> = { planificada: 'Planificada', abierta: 'Abierta', cerrada: 'Cerrada', cancelada: 'Cancelada' };
const validDate = (v: string) => /^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
type PreviousEdition = Pick<Edition, 'fecha_inicio' | 'fecha_fin' | 'capacidad'>;
export function editionErrors(form: EditionForm, original?: PreviousEdition | null) {
  const errors: Partial<Record<keyof EditionForm, string>> = {};
  if (!/^[0-9]+$/.test(form.curso_id) || Number(form.curso_id) < 1 || Number(form.curso_id) > 2147483647) errors.curso_id = 'Selecciona un curso existente.';
  if (!form.nombre.trim() || form.nombre.trim().length > 160) errors.nombre = 'Introduce un nombre (máximo 160 caracteres).';
  for (const key of ['fecha_inicio', 'fecha_fin'] as const) if (!(original && original[key] === null && form[key] === '') && !validDate(form[key])) errors[key] = 'Introduce una fecha válida.';
  if (form.fecha_inicio && form.fecha_fin && !errors.fecha_inicio && !errors.fecha_fin && form.fecha_fin < form.fecha_inicio) errors.fecha_fin = 'La fecha final no puede ser anterior a la inicial.';
  if (!(original && original.capacidad === null && form.capacidad === '') && (!/^[0-9]+$/.test(form.capacidad) || Number(form.capacidad) < 1 || Number(form.capacidad) > 2147483647)) errors.capacidad = 'Introduce una capacidad entera positiva.';
  return errors;
}
export function editionPayload(form: EditionForm, revision?: number, original?: PreviousEdition | null) {
  return { ...(revision === undefined ? { curso_id: Number(form.curso_id) } : { revision }), nombre: form.nombre.trim(),
    ...(original && original.fecha_inicio === null && !form.fecha_inicio ? {} : { fecha_inicio: form.fecha_inicio }),
    ...(original && original.fecha_fin === null && !form.fecha_fin ? {} : { fecha_fin: form.fecha_fin }),
    ...(original && original.capacidad === null && !form.capacidad ? {} : { capacidad: Number(form.capacidad) }),
  };
}
export function editionForm(item: Pick<Edition, 'curso_id' | 'nombre' | 'fecha_inicio' | 'fecha_fin' | 'capacidad'>): EditionForm {
  return { curso_id: String(item.curso_id), nombre: item.nombre, fecha_inicio: item.fecha_inicio || '', fecha_fin: item.fecha_fin || '', capacidad: item.capacidad === null ? '' : String(item.capacidad) };
}
export type EditionAction = 'open' | 'close' | 'cancel' | 'archive' | 'restore';
export const ACTION_LABEL: Record<EditionAction, string> = { open: 'Abrir edición', close: 'Cerrar edición', cancel: 'Cancelar edición', archive: 'Archivar edición', restore: 'Restaurar edición' };
export function editionActions(item: Pick<Edition, 'estado' | 'archivado_at'>, can: (permission: string) => boolean): EditionAction[] {
  if (item.archivado_at) return can('convocatorias:archivar') ? ['restore'] : [];
  if (item.estado === 'cerrada' || item.estado === 'cancelada') return can('convocatorias:archivar') ? ['archive'] : [];
  return [...(item.estado === 'planificada' && can('convocatorias:editar') ? ['open' as const] : []), ...(can('convocatorias:cerrar') ? [...(item.estado === 'abierta' ? ['close' as const] : []), 'cancel' as const] : [])];
}
export const editionDate = (value: string | null) => value ? value.split('-').reverse().join('/') : 'Sin definir';
