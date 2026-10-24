import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useConfirmLeave } from '../unsaved/unsavedContext';
import HorusBrand from '../components/HorusBrand';
import { useAdminAuth } from '../context';
import PanelIcon from '../components/PanelIcon';
import PanelOverview from '../components/PanelOverview';
import MessageInbox from '../components/workspace/MessageInbox';
import PanelPreferences from '../components/PanelPreferences';
import PanelQuotes from '../components/PanelQuotes';
import PanelChatbot from '../components/PanelChatbot';
import PanelAccounts from '../components/PanelAccounts';
import PanelStudents from '../components/PanelStudents';
import PanelEditions from '../components/PanelEditions';
import PanelEnrollments from '../components/PanelEnrollments';
import PanelImportations from '../components/PanelImportations';
import PanelPreregistrations from '../components/PanelPreregistrations';
import PanelReports from '../components/PanelReports';
import PanelAccessNotice from '../components/PanelAccessNotice';
import PanelBasicHome from '../components/PanelBasicHome';
import { PANEL_SECTIONS, panelNavigation } from '../context/panelAccess';
import '../styles/workspace.css';
import '../styles/panel-polish.css';
import '../styles/academic-panel.css';
import '../styles/operational-panel.css';

const mobileQuery = '(max-width: 760px)';
const subscribeToViewport = (callback: () => void) => {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};

export default function AdminDashboard() {
  const { user, logout, access } = useAdminAuth();
  const confirmLeave = useConfirmLeave(); // cerrar sesión a propósito avisa si hay cambios sin guardar (el cierre forzoso por seguridad no pasa por aquí)
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Secciones según los permisos que informó el backend (E3.4.3). Es solo un filtro visual: la autorización real es del backend.
  const navigation = useMemo(() => panelNavigation(access), [access]);
  const asked = location.pathname === '/admin/messages' ? 'mensajes' : params.get('section');
  // 'cursos' is the resource behind the Education menu, so both addresses open the same section.
  const requested = asked === 'educacion' ? 'cursos' : asked;
  const rule = PANEL_SECTIONS.find(item => item.key === requested);
  const known = !!rule;
  const editorialRetired = rule?.available === false;
  // Sin sección (o una desconocida) se abre el inicio de la cuenta; 'inicio' es el aviso de una cuenta sin secciones disponibles.
  const section = known ? requested : navigation.home ?? 'inicio';
  // El inicio en la bandeja se abre en su dirección propia (/admin/messages), sin dejar la anterior en el historial.
  const landInMessages = !known && section === 'mensajes';
  const [menuLocation, setMenuLocation] = useState<string | null>(null);
  // Una sección o subsección sin permiso no se monta: así tampoco hace sus solicitudes a la API.
  const allowed = navigation.canOpen(section);
  const homeTarget = PANEL_SECTIONS.find(rule => rule.key === navigation.home)?.target ?? '/admin/dashboard';
  const menu = menuLocation === location.key;
  const mobile = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(mobileQuery).matches, () => false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu || !mobile) return;
    const sidebar = sidebarRef.current;
    const trigger = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar?.querySelector<HTMLElement>('a, button')?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = sidebar?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trapFocus);
      trigger?.focus();
    };
  }, [menu, mobile]);
  const title = editorialRetired ? 'Contenido institucional' : !allowed ? (section === 'inicio' ? (navigation.kind === 'sin-rol' ? 'Mi espacio' : 'Inicio') : 'Permisos adicionales') : section === 'importacion-excel' ? 'Importación académica CSV' : section === 'matriculas' ? 'Matrículas' : section === 'preinscripciones' ? 'Preinscripciones' : section === 'reportes' ? 'Reportes' : section === 'ediciones' ? 'Ediciones académicas' : section === 'estudiantes' ? 'Estudiantes' : section === 'mensajes' ? 'Bandeja de mensajes' : section === 'chatbot' ? 'Consultas del chatbot' : section === 'cuentas' ? 'Roles y usuarios' : section === 'configuracion' ? 'Mi cuenta' : section === 'cotizaciones' ? 'Cotizaciones' : 'Resumen';
  useEffect(() => { document.title = title + ' — Panel Horus'; window.scrollTo(0, 0); }, [title]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuLocation(null); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  const go = (value: string, create = false, seccion?: string) => {
    navigate(value === 'mensajes' && !create ? '/admin/messages' : '/admin/dashboard?section=' + value + (seccion ? '&seccion=' + seccion : '') + (create ? '&crear=1' : ''));
    setMenuLocation(null);
  };
  const nav = (key: string, text: string, icon: string) => navigation.canOpen(key) && <button key={key} className={'hp-nav-item' + (section === key ? ' is-active' : '')} aria-current={section === key ? 'page' : undefined} onClick={() => go(key)}><PanelIcon name={icon} /><span>{text}</span>{section === key && <span className="hp-nav-dot" />}</button>;
  // Un grupo del menú sin ninguna sección visible no muestra su título.
  const navGroup = (label: string, items: ReactNode[]) => items.some(Boolean) && <><p className="hp-nav-label">{label}</p>{items}</>;
  if (landInMessages) return <Navigate to="/admin/messages" replace />;
  return <div className="hp-shell">
    <a className="hp-skip" href="#panel-content">Saltar al contenido</a>
    {menu && <button className="hp-menu-overlay" aria-label="Cerrar menú" onClick={() => setMenuLocation(null)} />}
    <aside ref={sidebarRef} inert={mobile && !menu} id="panel-sidebar" className={'hp-sidebar' + (menu ? ' is-open' : '')}>
      <div className="hp-brand-row"><Link className="hp-brand" to="/" aria-label="Ir al inicio de Horus Group"><HorusBrand light /></Link><button className="hp-sidebar-close" aria-label="Cerrar menú" onClick={() => setMenuLocation(null)}><PanelIcon name="close" /></button></div>
      <div className="hp-workspace-label"><span className="hp-workspace-mark"><PanelIcon name="shield" size={18} /></span><div><strong>Gestión y atención</strong><small>Sistema académico</small></div></div>
      <nav aria-label="Navegación del panel">{navGroup('PRINCIPAL', [nav('resumen', 'Resumen', 'home'), navigation.kind === 'sin-rol' && <button key="inicio" className={'hp-nav-item' + (section === 'inicio' ? ' is-active' : '')} aria-current={section === 'inicio' ? 'page' : undefined} onClick={() => { navigate('/admin/dashboard'); setMenuLocation(null); }}><PanelIcon name="home" /><span>Mi espacio</span>{section === 'inicio' && <span className="hp-nav-dot" />}</button>])}
        {navGroup('GESTIÓN ACADÉMICA', [nav('estudiantes', 'Estudiantes', 'user'), nav('ediciones', 'Ediciones', 'calendar'), nav('preinscripciones', 'Preinscripciones', 'user-plus'), nav('matriculas', 'Matrículas', 'book'), nav('reportes', 'Reportes', 'download'), nav('importacion-excel', 'Importación académica CSV', 'file')])}
        {navGroup('ATENCIÓN AL USUARIO', [nav('mensajes', 'Mensajes', 'mail'), nav('cotizaciones', 'Cotizaciones', 'file'), nav('chatbot', 'Consultas del chatbot', 'help')])}
        {navGroup('ADMINISTRACIÓN', [nav('cuentas', 'Roles y usuarios', 'user'), nav('configuracion', 'Mi cuenta', 'gear')])}</nav>
      <div className="hp-sidebar-bottom"><a href="/" target="_blank" rel="noreferrer"><PanelIcon name="arrow" />Visitar sitio web</a><button onClick={() => confirmLeave(() => { logout(); navigate('/admin/login'); })}><PanelIcon name="logout" />Cerrar sesión</button></div>
      <div className="hp-profile"><span className="hp-avatar">{user?.nombre?.charAt(0).toUpperCase()}</span><div><strong>{user?.nombre}</strong><small>{user?.email}</small></div></div>
    </aside>
    <div className="hp-body" inert={mobile && menu}><header className="hp-topbar"><div><button ref={menuButtonRef} className="hp-icon-btn hp-menu-toggle" aria-label={menu ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menu} aria-controls="panel-sidebar" onClick={() => setMenuLocation(menu ? null : location.key)}><PanelIcon name="menu" /></button><span className="hp-breadcrumb">Mi espacio <span>/</span> <strong>{title}</strong></span></div><div><span className="hp-date"><PanelIcon name="calendar" size={16} />{new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })}</span><span className="hp-topbar-divider" /><span className="hp-avatar">{user?.nombre?.charAt(0).toUpperCase()}</span></div></header>
      <main id="panel-content" className="hp-main" tabIndex={-1}>{editorialRetired ? <section className="hp-card hp-retired" data-panel-editorial-retired><p className="hp-kicker">CONTENIDO INSTITUCIONAL</p><h1>Esta gestión se retiró del panel</h1><p>El equipo web mantiene el contenido institucional desde el código del sitio. Los registros existentes y sus relaciones académicas se conservan.</p><Link className="hp-btn" to={homeTarget}>Ir a mi inicio</Link></section> : !allowed ? (section === 'inicio' && navigation.kind === 'sin-rol' ? <PanelBasicHome /> : <PanelAccessNotice kind={section === 'inicio' ? 'sin-secciones' : 'denegado'} homeTarget={homeTarget} hasHome={!!navigation.home} />) : section === 'importacion-excel' ? <PanelImportations /> : section === 'matriculas' ? <PanelEnrollments /> : section === 'preinscripciones' ? <PanelPreregistrations /> : section === 'reportes' ? <PanelReports /> : section === 'ediciones' ? <PanelEditions /> : section === 'estudiantes' ? <PanelStudents /> : section === 'resumen' ? <PanelOverview go={go} /> : section === 'configuracion' ? <PanelPreferences /> : section === 'cotizaciones' ? <PanelQuotes /> : section === 'mensajes' ? <MessageInbox /> : section === 'chatbot' ? <PanelChatbot /> : section === 'cuentas' ? <PanelAccounts /> : null}</main>
      <footer className="hp-footer"><span>© {new Date().getFullYear()} Horus Group SRL</span><span>Hecho para conectar tecnología y personas.</span></footer>
    </div>
  </div>;
}
