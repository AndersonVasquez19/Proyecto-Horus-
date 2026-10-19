// Registro manual de una consulta (POST /admin/messages). Sin importaciones, para poder probarlo con `node --test`.

export const MESSAGE_FORM_KEYS = ['nombre', 'email', 'telefono', 'asunto', 'mensaje'] as const
export type MessageForm = Record<(typeof MESSAGE_FORM_KEYS)[number], string>

// Formato de teléfono (igual que el backend): dígitos y separadores habituales; sin longitud mínima. Escapado para el modo v de los patrones HTML.
export const PHONE_INPUT_PATTERN = '(?=.*\\d)[+\\(\\)\\d\\s.\\-]+'

// Campos del formulario de registro manual (antes definidos en `resources.mensajes`). Los límites coinciden con los del DTO del backend.
export type MessageFieldSpec = { key: (typeof MESSAGE_FORM_KEYS)[number]; label: string; type?: 'textarea' | 'email' | 'tel'; required?: boolean; max?: number; pattern?: string }
export const MESSAGE_FIELDS: readonly MessageFieldSpec[] = [
  { key: 'nombre', label: 'Nombre', required: true, max: 100 },
  { key: 'email', label: 'Correo electrónico', type: 'email', required: true },
  { key: 'telefono', label: 'Teléfono', type: 'tel', max: 30, pattern: PHONE_INPUT_PATTERN },
  { key: 'asunto', label: 'Asunto', required: true, max: 150 },
  { key: 'mensaje', label: 'Mensaje', type: 'textarea', required: true, max: 5000 },
]
export const emptyMessageForm = (): MessageForm => ({ nombre: '', email: '', telefono: '', asunto: '', mensaje: '' })

// Mismo criterio que el formulario genérico anterior: los valores se recortan y el teléfono, que es opcional, se omite si está vacío.
// Las validaciones de longitud y formato siguen siendo las del propio formulario (atributos HTML) y, en última instancia, las del servidor.
export function buildMessagePayload(form: Partial<Record<string, string>>): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const key of MESSAGE_FORM_KEYS) {
    const value = (form[key] ?? '').trim()
    if (!value && key === 'telefono') continue
    payload[key] = value
  }
  return payload
}

// Hay cambios pendientes en cuanto cualquier campo contiene algo más que espacios.
export const hasMessageDraft = (form: Partial<Record<string, string>>) => MESSAGE_FORM_KEYS.some(key => (form[key] ?? '').trim() !== '')

// Posibles coincidencias entre las consultas recientes y el borrador: mismo correo, asunto y mensaje (sin distinguir mayúsculas ni espacios en los
// extremos). Es solo una pista: dos envíos idénticos hechos a propósito también coinciden, y una consulta creada con otros datos no aparece.
export function findPossibleDuplicates<T extends { [key: string]: unknown }>(rows: T[], form: Partial<Record<string, string>>): T[] {
  const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
  return rows.filter(row => same(row.email, form.email) && same(row.asunto, form.asunto) && same(row.mensaje, form.mensaje))
}
