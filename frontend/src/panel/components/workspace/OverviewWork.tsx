import { Link } from 'react-router-dom';
import type { DashboardStats } from '../../types/workspace';
import { usePanelAccess } from '../../context/usePanelAccess';
import PanelIcon from '../PanelIcon';

export default function OverviewWork({ data }: { data: DashboardStats }) {
  // Solo se ofrecen los atajos a secciones que la cuenta puede abrir (E3.4.3, fase 2).
  const access = usePanelAccess();
  const messagesOpen = access.canOpen('mensajes');
  const educationOpen = access.canOpen('cursos') && access.canOpenResource('cursos');
  const messages = data.stats.mensajes;
  const drafts = data.stats.catalogo;
  const review = [
    { title: 'Capacitaciones', href: 'educacion&seccion=capacitaciones', count: drafts.cursos?.por_tipo?.capacitacion?.borradores || 0, open: educationOpen },
    { title: 'Cursos', href: 'educacion&seccion=cursos', count: drafts.cursos?.por_tipo?.curso?.borradores || 0, open: educationOpen },
    { title: 'Servicios', href: 'servicios', count: drafts.servicios?.borradores || 0, open: access.canOpen('servicios') },
    { title: 'Preguntas frecuentes', href: 'faq', count: drafts['preguntas-frecuentes']?.borradores || 0, open: access.canOpen('faq') },
  ].filter(item => item.open);
  return <section className="hw-work">
    <div><p className="hp-kicker">SIGUIENTE PASO</p><h2>Tu trabajo pendiente</h2><p>Accede directamente a lo que necesita atención.</p></div>
    <div className="hw-work-grid">
      {messagesOpen && <>
      <Link to="/admin/messages?estado=nuevo"><span className="hw-work-icon"><PanelIcon name="mail" /></span><div><strong>{messages.nuevos} consultas por atender</strong><small>Revisa los mensajes nuevos</small></div><PanelIcon name="arrow" /></Link>
      <Link to="/admin/messages?estado=en_proceso"><span className="hw-work-icon"><PanelIcon name="check" /></span><div><strong>{messages.enProceso} en seguimiento</strong><small>Continúa la atención iniciada</small></div><PanelIcon name="arrow" /></Link>
      <Link to="/admin/messages?estado=archivado"><span className="hw-work-icon"><PanelIcon name="mail" /></span><div><strong>{messages.archivados ?? 0} consultas archivadas</strong><small>Consulta el historial o reabre una atención</small></div><PanelIcon name="arrow" /></Link>
      </>}
      {educationOpen && <>
      <Link to="/admin/dashboard?section=educacion&seccion=capacitaciones&vista=agenda"><span className="hw-work-icon"><PanelIcon name="calendar" /></span><div><strong>Revisar agenda de capacitaciones</strong><small>Fechas próximas y capacitaciones por programar</small></div><PanelIcon name="arrow" /></Link>
      <Link to="/admin/dashboard?section=educacion&seccion=cursos&vista=agenda"><span className="hw-work-icon"><PanelIcon name="calendar" /></span><div><strong>Revisar agenda de cursos</strong><small>Fechas próximas y cursos por programar</small></div><PanelIcon name="arrow" /></Link>
      </>}
    </div>
    {review.length > 0 && <div className="hw-review"><strong>Contenido por revisar</strong>{review.map(item => <Link key={item.title} to={'/admin/dashboard?section=' + item.href + '&estado=borrador'}>{item.title}<span>{item.count} borradores</span><PanelIcon name="arrow" size={14} /></Link>)}</div>}
  </section>;
}
