import { useRequestStatus } from '../hooks/useRequestStatus';
import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context';
import { panelRequest, errorMessage } from '../services/panelApi';
import { type DashboardStats, label } from '../types/workspace';
import PanelIcon from './PanelIcon';
import { useNavigate } from 'react-router-dom';
import OverviewWork from './workspace/OverviewWork';
import OverviewActivity from './workspace/OverviewActivity';
import { usePanelAccess } from '../context/usePanelAccess';
import { RESOURCE_WRITE } from '../context/panelAccess';

// Clave de navegación y endpoint de cada destino del Resumen, para no ofrecer enlaces ni accesos de creación sin permiso (E3.4.3, fase 2).
const TARGETS: Record<string, { section: string; resource?: string; endpoint?: string }> = {
  educacion: { section: 'cursos', resource: 'cursos', endpoint: 'cursos' },
  servicios: { section: 'servicios', resource: 'servicios', endpoint: 'servicios' },
  galeria: { section: 'galeria', resource: 'galeria', endpoint: 'galeria' },
  faq: { section: 'faq', resource: 'faq', endpoint: 'preguntas-frecuentes' },
  mensajes: { section: 'mensajes' },
};

// Una respuesta con otra forma (proxy, versión distinta del servidor) no debe romper la página entera: se trata como error de carga.
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
function isDashboardStats(value: unknown): value is DashboardStats {
  if (!isObject(value) || !isObject(value.stats) || !isObject(value.actividadReciente)) return false;
  return isObject(value.stats.mensajes) && isObject(value.stats.catalogo) && Array.isArray(value.actividadReciente.mensajes);
}
export default function PanelOverview({ go }: { go: (section: string, create?: boolean, seccion?: string) => void }) {
  const { token, user } = useAdminAuth();
  const navigate = useNavigate();
  const access = usePanelAccess();
  const canGo = (key: string) => { const target = TARGETS[key]; return !!target && access.canOpen(target.section) && (!target.resource || access.canOpenResource(target.resource)); };
  const canCreateIn = (key: string) => { const endpoint = TARGETS[key]?.endpoint; return canGo(key) && !!endpoint && access.can(RESOURCE_WRITE[endpoint].crear); };
  const canMessages = canGo('mensajes');
  const shortcuts = [['servicios', 'tools', 'Nuevo servicio', 'Presenta una solución tecnológica.'], ['galeria', 'image', 'Agregar imagen', 'Comparte tus proyectos y actividades.'], ['faq', 'help', 'Nueva respuesta', 'Resuelve las dudas más frecuentes.']].filter(([section]) => canCreateIn(section));
  const [data, setData] = useState<DashboardStats | null>(null);
  const [reload, setReload] = useState(0);
  const { loading, error, setLoading, setError } = useRequestStatus(JSON.stringify([token, reload]));
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    panelRequest<DashboardStats>('stats', token, 'GET', undefined, controller.signal).then(data => { if (controller.signal.aborted) return; if (!isDashboardStats(data)) throw new Error('El servidor devolvió datos con un formato inesperado.'); setData(data); })
      .catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, reload, setLoading, setError]);
  const catalog = data?.stats.catalogo;
  const catalogTotal = Object.values(catalog || {}).reduce((sum, item) => sum + item.total, 0);
  const published = Object.values(catalog || {}).reduce((sum, item) => sum + item.publicados, 0);
  const draft = Object.values(catalog || {}).reduce((sum, item) => sum + item.borradores, 0);
  const metric = (value?: number) => loading ? '…' : error ? '—' : String(value ?? 0);
  const distribution = [
    { title: 'Capacitaciones', value: catalog?.cursos?.por_tipo?.capacitacion?.total || 0, color: 'blue', section: 'educacion', seccion: 'capacitaciones' },
    { title: 'Cursos', value: catalog?.cursos?.por_tipo?.curso?.total || 0, color: 'purple', section: 'educacion', seccion: 'cursos' },
    { title: 'Servicios tecnológicos', value: catalog?.servicios?.total || 0, color: 'teal', section: 'servicios' },
    { title: 'Preguntas frecuentes', value: catalog?.['preguntas-frecuentes']?.total || 0, color: 'gold', section: 'faq' },
  ];
  return <>
    <div className="hp-heading"><div><p className="hp-kicker">VISTA GENERAL</p><h1>Hola, {user?.nombre?.split(' ')[0] || 'administrador'} <span className="hp-greeting">✦</span></h1><p>Un vistazo a tu contenido y las conversaciones por atender.</p></div><button className="hp-btn" disabled={loading} onClick={() => setReload(n => n + 1)}><PanelIcon name="refresh" />Actualizar resumen</button></div>
    {error && <p className="hp-error" role="alert">{error} Los indicadores no están disponibles.</p>}
    <section className="hp-hero"><div><p className="hp-kicker">CONECTA. COMPARTE. CRECE.</p><h2>Tu próxima gran idea<br /><span>empieza aquí.</span></h2><p>Dale vida a un nuevo curso o retoma la conversación con tu comunidad.</p><div className="hp-actions">{canCreateIn('educacion') && <button className="hp-btn hp-btn-gold" onClick={() => go('educacion', true, 'cursos')}>Crear un curso<PanelIcon name="plus" /></button>}{canMessages && <button className="hp-hero-link" onClick={() => go('mensajes')}>Ir a mensajes <PanelIcon name="arrow" /></button>}</div></div>
      <div className="hp-hero-art" aria-hidden="true"><div className="hp-orbit" /><div className="hp-art-tile hp-art-one"><PanelIcon name="book" size={30} /><span>Formación</span></div><div className="hp-art-tile hp-art-two"><PanelIcon name="tools" size={27} /><span>Tecnología</span></div><span className="hp-art-star">✦</span></div></section>
    <section className="hp-metrics" aria-label="Indicadores del sistema" aria-busy={loading}>
      {[{ title: 'Contenido del catálogo', value: catalogTotal, sub: 'Cursos, servicios y preguntas', icon: 'file', section: 'cursos', color: 'blue' },
        { title: 'Publicados', value: published, sub: 'Disponibles para consulta', icon: 'check', section: 'cursos', color: 'teal' },
        { title: 'Mensajes nuevos', value: data?.stats.mensajes.nuevos, sub: 'Pendientes de atención', icon: 'mail', section: 'mensajes', color: 'gold' },
        { title: 'Borradores', value: draft, sub: 'Contenido por revisar', icon: 'edit', section: 'cursos', color: 'purple' }].map(item =>
        <article key={item.title}><div className="hp-metric-top"><span className={'hp-metric-icon hp-tone-' + item.color}><PanelIcon name={item.icon} /></span><span className="hp-metric-label">{item.title}</span></div><strong>{metric(item.value)}</strong><p>{item.sub}</p></article>)}
    </section>
    <OverviewActivity go={go} />
    {!loading && !error && data && <OverviewWork data={data} />}
    <div className="hp-overview-grid"><section className="hp-card hp-distribution"><div className="hp-card-heading"><div><p className="hp-kicker">CATÁLOGO</p><h2>Tu contenido, en perspectiva</h2></div><PanelIcon name="file" /></div>
      <div className="hp-distribution-total"><strong>{metric(catalogTotal)}</strong><span>registros en total</span></div>
      <div className="hp-stacked" aria-label="Distribución del catálogo">{!loading && !error && distribution.map(item => item.value > 0 && <span key={item.title} className={'hp-bg-' + item.color} style={{ width: (item.value / catalogTotal * 100) + '%' }} />)}</div>
      {distribution.map(item => <button className="hp-distribution-row" key={item.title} disabled={!canGo(item.section)} onClick={() => go(item.section, false, item.seccion)}><span className={'hp-dot hp-bg-' + item.color} /><span>{item.title}</span><strong>{metric(item.value)}</strong><PanelIcon name="arrow" size={16} /></button>)}
      {!loading && !error && !catalogTotal && <p className="hp-muted">La distribución aparecerá al crear tus primeros registros.</p>}
    </section>
    <section className="hp-card"><div className="hp-card-heading"><div><p className="hp-kicker">COMUNIDAD</p><h2>Últimas consultas</h2></div>{canMessages && <button className="hp-text-btn" onClick={() => go('mensajes')}>Ver todas <PanelIcon name="arrow" size={15} /></button>}</div>
      {loading ? <div className="hp-empty"><span className="hp-loading" /><p>Cargando actividad…</p></div> : error ? <div className="hp-empty"><p>No se pudo consultar la actividad.</p></div> : data?.actividadReciente.mensajes.length ? <div className="hp-activity">{data.actividadReciente.mensajes.map(message =>
        <button key={message.id} disabled={!canMessages} onClick={() => navigate('/admin/messages?id=' + message.id)}><span className="hp-avatar">{message.nombre.charAt(0).toUpperCase()}</span><div><strong>{message.asunto}</strong><small>{message.nombre} · {new Date(message.createdAt).toLocaleDateString('es-PE')}</small></div><span className={'hp-badge hp-state-' + message.estado}>{label(message.estado)}</span></button>)}</div> :
        <div className="hp-empty hp-empty-compact"><span className="hp-empty-icon"><PanelIcon name="mail" size={28} /></span><h3>Aquí comienza la conversación</h3><p>Las consultas recibidas aparecerán en este espacio.</p>{canMessages && <button className="hp-text-btn" onClick={() => go('mensajes')}>Abrir bandeja <PanelIcon name="arrow" /></button>}</div>}
    </section></div>
    {shortcuts.length > 0 && <section className="hp-shortcuts"><div><p className="hp-kicker">ACCESOS DIRECTOS</p><h2>¿Qué quieres hacer hoy?</h2></div><div className="hp-shortcut-grid">
      {shortcuts.map(([section, icon, title, text]) =>
      <button key={section} onClick={() => go(section, true)}><span className="hp-shortcut-icon"><PanelIcon name={icon} size={23} /></span><div><strong>{title}</strong><small>{text}</small></div><PanelIcon name="arrow" /></button>)}</div></section>}
  </>;
}
