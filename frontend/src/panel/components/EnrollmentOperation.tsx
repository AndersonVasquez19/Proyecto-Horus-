import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import { errorMessage, panelRequest } from '../services/panelApi';
import { ENROLLMENT_ACTIONS, ENROLLMENT_STATES, enrollmentActions, studentLabel, type Enrollment, type EnrollmentAction } from '../services/enrollments';
import PanelDialog from './PanelDialog';
import '../styles/enrollments.css';

export default function EnrollmentOperation({ item, action, onClose, onSaved }: { item: Enrollment; action: EnrollmentAction; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth(); const { can } = usePanelAccess(); const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState(''), [current, setCurrent] = useState<Enrollment | null>(null);
  const locked = useRef(false), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const motiveRef = useRef<HTMLTextAreaElement>(null);
  const [motiveError, setMotiveError] = useState('');
  const { clear, confirmLeave } = useUnsavedChangesControl(!!motivo, 'el motivo del cambio de matrícula');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const close = () => { if (!locked.current) confirmLeave(() => { clear(); onClose(); }); };
  const apply = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (locked.current || blocked || !enrollmentActions(item, can).includes(action)) return;
    if (!motivo.trim() || motivo.trim().length > 300) { setMotiveError('Escribe el motivo del cambio (máximo 300 caracteres).'); motiveRef.current?.focus(); return; }
    setMotiveError('');
    locked.current = true; setBusy(true); setError(''); const controller = new AbortController(); request.current = controller; const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const r = await panelRequest<{ item: Enrollment }>(`matriculas/${item.id}/${action === 'annul' ? 'anulacion' : 'reactivacion'}`, token, 'PUT', { revision: item.revision, motivo: motivo.trim(), ...(action === 'reactivate' ? { convocatoria_revision: item.convocatoria.revision } : {}) }, controller.signal);
      if (!r.item?.id || r.item.revision <= item.revision || r.item.estado !== (action === 'annul' ? 'anulada' : 'activa')) throw new Error('No se pudo confirmar el resultado.');
      if (mounted.current) { clear(); onSaved(); }
    } catch (e) { if (mounted.current) { setBlocked(true); setError(errorMessage(e) + ' Consulta la versión actual antes de repetir; no se reintentará automáticamente.'); } }
    finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setBusy(false); }
  };
  const consult = async () => {
    if (locked.current) return; locked.current = true; setBusy(true);
    const controller = new AbortController(); request.current = controller; const timer = window.setTimeout(() => controller.abort(), 15000);
    try { const r = await panelRequest<{ item: Enrollment }>('matriculas/' + item.id, token, 'GET', undefined, controller.signal); if (mounted.current) setCurrent(r.item); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setBusy(false); }
  };
  return <PanelDialog title={ENROLLMENT_ACTIONS[action]} className="hme-dialog" busy={busy} onClose={close} lockScroll>
    <form data-enrollment-operation onSubmit={apply} noValidate><div className="hme-body"><div className="hp-confirm"><h3>{studentLabel(item.estudiante)}</h3><p>{item.convocatoria.curso.titulo} · {item.convocatoria.nombre}</p><p>Estado actual: {ENROLLMENT_STATES[item.estado]} · Revisión {item.revision}</p><p>{action === 'annul' ? 'La matrícula se conservará como anulada y liberará su cupo.' : 'Se conservará la misma matrícula. La edición debe seguir abierta y tener cupos disponibles.'}</p></div>
      <fieldset className="hp-form-grid" disabled={busy || blocked}><legend className="hp-sr">Motivo del cambio</legend><label className="hp-full">Motivo <span className="hp-required">*</span><textarea ref={motiveRef} name="motivo" maxLength={300} required value={motivo} aria-invalid={!!motiveError} aria-describedby={'hme-motive-help' + (motiveError ? ' hme-motive-error' : '')} onChange={e => { setMotivo(e.target.value); setMotiveError(''); }} /><small id="hme-motive-help">Obligatorio. Máximo 300 caracteres. Se conservará en el historial.</small></label></fieldset>
      {motiveError && <p id="hme-motive-error" className="hme-field-error" role="alert">{motiveError}</p>}
      {error && <p className="hp-error" role="alert">{error}</p>}{blocked && <div className="hs-conflict"><button type="button" className="hp-btn" disabled={busy} onClick={() => void consult()}>Consultar versión actual</button>{current && <p>Estado actual: {ENROLLMENT_STATES[current.estado]} · Revisión {current.revision}. El motivo se conserva; cierra este diálogo antes de iniciar otra operación.</p>}</div>}
      </div><div className="hp-dialog-footer"><button type="button" className="hp-btn" data-autofocus disabled={busy} onClick={close}>Volver</button><button type="submit" className="hp-btn hp-btn-primary" disabled={busy || blocked || !enrollmentActions(item, can).includes(action)}>{busy ? 'Guardando…' : 'Confirmar'}</button></div>
    </form>
  </PanelDialog>;
}
