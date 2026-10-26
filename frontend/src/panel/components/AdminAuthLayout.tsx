import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import logo from '../../assets/images/logo-horus.png';
import HorusBrand from './HorusBrand';
import PanelIcon from './PanelIcon';

interface AdminAuthLayoutProps {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  registration?: boolean;
  backToPanel?: boolean;
  // Solo las páginas de inicio de sesión y de registro marcan su enlace como página actual; recuperación y restablecimiento no.
  current?: 'login' | 'register';
}

// Mensajes institucionales del panel visual (diseño acordado). Recuperación y restablecimiento usan el de inicio de sesión.
const SHOWCASE = {
  login: { eyebrow: 'Horus Group', title: 'Bienvenido a Horus Group.', text: 'Accede a tu espacio y continúa aprendiendo.' },
  register: { eyebrow: 'Horus Group', title: 'Forma parte de Horus Group.', text: 'Explora nuestros cursos, capacitaciones y servicios.' },
} as const;

export default function AdminAuthLayout({ children, eyebrow, title, description, registration = false, backToPanel = registration, current }: AdminAuthLayoutProps) {
  useEffect(() => {
    document.title = `${title} — Horus Group`;
  }, [title]);

  const showcase = registration ? SHOWCASE.register : SHOWCASE.login;

  return (
    <main className="admin-auth">
      <section className="admin-auth__showcase" aria-label="Horus Group">
        <div className="admin-auth__visual" aria-hidden="true">
          <span className="admin-auth__glow" />
          <img src={logo} alt="" width={588} height={425} decoding="async" />
        </div>
        <Link className="admin-auth__brand" to="/" aria-label="Ir al inicio de Horus Group">
          <HorusBrand light />
        </Link>
        <div className="admin-auth__showcase-content">
          <span className="admin-auth__eyebrow">{showcase.eyebrow}</span>
          <h2>{showcase.title}</h2>
          <p>{showcase.text}</p>
          <ul className="admin-auth__areas" aria-label="Qué ofrece Horus Group">
            <li><PanelIcon name="book" size={18} />Cursos</li>
            <li><PanelIcon name="calendar" size={18} />Capacitaciones</li>
            <li><PanelIcon name="tools" size={18} />Servicios</li>
          </ul>
        </div>
        <div className="admin-auth__showcase-footer">
          <span>HORUS GROUP SRL</span>
          <span>Cajamarca, Perú</span>
        </div>
      </section>
      <section className="admin-auth__form-side" aria-labelledby="auth-title">
        <div className="admin-auth__topline">
          <Link className="admin-auth__back" to={backToPanel ? '/admin/dashboard' : '/'}>
            <span aria-hidden="true">←</span> {backToPanel ? 'Volver al panel' : 'Volver al sitio web'}
          </Link>
        </div>
        <div className="admin-auth__form-wrap">
          <Link className="admin-auth__mobile-brand" to="/" aria-label="Ir al inicio de Horus Group"><HorusBrand /></Link>
          <nav className="admin-auth__navigation" aria-label="Acceso a la cuenta">
            <Link to="/admin/login" aria-current={current === 'login' ? 'page' : undefined}>Iniciar sesión</Link>
            <Link to="/admin/register" aria-current={current === 'register' ? 'page' : undefined}>Crear cuenta</Link>
          </nav>
          {current && <p className="admin-auth__mobile-welcome"><strong>{showcase.title}</strong> {showcase.text}</p>}
          <span className="admin-auth__eyebrow admin-auth__eyebrow--dark">{eyebrow}</span>
          <h1 id="auth-title">{title}</h1>
          <p className="admin-auth__description">{description}</p>
          {children}
        </div>
        <p className="admin-auth__footer">© {new Date().getFullYear()} Horus Group SRL <span aria-hidden="true">·</span> Tecnología y formación</p>
      </section>
    </main>
  );
}
