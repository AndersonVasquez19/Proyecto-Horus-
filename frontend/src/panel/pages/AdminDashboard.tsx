import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useConfirmLeave } from '../unsaved/unsavedContext';
import HorusBrand from '../components/HorusBrand';
import { useAdminAuth } from '../context';
import { educationSections, resources, serviceSections, servicesOverview, type PanelScope } from '../types/workspace';
import PanelIcon from '../components/PanelIcon';
import PanelOverview from '../components/PanelOverview';
import ResourceManager from '../components/ResourceManager';
import PanelSettings from '../components/PanelSettings';
import MessageInbox from '../components/workspace/MessageInbox';
import PanelPreferences from '../components/PanelPreferences';
import PanelQuotes from '../components/PanelQuotes';
import PanelChatbot from '../components/PanelChatbot';
import PanelConvenios from '../components/PanelConvenios';
import PanelAccessNotice from '../components/PanelAccessNotice';
import { PANEL_SECTIONS, panelNavigation } from '../context/panelAccess';
import '../styles/workspace.css';
import '../styles/panel-polish.css';

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
  const known = !!requested && (!!resources[requested] || ['resumen', 'mensajes', 'chatbot', 'ajustes', 'cotizaciones', 'configuracion', 'convenios'].includes(requested));
  // Sin sección (o una desconocida) se abre el inicio de la cuenta; 'inicio' es el aviso de una cuenta sin secciones disponibles.
  const section = known ? requested : navigation.home ?? 'inicio';
  // El inicio en la bandeja se abre en su dirección propia (/admin/messages), sin dejar la anterior en el historial.
  const landInMessages = !known && section === 'mensajes';
  const [menuLocation, setMenuLocation] = useState<string | null>(null);
  // Menu groups: undefined = open while active; false = folded by the administrator.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean | undefined>>({});
  const activeGroup = section === 'servicios' ? 'servicios' : section === 'cursos' ? 'educacion' : '';
  // Education always opens one concrete section; the old ?section=cursos address opens Cursos.
  const wantedScope = params.get('seccion') ?? (asked === 'cursos' ? 'cursos' : null);
  const allowedEducation = educationSections.filter(item => navigation.canOpenResource(item.resource));
  const activeScope: PanelScope | undefined = (activeGroup === 'servicios' ? serviceSections : activeGroup === 'educacion' ? educationSections : []).find(item => item.key === wantedScope)
    ?? (activeGroup === 'servicios' ? servicesOverview : activeGroup === 'educacion' ? allowedEducation[0] ?? educationSections[0] : undefined);
  const resourceKey = activeScope?.resource ?? section;
  // Una sección o subsección sin permiso no se monta: así tampoco hace sus solicitudes a la API.
  const allowed = known ? navigation.canOpen(section) && (!resources[resourceKey] || navigation.canOpenResource(resourceKey)) : section !== 'inicio';
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
  const title = !allowed ? (section === 'inicio' ? 'Inicio' : 'Acceso no autorizado') : section === 'cursos' ? 'Educación' : resources[section]?.label || (section === 'mensajes' ? 'Bandeja de mensajes' : section === 'chatbot' ? 'Consultas del chatbot' : section === 'convenios' ? 'Convenios' : section === 'configuracion' ? 'Ajustes' : section === 'cotizaciones' ? 'Cotizaciones' : section === 'ajustes' ? 'Empresa' : 'Resumen');
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
  const groupNav = (group: 'servicios' | 'educacion', text: string, icon: string, allItems: PanelScope[]) => {
    const items = allItems.filter(item => navigation.canOpenResource(item.resource));
    if (!navigation.canOpen(group === 'educacion' ? 'cursos' : group) || !items.length) return null;
    const active = activeGroup === group;
    // A group is only expanded while it is the active one; leaving it folds it again.
    const open = active && (openGroups[group] ?? true);
    const menuId = 'panel-' + group + '-menu';
    return <div key={group} className="hp-nav-group">
      <button className={'hp-nav-item' + (active ? ' is-active' : '')} aria-expanded={open} aria-controls={menuId} aria-current={active && (!activeScope || activeScope.key === 'todos') ? 'page' : undefined}
        onClick={() => { if (!active) { setOpenGroups(value => ({ ...value, [group]: undefined })); go(group, false, group === 'educacion' ? items[0].key : undefined); } else setOpenGroups(value => ({ ...value, [group]: !open })); }}>
        <PanelIcon name={icon} /><span>{text}</span><PanelIcon name="chevron-down" size={16} /></button>
      {open && <ul id={menuId} className="hp-nav-sub" aria-label={'Secciones de ' + text.toLowerCase()}>{items.map(item =>
        <li key={item.key}><button className={'hp-nav-subitem' + (active && activeScope?.key === item.key ? ' is-active' : '')} aria-current={active && activeScope?.key === item.key ? 'page' : undefined}
          onClick={() => go(group, false, item.key)}>{item.label}</button></li>)}</ul>}
    </div>;
  };
  // Un grupo del menú sin ninguna sección visible no muestra su título.
  const navGroup = (label: string, items: ReactNode[]) => items.some(Boolean) && <><p className="hp-nav-label">{label}</p>{items}</>;
  if (landInMessages) return <Navigate to="/admin/messages" replace />;
  return <div className="hp-shell">
    <a className="hp-skip" href="#panel-content">Saltar al contenido</a>
    {menu && <button className="hp-menu-overlay" aria-label="Cerrar menú" onClick={() => setMenuLocation(null)} />}
    <aside ref={sidebarRef} inert={mobile && !menu} id="panel-sidebar" className={'hp-sidebar' + (menu ? ' is-open' : '')}>
      <div className="hp-brand-row"><Link className="hp-brand" to="/" aria-label="Ir al inicio de Horus Group"><HorusBrand light /></Link><button className="hp-sidebar-close" aria-label="Cerrar menú" onClick={() => setMenuLocation(null)}><PanelIcon name="close" /></button></div>
      <div className="hp-workspace-label"><span className="hp-workspace-mark"><PanelIcon name="shield" size={18} /></span><div><strong>Panel de administración</strong><small>Tu espacio de trabajo</small></div></div>
      <nav aria-label="Navegación del panel">{navGroup('PRINCIPAL', [nav('resumen', 'Resumen', 'home')])}
        {navGroup('GESTIÓN DE CONTENIDO', [groupNav('educacion', 'Educación', resources.cursos.icon, educationSections), groupNav('servicios', resources.servicios.label, resources.servicios.icon, serviceSections), ...['galeria', 'faq', 'contenido'].map(key => nav(key, resources[key].label, resources[key].icon)), nav('convenios', 'Convenios', 'file')])}
        {navGroup('ATENCIÓN Y EMPRESA', [nav('mensajes', 'Mensajes', 'mail'), nav('cotizaciones', 'Cotizaciones', 'file'), nav('chatbot', 'Consultas del chatbot', 'help'), nav('ajustes', 'Información de empresa', 'settings')])}</nav>
      <div className="hp-sidebar-bottom">{navigation.canOpen('configuracion') && <button className={section === 'configuracion' ? 'is-active' : undefined} aria-current={section === 'configuracion' ? 'page' : undefined} onClick={() => go('configuracion')}><PanelIcon name="gear" />Ajustes</button>}<a href="/" target="_blank" rel="noreferrer"><PanelIcon name="arrow" />Visitar sitio web</a><button onClick={() => confirmLeave(() => { logout(); navigate('/admin/login'); })}><PanelIcon name="logout" />Cerrar sesión</button></div>
      <div className="hp-profile"><span className="hp-avatar">{user?.nombre?.charAt(0).toUpperCase()}</span><div><strong>{user?.nombre}</strong><small>{user?.email}</small></div></div>
    </aside>
    <div className="hp-body" inert={mobile && menu}><header className="hp-topbar"><div><button ref={menuButtonRef} className="hp-icon-btn hp-menu-toggle" aria-label={menu ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menu} aria-controls="panel-sidebar" onClick={() => setMenuLocation(menu ? null : location.key)}><PanelIcon name="menu" /></button><span className="hp-breadcrumb">Mi espacio <span>/</span> <strong>{title}</strong></span></div><div><span className="hp-date"><PanelIcon name="calendar" size={16} />{new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })}</span><span className="hp-topbar-divider" /><span className="hp-avatar">{user?.nombre?.charAt(0).toUpperCase()}</span></div></header>
      <main id="panel-content" className="hp-main" tabIndex={-1}>{!allowed ? <PanelAccessNotice kind={section === 'inicio' ? (navigation.kind === 'sin-rol' ? 'sin-rol' : 'sin-secciones') : 'denegado'} homeTarget={homeTarget} hasHome={!!navigation.home} /> : section === 'resumen' ? <PanelOverview go={go} /> : section === 'convenios' ? <PanelConvenios /> : section === 'configuracion' ? <PanelPreferences /> : section === 'cotizaciones' ? <PanelQuotes /> : section === 'ajustes' ? <PanelSettings /> : section === 'mensajes' ? <MessageInbox /> : section === 'chatbot' ? <PanelChatbot /> :
        <ResourceManager key={section + (params.get('crear') || '') + (params.get('estado') || '') + (params.get('vista') || '') + (activeScope ? activeScope.resource + activeScope.key : '')} resource={resources[resourceKey]} autoCreate={params.get('crear') === '1'} scope={activeScope} />}</main>
      <footer className="hp-footer"><span>© {new Date().getFullYear()} Horus Group SRL</span><span>Hecho para conectar tecnología y personas.</span></footer>
    </div>
  </div>;
}
