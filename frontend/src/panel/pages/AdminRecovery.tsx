import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AdminAuthLayout from '../components/AdminAuthLayout';
import { panelRequest } from '../services/panelApi';
import { RESET_LINK_INVALID, authError } from '../services/authErrors';

const REQUEST_TIMEOUT_MS = 20_000;
// Respuesta fija: no depende de la del servidor y nunca revela si el correo pertenece a una cuenta.
const FORGOT_DONE = 'Si el correo corresponde a una cuenta activa, recibirás un enlace de recuperación. Revisa también la carpeta de spam.';
const RESET_DONE = 'Tu contraseña fue actualizada. Inicia sesión con la nueva contraseña.';

export default function AdminRecovery({ reset = false }: { reset?: boolean }) {
  const [params, setParams] = useSearchParams();
  // El token se conserva solo en memoria de esta pantalla: se retira de la URL cuando ya no sirve (usado o inválido) para que no quede en el historial.
  const [token] = useState(() => params.get('token') || '');
  const stripToken = () => { if (reset && params.has('token')) setParams(new URLSearchParams(), { replace: true }); };
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false), [linkInvalid, setLinkInvalid] = useState(false);
  const locked = useRef(false); // un solo envío pendiente aunque lleguen dos eventos submit en el mismo instante
  const attempt = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const message = useRef<HTMLParagraphElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; attempt.current?.abort(); };
  }, []);
  // El mensaje (error o confirmación) recibe el foco al aparecer.
  useEffect(() => { if ((error || done) && !mismatch) message.current?.focus(); }, [error, done, mismatch]); // con contraseñas distintas el foco va al campo, no al mensaje

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current) return;
    setError(''); setMismatch(false);
    if (reset && password !== confirm) { setMismatch(true); setError('Las contraseñas no coinciden.'); confirmInput.current?.focus(); return; }
    locked.current = true; setBusy(true);
    const controller = new AbortController(); attempt.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      // Un solo intento: ni un timeout ni un error ilegible se reintentan solos, porque el servidor pudo haber aplicado la operación.
      await panelRequest(reset ? 'reset-password' : 'forgot-password', null, 'POST', reset ? { token, password } : { email: email.trim() }, controller.signal);
      if (controller.signal.aborted || attempt.current !== controller || !alive.current) return;
      setPassword(''); setConfirm(''); setDone(true); stripToken();
    } catch (caught) {
      if (attempt.current !== controller || !alive.current || (controller.signal.aborted && !timedOut)) return;
      const failure = authError(reset ? 'reset' : 'forgot', caught, timedOut);
      if (failure.linkInvalid) { setPassword(''); setConfirm(''); setLinkInvalid(true); stripToken(); }
      setError(failure.message);
    } finally {
      window.clearTimeout(timer);
      if (attempt.current === controller) { attempt.current = null; locked.current = false; }
      if (alive.current) setBusy(false);
    }
  };

  const noLink = reset && (!token || linkInvalid);
  return <AdminAuthLayout eyebrow="Acceso al panel" title={reset ? 'Nueva contraseña' : 'Recuperar contraseña'}
    description={reset ? 'El enlace vence en 30 minutos y solo puede utilizarse una vez.' : 'Enviaremos un enlace al correo de tu cuenta.'}>
    {done ? <>
      <p ref={message} tabIndex={-1} role="status" className="admin-auth__success">{reset ? RESET_DONE : FORGOT_DONE}</p>
      <p className="admin-auth__forgot"><Link className={reset ? 'admin-auth__submit' : undefined} to="/admin/login">{reset ? 'Ir a iniciar sesión' : 'Volver al inicio de sesión'}</Link></p>
    </> : noLink ? <>
      <p ref={message} tabIndex={-1} role="alert" className="admin-auth__error">{error || (token ? RESET_LINK_INVALID : 'Falta el enlace de recuperación. Solicita uno nuevo.')}</p>
      <p className="admin-auth__forgot"><Link className="admin-auth__submit" to="/admin/forgot-password">Solicitar un enlace nuevo</Link></p>
      <p className="admin-auth__forgot"><Link to="/admin/login">Volver al inicio de sesión</Link></p>
    </> : <>
      <form className="admin-auth__form" onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy} className="admin-auth__fields admin-recovery-fields">
          {reset ? <>
            <label>Nueva contraseña<input type="password" autoComplete="new-password" value={password} minLength={8} maxLength={72} required
              onChange={e => { setPassword(e.target.value); setMismatch(false); }} /></label>
            <label>Repite la contraseña<input ref={confirmInput} type="password" autoComplete="new-password" value={confirm} maxLength={72} required
              aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'recovery-message' : undefined}
              onChange={e => { setConfirm(e.target.value); setMismatch(false); }} /></label>
          </> : <label>Correo electrónico<input type="email" autoComplete="email" value={email} maxLength={254} required
            aria-invalid={error ? true : undefined} aria-describedby={error ? 'recovery-message' : undefined}
            onChange={e => setEmail(e.target.value)} /></label>}
        </fieldset>
        {error && <p id="recovery-message" ref={message} tabIndex={-1} role="alert" className="admin-auth__error">{error}</p>}
        <button className="admin-auth__submit" type="submit" disabled={busy}>{busy ? 'Procesando…' : reset ? 'Guardar contraseña' : 'Solicitar enlace'}</button>
      </form>
      <p className="admin-auth__forgot"><Link to="/admin/login">Volver al inicio de sesión</Link></p>
    </>}
  </AdminAuthLayout>;
}
