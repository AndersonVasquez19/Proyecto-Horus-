import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { errorMessage, panelRequest, PanelApiError } from '../services/panelApi';
import { notify } from '../services/notify';
import { MAX_SLOTS, WEEK_DAYS, describeSlot, draftFrom, emptySlot, hasScheduleErrors, parseSchedule, scheduleChanged, scheduleErrors, schedulePayload, serverScheduleIssue, sortSlots, type DraftSlot, type ScheduleErrors, type ScheduleResult } from '../services/schedules';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import PanelDialog from './PanelDialog';
import PanelIcon from './PanelIcon';

const UNREADABLE = 'No se pudo interpretar la respuesta del servidor. Reintenta.';
const NO_ERRORS: ScheduleErrors = { rows: {}, general: '' };

// Horarios recurrentes de una edición. El PUT reemplaza el conjunto completo con la `revision` de la edición: ante un 409 el borrador se
// conserva, se bloquea el reenvío y la persona decide si adopta la versión actual. Nunca se reintenta una escritura por sí sola.
export default function EditionSchedules({ editionId, editionName, onClose, onSaved }: { editionId: number; editionName: string; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [loaded, setLoaded] = useState<ScheduleResult | null>(null), [rows, setRows] = useState<DraftSlot[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0);
  const [errors, setErrors] = useState<ScheduleErrors>(NO_ERRORS), [error, setError] = useState('');
  const [saving, setSaving] = useState(false), [blocked, setBlocked] = useState(false), [remote, setRemote] = useState<ScheduleResult | null>(null), [reading, setReading] = useState(false);
  const locked = useRef(false), mounted = useRef(true), controller = useRef<AbortController | null>(null);
  const writable = !!loaded && loaded.convocatoria.modificable && can(PANEL_ACTIONS.editarHorarios);
  const dirty = !!loaded && scheduleChanged(rows, loaded.items);
  const { confirmLeave, clear } = useUnsavedChangesControl(dirty, 'los horarios de la edición');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    let live = true; const request = new AbortController(); const timer = window.setTimeout(() => request.abort(), 15000);
    panelRequest<unknown>('convocatorias/' + editionId + '/horarios', token, 'GET', undefined, request.signal)
      .then(result => { if (!live) return; const parsed = parseSchedule(result); if (!parsed) throw new Error(UNREADABLE); setLoaded(parsed); setRows(draftFrom(parsed.items)); setLoadError(''); })
      .catch(err => { if (live) setLoadError(request.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); })
      .finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); request.abort(); };
  }, [editionId, token, reload]);
  const close = () => { if (!locked.current && !reading) confirmLeave(() => { clear(); onClose(); }); };
  const edit = (key: string, patch: Partial<DraftSlot>) => { setRows(prev => prev.map(row => row.key === key ? { ...row, ...patch } : row)); setErrors(prev => ({ ...prev, rows: { ...prev.rows, [key]: '' } })); };
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!loaded || !writable || locked.current || blocked) return;
    const next = scheduleErrors(rows); setErrors(next); setError(''); if (hasScheduleErrors(next)) return;
    locked.current = true; setSaving(true);
    const request = new AbortController(); controller.current = request; const timer = window.setTimeout(() => request.abort(), 20000);
    try {
      const result = parseSchedule(await panelRequest<unknown>('convocatorias/' + editionId + '/horarios', token, 'PUT', schedulePayload(rows, loaded.convocatoria.revision), request.signal));
      if (!result) throw new Error('No se pudo confirmar el resultado. Consulta los horarios antes de repetir.');
      if (!mounted.current) return;
      notify.success(result.cambios === false ? 'Los horarios ya estaban así: no hubo cambios.' : 'Horarios guardados.');
      clear(); onSaved();
    } catch (err) {
      if (!mounted.current) return;
      const status = err instanceof PanelApiError ? err.status : 0;
      if (status === 422) {
        const issue = serverScheduleIssue((err as PanelApiError).body, rows);
        setErrors({ rows: issue?.rows ?? {}, general: '' }); setError(issue?.message ?? (err as PanelApiError).message); return;
      }
      if (status === 409) { setBlocked(true); setError((err as PanelApiError).message + ' Tus cambios se conservan: consulta la versión actual antes de decidir.'); return; }
      if (status >= 400 && status < 500) { setError(errorMessage(err)); return; }
      setBlocked(true); setError('No se pudo confirmar el resultado. Conserva el borrador y consulta la versión actual antes de repetir. No se reintentará automáticamente.');
    } finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setSaving(false); }
  };
  const consult = async () => {
    if (reading) return; setReading(true); setError('');
    const request = new AbortController(); controller.current = request; const timer = window.setTimeout(() => request.abort(), 15000);
    try { const parsed = parseSchedule(await panelRequest<unknown>('convocatorias/' + editionId + '/horarios', token, 'GET', undefined, request.signal)); if (!parsed) throw new Error(UNREADABLE); if (mounted.current) setRemote(parsed); }
    catch (err) { if (mounted.current) setError(request.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); }
    finally { window.clearTimeout(timer); if (mounted.current) setReading(false); }
  };
  // Descarta el borrador a propósito y adopta la versión consultada (con su revisión): es la única vía para volver a guardar tras un 409.
  const adopt = () => { if (!remote) return; setLoaded(remote); setRows(draftFrom(remote.items)); setRemote(null); setBlocked(false); setError(''); setErrors(NO_ERRORS); };
  const taken = new Set(rows.map(row => row.key));
  const rowError = (key: string) => errors.rows[key] && taken.has(key) ? errors.rows[key] : '';
  return <PanelDialog title={'Horarios · ' + editionName} onClose={close} busy={saving || reading} className="he-schedules" lockScroll>
    <form onSubmit={save} noValidate aria-busy={saving || loading} data-schedule-form>
      {loading ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando horarios…</p></div>
        : loadError || !loaded ? <div className="hp-empty"><p className="hp-error" role="alert">{loadError || UNREADABLE}</p><button type="button" className="hp-btn" onClick={() => { setLoading(true); setReload(v => v + 1); }}>Reintentar</button></div>
          : <>
            <p className="hp-notice">Días y horas en que se dicta la edición cada semana (hora de Lima). No son clases individuales.</p>
            {!loaded.convocatoria.modificable && <p className="hp-notice" role="status">Esta edición está {loaded.convocatoria.archivada ? 'archivada' : 'cancelada'}: los horarios solo se pueden consultar.</p>}
            {loaded.convocatoria.modificable && !writable && <p className="hp-notice" role="status">Tu cuenta puede consultar los horarios, pero no modificarlos.</p>}
            {rows.length === 0 ? <div className="hp-empty he-schedule-empty"><PanelIcon name="calendar" size={28} /><h3>Sin horarios definidos</h3><p>{writable ? 'Agrega el primer horario de esta edición.' : 'Esta edición todavía no tiene horarios.'}</p></div>
              : <ol className="he-schedule-list" aria-label="Horarios de la edición">{rows.map((row, index) => {
                const message = rowError(row.key), describedBy = message ? 'schedule-error-' + row.key : undefined;
                return <li key={row.key} className={'he-schedule-row' + (message ? ' has-error' : '')}>
                  {writable ? <fieldset disabled={saving || blocked}><legend className="hp-sr">Horario {index + 1}</legend>
                    <label>Día<select name="dia_semana" value={row.dia_semana} onChange={e => edit(row.key, { dia_semana: e.target.value })} aria-invalid={!!message} aria-describedby={describedBy}>{Object.entries(WEEK_DAYS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Hora de inicio<input name="hora_inicio" type="time" step={60} required value={row.hora_inicio} onChange={e => edit(row.key, { hora_inicio: e.target.value })} aria-invalid={!!message} aria-describedby={describedBy} /></label>
                    <label>Hora de fin<input name="hora_fin" type="time" step={60} required value={row.hora_fin} onChange={e => edit(row.key, { hora_fin: e.target.value })} aria-invalid={!!message} aria-describedby={describedBy} /></label>
                    <button type="button" className="hp-btn" aria-label={'Quitar horario ' + (index + 1)} onClick={() => { setRows(prev => prev.filter(item => item.key !== row.key)); }}><PanelIcon name="trash" />Quitar</button>
                  </fieldset> : <p className="he-schedule-readonly"><strong>{WEEK_DAYS[Number(row.dia_semana)]}</strong> · {row.hora_inicio} a {row.hora_fin}</p>}
                  {message && <small id={'schedule-error-' + row.key} className="hs-field-error">{message}</small>}
                </li>;
              })}</ol>}
            {writable && <div className="he-schedule-tools"><button type="button" className="hp-btn" disabled={saving || blocked || rows.length >= MAX_SLOTS} onClick={() => setRows(prev => [...prev, emptySlot()])}><PanelIcon name="plus" />Agregar horario</button><span>{rows.length} de {MAX_SLOTS} horarios</span>{rows.length > 1 && <button type="button" className="hp-btn" disabled={saving || blocked} onClick={() => setRows(prev => sortSlots(prev))}>Ordenar por día</button>}</div>}
            {writable && dirty && rows.length === 0 && <p className="hp-notice" role="status">Al guardar, la edición quedará sin horarios.</p>}
            {errors.general && <p className="hp-error" role="alert">{errors.general}</p>}
            {error && <p className="hp-error" role="alert">{error}</p>}
            {blocked && <div className="hs-conflict">
              <button type="button" className="hp-btn" disabled={reading} onClick={() => void consult()}>{reading ? 'Consultando…' : 'Consultar versión actual'}</button>
              {remote && <><dl className="hp-details"><div><dt>Versión actual · revisión {remote.convocatoria.revision}</dt><dd>{remote.items.length ? <ul>{remote.items.map(item => <li key={item.id}>{describeSlot(item)}</li>)}</ul> : 'Sin horarios.'}</dd></div></dl>
                <button type="button" className="hp-btn" onClick={adopt}>Usar la versión actual y descartar mi borrador</button></>}
              <p>Tu borrador se conserva hasta que decidas. No se guarda nada sin tu confirmación.</p>
            </div>}
          </>}
      <footer className="hp-dialog-footer"><button type="button" className="hp-btn" disabled={saving || reading} onClick={close}>{writable ? 'Cancelar' : 'Cerrar'}</button>{writable && <button type="submit" className="hp-btn hp-btn-primary" disabled={saving || blocked || !dirty}>{saving ? 'Guardando…' : 'Guardar horarios'}</button>}</footer>
    </form>
  </PanelDialog>;
}
