import type { PreregistrationStats } from '../../services/operationalStats';
import { formatPercent, preregistrationSegments } from '../../services/overviewAnalytics';
import PanelIcon from '../PanelIcon';

// Preinscripciones por estado actual. Los contadores del servidor son estados EXCLUYENTES (cada solicitud cuenta una sola vez), pero no
// forman un embudo acumulativo fiable: una solicitud validada puede acabar descartada o desistida, así que el estado actual no dice
// cuántas llegaron a validarse. Por eso se muestra una distribución y no una tasa de conversión. Sin bloque (null) dice «No disponible».
export default function PreregistrationFunnel({ stats, loading, error, onOpen }: {
  stats: PreregistrationStats | null; loading: boolean; error: boolean; onOpen?: () => void;
}) {
  const segments = stats ? preregistrationSegments(stats) : [];
  const summary = stats ? 'Preinscripciones por estado: ' + segments.map(segment => segment.value + ' ' + segment.label.toLowerCase()).join(', ') + '. Total: ' + stats.total + '.' : '';
  return <section className="hp-card hp-analytics-card" aria-labelledby="hp-prereg-title" aria-busy={loading}>
    <div className="hp-card-heading"><div><p className="hp-kicker">PREINSCRIPCIONES</p><h2 id="hp-prereg-title">Preinscripciones por estado</h2>
      <p>Cada solicitud cuenta una sola vez, según su estado actual. No incluye ediciones archivadas.</p></div></div>
    {loading ? <div className="hp-empty hp-empty-compact" role="status"><span className="hp-loading" /><p>Cargando preinscripciones…</p></div>
      : error ? <div className="hp-empty hp-empty-compact"><p>No se pudieron consultar las preinscripciones.</p></div>
      : !stats ? <div className="hp-empty hp-empty-compact" role="status"><PanelIcon name="user-plus" size={28} /><h3>No disponible</h3><p>El servidor no informó el estado de las preinscripciones, por eso no se muestran cifras.</p></div>
      : stats.total === 0 ? <div className="hp-empty hp-empty-compact"><PanelIcon name="user-plus" size={28} /><h3>Aún no hay preinscripciones</h3><p>Las solicitudes recibidas por el formulario o el chatbot aparecerán aquí.</p></div>
      : <div className="hp-analytics-body">
        <div className="hp-stat-line"><strong>{stats.total}</strong><span>{stats.total === 1 ? 'solicitud en total' : 'solicitudes en total'}</span></div>
        <p className="hp-sr">{summary}</p>
        <div className="hp-stack" aria-hidden="true">{segments.filter(segment => segment.value > 0).map(segment => <span key={segment.key} className={'hp-stack-' + segment.key} style={{ flexGrow: segment.value }} />)}</div>
        <ul className="hp-state-list" aria-label="Preinscripciones por estado">{segments.map(segment =>
          <li key={segment.key}><span className={'hp-state-dot hp-stack-' + segment.key} aria-hidden="true" /><div><strong>{segment.label}</strong><small>{segment.hint}</small></div><span className="hp-state-value">{segment.value}</span><span className="hp-state-percent">{formatPercent(segment.percent)}</span></li>)}</ul>
        <div className="hp-callout"><div><strong>{stats.pendientesRevision}</strong> {stats.pendientesRevision === 1 ? 'solicitud por revisar' : 'solicitudes por revisar'}<small>Recibidas de ediciones que aún admiten validar.</small></div>
          {onOpen && <button type="button" className="hp-text-btn" onClick={onOpen}>Ir a preinscripciones <PanelIcon name="arrow" size={15} /></button>}</div>
      </div>}
  </section>;
}
