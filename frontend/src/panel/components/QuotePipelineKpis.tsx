import PanelIcon from './PanelIcon';
import { formatCents, MIN_RESOLVED_FOR_RATE, type PipelineSummary } from '../services/quotePipeline';

// Indicadores del tablero. Describen SOLO el lote cargado (hasta 100 cotizaciones): si hay más, se dice y no se presentan como cifras globales.
export default function QuotePipelineKpis({ summary }: { summary: PipelineSummary }) {
  const scope = summary.truncated ? 'del lote cargado' : 'de las cotizaciones listadas';
  return <section className="hqp-kpis" aria-label={'Indicadores ' + scope} data-pipeline-kpis>
    <ul>
      <li className="hqp-kpi" data-kpi="lote">
        <span className="hqp-kpi-icon" aria-hidden="true"><PanelIcon name="file" size={22} /></span>
        <div><h3>Cotizaciones del lote</h3><strong>{summary.loaded}</strong>
          <p>{summary.truncated ? 'Mostrando ' + summary.loaded + ' de ' + summary.total : summary.total === 1 ? '1 cotización en total' : summary.total + ' cotizaciones en total'}</p></div>
      </li>
      <li className="hqp-kpi" data-kpi="en-curso">
        <span className="hqp-kpi-icon" aria-hidden="true"><PanelIcon name="arrow" size={22} /></span>
        <div><h3>Importe en curso</h3>
          {summary.openAmounts.length
            ? <ul className="hqp-amounts" aria-label="Importe por moneda">{summary.openAmounts.map(a => <li key={a.moneda}><strong>{formatCents(a.cents, a.moneda)}</strong></li>)}</ul>
            : <strong>Sin importes</strong>}
          <p>{summary.counts.borrador} borradores · {summary.counts.enviada} enviadas · monedas sin convertir</p></div>
      </li>
      <li className="hqp-kpi" data-kpi="aceptadas">
        <span className="hqp-kpi-icon" aria-hidden="true"><PanelIcon name="check" size={22} /></span>
        <div><h3>Aceptadas</h3><strong>{summary.accepted}</strong>
          <p>{summary.counts.rechazada} rechazadas · {summary.counts.anulada} anuladas</p></div>
      </li>
      <li className="hqp-kpi" data-kpi="tasa">
        <span className="hqp-kpi-icon" aria-hidden="true"><PanelIcon name="shield" size={22} /></span>
        <div><h3>Tasa de aceptación</h3>
          <strong>{summary.acceptanceRate === null ? 'Sin datos suficientes' : summary.acceptanceRate.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' %'}</strong>
          <p>{summary.acceptanceRate === null
            ? 'Requiere al menos ' + MIN_RESOLVED_FOR_RATE + ' cotizaciones resueltas (hay ' + summary.resolved + ')'
            : summary.accepted + ' de ' + summary.resolved + ' resueltas (aceptadas + rechazadas)'}</p></div>
      </li>
    </ul>
    {summary.truncated && <p className="hqp-scope">Estos indicadores corresponden solo a las {summary.loaded} cotizaciones más recientes cargadas, no al total de {summary.total}.</p>}
  </section>;
}
