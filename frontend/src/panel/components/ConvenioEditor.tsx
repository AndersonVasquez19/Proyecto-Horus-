import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { panelRequest, errorMessage } from '../services/panelApi';
import type { ConvenioDetalle, ConvenioResponse } from '../../types/convenios';
import PanelDialog from './PanelDialog';
import { useUnsavedChanges } from '../unsaved/unsavedContext';
import ImageUpload from './ImageUpload';
import ConvenioPhotosEditor from './ConvenioPhotosEditor';
import PublicImage from '../../components/PublicImage';

// `allow` (E3.4.3, fase 2): crear un convenio exige crear; guardar uno existente y gestionar sus fotos, editar; subir imágenes,
// archivos:crear. Sin el permiso de guardar, el editor se abre en modo consulta.
export default function ConvenioEditor({ initial, onClose, onSaved, allow }: {
  initial: ConvenioDetalle | null; onClose: () => void; onSaved: () => void; allow: { create: boolean; edit: boolean; upload: boolean };
}) {
  const { token } = useAdminAuth();
  const formId = useId();
  const [item, setItem] = useState(initial);
  const [fields, setFields] = useState(() => ({
    nombre: initial?.nombre || '', sigla: initial?.sigla || '', logo_url: initial?.logo_url || '',
    descripcion_corta: initial?.descripcion_corta || '', descripcion_completa: initial?.descripcion_completa || '',
    informacion_adicional: initial?.informacion_adicional || '', orden: String(initial?.orden || 0), visible: initial?.visible ?? false,
  }));
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [photosBusy, setPhotosBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const readOnly = !(item ? allow.edit : allow.create);
  const locked = busy || uploading || photosBusy;
  // Los datos del convenio difieren de lo abierto o de lo último guardado: cerrar el editor pide confirmación.
  const [baseline, setBaseline] = useState(() => JSON.stringify(fields));
  const confirmLeave = useUnsavedChanges(JSON.stringify(fields) !== baseline, 'convenio');
  const requestClose = () => confirmLeave(onClose);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  const text = (name: keyof Omit<typeof fields, 'visible'>, value: string) => setFields(v => ({ ...v, [name]: value }));
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (locked || controller.current) return;
    if (readOnly) { setError('Tu cuenta no tiene permiso para realizar esta acción.'); return; }
    const c = new AbortController(); controller.current = c;
    const timeout = window.setTimeout(() => c.abort(), 15000);
    setBusy(true); setError(''); setNotice('');
    const sentFields = JSON.stringify(fields); // lo enviado: una edición posterior mientras guarda sigue contando como cambio
    try {
      const response = await panelRequest<ConvenioResponse>('convenios' + (item ? '/' + item.id : ''), token, item ? 'PUT' : 'POST',
        { ...fields, orden: Number(fields.orden) }, c.signal);
      if (!c.signal.aborted) { setBaseline(sentFields); setItem(response.item); setNotice('Convenio guardado correctamente.'); onSaved(); }
    } catch (e) { if (controller.current === c) setError(c.signal.aborted ? 'La operación tardó demasiado. Revisa el listado antes de reintentar.' : errorMessage(e)); }
    finally { window.clearTimeout(timeout); if (controller.current === c) { controller.current = null; setBusy(false); } }
  };
  return <PanelDialog title={readOnly ? 'Detalle del convenio' : item ? 'Editar convenio' : 'Nuevo convenio'} busy={locked} onClose={requestClose}
    className="hp-convenio-dialog" lockScroll footer={<>
      <div className="hp-convenio-feedback">
        {error && <p className="hp-error" role="alert">{error}</p>}
        {notice && <p className="hp-notice" role="status">{notice}</p>}
      </div>
      <div className="hp-convenio-actions">
        {!readOnly && <button type="submit" form={formId} className="hp-btn hp-btn-primary" disabled={locked} aria-busy={busy}>{busy ? 'Guardando…' : 'Guardar convenio'}</button>}
        <button type="button" className="hp-btn" disabled={locked} onClick={requestClose}>Cerrar</button>
      </div>
    </>}>
    <form id={formId} className="hp-form hp-convenio-form" onSubmit={submit}>
      <div className="hp-convenio-editor-scroll">
        <fieldset disabled={locked || readOnly}>
          <label>Nombre<input name="nombre" required maxLength={160} value={fields.nombre} onChange={e => text('nombre', e.target.value)} /></label>
          <label>Sigla<input name="sigla" maxLength={50} value={fields.sigla} onChange={e => text('sigla', e.target.value)} /></label>
          <section className="hp-convenio-logo-section hp-full" aria-labelledby={formId + '-logo'}>
            <h3 id={formId + '-logo'}>Logo</h3>
            <div className="hp-convenio-logo-field">
              <span className="hp-convenio-logo-preview"><PublicImage src={fields.logo_url} title={'Logo de ' + (fields.nombre || 'este convenio')} /></span>
              {!readOnly && <div className="hp-convenio-logo-controls">
                {allow.upload && <ImageUpload buttonLabel={fields.logo_url ? 'Cambiar logo' : 'Subir logo'} onUploaded={url => text('logo_url', url)} onBusyChange={setUploading} />}
                <button type="button" className="hp-btn" disabled={!fields.logo_url} onClick={() => text('logo_url', '')}>Quitar logo</button>
              </div>}
            </div>
            <details className="hp-convenio-logo-link"><summary>Usar un enlace existente</summary>
              <label>URL del logo<input name="logo_url" type="text" inputMode="url" maxLength={2048} value={fields.logo_url} onChange={e => text('logo_url', e.target.value)} /></label>
            </details>
          </section>
          <label className="hp-full">Descripción corta<textarea name="descripcion_corta" required maxLength={2000} rows={3}
            aria-describedby={formId + '-short-help'} value={fields.descripcion_corta} onChange={e => text('descripcion_corta', e.target.value)} />
            <small id={formId + '-short-help'}>Resumen que aparece en las tarjetas de Convenios en Home.</small></label>
          <label className="hp-full">Descripción completa<textarea name="descripcion_completa" maxLength={20000} rows={5}
            aria-describedby={formId + '-full-help'} value={fields.descripcion_completa} onChange={e => text('descripcion_completa', e.target.value)} />
            <small id={formId + '-full-help'}>Texto amplio para el detalle del convenio. Si queda vacío, se mostrará la descripción corta.</small></label>
          <label className="hp-full">Información adicional<textarea name="informacion_adicional" maxLength={20000} rows={4}
            aria-describedby={formId + '-additional-help'} value={fields.informacion_adicional} onChange={e => text('informacion_adicional', e.target.value)} />
            <small id={formId + '-additional-help'}>Beneficios, vigencia, condiciones u otros datos institucionales confirmados. Es opcional.</small></label>
          <label className="hp-convenio-setting">Orden<input name="orden" type="number" required min={0} max={1000000} step={1}
            aria-describedby={formId + '-order-help'} value={fields.orden} onChange={e => text('orden', e.target.value)} />
            <small id={formId + '-order-help'}>Los números menores aparecen primero.</small></label>
          <label className="hp-convenio-setting hp-convenio-visibility-control">
            <span><input name="visible" type="checkbox" aria-describedby={formId + '-visible-help'} checked={fields.visible}
              onChange={e => setFields(v => ({ ...v, visible: e.target.checked }))} />Visible en Home</span>
            <small id={formId + '-visible-help'}>{fields.visible ? 'Se mostrará en el sitio público al guardar.' : 'Permanecerá oculto. Puedes completar sus datos antes de publicarlo.'}</small>
          </label>
        </fieldset>
        {item ? <ConvenioPhotosEditor key={item.id} convenioId={item.id} nombre={fields.nombre} initialFotos={item.fotos} disabled={busy || uploading} readOnly={!allow.edit} canUpload={allow.upload}
          onBusyChange={setPhotosBusy} /> :
          <section className="hp-convenio-photos" aria-labelledby={formId + '-photos'}>
            <h3 id={formId + '-photos'}>Fotografías</h3>
            <p>Guarda el convenio para habilitar la carga de sus fotografías aquí.</p>
          </section>}
      </div>
    </form>
  </PanelDialog>;
}
