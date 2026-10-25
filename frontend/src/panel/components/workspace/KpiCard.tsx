import PanelIcon from '../PanelIcon';

// Tarjeta de indicador del Resumen. `value` ya viene formateado («…» cargando, «—» sin datos): aquí nunca se convierte un dato
// ausente en cero. Sin series reales no hay tendencias ni sparklines. El valor es el primer <strong> de la tarjeta (lo leen los smokes).
export default function KpiCard({ title, value, sub, icon, tone, action, onAction }: {
  title: string; value: string; sub: string; icon: string; tone: string; action?: string; onAction?: () => void;
}) {
  return <article className="hp-kpi">
    <div className="hp-metric-top"><span className={'hp-metric-icon hp-tone-' + tone}><PanelIcon name={icon} /></span><span className="hp-metric-label">{title}</span></div>
    <strong>{value}</strong>
    <p>{sub}</p>
    {action && onAction && <button type="button" className="hp-kpi-link" onClick={onAction}>{action}<PanelIcon name="arrow" size={14} /></button>}
  </article>;
}
