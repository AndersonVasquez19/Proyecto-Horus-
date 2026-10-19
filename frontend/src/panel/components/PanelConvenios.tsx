import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { panelRequest, errorMessage } from '../services/panelApi';
import { notify } from '../services/notify';
import type { Convenio, ConvenioDetalle, ConvenioList, ConvenioResponse } from '../../types/convenios';
import PanelDialog from './PanelDialog';
import PanelIcon from './PanelIcon';
import ConvenioEditor from './ConvenioEditor';
import PublicImage from '../../components/PublicImage';
import '../styles/convenios.css';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { PanelReadOnlyNotice } from './PanelAccessNotice';

export default function PanelConvenios() {
  const { token } = useAdminAuth();
  // Operaciones según los permisos de la sesión (E3.4.3, fase 2). Sin editar, «Ver» abre el convenio en modo consulta.
  const access = usePanelAccess();
  const canCreate = access.can(PANEL_ACTIONS.crearConvenio), canEdit = access.can(PANEL_ACTIONS.editarConvenio), canDelete = access.can(PANEL_ACTIONS.eliminarConvenio);
  const canUpload = access.can(PANEL_ACTIONS.subirImagen);
  const [revision, setRevision] = useState(0), [page, setPage] = useState(1), [search, setSearch] = useState(''), [estado, setEstado] = useState('');
  const [data, setData] = useState<ConvenioList | null>(null);
  const { loading, error, setLoading, setError } = useRequestStatus(JSON.stringify([token, page, search, estado, revision]));
  const [editing, setEditing] = useState<ConvenioDetalle | 'new' | null>(null), [deleting, setDeleting] = useState<Convenio | null>(null);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => { action.current?.abort(); action.current = null; }, []);
  useEffect(() => {
    const c = new AbortController(); let live = true;
    const timeout = window.setTimeout(() => c.abort(), 15000);
    const params = new URLSearchParams({ page: String(page), limit: '20', search, ...(estado ? { estado } : {}) });
    void panelRequest<ConvenioList>('convenios?' + params, token, 'GET', undefined, c.signal)
      .then(r => { if (live) setData(r); }).catch(e => { if (live) setError(c.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(e)); })
      .finally(() => { window.clearTimeout(timeout); if (live) setLoading(false); });
    return () => { live = false; c.abort(); window.clearTimeout(timeout); };
  }, [token, page, search, estado, revision, setLoading, setError]);
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (action.current) return;
    const c = new AbortController(); action.current = c;
    const timeout = window.setTimeout(() => c.abort(), 15000);
    setBusy(true); setActionError('');
    try { await operation(c.signal); }
    catch (e) { if (action.current === c) setActionError(c.signal.aborted ? 'La operación tardó demasiado. Revisa los datos antes de reintentar.' : errorMessage(e)); }
    finally { window.clearTimeout(timeout); if (action.current === c) { action.current = null; setBusy(false); } }
  };
  const edit = (item: Convenio) => void run(async signal => {
    const r = await panelRequest<ConvenioResponse>('convenios/' + item.id, token, 'GET', undefined, signal);
    if (!signal.aborted) setEditing(r.item);
  });
  const toggle = (item: Convenio) => canEdit && void run(async signal => {
    await panelRequest('convenios/' + item.id, token, 'PUT', { visible: !item.visible }, signal);
    if (!signal.aborted) { setRevision(v => v + 1); notify.success('Visibilidad actualizada.'); }
  });
  const remove = () => deleting && canDelete && void run(async signal => {
    await panelRequest('convenios/' + deleting.id, token, 'DELETE', undefined, signal);
    if (!signal.aborted) { setDeleting(null); setRevision(v => v + 1); notify.success('Convenio eliminado. Los archivos subidos se conservan.'); }
  });
  return <div className="hp-convenios">
    <div className="hp-heading"><div><h1>Convenios</h1><p>Gestiona las alianzas institucionales y sus fotografías.</p></div>
      {canCreate && <button className="hp-btn hp-btn-primary" disabled={busy} onClick={() => { setActionError(''); setEditing('new'); }}><PanelIcon name="plus" />Nuevo convenio</button>}</div>
    {!canCreate && !canEdit && !canDelete && <PanelReadOnlyNotice>Modo consulta: tu cuenta puede ver los convenios, pero no modificarlos.</PanelReadOnlyNotice>}
    {actionError && !deleting && <p className="hp-error" role="alert">{actionError}</p>}
    <section className="hp-card">
      <div className="hp-convenios-tools"><label>Buscar convenio<input value={search} maxLength={100} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
        <label>Visibilidad<select value={estado} onChange={e => { setEstado(e.target.value); setPage(1); }}><option value="">Todos</option><option value="visible">Visibles</option><option value="oculto">Ocultos</option></select></label>
        <button className="hp-btn" disabled={loading || busy} onClick={() => setRevision(v => v + 1)}><PanelIcon name="refresh" />Actualizar</button></div>
      {loading ? <p role="status">Cargando convenios…</p> : error ? <div role="alert" className="hp-error"><p>{error}</p><button className="hp-btn" onClick={() => setRevision(v => v + 1)}>Reintentar</button></div> :
        !data?.items.length ? <p role="status">No hay convenios para esta búsqueda.{page > 1 && <button className="hp-btn" onClick={() => setPage(1)}>Volver a la primera página</button>}</p> :
        <div className="hp-table-wrap"><table className="hp-table"><thead><tr><th>Convenio</th><th>Orden</th><th>Visibilidad</th><th>Acciones</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}><td><div className="hp-convenio-name"><span className="hp-convenio-logo"><PublicImage src={item.logo_url} title={item.nombre} /></span><div><strong>{item.nombre}</strong>{item.sigla && <small>{item.sigla}</small>}</div></div></td>
            <td><span className="hp-convenio-order">{item.orden}</span></td><td><span className={'hp-convenio-visibility' + (item.visible ? ' is-visible' : '')}>{item.visible ? 'Visible' : 'Oculto'}</span></td><td><div className="hp-convenio-actions">
              <button className="hp-btn" disabled={busy} aria-label={(canEdit ? 'Editar ' : 'Ver ') + item.nombre} onClick={() => edit(item)}><PanelIcon name={canEdit ? 'edit' : 'eye'} />{canEdit ? 'Editar' : 'Ver'}</button>
              {canEdit && <button className="hp-btn" disabled={busy} onClick={() => toggle(item)}>{item.visible ? 'Ocultar' : 'Publicar'}</button>}
              {canDelete && <button className="hp-icon-btn" disabled={busy} aria-label={'Eliminar ' + item.nombre} onClick={() => { setActionError(''); setDeleting(item); }}><PanelIcon name="trash" /></button>}
            </div></td></tr>)}</tbody></table></div>}
      {!loading && !error && data && data.pagination.pages > 1 && <nav className="hp-convenios-tools" aria-label="Páginas de convenios">
        <button className="hp-btn" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Anterior</button><span>Página {page} de {data.pagination.pages}</span>
        <button className="hp-btn" disabled={page >= data.pagination.pages} onClick={() => setPage(v => v + 1)}>Siguiente</button></nav>}
    </section>
    {editing && (editing !== 'new' || canCreate) && <ConvenioEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing}
      allow={{ create: canCreate, edit: canEdit, upload: canUpload }}
      onClose={() => setEditing(null)} onSaved={() => { setRevision(v => v + 1); notify.success('Convenio guardado.'); }} />}
    {deleting && canDelete && <PanelDialog title="Eliminar convenio" busy={busy} onClose={() => setDeleting(null)}>
      <p>¿Eliminar «{deleting.nombre}» y los registros de sus fotografías? Los archivos físicos se conservarán.</p>
      {actionError && <p className="hp-error" role="alert">{actionError}</p>}
      <div className="hp-convenio-actions"><button className="hp-btn" disabled={busy} onClick={() => setDeleting(null)}>Cancelar</button>
        <button className="hp-btn hp-btn-primary" disabled={busy} onClick={remove}>{busy ? 'Eliminando…' : 'Eliminar convenio'}</button></div>
    </PanelDialog>}
  </div>;
}
