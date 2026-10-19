import { useRequestStatus } from '../hooks/useRequestStatus';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { useSearchParams } from 'react-router-dom';
import ResourceCards from './workspace/ResourceCards';
import CourseAgenda from './workspace/CourseAgenda';
import ResourcePreview from './workspace/ResourcePreview';
import { panelRequest, errorMessage } from '../services/panelApi';
import { type Field, type PanelScope, type Resource, type Row, adviceKind, canRemove, fieldsFor, fixedFieldKeys, label, removeVerb, rowState, slugify, supportsRemove } from '../types/workspace';
import PanelIcon from './PanelIcon';
import ImageUpload from './ImageUpload';
import OriginalContentImport from './OriginalContentImport';
import PanelDialog from './PanelDialog';
import { buildCsv } from '../services/listRecords';
import { notify } from '../services/notify';
import { useUnsavedChanges } from './../unsaved/unsavedContext';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS, RESOURCE_WRITE } from '../context/panelAccess';
import { PanelReadOnlyNotice } from './PanelAccessNotice';

const NO_PERMISSION = 'Tu cuenta no tiene permiso para realizar esta acción.';

type ListResponse = { items?: Row[]; pagination?: { total: number; pages: number } };
// A scope limits the list to one section of the Education or Services menu and keeps new records inside it.
type Props = { resource: Resource; autoCreate?: boolean; scope?: PanelScope };
type Editor = { session: number; row?: Row; view?: boolean };
export default function ResourceManager({ resource: r, autoCreate: askedCreate, scope }: Props) {
  const singular = scope?.singular ?? r.singular;
  const { token } = useAdminAuth();
  const [params] = useSearchParams();
  // Operaciones que ofrece la sección según los permisos de la sesión (E3.4.3, fase 2). Sin editar, los registros se abren en modo consulta;
  // ?crear=1 sin permiso de crear no abre el formulario.
  const access = usePanelAccess();
  const ops = RESOURCE_WRITE[r.endpoint];
  const canCreate = !!ops && access.can(ops.crear), canEdit = !!ops && access.can(ops.editar), canDelete = supportsRemove(r) && !!ops && access.can(ops.eliminar);
  const canArchive = !ops?.archivar || access.can(ops.archivar);
  const canUpload = access.can(PANEL_ACTIONS.subirImagen);
  const canRestore = access.can(PANEL_ACTIONS.leerContenidoOriginal) && access.can(PANEL_ACTIONS.restaurarContenidoOriginal);
  const createDenied = !!askedCreate && !canCreate;
  const autoCreate = !!askedCreate && canCreate;
  const visual = ['cursos', 'servicios', 'galeria', 'preguntas-frecuentes'].includes(r.endpoint);
  const [view, setView] = useState(params.get('vista') === 'agenda' && r.endpoint === 'cursos' ? 'agenda' : params.get('vista') === 'tabla' ? 'table' : visual ? 'cards' : 'table');
  const [preview, setPreview] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(r.states.includes(params.get('estado') || '') ? params.get('estado')! : '');
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(autoCreate ? { session: 0 } : null);
  const editorSequence = useRef(0), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Cada apertura tiene identidad propia, incluso al volver a editar el mismo ID.
  const replaceEditor = (next: Omit<Editor, 'session'> | null) => {
    const session = ++editorSequence.current;
    setEditor(next ? { ...next, session } : null);
  };
  const defaults = (row?: Row) => Object.fromEntries(r.fields.map(field => {
    let value = row?.[field.key];
    if (field.key === 'activo') value = row ? row.activo ? 'activo' : 'inactivo' : 'activo';
    if (field.key === 'contenido_tipo') value = adviceKind(row);
    const fixed = scope?.filters[field.key];
    if (!row && fixed) value = fixed.split(',')[0];
    if (field.type === 'date' && value) value = String(value).slice(0, 10);
    return [field.key, String(value ?? field.options?.[0] ?? (field.type === 'number' ? '0' : ''))];
  }));
  const [form, setForm] = useState<Record<string, string>>(() => autoCreate ? defaults() : {});
  const [formError, setFormError] = useState('');
  // Foto del formulario al abrirlo: hay cambios sin guardar cuando el contenido editado difiere de ella.
  const [baseline, setBaseline] = useState(() => autoCreate ? JSON.stringify(defaults()) : '');
  const dirty = !!editor && !editor.view && JSON.stringify(form) !== baseline;
  const confirmLeave = useUnsavedChanges(dirty, 'edición de ' + singular);
  const closeEditor = () => {
    if (actionLock.current) return;
    const session = editorSequence.current;
    confirmLeave(() => { if (session === editorSequence.current) replaceEditor(null); });
  };
  // While creating, the slug follows the title until the administrator edits it by hand.
  const [slugEdited, setSlugEdited] = useState(false);
  // Only the fields that make sense for this section are part of the form (see fieldsFor); the rest keep their stored value.
  const { main, advanced, groups } = fieldsFor(r, scope, form);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const pageSize = 8;
  const { loading, error, setLoading, setError } = useRequestStatus(JSON.stringify([token, r.endpoint, page, query, status, reload]));

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (query.trim()) params.set('search', query.trim());
    if (status) params.set('estado', status);
    for (const [key, value] of Object.entries(scope?.filters ?? {})) params.set(key, value);
    panelRequest<ListResponse>(r.endpoint + '?' + params, token, 'GET', undefined, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        if (data.pagination) {
          setRows(data.items || []); setTotal(data.pagination?.total || 0); setPages(data.pagination?.pages || 0);
          if (page > 1 && page > (data.pagination?.pages || 0)) setPage(Math.max(1, data.pagination?.pages || 1));
        } else {
          const filtered = (data.items || []).filter(row =>
            (!status || rowState(row) === status) &&
            (!query || Object.values(row).join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
          const last = Math.ceil(filtered.length / pageSize);
          setTotal(filtered.length); setPages(last);
          if (page > 1 && page > last) setPage(Math.max(1, last));
          setRows(filtered.slice((page - 1) * pageSize, page * pageSize));
        }
      }).catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, r, page, query, status, reload, scope, setLoading, setError]);

  const openNew = () => { if (actionLock.current || !canCreate) return; const initial = defaults(); setSlugEdited(false); setForm(initial); setBaseline(JSON.stringify(initial)); setFormError(''); replaceEditor({}); };
  // Page (8 per page) where a record lands with the list order, so a new record is never left on a hidden page.
  const locate = async (id: number) => {
    try {
      const lookup = new URLSearchParams({ page: '1', limit: '100' });
      for (const [key, value] of Object.entries(scope?.filters ?? {})) lookup.set(key, value);
      const data = await panelRequest<ListResponse>(r.endpoint + '?' + lookup, token);
      const index = (data.items || []).findIndex(row => row.id === id);
      return index < 0 ? 1 : Math.floor(index / pageSize) + 1;
    } catch { return 1; }
  };
  const openRow = async (row: Row, asked = false) => {
    if (!token || actionLock.current) return;
    const view = asked || !canEdit; // sin permiso de editar, el registro se abre en modo consulta (también desde la agenda)
    actionLock.current = true; setBusy(true); setError('');
    try {
      // Gallery only exposes a public detail route, so admin uses its list data.
      const data = r.endpoint === 'galeria' ? { item: row } :
        await panelRequest<{ item?: Row }>(r.endpoint + '/' + row.id, token);
      if (!mounted.current) return;
      const current = data.item;
      if (!current) throw new Error('No se encontró el registro.');
      { const next = { ...defaults(current), estado: String(current.estado || 'nuevo') }; setForm(next); setBaseline(JSON.stringify(next)); }
      replaceEditor({ row: current, view }); setFormError('');
    } catch (err) { if (mounted.current) setError(errorMessage(err)); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };
  const duplicate = async (row: Row, copiedAt: number) => {
    if (!token || actionLock.current || !canCreate) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      const data = await panelRequest<{ item: Row }>(r.endpoint + '/' + row.id, token);
      const copied = defaults(data.item);
      copied[r.title] = String(data.item[r.title]).slice(0, r.endpoint === 'preguntas-frecuentes' ? 285 : 145) + ' (copia)';
      if ('slug' in copied) copied.slug = copied.slug.slice(0, 140).replace(/-+$/, '') + '-copia-' + copiedAt;
      copied.estado = 'borrador';
      setSlugEdited(true); setForm(copied); setBaseline(JSON.stringify(copied)); setFormError(''); setPreview(true); setEditor({ session: ++editorSequence.current });
    } catch (err) { setError(errorMessage(err)); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || actionLock.current) return;
    // Ninguna escritura sin el permiso de su operación, tampoco con Enter. Guardar con estado «archivado» exige además archivar
    // (el backend lo comprueba sobre el cuerpo, aunque el registro ya estuviera archivado).
    if (!(editor?.row ? canEdit : canCreate)) { setFormError(NO_PERMISSION); return; }
    actionLock.current = true; setBusy(true); setFormError('');
    try {
      const payload: Record<string, unknown> = {};
      let created: Row | undefined;
      const limpiar: string[] = [];
      const visible = [...main, ...advanced];
      // The slug follows the title; it only needs attention (in "Opciones avanzadas") when it cannot be used.
      let finalSlug = '';
      if (advanced.length) {
        finalSlug = (form.slug ?? '').trim() || (editor?.row ? '' : slugify(form.titulo || ''));
        if (finalSlug.length < 2 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(finalSlug)) {
          document.getElementById('field-slug')?.closest('details')?.setAttribute('open', '');
          document.getElementById('field-slug')?.scrollIntoView({ block: 'center' });
          throw new Error('Revisa el identificador (slug) en «Opciones avanzadas»: usa minúsculas, números y guiones.');
        }
      }
      for (const field of visible) {
        if (field.virtual) continue;
        const value = field.key === 'slug' ? finalSlug : (form[field.key] ?? '').trim();
        const required=field.required&&(!field.courseOnly||form.tipo!=='capacitacion');
        if (!value && !required && r.catalog) {
          if (editor?.row?.[field.key]) limpiar.push(field.key);
          continue;
        }
        if (!value && !required && !editor?.row?.[field.key]) continue;
        payload[field.key] = field.key === 'activo' ? value === 'activo' : field.type === 'number' ? Number(value) : value;
      }
      if (limpiar.length) payload.limpiar = limpiar;
      // Asesoramiento "Tipo" is stored in presentacion. It is only written for a new record or when the administrator changes it.
      if (r.endpoint === 'servicios' && visible.some(field => field.key === 'contenido_tipo')) {
        const kind = form.contenido_tipo === 'beneficio' ? 'beneficio' : 'linea';
        if (!editor?.row || kind !== adviceKind(editor.row)) payload.presentacion = kind === 'beneficio' ? 'beneficio' : 'asesoria';
      }
      // Category / course type fixed by the section: set on creation, never touched when editing.
      if (!editor?.row) for (const key of fixedFieldKeys(scope)) if (!(key in payload) && form[key]) payload[key] = form[key];
      if (payload.estado === 'archivado' && !canArchive) throw new Error('Tu cuenta no puede guardar registros archivados: cambia el estado antes de guardar.');
      const saved = await panelRequest<{ item?: Row }>(r.endpoint + (editor?.row ? '/' + editor.row.id : ''), token, editor?.row ? 'PUT' : 'POST', payload);
      if (!editor?.row && r.catalog) created = saved.item;
      replaceEditor(null);
      if (created) {
        // Clear filters and open the page that holds the new record.
        const landing = await locate(created.id);
        setSearch(''); setQuery(''); setStatus(''); setPage(landing);
        notify.success('Se creó «' + String(created[r.title]) + '» y ya aparece en la lista' + (landing > 1 ? ' (página ' + landing + ')' : '') + '.');
      } else notify.success('Cambios guardados correctamente.');
      setReload(n => n + 1);
    } catch (err) { setFormError(errorMessage(err)); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!token || !pendingDelete || actionLock.current) return;
    if (!canDelete || !canRemove(r, pendingDelete)) { setFormError(NO_PERMISSION); return; }
    actionLock.current = true; setBusy(true); setFormError('');
    try {
      await panelRequest(r.endpoint + '/' + pendingDelete.id, token, 'DELETE');
      setPendingDelete(null); notify.success(r.hardDelete ? (r.endpoint === 'servicios' ? 'Servicio eliminado definitivamente.' : 'Eliminado definitivamente: «' + String(pendingDelete[r.title]) + '».') : r.catalog ? 'Registro archivado. Puedes recuperarlo editando su estado.' : 'Registro eliminado.');
      setReload(n => n + 1);
    } catch (err) { setFormError(errorMessage(err)); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const exportPage = () => {
    const cols = ['id', ...r.fields.filter(field => !field.virtual).map(field => field.key)];
    const csv = buildCsv(cols, rows); // mismo formato que antes (BOM, comillas dobles y fórmulas neutralizadas); ahora probado en tests/list-records.test.mjs
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = r.endpoint + '-pagina-' + page + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify.success('Se generó el archivo CSV de la página ' + page + ' (' + rows.length + ' registros).');
  };
  const renderField = (field: Field) => {
      // New records stay in the section they are created from; editing may only move them within the same group.
      let allowed = !editor?.row ? scope?.filters[field.key]?.split(',') : scope?.choices?.[field.key];
      // Sin permiso de archivar no se ofrece «archivado» (salvo que el registro ya lo esté, para mostrar su valor).
      if (field.key === 'estado' && !canArchive && editor?.row?.estado !== 'archivado') allowed = (allowed ?? field.options ?? []).filter(option => option !== 'archivado');
      const common = { id: 'field-' + field.key, value: form[field.key] || '', required: field.required&&(!field.courseOnly||form.tipo!=='capacitacion'),
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
          const value = event.target.value;
          if (field.key === 'slug') setSlugEdited(true);
          setForm(prev => ({ ...prev, [field.key]: value, ...(field.key === 'titulo' && !editor?.row && !slugEdited && 'slug' in prev ? { slug: slugify(value) } : {}) }));
        } };
      return <label key={field.key} className={field.type === 'textarea' ? 'hp-full' : ''} htmlFor={common.id}>{field.label}{common.required && <span className="hp-required"> *</span>}
        {field.type === 'textarea' ? <textarea {...common} rows={field.key === 'descripcion' || field.key === 'etiquetas' ? 3 : field.key === 'alcance' && r.endpoint === 'servicios' && form.categoria !== 'asesoramiento' && !form.alcance?.trim() ? 2 : 4} minLength={field.min} maxLength={field.max} /> :
          field.type === 'select' ? <select {...common}>{(allowed ? field.options?.filter(o => allowed.includes(o)) : field.options)?.map(o => <option key={o} value={o}>{o === '' && field.key === 'icono' ? 'Sin icono' : label(o)}</option>)}</select> :
          <input {...common} type={field.key==='imagen_url'?'text':field.type || 'text'} minLength={field.type === 'number' ? undefined : field.min} maxLength={field.type === 'number' ? undefined : field.max} min={field.type === 'number' ? field.min : undefined} max={field.type === 'number' ? field.max : undefined}
            />}
        {field.key === 'imagen_url' && canUpload && <ImageUpload onUploaded={url => setForm(prev => ({ ...prev, imagen_url: url }))} />}
        {field.hint && <small className="hp-field-hint">{field.hint}</small>}
        {field.key === 'slug' && <small>Minúsculas y guiones. <button type="button" className="hp-text-btn" onClick={() => setForm(prev => ({ ...prev, slug: slugify(prev.titulo || '') }))}>Generar desde el título</button></small>}
      </label>;
  };
  return <>
    <div className="hp-heading"><div><p className="hp-kicker">{scope?.kicker ?? 'ESPACIO DE TRABAJO'}</p><h1>{scope?.label ?? r.label}</h1><p>{scope?.description ?? r.description}</p></div>
      {canCreate && <button className="hp-btn hp-btn-primary" onClick={openNew} disabled={busy}><PanelIcon name="plus" />Crear {singular}</button>}</div>
    {createDenied ? <PanelReadOnlyNotice>Tu cuenta no puede crear registros en esta sección. Se muestra en modo consulta.</PanelReadOnlyNotice>
      : !canCreate && !canEdit && !canDelete && <PanelReadOnlyNotice>Modo consulta: tu cuenta puede ver esta sección, pero no modificarla.</PanelReadOnlyNotice>}
    {canRestore&&['servicios','cursos','galeria'].includes(r.endpoint)&&scope?.filters.tipo!=='curso'&&<div className="hp-actions"><OriginalContentImport section={r.endpoint==='cursos'?'capacitaciones':r.endpoint} onRestored={message=>{notify.success(message);setReload(n=>n+1)}}/></div>}
    <section className="hp-card">
      <div className="hp-card-heading"><div><h2>{r.endpoint === 'galeria' ? 'Biblioteca visual' : r.endpoint === 'cursos' ? 'Oferta y planificación' : r.endpoint === 'servicios' ? 'Portafolio de soluciones' : r.endpoint === 'preguntas-frecuentes' ? 'Centro de respuestas' : 'Todos los registros'} <span className="hp-count">{loading ? '…' : error ? '—' : total}</span></h2><p>{visual ? 'Revisa, prepara y organiza el contenido de esta sección.' : 'Consulta y administra tu información.'}</p></div>
        <div className="hp-actions"><button className="hp-btn" onClick={exportPage} disabled={view === 'agenda' || loading || !!error || !rows.length}><PanelIcon name="download" />Exportar página</button>
          <button className="hp-icon-btn" aria-label="Actualizar registros" onClick={() => setReload(n => n + 1)} disabled={loading}><PanelIcon name="refresh" /></button></div></div>
      {visual && <div className="hw-viewbar"><div className="hw-tabs" aria-label="Vista de contenido">
        <button aria-pressed={view === 'cards'} onClick={() => setView('cards')}>{r.endpoint === 'preguntas-frecuentes' ? 'Por categoría' : 'Vista visual'}</button>
        <button aria-pressed={view === 'table'} onClick={() => setView('table')}>Tabla</button>
        {r.endpoint === 'cursos' && <button aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}>Agenda de cursos</button>}
      </div><span className="hw-caption">{view === 'agenda' ? 'Planifica fechas del catálogo completo' : 'Resultados paginados · 8 por página'}</span></div>}
      {view === 'agenda' ? <CourseAgenda revision={reload} tipo={scope?.filters.tipo} readOnly={!canEdit} onOpen={row => void openRow(row)} /> : <>
      <form className="hp-toolbar" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}>
        <div className="hp-search"><PanelIcon name="search" /><input aria-label="Buscar registros" placeholder="Buscar por nombre o título…" value={search} onChange={e => setSearch(e.target.value)} maxLength={100} /></div>
        <button className="hp-btn" type="submit">Buscar</button>
        <select aria-label="Filtrar por estado" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todos los estados</option>{r.states.map(s => <option key={s} value={s}>{label(s)}</option>)}</select>
      </form>
      {error ? <div className="hp-empty" role="alert"><PanelIcon name="help" size={32} /><h3>No pudimos cargar los registros</h3><p>{error}</p><button className="hp-btn" onClick={() => setReload(n => n + 1)}>Reintentar</button></div> :
        loading ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando registros…</p></div> :
        rows.length ? (view === 'cards' ? <ResourceCards resource={r} rows={rows} busy={busy} allow={{ edit: canEdit, duplicate: canCreate, remove: canDelete }} onOpen={(row, view) => void openRow(row, view)} onDuplicate={(row, copiedAt) => void duplicate(row, copiedAt)} onRemove={row => { setFormError(''); setPendingDelete(row); }} /> : <div className="hp-table-wrap"><table className="hp-table"><thead><tr><th>Contenido</th><th>Categoría / tipo</th><th>Estado</th><th>Actualización</th><th className="hp-align-right">Acciones</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><td><div className="hp-record"><span className={'hp-record-icon hp-tone-' + r.icon}><PanelIcon name={r.icon} /></span><div><strong>{String(row[r.title])}</strong><small>{String(row.nombre || row.slug || 'Registro #' + row.id)}</small></div></div></td>
            <td>{label(row.categoria || row.tipo || 'General')}</td>
            <td><span className={'hp-badge hp-state-' + rowState(row)}>{label(rowState(row))}</span></td>
            <td>{row.updatedAt || row.createdAt ? new Date(String(row.updatedAt || row.createdAt)).toLocaleDateString('es-PE') : '—'}</td>
            <td><div className="hp-row-actions"><button className="hp-icon-btn" aria-label={'Ver ' + row[r.title]} title="Ver detalle" disabled={busy} onClick={() => void openRow(row, true)}><PanelIcon name="eye" size={17} /></button>
              {canEdit && <button className="hp-icon-btn" aria-label={'Editar ' + row[r.title]} title="Editar" disabled={busy} onClick={() => void openRow(row)}><PanelIcon name="edit" size={17} /></button>}
              {canDelete && <button className="hp-icon-btn hp-danger" aria-label={removeVerb(r) + ' ' + row[r.title]} title={removeVerb(r)} disabled={busy || !canRemove(r, row)} onClick={() => { setFormError(''); setPendingDelete(row); }}><PanelIcon name="trash" size={17} /></button>}</div></td></tr>)}</tbody></table></div>) :
          <div className="hp-empty"><span className="hp-empty-icon"><PanelIcon name={r.icon} size={30} /></span><h3>{query || status ? 'No encontramos coincidencias' : canCreate ? 'Tu próximo proyecto empieza aquí' : 'Todavía no hay registros'}</h3><p>{query || status ? 'Prueba con otra búsqueda o cambia el filtro.' : canCreate ? 'Crea tu primer registro. Su información quedará guardada en el sistema.' : 'Cuando se publiquen registros en esta sección, aparecerán aquí.'}</p>{canCreate && <button className="hp-btn hp-btn-primary" onClick={openNew}>Crear {singular}<PanelIcon name="plus" /></button>}</div>}
      <footer className="hp-pagination"><span>{error ? 'Sin conexión con los datos' : total + ' registros encontrados'} · {pageSize} por página</span><div><button className="hp-btn" disabled={loading || !!error || page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button><span>{page} / {Math.max(1, pages)}</span><button className="hp-btn" disabled={loading || !!error || page >= pages} onClick={() => setPage(p => p + 1)}>Siguiente</button></div></footer></>}
    </section>
    {editor && <PanelDialog title={(editor.view ? 'Detalle de ' : editor.row ? 'Editar ' : 'Crear ') + singular} busy={busy} onClose={closeEditor} className={groups ? 'hp-dialog-sticky' : ''}>
      {editor.view ? <>{visual && <ResourcePreview resource={r} values={editor.row!} />}<dl className="hp-details">{[...main, ...advanced].map(field => <div key={field.key}><dt>{field.label}</dt><dd>{label(editor.row?.[field.key]) || 'Sin especificar'}</dd></div>)}</dl>{canEdit && <div className="hp-dialog-footer"><button className="hp-btn hp-btn-primary" onClick={() => replaceEditor({ ...editor, view: false })}>Editar registro<PanelIcon name="edit" /></button></div>}</> :
      <form onSubmit={save}>
        {visual && <div className="hw-editor-tools"><strong>{editor.row ? 'Edición de contenido' : 'Prepara una nueva publicación'}</strong><button type="button" className="hp-btn" onClick={() => setPreview(value => !value)} aria-expanded={preview}><PanelIcon name="eye" size={16} />{preview ? 'Ocultar vista previa' : 'Vista previa'}</button></div>}
        {visual && preview && <ResourcePreview resource={r} values={form} />}
        <fieldset className={'hp-form-grid' + (groups ? ' hp-form-sections' : '')} disabled={busy}><legend className="hp-sr">Datos del registro</legend>
        {groups ? groups.map(group => <section className="hp-form-section" key={group.key} aria-labelledby={'hp-section-' + group.key}>
          <h3 id={'hp-section-' + group.key}>{group.title}</h3>
          {group.rows.map((row, index) => <div className={'hp-form-row' + (row.length > 1 ? ' is-pair' : '')} key={index}>{row.map(renderField)}</div>)}
        </section>) : main.map(renderField)}
        {advanced.length > 0 && <details className="hp-advanced hp-full"><summary>Opciones avanzadas</summary><div className="hp-form-row hp-advanced-body">{advanced.map(renderField)}</div></details>}
      </fieldset>
        <div className="hp-dialog-footer">{formError && <p className="hp-error hp-footer-error" role="alert">{formError}</p>}<button type="button" className="hp-btn" disabled={busy} onClick={closeEditor}>Cancelar</button><button className="hp-btn hp-btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}<PanelIcon name="check" /></button></div></form>}
    </PanelDialog>}
    {canDelete && pendingDelete && canRemove(r, pendingDelete) && <PanelDialog title={r.hardDelete ? 'Eliminar ' + singular : r.catalog ? 'Archivar registro' : 'Eliminar registro'} busy={busy} onClose={() => setPendingDelete(null)}>
      <div className="hp-confirm"><PanelIcon name="trash" size={34} /><h3>{String(pendingDelete[r.title])}</h3><p>{r.catalog && !r.hardDelete ? 'Dejará de aparecer en las consultas públicas. Podrás publicarlo nuevamente desde Editar.' : 'Se eliminará definitivamente de la base de datos y dejará de aparecer en el sitio. Esta acción no se puede deshacer.'}</p></div>
      {formError && <p className="hp-error" role="alert">{formError}</p>}<div className="hp-dialog-footer"><button className="hp-btn" disabled={busy} onClick={() => setPendingDelete(null)}>Cancelar</button><button className="hp-btn hp-btn-danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Procesando…' : r.catalog && !r.hardDelete ? 'Confirmar archivo' : 'Eliminar definitivamente'}</button></div>
    </PanelDialog>}
  </>;
}
