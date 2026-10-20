import { startTransition, useEffect, useRef, useState } from 'react';
import type {ChangeEvent, SubmitEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../context';
import { loginAdmin } from '../services';
import { authError } from '../services/authErrors';
import { safeAdminReturn } from '../context/returnPath';
import { LOGIN_FAILURE } from '../context/sessionRefresh';
import AdminAuthLayout from '../components/AdminAuthLayout';
import AdminPasswordField from '../components/AdminPasswordField';
import PanelIcon from '../components/PanelIcon';

const LOGIN_TIMEOUT_MS = 20_000;

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: unknown; expired?: unknown; registered?: unknown } | null;
  const returnTo = safeAdminReturn(state?.from) ?? "/admin/dashboard"; // solo rutas internas del panel validadas
  const expired = state?.expired === true;
  const registered = state?.registered === true; // llegó desde un registro público confirmado por el servidor
  const { login, isAuthenticated, checking, loginFailure } = useAdminAuth();
  const awaitingPanel = useRef(false); // login correcto cuyo panel aún no se abrió (puede faltar validar la sesión con /admin/me)
  const [form, setForm] = useState({ email: '', password: '' });
  const [mensaje, setMensaje] = useState('');
  const [loading, setLoading] = useState(false);
  const locked = useRef(false); // candado síncrono: Enter repetido o requestSubmit no crean otra petición mientras hay una pendiente
  const attempt = useRef<AbortController | null>(null); // único intento vigente; sus respuestas tardías se descartan
  const alive = useRef(true);
  const errorBox = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; attempt.current?.abort(); }; // salir de la pantalla cancela el intento: un login tardío no autentica
  }, []);

  useEffect(() => {
    // As a transition, the login stays on screen until the panel is ready instead of flashing a loading page.
    if (isAuthenticated) startTransition(() => navigate(returnTo, { replace: true }));
  }, [isAuthenticated, navigate, returnTo]);

  // Tras un login correcto el formulario sigue bloqueado hasta abrir el panel. Si la validación con /admin/me falla (sesión rechazada,
  // 403, servidor caído o respuesta incompatible), el contexto ya descartó el token y el formulario se libera con el motivo, sin texto del
  // servidor; para reintentar basta con volver a enviarlo (los datos ingresados se conservan).
  useEffect(() => {
    if (!awaitingPanel.current || checking || isAuthenticated) return;
    awaitingPanel.current = false; locked.current = false;
    setLoading(false); setMensaje(loginFailure ? LOGIN_FAILURE[loginFailure] : 'No pudimos abrir tu sesión. Inténtalo nuevamente en unos minutos.');
  }, [checking, isAuthenticated, loginFailure]);

  // Download the panel while the user fills in the form so signing in opens it right away.
  useEffect(() => { void import('./AdminDashboard'); }, []);

  // El mensaje de error recibe el foco al aparecer.
  useEffect(() => { if (mensaje) errorBox.current?.focus(); }, [mensaje]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setForm(previous => ({ ...previous, [name]: value }));
    setMensaje('');
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setLoading(true);
    setMensaje('');
    const controller = new AbortController(); attempt.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, LOGIN_TIMEOUT_MS);
    let signedIn = false;
    try {
      const response = await loginAdmin({ ...form, email: form.email.trim() }, controller.signal);
      if (controller.signal.aborted || attempt.current !== controller || !alive.current) return; // intento antiguo o pantalla abandonada
      // A correct login is not a message: the form stays locked until the panel opens.
      signedIn = true;
      awaitingPanel.current = true;
      login(response.token, response); // el contexto decide si el contrato de roles viene completo o si hay que validar con /admin/me
    } catch (error) {
      if (attempt.current !== controller || !alive.current || (controller.signal.aborted && !timedOut)) return;
      setMensaje(authError('login', error, timedOut).message);
    } finally {
      window.clearTimeout(timer);
      if (attempt.current === controller) { attempt.current = null; if (!signedIn) locked.current = false; } // con sesión iniciada el formulario sigue bloqueado hasta abrir el panel
      if (!signedIn && alive.current) setLoading(false);
    }
  };

  return (
    <AdminAuthLayout eyebrow="Tu espacio" title="Inicia sesión" current="login"
      description="Ingresa con tu correo y tu contraseña.">
      {expired && <p className="admin-auth__notice" role="status">Tu sesión terminó. Inicia sesión de nuevo para continuar; los cambios que no estaban guardados no se conservaron.</p>}
      {registered && !expired && <p className="admin-auth__notice" role="status" data-register-done>Tu cuenta se creó correctamente. Ya puedes iniciar sesión; el acceso al panel requiere la autorización de la gerencia.</p>}
      <form className="admin-auth__form" onSubmit={handleSubmit} aria-busy={loading}>
        <fieldset className="admin-auth__fields" disabled={loading}>
          <legend className="admin-auth__sr-only">Datos de inicio de sesión</legend>
          <div className="admin-auth__field">
            <label htmlFor="email">Correo electrónico</label>
            <div className="admin-auth__input"><PanelIcon name="mail" size={18} /><input id="email" name="email" type="email" value={form.email} onChange={handleChange}
              autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="nombre@ejemplo.com" required
              aria-invalid={mensaje ? true : undefined} aria-describedby={mensaje ? 'login-error' : undefined} /></div>
          </div>
          <AdminPasswordField id="password" label="Contraseña" value={form.password}
            onChange={handleChange} autoComplete="current-password" invalid={Boolean(mensaje)} describedBy="login-error" />
        </fieldset>
        {mensaje && <p id="login-error" ref={errorBox} tabIndex={-1} className="admin-auth__error" role="alert">{mensaje}</p>}
        <button className="admin-auth__submit" type="submit" disabled={loading}>
          {loading && <span className="admin-auth__spinner" aria-hidden="true" />}
          {loading ? 'Ingresando…' : 'Iniciar sesión'}
          {!loading && <span aria-hidden="true">→</span>}
        </button>
      </form>
      <p className="admin-auth__forgot"><Link to="/admin/forgot-password">Olvidé mi contraseña</Link></p>
      <p className="admin-auth__switch">¿No tienes una cuenta? <Link to="/admin/register">Crear cuenta</Link></p>
    </AdminAuthLayout>
  );
}
