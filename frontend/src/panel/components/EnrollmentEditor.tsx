import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import { errorMessage, panelRequest, PanelApiError } from '../services/panelApi';
import { canEnroll, enrollmentPayload, seatLabel, studentLabel, unavailableEdition, type Enrollment, type EnrollmentStudent, type SeatEdition } from '../services/enrollments';
import EnrollmentPicker from './EnrollmentPicker';
import PanelDialog from './PanelDialog';
import { EDITION_STATES } from '../services/editions';
import '../styles/enrollments.css';

export default function EnrollmentEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [student, setStudent] = useState<EnrollmentStudent | null>(null), [edition, setEdition] = useState<SeatEdition | null>(null);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [blocked, setBlocked] = useState(false);
  const [validated, setValidated] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusPicker = (label: string) => {
    const group = formRef.current?.querySelector<HTMLElement>(`[data-enrollment-picker="${label}"]`);
    group?.querySelector<HTMLButtonElement>('button')?.click();
  };
  const locked = useRef(false), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const { clear, confirmLeave } = useUnsavedChangesControl(!!student || !!edition, 'el formulario de matrícula');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const close = () => { if (!locked.current) confirmLeave(() => { clear(); onClose(); }); };
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (locked.current || blocked || !can('matriculas:crear')) return;
    setValidated(true);
    if (!student || !edition || !canEnroll(edition)) { focusPicker(!student ? 'Estudiante' : 'Edición'); return; }
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
  const studentError = validated && !student ? 'Selecciona un estudiante.' : undefined;
  const editionError = validated && (!edition || !canEnroll(edition)) ? 'Selecciona una edición abierta con cupos disponibles.' : undefined;
  const date = (value: string | null) => value ? value.split('-').reverse().join('/') : 'Sin fecha definida';
  return <PanelDialog title="Registrar matrícula" className="hme-dialog" busy={saving} onClose={close} lockScroll>
    <form ref={formRef} data-enrollment-form onSubmit={save} noValidate>
      <div className="hme-body">
      <p className="hme-intro">Selecciona un estudiante y una edición. Los cupos se comprueban al registrar; no se reservan.</p>
      {(studentError || editionError) && <div className="hp-form-summary" role="alert"><p>Revisa la selección para continuar.</p>
        {studentError && <button type="button" onClick={() => focusPicker('Estudiante')}>{studentError}</button>}
        {editionError && <button type="button" onClick={() => focusPicker('Edición')}>{editionError}</button>}
      </div>}
      <fieldset className="hme-fields" disabled={saving || blocked || !can('matriculas:crear')}><legend className="hp-sr">Datos de la matrícula</legend>
        <EnrollmentPicker<EnrollmentStudent> path="estudiantes?estado=activos" label="Estudiante" value={student} onChange={setStudent} text={studentLabel} disabled={saving || blocked} error={studentError}
          summary={student && <><p><strong>{student.apellidos}, {student.nombres}</strong></p><p className="hme-muted">DNI {student.doc_numero || 'sin registrar'}</p></>} />
        <EnrollmentPicker<SeatEdition> path="matriculas/ediciones" label="Edición" title="Curso y edición" value={edition} onChange={setEdition} text={seatLabel} unavailable={unavailableEdition} disabled={saving || blocked} error={editionError}
          summary={edition && <><p><strong>{edition.curso.titulo}</strong></p><p>{edition.nombre}</p><p className="hme-muted">Inicio: {date(edition.fecha_inicio)} · Fin: {date(edition.fecha_fin)}</p>
            <span className="hp-badge">{EDITION_STATES[edition.estado]} · {edition.disponibles === null ? 'Capacidad sin definir' : edition.disponibles + ' cupos disponibles'}</span>
            <p className="hme-muted">{edition.ocupados} ocupados de {edition.capacidad ?? 'capacidad sin definir'} · Datos de la última consulta</p></>} />
      </fieldset>
      {error && <p className="hp-error" role="alert">{error}</p>}
      {blocked && <p className="hp-notice">La selección se conserva. Cierra y consulta la lista y los cupos actuales antes de iniciar otra operación.</p>}
      </div>
      <div className="hp-dialog-footer"><button type="button" className="hp-btn" disabled={saving} onClick={close}>Cancelar</button><button type="submit" className="hp-btn hp-btn-primary" disabled={saving || blocked || !can('matriculas:crear')}>{saving ? 'Registrando…' : 'Registrar matrícula'}</button></div>
    </form>
  </PanelDialog>;
}
