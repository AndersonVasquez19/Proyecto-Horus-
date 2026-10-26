import { formatPercent, type ChannelSplitData } from '../../services/overviewAnalytics';

// Origen de las consultas recibidas en el periodo. `stats/actividad` cuenta todas las consultas y, dentro de ellas, las del chatbot; el
// resto es lo que no llegó por el chatbot (formulario web y registro manual): la partición es completa. No mide visitas al sitio ni
// conversaciones del chatbot que no dejaron datos de contacto. Con datos incoherentes (split null) no se afirma ninguna distribución.
export default function ChannelSplit({ split, days }: { split: ChannelSplitData | null; days: number }) {
  const rows = split ? [
    { key: 'bot', label: 'Chatbot', value: split.chatbot, percent: split.chatbotPercent },
    { key: 'contact', label: 'Formulario web y registro manual', value: split.otros, percent: split.otrosPercent },
  ] : [];
  return <div className="hp-channel-split"><div><p className="hp-kicker">ORIGEN</p><h3>Consultas recibidas por origen</h3>
    <p className="hp-muted-inline">Consultas de los últimos {days} días, según cómo llegaron. No son visitas al sitio.</p></div>
    {!split ? <p className="hp-muted-inline" role="status">No disponible: los datos del periodo no permiten calcular el origen.</p>
      : split.total === 0 ? <p className="hp-muted-inline">No hay consultas en este periodo.</p>
      : <ul aria-label="Origen de las consultas">{rows.map(row => <li key={row.key}><span>{row.label}</span>
        <span className="hp-bar-track" aria-hidden="true"><span className={'hp-bar-fill hp-channel-' + row.key} style={{ width: (row.percent ?? 0) + '%' }} /></span>
        <strong>{row.value}</strong><span className="hp-channel-percent">{formatPercent(row.percent)}</span></li>)}</ul>}
  </div>;
}
