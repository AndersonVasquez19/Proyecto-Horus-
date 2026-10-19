import { PublicApiError } from '../../api'

// Formulario del Libro de Reclamaciones: tipos, opciones, validación y traducción de errores.
// El contrato con el backend (nombres de campo y valores de los códigos) NO cambia: ver toPayload().

export type FormData = {
  nombres: string
  apellidos: string
  tipoDoc: string
  numDoc: string
  email: string
  telefono: string
  direccion: string
  tipoRegistro: string
  area: string
  fechaIncidente: string
  descripcionBien: string
  detalleReclamo: string
  aceptaTerminos: boolean
  aceptaComunicaciones: boolean
}
export type FormField = keyof FormData
export type FormErrors = Partial<Record<FormField, string>>

export const INITIAL: FormData = {
  nombres: '', apellidos: '', tipoDoc: '', numDoc: '', email: '', telefono: '', direccion: '',
  tipoRegistro: '', area: '', fechaIncidente: '', descripcionBien: '', detalleReclamo: '',
  aceptaTerminos: false, aceptaComunicaciones: false,
}

// Mismos límites que el DTO del backend (create-reclamacion.dto): el cliente no envía lo que la API rechazaría.
export const LIMITS = { nombres: 255, apellidos: 255, email: 255, telefono: 30, numDoc: 15, direccion: 255, texto: 5000 }
// El backend espera el correo antes de responder, así que el límite deja margen para un SMTP lento (igual que Contactos).
export const SUBMIT_TIMEOUT_MS = 25_000

// Códigos que recibe el backend (value) y nombre legible que ve la persona (label).
export const TIPOS_DOC = [
  { value: 'dni', label: 'DNI' },
  { value: 'ce', label: 'Carnet de Extranjería' },
  { value: 'pasaporte', label: 'Pasaporte' },
  { value: 'ruc', label: 'RUC' },
]
export const AREAS = [
  { value: 'cableado', label: 'Cableado Estructurado' },
  { value: 'camaras', label: 'Cámaras de Seguridad' },
  { value: 'soporte', label: 'Soporte y Mantenimiento' },
  { value: 'asesoramiento', label: 'Asesoramiento' },
  { value: 'capacitaciones', label: 'Capacitaciones' },
  { value: 'cursos', label: 'Cursos' },
  { value: 'atencion', label: 'Atención al Cliente' },
  { value: 'otro', label: 'Otro' },
]
export const TIPOS_REGISTRO = [
  { value: 'reclamo', label: 'Reclamo', desc: 'Disconformidad con los productos o servicios adquiridos.' },
  { value: 'queja', label: 'Queja', desc: 'Disconformidad con la atención al cliente o el trato recibido.' },
]
export const labelOf = (list: { value: string; label: string }[], value: string) => list.find(item => item.value === value)?.label ?? value

// Elemento que recibe el foco cuando un campo tiene error, en el orden en que aparecen en la página.
export const FIELD_ORDER: FormField[] = ['nombres', 'apellidos', 'tipoDoc', 'numDoc', 'email', 'telefono', 'direccion', 'tipoRegistro', 'area', 'fechaIncidente', 'descripcionBien', 'detalleReclamo', 'aceptaTerminos']
export const fieldId = (field: FormField) => field === 'tipoRegistro' ? 'lb-tipoRegistro-reclamo' : 'lb-' + field
export const FIELD_LABELS: Record<FormField, string> = {
  nombres: 'Nombres', apellidos: 'Apellidos', tipoDoc: 'Tipo de documento', numDoc: 'Número de documento', email: 'Correo electrónico', telefono: 'Teléfono',
  direccion: 'Dirección', tipoRegistro: 'Tipo de registro', area: 'Área / Servicio', fechaIncidente: 'Fecha del incidente',
  descripcionBien: 'Descripción del bien / servicio', detalleReclamo: 'Detalle del reclamo / queja', aceptaTerminos: 'Declaración y Política de Privacidad', aceptaComunicaciones: 'Comunicaciones',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_CHARS = /^[+()\d\s.-]+$/

// Fecha de hoy en Lima (AAAA-MM-DD): el límite de "fecha del incidente" no depende de la zona horaria del navegador.
export const limaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })

// Validación básica de documento. No hay un formato oficial aprobado en el proyecto, así que NO se impone longitud mínima:
// solo vacío, caracteres permitidos y el máximo (LIMITS.numDoc, maxLength del campo). DNI y RUC: solo números;
// carnet de extranjería y pasaporte: letras y números.
export function documentError(tipo: string, numero: string): string | undefined {
  const value = numero.trim()
  if (!value) return 'Ingresa el número de documento.'
  if (value.length > LIMITS.numDoc) return 'El número de documento es demasiado largo.'
  if (tipo === 'dni' || tipo === 'ruc') {
    if (!/^\d+$/.test(value)) return 'Usa solo números.'
  } else if (tipo) {
    if (!/^[A-Za-z0-9]+$/.test(value)) return 'Usa solo letras y números.'
  }
  return undefined
}

export function validate(form: FormData, today = limaToday()): FormErrors {
  const e: FormErrors = {}
  const nombres = form.nombres.trim(), apellidos = form.apellidos.trim(), email = form.email.trim(), telefono = form.telefono.trim()
  if (!nombres) e.nombres = 'Ingresa tus nombres.'
  if (!apellidos) e.apellidos = 'Ingresa tus apellidos.'
  if (!form.tipoDoc) e.tipoDoc = 'Selecciona el tipo de documento.'
  const doc = documentError(form.tipoDoc, form.numDoc)
  if (doc) e.numDoc = doc
  if (!email) e.email = 'Ingresa tu correo.'
  else if (!EMAIL.test(email)) e.email = 'Ingresa un correo válido.'
  if (!telefono) e.telefono = 'Ingresa tu teléfono.'
  else if (!PHONE_CHARS.test(telefono) || telefono.replace(/\D/g, '').length < 6) e.telefono = 'Ingresa un teléfono válido.'
  if (!form.tipoRegistro) e.tipoRegistro = 'Selecciona el tipo de registro.'
  if (!form.area) e.area = 'Selecciona el área.'
  if (!form.fechaIncidente) e.fechaIncidente = 'Indica la fecha del incidente.'
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fechaIncidente) || form.fechaIncidente < '1900-01-01') e.fechaIncidente = 'Indica una fecha válida.'
  else if (form.fechaIncidente > today) e.fechaIncidente = 'La fecha no puede ser posterior a hoy.'
  if (!form.descripcionBien.trim()) e.descripcionBien = 'Describe el bien o servicio.'
  if (!form.detalleReclamo.trim()) e.detalleReclamo = 'Detalla tu reclamo o queja.'
  if (!form.aceptaTerminos) e.aceptaTerminos = 'Debes aceptar los términos para enviar el reclamo.'
  return e
}

// Cuerpo del POST: exactamente los campos que acepta el DTO del backend (rechaza cualquier otro).
export const toPayload = (f: FormData) => ({
  nombres: f.nombres, apellidos: f.apellidos, tipo_doc: f.tipoDoc, num_doc: f.numDoc, email: f.email, telefono: f.telefono,
  direccion: f.direccion, tipo_registro: f.tipoRegistro, area: f.area, fecha_incidente: f.fechaIncidente,
  descripcion_bien: f.descripcionBien, detalle_reclamo: f.detalleReclamo, acepta_comunicaciones: f.aceptaComunicaciones,
})

// Nombre del campo en el backend -> campo del formulario (los mensajes de class-validator empiezan por ese nombre).
const SERVER_FIELDS: Record<string, FormField> = {
  nombres: 'nombres', apellidos: 'apellidos', tipo_doc: 'tipoDoc', num_doc: 'numDoc', email: 'email', telefono: 'telefono', direccion: 'direccion',
  tipo_registro: 'tipoRegistro', area: 'area', fecha_incidente: 'fechaIncidente', descripcion_bien: 'descripcionBien', detalle_reclamo: 'detalleReclamo',
}
const SERVER_FIELD_MESSAGES: Partial<Record<FormField, string>> = {
  nombres: 'Revisa tus nombres.', apellidos: 'Revisa tus apellidos.', tipoDoc: 'Revisa el tipo de documento.', numDoc: 'Revisa el número de documento.',
  email: 'Ingresa un correo válido.', telefono: 'Ingresa un teléfono válido.', direccion: 'Revisa la dirección.', tipoRegistro: 'Selecciona el tipo de registro.',
  area: 'Selecciona el área.', fechaIncidente: 'Indica una fecha válida.', descripcionBien: 'Revisa la descripción.', detalleReclamo: 'Revisa el detalle.',
}

export const ERROR_TEXTS = {
  generic: 'No pudimos registrar tu reclamo. Inténtalo nuevamente.',
  network: 'No pudimos conectarnos con el servidor. Revisa tu conexión.',
  tooMany: 'Has realizado demasiados intentos. Espera un momento e inténtalo nuevamente.',
  timeout: 'No pudimos completar el envío a tiempo. Inténtalo nuevamente.',
  fields: 'Revisa los datos marcados e inténtalo nuevamente.',
}

// Convierte cualquier fallo en texto en español: los mensajes crudos del navegador o del validador nunca se muestran.
export function describeSubmitError(error: unknown, timedOut: boolean): { text: string; fields: FormErrors } {
  if (timedOut) return { text: ERROR_TEXTS.timeout, fields: {} }
  if (error instanceof PublicApiError) {
    if (error.status === 400 || error.status === 422) {
      const fields: FormErrors = {}
      for (const detail of error.details) {
        const name = detail.split(' ')[0]
        const field = SERVER_FIELDS[name]
        if (field) fields[field] = SERVER_FIELD_MESSAGES[field]
      }
      return { text: Object.keys(fields).length ? ERROR_TEXTS.fields : ERROR_TEXTS.generic, fields }
    }
    if (error.status === 429) return { text: ERROR_TEXTS.tooMany, fields: {} }
    return { text: ERROR_TEXTS.generic, fields: {} }
  }
  return { text: ERROR_TEXTS.network, fields: {} }
}

export type Constancia = { nombre: string; tipo: string; area: string; fecha: string; bien: string; detalle: string }
export const toConstancia = (f: FormData): Constancia => ({
  nombre: (f.nombres.trim() + ' ' + f.apellidos.trim()).trim(), tipo: labelOf(TIPOS_REGISTRO, f.tipoRegistro), area: labelOf(AREAS, f.area),
  fecha: f.fechaIncidente.split('-').reverse().join('/'), bien: f.descripcionBien.trim(), detalle: f.detalleReclamo.trim(),
})
