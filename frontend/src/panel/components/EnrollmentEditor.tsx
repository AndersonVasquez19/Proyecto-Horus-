import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import { errorMessage, panelRequest, PanelApiError } from '../services/panelApi';
import { canEnroll, enrollmentPayload, seatLabel, studentLabel, unavailableEdition, type Enrollment, type EnrollmentStudent, type SeatEdition } from '../services/enrollments';
import AcademicSelect from './AcademicSelect';
import PanelDialog from './PanelDialog';

export default function EnrollmentEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [student, setStudent] = useState<EnrollmentStudent | null>(null), [edition, setEdition] = useState<SeatEdition | null>(null);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [blocked, setBlocked] = useState(false);
  const locked = useRef(false), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const { clear, confirmLeave } = useUnsavedChangesControl(!!student || !!edition, 'el formulario de matrícula');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const close = () => { if (!locked.current) confirmLeave(() => { clear(); onClose(); }); };
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (locked.current || blocked || !can('matriculas:crear')) return;
    if (!student || !edition || !canEnroll(edition)) { setError('Selecciona un estudiante y una edición abierta con cupos disponibles.'); return; }
    locked.current = true; setSaving(true); setError(''); const controller = new AbortController(); request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const r = await panelRequest<{ item: Enrollment }>('matriculas', token, 'POST', enrollmentPayload(student, edition), controller.signal);
      if (!r.item?.id || r.item.estado !== 'activa') throw new Error('No se pudo confirmar el resultado.');
      if (mounted.current) { clear(); onSaved(); }
    } catch (e) {
      if (!mounted.current) return;
      const uncertain = !(e instanceof PanelApiError) || e.status >= 500 || e.status < 400;
      setBlocked(uncertain || (e instanceof PanelApiError && e.status === 409));
      setError(uncertain ? 'No se pudo confirmar el resultado. Conserva la selección y consulta la lista antes de repetir. No se reintentará automáticamente.' : errorMessage(e));
    } finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setSaving(false); }
  };
  return <PanelDialog title="Registrar matrícula" busy={saving} onClose={close} lockScroll>
    <form data-enrollment-form onSubmit={save} noValidate>
      <p className="hp-notice">Selecciona registros existentes. Los cupos se comprueban nuevamente al guardar.</p>
      <fieldset className="hp-form-grid" disabled={saving || blocked || !can('matriculas:crear')}><legend className="hp-sr">Datos de la matrícula</legend>
        <AcademicSelect<EnrollmentStudent> path="estudiantes?estado=activos" label="Estudiante" value={student} onChange={setStudent} text={studentLabel} disabled={saving || blocked} />
        <AcademicSelect<SeatEdition> path="matriculas/ediciones" label="Edición" value={edition} onChange={setEdition} text={seatLabel} unavailable={unavailableEdition} disabled={saving || blocked} />
      </fieldset>
      {error && <p className="hp-error" role="alert">{error}</p>}
      {blocked && <p className="hp-notice">La selección se conserva. Cierra y consulta la lista y los cupos actuales antes de iniciar otra operación.</p>}
      <div className="hp-dialog-footer"><button type="button" className="hp-btn" disabled={saving} onClick={close}>Cancelar</button><button type="submit" className="hp-btn hp-btn-primary" disabled={saving || blocked || !can('matriculas:crear')}>{saving ? 'Registrando…' : 'Registrar matrícula'}</button></div>
    </form>
  </PanelDialog>;
}
