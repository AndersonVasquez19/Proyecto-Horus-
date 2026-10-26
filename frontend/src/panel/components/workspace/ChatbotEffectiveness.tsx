import { useEffect, useState } from 'react';
import { useAdminAuth } from '../../context';
import { useRequestStatus } from '../../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../../services/panelApi';
import { chatbotResolvedPercent, formatPercent, parseChatbotMetrics, type ChatbotMetrics } from '../../services/overviewAnalytics';
import PanelIcon from '../PanelIcon';

// Respuestas del chatbot en los últimos días que informa el servidor (30). Solo se monta si la cuenta puede abrir «Consultas del chatbot»
// (chatbot_consultas:leer): sin ese permiso no hace ninguna petición. GET /admin/chatbot/sin-respuesta calcula `metrics` aparte de la
// paginación, así que `limit=1` basta y no se descargan las preguntas. «Con respuesta» = el asistente encontró información publicada;
// no mide satisfacción ni sustituye la atención del equipo. Sus estados de carga, vacío y error no dependen del resto del Resumen.
export default function ChatbotEffectiveness({ refreshKey, onOpen }: { refreshKey: number; onOpen?: () => void }) {
  const { token } = useAdminAuth();
  const [result, setResult] = useState<{ token: string; metrics: ChatbotMetrics } | null>(null);
  const [reload, setReload] = useState(0);
  const { loading, error, setLoading, setError } = useRequestStatus(JSON.stringify([token, reload, refreshKey]));
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    panelRequest<unknown>('chatbot/sin-respuesta?limit=1', token, 'GET', undefined, controller.signal)
      .then(data => { if (controller.signal.aborted) return; const metrics = parseChatbotMetrics(data); if (!metrics) throw new Error('El servidor devolvió datos con un formato inesperado.'); setResult({ token, metrics }); })
      .catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, reload, refreshKey, setLoading, setError]);
  const metrics = !error && result?.token === token ? result.metrics : null;
  const percent = metrics ? chatbotResolvedPercent(metrics) : null;
  return <section className="hp-card hp-analytics-card" aria-labelledby="hp-chatbot-title" aria-busy={loading}>
    <div className="hp-card-heading"><div><p className="hp-kicker">CHATBOT</p><h2 id="hp-chatbot-title">Respuestas del chatbot</h2>
      <p>{metrics ? 'Conversaciones de los últimos ' + metrics.dias + ' días.' : 'Cuántas consultas del asistente se respondieron con el contenido publicado.'}</p></div></div>
    {error ? <div className="hp-empty hp-empty-compact" role="alert"><p>No se pudieron cargar las métricas del chatbot. {error}</p><button type="button" className="hp-btn" onClick={() => setReload(n => n + 1)}>Reintentar</button></div>
      : !metrics ? <div className="hp-empty hp-empty-compact" role="status"><span className="hp-loading" /><p>Cargando métricas…</p></div>
      : metrics.interacciones === 0 ? <div className="hp-empty hp-empty-compact"><PanelIcon name="help" size={28} /><h3>Aún no hay conversaciones</h3><p>Cuando el chatbot reciba preguntas en los últimos {metrics.dias} días, verás aquí cuántas pudo responder.</p></div>
      : <div className="hp-analytics-body">
        <div className="hp-stat-line"><strong>{formatPercent(percent)}</strong><span>con respuesta</span></div>
        <div className="hp-split-bar" role="img" aria-label={metrics.resueltas + ' con respuesta y ' + metrics.sinRespuesta + ' sin respuesta, de ' + metrics.interacciones + ' conversaciones'}>
          {metrics.resueltas > 0 && <span className="hp-split-ok" style={{ flexGrow: metrics.resueltas }} />}{metrics.sinRespuesta > 0 && <span className="hp-split-miss" style={{ flexGrow: metrics.sinRespuesta }} />}</div>
        <dl className="hp-facts">
          <div><dt>Conversaciones</dt><dd>{metrics.interacciones}</dd></div>
          <div><dt>Con respuesta</dt><dd>{metrics.resueltas}</dd></div>
          <div><dt>Sin respuesta</dt><dd>{metrics.sinRespuesta}</dd></div>
          <div><dt>Con modo IA</dt><dd>{metrics.conIa}</dd></div>
          <div><dt>Con catálogo</dt><dd>{metrics.conCatalogo}</dd></div>
        </dl>
        <p className="hp-muted-inline">«Con respuesta» significa que el asistente encontró información publicada. No mide si la persona quedó conforme: las preguntas sin respuesta sirven para decidir qué publicar.</p>
        {onOpen && <button type="button" className="hp-text-btn" onClick={onOpen}>Ver preguntas sin respuesta <PanelIcon name="arrow" size={15} /></button>}
      </div>}
  </section>;
}
