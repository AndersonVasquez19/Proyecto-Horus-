import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import { ENROLLMENT_STATES, studentLabel, type AcademicHistory, type Enrollment, type EnrollmentList } from '../services/enrollments';
import PanelDialog from './PanelDialog';

export default function EnrollmentDetail({ item, onClose }: { item: Enrollment; onClose: () => void }) {
  const { token } = useAdminAuth(); const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([token, item.id, page, refresh]); const { loading, error, setLoading, setError } = useRequestStatus(key);
  const [data, setData] = useState<{ key: string; result: EnrollmentList<AcademicHistory> } | null>(null);
  const result = data?.key === key ? data.result : null;
  useEffect(() => {
    const controller = new AbortController(); let live = true; const timer = window.setTimeout(() => controller.abort(), 15000);
    panelRequest<EnrollmentList<AcademicHistory>>(`matriculas/${item.id}/historial?page=${page}&limit=10`, token, 'GET', undefined, controller.signal)
      .then(r => { if (!Array.isArray(r.items) || !r.pagination) throw new Error('No se pudo interpretar el historial.'); if (live) setData({ key, result: r }); })
      .catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, item.id, page, key, setLoading, setError]);
  return <PanelDialog title={'Matrícula #' + item.id} onClose={onClose} lockScroll footer={<button className="hp-btn" onClick={onClose}>Cerrar</button>}>
    <dl className="hp-details"><div><dt>Estudiante</dt><dd>{studentLabel(item.estudiante)}</dd></div><div><dt>Curso y edición</dt><dd>{item.convocatoria.curso.titulo} · {item.convocatoria.nombre}</dd></div><div><dt>Estado</dt><dd>{ENROLLMENT_STATES[item.estado]} · Revisión {item.revision}</dd></div><div><dt>Fecha de matrícula</dt><dd>{new Date(item.createdAt).toLocaleString('es-PE')}</dd></div></dl>
    <section className="hm-history" aria-label="Historial académico" aria-busy={loading}><h3>Historial académico</h3>
      {loading ? <p role="status">Cargando historial…</p> : error ? <p className="hp-error" role="alert">{error} <button className="hp-btn" onClick={() => setRefresh(v => v + 1)}>Reintentar historial</button></p> : !result?.items.length ? <p>No hay movimientos registrados para esta matrícula.</p> : <ol>{result.items.map(h => <li key={h.id}><strong>{h.operacion === 'creacion' ? 'Registro de matrícula' : h.operacion === 'anulacion' ? 'Anulación' : h.operacion === 'cambio_estado' && h.estado_nuevo === 'activa' ? 'Reactivación' : h.operacion}</strong><p>{h.estado_anterior ? h.estado_anterior + ' → ' : ''}{h.estado_nuevo || 'Sin estado registrado'} · Revisión {h.revision ?? 'sin registrar'}</p><p><time dateTime={h.createdAt}>{new Date(h.createdAt).toLocaleString('es-PE')}</time> · {h.actor_id ? 'Responsable #' + h.actor_id : h.operador ? 'Operador: ' + h.operador : 'Sin responsable registrado'} · {h.actor_rol || 'Sin rol registrado'}</p>{h.motivo && <p>Motivo: {h.motivo}</p>}</li>)}</ol>}
      {result && <div className="hp-pagination"><span>Página {page} de {Math.max(1, result.pagination.pages)}</span><div><button className="hp-btn" disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button><button className="hp-btn" disabled={loading || page >= result.pagination.pages} onClick={() => setPage(p => p + 1)}>Siguiente</button></div></div>}
    </section>
  </PanelDialog>;
}
