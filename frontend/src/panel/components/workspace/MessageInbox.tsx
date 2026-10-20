import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAdminAuth } from '../../context';
import { useConfirmLeave } from '../../unsaved/unsavedContext';
import { useLatest } from '../../hooks/useLatest';
import { PanelApiError, panelRequest, errorMessage } from '../../services/panelApi';
import { buildCsv, recordsOf } from '../../services/listRecords';
import { ExportError, EXPORT_PAGE_SIZE, MESSAGE_EXPORT_COLUMNS, fetchAllPages, toExportRows } from '../../services/messageExport';
import { label, type Row } from '../../types/workspace';
import { useCollection, dateLabel, type CollectionResponse } from './useCollection';
import { useMessageDetail } from './useMessageDetail';
import AttentionEditor from '../AttentionEditor';
import MessageCreateDialog from './MessageCreateDialog';
import MessageDeleteDialog from './MessageDeleteDialog';
import PanelIcon from '../PanelIcon';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import { notify } from '../../services/notify';
import { usePanelAccess } from '../../context/usePanelAccess';
import { PANEL_ACTIONS } from '../../context/panelAccess';
import { PanelReadOnlyNotice } from '../PanelAccessNotice';

const EXPORT_PAGE_TIMEOUT_MS = 15_000;

export default function MessageInbox() {
  const { token } = useAdminAuth();
  const [params, setParams] = useSearchParams(); const location = useLocation();
  // Operaciones según los permisos de la sesión (E3.4.3, fase 2): registro manual (también ?crear=1), cambios de estado y seguimiento,
  // envíos, eliminación y el enlace para preparar una cotización (exige poder abrir Cotizaciones y crear).
  const access = usePanelAccess();
  const canCreate = access.can(PANEL_ACTIONS.crearMensaje), canDelete = access.can(PANEL_ACTIONS.eliminarMensaje);
  const canReadFollowUp = access.can(PANEL_ACTIONS.leerSeguimiento), canEditFollowUp = canReadFollowUp && access.can(PANEL_ACTIONS.editarSeguimiento);
  const canSendFollowUp = access.can(PANEL_ACTIONS.enviarSeguimiento);
  const canQuote = access.canOpen('cotizaciones') && access.can(PANEL_ACTIONS.crearCotizacion);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('');
  const [page,setPage]=useState(1);
  const status = params.get('estado') || '';
  const listParams=new URLSearchParams({page:String(page),limit:'20',...(search.trim()?{search:search.trim()}:{}),...(status?{estado:status}:{}),...(channel?{channel}:{})});
  const {rows,loading,error,total,pages,metrics:counts}=useCollection('messages',false,revision,String(listParams));
  // Solo un entero positivo es una consulta; cualquier otro valor de ?id= se ignora (sin redirigir, para no crear bucles).
  const rawId = params.get('id');
  const selectedId = rawId && /^\d{1,9}$/.test(rawId) ? Number(rawId) : 0;
  // El detalle NO depende de la página, la búsqueda ni el filtro: sale de la lista si está, y si no, de la última versión conocida o de GET /messages/:id.
  const detail = useMessageDetail(selectedId, token, rows, loading);
  // Consulta eliminada hace un instante: se oculta de inmediato (y se desmonta su editor) antes de retirar ?id= de la URL.
  const [removedId, setRemovedId] = useState(0);
  const selected = detail.row && detail.row.id !== removedId ? detail.row : null;
  // Vista del listado: ambas comparten datos, filtros, selección y detalle. Solo cambia cómo se dibuja la lista; el detalle (y el borrador del editor)
  // ocupa siempre el mismo lugar del árbol, así que alternar la vista no lo desmonta. Es estado local: cambiar la URL con un borrador abierto avisaría sin necesidad.
  // Alias heredados: `vista=tabla` (la antigua tabla de mensajes) y `listado=tabla` abren la vista Tabla de entrada. Aquí solo llegan las URL de MENSAJES
  // (AdminDashboard monta cada sección por separado; los gestores editoriales se retiraron del panel). No hay redirección:
  // los parámetros (`id`, `estado`, `crear`…) se conservan tal cual y el historial no cambia.
  const [view, setView] = useState<'bandeja' | 'tabla'>(() => params.get('listado') === 'tabla' || params.get('vista') === 'tabla' ? 'tabla' : 'bandeja');
  const [deleting, setDeleting] = useState(false);
  // Guardado del seguimiento en vuelo, o con resultado incierto (lo notifica AttentionEditor). Mientras el PUT está pendiente no se cambia de consulta, de
  // filtro de estado ni de vista (desmontarían o abandonarían el editor sin conocer la respuesta). La navegación externa (menú, Atrás/Adelante) no se puede
  // impedir desde aquí: pasa por el aviso de cambios sin guardar, que sigue permitiendo salir.
  const [savePending, setSavePending] = useState(false), [saveUncertain, setSaveUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const lock = useRef(false);
  // D6.4 · lista → detalle en móvil: el detalle recibe el foco al abrirse y la fila de origen lo recupera al volver. En escritorio el foco no se mueve.
  const mobile = useMobileViewport();
  const detailHeading = useRef<HTMLHeadingElement>(null), focusDetail = useRef(false), returnTo = useRef(0);
  useEffect(() => { if (mobile && focusDetail.current && selected) { focusDetail.current = false; detailHeading.current?.focus(); } }, [mobile, selected]);
  useEffect(() => { if (selectedId || !returnTo.current) return; const id = returnTo.current; returnTo.current = 0; if (mobile) document.querySelector<HTMLElement>('[data-row-id="' + id + '"]')?.focus(); }, [selectedId, mobile]);
  const confirmLeave = useConfirmLeave(); // los cambios sin guardar del seguimiento nunca se pierden en silencio
  const [editorEpoch, setEditorEpoch] = useState(0); // fuerza una carga nueva del seguimiento (revisión al día) tras cambiar el estado
  const fromChat = (row: Row) => String(row.asunto).startsWith('[Chatbot]');
  // Registro manual. Se abre con el botón o con la URL heredada ?crear=1; el diálogo es modal, así que el detalle y el borrador de seguimiento
  // quedan montados debajo, intactos. Al cerrarlo solo se retira `crear` de la URL (sin añadir una entrada de historial).
  const [creatingLocal, setCreatingLocal] = useState(false);
  const creating = canCreate && (creatingLocal || params.get('crear') === '1');
  const createDenied = !canCreate && params.get('crear') === '1';
  const closeCreate = () => {
    setCreatingLocal(false);
    if (params.has('crear')) { const next = new URLSearchParams(params); next.delete('crear'); setParams(next, { replace: true }); }
  };
  const created = (message: Row | undefined) => {
    closeCreate(); setRevision(value => value + 1); // el listado se recarga; la selección (?id=) y el editor no se tocan
    notify.success('Consulta registrada' + (message?.nombre ? ' de ' + String(message.nombre) : '') + '. Aparece al inicio de la bandeja (si los filtros lo permiten).');
  };
  const deleted = (kind: 'deleted' | 'gone') => {
    const gone = selected;
    if (!gone) { setDeleting(false); return; }
    flushSync(() => { setRemovedId(gone.id); setDeleting(false); }); // desmonta el editor ANTES de navegar: su borrador ya no tiene destino ni debe bloquear la navegación
    const next = new URLSearchParams(params); next.delete('id'); setParams(next, { replace: true });
    setRevision(value => value + 1); // listado y métricas; filtros y página se conservan (si la página queda vacía se vuelve a la última válida)
    setActionError(''); if (kind === 'deleted') notify.success('Consulta eliminada: «' + String(gone.asunto) + '» de ' + String(gone.nombre) + '.'); else notify.warning('La consulta ya no existía en el servidor. Se actualizó la bandeja.');
  };
  // Exportación de los resultados filtrados: páginas en serie con el endpoint paginado; nada se descarga si alguna página falla o los datos cambian.
  const latestToken = useLatest(token);
  const exportController = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false), [exportNote, setExportNote] = useState(''), [exportError, setExportError] = useState('');
  useEffect(() => () => exportController.current?.abort(), []);
  const exportResults = async () => {
    if (exporting || !token) return;
    const startToken = token, controller = new AbortController(); exportController.current = controller;
    const filters = { search: search.trim(), status, channel }; // foto de los filtros al pulsar: cambiarlos después no mezcla resultados
    setExporting(true); setExportError(''); setExportNote('Preparando la exportación…');
    try {
      const rows = await fetchAllPages<Row>(async page => {
        if (latestToken.current !== startToken) throw new ExportError('aborted', 'La sesión cambió durante la exportación. No se descargó ningún archivo.');
        const query = new URLSearchParams({ page: String(page), limit: String(EXPORT_PAGE_SIZE), ...(filters.search ? { search: filters.search } : {}), ...(filters.status ? { estado: filters.status } : {}), ...(filters.channel ? { channel: filters.channel } : {}) });
        const data = await panelRequest<CollectionResponse>('messages?' + query, startToken, 'GET', undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(EXPORT_PAGE_TIMEOUT_MS)]));
        return { rows: recordsOf<Row>('messages', data), total: data.pagination?.total ?? NaN, pages: data.pagination?.pages ?? NaN };
      }, { signal: controller.signal, onProgress: (done, pages) => setExportNote('Exportando… página ' + done + ' de ' + pages) });
      if (controller.signal.aborted) throw new ExportError('aborted', 'Exportación cancelada. No se descargó ningún archivo.');
      const csv = buildCsv([...MESSAGE_EXPORT_COLUMNS], toExportRows(rows)); // misma protección D1 contra fórmulas (=, +, -, @)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'consultas-' + new Date().toLocaleDateString('en-CA') + '.csv'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportNote(''); notify.success('Se exportaron ' + rows.length + ' consultas.');
    } catch (caught) {
      setExportNote(''); setExportError(caught instanceof ExportError ? caught.message : 'No se pudo completar la exportación. No se descargó ningún archivo; vuelve a intentarlo.');
    } finally { if (exportController.current === controller) exportController.current = null; setExporting(false); }
  };
  // Página fuera de rango (se eliminó el último registro de la página o una búsqueda redujo las páginas): se vuelve a la última que existe.
  if (!loading && !error && page > 1 && page > Math.max(1, pages)) setPage(Math.max(1, pages));
  const outOfList = !!selected && !loading && !error && !rows.some(row => row.id === selected.id);
  const updateParams = (key: string, value: string) => savePending && (key === 'id' || key === 'estado') ? undefined : confirmLeave(() => {
    const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key);
    if (key === 'estado') { next.delete('id'); setPage(1); } setParams(next);
  });
  const openRow = (id: number) => { focusDetail.current = true; returnTo.current = id; updateParams('id', String(id)); };
  const closeDetail = () => { returnTo.current = selectedId; updateParams('id', ''); };
  const changeState = (state: string) => confirmLeave(() => void applyState(state));
  const applyState = async (state: string) => {
    if (!selected || !token || lock.current) return;
    if (!canEditFollowUp) { setActionError('Tu cuenta no tiene permiso para realizar esta acción.'); return; }
    lock.current = true; setBusy(true); setActionError('');
    try {
      const path='seguimiento/messages/'+selected.id;
      const {item}=await panelRequest<{item:{estado:string;revision:number;responsable:string;notas:string;respuesta:string}}>(path,token);
      // El PUT reemplaza los cuatro campos con los valores que el servidor tiene AHORA (responsable, notas y respuesta no se tocan) y solo se acepta con su
      // revisión. Antes se comprueba que el estado siga siendo el que la persona veía: si otro administrador lo cambió, no se sobrescribe a ciegas.
      const current = item.estado;
      if (current !== selected.estado) {
        detail.patch({ estado: current }); setEditorEpoch(value => value + 1); setRevision(value => value + 1);
        setActionError('Otro administrador cambió el estado de esta consulta a «' + label(current) + '». No se aplicó tu cambio; revisa el seguimiento y vuelve a elegir.');
        return;
      }
      await panelRequest(path,token,'PUT',{estado:state,revision:item.revision,responsable:item.responsable,notas:item.notas,respuesta:item.respuesta});
      detail.patch({ estado: state }); // el detalle abierto refleja el estado nuevo aunque ya no cumpla el filtro del listado
      notify.success('Consulta de ' + selected.nombre + ': ' + label(state) + '.'); setRevision(value => value + 1); setEditorEpoch(value => value + 1);
    } catch (err) {
      if (err instanceof PanelApiError && err.status === 409) { // el seguimiento cambió entre la lectura y el guardado: no se reintenta solo
        setActionError('Otro administrador actualizó este seguimiento mientras cambiabas el estado. No se aplicó el cambio; revisa el seguimiento y vuelve a intentarlo.');
        setEditorEpoch(value => value + 1); setRevision(value => value + 1);
      } else setActionError(errorMessage(err));
    }
    finally { lock.current = false; setBusy(false); }
  };
  const metrics = [['nuevo', 'Por atender'], ['en_proceso', 'En proceso'], ['atendido', 'Atendidos'], ['archivado', 'Archivados']];
  const email = selected && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(selected.email)) ? String(selected.email) : '';
  const phone = selected ? String(selected.telefono || '').replace(/[^+\d]/g, '') : '';
  return <>
    <div className="hp-heading"><div><p className="hp-kicker">ATENCIÓN AL CLIENTE</p><h1>Centro de consultas</h1><p>Lee, clasifica y continúa la atención de cada persona.</p></div><div className="hp-actions">
      {canCreate && <button className="hp-btn" onClick={() => setCreatingLocal(true)} disabled={busy}><PanelIcon name="plus" />Registro manual</button>}
      <button className="hp-btn" onClick={() => confirmLeave(() => setRevision(value => value + 1))} disabled={loading || busy}><PanelIcon name="refresh" />Actualizar</button></div></div>
    <div className="hw-insights hw-insights-4">{metrics.map(([state, title]) => <button key={state} onClick={() => updateParams('estado', state)} aria-pressed={status === state} disabled={savePending}><span className={'hp-badge hp-state-' + state}>{title}</span><strong>{loading ? '…' : error ? '—' : counts[state]||0}</strong><span>Ver consultas <PanelIcon name="arrow" size={14} /></span></button>)}</div>
    {createDenied && <PanelReadOnlyNotice>Tu cuenta no puede registrar consultas manualmente. Se muestra la bandeja.</PanelReadOnlyNotice>}
    {!mobile && <p className="hp-sr" role="status">{selected ? 'Consulta #' + selected.id + ' abierta: ' + String(selected.asunto) : ''}</p>}
    {(error || actionError) && <p className="hp-error" role="alert">{error || actionError}</p>}
    {savePending && <p className="hw-caption" role="status">Guardando el seguimiento: no se puede cambiar de consulta, de estado del filtro ni de vista hasta recibir la respuesta.</p>}
    <section className="hp-card">
      <div className="hp-card-heading"><div><h2>Bandeja de atención</h2><p role="status">{loading ? 'Cargando…' : error ? 'Datos no disponibles' : total + ' consultas coinciden con tus filtros'}</p></div><div className="hp-actions">
        <div className="hw-tabs" role="group" aria-label="Vista del listado"><button aria-pressed={view === 'bandeja'} disabled={savePending} onClick={() => setView('bandeja')}>Bandeja</button><button aria-pressed={view === 'tabla'} disabled={savePending} onClick={() => setView('tabla')}>Tabla</button></div>
        {exporting && <button className="hp-btn" onClick={() => exportController.current?.abort()}>Cancelar exportación</button>}
        <button className="hp-btn" onClick={() => void exportResults()} disabled={exporting || loading || !!error || !total}><PanelIcon name="download" />{exporting ? 'Exportando…' : 'Exportar resultados'}</button>
        </div></div>
      {exportNote && <p className="hp-notice" role="status">{exportNote}</p>}{exportError && <p className="hp-error" role="alert">{exportError}</p>}
      <div className="hp-toolbar"><div className="hp-search"><PanelIcon name="search" /><input aria-label="Buscar consultas" placeholder="Nombre, correo, asunto o mensaje…" value={search} onChange={e => { const value = e.target.value; confirmLeave(() => { setPage(1); setSearch(value); }); }} /></div>
        <select aria-label="Estado de atención" disabled={savePending} value={status} onChange={e => updateParams('estado', e.target.value)}><option value="">Todos los estados</option>{metrics.map(([state, title]) => <option value={state} key={state}>{title}</option>)}</select>
        <select aria-label="Origen de consulta" value={channel} onChange={e => { const value = e.target.value; confirmLeave(() => { setPage(1); setChannel(value); }); }}><option value="">Todos los orígenes</option><option value="chatbot">Chatbot</option><option value="other">Web / manual</option></select></div>
      {/* El listado y el detalle son independientes: cargar, fallar o vaciarse el listado NO desmonta el detalle abierto ni lo que se esté escribiendo. */}
      <div className={'hw-inbox' + (view === 'tabla' ? ' is-table' : '') + (selectedId > 0 ? ' has-detail' : '')} aria-busy={loading}>
        <div className="hw-inbox-list" aria-label="Consultas recibidas">{error ? <div className="hp-empty hp-empty-compact"><p>No se pudo consultar la bandeja.</p><button className="hp-btn" onClick={() => setRevision(value => value + 1)}>Reintentar</button></div> : loading && !rows.length ? <div className="hp-empty hp-empty-compact" role="status">Cargando consultas…</div> : rows.length && view === 'tabla' ? <div className="hp-table-wrap"><table className="hp-table hw-inbox-table"><caption className="hp-sr">Consultas recibidas: asunto, estado, origen y fecha. Usa el botón de cada fila para abrir la consulta.</caption><caption className="hp-sr">Consultas recibidas</caption>
          <thead><tr><th scope="col">Consulta</th><th scope="col">Estado</th><th scope="col" className="hw-col-wide">Origen</th><th scope="col">Fecha</th><th scope="col"><span className="hp-sr">Acción</span></th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className={selectedId === row.id ? 'is-selected' : ''}><td role="rowheader"><strong>{String(row.asunto)}</strong><small>{String(row.nombre)}</small></td>
            <td><span className={'hp-badge hp-state-' + row.estado}>{label(row.estado)}</span></td><td className="hw-col-wide">{fromChat(row) ? 'Chatbot' : 'Web / manual'}</td><td>{dateLabel(row.createdAt)}</td>
            <td><button className="hp-btn" data-row-id={row.id} onClick={() => openRow(row.id)} disabled={busy || savePending} aria-pressed={selectedId === row.id} aria-label={(selectedId === row.id ? 'Consulta abierta: ' : 'Abrir consulta: ') + String(row.asunto) + ', ' + String(row.nombre)}>{selectedId === row.id ? 'Abierta' : 'Abrir'}</button></td></tr>)}</tbody></table></div>
        : rows.length ? rows.map(row => <button key={row.id} className={selectedId === row.id ? 'is-selected' : ''} data-row-id={row.id} onClick={() => openRow(row.id)} disabled={busy || savePending} aria-pressed={selectedId === row.id}>
          <span className="hw-inbox-meta"><strong>{String(row.nombre)}</strong><small>{dateLabel(row.createdAt)}</small></span>
          <span className="hw-inbox-subject">{String(row.asunto)}</span><span className="hw-inbox-preview">{String(row.mensaje)}</span>
          <span className="hw-inbox-meta"><span className={'hp-badge hp-state-' + row.estado}>{label(row.estado)}</span><small>{fromChat(row) ? 'Chatbot' : 'Web / manual'}</small></span>
        </button>) : <div className="hp-empty hp-empty-compact"><PanelIcon name="mail" size={28} /><p>No hay consultas con estos filtros.</p></div>}</div>
        <div className="hw-inbox-detail" aria-busy={savePending}>{selectedId > 0 && <button type="button" className="hp-btn hw-back" disabled={savePending} onClick={closeDetail}><span aria-hidden="true">←</span> Volver a la lista</button>}{selected ? <>
          {outOfList && <p className="hw-caption" data-testid="outside-list">Esta consulta no aparece en la página, la búsqueda o el filtro actuales. Sigue abierta para que no pierdas lo que estás haciendo.</p>}
          <div className="hw-detail-heading"><span className={'hp-badge hp-state-' + selected.estado}>{label(selected.estado)}</span><small>Consulta #{selected.id}</small><h2 ref={detailHeading} tabIndex={-1}>{String(selected.asunto)}</h2><p>{String(selected.nombre)} · {dateLabel(selected.createdAt)}</p></div>
          <dl className="hw-contact-data"><div><dt>Correo</dt><dd>{String(selected.email)}</dd></div><div><dt>Teléfono</dt><dd>{String(selected.telefono || 'No indicado')}</dd></div></dl>
          <div className="hw-message-text">{String(selected.mensaje)}</div>
          <div className="hp-actions">{email && <a className="hp-btn" href={'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent('Re: ' + selected.asunto)}><PanelIcon name="mail" />Abrir correo</a>}{phone.length >= 6 && <a className="hp-btn" href={'tel:' + phone}>Llamar</a>}</div>
          {canQuote && <Link className="hp-btn" to={'/admin/dashboard?section=cotizaciones&contacto='+selected.id} state={{ from: location.pathname + location.search }} aria-disabled={savePending || undefined} onClick={event => { if (savePending) event.preventDefault(); }}>Preparar cotización</Link>}<p className="hw-caption">El correo se abre en tu aplicación. El estado de la consulta se actualiza por separado.</p>
          {canReadFollowUp && <AttentionEditor key={selected.id} syncKey={editorEpoch} resource="messages" id={selected.id} canEdit={canEditFollowUp} canSend={canSendFollowUp} onPendingChange={setSavePending} onUncertainChange={setSaveUncertain} onSaved={(item)=>{detail.patch({ estado: item.estado });notify.success('Seguimiento guardado.');setRevision(v=>v+1)}} />}{canEditFollowUp && <div className="hw-next-action"><strong>Siguiente paso</strong><p>Actualiza el estado según la atención realizada.</p><div className="hp-actions">
            {metrics.filter(([state]) => state !== selected.estado).map(([state]) => <button className={'hp-btn' + (state === 'atendido' ? ' hp-btn-primary' : '')} key={state} disabled={busy || savePending || saveUncertain} onClick={() => void changeState(state)}>{busy ? 'Guardando…' : selected.estado === 'archivado' ? 'Reabrir: ' + label(state) : state === 'archivado' ? 'Archivar consulta' : state === 'nuevo' ? 'Volver a pendiente' : state === 'en_proceso' ? 'Iniciar atención' : 'Marcar atendido'}</button>)}
          </div></div>}
          {canDelete && <div className="hw-record-actions"><strong>Acciones del registro</strong><p>Archivar mantiene la consulta y su historial. Eliminar es definitivo y el sistema puede impedirlo.</p>
            <button className="hp-btn hp-btn-quiet" disabled={busy || savePending || saveUncertain} onClick={() => setDeleting(true)}><PanelIcon name="trash" size={15} />Eliminar consulta…</button></div>}
        </> : detail.status === 'loading' ? <div className="hp-empty" role="status"><p>Cargando consulta…</p></div>
          : detail.status === 'missing' ? <div className="hp-empty" role="alert"><PanelIcon name="mail" size={38} /><h3>Esta consulta ya no está disponible</h3><p>Puede haberse eliminado. Elige otra consulta de la lista.</p><button className="hp-btn" onClick={() => updateParams('id', '')}>Cerrar detalle</button></div>
          : detail.status === 'error' ? <div className="hp-empty" role="alert"><PanelIcon name="mail" size={38} /><h3>No pudimos cargar esta consulta</h3><p>Comprueba tu conexión e inténtalo de nuevo. La consulta no se ha eliminado.</p><div className="hp-actions"><button className="hp-btn hp-btn-primary" onClick={detail.retry}>Reintentar</button><button className="hp-btn" onClick={() => updateParams('id', '')}>Cerrar detalle</button></div></div>
          : <div className="hp-empty"><PanelIcon name="mail" size={38} /><h3>Una consulta, toda la información</h3><p>Selecciona una persona para leer su mensaje y continuar la atención.</p></div>}</div>
      </div>
    <footer className="hp-pagination"><button className="hp-btn" disabled={loading||page===1} onClick={()=>confirmLeave(()=>setPage(v=>v-1))}>Anterior</button><span>Página {page}</span><button className="hp-btn" disabled={loading||!!error||page>=pages} onClick={()=>confirmLeave(()=>setPage(v=>v+1))}>Siguiente</button></footer></section>
    {deleting && selected && canDelete && <MessageDeleteDialog message={selected} onClose={() => setDeleting(false)} onDeleted={deleted} onArchive={canEditFollowUp ? () => { setDeleting(false); changeState('archivado'); } : undefined} />}
    {creating && <MessageCreateDialog onClose={closeCreate} onCreated={created} onUncertain={() => setRevision(value => value + 1)} />}
  </>;
}
