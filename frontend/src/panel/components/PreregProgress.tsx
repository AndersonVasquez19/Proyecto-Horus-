import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import { notify } from '../services/notify';
import { EDITION_STATES, editionDate, type EditionState } from '../services/editions';
import { PREREG_STATES, parsePreregSummary, type PreregState, type PreregSummary, type PreregSummaryItem } from '../services/preregistrations';
import PanelDialog from './PanelDialog';
import PanelIcon from './PanelIcon';

const COUNT_ORDER: PreregState[] = ['recibida', 'validada', 'matriculada', 'desistida', 'descartada'];
const canToggle = (item: PreregSummaryItem) => !item.convocatoria.archivado_at && (item.convocatoria.preinscripcion_estado === 'abierta' || (['planificada', 'abierta'].includes(item.convocatoria.estado) && item.convocatoria.capacidad !== null));

// Avance de cada edición hacia su mínimo de apertura y control de la recepción. La recepción es independiente de la apertura académica:
// habilitarla no abre la edición, y llegar al mínimo tampoco la abre sola.
export default function PreregProgress({ onViewRequests }: { onViewRequests: (editionId: number, name: string) => void }) {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [query, setQuery] = useState({ search: '', page: 1, limit: 20 }), [search, setSearch] = useState(''), [refresh, setRefresh] = useState(0);
  const requestKey = JSON.stringify([token, query, refresh]);
  const { loading, error, setError, setLoading } = useRequestStatus(requestKey);
  const [data, setData] = useState<{ key: string; result: PreregSummary } | null>(null), [toggle, setToggle] = useState<PreregSummaryItem | null>(null);
  const reload = () => setRefresh(v => v + 1);
  const listing = data?.key === requestKey ? data.result : null;
  useEffect(() => {
    let live = true; const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 15000);
    const params = new URLSearchParams({ archivo: 'activos', search: query.search, page: String(query.page), limit: String(query.limit) });
    panelRequest<unknown>('preinscripciones/resumen?' + params, token, 'GET', undefined, controller.signal)
      .then(result => { const parsed = parsePreregSummary(result); if (!parsed) throw new Error('No se pudo interpretar el avance de las ediciones.'); if (live) setData({ key: requestKey, result: parsed }); })
      .catch(err => { if (live) setError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); })
      .finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, query, requestKey, setError, setLoading]);
  return <section className="hp-card" aria-label="Avance por edición" aria-busy={loading}>
    <div className="hp-card-heading"><div><h2>Avance por edición</h2><p>Una edición nueva necesita 10 preinscripciones validadas antes de poder abrirse; la apertura siempre la confirma una persona.</p></div></div>
    <form role="search" className="hp-toolbar" onSubmit={e => { e.preventDefault(); setQuery(q => ({ ...q, search: search.trim(), page: 1 })); }}>
      <div className="hp-search"><PanelIcon name="search" /><input type="search" aria-label="Buscar ediciones con preinscripciones" placeholder="Edición o curso…" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></div><button className="hp-btn">Buscar</button>
      <button type="button" className="hp-btn" disabled={loading} onClick={reload}><PanelIcon name="refresh" />Actualizar</button>
    </form>
    {error ? <div className="hp-empty"><p className="hp-error" role="alert">{error}</p><button className="hp-btn" onClick={reload}>Reintentar</button></div>
      : loading ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando avance…</p></div>
        : !listing?.items.length ? <div className="hp-empty"><PanelIcon name="calendar" size={32} /><h3>No hay ediciones con preinscripciones</h3><p>Aparecerán aquí las ediciones que reciban solicitudes o tengan la recepción abierta.</p></div>
          : <ul className="hr-edition-cards">{listing.items.map(item => {
            const { convocatoria: edition, apertura, cupos, conteo } = item;
            const percent = apertura.minimo ? Math.min(100, Math.round(apertura.contadas / apertura.minimo * 100)) : 0;
            return <li key={edition.id} className="hr-edition-card">
              <div className="hr-edition-head"><div><strong>{edition.nombre}</strong><small>{edition.curso.titulo} · {editionDate(edition.fecha_inicio)} a {editionDate(edition.fecha_fin)}</small></div>
                <div><span className={'hp-badge ' + (edition.preinscripcion_estado === 'abierta' ? 'hp-state-activo' : '')}>Recepción {edition.preinscripcion_estado === 'abierta' ? 'abierta' : 'cerrada'}</span> <span className="hp-badge">{EDITION_STATES[edition.estado as EditionState] ?? edition.estado}</span></div></div>
              {apertura.minimo === null ? <p className="hr-edition-note">Edición anterior: no tiene mínimo de apertura.</p>
                : <div className="hr-progress"><div className="hr-progress-text"><span>{apertura.contadas} de {apertura.minimo} validadas</span><span>{apertura.cumple_minimo ? 'Cumple el mínimo' : 'Faltan ' + apertura.faltan}</span></div>
                  <div className="hr-progress-bar" role="progressbar" aria-label={'Preinscripciones validadas de ' + edition.nombre} aria-valuemin={0} aria-valuemax={apertura.minimo} aria-valuenow={Math.min(apertura.contadas, apertura.minimo)}><span style={{ width: percent + '%' }} /></div></div>}
              <p className="hr-edition-note">{cupos.capacidad === null ? 'Capacidad sin definir: no se pueden validar ni matricular solicitudes.' : cupos.ocupados + ' de ' + cupos.capacidad + ' cupos ocupados · ' + cupos.disponibles + ' disponibles'}</p>
              <ul className="hr-counts" aria-label="Solicitudes por estado">{COUNT_ORDER.map(state => <li key={state}><strong>{conteo[state]}</strong><span>{PREREG_STATES[state]}</span></li>)}</ul>
              <div className="hp-row-actions"><button className="hp-btn" onClick={() => onViewRequests(edition.id, edition.nombre)}>Ver solicitudes ({conteo.total})</button>
                {can(PANEL_ACTIONS.recepcionEdicion) && canToggle(item) && <button className="hp-btn" onClick={() => setToggle(item)}>{edition.preinscripcion_estado === 'abierta' ? 'Cerrar recepción' : 'Habilitar recepción'}</button>}</div>
            </li>;
          })}</ul>}
    {listing && <div className="hp-pagination"><span role="status">{listing.pagination.total} ediciones · Página {query.page} de {Math.max(1, listing.pagination.pages)}</span><div><button className="hp-btn" disabled={loading || query.page <= 1} onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}>Anterior</button><button className="hp-btn" disabled={loading || query.page >= listing.pagination.pages} onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}>Siguiente</button></div></div>}
    {toggle && <ReceptionDialog item={toggle} onClose={() => { setToggle(null); reload(); }} onSaved={() => { setToggle(null); reload(); }} />}
  </section>;
}

function ReceptionDialog({ item, onClose, onSaved }: { item: PreregSummaryItem; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const edition = item.convocatoria, closing = edition.preinscripcion_estado === 'abierta';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const apply = async () => {
    if (locked.current || blocked || !can(PANEL_ACTIONS.recepcionEdicion)) return;
    locked.current = true; setBusy(true); setError('');
    const controller = new AbortController(); request.current = controller; const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const result = await panelRequest<{ item?: { id: number; revision: number; preinscripcion_estado?: string } }>('convocatorias/' + edition.id + '/preinscripcion', token, 'PUT', { revision: edition.revision, estado: closing ? 'cerrada' : 'abierta' }, controller.signal);
      if (!result.item?.id || result.item.revision <= edition.revision) throw new Error('No se pudo confirmar el resultado.');
      if (mounted.current) { notify.success(closing ? 'Recepción cerrada.' : 'Recepción habilitada.'); onSaved(); }
    } catch (err) { if (mounted.current) { setBlocked(true); setError(errorMessage(err) + ' Actualiza la lista antes de repetir; no se reintentará automáticamente.'); } }
    finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setBusy(false); }
  };
  return <PanelDialog title={closing ? 'Cerrar recepción' : 'Habilitar recepción'} busy={busy} onClose={() => { if (!busy) onClose(); }} lockScroll
    footer={<><button className="hp-btn" disabled={busy} onClick={onClose} data-autofocus>{blocked ? 'Cerrar y actualizar' : 'Volver'}</button>{!blocked && <button className="hp-btn hp-btn-primary" disabled={busy} onClick={() => void apply()}>{busy ? 'Guardando…' : 'Confirmar'}</button>}</>}>
    <div className="hp-confirm"><h3>{edition.nombre}</h3><p>{edition.curso.titulo}</p>
      <p>{closing ? 'La edición dejará de recibir preinscripciones nuevas. Las ya recibidas se conservan.' : 'La edición recibirá preinscripciones desde el sitio web mientras queden cupos. Esto no abre la edición académicamente.'}</p></div>
    {error && <p className="hp-error" role="alert">{error}</p>}
  </PanelDialog>;
}
