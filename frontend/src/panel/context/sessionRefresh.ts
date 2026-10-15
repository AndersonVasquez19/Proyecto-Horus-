// Revalidación de la sesión con /admin/me mientras el panel está abierto (H-BACK-01, E3.4.4, fase 1). Módulo puro, sin React ni red
// (lo cargan también las pruebas de Node).
//
// El backend es la fuente de verdad: el panel no decodifica el JWT ni tiene matriz de permisos. Para no conservar indefinidamente un
// acceso desactualizado vuelve a preguntar a /admin/me al recuperar el foco (o volver a la pestaña) y después de un 403, siempre con
// un intervalo mínimo entre consultas para no generar ráfagas ni bucles. Sigue siendo solo interfaz: no protege nada.
import type { SessionAccess } from './sessionAccess';

export const REFRESH_ON_FOCUS_MS = 30_000; // foco o pestaña visible: como mucho una consulta cada 30 s
export const REFRESH_AFTER_DENIED_MS = 5_000; // tras un 403 (los permisos pudieron cambiar): como mucho una cada 5 s
export type RefreshReason = 'focus' | 'denied';

export interface RefreshGate {
  // ¿Toca volver a consultar /admin/me? Si la respuesta es sí, la consulta queda registrada y las siguientes se limitan.
  request(reason: RefreshReason): boolean;
  // Registra una validación hecha por otro camino (login, restauración, reintento).
  mark(): void;
}

// `now` se lee en cada llamada (reloj monótono del navegador).
export function createRefreshGate(now: () => number = () => performance.now()): RefreshGate {
  let last = Number.NEGATIVE_INFINITY;
  return {
    request(reason) {
      const time = now();
      if (time - last < (reason === 'denied' ? REFRESH_AFTER_DENIED_MS : REFRESH_ON_FOCUS_MS)) return false;
      last = time;
      return true;
    },
    mark() { last = now(); },
  };
}

// ¿Informó el backend el mismo acceso? (el orden de los permisos no importa). Evita volver a renderizar el panel cuando nada cambió.
export function sameAccess(a: SessionAccess | null | undefined, b: SessionAccess | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.contract !== b.contract || a.mode !== b.mode || a.rol !== b.rol || a.permisos.length !== b.permisos.length) return false;
  const granted = new Set(a.permisos);
  return b.permisos.every(permission => granted.has(permission));
}

// Por qué falló una validación con /admin/me:
//  - unauthorized (401): la sesión no es válida; se aplica el cierre de siempre.
//  - forbidden (403): el servidor no permitió consultar la sesión. NO es una revocación: no cierra la sesión ni concede nada.
//  - temporary: red caída, timeout, 408, 429 o 5xx; se puede reintentar.
//  - incompatible: respuesta que no es la de este backend (forma inesperada, cuerpo ilegible o una ruta que no existe).
export type SessionFailure = 'unauthorized' | 'forbidden' | 'temporary' | 'incompatible';

export function classifySessionFailure(error: unknown, incompatible = false): SessionFailure {
  if (incompatible) return 'incompatible';
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return 'temporary'; // fetch sin respuesta (TypeError) o cancelado por timeout (AbortError)
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 408 || status === 429 || status >= 500) return 'temporary';
  return 'incompatible'; // 2xx con cuerpo ilegible, 404 u otro 4xx: no es la respuesta esperada
}

// Login correcto cuya validación con /admin/me falló: el panel no se abre y el token emitido se descarta (sin acceso comprobado no
// hay sesión). Basta con volver a enviar el formulario (los datos ingresados se conservan). Nunca se muestra el texto del servidor.
export const LOGIN_FAILURE: Readonly<Record<SessionFailure, string>> = Object.freeze({
  unauthorized: 'No pudimos abrir tu sesión: el servidor no la aceptó. Inicia sesión nuevamente.',
  forbidden: 'No pudimos abrir tu sesión: el servidor no permitió comprobar el acceso de tu cuenta. Si el problema continúa, consúltalo con la gerencia.',
  temporary: 'No pudimos abrir tu sesión porque el servidor no respondió. Inténtalo nuevamente en unos minutos.',
  incompatible: 'No pudimos abrir tu sesión: la respuesta del servidor no es compatible con este panel. Inténtalo más tarde.',
});

// Sesión guardada (recarga o pestaña nueva) que no se pudo validar: se conserva (no es un 401) y se ofrece «Reintentar».
export const RESTORE_FAILURE: Readonly<Record<Exclude<SessionFailure, 'unauthorized'>, string>> = Object.freeze({
  forbidden: 'No pudimos comprobar el acceso de tu cuenta. Puedes reintentar; si el problema continúa, consúltalo con la gerencia.',
  temporary: 'No pudimos validar tu sesión. Puedes reintentar cuando el servidor esté disponible.',
  incompatible: 'La respuesta del servidor no es compatible con este panel. Inténtalo más tarde.',
});

// Mensaje uniforme de un 403 en cualquier operación del panel: no cierra la sesión ni dice que venció, y no usa el texto del servidor.
// Empieza igual que los avisos locales de E3.4.3 («Tu cuenta no tiene permiso para realizar esta acción.»).
export const ACCESS_DENIED = 'Tu cuenta no tiene permiso para realizar esta acción. Si lo necesitas, consúltalo con la gerencia.';
