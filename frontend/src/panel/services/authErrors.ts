import { classifyWriteError } from '../../publicErrors'

// Mensajes en español para los formularios de autenticación. Nunca se muestra el texto del backend: el fallo se
// clasifica por código HTTP o tipo de error. En las operaciones que modifican la contraseña, un timeout, una red
// caída o una respuesta ilegible no demuestran que el servidor no aplicó el cambio: el mensaje lo advierte y no
// afirma que la contraseña siga igual.
export type AuthAction = 'login' | 'forgot' | 'reset' | 'change' | 'register'

const BASE = {
  tooMany: 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.',
  server: 'El servidor no pudo completar la operación. Inténtalo más tarde.',
  network: 'No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo nuevamente.',
  timeout: 'El servidor tardó demasiado en responder. Inténtalo nuevamente.',
}
export const RESET_LINK_INVALID = 'Este enlace no es válido o ya venció. Solicita uno nuevo.'
export const UNCERTAIN_RESET = 'No pudimos confirmar si tu contraseña se actualizó. Antes de repetir el proceso, intenta iniciar sesión con la nueva contraseña; si no funciona, solicita un enlace nuevo.'
export const UNCERTAIN_CHANGE = 'No pudimos confirmar si tu contraseña se actualizó. Si tu sesión se cierra, inicia sesión con la nueva contraseña; si no, comprueba el estado antes de repetir el cambio.'
export const UNCERTAIN_FORGOT = 'No pudimos confirmar si la solicitud se registró. Si no recibes un correo en unos minutos, inténtalo nuevamente.'
export const UNCERTAIN_REGISTER = 'No pudimos confirmar si tu cuenta se creó. Antes de repetir el registro, intenta iniciar sesión con ese correo y contraseña.'
export const REGISTER_DUPLICATE = 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.'
// 503 deliberado del backend (p. ej. la base de datos aún no tiene la estructura esperada): no es un fallo de credenciales.
export const AUTH_UNAVAILABLE = 'El acceso al panel no está disponible temporalmente. Inténtalo más tarde.'

export function authError(action: AuthAction, error: unknown, timedOut = false): { message: string; uncertain: boolean; linkInvalid: boolean } {
  const { kind, uncertain } = classifyWriteError(error, timedOut)
  const status = (error as { status?: unknown } | null)?.status
  const detail = error instanceof Error ? error.message : ''
  const done = (message: string, flags: { uncertain?: boolean; linkInvalid?: boolean } = {}) => ({ message, uncertain: flags.uncertain ?? false, linkInvalid: flags.linkInvalid ?? false })

  if (action === 'login') {
    if (kind === 'timeout') return done(BASE.timeout)
    if (kind === 'network') return done(BASE.network)
    if (kind === 'tooMany') return done(BASE.tooMany)
    if (status === 503) return done(AUTH_UNAVAILABLE)
    if (kind === 'server' || kind === 'unknown') return done(BASE.server)
    return done('Revisa tu correo y contraseña e inténtalo nuevamente.') // credenciales incorrectas: mensaje genérico, sin pistas sobre la cuenta
  }
  if (action === 'register') {
    // Un timeout, una red caída o un 502 no demuestran que la cuenta no se creó: no se repite el envío por sí solo.
    if (uncertain) return done(UNCERTAIN_REGISTER, { uncertain: true })
    if (status === 409) return done(REGISTER_DUPLICATE)
    if (kind === 'badRequest') return done('Revisa los datos: ingresa tu nombre, un correo válido y una contraseña de 8 a 72 caracteres.')
    if (kind === 'tooMany') return done(BASE.tooMany)
    if (status === 503) return done('El registro no está disponible temporalmente. Inténtalo más tarde.')
    return done(BASE.server)
  }
  if (action === 'forgot') {
    if (uncertain) return done(UNCERTAIN_FORGOT, { uncertain: true })
    if (kind === 'badRequest') return done('Revisa el correo ingresado e inténtalo nuevamente.')
    if (kind === 'tooMany') return done(BASE.tooMany)
    return done(BASE.server)
  }
  if (action === 'reset') {
    if (uncertain) return done(UNCERTAIN_RESET, { uncertain: true })
    if (kind === 'tooMany') return done(BASE.tooMany)
    if (status === 409 || status === 404 || status === 410 || status === 401 || status === 403 || (status === 400 && /enlace/i.test(detail))) return done(RESET_LINK_INVALID, { linkInvalid: true })
    if (kind === 'badRequest') return done('La contraseña no cumple los requisitos: usa entre 8 y 72 caracteres.')
    return done(BASE.server)
  }
  if (uncertain) return done(UNCERTAIN_CHANGE, { uncertain: true })
  if (kind === 'tooMany') return done(BASE.tooMany)
  if (status === 400 && /actual/i.test(detail)) return done('La contraseña actual no es correcta.')
  if (status === 409) return done('Tu cuenta cambió. Inicia sesión nuevamente.')
  if (kind === 'badRequest') return done('Revisa los datos ingresados: la nueva contraseña debe tener entre 8 y 72 caracteres.')
  // 403 es falta de permiso, no una sesión vencida (la sesión sigue abierta); 401 sí la invalida.
  if (status === 403) return done('Tu cuenta no tiene permiso para realizar esta acción.')
  if (kind === 'forbidden') return done('Tu sesión venció. Inicia sesión nuevamente.')
  return done(BASE.server)
}
