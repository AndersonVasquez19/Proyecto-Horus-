import { useRequestStatus } from '../hooks/useRequestStatus';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { panelRequest, errorMessage } from '../services/panelApi';
import { notify } from '../services/notify';
import PanelIcon from './PanelIcon';
import { useUnsavedChanges } from '../unsaved/unsavedContext';
import { useLatest } from '../hooks/useLatest';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { PanelReadOnlyNotice } from './PanelAccessNotice';
type Setting = { clave: string; valor: string; descripcion: string; grupo: string };
export default function PanelSettings() {
  const { token } = useAdminAuth();
  // Sin configuracion:editar (E3.4.3, fase 2) los datos se muestran en modo consulta, sin guardar ni restablecer.
  const canEdit = usePanelAccess().can(PANEL_ACTIONS.editarConfiguracion);
  const latestToken = useLatest(token);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [reload, setReload] = useState(0);
  const { loading, error, setLoading, setError } = useRequestStatus(JSON.stringify([reload]));
  // Hay cambios cuando algún valor difiere del último guardado o cargado; guardar (setSettings) los iguala y limpia el aviso.
  const dirty = settings.some(s => (values[s.clave] ?? s.valor) !== s.valor);
  const confirmLeave = useUnsavedChanges(dirty, "información de la empresa");
  useEffect(() => {
    const controller = new AbortController();
    panelRequest<{ settings: Setting[] }>('settings', latestToken.current!, 'GET', undefined, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setSettings(data.settings); setValues(Object.fromEntries(data.settings.map(s => [s.clave, s.valor])));
    }).catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [latestToken, reload, setLoading, setError]);
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (lock.current) return;
    if (!canEdit) { setError('Tu cuenta no tiene permiso para realizar esta acción.'); return; }
    lock.current = true; setSaving(true); setError('');
    try {
      await panelRequest('settings', token!, 'PUT', { ajustes: values });
      setSettings(previous => previous.map(s => ({ ...s, valor: values[s.clave] })));
      notify.success('La información de la empresa se guardó correctamente.');
    } catch (err) { setError(errorMessage(err)); }
    finally { lock.current = false; setSaving(false); }
  };
  return <><div className="hp-heading"><div><p className="hp-kicker">ADMINISTRACIÓN</p><h1>Información de la empresa</h1><p>Mantén tus datos de contacto y redes actualizados.</p></div><button className="hp-btn" disabled={loading || saving} onClick={() => confirmLeave(() => setReload(n => n + 1))}><PanelIcon name="refresh" />Recargar</button></div>
    {!canEdit && <PanelReadOnlyNotice>Modo consulta: tu cuenta puede ver la información de la empresa, pero no modificarla.</PanelReadOnlyNotice>}
    {error && <p className="hp-error" role="alert">{error}</p>}
    {loading ? <div className="hp-empty" role="status">Cargando configuración…</div> : <form onSubmit={save}>
      {[...new Set(settings.map(s => s.grupo))].map(group => <section className="hp-card hp-settings-card" key={group}><div className="hp-card-heading"><div><p className="hp-kicker">DATOS INSTITUCIONALES</p><h2 className="hp-capitalize">{group}</h2></div><PanelIcon name="settings" /></div><fieldset className="hp-form-grid" disabled={saving || !canEdit}><legend className="hp-sr">{group}</legend>
        {settings.filter(s => s.grupo === group).map(s => <label key={s.clave}>{s.descripcion || s.clave}<input value={values[s.clave] || ''} onChange={e => setValues(prev => ({ ...prev, [s.clave]: e.target.value }))} /></label>)}</fieldset></section>)}
      {canEdit && settings.length > 0 && <div className="hp-settings-save"><button type="button" className="hp-btn" disabled={saving} onClick={() => setValues(Object.fromEntries(settings.map(s => [s.clave, s.valor])))}>Restablecer cambios</button><button className="hp-btn hp-btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar configuración'}<PanelIcon name="check" /></button></div>}
      {!settings.length && !error && <div className="hp-empty"><p>No hay ajustes disponibles.</p></div>}
    </form>}
  </>;
}
