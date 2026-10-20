import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import { notify } from '../services/notify';
import { ENROLLMENT_ACTIONS, ENROLLMENT_STATES, enrollmentActions, seatLabel, studentLabel, type Enrollment, type EnrollmentAction, type EnrollmentList, type EnrollmentStudent, type SeatEdition } from '../services/enrollments';
import PanelIcon from './PanelIcon';
import AcademicSelect from './AcademicSelect';
import EditionCourseSelect from './EditionCourseSelect';
import EnrollmentEditor from './EnrollmentEditor';
import EnrollmentOperation from './EnrollmentOperation';
import EnrollmentDetail from './EnrollmentDetail';

export default function PanelEnrollments() {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [query, setQuery] = useState({ search: '', estado: '', estudiante_id: '', convocatoria_id: '', curso_id: '', page: 1, limit: 20 });
  const [search, setSearch] = useState(''), [refresh, setRefresh] = useState(0);
  const [student, setStudent] = useState<EnrollmentStudent | null>(null), [edition, setEdition] = useState<SeatEdition | null>(null);
  const [editor, setEditor] = useState(false), [detail, setDetail] = useState<Enrollment | null>(null), [operation, setOperation] = useState<{ item: Enrollment; action: EnrollmentAction } | null>(null);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  const key = JSON.stringify([token, query, refresh]); const { loading, error, setLoading, setError } = useRequestStatus(key);
  const [data, setData] = useState<{ key: string; result: EnrollmentList } | null>(null); const result = data?.key === key ? data.result : null;
  const request = useRef<AbortController | null>(null), sequence = useRef(0), locked = useRef(false);
  const reload = () => setRefresh(v => v + 1);
  useEffect(() => {
    let live = true; const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 15000);
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit), search: query.search });
    for (const field of ['estado', 'estudiante_id', 'convocatoria_id', 'curso_id'] as const) if (query[field]) params.set(field, query[field]);
    panelRequest<EnrollmentList>('matriculas?' + params, token, 'GET', undefined, controller.signal)
      .then(r => { if (!Array.isArray(r.items) || !r.pagination) throw new Error('No se pudo interpretar la lista de matrículas.'); if (live) setData({ key, result: r }); })
      .catch(e => { if (live) setError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(e)); }).finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, query, key, setError, setLoading]);
  useEffect(() => () => { sequence.current++; request.current?.abort(); }, []);
  const open = async (id: number, action?: EnrollmentAction) => {
    if (locked.current) return; locked.current = true;
    const controller = new AbortController(); request.current = controller; const current = ++sequence.current; const timer = window.setTimeout(() => controller.abort(), 15000); setBusy(true); setActionError('');
    try {
      const r = await panelRequest<{ item: Enrollment }>('matriculas/' + id, token, 'GET', undefined, controller.signal);
      if (!r.item?.id) throw new Error('No se pudo interpretar el detalle de matrícula.');
      if (current !== sequence.current) return;
      if (!action) setDetail(r.item);
      else if (enrollmentActions(r.item, can).includes(action)) setOperation({ item: r.item, action });
      else { setActionError('La matrícula cambió y ya no permite esa acción. Actualiza la lista.'); reload(); }
    } catch (e) { if (current === sequence.current) setActionError(errorMessage(e)); }
    finally { window.clearTimeout(timer); locked.current = false; if (current === sequence.current) setBusy(false); }
  };
  return <div className="hs-students he-editions hm-enrollments">
    <div className="hp-heading"><div><p className="hp-kicker">GESTIÓN ACADÉMICA</p><h1>Matrículas</h1><p>Gestiona las inscripciones y consulta su historial académico.</p></div><div className="hp-actions"><button className="hp-btn" disabled={loading || busy} onClick={reload}><PanelIcon name="refresh" />Actualizar</button>{can('matriculas:crear') && <button className="hp-btn hp-btn-primary" disabled={busy} onClick={() => setEditor(true)}><PanelIcon name="plus" />Registrar matrícula</button>}</div></div>
    <section className="hs-summary" aria-label="Resumen de matrículas"><div className="hs-summary-icon"><PanelIcon name="calendar" size={26} /></div><div><span>Matrículas en esta consulta</span><strong>{result ? result.pagination.total : loading ? '…' : '—'}</strong></div><p>Las matrículas activas ocupan cupo. Las anuladas conservan su historial.</p></section>
    {actionError && <p className="hp-error" role="alert">{actionError}</p>}{busy && <p role="status">Consultando matrícula…</p>}
    <section className="hp-card" aria-label="Listado de matrículas" aria-busy={loading}><div className="hp-card-heading"><div><h2>Inscripciones académicas</h2><p>Busca por estudiante, DNI, curso o edición.</p></div></div>
      <form role="search" className="hp-toolbar" onSubmit={e => { e.preventDefault(); setQuery(q => ({ ...q, search: search.trim(), page: 1 })); }}><div className="hp-search"><PanelIcon name="search" /><input type="search" aria-label="Buscar matrículas" placeholder="Estudiante, DNI, curso o edición…" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></div><button className="hp-btn">Buscar</button><select aria-label="Estado de matrículas" value={query.estado} onChange={e => setQuery(q => ({ ...q, estado: e.target.value, page: 1 }))}><option value="">Todos los estados</option><option value="activa">Activas</option><option value="anulada">Anuladas</option></select><select aria-label="Matrículas por página" value={query.limit} onChange={e => setQuery(q => ({ ...q, limit: Number(e.target.value), page: 1 }))}><option value={20}>20 por página</option><option value={50}>50 por página</option><option value={100}>100 por página</option></select></form>
      <details className="he-course-filter"><summary>Filtros por estudiante, curso y edición</summary><div className="hm-filter-grid">
        <AcademicSelect<EnrollmentStudent> path="estudiantes?estado=todos" label="Estudiante" value={student} onChange={s => { setStudent(s); setQuery(q => ({ ...q, estudiante_id: s ? String(s.id) : '', page: 1 })); }} text={studentLabel} />
        <EditionCourseSelect allowAll value={query.curso_id} onChange={curso_id => setQuery(q => ({ ...q, curso_id, page: 1 }))} />
        <AcademicSelect<SeatEdition> path="matriculas/ediciones" label="Edición" value={edition} onChange={e => { setEdition(e); setQuery(q => ({ ...q, convocatoria_id: e ? String(e.id) : '', page: 1 })); }} text={seatLabel} />
      </div></details>
      {error ? <div className="hp-empty"><p className="hp-error" role="alert">{error}</p><button className="hp-btn" onClick={reload}>Reintentar</button></div> : loading ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando matrículas…</p></div> : !result?.items.length ? <div className="hp-empty"><PanelIcon name="calendar" size={32} /><h3>No hay matrículas en esta consulta</h3><p>Cambia los filtros o registra una matrícula en una edición abierta.</p>{query.page > 1 && <button className="hp-btn" onClick={() => setQuery(q => ({ ...q, page: 1 }))}>Ir a la primera página</button>}</div> : <div className="hp-table-wrap"><table className="hp-table hs-table"><caption className="hp-sr">Matrículas, estado y acciones disponibles</caption><thead><tr><th scope="col">Estudiante</th><th scope="col">Curso y edición</th><th scope="col">Fecha de matrícula</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead><tbody>{result.items.map(item => <tr key={item.id}><th scope="row"><div className="hp-record"><div><strong>{item.estudiante.apellidos}, {item.estudiante.nombres}</strong><small>DNI {item.estudiante.doc_numero || 'sin registrar'}</small></div></div></th><td><span className="hs-contact">{item.convocatoria.curso.titulo}<small>{item.convocatoria.nombre}</small></span></td><td>{new Date(item.createdAt).toLocaleDateString('es-PE')}</td><td><span className={'hp-badge ' + (item.estado === 'activa' ? 'hp-state-activo' : '')}>{ENROLLMENT_STATES[item.estado]}</span></td><td><div className="hp-row-actions"><button className="hp-btn" disabled={busy} onClick={() => void open(item.id)}>Detalle e historial</button>{enrollmentActions(item, can).map(action => <button key={action} className="hp-btn" disabled={busy} onClick={() => void open(item.id, action)}>{ENROLLMENT_ACTIONS[action]}</button>)}</div></td></tr>)}</tbody></table></div>}
      {result && <div className="hp-pagination"><span role="status">{result.pagination.total} matrículas · Página {query.page} de {Math.max(1, result.pagination.pages)}</span><div><button className="hp-btn" disabled={loading || query.page <= 1} onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}>Anterior</button><button className="hp-btn" disabled={loading || query.page >= result.pagination.pages} onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}>Siguiente</button></div></div>}
    </section>
    {editor && <EnrollmentEditor onClose={() => { setEditor(false); reload(); }} onSaved={() => { notify.success('Matrícula registrada.'); setEditor(false); reload(); }} />}
    {detail && <EnrollmentDetail item={detail} onClose={() => setDetail(null)} />}
    {operation && <EnrollmentOperation {...operation} onClose={() => { setOperation(null); reload(); }} onSaved={() => { notify.success('Matrícula actualizada.'); setOperation(null); reload(); }} />}
  </div>;
}
