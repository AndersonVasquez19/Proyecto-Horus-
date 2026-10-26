// Reglas del formulario de registro público (sin React ni red: lo cargan también las pruebas de Node). Son una ayuda para la persona:
// la validación que cuenta es la del backend (POST /api/admin/signup), que además rechaza cualquier campo no previsto (rol, permisos…).
export interface SignupForm { nombre: string; email: string; password: string; confirmPassword: string }
export type SignupField = keyof SignupForm

export const NAME_MAX = 100
export const EMAIL_MAX = 254
export const PASSWORD_MIN = 8
export const PASSWORD_MAX_BYTES = 72 // límite de bcrypt en el backend, en bytes UTF-8

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length

// Primer problema del formulario (en el orden de los campos) o null si se puede enviar.
export function validateSignup(form: SignupForm): { field: SignupField; message: string } | null {
  const nombre = form.nombre.trim()
  const email = form.email.trim()
  if (!nombre) return { field: 'nombre', message: 'Ingresa tu nombre.' }
  if (nombre.length > NAME_MAX) return { field: 'nombre', message: `El nombre admite hasta ${NAME_MAX} caracteres.` }
  if (!email) return { field: 'email', message: 'Ingresa tu correo electrónico.' }
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return { field: 'email', message: 'Ingresa un correo electrónico válido.' }
  if (form.password.length < PASSWORD_MIN) return { field: 'password', message: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` }
  if (utf8Bytes(form.password) > PASSWORD_MAX_BYTES) return { field: 'password', message: 'La contraseña es demasiado larga: usa hasta 72 caracteres (las letras con tilde o la ñ cuentan doble).' }
  if (form.password !== form.confirmPassword) return { field: 'confirmPassword', message: 'Las contraseñas no coinciden. Revisa la confirmación.' }
  return null
}

// Cuerpo de la solicitud: solo los campos que admite el backend. La contraseña se envía tal cual (los espacios cuentan); el campo trampa
// solo viaja si alguien (un programa automatizado) lo rellenó.
export function signupPayload(form: SignupForm, trap = ''): { nombre: string; email: string; password: string; website?: string } {
  return { nombre: form.nombre.trim(), email: form.email.trim(), password: form.password, ...(trap ? { website: trap } : {}) }
}
