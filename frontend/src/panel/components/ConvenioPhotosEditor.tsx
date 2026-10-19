import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { panelRequest, errorMessage } from '../services/panelApi';
import type { ConvenioFoto } from '../../types/convenios';
import ImageUpload from './ImageUpload';
import PanelIcon from './PanelIcon';
import PublicImage from '../../components/PublicImage';

// readOnly: sin convenios:editar solo se muestran las fotos; canUpload: archivos:crear (E3.4.3, fase 2).
export default function ConvenioPhotosEditor({ convenioId, nombre, initialFotos, disabled, onBusyChange, readOnly = false, canUpload = true }: {
  convenioId: number; nombre: string; initialFotos: ConvenioFoto[]; disabled: boolean; onBusyChange: (busy: boolean) => void; readOnly?: boolean; canUpload?: boolean;
}) {
  const { token } = useAdminAuth();
  const [fotos, setFotos] = useState(initialFotos), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [removing, setRemoving] = useState<number | null>(null);
  const action = useRef<AbortController | null>(null);
  const list = useRef(initialFotos);
  const uploadActive = useRef(false);
  const locked = disabled || busy || uploading;
  useEffect(() => () => { action.current?.abort(); action.current = null; }, []);
  const commit = (value: ConvenioFoto[]) => { list.current = value; setFotos(value); };
  const run = async (operation: (signal: AbortSignal) => Promise<void>, propagateError = false) => {
    if (action.current) return false;
    if (readOnly) { setError('Tu cuenta no tiene permiso para modificar las fotografías.'); if (propagateError) throw new Error('Tu cuenta no tiene permiso para modificar las fotografías.'); return false; }
    const c = new AbortController(); action.current = c;
    const timeout = window.setTimeout(() => c.abort(), 15000);
    setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try { await operation(c.signal); return !c.signal.aborted; }
    catch (e) {
      const message = c.signal.aborted ? 'La operación tardó demasiado. Cierra y vuelve a abrir el convenio para comprobar sus fotos.' : errorMessage(e);
      if (action.current === c) setError(message);
      if (propagateError) throw c.signal.aborted ? new Error(message) : e;
      return false;
    }
    finally {
      window.clearTimeout(timeout);
      if (action.current === c) { action.current = null; setBusy(false); onBusyChange(uploadActive.current); }
    }
  };
  const add = async (url: string) => {
    const ok = await run(async signal => {
      const order = Math.max(-1, ...list.current.map(f => f.orden)) + 1;
      const response = await panelRequest<{ item: ConvenioFoto }>('convenios/' + convenioId + '/fotos', token, 'POST', { imagen_url: url, orden: order }, signal);
      if (!signal.aborted) { commit([...list.current, response.item]); setNotice('Fotografía agregada.'); }
    }, true);
    if (!ok) throw new Error('No se pudo asociar la fotografía. Revisa el mensaje de la sección Fotografías.');
  };
  const move = (index: number, step: number) => void run(async signal => {
    const next = [...fotos], other = index + step;
    [next[index], next[other]] = [next[other], next[index]];
    // Normaliza la secuencia para resolver también órdenes empatados.
    const normalized = next.map((foto, orden) => ({ ...foto, orden }));
    await panelRequest('convenios/' + convenioId + '/fotos/orden', token, 'PUT', { fotos: normalized.map(({ id, orden }) => ({ id, orden })) }, signal);
    if (!signal.aborted) { commit(normalized); setNotice('Orden de fotografías guardado.'); }
  });
  const remove = (id: number) => void run(async signal => {
    await panelRequest('convenios/' + convenioId + '/fotos/' + id, token, 'DELETE', undefined, signal);
    if (!signal.aborted) { commit(fotos.filter(f => f.id !== id)); setRemoving(null); setNotice('Fotografía retirada. El archivo físico se conserva.'); }
  });
  return <section className="hp-convenio-photos" aria-labelledby="convenio-photos-title">
    <div className="hp-convenio-photos-heading"><h3 id="convenio-photos-title">Fotografías</h3><span className="hp-count">{fotos.length}</span></div>
    <p className="hp-convenio-help">{readOnly ? 'Fotografías de «' + nombre + '».' : 'Fotografías de «' + nombre + '». Se guardan al subirlas; Guardar convenio actualiza sus datos.'}</p>
    {!readOnly && canUpload && <ImageUpload multiple buttonLabel="Subir fotografías" disabled={disabled || busy} onUploaded={add} onBusyChange={value => { uploadActive.current = value; setUploading(value); onBusyChange(value || !!action.current); }} />}
    {error && <p role="alert" className="hp-error">{error}</p>}{notice && <p role="status" className="hp-notice">{notice}</p>}
    {!fotos.length && <p>No hay fotografías asociadas.</p>}
    <ol className="hp-convenio-photo-grid">{fotos.map((foto, index) => <li key={foto.id}>
      <span className="hp-convenio-photo-image"><PublicImage src={foto.imagen_url} title={'Fotografía ' + (index + 1) + ' de ' + nombre} /></span><strong className="hp-convenio-photo-caption">Fotografía {index + 1}</strong>
      {!readOnly && <div className="hp-convenio-actions"><button type="button" className="hp-icon-btn" disabled={locked || index === 0}
        aria-label={'Mover fotografía ' + (index + 1) + ' antes'} onClick={() => move(index, -1)}><span className="hp-photo-up"><PanelIcon name="arrow" /></span></button>
        <button type="button" className="hp-icon-btn" disabled={locked || index === fotos.length - 1}
          aria-label={'Mover fotografía ' + (index + 1) + ' después'} onClick={() => move(index, 1)}><span className="hp-photo-down"><PanelIcon name="arrow" /></span></button>
        <button type="button" className="hp-icon-btn" disabled={locked} aria-label={'Quitar fotografía ' + (index + 1)} onClick={() => setRemoving(foto.id)}><PanelIcon name="trash" /></button></div>}
      {!readOnly && removing === foto.id && <div className="hp-convenio-photo-confirm"><p>¿Retirar esta fotografía del convenio?</p><button type="button" className="hp-btn" disabled={locked} onClick={() => remove(foto.id)}>Confirmar retirada</button>
        <button type="button" className="hp-btn" disabled={locked} onClick={() => setRemoving(null)}>Cancelar</button></div>}
    </li>)}</ol>
  </section>;
}
