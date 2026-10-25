import PanelIcon from './PanelIcon';
import { label } from '../types/workspace';
import { PIPELINE_STATES, formatCalendarDate, formatCreatedDate, formatQuoteTotal, groupByState, type PipelineQuote, type PipelineState } from '../services/quotePipeline';

const STATE_ICON: Record<PipelineState, string> = { borrador: 'edit', enviada: 'mail', aceptada: 'check', rechazada: 'close', anulada: 'lock' };

// Tablero por estados reales de las cotizaciones. Es de solo lectura: abrir una tarjeta muestra el detalle existente, y los cambios de estado
// siguen haciéndose desde ese detalle (con sus permisos, revisión y confirmaciones). No hay arrastrar y soltar.
// Mientras se carga el detalle el botón usa aria-disabled en vez de disabled: así conserva el foco y PanelDialog puede devolvérselo al cerrar.
export default function QuotePipelineBoard({ items, busy, onOpen }: { items: readonly PipelineQuote[]; busy: boolean; onOpen: (id: number) => void }) {
  const { columns, unclassified } = groupByState(items);
  return <div className="hqp-scroll" role="region" aria-label="Tablero de cotizaciones por estado" tabIndex={0} data-pipeline-board>
    <div className="hqp-columns">
      {PIPELINE_STATES.map(state => {
        const cards = columns[state], titleId = 'hqp-col-' + state;
        return <section key={state} className={'hqp-column hqp-col-' + state} aria-labelledby={titleId} data-state={state}>
          <header className="hqp-col-head">
            <h3 id={titleId}><span className="hqp-dot" aria-hidden="true" /><PanelIcon name={STATE_ICON[state]} size={16} /><span>{label(state)}</span></h3>
            <span className="hqp-count" aria-label={cards.length === 1 ? '1 cotización' : cards.length + ' cotizaciones'}>{cards.length}</span>
          </header>
          {cards.length
            ? <ul className="hqp-cards">{cards.map(quote => <li key={quote.id}>
              <article className="hqp-card" data-quote-id={quote.id} data-estado={quote.estado}>
                <div className="hqp-card-top">
                  <strong className="hqp-number">{quote.numero}</strong>
                  <span className={'hp-badge hp-state-' + quote.estado}>{label(quote.estado)}</span>
                </div>
                <h4 className="hqp-client">{quote.cliente}</h4>
                <p className="hqp-total">{formatQuoteTotal(quote)}</p>
                <dl className="hqp-meta">
                  {formatCreatedDate(quote.createdAt) && <div><dt><PanelIcon name="calendar" size={14} /> Creada</dt><dd><span className="hqp-date">{formatCreatedDate(quote.createdAt)}</span></dd></div>}
                  {formatCalendarDate(quote.validez) && <div><dt><PanelIcon name="calendar" size={14} /> Válida hasta</dt><dd><span className="hqp-date">{formatCalendarDate(quote.validez)}</span>{quote.vencida ? <span className="hqp-expired">Vencida</span> : null}</dd></div>}
                </dl>
                <button type="button" className="hp-btn hqp-open" aria-disabled={busy || undefined} aria-label={'Ver propuesta ' + quote.numero + ' de ' + quote.cliente} onClick={() => { if (!busy) onOpen(quote.id); }}>
                  <PanelIcon name="eye" size={16} /> Ver propuesta
                </button>
              </article>
            </li>)}</ul>
            : <p className="hqp-empty">Sin cotizaciones en este estado.</p>}
        </section>;
      })}
    </div>
    {unclassified.length > 0 && <p className="hp-error" role="status">{unclassified.length} cotización(es) con un estado desconocido no se muestran en el tablero. Consulta la vista Tabla.</p>}
  </div>;
}
