import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { errorMessage, panelRequest, PanelApiError } from '../services/panelApi';
import { EMPTY_EDITION, editionForm, editionErrors, editionPayload, EDITION_STATES, type Edition, type EditionForm } from '../services/editions';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import PanelDialog from './PanelDialog';
import EditionCourseSelect from './EditionCourseSelect';

export default function EditionEditor({ original, onClose, onSaved }: { original: Edition | null; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const writable = can(original ? 'convocatorias:editar' : 'convocatorias:crear');
  const [form, setForm] = useState<EditionForm>(() => original ? editionForm(original) : { ...EMPTY_EDITION });
  const [errors, setErrors] = useState<Partial<Record<keyof EditionForm, string>>>({}), [error, setError] = useState('');
  const [saving, setSaving] = useState(false), [blocked, setBlocked] = useState(false), [current, setCurrent] = useState<Edition | null>(null), [reading, setReading] = useState(false);
  const locked = useRef(false), mounted = useRef(true), controller = useRef<AbortController | null>(null);
  const initial = original ? editionForm(original) : EMPTY_EDITION;
  const { confirmLeave, clear } = useUnsavedChangesControl(JSON.stringify(form) !== JSON.stringify(initial), 'el formulario de edición académica');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const close = () => { if (!locked.current && !reading) confirmLeave(() => { clear(); onClose(); }); };
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!writable || locked.current || blocked) return;
    const next = editionErrors(form, original); setErrors(next); if (Object.keys(next).length) return;
    locked.current = true; setSaving(true); setError('');
    const request = new AbortController(); controller.current = request; const timer = window.setTimeout(() => request.abort(), 20000);
    try {
      const result = await panelRequest<{ item: Edition }>('convocatorias' + (original ? '/' + original.id : ''), token, original ? 'PUT' : 'POST', editionPayload(form, original?.revision, original), request.signal);
      if (!result.item?.id || !result.item.revision) throw new Error('No se pudo confirmar el resultado. Consulta la lista antes de repetir.');
      if (mounted.current) { clear(); onSaved(); }
    } catch (err) {
      if (!mounted.current) return;
      const uncertain = !(err instanceof PanelApiError) || err.status >= 500 || err.status < 400;
      const conflict = err instanceof PanelApiError && err.status === 409 && !/nombre/.test(err.message);
      setBlocked(uncertain || conflict);
      setError(uncertain ? 'No se pudo confirmar el resultado. Conserva el borrador y revisa la lista antes de repetir. No se reintentará automáticamente.' : errorMessage(err));
    } finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setSaving(false); }
  };
  const consult = async () => {
    if (!original || reading) return; setReading(true);
    const request = new AbortController(); controller.current = request; const timer = window.setTimeout(() => request.abort(), 15000);
    try { const result = await panelRequest<{ item: Edition }>('convocatorias/' + original.id, token, 'GET', undefined, request.signal); if (mounted.current) setCurrent(result.item); }
    catch (err) { if (mounted.current) setError(errorMessage(err)); }
    finally { window.clearTimeout(timer); if (mounted.current) setReading(false); }
  };
  return <PanelDialog title={original ? 'Editar edición' : 'Crear edición'} onClose={close} busy={saving || reading} lockScroll>
    <form onSubmit={save} noValidate aria-busy={saving} data-edition-form>
      {!original && <p className="hp-notice">Se creará como planificada. Podrás abrirla cuando confirmes sus datos.</p>}
      {original && (!original.fecha_inicio || !original.fecha_fin || original.capacidad === null) && <p className="hp-notice">Esta edición anterior puede conservar sus datos sin definir. Completa fechas y capacidad antes de abrirla.</p>}
      <fieldset className="hp-form-grid" disabled={saving || !writable}>
        <legend className="hp-sr">Datos de la edición académica</legend>
        <EditionCourseSelect value={form.curso_id} selected={original?.curso} disabled={!!original || saving || blocked || !writable} onChange={value => setForm(prev => ({ ...prev, curso_id: value }))} error={errors.curso_id} />
        {(['nombre', 'fecha_inicio', 'fecha_fin', 'capacidad'] as const).map(key => <label key={key}>{({ nombre: 'Nombre de la edición', fecha_inicio: 'Fecha de inicio', fecha_fin: 'Fecha de fin', capacidad: 'Capacidad máxima' })[key]}{(!original || original[key] !== null) && <span className="hp-required"> *</span>}
          <input name={key} readOnly={blocked} type={key === 'capacidad' ? 'number' : key.startsWith('fecha') ? 'date' : 'text'} value={form[key]} required={!original || original[key] !== null} maxLength={key === 'nombre' ? 160 : undefined} min={key === 'capacidad' ? 1 : key.startsWith('fecha') ? '1000-01-01' : undefined} max={key === 'capacidad' ? 2147483647 : key.startsWith('fecha') ? '9999-12-31' : undefined} step={key === 'capacidad' ? 1 : undefined}
            onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? 'edition-error-' + key : undefined} />
          {errors[key] && <small id={'edition-error-' + key} className="hs-field-error">{errors[key]}</small>}</label>)}
      </fieldset>
      {error && <p className="hp-error" role="alert">{error}</p>}
      {blocked && original && <div className="hs-conflict"><button type="button" className="hp-btn" disabled={reading} onClick={() => void consult()}>Consultar versión actual</button>{current && <dl className="hp-details"><div><dt>Versión actual · revisión {current.revision}</dt><dd>{current.nombre} · {current.curso.titulo}</dd></div><div><dt>Fechas y capacidad</dt><dd>{current.fecha_inicio || 'Sin definir'} → {current.fecha_fin || 'Sin definir'} · {current.capacidad ?? 'Sin definir'} cupos</dd></div><div><dt>Estado</dt><dd>{EDITION_STATES[current.estado]}{current.archivado_at ? ' · Archivada' : ''}</dd></div></dl>}<p>Tu borrador se conserva. Copia lo necesario y vuelve a abrir la edición para trabajar con su revisión vigente.</p></div>}
      <footer className="hp-dialog-footer"><button type="button" className="hp-btn" disabled={saving || reading} onClick={close}>Cancelar</button>{writable && <button type="submit" className="hp-btn hp-btn-primary" disabled={saving || blocked}>{saving ? 'Guardando…' : original ? 'Guardar cambios' : 'Crear edición'}</button>}</footer>
    </form>
  </PanelDialog>;
}
