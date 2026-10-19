import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../../context';
import { PanelApiError, panelRequest } from '../../services/panelApi';
import { label, type Row } from '../../types/workspace';
import PanelDialog from '../PanelDialog';
import PanelIcon from '../PanelIcon';

const DELETE_TIMEOUT_MS = 20_000;
const CHECK_TIMEOUT_MS = 15_000;
// El backend responde 409 tanto si hay seguimiento como si hay cotizaciones vinculadas (no distingue la causa): el texto no inventa cuál de las dos.
const BLOCKED = 'El servidor no permite eliminar esta consulta porque tiene seguimiento o cotizaciones vinculadas. Se conserva intacta y no se borró nada más. Si solo quieres quitarla de tu trabajo diario, archívala.';
const UNCERTAIN = 'No pudimos confirmar si la consulta se eliminó: puede que el servidor ya la haya borrado. No des por hecho que sigue existiendo; comprueba su estado antes de volver a intentarlo.';

type Result = { kind: 'blocked' | 'uncertain' | 'error' | 'still'; text: string };

// Eliminación protegida de una consulta. Respeta el contrato del backend (DELETE /admin/messages/:id, sin cascada ni borrado de seguimientos).
// Archivar se ofrece como alternativa y la confirmación enfoca la opción segura. Un 404 cuenta como «ya no existe» (por ejemplo, tras un reintento del navegador).
export default function MessageDeleteDialog({ message, onClose, onDeleted, onArchive }: {
  message: Row; onClose: () => void; onDeleted: (kind: 'deleted' | 'gone') => void; onArchive?: () => void;
}) {
  const { token } = useAdminAuth();
  const [busy, setBusy] = useState(false), [result, setResult] = useState<Result | null>(null);
  const lock = useRef(false), alive = useRef(true), controller = useRef<AbortController | null>(null), resultBox = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (result) resultBox.current?.focus(); }, [result]); // el aviso recibe el foco: los botones se deshabilitan mientras se envía
  const hasActivity = String(message.estado) !== 'nuevo';

  const remove = async () => {
    if (lock.current) return; // un solo DELETE pendiente
    lock.current = true; setBusy(true); setResult(null);
    const request = new AbortController(); controller.current = request;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; request.abort(); }, DELETE_TIMEOUT_MS);
    try {
      await panelRequest('messages/' + message.id, token, 'DELETE', undefined, request.signal);
      if (alive.current) onDeleted('deleted');
    } catch (caught) {
      if (!alive.current) return;
      if (caught instanceof PanelApiError && caught.status === 404 && !timedOut) onDeleted('gone');
      else if (caught instanceof PanelApiError && caught.status === 409) setResult({ kind: 'blocked', text: BLOCKED });
      else if (caught instanceof PanelApiError && caught.status >= 400 && caught.status < 500 && !timedOut) setResult({ kind: 'error', text: caught.message });
      else setResult({ kind: 'uncertain', text: UNCERTAIN }); // red, timeout, 5xx o respuesta ilegible: el servidor pudo haberla borrado
    } finally {
      window.clearTimeout(timer);
      if (controller.current === request) controller.current = null;
      lock.current = false; if (alive.current) setBusy(false);
    }
  };
  const check = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const request = new AbortController(); controller.current = request;
    const timer = window.setTimeout(() => request.abort(), CHECK_TIMEOUT_MS);
    try {
      await panelRequest('messages/' + message.id, token, 'GET', undefined, request.signal);
      if (alive.current) setResult({ kind: 'still', text: 'La consulta sigue existiendo en el servidor. Puedes intentar eliminarla de nuevo o conservarla.' });
    } catch (caught) {
      if (!alive.current) return;
      if (caught instanceof PanelApiError && caught.status === 404) onDeleted('gone');
      else setResult({ kind: 'uncertain', text: 'No pudimos comprobar si la consulta sigue existiendo. ' + UNCERTAIN });
    } finally {
      window.clearTimeout(timer);
      if (controller.current === request) controller.current = null;
      lock.current = false; if (alive.current) setBusy(false);
    }
  };
  const close = () => { if (!lock.current) onClose(); };

  return <PanelDialog title="Eliminar consulta" busy={busy} onClose={close}>
    <div className="hp-confirm"><PanelIcon name="trash" size={34} /><h3>{String(message.asunto)}</h3><p>{String(message.nombre)} · Consulta #{message.id}</p></div>
    <p>Eliminar quita la consulta de forma definitiva. El sistema puede impedirlo si tiene seguimiento o cotizaciones vinculadas: en ese caso se conserva y no se borra ningún otro registro, seguimiento ni historial.</p>
    {hasActivity && <p>Esta consulta ya tiene el estado «{label(message.estado)}», así que es probable que tenga seguimiento. Es solo una pista: únicamente el servidor decide si puede eliminarse.</p>}
    <p><strong>Si solo quieres dejar de verla en tu trabajo diario, archívala:</strong> podrás reabrirla cuando quieras. Los cambios sin guardar de esta consulta se perderán si la eliminas.</p>
    {result && <div ref={resultBox} tabIndex={-1} role="alert" className={result.kind === 'still' ? 'hp-notice' : 'hp-error'} data-delete-result={result.kind}>
      <p>{result.text}</p>
      {result.kind === 'uncertain' && <div className="hp-actions"><button type="button" className="hp-btn" disabled={busy} onClick={() => void check()}>Comprobar si sigue existiendo</button></div>}
    </div>}
    <div className="hp-dialog-footer">
      {onArchive && String(message.estado) !== 'archivado' && <button type="button" className="hp-btn" disabled={busy} onClick={onArchive}>Archivar en su lugar</button>}
      <button type="button" className="hp-btn hp-btn-primary" data-autofocus disabled={busy} onClick={close}>Cancelar</button>
      <button type="button" className="hp-btn hp-btn-danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Procesando…' : result?.kind === 'uncertain' || result?.kind === 'still' ? 'Intentar eliminar de nuevo' : 'Eliminar definitivamente'}</button>
    </div>
  </PanelDialog>;
}
