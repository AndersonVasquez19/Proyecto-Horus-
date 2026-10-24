// Formulario público de preinscripción (POST /api/preinscripciones). Módulo puro, sin importaciones ni JSX: lo cargan también las
// pruebas de Node. El contrato es el del backend: la edición se elige por su código opaco (nunca por id), no hay DNI, pagos ni comprobantes,
// el servidor fija el canal y el campo `website` es una trampa para robots que debe viajar vacío.
export const LIMITS = { nombres: 120, apellidos: 120, email: 254, telefono: 30 } as const
export const SUBMIT_TIMEOUT_MS = 20000

export interface PreregEdition {
  codigo: string; nombre: string; apertura_confirmada: boolean; fecha_inicio: string | null; fecha_fin: string | null
  curso: { titulo: string; tipo: string; modalidad: string | null; duracion: string | null }
}
export interface PreregForm { convocatoria: string; nombres: string; apellidos: string; email: string; telefono: string; consentimiento: boolean; website: string }
export type PreregField = 'convocatoria' | 'nombres' | 'apellidos' | 'email' | 'telefono' | 'consentimiento'
export type PreregErrors = Partial<Record<PreregField, string>>
export const FIELD_ORDER: PreregField[] = ['convocatoria', 'nombres', 'apellidos', 'email', 'telefono', 'consentimiento']
export const FIELD_LABELS: Record<PreregField, string> = { convocatoria: 'Edición', nombres: 'Nombres', apellidos: 'Apellidos', email: 'Correo electrónico', telefono: 'Teléfono', consentimiento: 'Consentimiento' }
export const EMPTY_FORM: PreregForm = { convocatoria: '', nombres: '', apellidos: '', email: '', telefono: '', consentimiento: false, website: '' }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^(?=.*\d)[+()\d\s.-]+$/
const CODE = /^[0-9a-f]{32}$/

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nullableText = (value: unknown) => value === null || value === undefined || typeof value === 'string'
const isEdition = (value: unknown): value is PreregEdition => isObject(value) && typeof value.codigo === 'string' && CODE.test(value.codigo) && typeof value.nombre === 'string'
  && typeof value.apertura_confirmada === 'boolean' && nullableText(value.fecha_inicio) && nullableText(value.fecha_fin)
  && isObject(value.curso) && typeof value.curso.titulo === 'string' && nullableText(value.curso.modalidad) && nullableText(value.curso.duracion)
// Una lista fuera de contrato no se ofrece: el visitante vería ediciones a medias o con códigos que el servidor rechazaría.
export const parseEditions = (data: unknown): PreregEdition[] | null => isObject(data) && Array.isArray(data.items) && data.items.every(isEdition) ? data.items as PreregEdition[] : null

export function validate(form: PreregForm): PreregErrors {
  const errors: PreregErrors = {}
  if (!CODE.test(form.convocatoria)) errors.convocatoria = 'Elige la edición a la que quieres preinscribirte.'
  const nombres = form.nombres.trim(), apellidos = form.apellidos.trim(), email = form.email.trim(), telefono = form.telefono.trim()
  if (!nombres) errors.nombres = 'Escribe tus nombres.'; else if (nombres.length > LIMITS.nombres) errors.nombres = 'Máximo ' + LIMITS.nombres + ' caracteres.'
  if (!apellidos) errors.apellidos = 'Escribe tus apellidos.'; else if (apellidos.length > LIMITS.apellidos) errors.apellidos = 'Máximo ' + LIMITS.apellidos + ' caracteres.'
  if (!email || email.length > LIMITS.email || !EMAIL.test(email)) errors.email = 'Introduce un correo válido.'
  if (!telefono) errors.telefono = 'Escribe tu teléfono.'; else if (telefono.length > LIMITS.telefono || !PHONE.test(telefono)) errors.telefono = 'Introduce un teléfono válido (números, espacios, +, paréntesis, puntos o guiones).'
  if (form.consentimiento !== true) errors.consentimiento = 'Debes aceptar el tratamiento de tus datos para preinscribirte.'
  return errors
}

// Solo estos campos: el backend rechaza con 400 cualquier otro (canal, estado, DNI, pagos…).
export const toPayload = (form: PreregForm) => ({
  convocatoria: form.convocatoria, nombres: form.nombres.trim(), apellidos: form.apellidos.trim(), email: form.email.trim().toLowerCase(),
  telefono: form.telefono.trim(), consentimiento: true as const, website: form.website,
})

export const UNCERTAIN_TEXT = 'No pudimos confirmar si tu preinscripción fue registrada. Revisa tu conexión y consulta con el equipo antes de enviarla de nuevo.'
export type SubmitOutcome = { kind: 'invalid' | 'closed' | 'wait' | 'unavailable' | 'uncertain' | 'server' | 'unknown'; text: string; reload: boolean }
// `status` es el estado HTTP (undefined si no hubo respuesta: red, tiempo agotado o cuerpo ilegible). Nunca se muestra el texto del servidor
// ni el del navegador; un fallo sin respuesta puede haber guardado la solicitud, por eso no se afirma que falló.
export function describeSubmitError(status: number | undefined, timedOut = false): SubmitOutcome {
  if (timedOut || status === undefined || status === 502 || (status >= 200 && status < 300)) return { kind: 'uncertain', text: UNCERTAIN_TEXT, reload: false }
  if (status === 400 || status === 422) return { kind: 'invalid', text: 'Revisa los datos ingresados e inténtalo nuevamente.', reload: false }
  if (status === 404 || status === 409) return { kind: 'closed', text: 'Esta edición ya no recibe preinscripciones. Actualizamos la lista para que elijas otra.', reload: true }
  if (status === 429) return { kind: 'wait', text: 'Has realizado demasiadas solicitudes. Espera un momento e inténtalo nuevamente.', reload: false }
  if (status === 503) return { kind: 'unavailable', text: 'El servicio de preinscripciones no está disponible por ahora. Inténtalo más tarde.', reload: false }
  if (status >= 500) return { kind: 'server', text: 'Ocurrió un problema en el servidor. Inténtalo más tarde.', reload: false }
  return { kind: 'unknown', text: 'No pudimos completar la solicitud. Inténtalo nuevamente.', reload: false }
}

export const MODALITY: Record<string, string> = { presencial: 'Presencial', virtual: 'Virtual', hibrida: 'Híbrida' }
export const calendarDate = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : null
export function editionFacts(edition: PreregEdition): string[] {
  const start = calendarDate(edition.fecha_inicio), end = calendarDate(edition.fecha_fin)
  return [
    start ? (end && end !== start ? 'Del ' + start + ' al ' + end : 'Inicio: ' + start) : 'Fechas por confirmar',
    ...(edition.curso.modalidad ? [MODALITY[edition.curso.modalidad] ?? edition.curso.modalidad] : []),
    ...(edition.curso.duracion ? [edition.curso.duracion] : []),
  ]
}
