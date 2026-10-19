import { useEffect, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import PanelIcon from './PanelIcon';

type Unanswered = { id: number; pregunta: string; veces: number; createdAt: string; updatedAt: string };
type Metrics = { dias: number; interacciones: number; resueltas: number; sinRespuesta: number; conIa: number; conCatalogo: number };
type Response = { items: Unanswered[]; pagination: { total: number; pages: number; page: number }; metrics: Metrics };

const PAGE_SIZE = 20;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
// Una respuesta con otra forma se trata como error de carga, nunca como «no hay preguntas» ni como métricas en cero.
const isResponse = (value: unknown): value is Response => isObject(value) && Array.isArray(value.items) && isObject(value.pagination) && isObject(value.metrics)
  && typeof value.pagination.total === 'number' && typeof value.metrics.interacciones === 'number';
const day = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }); };

// Vista de SOLO LECTURA: auditoría de las consultas que el asistente no pudo resolver. El texto ya se guarda sin correos, teléfonos ni enlaces.
export default function PanelChatbot() {
  const { token } = useAdminAuth();
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const [data, setData] = useState<Response | null>(null);
  const { loading, error, setLoading, setError } = useRequestStatus(JSON.stringify([page, query, revision]));
  useEffect(() => {
    const controller = new AbortController(); let live = true;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), ...(query ? { search: query } : {}) });
    panelRequest<unknown>('chatbot/sin-respuesta?' + params, token, 'GET', undefined, controller.signal)
      .then(result => { if (!isResponse(result)) throw new Error('El servidor devolvió datos con un formato inesperado.'); if (live) setData(result); })
      .catch(err => { if (live && !controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [token, page, query, revision, setLoading, setError]);
  const metrics = data?.metrics, pages = Math.max(1, data?.pagination.pages ?? 1);
  const metric = (value?: number) => loading ? '…' : error || value === undefined ? '—' : String(value);
  const submit = (event: SubmitEvent<HTMLFormElement>) => { event.preventDefault(); setPage(1); setQuery(search.trim()); };
  return <>
    <div className="hp-heading"><div><p className="hp-kicker">ATENCIÓN AL CLIENTE</p><h1>Consultas del chatbot</h1>
      <p>Preguntas que el asistente no pudo responder con el contenido publicado. Sirven para decidir qué publicar; esta vista es de solo lectura.</p></div>
      <button className="hp-btn" onClick={() => setRevision(value => value + 1)} disabled={loading}><PanelIcon name="refresh" />Actualizar</button></div>
    {error && <p className="hp-error" role="alert">{error}</p>}
    <section className="hw-insights hw-insights-4" aria-label={'Uso del asistente en los últimos ' + (metrics?.dias ?? 30) + ' días'} aria-busy={loading}>
      {[['Interacciones', metrics?.interacciones], ['Resueltas', metrics?.resueltas], ['Sin respuesta', metrics?.sinRespuesta], ['Con IA', metrics?.conIa]].map(([title, value]) =>
        <article key={String(title)}><span className="hp-badge">{title}</span><strong>{metric(value as number | undefined)}</strong><span>Últimos {metrics?.dias ?? 30} días</span></article>)}
    </section>
    <section className="hp-card">
      <div className="hp-card-heading"><div><h2>Preguntas sin respuesta</h2><p role="status">{loading ? 'Cargando…' : error ? 'Datos no disponibles' : (data?.pagination.total ?? 0) + ' preguntas distintas'}</p></div></div>
      <form className="hp-toolbar" onSubmit={submit}>
        <div className="hp-search"><PanelIcon name="search" /><input type="search" aria-label="Buscar preguntas" placeholder="Buscar en las preguntas…" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></div>
        <button className="hp-btn">Buscar</button>
      </form>
      {loading && !data ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando preguntas…</p></div>
        : error ? <div className="hp-empty"><p>No se pudieron cargar las preguntas.</p><button className="hp-btn" onClick={() => setRevision(value => value + 1)}>Reintentar</button></div>
        : !data?.items.length ? <div className="hp-empty"><h3>{query ? 'No encontramos coincidencias' : 'Todavía no hay preguntas sin respuesta'}</h3><p>{query ? 'Prueba con otra búsqueda.' : 'Cuando el asistente no encuentre información publicada, la pregunta aparecerá aquí.'}</p></div>
        : <div className="hp-table-wrap" aria-busy={loading}><table className="hp-table"><caption className="hp-sr">Preguntas sin respuesta del asistente, ordenadas por la más reciente</caption>
          <thead><tr><th scope="col">Pregunta</th><th scope="col">Veces</th><th scope="col">Última vez</th><th scope="col">Primera vez</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}><td role="rowheader">{item.pregunta}</td><td>{item.veces}</td><td>{day(item.updatedAt)}</td><td>{day(item.createdAt)}</td></tr>)}</tbody></table></div>}
      <footer className="hp-pagination"><button className="hp-btn" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page} de {pages}</span>
        <button className="hp-btn" disabled={loading || !!error || page >= pages} onClick={() => setPage(value => value + 1)}>Siguiente</button></footer>
    </section>
  </>;
}
