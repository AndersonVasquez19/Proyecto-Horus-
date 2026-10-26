import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, SubmitEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../context';
import { signupAccount } from '../services';
import { authError } from '../services/authErrors';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN, signupPayload, validateSignup } from '../services/signupForm';
import type { SignupField, SignupForm } from '../services/signupForm';
import AdminAuthLayout from '../components/AdminAuthLayout';
import AdminPasswordField from '../components/AdminPasswordField';
import PanelIcon from '../components/PanelIcon';

const SIGNUP_TIMEOUT_MS = 20_000;

// Indicaciones visuales de la contraseña: reflejan exactamente las reglas de signupForm (8 caracteres como mínimo, 72 bytes UTF-8 como máximo
// y confirmación igual). Son una ayuda; la validación que cuenta es la de validateSignup y la del backend. No se añaden reglas de complejidad.
function PasswordRules({ items }: { items: { met: boolean; text: string }[] }) {
  return (
    <ul className="admin-auth__rules">
      {items.map(item => (
        <li key={item.text} data-met={item.met}>
          <span className="admin-auth__rule-mark" aria-hidden="true">{item.met && <PanelIcon name="check" size={12} />}</span>
          <span>{item.text}<span className="admin-auth__sr-only">{item.met ? ' (cumplido)' : ' (pendiente)'}</span></span>
        </li>
      ))}
    </ul>
  );
}

// Registro público: cualquier visitante crea una cuenta, que nace SIN rol. Con ella inicia sesión de inmediato y usa su espacio básico
// (PanelBasicHome); las funciones administrativas llegan solo si la gerencia le asigna un rol (procedimiento auditado del backend). Ocultar opciones aquí
// no protege nada: la autorización la decide el backend.
export default function AdminRegister() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAdminAuth();
  const [form, setForm] = useState<SignupForm>({ nombre: '', email: '', password: '', confirmPassword: '' });
  const [trap, setTrap] = useState(''); // campo trampa: invisible y fuera del orden de tabulación
  const [mensaje, setMensaje] = useState('');
  const [invalid, setInvalid] = useState<SignupField | null>(null);
  const [loading, setLoading] = useState(false);
  const locked = useRef(false); // candado síncrono: Enter repetido o doble clic no crean otra solicitud mientras hay una pendiente
  const attempt = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const errorBox = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; attempt.current?.abort(); };
  }, []);

  // El mensaje de error recibe el foco al aparecer.
  useEffect(() => { if (mensaje) errorBox.current?.focus(); }, [mensaje]);

  if (isAuthenticated) return <Navigate to="/admin/dashboard" replace />;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setForm(previous => ({ ...previous, [name]: value }));
    setMensaje(''); setInvalid(null);
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current) return;
    const problem = validateSignup(form);
    if (problem) { setInvalid(problem.field); setMensaje(problem.message); return; }
    locked.current = true;
    setLoading(true); setMensaje(''); setInvalid(null);
    const controller = new AbortController(); attempt.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, SIGNUP_TIMEOUT_MS);
    try {
      await signupAccount(signupPayload(form, trap), controller.signal);
      if (attempt.current !== controller || !alive.current) return;
      // Éxito confirmado por el servidor: la pantalla de inicio de sesión lo anuncia. No se inicia sesión automáticamente.
      navigate('/admin/login', { replace: true, state: { registered: true } });
    } catch (error) {
      if (attempt.current !== controller || !alive.current || (controller.signal.aborted && !timedOut)) return;
      const result = authError('register', error, timedOut);
      if ((error as { status?: unknown } | null)?.status === 409) setInvalid('email');
      setMensaje(result.message); // los datos ingresados se conservan para corregirlos o volver a intentarlo
    } finally {
      window.clearTimeout(timer);
      if (attempt.current === controller) { attempt.current = null; locked.current = false; }
      if (alive.current) setLoading(false);
    }
  };

  const describedBy = (field: SignupField) => (invalid === field ? 'register-error' : undefined);
  const lengthOk = form.password.length >= PASSWORD_MIN && new TextEncoder().encode(form.password).length <= PASSWORD_MAX_BYTES;
  const matchOk = form.confirmPassword.length > 0 && form.password === form.confirmPassword;

  return (
    <AdminAuthLayout registration backToPanel={false} current="register" eyebrow="Comienza aquí" title="Crea tu cuenta"
      description="Completa tus datos para registrarte.">
      <p className="admin-auth__notice" data-register-authorization>
        Podrás iniciar sesión en cuanto crees tu cuenta y usar tu espacio personal. Las funciones de administración requieren permisos
        adicionales que asigna la gerencia.
      </p>
      <form className="admin-auth__form" onSubmit={handleSubmit} aria-busy={loading} noValidate>
        <fieldset className="admin-auth__fields" disabled={loading}>
          <legend className="admin-auth__sr-only">Datos de la nueva cuenta</legend>
          <div className="admin-auth__field">
            <label htmlFor="nombre">Nombre completo</label>
            <div className="admin-auth__input"><PanelIcon name="user" size={18} /><input id="nombre" name="nombre" value={form.nombre} onChange={handleChange}
              autoComplete="name" placeholder="Nombre y apellido" maxLength={100} required
              aria-invalid={invalid === 'nombre' ? true : undefined} aria-describedby={describedBy('nombre')} /></div>
          </div>
          <div className="admin-auth__field">
            <label htmlFor="email">Correo electrónico</label>
            <div className="admin-auth__input"><PanelIcon name="mail" size={18} /><input id="email" name="email" type="email" value={form.email} onChange={handleChange}
              autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="nombre@ejemplo.com" maxLength={254} required
              aria-invalid={invalid === 'email' ? true : undefined} aria-describedby={describedBy('email')} /></div>
          </div>
          <AdminPasswordField id="password" label="Contraseña" value={form.password} onChange={handleChange}
            autoComplete="new-password" minLength={8} maxLength={72}
            hint={<PasswordRules items={[{ met: lengthOk, text: 'Entre 8 y 72 caracteres (las tildes y la ñ cuentan doble)' }]} />}
            invalid={invalid === 'password'} describedBy={describedBy('password')} />
          <AdminPasswordField id="confirmPassword" label="Confirmar contraseña" value={form.confirmPassword}
            onChange={handleChange} autoComplete="new-password" minLength={8} maxLength={72}
            hint={<PasswordRules items={[{ met: matchOk, text: 'Coincide con la contraseña' }]} />}
            invalid={invalid === 'confirmPassword'} describedBy={describedBy('confirmPassword')} />
          <div className="admin-auth__sr-only" aria-hidden="true">
            <label htmlFor="website">Sitio web (no completar)</label>
            <input id="website" name="website" value={trap} onChange={event => setTrap(event.target.value)} tabIndex={-1} autoComplete="off" />
          </div>
        </fieldset>
        {mensaje && <p id="register-error" ref={errorBox} tabIndex={-1} className="admin-auth__error" role="alert">{mensaje}</p>}
        <button className="admin-auth__submit" type="submit" disabled={loading}>
          {loading && <span className="admin-auth__spinner" aria-hidden="true" />}
          {loading ? 'Creando cuenta…' : 'Crear cuenta'}
          {!loading && <span aria-hidden="true">→</span>}
        </button>
      </form>
      <p className="admin-auth__switch">¿Ya tienes una cuenta? <Link to="/admin/login">Iniciar sesión</Link></p>
      <p className="admin-auth__note">Conoce cómo tratamos tus datos en nuestra <Link to="/politicas/privacidad">política de privacidad</Link>.</p>
    </AdminAuthLayout>
  );
}
