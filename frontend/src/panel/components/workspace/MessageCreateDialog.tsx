import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../../context';
import { useUnsavedChangesControl } from '../../unsaved/unsavedContext';
import { PanelApiError, panelRequest } from '../../services/panelApi';
import { MESSAGE_FIELDS, buildMessagePayload, emptyMessageForm, findPossibleDuplicates, hasMessageDraft } from '../../services/messageCreate';
import { dateLabel, type CollectionResponse } from './useCollection';
import { recordsOf } from '../../services/listRecords';
import type { Row } from '../../types/workspace';
import PanelDialog from '../PanelDialog';
import PanelIcon from '../PanelIcon';

const CREATE_TIMEOUT_MS = 20_000;
const CHECK_TIMEOUT_MS = 15_000;
// Un fallo de red, un timeout o un 5xx no prueban que la consulta no se registró: el servidor pudo crearla y perderse solo la respuesta.
const UNCERTAIN = 'No pudimos confirmar si la consulta se registró: puede que el servidor la haya creado y solo se haya perdido la respuesta. Tu borrador se conserva.';

// 'idle': sin dudas. 'uncertain': un envío anterior no tiene resultado; un nuevo envío exige comprobar y confirmar. 'confirming': esperando la confirmación expresa.
type Phase = 'idle' | 'uncertain' | 'confirming';
type Check = { state: 'idle' | 'loading' | 'done' | 'error'; matches: Row[] };

// Registro manual de una consulta dentro de la bandeja. Usa los campos de MESSAGE_FIELDS (messageCreate.ts) y el mismo POST administrativo que el formulario
// genérico anterior. El éxito solo se anuncia cuando el servidor lo confirma. El backend no ofrece idempotencia: tras un resultado incierto el
// formulario NO repite el POST por sí solo; permite comprobar la bandeja y exige una confirmación explícita que advierte del posible duplicado.
export default function MessageCreateDialog({ onClose, onCreated, onUncertain }: { onClose: () => void; onCreated: (message: Row | undefined) => void; onUncertain?: () => void }) {
  const { token } = useAdminAuth();
  const [form, setForm] = useState(emptyMessageForm);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle'), [uncertainCount, setUncertainCount] = useState(0);
  const [check, setCheck] = useState<Check>({ state: 'idle', matches: [] });
  const lock = useRef(false), alive = useRef(true), controller = useRef<AbortController | null>(null);
  const noticeBox = useRef<HTMLDivElement>(null), backButton = useRef<HTMLButtonElement>(null), checkController = useRef<AbortController | null>(null);
  const dirty = hasMessageDraft(form);
  const { confirmLeave, clear } = useUnsavedChangesControl(dirty, 'registro manual de consulta');
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); checkController.current?.abort(); }; }, []);
  // El foco acompaña al aviso: al entrar en duda va al aviso; al pedir confirmación, a la opción segura «Volver».
  useEffect(() => { if (phase === 'confirming') backButton.current?.focus(); else if (phase === 'uncertain') noticeBox.current?.focus(); }, [phase, uncertainCount]);
  const close = () => { if (lock.current) return; confirmLeave(onClose); };

  const post = async () => {
    if (lock.current) return; // un solo envío pendiente, aunque lleguen dos eventos seguidos
    lock.current = true; setBusy(true); setError(''); setPhase(current => current === 'confirming' ? 'uncertain' : current);
    const request = new AbortController(); controller.current = request;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; request.abort(); }, CREATE_TIMEOUT_MS);
    try {
      const saved = await panelRequest<{ message?: Row }>('messages', token, 'POST', buildMessagePayload(form), request.signal);
      if (!alive.current) return;
      clear(); // libera el aviso de cambios sin guardar de forma síncrona: cerrar no debe chocar con el bloqueo de navegación
      onCreated(saved.message);
    } catch (caught) {
      if (!alive.current) return;
      // Solo un rechazo explícito del servidor (4xx) significa que no se registró nada. Red, timeout, 5xx o una respuesta ilegible son inciertos.
      if (caught instanceof PanelApiError && caught.status >= 400 && caught.status < 500 && !timedOut) setError(caught.message);
      else { setPhase('uncertain'); setUncertainCount(count => count + 1); onUncertain?.(); }
    } finally {
      window.clearTimeout(timer);
      if (controller.current === request) controller.current = null;
      lock.current = false; if (alive.current) setBusy(false);
    }
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === 'uncertain') { setPhase('confirming'); return; } // nunca se repite el POST sin pasar por la confirmación
    if (phase === 'idle') void post();
  };
  const checkInbox = async () => {
    if (check.state === 'loading') return;
    const request = new AbortController(); checkController.current = request;
    const timer = window.setTimeout(() => request.abort(), CHECK_TIMEOUT_MS);
    setCheck({ state: 'loading', matches: [] });
    try {
      const data = await panelRequest<CollectionResponse>('messages?' + new URLSearchParams({ page: '1', limit: '20', search: form.email.trim() }), token, 'GET', undefined, request.signal);
      if (alive.current) setCheck({ state: 'done', matches: findPossibleDuplicates(recordsOf<Row>('messages', data), form) });
    } catch { if (alive.current) setCheck({ state: 'error', matches: [] }); }
    finally { window.clearTimeout(timer); }
  };

  return <PanelDialog title="Registro manual de consulta" busy={busy} onClose={close}>
    <form onSubmit={submit} aria-busy={busy}>
      <fieldset className="hp-form-grid" disabled={busy}><legend className="hp-sr">Datos de la consulta</legend>
        {MESSAGE_FIELDS.map((field, index) => {
          const id = 'manual-message-' + field.key, required = !!field.required;
          const common = { id, value: form[field.key as keyof typeof form] ?? '', required, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const value = event.target.value; setForm(previous => ({ ...previous, [field.key]: value })); } };
          return <label key={field.key} className={field.type === 'textarea' ? 'hp-full' : ''} htmlFor={id}>{field.label}{required && <span className="hp-required"> *</span>}
            {field.type === 'textarea' ? <textarea {...common} rows={4} maxLength={field.max} />
              : <input {...common} type={field.type || 'text'} maxLength={field.max} pattern={field.pattern} data-autofocus={index === 0 ? true : undefined} />}
          </label>;
        })}
      </fieldset>
      {phase !== 'idle' && <div ref={noticeBox} tabIndex={-1} role="alert" className="hp-error" data-create-uncertain={phase}>
        <p>{UNCERTAIN}</p>
        {check.state === 'idle' && <p>Antes de volver a registrarla, comprueba si ya aparece en la bandeja.</p>}
        {check.state === 'loading' && <p role="status">Comprobando la bandeja…</p>}
        {check.state === 'error' && <p>No pudimos consultar la bandeja. Puedes reintentarlo.</p>}
        {check.state === 'done' && (check.matches.length
          ? <><p>Encontramos {check.matches.length === 1 ? 'una consulta' : check.matches.length + ' consultas'} con el mismo correo, asunto y mensaje. Es posible que ya se haya registrado, pero no podemos asegurar que sea esta solicitud:</p>
            <ul data-create-matches>{check.matches.map(row => <li key={row.id}>#{row.id} · {String(row.asunto)} · {dateLabel(row.createdAt)}</li>)}</ul></>
          : <p>No encontramos entre las consultas más recientes una con ese correo, asunto y mensaje. Eso no garantiza que no se haya creado: puede tardar en aparecer.</p>)}
        {phase === 'confirming'
          ? <><p><strong>Si la solicitud anterior sí llegó, registrar otra vez creará una consulta duplicada.</strong></p>
            <div className="hp-actions"><button type="button" ref={backButton} className="hp-btn hp-btn-primary" disabled={busy} onClick={() => setPhase('uncertain')}>Volver</button>
              <button type="button" className="hp-btn hp-btn-danger" disabled={busy} onClick={() => void post()}>Registrar de todos modos</button></div></>
          : <div className="hp-actions"><button type="button" className="hp-btn" disabled={busy || check.state === 'loading'} onClick={() => void checkInbox()}>{check.state === 'idle' ? 'Comprobar en la bandeja' : 'Comprobar de nuevo'}</button></div>}
      </div>}
      <div className="hp-dialog-footer">
        {error && <p className="hp-error hp-footer-error" role="alert">{error}</p>}
        <button type="button" className="hp-btn" disabled={busy} onClick={close}>Cancelar</button>
        <button className="hp-btn hp-btn-primary" disabled={busy || phase === 'confirming'}>{busy ? 'Guardando…' : phase === 'idle' ? 'Registrar consulta' : 'Registrar de nuevo…'}<PanelIcon name="check" /></button>
      </div>
    </form>
  </PanelDialog>;
}
