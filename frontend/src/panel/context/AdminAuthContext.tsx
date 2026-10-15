import { AdminAuthContext } from './adminAuth';
import { SESSION_EXPIRED_EVENT } from './sessionEvents';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getCurrentAdmin } from '../services';
import { PanelApiError } from '../services/panelApi';
import type { AdminUser, SessionAccess } from '../types';
import { parseSession } from './sessionAccess';
const STORAGE_KEY = 'horus-admin-token';
// La respuesta de /admin/me no tiene la forma esperada (identidad o contrato de roles incompletos o incoherentes): no se concede nada.
const INCOMPATIBLE_SESSION = 'La respuesta del servidor no es compatible con este panel. Inténtalo más tarde.';
class IncompatibleSessionError extends Error { constructor() { super(INCOMPATIBLE_SESSION); } }
// Identidad y acceso de una sesión validada por el backend, siempre juntos: nunca hay un usuario sin su acceso ni al revés.
type Validated = { user: AdminUser; access: SessionAccess };

// Pestañas del mismo origen: el token vive en localStorage y el evento `storage` avisa a las demás pestañas.
// Si el navegador bloquea localStorage la sesión funciona solo en memoria y NO se sincroniza entre pestañas
// (cada pestaña conserva su propia sesión hasta que expire o se cierre).
function storageWorks() {
  try { localStorage.getItem(STORAGE_KEY); return true; } catch { return false; }
}
function readSavedToken() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function saveToken(token: string | null) {
  try {
    if (token) { if (localStorage.getItem(STORAGE_KEY) !== token) localStorage.setItem(STORAGE_KEY, token); }
    else if (localStorage.getItem(STORAGE_KEY) !== null) localStorage.removeItem(STORAGE_KEY);
  } catch { /* La sesión actual funciona en memoria si el navegador bloquea su persistencia. */ }
}
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readSavedToken);
  const [user, setUserState] = useState<AdminUser | null>(null);
  const [access, setAccess] = useState<SessionAccess | null>(null);
  const [checking, setChecking] = useState(() => Boolean(token));
  const [sessionError, setSessionError] = useState('');
  const [endReason, setEndReason] = useState<'expired' | 'logout' | null>(null);
  const [revision, setRevision] = useState(0);
  // Sesión activa leída de forma síncrona: las respuestas y los 401 se comparan contra ella, no contra el estado de un render antiguo.
  const activeToken = useRef<string | null>(token);
  const userRef = useRef<AdminUser | null>(null);
  // Identidad y acceso cambian siempre a la vez (sin sesión validada, ambos a null).
  const setUser = useCallback((next: Validated | null) => { userRef.current = next?.user ?? null; setUserState(next?.user ?? null); setAccess(next?.access ?? null); }, []);
  // Token that the server has just issued together with its user (login); it needs no second validation.
  const issuedNow = useRef<string | null>(null);
  // Token de OTRA pestaña que el backend ya validó como de esta misma cuenta (con la identidad y el acceso que informó): espera,
  // sin cambiar nada, a que el actual falle (401). Si el rol cambió, ese 401 llega con el acceso nuevo ya validado.
  const alternate = useRef<(Validated & { token: string }) | null>(null);
  const probing = useRef<string | null>(null);

  // Sustituye la sesión activa descartando la identidad anterior. Nunca escribe en localStorage: lo usan los cambios que vienen de otra pestaña.
  const adopt = useCallback((next: string | null, reason: 'expired' | 'logout' | null = null) => {
    issuedNow.current = null; activeToken.current = next; alternate.current = null;
    setUser(null); setSessionError(''); setChecking(Boolean(next)); setToken(next); setEndReason(next ? null : reason);
  }, [setUser]);
  // Valida con el backend un token distinto que apareció en localStorage. Hasta que /admin/me responde bien, ese token NO autentica nada
  // (no se interpreta el contenido del JWT): la sesión validada que ya tiene esta pestaña sigue siendo la única válida.
  const probe = useCallback((candidate: string) => {
    if (probing.current === candidate || alternate.current?.token === candidate) return;
    const base = activeToken.current;
    probing.current = candidate;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    getCurrentAdmin(candidate, controller.signal).then(response => {
      const parsed = parseSession(response);
      if (activeToken.current !== base || readSavedToken() !== candidate || parsed.kind === 'invalid') return; // algo cambió, o una respuesta que no se puede interpretar: no se adopta
      const validated = { user: parsed.user, access: parsed.access };
      if (userRef.current && validated.user.id === userRef.current.id) { alternate.current = { ...validated, token: candidate }; return; } // misma cuenta: queda en reserva
      // Otra cuenta, confirmada por el backend: la sesión de esta pestaña cambia y el panel se vuelve a montar con la identidad nueva.
      issuedNow.current = candidate; activeToken.current = candidate; alternate.current = null;
      setUser(validated); setSessionError(''); setChecking(false); setEndReason(null); setToken(candidate);
    }).catch(error => {
      // Token rechazado: se restablece el último válido. Cualquier otro fallo (red, 503) no cambia nada y se reintenta en el siguiente aviso.
      if (error instanceof PanelApiError && error.status === 401 && activeToken.current === base && readSavedToken() === candidate && base) saveToken(base);
    }).finally(() => { window.clearTimeout(timer); if (probing.current === candidate) probing.current = null; });
  }, [setUser]);
  // Si localStorage ya contiene otra sesión (otra pestaña inició o cerró sesión):
  //  - sin identidad validada en esta pestaña, se adopta y se valida con /admin/me (estado "cargando" o error recuperable con Reintentar);
  //  - con una sesión validada, el token distinto se valida en segundo plano (probe); no se adopta hasta que el backend lo confirme;
  //  - applyNow (el token actual acaba de fallar con 401): se usa el de reserva ya validado; si no hay, se adopta y se valida con /admin/me.
  const syncFromStorage = useCallback((applyNow = false) => {
    if (!storageWorks()) return false;
    const saved = readSavedToken();
    if (saved === activeToken.current) return false;
    if (!saved) { alternate.current = null; adopt(null, 'logout'); return true; }
    if (!userRef.current) { adopt(saved); return true; } // otra cuenta o sin identidad validada: el panel no se conserva
    if (!applyNow) { probe(saved); return false; }
    if (alternate.current?.token === saved) { // misma cuenta, ya validada: se cambia en silencio, el panel y sus formularios siguen montados
      const { user, access } = alternate.current; // con el acceso que informó el backend para esa sesión (puede diferir si el rol cambió)
      issuedNow.current = saved; activeToken.current = saved; alternate.current = null; setUser({ user, access }); setSessionError(''); setToken(saved);
      return true;
    }
    adopt(saved); // no validado: no se confía en él; hasta que /admin/me responda bien la pestaña NO está autenticada
    return true;
  }, [adopt, probe, setUser]);
  // Cierra la sesión `expired` solo si sigue siendo la activa y sin borrar de localStorage una sesión más nueva.
  const expire = useCallback((expired: string) => {
    if (activeToken.current !== expired) return;
    if (syncFromStorage(true)) return;
    if (readSavedToken() === expired) saveToken(null);
    adopt(null, 'expired');
  }, [adopt, syncFromStorage]);

  useEffect(() => {
    if (!token) return;
    if (issuedNow.current === token) { issuedNow.current = null; return; }
    const controller = new AbortController();
    let current = true;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    getCurrentAdmin(token, controller.signal).then(response => {
      if (!current || activeToken.current !== token) return; // respuesta de una sesión o de una comprobación antiguas
      const parsed = parseSession(response); // identidad y contrato de roles (nuevo, antiguo o inválido); lo inválido no concede nada
      if (parsed.kind === 'invalid') throw new IncompatibleSessionError();
      setUser({ user: parsed.user, access: parsed.access }); setSessionError('');
    }).catch(error => {
      if (!current || activeToken.current !== token) return;
      if (error instanceof PanelApiError && error.status === 401) { setUser(null); expire(token); }
      else if (!userRef.current) { setUser(null); setSessionError(error instanceof IncompatibleSessionError ? INCOMPATIBLE_SESSION : 'No pudimos validar tu sesión. Puedes reintentar cuando el servidor esté disponible.'); }
      // Con la misma cuenta ya visible, un fallo pasajero de red no desmonta el panel ni descarta lo que se está editando: si el token fuera inválido, el siguiente 401 cierra la sesión.
    }).finally(() => { window.clearTimeout(timeout); if (current && activeToken.current === token) setChecking(false); });
    return () => { current = false; controller.abort(); window.clearTimeout(timeout); };
  }, [token, revision, expire, setUser]);

  useEffect(() => {
    const onExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ token?: string | null }>).detail;
      if (!detail || detail.token === undefined) { // aviso sin sesión de origen: se revalida en lugar de cerrar a ciegas
        if (activeToken.current) { if (!userRef.current) setChecking(true); setSessionError(''); setRevision(value => value + 1); }
        return;
      }
      if (detail.token) expire(detail.token); // un 401 de otra sesión (o sin sesión) no afecta a la activa
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY) syncFromStorage();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') syncFromStorage(); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [expire, syncFromStorage]);

  const value = useMemo(() => ({
    user, access, token, checking, sessionError, endReason, isAuthenticated: Boolean(token && user && access),
    retrySession: () => { setChecking(true); setSessionError(''); setRevision(value => value + 1); },
    login: (value: string, response?: unknown) => {
      saveToken(value); // antes del render: otra pestaña (o un cambio de visibilidad) no debe ver aún la sesión anterior
      activeToken.current = value; alternate.current = null; setSessionError(''); setEndReason(null);
      // El login se da por listo sin otra consulta SOLO con el contrato completo y coherente. Un backend antiguo (sin `acceso`) o una
      // respuesta incompleta se validan con /admin/me antes de abrir el panel: nunca se supone un rol ni se completan datos que faltan.
      const parsed = parseSession(response);
      if (parsed.kind === 'roles') { issuedNow.current = value; setUser({ user: parsed.user, access: parsed.access }); setChecking(false); setToken(value); return; }
      issuedNow.current = null; setChecking(true); setUser(null); setToken(value);
    },
    logout: () => { saveToken(null); adopt(null, 'logout'); },
  }), [user, access, token, checking, sessionError, endReason, adopt, setUser]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}
