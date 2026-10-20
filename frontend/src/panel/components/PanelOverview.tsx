import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { panelRequest, errorMessage } from '../services/panelApi';
import { isOperationalStats, type OperationalStats } from '../services/operationalStats';
import { label } from '../types/workspace';
import PanelIcon from './PanelIcon';
import OverviewActivity from './workspace/OverviewActivity';

export default function PanelOverview({ go }: { go: (section: string, create?: boolean) => void }) {
  const { token, user } = useAdminAuth();
  const access = usePanelAccess();
  const [result, setResult] = useState<{ token: string; data: OperationalStats } | null>(null);
  const [reload, setReload] = useState(0);
  const { loading, error, setLoading, setError } = useRequestStatus(JSON.stringify([token, reload]));
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    panelRequest<unknown>('stats?vista=operativa', token, 'GET', undefined, controller.signal)
      .then(data => { if (controller.signal.aborted) return; if (!isOperationalStats(data)) throw new Error('El servidor devolvió datos con un formato inesperado.'); setResult({ token, data }); })
      .catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, reload, setLoading, setError]);
  const data = result?.token === token ? result.data : null;
  const academic = data?.stats.academico;
  const messages = data?.stats.mensajes;
  const canMessages = access.canOpen('mensajes');
  const metrics = [
    { title: 'Total de estudiantes', value: academic?.estudiantes, sub: 'Incluye estudiantes archivados', icon: 'user', section: 'estudiantes', color: 'blue' },
    { title: 'Ediciones activas', value: academic?.edicionesActivas, sub: 'Abiertas y sin archivar', icon: 'calendar', section: 'ediciones', color: 'teal' },
    { title: 'Matrículas registradas', value: academic?.matriculasRegistradas, sub: 'Activas y anuladas', icon: 'book', section: 'matriculas', color: 'blue' },
    { title: 'Matrículas vigentes', value: academic?.matriculasVigentes, sub: 'Con estado activa', icon: 'check', section: 'matriculas', color: 'teal' },
    { title: 'Consultas pendientes', value: messages?.pendientes, sub: 'Nuevas y en proceso', icon: 'mail', section: 'mensajes', color: 'gold' },
  ].filter(item => access.canOpen(item.section));
  const shortcuts = [
    { section: 'estudiantes', permission: PANEL_ACTIONS.crearEstudiante, title: 'Registrar estudiante', text: 'Crear su ficha académica.', icon: 'user', create: true },
    { section: 'ediciones', permission: PANEL_ACTIONS.crearEdicion, title: 'Crear edición', text: 'Programar una edición y sus cupos.', icon: 'calendar', create: true },
    { section: 'matriculas', permission: PANEL_ACTIONS.crearMatricula, title: 'Registrar matrícula', text: 'Vincular un estudiante y una edición.', icon: 'book', create: true },
    { section: 'importacion-excel', permission: PANEL_ACTIONS.importarAcademico, title: 'Importar CSV', text: 'Revisar el archivo antes de confirmar.', icon: 'file', create: false },
  ].filter(item => access.canOpen(item.section) && access.can(item.permission));
  const metric = (value?: number) => loading ? '…' : error || value === undefined ? '—' : String(value);
  return <div className="hp-operational-overview">
    <div className="hp-heading"><div><p className="hp-kicker">VISTA GENERAL</p><h1>Hola, {user?.nombre?.split(' ')[0] || 'administrador'}</h1><p>Gestión académica y atención al usuario en un solo espacio.</p></div><button className="hp-btn" disabled={loading} onClick={() => setReload(n => n + 1)}><PanelIcon name="refresh" />Actualizar resumen</button></div>
    {error && <p className="hp-error" role="alert">{error} Los indicadores no están disponibles.</p>}
    <section className="hp-operational-hero"><div><p className="hp-kicker">HORUS GROUP SRL</p><h2>Organiza la formación.<br />Da seguimiento a cada consulta.</h2><p>Estudiantes, ediciones y matrículas con su historial, junto a los canales de atención del equipo.</p></div><span aria-hidden="true"><PanelIcon name="book" size={48} /></span></section>
    <section className="hp-metrics" aria-label="Indicadores del sistema" aria-busy={loading}>
      {metrics.map(item => <article key={item.title}><div className="hp-metric-top"><span className={'hp-metric-icon hp-tone-' + item.color}><PanelIcon name={item.icon} /></span><span className="hp-metric-label">{item.title}</span></div><strong>{metric(item.value)}</strong><p>{item.sub}</p></article>)}
    </section>
    {(shortcuts.length > 0 || canMessages) && <section className="hp-shortcuts"><div><p className="hp-kicker">ACCESOS DIRECTOS</p><h2>Continúa con tu trabajo</h2></div><div className="hp-shortcut-grid">
      {shortcuts.map(item => <button key={item.section} onClick={() => go(item.section, item.create)}><span className="hp-shortcut-icon"><PanelIcon name={item.icon} size={23} /></span><div><strong>{item.title}</strong><small>{item.text}</small></div><PanelIcon name="arrow" /></button>)}
      {canMessages && <button onClick={() => go('mensajes')}><span className="hp-shortcut-icon"><PanelIcon name="mail" size={23} /></span><div><strong>Atender consultas</strong><small>Mensajes y seguimiento de atención.</small></div><PanelIcon name="arrow" /></button>}
    </div></section>}
    {canMessages && <>
      {!loading && !error && messages && <section className="hw-work"><div><p className="hp-kicker">ATENCIÓN AL USUARIO</p><h2>Consultas por atender</h2><p>El seguimiento se realiza dentro de Mensajes.</p></div><div className="hw-work-grid">
        <Link to="/admin/messages?estado=nuevo"><PanelIcon name="mail" /><div><strong>{messages.nuevos} consultas nuevas</strong><small>Inicia su atención</small></div><PanelIcon name="arrow" /></Link>
        <Link to="/admin/messages?estado=en_proceso"><PanelIcon name="check" /><div><strong>{messages.enProceso} en seguimiento</strong><small>Continúa la atención iniciada</small></div><PanelIcon name="arrow" /></Link>
        <Link to="/admin/messages?estado=archivado"><PanelIcon name="mail" /><div><strong>{messages.archivados} consultas archivadas</strong><small>Consulta el historial o reabre una atención</small></div><PanelIcon name="arrow" /></Link>
      </div></section>}
      <section className="hp-card"><div className="hp-card-heading"><div><p className="hp-kicker">ACTIVIDAD RECIENTE</p><h2>Últimas consultas</h2></div><button className="hp-text-btn" onClick={() => go('mensajes')}>Ver todas <PanelIcon name="arrow" size={15} /></button></div>
        {loading ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando actividad…</p></div> : error ? <div className="hp-empty"><p>No se pudo consultar la actividad.</p></div> : data?.actividadReciente.mensajes.length ? <div className="hp-activity">{data.actividadReciente.mensajes.map(message =>
          <Link key={message.id} to={'/admin/messages?id=' + message.id}><span className="hp-avatar">{message.nombre.charAt(0).toUpperCase()}</span><div><strong>{message.asunto}</strong><small>{message.nombre} · {new Date(message.createdAt).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}</small></div><span className={'hp-badge hp-state-' + message.estado}>{label(message.estado)}</span></Link>)}</div>
          : <div className="hp-empty hp-empty-compact"><PanelIcon name="mail" size={28} /><h3>Aún no hay consultas</h3><p>Las consultas recibidas aparecerán aquí.</p></div>}
      </section>
      <OverviewActivity go={go} />
    </>}
  </div>;
}
