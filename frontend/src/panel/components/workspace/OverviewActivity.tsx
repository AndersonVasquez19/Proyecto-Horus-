import { useEffect, useId, useState } from 'react';
import { useAdminAuth } from '../../context';
import { useRequestStatus } from '../../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../../services/panelApi';
import type { ActivityStats } from '../../types/workspace';
import PanelIcon from '../PanelIcon';
import { usePanelAccess } from '../../context/usePanelAccess';

const RANGES = [7, 30, 90] as const;
const QUOTE_STATES: [string, string][] = [['borrador', 'Borrador'], ['enviada', 'Enviada'], ['aceptada', 'Aceptada'], ['rechazada', 'Rechazada'], ['anulada', 'Anulada']];
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
// Una respuesta con otra forma se trata como error de carga, nunca como «sin actividad».
function isActivity(value: unknown): value is ActivityStats {
  return isObject(value) && Array.isArray(value.mensajes) && isObject(value.cotizaciones) && isObject(value.cotizaciones.porEstado)
    && value.mensajes.every(day => isObject(day) && typeof day.fecha === 'string' && typeof day.total === 'number' && typeof day.chatbot === 'number');
}
const shortDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
// Marca del eje: múltiplo «redondo» por encima del máximo, para que las barras no toquen el borde.
const niceMax = (value: number) => { if (value <= 4) return 4; const step = 10 ** Math.floor(Math.log10(value)); return Math.ceil(value / step) * step; };

export default function OverviewActivity({ go }: { go: (section: string) => void }) {
  const canQuotes = usePanelAccess().canOpen('cotizaciones'); // sin permiso no se ofrece el enlace (E3.4.3, fase 2)
  const { token } = useAdminAuth();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<ActivityStats | null>(null);
  const { loading, error, setLoading, setError } = useRequestStatus(JSON.stringify([token, days, reload]));
  const tableId = useId();
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    panelRequest<unknown>('stats/actividad?dias=' + days, token, 'GET', undefined, controller.signal)
      .then(result => { if (controller.signal.aborted) return; if (!isActivity(result)) throw new Error('El servidor devolvió datos con un formato inesperado.'); setData(result); })
      .catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, days, reload, setLoading, setError]);

  // `data` puede pertenecer a otro rango mientras llega la respuesta nueva: solo se dibuja si coincide con el rango elegido.
  const current = data && data.mensajes.length === days && !error ? data : null;
  const series = current?.mensajes ?? [];
  const total = series.reduce((sum, day) => sum + day.total, 0);
  const viaChatbot = series.reduce((sum, day) => sum + day.chatbot, 0);
  const busiest = series.reduce((best, day) => day.total > best.total ? day : best, { fecha: '', total: 0, chatbot: 0 });
  const max = niceMax(Math.max(0, ...series.map(day => day.total)));
  const W = 640, H = 220, L = 38, B = 26, T = 8, plotW = W - L - 4, plotH = H - B - T;
  const slot = plotW / Math.max(1, series.length), barW = Math.max(2, slot * 0.68);
  const y = (value: number) => T + plotH - (value / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelAt = new Set([0, Math.floor((series.length - 1) / 2), series.length - 1]);
  const quotes = current?.cotizaciones;
  const quoteMax = Math.max(1, ...QUOTE_STATES.map(([key]) => quotes?.porEstado[key] ?? 0));
  const summary = current ? (total
    ? `Del ${shortDate(current.desde)} al ${shortDate(current.hasta)} se recibieron ${total} mensajes, ${viaChatbot} de ellos desde el chatbot. El día con más actividad fue el ${shortDate(busiest.fecha)} (${busiest.total}).`
    : `Del ${shortDate(current.desde)} al ${shortDate(current.hasta)} no se recibieron mensajes.`) : '';

  return <section className="hp-card hp-activity-card" aria-labelledby="hp-activity-title" aria-busy={loading}>
    <div className="hp-card-heading"><div><p className="hp-kicker">ACTIVIDAD</p><h2 id="hp-activity-title">Mensajes recibidos</h2>
      <p>Cada barra es un día: cuenta las consultas que llegaron por el formulario de contacto y por el chatbot, según la fecha de registro (hora de Perú).</p></div>
      <div className="hw-tabs" role="group" aria-label="Periodo del gráfico">{RANGES.map(range => <button key={range} type="button" aria-pressed={days === range} onClick={() => setDays(range)}>{range} días</button>)}</div></div>
    {error ? <div className="hp-empty hp-empty-compact" role="alert"><p>No se pudo cargar la actividad. {error}</p><button className="hp-btn" onClick={() => setReload(n => n + 1)}>Reintentar</button></div>
      : !current ? <div className="hp-empty hp-empty-compact" role="status"><span className="hp-loading" /><p>Cargando actividad…</p></div>
      : <>
        <div className="hp-chart-summary"><div><strong>{total}</strong><span>mensajes en {days} días</span></div><div><strong>{viaChatbot}</strong><span>desde el chatbot</span></div>
          <ul className="hp-legend" aria-label="Leyenda"><li><span className="hp-legend-key hp-legend-contact" />Formulario de contacto</li><li><span className="hp-legend-key hp-legend-bot" />Chatbot</li></ul></div>
        <p className="hp-sr" id={tableId + '-summary'}>{summary}</p>
        {total === 0 && <p className="hp-muted">No hay mensajes en este periodo. El gráfico se llenará cuando lleguen consultas.</p>}
        <div className="hp-chart-wrap"><svg className="hp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={tableId + '-summary'} preserveAspectRatio="xMidYMid meet">
          {ticks.map(tick => <g key={tick}><line x1={L} x2={W - 4} y1={y(tick)} y2={y(tick)} className="hp-chart-grid" /><text x={L - 6} y={y(tick) + 4} textAnchor="end" className="hp-chart-text">{Math.round(tick)}</text></g>)}
          {series.map((day, index) => {
            const x = L + index * slot + (slot - barW) / 2, other = day.total - day.chatbot;
            return <g key={day.fecha}><title>{shortDate(day.fecha) + ': ' + day.total + (day.total === 1 ? ' mensaje' : ' mensajes') + (day.chatbot ? ' (' + day.chatbot + ' del chatbot)' : '')}</title>
              {other > 0 && <rect x={x} y={y(other)} width={barW} height={plotH - (y(other) - T)} rx="1.5" className="hp-chart-contact" />}
              {day.chatbot > 0 && <rect x={x} y={y(day.total)} width={barW} height={y(other) - y(day.total)} rx="1.5" className="hp-chart-bot" />}
              {labelAt.has(index) && <text x={x + barW / 2} y={H - 8} textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'} className="hp-chart-text">{shortDate(day.fecha)}</text>}</g>;
          })}
        </svg></div>
        <details className="hp-chart-data"><summary>Ver los datos del gráfico en tabla</summary>
          <div className="hp-table-wrap"><table className="hp-chart-table"><caption className="hp-sr">Mensajes recibidos por día</caption><thead><tr><th scope="col">Día</th><th scope="col">Total</th><th scope="col">Del chatbot</th></tr></thead>
            <tbody>{[...series].reverse().map(day => <tr key={day.fecha}><th scope="row">{shortDate(day.fecha)}</th><td>{day.total}</td><td>{day.chatbot}</td></tr>)}</tbody></table></div></details>
        <div className="hp-quotes-chart"><div><p className="hp-kicker">COTIZACIONES</p><h3>Cotizaciones por estado</h3>
          <p className="hp-muted-inline">Todas las cotizaciones registradas, agrupadas por su estado actual.</p></div>
          {quotes && quotes.total > 0 ? <ul>{QUOTE_STATES.map(([key, text]) => { const value = quotes.porEstado[key] ?? 0; return <li key={key}><span>{text}</span>
            <span className="hp-bar-track" aria-hidden="true"><span className={'hp-bar-fill hp-quote-' + key} style={{ width: (value / quoteMax * 100) + '%' }} /></span><strong>{value}</strong></li>; })}</ul>
            : <p className="hp-muted-inline">Aún no hay cotizaciones registradas.</p>}
          {canQuotes && <button className="hp-text-btn" onClick={() => go('cotizaciones')}>Ir a cotizaciones <PanelIcon name="arrow" size={15} /></button>}</div>
      </>}
  </section>;
}
