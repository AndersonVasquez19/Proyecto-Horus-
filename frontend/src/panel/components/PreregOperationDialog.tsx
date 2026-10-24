import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { errorMessage, panelRequest, PanelApiError } from '../services/panelApi';
import { notify } from '../services/notify';
import { PERSONAL_DATA_HINT, PREREG_ACTION_LABEL, PREREG_STATES, conversionPayload, dniError, identityIssue, parsePreregDetail, preregActions, preregCorrectionPayload, preregForm, preregFormErrors, preregName, reasonError, type Prereg, type PreregAction, type PreregForm } from '../services/preregistrations';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import PanelDialog from './PanelDialog';

const FIELD_LABEL: Record<keyof PreregForm, string> = { nombres: 'Nombres', apellidos: 'Apellidos', email: 'Correo electrónico', telefono: 'Teléfono' };
const INTRO: Record<PreregAction, string> = {
  correct: 'Corrige solo los datos que estén mal. Cada corrección queda en el historial (sin repetir los valores).',
  validate: 'La solicitud pasará a validada y contará para el mínimo de apertura de la edición. Aún no es una matrícula.',
  discard: 'La solicitud quedará descartada de forma definitiva. La persona podrá volver a preinscribirse si lo desea.',
  withdraw: 'Se registrará que la persona ya no está interesada. La solicitud quedará como desistida.',
  convert: 'Se creará la matrícula oficial con las reglas de Matrículas (edición abierta y cupos). Escribe el DNI que verificaste en el documento de la persona: no se puede omitir.',
};

// Una sola ventana para todas las operaciones de una preinscripción. La revisión viaja siempre; ante un 409 o un resultado incierto se bloquea el
// reenvío, se conserva lo escrito y se ofrece consultar la versión actual. Nunca se repite una escritura por sí sola.
export default function PreregOperationDialog({ item, action, onClose, onSaved }: { item: Prereg; action: PreregAction; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [form, setForm] = useState<PreregForm>(() => preregForm(item)), [motivo, setMotivo] = useState(''), [dni, setDni] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof PreregForm | 'motivo' | 'dni', string>>>({}), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [current, setCurrent] = useState<Prereg | null>(null);
  const locked = useRef(false), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const allowed = preregActions(item, can).includes(action);
  const dirty = !!motivo || !!dni || JSON.stringify(form) !== JSON.stringify(preregForm(item));
  const { confirmLeave, clear } = useUnsavedChangesControl(dirty, 'la operación sobre la preinscripción');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const close = () => { if (!locked.current) confirmLeave(() => { clear(); onClose(); }); };
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (locked.current || blocked || !allowed) return;
    const next: typeof errors = action === 'correct' ? preregFormErrors(form) : {};
    if (action === 'discard' || action === 'withdraw') { const reason = reasonError(motivo, action === 'discard'); if (reason) next.motivo = reason; }
    if (action === 'convert' && dniError(dni)) next.dni = dniError(dni);
    const payload = action === 'correct' ? preregCorrectionPayload(form, item) : null;
    if (action === 'correct' && !Object.keys(next).length && !payload) next.nombres = 'No hay cambios que guardar.';
    setErrors(next); setError(''); if (Object.keys(next).length) return;
    const text = motivo.trim();
    const [path, method, body]: [string, string, unknown] = action === 'correct' ? ['', 'PATCH', payload] : action === 'validate' ? ['/validacion', 'PUT', { revision: item.revision }] : action === 'discard' ? ['/descarte', 'PUT', { revision: item.revision, motivo: text }]
      : action === 'withdraw' ? ['/desistimiento', 'PUT', { revision: item.revision, ...(text ? { motivo: text } : {}) }] : ['/conversion', 'POST', conversionPayload(item.revision, dni)];
    locked.current = true; setBusy(true);
    const controller = new AbortController(); request.current = controller; const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const result = await panelRequest<{ item?: Prereg; matricula?: { id: number } | null; estudiante_creado?: boolean }>('preinscripciones/' + item.id + path, token, method, body, controller.signal);
      const expected = { correct: item.estado, validate: 'validada', discard: 'descartada', withdraw: 'desistida', convert: 'matriculada' }[action];
      if (!result.item?.id || result.item.revision <= item.revision || result.item.estado !== expected || (action === 'convert' && !result.matricula)) throw new Error('No se pudo confirmar el resultado.');
      if (!mounted.current) return;
      notify.success(action === 'convert' ? (result.estudiante_creado ? 'Matrícula creada y estudiante registrado.' : 'Matrícula creada para el estudiante existente.') : action === 'correct' ? 'Datos corregidos.' : action === 'validate' ? 'Preinscripción validada.' : action === 'discard' ? 'Preinscripción descartada.' : 'Desistimiento registrado.');
      clear(); onSaved();
    } catch (err) {
      if (!mounted.current) return;
      const status = err instanceof PanelApiError ? err.status : 0;
      const identity = status === 409 && err instanceof PanelApiError ? identityIssue(err.body) : null;
      if (identity) { setError(identity.message); return; } // la revisión no cambió: se corrige el dato y se vuelve a intentar a propósito
      if (status >= 400 && status < 500 && status !== 409) { setError(errorMessage(err)); return; }
      setBlocked(true);
      setError(status === 409 ? errorMessage(err) + ' Consulta la versión actual antes de decidir.' : 'No se pudo confirmar el resultado. Consulta la versión actual antes de repetir. No se reintentará automáticamente.');
    } finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setBusy(false); }
  };
  const consult = async () => {
    if (locked.current) return; locked.current = true; setBusy(true);
    const controller = new AbortController(); request.current = controller; const timer = window.setTimeout(() => controller.abort(), 15000);
    try { const detail = parsePreregDetail(await panelRequest<unknown>('preinscripciones/' + item.id, token, 'GET', undefined, controller.signal)); if (!detail) throw new Error('No se pudo interpretar la respuesta del servidor.'); if (mounted.current) setCurrent(detail.item); }
    catch (err) { if (mounted.current) setError(errorMessage(err)); }
    finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setBusy(false); }
  };
  return <PanelDialog title={PREREG_ACTION_LABEL[action]} busy={busy} onClose={close} lockScroll>
    <form onSubmit={submit} noValidate aria-busy={busy} data-prereg-operation={action}>
      <div className="hp-confirm"><h3>{preregName(item)}</h3><p>{item.convocatoria.curso.titulo} · {item.convocatoria.nombre}</p><p>{INTRO[action]}</p></div>
      <fieldset className="hp-form-grid" disabled={busy || blocked}><legend className="hp-sr">{PREREG_ACTION_LABEL[action]}</legend>
        {action === 'correct' && (Object.keys(FIELD_LABEL) as (keyof PreregForm)[]).map(key => <label key={key}>{FIELD_LABEL[key]} <span className="hp-required">*</span>
          <input name={key} type={key === 'email' ? 'email' : key === 'telefono' ? 'tel' : 'text'} required maxLength={key === 'email' ? 254 : key === 'telefono' ? 30 : 120} value={form[key]} onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? 'prereg-error-' + key : undefined} />
          {errors[key] && <small id={'prereg-error-' + key} className="hs-field-error">{errors[key]}</small>}</label>)}
        {(action === 'discard' || action === 'withdraw') && <label className="hp-full">Motivo{action === 'discard' && <span className="hp-required"> *</span>}
          <textarea name="motivo" maxLength={300} value={motivo} onChange={e => setMotivo(e.target.value)} aria-invalid={!!errors.motivo} aria-describedby={'prereg-motivo-help' + (errors.motivo ? ' prereg-error-motivo' : '')} />
          <small id="prereg-motivo-help">{PERSONAL_DATA_HINT}</small>{errors.motivo && <small id="prereg-error-motivo" className="hs-field-error">{errors.motivo}</small>}</label>}
        {action === 'convert' && <label>DNI del documento <span className="hp-required">*</span>
          <input name="dni" inputMode="numeric" autoComplete="off" maxLength={8} required value={dni} onChange={e => setDni(e.target.value)} aria-invalid={!!errors.dni} aria-describedby={errors.dni ? 'prereg-error-dni' : undefined} />
          {errors.dni && <small id="prereg-error-dni" className="hs-field-error">{errors.dni}</small>}</label>}
      </fieldset>
      {error && <p className="hp-error" role="alert">{error}</p>}
      {blocked && <div className="hs-conflict"><button type="button" className="hp-btn" disabled={busy} onClick={() => void consult()}>Consultar versión actual</button>
        {current && <p>Estado actual: {PREREG_STATES[current.estado]} · Revisión {current.revision}. Lo que escribiste se conserva; cierra esta ventana y actualiza la lista antes de iniciar otra operación.</p>}</div>}
      <footer className="hp-dialog-footer"><button type="button" className="hp-btn" disabled={busy} onClick={close} data-autofocus>{blocked ? 'Cerrar' : 'Volver'}</button>
        <button type="submit" className="hp-btn hp-btn-primary" disabled={busy || blocked || !allowed}>{busy ? 'Guardando…' : action === 'correct' ? 'Guardar correcciones' : 'Confirmar'}</button></footer>
    </form>
  </PanelDialog>;
}
