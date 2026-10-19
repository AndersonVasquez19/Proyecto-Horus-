import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { panelRequest } from '../services/panelApi';
import { authError } from '../services/authErrors';
import PanelIcon from './PanelIcon';
import { useUnsavedChanges } from '../unsaved/unsavedContext';

const REQUEST_TIMEOUT_MS = 20_000;

// "Ajustes": for now only the signed-in administrator's password.
export default function PanelPreferences() {
  const { token, logout } = useAdminAuth();
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [mismatch, setMismatch] = useState(false);
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  // Formulario de contraseñas: solo avisa si hay algo escrito. Nunca se guarda en ningún almacenamiento.
  useUnsavedChanges(Boolean(current || password || confirm), "cambio de contraseña");
  const locked = useRef(false); // un solo envío pendiente, también con Enter repetido o requestSubmit
  const attempt = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; attempt.current?.abort(); };
  }, []);
  useEffect(() => { if (actionError && !mismatch) errorBox.current?.focus(); }, [actionError, mismatch]); // con contraseñas distintas el foco va al campo, no al mensaje
  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault(); if (locked.current) return; setActionError(''); setMismatch(false);
    if (password !== confirm) { setMismatch(true); setActionError('Las contraseñas no coinciden.'); confirmInput.current?.focus(); return; }
    locked.current = true; setBusy(true);
    const controller = new AbortController(); attempt.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      // Un solo intento: si el resultado es incierto el servidor pudo haber cambiado la contraseña, así que no se repite ni se afirma lo contrario.
      await panelRequest('password', token, 'POST', { current_password: current, password }, controller.signal);
      if (controller.signal.aborted || attempt.current !== controller || !alive.current) return;
      logout();
    } catch (error) {
      if (attempt.current !== controller || !alive.current || (controller.signal.aborted && !timedOut)) return;
      setActionError(authError('change', error, timedOut).message);
    } finally {
      window.clearTimeout(timer);
      if (attempt.current === controller) { attempt.current = null; locked.current = false; }
      if (alive.current) setBusy(false);
    }
  };
  return <>
    <div className="hp-heading"><div><p className="hp-kicker">ESPACIO DE TRABAJO</p><h1>Ajustes</h1><p>Configura las preferencias de tu cuenta y del panel.</p></div></div>
    <section className="hp-card hp-password-card" aria-labelledby="password-title">
      <div className="hp-card-heading"><div><h2 id="password-title">Cambiar contraseña</h2></div><PanelIcon name="lock" /></div>
      {actionError && <p id="password-error" ref={errorBox} tabIndex={-1} role="alert" className="hp-error">{actionError}</p>}
      <form className="hp-form" onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          <label>Contraseña actual<input type="password" required maxLength={72} value={current} autoComplete="current-password" onChange={e => setCurrent(e.target.value)} /></label>
          <label>Nueva contraseña<input type="password" required minLength={8} maxLength={72} value={password} autoComplete="new-password" onChange={e => { setPassword(e.target.value); setMismatch(false); }} /></label>
          <label>Repite la nueva contraseña<input ref={confirmInput} type="password" required maxLength={72} value={confirm} autoComplete="new-password"
            aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'password-error' : undefined} onChange={e => { setConfirm(e.target.value); setMismatch(false); }} /></label>
        </fieldset>
        <p className="hp-form-hint">El cambio cierra las sesiones actuales; luego tendrás que iniciar sesión.</p>
        <button className="hp-btn hp-btn-primary" disabled={busy}>{busy ? 'Actualizando…' : 'Actualizar contraseña'}</button>
      </form>
    </section>
  </>;
}
