// Aviso de que el servidor rechazó (HTTP 401) una petición autenticada. El evento lleva el token con el que se
// hizo la petición: el contexto solo cierra la sesión si ese token sigue siendo el de la sesión activa, de modo que
// un error tardío de una sesión anterior no cierra la sesión nueva.
export const SESSION_EXPIRED_EVENT = 'horus:session-expired'

export function reportExpiredSession(token: string | null | undefined) {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token: token ?? null } }))
}

// Aviso de que el servidor denegó (HTTP 403) una operación con una sesión válida. NO cierra la sesión: los permisos pudieron cambiar,
// así que el contexto vuelve a consultar /admin/me (con un intervalo mínimo) si el token sigue siendo el de la sesión activa.
export const ACCESS_DENIED_EVENT = 'horus:access-denied'

export function reportAccessDenied(token: string | null | undefined) {
  window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT, { detail: { token: token ?? null } }))
}
