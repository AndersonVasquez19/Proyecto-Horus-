import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context';
import { errorMessage, panelRequest } from '../services/panelApi';
import { PREREG_CHANNELS, PREREG_STATES, historyLabel, parsePreregHistory, preregDateTime, preregName, type PreregDetail, type PreregHistoryItem } from '../services/preregistrations';
import { editionDate } from '../services/editions';
import PanelDialog from './PanelDialog';

// Detalle de solo lectura: datos, edición, vínculos y el historial (sin valores personales: el backend solo guarda nombres de campo y estados).
export default function PreregDetailDialog({ detail, onClose }: { detail: PreregDetail; onClose: () => void }) {
  const { token } = useAdminAuth(); const { item } = detail;
  const [history, setHistory] = useState<PreregHistoryItem[] | null>(null), [historyError, setHistoryError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true; const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 15000);
    panelRequest<unknown>('preinscripciones/' + item.id + '/historial?page=1&limit=20', token, 'GET', undefined, controller.signal)
      .then(result => { const parsed = parsePreregHistory(result); if (!parsed) throw new Error('No se pudo interpretar el historial.'); if (live) { setHistory(parsed.items); setHistoryError(''); } })
      .catch(err => { if (live) { setHistory(null); setHistoryError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); } })
      .finally(() => window.clearTimeout(timer));
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [item.id, token, reload]);
  const rows: [string, string][] = [
    ['Persona', preregName(item)], ['Correo electrónico', item.email], ['Teléfono', item.telefono], ['Estado', PREREG_STATES[item.estado]], ['Canal', PREREG_CHANNELS[item.canal] ?? item.canal],
    ['Curso', item.convocatoria.curso.titulo], ['Edición', item.convocatoria.nombre + ' · ' + editionDate(item.convocatoria.fecha_inicio) + ' a ' + editionDate(item.convocatoria.fecha_fin)],
    ['Recibida', preregDateTime(item.createdAt)], ['Consentimiento', preregDateTime(item.consentimiento_at) + ' · aviso ' + item.aviso_version], ['Revisión', String(item.revision)],
    ...(detail.estudiante ? [['Estudiante vinculado', detail.estudiante.apellidos + ', ' + detail.estudiante.nombres] as [string, string]] : []),
    ...(detail.matricula ? [['Matrícula', 'N.º ' + detail.matricula.id + ' · ' + detail.matricula.estado] as [string, string]] : []),
  ];
  return <PanelDialog title="Detalle de la preinscripción" onClose={onClose} lockScroll footer={<button className="hp-btn" onClick={onClose}>Cerrar</button>}>
    <dl className="hp-details">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {detail.coincidencias.length > 0 && <section className="hm-history" aria-label="Posibles duplicados"><h3>Posibles duplicados en la misma edición</h3>
      <ul>{detail.coincidencias.map(match => <li key={match.id}>Solicitud #{match.id} · {PREREG_STATES[match.estado]} · coincide en {match.coincide.map(field => field === 'email' ? 'correo' : 'teléfono').join(' y ')} · {preregDateTime(match.createdAt)}</li>)}</ul></section>}
    <section className="hm-history" aria-label="Historial" aria-busy={!history && !historyError}><h3>Historial</h3>
      {historyError ? <><p className="hp-error" role="alert">{historyError}</p><button type="button" className="hp-btn" onClick={() => setReload(v => v + 1)}>Reintentar</button></>
        : !history ? <p role="status">Cargando historial…</p>
          : !history.length ? <p>Sin movimientos registrados.</p>
            : <ol>{history.map(entry => <li key={entry.id}><strong>{historyLabel(entry.operacion)}</strong> · {preregDateTime(entry.createdAt)}
              {entry.estado_anterior && entry.estado_nuevo && <p>{PREREG_STATES[entry.estado_anterior]} → {PREREG_STATES[entry.estado_nuevo]}</p>}{entry.motivo && <p>Motivo: {entry.motivo}</p>}</li>)}</ol>}
    </section>
  </PanelDialog>;
}
