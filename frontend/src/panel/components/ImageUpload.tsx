import { useEffect, useId, useRef, useState } from 'react';
import { API_BASE } from '../../apiBase';
import { useAdminAuth } from '../context';
import { PanelApiError } from '../services/panelApi';
import { reportAccessDenied, reportExpiredSession } from '../context/sessionEvents';
import { ACCESS_DENIED } from '../context/sessionRefresh';

type UploadResult = { name: string; state: 'pending' | 'uploading' | 'success' | 'error'; message?: string };

export default function ImageUpload({ onUploaded, multiple = false, disabled = false, onBusyChange, buttonLabel }: {
  onUploaded: (url: string) => void | Promise<void>; multiple?: boolean; disabled?: boolean;
  onBusyChange?: (busy: boolean) => void; buttonLabel?: string;
}) {
  const { token } = useAdminAuth();
  const inputId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [results, setResults] = useState<UploadResult[]>([]);
  const controller = useRef<AbortController | null>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  const upload = async (files: File[]) => {
    if (!files.length || disabled || controller.current) return;
    const batch = new AbortController(); controller.current = batch;
    setBusy(true); onBusyChange?.(true); setError('');
    setResults(files.map(file => ({ name: file.name, state: 'pending' })));
    const update = (index: number, state: UploadResult['state'], message?: string) =>
      setResults(previous => previous.map((result, i) => i === index ? { ...result, state, message } : result));
    try {
      for (const [index, file] of files.entries()) {
        if (batch.signal.aborted || controller.current !== batch) return;
        if (file.size > 5 * 1024 * 1024) {
          update(index, 'error', 'La imagen supera los 5 MB.');
          if (!multiple) setError('La imagen supera los 5 MB.');
          continue;
        }
        const request = new AbortController();
        const abort = () => request.abort();
        batch.signal.addEventListener('abort', abort, { once: true });
        const timeout = window.setTimeout(abort, 30000);
        let sessionExpired = false, denied = false;
        update(index, 'uploading');
        try {
          const body = new FormData(); body.append('file', file);
          const response = await fetch(API_BASE + '/admin/uploads', {
            method: 'POST', headers: { Authorization: 'Bearer ' + token }, body, signal: request.signal,
          });
          sessionExpired = response.status === 401;
          if (sessionExpired) reportExpiredSession(token);
          denied = response.status === 403; // sin permiso: mensaje uniforme, la sesión sigue abierta y el resto del lote no se envía
          if (denied) { reportAccessDenied(token); throw new Error(ACCESS_DENIED); }
          const data = await response.json() as { path?: string; message?: string | string[] };
          if (!response.ok || !data.path) throw new Error(Array.isArray(data.message) ? data.message.join(' · ') : data.message || 'No se pudo subir la imagen.');
          window.clearTimeout(timeout);
          if (batch.signal.aborted || controller.current !== batch) return;
          await onUploaded(API_BASE + data.path);
          if (batch.signal.aborted || controller.current !== batch) return;
          update(index, 'success');
        } catch (e) {
          if (batch.signal.aborted || controller.current !== batch) return;
          const message = request.signal.aborted ? 'La carga tardó demasiado.' : e instanceof Error ? e.message : 'No se pudo subir la imagen.';
          update(index, 'error', message);
          if (!multiple) setError(message);
          if (sessionExpired || denied || (e instanceof PanelApiError && e.status === 401)) break;
        } finally {
          window.clearTimeout(timeout);
          batch.signal.removeEventListener('abort', abort);
        }
      }
    } finally {
      if (controller.current === batch) {
        controller.current = null; setBusy(false); onBusyChange?.(false);
        if (input.current) input.current.value = '';
      }
    }
  };
  const Container = buttonLabel ? 'div' : 'span';
  return <Container className={buttonLabel ? 'hp-image-upload' : undefined}>
    <input ref={input} id={inputId} type="file" accept="image/png,image/jpeg,image/webp" multiple={multiple} hidden={!!buttonLabel}
      aria-label={multiple ? 'Subir fotografías PNG, JPEG o WebP' : 'Subir imagen PNG, JPEG o WebP'} disabled={busy || disabled}
      onChange={e => void upload(Array.from(e.target.files || []).slice(0, multiple ? undefined : 1))} />
    {buttonLabel && <button type="button" className="hp-btn" aria-controls={inputId} disabled={busy || disabled} onClick={() => input.current?.click()}>{buttonLabel}</button>}
    {busy && <span role="status">{multiple ? 'Subiendo fotografías…' : 'Subiendo imagen…'}</span>}
    {error && <span role="alert">{error}</span>}
    {multiple && results.length > 0 && <ul className="hp-upload-results" aria-live="polite" aria-label="Resultado de cada fotografía">
      {results.map((result, index) => <li key={index} className={'is-' + result.state}>
        <strong>{result.name}</strong>: {result.state === 'success' ? 'Agregada' : result.state === 'error' ? result.message : result.state === 'uploading' ? 'Subiendo…' : 'Pendiente'}
      </li>)}
    </ul>}
    <small>{multiple ? 'Hasta 5 MB por foto. Se guardan al completar cada carga.' : 'Hasta 5 MB. Elige la imagen, espera la carga y guarda el registro.'}</small>
  </Container>;
}
