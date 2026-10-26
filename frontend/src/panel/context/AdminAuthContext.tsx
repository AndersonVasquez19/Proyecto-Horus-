import { AdminAuthContext } from './adminAuth';
import { ACCESS_DENIED_EVENT, SESSION_EXPIRED_EVENT } from './sessionEvents';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getCurrentAdmin } from '../services';
import { PanelApiError } from '../services/panelApi';
import type { AdminUser, SessionAccess } from '../types';
import { parseSession } from './sessionAccess';
import { RESTORE_FAILURE, classifySessionFailure, createRefreshGate, sameAccess, type RefreshReason, type SessionFailure } from './sessionRefresh';
const STORAGE_KEY = 'horus-admin-token';
// La respuesta de /admin/me no tiene la forma esperada (identidad o contrato de roles incompletos o incoherentes): no se concede nada.
class IncompatibleSessionError extends Error { constructor() { super(RESTORE_FAILURE.incompatible); } }
// Identidad y acceso de una sesión validada por el backend, siempre juntos: nunca hay un usuario sin su acceso ni al revés.
type Validated = { user: AdminUser; access: SessionAccess };
const sameUser = (a: AdminUser, b: AdminUser) => a.id === b.id && a.nombre === b.nombre && a.email === b.email;

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
  // Motivo por el que el último login correcto no llegó a abrir el panel (falló /admin/me); lo muestra la pantalla de login.
  const [loginFailure, setLoginFailure] = useState<SessionFailure | null>(null);
  // Sesión activa leída de forma síncrona: las respuestas y los 401 se comparan contra ella, no contra el estado de un render antiguo.
  const activeToken = useRef<string | null>(token);
  const userRef = useRef<AdminUser | null>(null);
  const accessRef = useRef<SessionAccess | null>(null);
  // Identidad y acceso cambian siempre a la vez (sin sesión validada, ambos a null).
  const setUser = useCallback((next: Validated | null) => {
    userRef.current = next?.user ?? null; accessRef.current = next?.access ?? null;
    setUserState(next?.user ?? null); setAccess(next?.access ?? null);
  }, []);
  // Token that the server has just issued together with its user (login); it needs no second validation.
  const issuedNow = useRef<string | null>(null);
  // Login correcto que todavía debe validarse con /admin/me (backend antiguo o respuesta incompleta), con el valor que había guardado
  // antes. Si la validación falla, ese token no abre nada: se descarta y se restablece lo anterior.
  const pendingLogin = useRef<{ token: string; previous: string | null } | null>(null);
  // Intervalo mínimo entre revalidaciones de la sesión abierta (foco, pestaña visible o tras un 403).
  const [gate] = useState(createRefreshGate);
  // Token de OTRA pestaña que el backend ya validó como de esta misma cuenta (con la identidad y el acceso que informó): espera,
  // sin cambiar nada, a que el actual falle (401). Si el rol cambió, ese 401 llega con el acceso nuevo ya validado.
  const alternate = useRef<(Validated & { token: string }) | null>(null);
  const probing = useRef<string | null>(null);

  // Sustituye la sesión activa descartando la identidad anterior. Nunca escribe en localStorage: lo usan los cambios que vienen de otra pestaña.
  const adopt = useCallback((next: string | null, reason: 'expired' | 'logout' | null = null) => {
    issuedNow.current = null; activeToken.current = next; alternate.current = null; pendingLogin.current = null;
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
      issuedNow.current = candidate; activeToken.current = candidate; alternate.current = null; pendingLogin.current = null; gate.mark();
      setUser(validated); setSessionError(''); setChecking(false); setEndReason(null); setToken(candidate);
    }).catch(error => {
      // Token rechazado: se restablece el último válido. Cualquier otro fallo (red, 503) no cambia nada y se reintenta en el siguiente aviso.
      if (error instanceof PanelApiError && error.status === 401 && activeToken.current === base && readSavedToken() === candidate && base) saveToken(base);
    }).finally(() => { window.clearTimeout(timer); if (probing.current === candidate) probing.current = null; });
  }, [setUser, gate]);
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
  // Login correcto sin acceso comprobado (falló /admin/me): no queda una sesión a medias. El token emitido se descarta (sin tocar uno más
  // nuevo de otra pestaña: se restablece lo que había) y la pantalla de login explica el motivo y se libera para volver a intentarlo.
  const failLogin = useCallback((failed: string, failure: SessionFailure) => {
    const previous = pendingLogin.current?.token === failed ? pendingLogin.current.previous : null;
    if (readSavedToken() === failed) saveToken(previous);
    adopt(null); setLoginFailure(failure);
  }, [adopt]);
  // Cierra la sesión `expired` solo si sigue siendo la activa y sin borrar de localStorage una sesión más nueva.
  const expire = useCallback((expired: string) => {
    if (activeToken.current !== expired) return;
    if (pendingLogin.current?.token === expired) { failLogin(expired, 'unauthorized'); return; } // el 401 llega antes por el aviso de panelRequest
    if (syncFromStorage(true)) return;
    if (readSavedToken() === expired) saveToken(null);
    adopt(null, 'expired');
  }, [adopt, syncFromStorage, failLogin]);

  useEffect(() => {
    if (!token) return;
    gate.mark(); // validación inicial, sesión recién emitida, reintento o revalidación: cuenta para el intervalo mínimo
    if (issuedNow.current === token) { issuedNow.current = null; return; }
    const controller = new AbortController();
    let current = true;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    getCurrentAdmin(token, controller.signal).then(response => {
      if (!current || activeToken.current !== token) return; // respuesta de una sesión o de una comprobación antiguas
      const parsed = parseSession(response); // identidad y contrato de roles (nuevo, antiguo o inválido); lo inválido no concede nada
      if (parsed.kind === 'invalid') throw new IncompatibleSessionError();
      if (pendingLogin.current?.token === token) pendingLogin.current = null;
      // Revalidación de la sesión abierta: si el backend informa otro acceso (rol o permisos cambiados) se adopta y el panel desmonta lo
      // que ya no está autorizado; si nada cambió se conservan los mismos objetos y el panel no se vuelve a renderizar.
      const user = userRef.current && sameUser(userRef.current, parsed.user) ? userRef.current : parsed.user;
      const access = accessRef.current && sameAccess(accessRef.current, parsed.access) ? accessRef.current : parsed.access;
      if (user !== userRef.current || access !== accessRef.current) setUser({ user, access });
      setSessionError('');
    }).catch(error => {
      if (!current || activeToken.current !== token) return;
      const failure = classifySessionFailure(error, error instanceof IncompatibleSessionError);
      if (pendingLogin.current?.token === token) { failLogin(token, failure); return; }
      if (failure === 'unauthorized') { setUser(null); expire(token); }
      else if (!userRef.current) { setUser(null); setSessionError(RESTORE_FAILURE[failure]); }
      // Con la sesión ya validada, ni un fallo pasajero (red, 503) ni un 403 ni una respuesta incompatible cambian el acceso conocido ni
      // desmontan el panel: no se inventan permisos ni se toma como una revocación. Si el token fuera inválido, el siguiente 401 cierra la sesión.
    }).finally(() => { window.clearTimeout(timeout); if (current && activeToken.current === token) setChecking(false); });
    return () => { current = false; controller.abort(); window.clearTimeout(timeout); };
  }, [token, revision, expire, failLogin, setUser, gate]);

  // Vuelve a consultar /admin/me para la sesión ya validada (sin pantalla de carga ni desmontar nada), respetando el intervalo mínimo.
  const revalidate = useCallback((reason: RefreshReason) => {
    if (!activeToken.current || !userRef.current || issuedNow.current === activeToken.current) return;
    if (gate.request(reason)) setRevision(value => value + 1);
  }, [gate]);

  useEffect(() => {
    const onExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ token?: string | null }>).detail;
      if (!detail || detail.token === undefined) { // aviso sin sesión de origen: se revalida en lugar de cerrar a ciegas
        if (activeToken.current) { if (!userRef.current) setChecking(true); setSessionError(''); setRevision(value => value + 1); }
        return;
      }
      if (detail.token) expire(detail.token); // un 401 de otra sesión (o sin sesión) no afecta a la activa
    };
    // Un 403 de la sesión activa no la cierra: los permisos pudieron cambiar, así que se vuelven a consultar (como mucho uno cada 5 s).
    const onDenied = (event: Event) => {
      const detail = (event as CustomEvent<{ token?: string | null }>).detail;
      if (detail?.token && detail.token === activeToken.current) revalidate('denied');
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY) syncFromStorage();
    };
    // Al volver a la ventana o a la pestaña: primero, si otra pestaña cambió la sesión; si no, se revalida el acceso (como mucho uno cada 30 s).
    const onVisible = () => { if (document.visibilityState === 'visible' && !syncFromStorage()) revalidate('focus'); };
    const onFocus = () => { if (!syncFromStorage()) revalidate('focus'); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    window.addEventListener(ACCESS_DENIED_EVENT, onDenied);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      window.removeEventListener(ACCESS_DENIED_EVENT, onDenied);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [expire, syncFromStorage, revalidate]);

  const value = useMemo(() => ({
    user, access, token, checking, sessionError, endReason, loginFailure, isAuthenticated: Boolean(token && user && access),
    retrySession: () => { setChecking(true); setSessionError(''); setRevision(value => value + 1); },
    login: (value: string, response?: unknown) => {
      const previous = readSavedToken();
      saveToken(value); // antes del render: otra pestaña (o un cambio de visibilidad) no debe ver aún la sesión anterior
      activeToken.current = value; alternate.current = null; pendingLogin.current = null; setSessionError(''); setEndReason(null); setLoginFailure(null);
      // El login se da por listo sin otra consulta SOLO con el contrato completo y coherente. Un backend antiguo (sin `acceso`) o una
      // respuesta incompleta se validan con /admin/me antes de abrir el panel: nunca se supone un rol ni se completan datos que faltan.
      const parsed = parseSession(response);
      if (parsed.kind === 'roles') { issuedNow.current = value; setUser({ user: parsed.user, access: parsed.access }); setChecking(false); setToken(value); return; }
      issuedNow.current = null; pendingLogin.current = { token: value, previous: previous === value ? null : previous };
      setChecking(true); setUser(null); setToken(value);
    },
    logout: () => { saveToken(null); adopt(null, 'logout'); },
  }), [user, access, token, checking, sessionError, endReason, loginFailure, adopt, setUser]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}
