import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { errorMessage, PanelApiError, panelRequest } from '../services/panelApi';
import { EMPTY_STUDENT, studentForm, studentFormErrors, studentPayload, type Student, type StudentForm, type StudentList } from '../services/students';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import PanelDialog from './PanelDialog';
import PanelInputField from './PanelInputField';

const STUDENT_LABELS = { nombres: 'Nombres', apellidos: 'Apellidos', doc_numero: 'DNI', email: 'Correo electrónico', telefono: 'Teléfono' };

export default function StudentEditor({ original, onClose, onSaved }: { original: Student | null; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth();
  const { can } = usePanelAccess();
  const writable = can(original ? PANEL_ACTIONS.editarEstudiante : PANEL_ACTIONS.crearEstudiante);
  const [form, setForm] = useState<StudentForm>(() => original ? studentForm(original) : { ...EMPTY_STUDENT });
  const [errors, setErrors] = useState<Partial<Record<keyof StudentForm, string>>>({});
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const [current, setCurrent] = useState<Student | null>(null), [reading, setReading] = useState(false);
  const [consulted, setConsulted] = useState(false), [consultError, setConsultError] = useState('');
  const readLock = useRef(false), blockedRef = useRef(false);
  const locked = useRef(false), mounted = useRef(true), controller = useRef<AbortController | null>(null);
  const initial = original ? studentForm(original) : EMPTY_STUDENT;
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (Object.keys(errors).length) summary.current?.focus(); }, [errors]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const { confirmLeave, clear } = useUnsavedChangesControl(dirty, 'el formulario de estudiante');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const close = () => { if (!locked.current) confirmLeave(() => { clear(); onClose(); }); };
  const change = (key: keyof StudentForm, value: string) => setForm(previous => ({ ...previous, [key]: value }));

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!writable || locked.current || blockedRef.current) return;
    const nextErrors = studentFormErrors(form, original); setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    locked.current = true; setSaving(true); setError('');
    const request = new AbortController(); controller.current = request;
    const timer = window.setTimeout(() => request.abort(), 20000);
    try {
      await panelRequest<{ item: Student }>('estudiantes' + (original ? '/' + original.id : ''), token, original ? 'PUT' : 'POST', studentPayload(form, original?.revision), request.signal);
      if (!mounted.current) return;
      clear(); onSaved();
    } catch (err) {
      if (!mounted.current) return;
      // Un timeout o fallo de red puede ocurrir después de persistir. Conservar borrador, no repetir automáticamente.
      const uncertain = request.signal.aborted || !(err instanceof PanelApiError) || err.status >= 500 || err.status < 400;
      const conflict = err instanceof PanelApiError && err.status === 409 && !/DNI/.test(err.message);
      blockedRef.current = uncertain || conflict; setBlocked(blockedRef.current);
      setError(uncertain ? 'No se pudo confirmar el resultado. Conserva tus datos y revisa la lista antes de repetir el registro o la edición.' : errorMessage(err));
    } finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setSaving(false); }
  };
  const consult = async () => {
    if (readLock.current || !can('estudiantes:leer')) return;
    readLock.current = true; setReading(true); setConsultError('');
    const request = new AbortController(); controller.current = request;
    const timer = window.setTimeout(() => request.abort(), 15000);
    try {
      let found: Student | null;
      if (original) {
        const result = await panelRequest<{ item: Student }>('estudiantes/' + original.id, token, 'GET', undefined, request.signal); found = result.item;
      } else {
        const result = await panelRequest<StudentList>('estudiantes?' + new URLSearchParams({ page: '1', limit: '20', estado: 'todos', search: form.doc_numero }), token, 'GET', undefined, request.signal);
        found = result.items.find(item => item.doc_numero === form.doc_numero) || null;
      }
      if (mounted.current && !request.signal.aborted) { setCurrent(found); setConsulted(true); }
    }
    catch (err) { if (mounted.current) setConsultError(request.signal.aborted ? 'La consulta tardó demasiado. Puedes volver a consultar sin reenviar el formulario.' : errorMessage(err)); }
    finally { window.clearTimeout(timer); readLock.current = false; if (mounted.current) setReading(false); }
  };
  return <PanelDialog title={original ? 'Editar estudiante' : 'Registrar estudiante'} onClose={close} busy={saving} lockScroll className="hs-student-dialog">
    <form onSubmit={save} noValidate aria-busy={saving} data-student-form>
      <div className="hs-student-body">
      <p className="hs-form-intro">Datos personales y de contacto. Los campos opcionales pueden quedar vacíos.</p>
      {!writable && <p className="hp-notice">Tu permiso actual permite consultar este formulario.</p>}
      {Object.keys(errors).length > 0 && <div className="hp-form-summary" role="alert" tabIndex={-1} ref={summary}>
        <h3>Revisa {Object.keys(errors).length === 1 ? 'el campo señalado' : 'los ' + Object.keys(errors).length + ' campos señalados'}</h3>
        <p>Tus datos se conservan. Selecciona un error para corregirlo.</p>
        <ul>{(Object.keys(errors) as (keyof StudentForm)[]).map(key => <li key={key}><button type="button" onClick={event => {
          event.currentTarget.form?.querySelector<HTMLInputElement>('[name="' + key + '"]')?.focus();
        }}>{STUDENT_LABELS[key]}: {errors[key]}</button></li>)}</ul>
      </div>}
      <fieldset className="hp-form-grid" disabled={saving || !writable}>
        <legend className="hp-sr">Datos del estudiante</legend>
        {(['nombres', 'apellidos', 'doc_numero', 'email', 'telefono'] as const).map(key => {
          return <PanelInputField key={key} label={STUDENT_LABELS[key]} name={key} value={form[key]} readOnly={blocked} onChange={event => change(key, event.target.value)} required={key === 'nombres' || key === 'apellidos' || (key === 'doc_numero' && (!original || !!original.doc_numero))}
              data-autofocus={key === 'nombres' ? true : undefined} error={errors[key]}
              help={key === 'doc_numero' ? '8 dígitos, incluidos los ceros iniciales. Se valida el formato.' + (original && !original.doc_numero ? ' Este registro anterior puede conservarse sin DNI.' : '') : undefined}
              type={key === 'email' ? 'email' : key === 'telefono' ? 'tel' : 'text'} inputMode={key === 'doc_numero' ? 'numeric' : undefined}
              autoComplete={key === 'nombres' ? 'given-name' : key === 'apellidos' ? 'family-name' : key === 'doc_numero' ? 'off' : key === 'email' ? 'email' : 'tel'}
              maxLength={key === 'email' ? 254 : key === 'telefono' ? 30 : key === 'doc_numero' ? 8 : 120} />;
        })}
      </fieldset>
      {error && <p className="hp-error" role="alert">{error}</p>}
      {blocked && <div className="hs-conflict">{can('estudiantes:leer') && <button className="hp-btn" type="button" onClick={() => void consult()} disabled={reading}>{reading ? 'Consultando…' : original ? 'Consultar versión actual' : 'Consultar por DNI'}</button>}
        {consultError && <p role="alert">{consultError}</p>}
        {consulted && !current && <p role="status">Aún no aparece un registro con este DNI. Esto no confirma que la solicitud haya fallado. Consulta de nuevo antes de iniciar otro registro; no cambies el DNI para repetirlo.</p>}
        {current && <dl className="hp-details"><div><dt>Versión actual (revisión {current.revision})</dt><dd>{current.nombres} {current.apellidos} · DNI {current.doc_numero || 'sin registrar'}</dd></div><div><dt>Contacto actual</dt><dd>{current.email || 'Sin correo'} · {current.telefono || 'Sin teléfono'}</dd></div><div><dt>Estado</dt><dd>{current.archivado_at ? 'Archivado' : 'Activo'}</dd></div></dl>}
        <p>Copia los cambios que necesites conservar. Cierra el formulario y vuelve a abrir el registro para editar la versión vigente.</p></div>}
      </div>
      <footer className="hp-dialog-footer"><button type="button" className="hp-btn" onClick={close} disabled={saving}>Cancelar</button>
        {writable && <button type="submit" className="hp-btn hp-btn-primary" disabled={saving || blocked}>{saving ? 'Guardando…' : original ? 'Guardar cambios' : 'Registrar estudiante'}</button>}</footer>
    </form>
  </PanelDialog>;
}
