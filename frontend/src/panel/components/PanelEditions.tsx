import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import { notify } from '../services/notify';
import { ACTION_LABEL, EDITION_STATES, editionActions, editionDate, type Edition, type EditionAction, type EditionList } from '../services/editions';
import PanelDialog from './PanelDialog';
import PanelIcon from './PanelIcon';
import EditionEditor from './EditionEditor';
import EditionCourseSelect from './EditionCourseSelect';
import EditionSchedules from './EditionSchedules';

export default function PanelEditions() {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [query, setQuery] = useState({ search: '', estado: '', curso_id: '', archivo: 'activos', page: 1, limit: 20 });
  const [search, setSearch] = useState(''), [refresh, setRefresh] = useState(0);
  const requestKey = JSON.stringify([token, query, refresh]);
  const { loading, error, setError, setLoading } = useRequestStatus(requestKey);
  const [data, setData] = useState<{ key: string; result: EditionList } | null>(null);
  const [editor, setEditor] = useState<{ original: Edition | null } | null>(null), [detail, setDetail] = useState<Edition | null>(null);
  const [operation, setOperation] = useState<{ item: Edition; action: EditionAction } | null>(null), [schedules, setSchedules] = useState<Edition | null>(null);
  const [busy, setBusy] = useState(false), [operationError, setOperationError] = useState(''), [blocked, setBlocked] = useState(false);
  const request = useRef<AbortController | null>(null), sequence = useRef(0), locked = useRef(false);
  const listing = data?.key === requestKey ? data.result : null;
  const reload = () => setRefresh(v => v + 1);
  useEffect(() => {
    let live = true; const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 15000);
    const params = new URLSearchParams({ search: query.search, archivo: query.archivo, page: String(query.page), limit: String(query.limit) });
    if (query.estado) params.set('estado', query.estado); if (query.curso_id) params.set('curso_id', query.curso_id);
    panelRequest<EditionList>('convocatorias?' + params, token, 'GET', undefined, controller.signal)
      .then(result => { if (!Array.isArray(result.items) || !result.pagination) throw new Error('No se pudo interpretar la lista de ediciones.'); if (live) setData({ key: requestKey, result }); })
      .catch(err => { if (live) setError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); })
      .finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, query, requestKey, setError, setLoading]);
  useEffect(() => () => { sequence.current++; request.current?.abort(); }, []);
  const open = async (id: number, mode: 'detail' | 'edit' | EditionAction) => {
    if (locked.current || (mode === 'edit' && !can('convocatorias:editar'))) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const current = ++sequence.current; setBusy(true); setOperationError(''); setBlocked(false);
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result = await panelRequest<{ item: Edition }>('convocatorias/' + id, token, 'GET', undefined, controller.signal);
      if (current !== sequence.current) return;
      if (mode === 'detail') setDetail(result.item);
      else if (mode === 'edit') {
        if (result.item.archivado_at || !['planificada', 'abierta'].includes(result.item.estado)) { setOperationError('La edición ya no admite cambios. Actualiza la lista.'); reload(); return; }
        setEditor({ original: result.item });
      } else if (editionActions(result.item, can).includes(mode)) setOperation({ item: result.item, action: mode });
      else { setOperationError('La edición ya no permite esa operación. Actualiza la lista.'); reload(); }
    } catch (err) { if (current === sequence.current) setOperationError(errorMessage(err)); }
    finally { window.clearTimeout(timer); if (current === sequence.current) setBusy(false); }
  };
  const apply = async () => {
    if (!operation || locked.current || blocked || !editionActions(operation.item, can).includes(operation.action)) return;
    locked.current = true; setBusy(true); setOperationError('');
    const { item, action } = operation;
    const suffix = action === 'open' ? 'apertura' : action === 'close' || action === 'cancel' ? 'cierre' : 'archivo';
    const body = { revision: item.revision, ...(suffix === 'cierre' ? { estado: action === 'close' ? 'cerrada' : 'cancelada' } : suffix === 'archivo' ? { archivado: action === 'archive' } : {}) };
    const controller = new AbortController(); request.current = controller; const current = ++sequence.current; const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const result = await panelRequest<{ item: Edition }>('convocatorias/' + item.id + '/' + suffix, token, 'PUT', body, controller.signal);
      if (!result.item?.id || !result.item.revision) throw new Error('No se pudo confirmar el resultado.');
      if (current === sequence.current) { notify.success('Edición actualizada.'); setOperation(null); reload(); }
    } catch (err) { if (current === sequence.current) { setBlocked(true); setOperationError(errorMessage(err) + ' Consulta la versión actual antes de repetir la operación.'); } }
    finally { window.clearTimeout(timer); locked.current = false; if (current === sequence.current) setBusy(false); }
  };
  const closeOperation = () => { if (!busy) { setOperation(null); setOperationError(''); if (blocked) reload(); } };
  return <div className="hs-students he-editions">
    <div className="hp-heading"><div><p className="hp-kicker">GESTIÓN ACADÉMICA</p><h1>Ediciones académicas</h1><p>Organiza las fechas, la capacidad y el ciclo de cada curso.</p></div><div className="hp-actions"><button className="hp-btn" disabled={loading || busy} onClick={reload}><PanelIcon name="refresh" />Actualizar</button>{can('convocatorias:crear') && <button className="hp-btn hp-btn-primary" disabled={busy} onClick={() => setEditor({ original: null })}><PanelIcon name="plus" />Crear edición</button>}</div></div>
    <section className="hs-summary" aria-label="Resumen de ediciones"><div className="hs-summary-icon"><PanelIcon name="calendar" size={26} /></div><div><span>Ediciones en esta consulta</span><strong>{listing ? listing.pagination.total : loading ? '…' : '—'}</strong></div><p>Cada edición conserva su curso, sus fechas y su historial.</p></section>
    {operationError && !operation && <p className="hp-error" role="alert">{operationError}</p>}{busy && !operation && <p role="status">Consultando edición…</p>}
    <section className="hp-card" aria-label="Listado de ediciones" aria-busy={loading}>
      <div className="hp-card-heading"><div><h2>Ediciones de cursos</h2><p>Busca por nombre de edición o curso asociado.</p></div><span className="hp-badge">{query.archivo === 'activos' ? 'Sin archivar' : query.archivo === 'archivados' ? 'Archivadas' : 'Todas'}</span></div>
      <form role="search" className="hp-toolbar" onSubmit={e => { e.preventDefault(); setQuery(q => ({ ...q, search: search.trim(), page: 1 })); }}>
        <div className="hp-search"><PanelIcon name="search" /><input type="search" aria-label="Buscar ediciones" placeholder="Edición o curso…" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></div><button className="hp-btn">Buscar</button>
        <select aria-label="Estado de ediciones" value={query.estado} onChange={e => setQuery(q => ({ ...q, estado: e.target.value, page: 1 }))}><option value="">Todos los estados</option>{Object.entries(EDITION_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label="Archivo de ediciones" value={query.archivo} onChange={e => setQuery(q => ({ ...q, archivo: e.target.value, page: 1 }))}><option value="activos">Sin archivar</option><option value="archivados">Archivadas</option><option value="todos">Todas</option></select>
        <select aria-label="Ediciones por página" value={query.limit} onChange={e => setQuery(q => ({ ...q, limit: Number(e.target.value), page: 1 }))}><option value={20}>20 por página</option><option value={50}>50 por página</option><option value={100}>100 por página</option></select>
      </form>
      <details className="he-course-filter"><summary>Filtrar por curso{query.curso_id ? ' · filtro aplicado' : ''}</summary><EditionCourseSelect value={query.curso_id} onChange={value => setQuery(q => ({ ...q, curso_id: value, page: 1 }))} allowAll /></details>
      {error ? <div className="hp-empty"><p className="hp-error" role="alert">{error}</p><button className="hp-btn" onClick={reload}>Reintentar</button></div>
        : loading ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando ediciones…</p></div>
          : !listing?.items.length ? <div className="hp-empty"><PanelIcon name="calendar" size={32} /><h3>No hay ediciones en esta consulta</h3><p>Cambia los filtros o crea una edición para un curso existente.</p>{query.page > 1 && <button className="hp-btn" onClick={() => setQuery(q => ({ ...q, page: 1 }))}>Ir a la primera página</button>}</div>
            : <div className="hp-table-wrap"><table className="hp-table hs-table"><caption className="hp-sr">Ediciones académicas y acciones disponibles</caption><thead><tr><th scope="col">Edición y curso</th><th scope="col">Fechas</th><th scope="col">Capacidad</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead><tbody>{listing.items.map(item => <tr key={item.id}><th scope="row"><div className="hp-record"><div><strong>{item.nombre}</strong><small>{item.curso.titulo}</small></div></div></th><td><span className="hs-contact">{editionDate(item.fecha_inicio)}<small>hasta {editionDate(item.fecha_fin)}</small></span></td><td>{item.capacidad ?? 'Sin definir'}</td><td><span className={'hp-badge ' + (item.estado === 'abierta' && !item.archivado_at ? 'hp-state-activo' : '')}>{EDITION_STATES[item.estado]}</span>{item.archivado_at && <small> · Archivada</small>}</td><td><div className="hp-row-actions"><button className="hp-btn" disabled={busy} onClick={() => void open(item.id, 'detail')}>Detalle</button><button className="hp-btn" disabled={busy} aria-label={'Horarios de ' + item.nombre} onClick={() => setSchedules(item)}>Horarios</button>
              {can('convocatorias:editar') && !item.archivado_at && ['planificada', 'abierta'].includes(item.estado) && <button className="hp-btn" disabled={busy} onClick={() => void open(item.id, 'edit')}>Editar</button>}
              {editionActions(item, can).map(action => <button key={action} className="hp-btn" disabled={busy} onClick={() => void open(item.id, action)}>{ACTION_LABEL[action]}</button>)}</div></td></tr>)}</tbody></table></div>}
      {listing && <div className="hp-pagination"><span role="status">{listing.pagination.total} ediciones · Página {query.page} de {Math.max(1, listing.pagination.pages)}</span><div><button className="hp-btn" disabled={loading || query.page <= 1} onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}>Anterior</button><button className="hp-btn" disabled={loading || query.page >= listing.pagination.pages} onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}>Siguiente</button></div></div>}
    </section>
    {editor && <EditionEditor original={editor.original} onClose={() => { setEditor(null); reload(); }} onSaved={() => { notify.success(editor.original ? 'Edición actualizada.' : 'Edición creada.'); setEditor(null); reload(); }} />}
    {schedules && <EditionSchedules editionId={schedules.id} editionName={schedules.nombre} onClose={() => setSchedules(null)} onSaved={() => { setSchedules(null); reload(); }} />}
    {detail && <PanelDialog title="Detalle de la edición" onClose={() => setDetail(null)} footer={<button className="hp-btn" onClick={() => setDetail(null)}>Cerrar</button>}><dl className="hp-details">{[
      ['Edición', detail.nombre], ['Curso asociado', detail.curso.titulo], ['Fecha de inicio', editionDate(detail.fecha_inicio)], ['Fecha de fin', editionDate(detail.fecha_fin)], ['Capacidad máxima', String(detail.capacidad ?? 'Sin definir')], ['Estado', EDITION_STATES[detail.estado] + (detail.archivado_at ? ' · Archivada' : '')], ['Revisión', String(detail.revision)], ['Última actualización', new Date(detail.updatedAt).toLocaleString('es-PE')],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></PanelDialog>}
    {operation && <PanelDialog title={ACTION_LABEL[operation.action]} busy={busy} onClose={closeOperation} footer={<><button className="hp-btn" disabled={busy} onClick={closeOperation} data-autofocus>{blocked ? 'Cerrar y actualizar' : 'Volver'}</button>{!blocked && <button className="hp-btn hp-btn-primary" disabled={busy} onClick={() => void apply()}>{busy ? 'Guardando…' : 'Confirmar'}</button>}</>}><div className="hp-confirm"><h3>{operation.item.nombre}</h3><p>{operation.item.curso.titulo}</p><p>{operation.action === 'close' || operation.action === 'cancel' ? 'Esta operación es definitiva: la edición conservará su historial y dejará de admitir cambios.' : operation.action === 'open' ? 'La edición quedará abierta con las fechas y la capacidad indicadas.' : operation.action === 'archive' ? 'Se retirará del listado de ediciones sin archivar y conservará su información.' : 'Volverá al listado sin archivar, conservando su estado terminal.'}</p></div>{operationError && <p className="hp-error" role="alert">{operationError}</p>}</PanelDialog>}
  </div>;
}
