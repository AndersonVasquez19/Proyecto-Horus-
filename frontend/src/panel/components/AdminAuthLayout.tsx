import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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

export default function AdminAuthLayout({ children, eyebrow, title, description, registration = false, backToPanel = registration, current }: AdminAuthLayoutProps) {
  useEffect(() => {
    document.title = `${title} — Horus Group`;
  }, [title]);

  return (
    <main className="admin-auth">
      <section className="admin-auth__showcase" aria-label="Horus Group">
        <Link className="admin-auth__brand" to="/" aria-label="Ir al inicio de Horus Group">
          <HorusBrand light />
        </Link>
        <div className="admin-auth__showcase-content">
          <span className="admin-auth__eyebrow">Tecnología que conecta</span>
          <h2>Un equipo.<br />Una visión.<br /><em>Más posibilidades.</em></h2>
          <p>El espacio donde tus ideas se convierten en el siguiente paso de Horus.</p>
          <div className="admin-auth__capabilities">
            <div><span><PanelIcon name="book" size={21} /></span><div><strong>Comparte conocimiento</strong><small>Gestiona cursos y capacitaciones.</small></div></div>
            <div><span><PanelIcon name="tools" size={21} /></span><div><strong>Haz crecer tu propuesta</strong><small>Da visibilidad a tus servicios y proyectos.</small></div></div>
            <div><span><PanelIcon name="mail" size={21} /></span><div><strong>Conecta con tu comunidad</strong><small>Atiende cada consulta desde un solo lugar.</small></div></div>
          </div>
        </div>
        <div className="admin-auth__showcase-footer">
          <span>HORUS GROUP SRL</span>
          <span>Hecho para seguir creciendo <span aria-hidden="true">↗</span></span>
        </div>
      </section>
      <section className="admin-auth__form-side" aria-labelledby="auth-title">
        <div className="admin-auth__topline">
          <Link className="admin-auth__back" to={backToPanel ? '/admin/dashboard' : '/'}>
            <span aria-hidden="true">←</span> {backToPanel ? 'Volver al panel' : 'Volver al sitio web'}
          </Link>
          <span className="admin-auth__access"><PanelIcon name="shield" size={15} />Administración</span>
        </div>
        <div className="admin-auth__form-wrap">
          <Link className="admin-auth__mobile-brand" to="/" aria-label="Ir al inicio de Horus Group"><HorusBrand /></Link>
          <nav className="admin-auth__navigation" aria-label="Acceso administrativo">
            <Link to="/admin/login" aria-current={current === 'login' ? 'page' : undefined}>Iniciar sesión</Link>
            <Link to="/admin/register" aria-current={current === 'register' ? 'page' : undefined}>Crear cuenta</Link>
          </nav>
          <div className="admin-auth__form-icon"><PanelIcon name={registration ? 'user-plus' : 'lock'} size={25} /></div>
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
