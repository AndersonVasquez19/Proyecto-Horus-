import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import { PREREG_ACTION_LABEL, PREREG_CHANNELS, PREREG_STATES, parsePreregDetail, parsePreregList, preregActions, preregDateTime, preregName, type PreregAction, type PreregChannel, type PreregDetail, type PreregList, type Prereg, type PreregState } from '../services/preregistrations';
import PanelIcon from './PanelIcon';
import PreregDetailDialog from './PreregDetailDialog';
import PreregOperationDialog from './PreregOperationDialog';
import PreregProgress from './PreregProgress';

type View = 'solicitudes' | 'avance';

export default function PanelPreregistrations() {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [view, setView] = useState<View>('solicitudes');
  const [query, setQuery] = useState({ search: '', estado: '', canal: '', convocatoria_id: 0, page: 1, limit: 20 }), [edition, setEdition] = useState('');
  const [search, setSearch] = useState(''), [refresh, setRefresh] = useState(0);
  const requestKey = JSON.stringify([token, query, refresh]);
  const { loading, error, setError, setLoading } = useRequestStatus(requestKey);
  const [data, setData] = useState<{ key: string; result: PreregList } | null>(null);
  const [detail, setDetail] = useState<PreregDetail | null>(null), [operation, setOperation] = useState<{ item: Prereg; action: PreregAction } | null>(null);
  const [busy, setBusy] = useState(false), [openError, setOpenError] = useState('');
  const request = useRef<AbortController | null>(null), sequence = useRef(0);
  const listing = data?.key === requestKey ? data.result : null;
  const reload = () => setRefresh(v => v + 1);
  useEffect(() => {
    if (view !== 'solicitudes') return;
    let live = true; const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 15000);
    const params = new URLSearchParams({ search: query.search, page: String(query.page), limit: String(query.limit) });
    if (query.estado) params.set('estado', query.estado); if (query.canal) params.set('canal', query.canal); if (query.convocatoria_id) params.set('convocatoria_id', String(query.convocatoria_id));
    panelRequest<unknown>('preinscripciones?' + params, token, 'GET', undefined, controller.signal)
      .then(result => { const parsed = parsePreregList(result); if (!parsed) throw new Error('No se pudo interpretar la lista de preinscripciones.'); if (live) setData({ key: requestKey, result: parsed }); })
      .catch(err => { if (live) setError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); })
      .finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, query, requestKey, view, setError, setLoading]);
  useEffect(() => () => { sequence.current++; request.current?.abort(); }, []);
  // Antes de operar se lee el detalle vigente: así la revisión y el estado son los actuales y no los de la lista.
  const open = async (id: number, mode: 'detail' | PreregAction) => {
    if (busy) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const current = ++sequence.current; setBusy(true); setOpenError('');
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result = parsePreregDetail(await panelRequest<unknown>('preinscripciones/' + id, token, 'GET', undefined, controller.signal));
      if (!result) throw new Error('No se pudo interpretar la respuesta del servidor.');
      if (current !== sequence.current) return;
      if (mode === 'detail') setDetail(result);
      else if (preregActions(result.item, can).includes(mode)) setOperation({ item: result.item, action: mode });
      else { setOpenError('La solicitud ya no permite esa operación. Se actualizó la lista.'); reload(); }
    } catch (err) { if (current === sequence.current) setOpenError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); }
    finally { window.clearTimeout(timer); if (current === sequence.current) setBusy(false); }
  };
  const filtered = !!(query.search || query.estado || query.canal || query.convocatoria_id);
  return <div className="hs-students hr-preregistrations">
    <div className="hp-heading"><div><p className="hp-kicker">GESTIÓN ACADÉMICA</p><h1>Preinscripciones</h1><p>Solicitudes de interés recibidas por el sitio web y el asistente. Una preinscripción todavía no es una matrícula.</p></div>
      <div className="hp-actions"><button className="hp-btn" disabled={loading || busy || view !== 'solicitudes'} onClick={reload}><PanelIcon name="refresh" />Actualizar</button></div></div>
    <div className="hr-views" role="group" aria-label="Vista de preinscripciones">
      <button className={'hp-btn' + (view === 'solicitudes' ? ' hp-btn-primary' : '')} aria-pressed={view === 'solicitudes'} onClick={() => setView('solicitudes')}>Solicitudes</button>
      <button className={'hp-btn' + (view === 'avance' ? ' hp-btn-primary' : '')} aria-pressed={view === 'avance'} onClick={() => setView('avance')}>Avance por edición</button>
    </div>
    {view === 'avance' ? <PreregProgress onViewRequests={(id, name) => { setQuery(q => ({ ...q, convocatoria_id: id, page: 1 })); setEdition(name); setView('solicitudes'); }} /> : <>
      <section className="hs-summary" aria-label="Resumen de solicitudes"><div className="hs-summary-icon"><PanelIcon name="user-plus" size={26} /></div><div><span>Solicitudes en esta consulta</span><strong>{listing ? listing.pagination.total : loading ? '…' : '—'}</strong></div><p>Valida las solicitudes para que cuenten hacia la apertura y conviértelas en matrícula cuando la edición esté abierta.</p></section>
      {openError && <p className="hp-error" role="alert">{openError}</p>}{busy && <p role="status">Consultando solicitud…</p>}
      <section className="hp-card" aria-label="Listado de preinscripciones" aria-busy={loading}>
        <div className="hp-card-heading"><div><h2>Solicitudes recibidas</h2><p>Busca por nombre, correo o teléfono.</p></div>{query.convocatoria_id > 0 && <span className="hp-badge">Edición: {edition}</span>}</div>
        <form role="search" className="hp-toolbar" onSubmit={e => { e.preventDefault(); setQuery(q => ({ ...q, search: search.trim(), page: 1 })); }}>
          <div className="hp-search"><PanelIcon name="search" /><input type="search" aria-label="Buscar preinscripciones" placeholder="Nombre, correo o teléfono…" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></div><button className="hp-btn">Buscar</button>
          <select aria-label="Estado de la solicitud" value={query.estado} onChange={e => setQuery(q => ({ ...q, estado: e.target.value as PreregState | '', page: 1 }))}><option value="">Todos los estados</option>{Object.entries(PREREG_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select aria-label="Canal de la solicitud" value={query.canal} onChange={e => setQuery(q => ({ ...q, canal: e.target.value as PreregChannel | '', page: 1 }))}><option value="">Todos los canales</option>{Object.entries(PREREG_CHANNELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select aria-label="Solicitudes por página" value={query.limit} onChange={e => setQuery(q => ({ ...q, limit: Number(e.target.value), page: 1 }))}><option value={20}>20 por página</option><option value={50}>50 por página</option><option value={100}>100 por página</option></select>
          {query.convocatoria_id > 0 && <button type="button" className="hp-btn" onClick={() => setQuery(q => ({ ...q, convocatoria_id: 0, page: 1 }))}>Quitar filtro de edición</button>}
        </form>
        {error ? <div className="hp-empty"><p className="hp-error" role="alert">{error}</p><button className="hp-btn" onClick={reload}>Reintentar</button></div>
          : loading ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando solicitudes…</p></div>
            : !listing?.items.length ? <div className="hp-empty"><PanelIcon name="user-plus" size={32} /><h3>{filtered ? 'No encontramos coincidencias' : 'Todavía no hay preinscripciones'}</h3><p>{filtered ? 'Prueba con otra búsqueda o cambia los filtros.' : 'Cuando alguien se preinscriba desde el sitio web o el asistente, aparecerá aquí.'}</p>{query.page > 1 && <button className="hp-btn" onClick={() => setQuery(q => ({ ...q, page: 1 }))}>Ir a la primera página</button>}</div>
              : <div className="hp-table-wrap"><table className="hp-table hs-table"><caption className="hp-sr">Preinscripciones y acciones disponibles</caption><thead><tr><th scope="col">Persona</th><th scope="col">Edición</th><th scope="col">Estado</th><th scope="col">Recibida y canal</th><th scope="col" className="hp-align-right">Acciones</th></tr></thead>
                <tbody>{listing.items.map(item => <tr key={item.id}><th scope="row"><div className="hp-record"><span className="hs-initial">{item.nombres.charAt(0)}</span><div><strong>{preregName(item)}</strong><small>{item.email}</small></div></div></th>
                  <td><span className="hs-contact">{item.convocatoria.nombre}<small>{item.convocatoria.curso.titulo}</small></span></td>
                  <td><span className={'hp-badge ' + (item.estado === 'validada' || item.estado === 'matriculada' ? 'hp-state-activo' : '')}>{PREREG_STATES[item.estado]}</span></td><td><span className="hs-contact">{preregDateTime(item.createdAt)}<small>{PREREG_CHANNELS[item.canal] ?? item.canal}</small></span></td>
                  <td><div className="hp-row-actions"><button className="hp-btn" disabled={busy} aria-label={'Ver detalle de ' + preregName(item)} onClick={() => void open(item.id, 'detail')}><PanelIcon name="eye" size={16} />Detalle</button>
                    {preregActions(item, can).map(action => <button key={action} className="hp-btn" disabled={busy} aria-label={PREREG_ACTION_LABEL[action] + ': ' + preregName(item)} onClick={() => void open(item.id, action)}>{PREREG_ACTION_LABEL[action]}</button>)}</div></td></tr>)}</tbody></table></div>}
        {listing && <div className="hp-pagination"><span role="status">{listing.pagination.total} solicitudes · Página {query.page} de {Math.max(1, listing.pagination.pages)}</span><div><button className="hp-btn" disabled={loading || query.page <= 1} onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}>Anterior</button><button className="hp-btn" disabled={loading || query.page >= listing.pagination.pages} onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}>Siguiente</button></div></div>}
      </section></>}
    {detail && <PreregDetailDialog detail={detail} onClose={() => setDetail(null)} />}
    {operation && <PreregOperationDialog item={operation.item} action={operation.action} onClose={() => { setOperation(null); reload(); }} onSaved={() => { setOperation(null); reload(); }} />}
  </div>;
}
