// Preinscripciones académicas (panel): GET/PATCH/PUT/POST /admin/preinscripciones y GET /admin/preinscripciones/resumen. Módulo puro, sin
// React ni red. Los estados y transiciones son los del backend (recibida → validada → matriculada; desistida y descartada son finales);
// aquí solo se decide qué acciones se ofrecen. El backend sigue siendo quien autoriza y valida.
export type PreregState = 'recibida' | 'validada' | 'matriculada' | 'desistida' | 'descartada';
export type PreregChannel = 'formulario' | 'chatbot';
export const PREREG_STATES: Record<PreregState, string> = { recibida: 'Recibida', validada: 'Validada', matriculada: 'Matriculada', desistida: 'Desistida', descartada: 'Descartada' };
export const PREREG_CHANNELS: Record<PreregChannel, string> = { formulario: 'Formulario web', chatbot: 'Asistente virtual' };

export interface PreregEdition { id: number; nombre: string; estado: string; fecha_inicio: string | null; fecha_fin: string | null; archivado_at: string | null; preinscripcion_estado: 'abierta' | 'cerrada'; minimo_apertura: number | null; capacidad: number | null; revision: number; curso: { id: number; titulo: string; tipo: string } }
export interface Prereg {
  id: number; convocatoria_id: number; convocatoria: PreregEdition; nombres: string; apellidos: string; email: string; telefono: string; canal: PreregChannel; estado: PreregState;
  consentimiento_at: string; aviso_version: string; estudiante_id: number | null; matricula_id: number | null; convertida_at: string | null; revision: number; createdAt: string; updatedAt: string;
}
export interface PreregList { ok: boolean; items: Prereg[]; pagination: { page: number; limit: number; total: number; pages: number } }
export interface PreregDetail { ok: boolean; item: Prereg; matricula: { id: number; estado: string } | null; estudiante: { id: number; nombres: string; apellidos: string } | null; coincidencias: { id: number; estado: PreregState; canal: PreregChannel; createdAt: string; coincide: string[] }[] }
export interface PreregHistoryItem { id: number; createdAt: string; operacion: string; canal: PreregChannel | null; actor_id: number | null; actor_rol: string | null; estado_anterior: PreregState | null; estado_nuevo: PreregState | null; campos: unknown; revision: number; motivo: string | null }
export interface PreregHistory { ok: boolean; items: PreregHistoryItem[]; pagination: { page: number; limit: number; total: number; pages: number } }
export interface PreregSummaryItem {
  convocatoria: PreregEdition; conteo: Record<PreregState, number> & { total: number };
  apertura: { minimo: number | null; contadas: number; faltan: number | null; cumple_minimo: boolean | null };
  cupos: { capacidad: number | null; ocupados: number; disponibles: number | null };
}
export interface PreregSummary { ok: boolean; items: PreregSummaryItem[]; pagination: { page: number; limit: number; total: number; pages: number } }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const pagination = (value: unknown) => isObject(value) && ['page', 'limit', 'total', 'pages'].every(key => Number.isInteger(value[key]));
const isPrereg = (value: unknown): value is Prereg => isObject(value) && Number.isInteger(value.id) && Number.isInteger(value.revision) && typeof value.nombres === 'string' && typeof value.apellidos === 'string'
  && typeof value.email === 'string' && typeof value.telefono === 'string' && typeof value.estado === 'string' && value.estado in PREREG_STATES && isObject(value.convocatoria) && isObject(value.convocatoria.curso);
// Una respuesta fuera de contrato no se pinta a medias: las pantallas muestran un error con «Reintentar».
export const parsePreregList = (data: unknown): PreregList | null => isObject(data) && Array.isArray(data.items) && data.items.every(isPrereg) && pagination(data.pagination) ? data as unknown as PreregList : null;
export const parsePreregDetail = (data: unknown): PreregDetail | null => isObject(data) && isPrereg(data.item) && Array.isArray(data.coincidencias) ? data as unknown as PreregDetail : null;
export const parsePreregHistory = (data: unknown): PreregHistory | null => isObject(data) && Array.isArray(data.items) && data.items.every(item => isObject(item) && Number.isInteger(item.id) && typeof item.operacion === 'string') && pagination(data.pagination) ? data as unknown as PreregHistory : null;
export const parsePreregSummary = (data: unknown): PreregSummary | null => isObject(data) && Array.isArray(data.items) && pagination(data.pagination)
  && data.items.every(item => isObject(item) && isObject(item.convocatoria) && isObject(item.conteo) && isObject(item.apertura) && isObject(item.cupos) && Number.isInteger(item.convocatoria.id)) ? data as unknown as PreregSummary : null;

export type PreregAction = 'correct' | 'validate' | 'discard' | 'withdraw' | 'convert';
export const PREREG_ACTION_LABEL: Record<PreregAction, string> = { correct: 'Corregir datos', validate: 'Validar', discard: 'Descartar', withdraw: 'Registrar desistimiento', convert: 'Convertir en matrícula' };
// Permisos del backend (route-inventory.ts): corregir, validar, descartar y desistir exigen «editar»; convertir exige «convertir».
export const PREREG_PERMISSION: Record<PreregAction, string> = { correct: 'preinscripciones:editar', validate: 'preinscripciones:editar', discard: 'preinscripciones:editar', withdraw: 'preinscripciones:editar', convert: 'preinscripciones:convertir' };
export function preregActions(item: Pick<Prereg, 'estado'>, can: (permission: string) => boolean): PreregAction[] {
  const states: Record<PreregAction, PreregState[]> = { correct: ['recibida', 'validada'], validate: ['recibida'], discard: ['recibida', 'validada'], withdraw: ['recibida', 'validada'], convert: ['validada'] };
  return (Object.keys(states) as PreregAction[]).filter(action => states[action].includes(item.estado) && can(PREREG_PERMISSION[action]));
}

// Mismo criterio que el backend (preinscripciones.privacy.ts): barrera de minimización, no detección completa de datos personales.
export const PERSONAL_DATA_HINT = 'No escribas correos, teléfonos, documentos ni contraseñas. Describe el motivo sin identificar a nadie.';
export const hasPersonalData = (text: string) => /@/.test(text) || /(?:\d[\s.\-()+]*){7,}/.test(text) || /\b(contrase[ñn]a|password|passwd|clave|token|api[\s_-]?key|secreto)\b\s*[:=]/i.test(text);
export function reasonError(text: string, required: boolean) {
  const value = text.trim();
  if (!value) return required ? 'Indica el motivo.' : '';
  if (value.length > 300) return 'Máximo 300 caracteres.';
  return hasPersonalData(value) ? 'El motivo no debe incluir correos, teléfonos, documentos ni contraseñas.' : '';
}

export interface PreregForm { nombres: string; apellidos: string; email: string; telefono: string }
export const preregForm = (item: Pick<Prereg, 'nombres' | 'apellidos' | 'email' | 'telefono'>): PreregForm => ({ nombres: item.nombres, apellidos: item.apellidos, email: item.email, telefono: item.telefono });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, PHONE = /^(?=.*\d)[+()\d\s.-]+$/;
export function preregFormErrors(form: PreregForm) {
  const errors: Partial<Record<keyof PreregForm, string>> = {};
  if (!form.nombres.trim()) errors.nombres = 'Introduce los nombres.'; else if (form.nombres.trim().length > 120) errors.nombres = 'Máximo 120 caracteres.';
  if (!form.apellidos.trim()) errors.apellidos = 'Introduce los apellidos.'; else if (form.apellidos.trim().length > 120) errors.apellidos = 'Máximo 120 caracteres.';
  const email = form.email.trim();
  if (!email || email.length > 254 || !EMAIL.test(email)) errors.email = 'Introduce un correo válido (máximo 254 caracteres).';
  const phone = form.telefono.trim();
  if (!phone || phone.length > 30 || !PHONE.test(phone)) errors.telefono = 'Introduce un teléfono válido (máximo 30 caracteres).';
  return errors;
}
// Solo viajan los campos que cambiaron, más la revisión leída. Sin ningún cambio no hay nada que enviar (null).
export function preregCorrectionPayload(form: PreregForm, original: Pick<Prereg, 'nombres' | 'apellidos' | 'email' | 'telefono' | 'revision'>) {
  const next = { nombres: form.nombres.trim(), apellidos: form.apellidos.trim(), email: form.email.trim().toLowerCase(), telefono: form.telefono.trim() };
  const changed = (Object.keys(next) as (keyof PreregForm)[]).filter(key => next[key] !== (key === 'email' ? original.email.toLowerCase() : original[key]));
  return changed.length ? { revision: original.revision, ...Object.fromEntries(changed.map(key => [key, next[key]])) } : null;
}

export const dniError = (value: string) => /^[0-9]{8}$/.test(value) ? '' : 'El DNI debe tener exactamente 8 dígitos.';
export const conversionPayload = (revision: number, dni: string) => ({ revision, doc_numero: dni });

const IDENTITY_TEXT: Record<string, string> = {
  DNI_NO_COINCIDE: 'El DNI indicado no corresponde al estudiante seleccionado.',
  IDENTIDAD_DISCREPANTE: 'Los datos de la preinscripción no coinciden con los del estudiante registrado con ese DNI.',
  POSIBLE_DUPLICADO: 'Ya existe un estudiante con el mismo nombre y datos de contacto bajo otro DNI.',
};
const DISCREPANCY_TEXT: Record<string, string> = { nombres: 'los nombres y apellidos', contacto: 'el correo o el teléfono', dni: 'el DNI', posible_duplicado: 'un posible duplicado' };
// Un 409 de identidad trae `codigo` y `discrepancias` (solo nombres de campo). No se ofrece «forzar»: se corrige el dato por su vía y se repite.
export function identityIssue(body: unknown): { codigo: string; message: string } | null {
  if (!isObject(body) || typeof body.codigo !== 'string' || !(body.codigo in IDENTITY_TEXT)) return null;
  const fields = Array.isArray(body.discrepancias) ? body.discrepancias.filter((field): field is string => typeof field === 'string' && field in DISCREPANCY_TEXT).map(field => DISCREPANCY_TEXT[field]) : [];
  return { codigo: body.codigo, message: IDENTITY_TEXT[body.codigo] + (fields.length ? ' Revisa ' + fields.join(' y ') + '.' : '') + ' Corrige la preinscripción o el estudiante por su vía habitual y vuelve a intentar la conversión.' };
}

export const preregName = (item: Pick<Prereg, 'nombres' | 'apellidos'>) => item.apellidos + ', ' + item.nombres;
export const preregDateTime = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }); };
export const HISTORY_OPERATION: Record<string, string> = { creacion: 'Recibida', correccion: 'Datos corregidos', validacion: 'Validada', descarte: 'Descartada', desistimiento: 'Desistimiento registrado', conversion: 'Convertida en matrícula' };
export const historyLabel = (operation: string) => HISTORY_OPERATION[operation] ?? 'Cambio registrado';
