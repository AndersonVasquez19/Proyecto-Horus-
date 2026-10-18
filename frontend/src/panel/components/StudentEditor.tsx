import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { errorMessage, PanelApiError, panelRequest } from '../services/panelApi';
import { EMPTY_STUDENT, studentForm, studentFormErrors, studentPayload, type Student, type StudentForm } from '../services/students';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import PanelDialog from './PanelDialog';

export default function StudentEditor({ original, onClose, onSaved }: { original: Student | null; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth();
  const { can } = usePanelAccess();
  const writable = can(original ? PANEL_ACTIONS.editarEstudiante : PANEL_ACTIONS.crearEstudiante);
  const [form, setForm] = useState<StudentForm>(() => original ? studentForm(original) : { ...EMPTY_STUDENT });
  const [errors, setErrors] = useState<Partial<Record<keyof StudentForm, string>>>({});
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const [current, setCurrent] = useState<Student | null>(null), [reading, setReading] = useState(false);
  const locked = useRef(false), mounted = useRef(true), controller = useRef<AbortController | null>(null);
  const initial = original ? studentForm(original) : EMPTY_STUDENT;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const { confirmLeave, clear } = useUnsavedChangesControl(dirty, 'el formulario de estudiante');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const close = () => { if (!locked.current) confirmLeave(() => { clear(); onClose(); }); };
  const change = (key: keyof StudentForm, value: string) => setForm(previous => ({ ...previous, [key]: value }));

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!writable || locked.current || blocked) return;
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
      const uncertain = request.signal.aborted || err instanceof TypeError;
      const conflict = err instanceof PanelApiError && err.status === 409 && !/DNI/.test(err.message);
      setBlocked(uncertain || conflict);
      setError(uncertain ? 'No se pudo confirmar el resultado. Conserva tus datos y revisa la lista antes de repetir el registro o la edición.' : errorMessage(err));
    } finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setSaving(false); }
  };
  const consult = async () => {
    if (!original || reading) return;
    setReading(true);
    const request = new AbortController(); controller.current = request;
    const timer = window.setTimeout(() => request.abort(), 15000);
    try { const result = await panelRequest<{ item: Student }>('estudiantes/' + original.id, token, 'GET', undefined, request.signal); if (mounted.current) setCurrent(result.item); }
    catch (err) { if (mounted.current) setError(errorMessage(err)); }
    finally { window.clearTimeout(timer); if (mounted.current) setReading(false); }
  };
  return <PanelDialog title={original ? 'Editar estudiante' : 'Registrar estudiante'} onClose={close} busy={saving} lockScroll>
    <form onSubmit={save} noValidate aria-busy={saving} data-student-form>
      {!writable && <p className="hp-notice">Tu permiso actual permite consultar este formulario.</p>}
      <fieldset className="hp-form-grid" disabled={saving || !writable}>
        <legend className="hp-sr">Datos del estudiante</legend>
        {(['nombres', 'apellidos', 'doc_numero', 'email', 'telefono'] as const).map(key => {
          const labels = { nombres: 'Nombres', apellidos: 'Apellidos', doc_numero: 'DNI', email: 'Correo electrónico', telefono: 'Teléfono' };
          return <label key={key}>{labels[key]}{['nombres', 'apellidos', 'doc_numero'].includes(key) && <span className="hp-required"> *</span>}
            <input name={key} value={form[key]} readOnly={blocked} onChange={event => change(key, event.target.value)} required={key === 'nombres' || key === 'apellidos' || (key === 'doc_numero' && (!original || !!original.doc_numero))}
              type={key === 'email' ? 'email' : key === 'telefono' ? 'tel' : 'text'} inputMode={key === 'doc_numero' ? 'numeric' : undefined}
              autoComplete={key === 'nombres' ? 'given-name' : key === 'apellidos' ? 'family-name' : key === 'doc_numero' ? 'off' : key === 'email' ? 'email' : 'tel'}
              maxLength={key === 'email' ? 254 : key === 'telefono' ? 30 : key === 'doc_numero' ? 8 : 120} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? 'student-error-' + key : key === 'doc_numero' ? 'student-dni-hint' : undefined} />
            {key === 'doc_numero' && <small id="student-dni-hint">8 dígitos, incluidos los ceros iniciales. Se valida el formato.{original && !original.doc_numero ? ' Este registro anterior puede conservarse sin DNI.' : ''}</small>}
            {errors[key] && <small className="hs-field-error" id={'student-error-' + key}>{errors[key]}</small>}
          </label>;
        })}
      </fieldset>
      {error && <p className="hp-error" role="alert">{error}</p>}
      {blocked && original && <div className="hs-conflict"><button className="hp-btn" type="button" onClick={() => void consult()} disabled={reading}>{reading ? 'Consultando…' : 'Consultar versión actual'}</button>
        {current && <dl className="hp-details"><div><dt>Versión actual (revisión {current.revision})</dt><dd>{current.nombres} {current.apellidos} · DNI {current.doc_numero || 'sin registrar'}</dd></div><div><dt>Contacto actual</dt><dd>{current.email || 'Sin correo'} · {current.telefono || 'Sin teléfono'}</dd></div><div><dt>Estado</dt><dd>{current.archivado_at ? 'Archivado' : 'Activo'}</dd></div></dl>}
        <p>Copia los cambios que necesites conservar. Cierra el formulario y vuelve a abrir el registro para editar la versión vigente.</p></div>}
      <footer className="hp-dialog-footer"><button type="button" className="hp-btn" onClick={close} disabled={saving}>Cancelar</button>
        {writable && <button type="submit" className="hp-btn hp-btn-primary" disabled={saving || blocked}>{saving ? 'Guardando…' : original ? 'Guardar cambios' : 'Registrar estudiante'}</button>}</footer>
    </form>
  </PanelDialog>;
}
