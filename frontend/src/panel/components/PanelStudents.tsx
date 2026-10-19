import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import { notify } from '../services/notify';
import type { Student, StudentList } from '../services/students';
import PanelDialog from './PanelDialog';
import PanelIcon from './PanelIcon';
import StudentEditor from './StudentEditor';

export default function PanelStudents() {
  const { token } = useAdminAuth();
  const { can } = usePanelAccess();
  const [query, setQuery] = useState({ search: '', estado: 'activos', page: 1, limit: 20 });
  const [search, setSearch] = useState(''), [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ key: string; result: StudentList } | null>(null);
  const requestKey = JSON.stringify([token, query, refresh]);
  const { loading, error, setError, setLoading } = useRequestStatus(requestKey);
  const [editor, setEditor] = useState<{ original: Student | null } | null>(null);
  const [detail, setDetail] = useState<Student | null>(null), [archive, setArchive] = useState<Student | null>(null);
  const [operationError, setOperationError] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const request = useRef<AbortController | null>(null), sequence = useRef(0), locked = useRef(false);
  const reload = () => setRefresh(value => value + 1);
  const listing = data?.key === requestKey ? data.result : null;

  useEffect(() => {
    const controller = new AbortController(); let live = true;
    const timer = window.setTimeout(() => controller.abort(), 15000);
    const params = new URLSearchParams({ ...query, page: String(query.page), limit: String(query.limit) });
    panelRequest<StudentList>('estudiantes?' + params, token, 'GET', undefined, controller.signal)
      .then(result => {
        if (!Array.isArray(result.items) || !result.pagination) throw new Error('No se pudo interpretar la lista de estudiantes.');
        if (live) setData({ key: requestKey, result });
      })
      .catch(err => { if (live) setError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); })
      .finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, query, requestKey, setError, setLoading]);
  useEffect(() => () => { sequence.current++; request.current?.abort(); }, []);

  const open = async (id: number, mode: 'detail' | 'edit' | 'archive') => {
    if (locked.current || (mode === 'edit' && !can(PANEL_ACTIONS.editarEstudiante)) || (mode === 'archive' && !can(PANEL_ACTIONS.archivarEstudiante))) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const current = ++sequence.current; setOperationError(''); setBusy(true); setUncertain(false);
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result = await panelRequest<{ item: Student }>('estudiantes/' + id, token, 'GET', undefined, controller.signal);
      if (current !== sequence.current) return;
      if (mode === 'detail') setDetail(result.item);
      else if (mode === 'edit') setEditor({ original: result.item });
      else setArchive(result.item);
    } catch (err) { if (current === sequence.current) setOperationError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); }
    finally { window.clearTimeout(timer); if (current === sequence.current) setBusy(false); }
  };
  const archiveStudent = async () => {
    if (!archive || locked.current || uncertain || !can(PANEL_ACTIONS.archivarEstudiante)) return;
    locked.current = true; setBusy(true); setOperationError('');
    const controller = new AbortController(); request.current = controller;
    const current = ++sequence.current;
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      await panelRequest('estudiantes/' + archive.id + '/archivo', token, 'PUT', { revision: archive.revision, archivado: !archive.archivado_at }, controller.signal);
      if (current !== sequence.current) return;
      notify.success(archive.archivado_at ? 'Estudiante restaurado.' : 'Estudiante archivado.'); setArchive(null); reload();
    } catch (err) {
      if (current !== sequence.current) return;
      setUncertain(true); setOperationError(controller.signal.aborted || err instanceof TypeError ? 'No se pudo confirmar el resultado. Actualiza la lista antes de repetir la operación.' : errorMessage(err));
    } finally { window.clearTimeout(timer); locked.current = false; if (current === sequence.current) setBusy(false); }
  };
  const closeArchive = () => { if (busy) return; setArchive(null); setOperationError(''); if (uncertain) reload(); };
  const filtered = !!query.search || query.estado !== 'activos';
  return <div className="hs-students">
    <div className="hp-heading"><div><p className="hp-kicker">GESTIÓN ACADÉMICA</p><h1>Estudiantes</h1><p>Información de estudiantes organizada y disponible para tu equipo.</p></div>
      <div className="hp-actions"><button className="hp-btn" onClick={reload} disabled={loading || busy}><PanelIcon name="refresh" />Actualizar</button>
        {can(PANEL_ACTIONS.crearEstudiante) && <button className="hp-btn hp-btn-primary" onClick={() => { setOperationError(''); setEditor({ original: null }); }} disabled={busy}><PanelIcon name="plus" />Registrar estudiante</button>}</div></div>
    <section className="hs-summary" aria-label="Resumen de estudiantes"><div className="hs-summary-icon"><PanelIcon name="user" size={26} /></div><div><span>Estudiantes en esta consulta</span><strong>{listing ? listing.pagination.total : loading ? '…' : '—'}</strong></div><p>Los registros archivados conservan su información y pueden restaurarse.</p></section>
    {operationError && !archive && <p className="hp-error" role="alert">{operationError}</p>}
    {busy && !archive && <p role="status">Consultando estudiante…</p>}
    <section className="hp-card" aria-label="Listado de estudiantes" aria-busy={loading}>
      <div className="hp-card-heading"><div><h2>Directorio de estudiantes</h2><p>Busca por nombre, apellidos o DNI.</p></div><span className="hp-badge">{query.estado === 'activos' ? 'Activos' : query.estado === 'archivados' ? 'Archivados' : 'Todos'}</span></div>
      <form role="search" className="hp-toolbar" onSubmit={event => { event.preventDefault(); setQuery(previous => ({ ...previous, search: search.trim(), page: 1 })); }}>
        <div className="hp-search"><PanelIcon name="search" /><input type="search" aria-label="Buscar estudiantes por nombre o DNI" placeholder="Nombre, apellidos o DNI…" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></div>
        <button className="hp-btn" type="submit">Buscar</button>
        <select aria-label="Estado de estudiantes" value={query.estado} onChange={event => setQuery(previous => ({ ...previous, estado: event.target.value, page: 1 }))}><option value="activos">Activos</option><option value="archivados">Archivados</option><option value="todos">Todos</option></select>
        <select aria-label="Estudiantes por página" value={query.limit} onChange={event => setQuery(previous => ({ ...previous, limit: Number(event.target.value), page: 1 }))}><option value={20}>20 por página</option><option value={50}>50 por página</option><option value={100}>100 por página</option></select>
      </form>
      {error ? <div className="hp-empty"><p className="hp-error" role="alert">{error}</p><button className="hp-btn" onClick={reload}>Reintentar</button></div>
        : loading ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando estudiantes…</p></div>
          : !listing?.items.length ? <div className="hp-empty"><span className="hp-empty-icon"><PanelIcon name="user" size={32} /></span><h3>{filtered ? 'No encontramos coincidencias' : 'Todavía no hay estudiantes'}</h3><p>{filtered ? 'Prueba con otra búsqueda o cambia el estado.' : 'Registra el primer estudiante para comenzar.'}</p>{query.page > 1 && <button className="hp-btn" onClick={() => setQuery(previous => ({ ...previous, page: 1 }))}>Ir a la primera página</button>}</div>
            : <div className="hp-table-wrap"><table className="hp-table hs-table"><caption className="hp-sr">Estudiantes y acciones disponibles</caption><thead><tr><th scope="col">Estudiante</th><th scope="col">DNI</th><th scope="col">Contacto</th><th scope="col">Estado</th><th scope="col" className="hp-align-right">Acciones</th></tr></thead>
              <tbody>{listing.items.map(student => <tr key={student.id}><th scope="row"><div className="hp-record"><span className="hs-initial">{student.nombres.charAt(0)}</span><div><strong>{student.apellidos}, {student.nombres}</strong><small>Registro #{student.id}</small></div></div></th><td>{student.doc_numero || 'Sin registrar'}</td><td><span className="hs-contact">{student.email || 'Sin correo'}<small>{student.telefono || 'Sin teléfono'}</small></span></td><td><span className={'hp-badge ' + (student.archivado_at ? '' : 'hp-state-activo')}>{student.archivado_at ? 'Archivado' : 'Activo'}</span></td><td><div className="hp-row-actions">
                <button className="hp-btn" disabled={busy} onClick={() => void open(student.id, 'detail')} aria-label={'Ver detalle de ' + student.nombres}><PanelIcon name="eye" size={16} />Detalle</button>
                {can(PANEL_ACTIONS.editarEstudiante) && <button className="hp-btn" disabled={busy} onClick={() => void open(student.id, 'edit')} aria-label={'Editar a ' + student.nombres}><PanelIcon name="edit" size={16} />Editar</button>}
                {can(PANEL_ACTIONS.archivarEstudiante) && <button className="hp-btn" disabled={busy} onClick={() => void open(student.id, 'archive')} aria-label={(student.archivado_at ? 'Restaurar a ' : 'Archivar a ') + student.nombres}>{student.archivado_at ? 'Restaurar' : 'Archivar'}</button>}</div></td></tr>)}</tbody></table></div>}
      {listing && <div className="hp-pagination"><span role="status">{listing.pagination.total} estudiantes · Página {query.page} de {Math.max(1, listing.pagination.pages)}</span><div><button className="hp-btn" disabled={loading || query.page <= 1} onClick={() => setQuery(previous => ({ ...previous, page: previous.page - 1 }))}>Anterior</button><button className="hp-btn" disabled={loading || query.page >= listing.pagination.pages} onClick={() => setQuery(previous => ({ ...previous, page: previous.page + 1 }))}>Siguiente</button></div></div>}
    </section>
    {editor && <StudentEditor original={editor.original} onClose={() => { setEditor(null); reload(); }} onSaved={() => { notify.success(editor.original ? 'Estudiante actualizado.' : 'Estudiante registrado.'); setEditor(null); reload(); }} />}
    {detail && <PanelDialog title="Detalle del estudiante" onClose={() => setDetail(null)} footer={<button className="hp-btn" onClick={() => setDetail(null)}>Cerrar</button>}><dl className="hp-details">{[
      ['Nombres y apellidos', detail.nombres + ' ' + detail.apellidos], ['DNI', detail.doc_numero || 'Sin registrar'], ['Correo electrónico', detail.email || 'Sin registrar'], ['Teléfono', detail.telefono || 'Sin registrar'], ['Estado', detail.archivado_at ? 'Archivado' : 'Activo'], ['Registrado', new Date(detail.createdAt).toLocaleString('es-PE')],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></PanelDialog>}
    {archive && <PanelDialog title={archive.archivado_at ? 'Restaurar estudiante' : 'Archivar estudiante'} busy={busy} onClose={closeArchive} footer={<><button className="hp-btn" onClick={closeArchive} disabled={busy} data-autofocus>{uncertain ? 'Cerrar y actualizar' : 'Cancelar'}</button>{!uncertain && <button className="hp-btn hp-btn-primary" onClick={() => void archiveStudent()} disabled={busy}>{busy ? 'Guardando…' : archive.archivado_at ? 'Confirmar restauración' : 'Confirmar archivo'}</button>}</>}><div className="hp-confirm"><h3>{archive.nombres} {archive.apellidos}</h3><p>{archive.archivado_at ? 'Volverá al directorio de estudiantes activos.' : 'Se retirará del directorio de activos. Su información e historial se conservarán y podrás restaurarlo.'}</p></div>{operationError && <p className="hp-error" role="alert">{operationError}</p>}</PanelDialog>}
  </div>;
}
