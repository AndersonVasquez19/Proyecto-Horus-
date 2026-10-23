import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { chatRequest, internalPath, type ChatReply, type ChatTurn } from './chatApi';
import './chatbot.css';
import ChatIcon from './ChatIcon';
import RobotMascot from './RobotMascot';

const greeting: ChatTurn = {
  role: 'assistant',
  content: '¡Hola! Soy el asistente de Horus. ¿En qué te puedo ayudar?',
};

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([greeting]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(''); // pregunta cuyo envío falló: se ofrece reenviarla, sin reintento automático
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState('Información del catálogo');
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const hasOpened = useRef(false);

  useEffect(() => {
    if (open) { dialog.current?.showModal(); hasOpened.current = true; }
    else { dialog.current?.close(); if (hasOpened.current) launcher.current?.focus(); }
  }, [open]);
  useEffect(() => {
    if (!closing) return;
    const finish = () => {
      setOpen(false); setClosing(false);
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timer = window.setTimeout(finish, media.matches ? 0 : 240);
    media.addEventListener('change', finish, { once: true });
    return () => { window.clearTimeout(timer); media.removeEventListener('change', finish); };
  }, [closing]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = turns.length === 1 ? 0 : log.current.scrollHeight;
  }, [turns, busy, open]);
  useEffect(() => () => controller.current?.abort(), []);
  // En pantallas táctiles no se enfoca el campo solo: abriría el teclado y taparía la respuesta recién recibida.
  const focusInput = () => { if (!window.matchMedia('(pointer: coarse)').matches) input.current?.focus(); };
  useEffect(() => {
    if (open && !busy) focusInput();
  }, [open, busy]);
  // Con el teclado en pantalla el navegador reduce el área visible: el diálogo se ajusta para que el campo y el botón de envío no queden tapados.
  useEffect(() => {
    const viewport = window.visualViewport, node = dialog.current;
    if (!open || !viewport || !node) return;
    const fit = () => { if (window.innerWidth <= 480) node.style.setProperty('--hc-vvh', Math.round(viewport.height) + 'px'); else node.style.removeProperty('--hc-vvh'); };
    fit(); viewport.addEventListener('resize', fit);
    return () => { viewport.removeEventListener('resize', fit); node.style.removeProperty('--hc-vvh'); };
  }, [open]);

  const close = () => { if (!closing) setClosing(true); };
  const reset = () => {
    if (locked.current) return;
    setTurns([greeting]); setMessage(''); setError(''); setSuccess(''); setRetry('');
    setMode('Información del catálogo');
    focusInput();
  };
  const send = async (text = message) => {
    const question = text.trim();
    if (!question || question.length > 1000 || locked.current) return;
    locked.current = true; setBusy(true); setError(''); setSuccess(''); setRetry('');
    const before = turns;
    setTurns(previous => [...previous, { role: 'user', content: question }]);
    setMessage('');
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 22000);
    try {
      const response = await chatRequest<ChatReply>('message', {
        message: question,
        history: before.filter(turn => turn !== greeting).slice(-6).map(({ role, content }) => ({ role, content })),
      }, abort.signal);
      setTurns(previous => [...previous, { role: 'assistant' as const, content: response.answer, sources: response.sources, suggestions: response.suggestions }].slice(-30));
      setSuccess(response.notice || '');
      setMode(response.mode === 'ia' ? 'Respuesta asistida por IA' : 'Información del catálogo');
    } catch (err) {
      // Una consulta no escribe nada: es seguro devolver el texto al campo y ofrecer reenviarla (una sola vez por clic).
      setTurns(before); setMessage(question); setRetry(question);
      setError(abort.signal.aborted ? 'La consulta tardó demasiado. Puedes volver a enviarla.' : err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      window.clearTimeout(timeout); locked.current = false; setBusy(false); focusInput();
    }
  };
  return <>
    <button ref={launcher} type="button" className="hc-launcher" onClick={() => setOpen(true)} aria-label="Abrir chat con el asistente Horus" aria-haspopup="dialog" aria-expanded={open} aria-controls="horus-chat">
      <span className="hc-launcher-hint" aria-hidden="true">¿En qué te ayudo?</span>
      <span className="hc-launcher-orbit" aria-hidden="true" />
      <RobotMascot />
      <span className="hc-launcher-badge" aria-hidden="true"><ChatIcon name="chat" size={16} /></span>
    </button>
    <dialog ref={dialog} id="horus-chat" className={'hc-dialog' + (closing ? ' is-closing' : '')} aria-labelledby="hc-title"
      onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) {
        const bounds = dialog.current.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      } }}>
      <div className="hc-shell">
        <header className="hc-header">
          <span className="hc-mark"><RobotMascot portrait /></span>
          <div className="hc-header-copy"><span className="hc-header-brand">HORUS GROUP</span><h2 id="hc-title">Asistente Horus</h2><p>Cursos, tecnología y orientación</p></div>
          <button type="button" className="hc-close" aria-label="Cerrar chat" onClick={close}><ChatIcon name="close" size={18} /></button>
        </header>
        {turns.length > 1 && <div className="hc-toolbar"><span><i aria-hidden="true" />{mode}</span><button onClick={reset} disabled={busy}><ChatIcon name="reset" size={12} />Nueva conversación</button></div>}
        <div ref={log} className="hc-log" role="log" aria-label="Conversación con Horus" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
          {turns.map((turn, index) => <article key={index} className={'hc-message hc-' + turn.role}>
            <strong>{turn.role === 'assistant' && <span className="hc-message-avatar"><RobotMascot portrait /></span>}{turn.role === 'user' ? 'Tú' : 'Horus'}</strong><p>{turn.content}</p>
            {!!turn.sources?.length && <details className="hc-sources"><summary>Información consultada ({turn.sources.length})</summary>
              {turn.sources.map(source => { const href = internalPath(source.href); return <div key={source.id}><strong>{source.title}</strong><p>{source.text}</p>{href && <Link to={href} onClick={close}>Ver en el sitio</Link>}</div>; })}
            </details>}
          </article>)}
          {busy && <p className="hc-thinking" role="status"><span className="hc-thinking-dots" aria-hidden="true"><i /><i /><i /></span>Consultando información…</p>}
        </div>
        <div className="hc-compose">
          <div className="hc-compose-heading"><label htmlFor="hc-question">Escribe tu consulta</label><span id="hc-question-limit">{message.length} / 1000</span></div>
          <form onSubmit={event => { event.preventDefault(); void send(); }}>
            <textarea ref={input} id="hc-question" placeholder="¿Qué te gustaría saber?" value={message} rows={1} maxLength={1000} disabled={busy} aria-describedby="hc-question-limit hc-question-help" onChange={event => setMessage(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault(); event.currentTarget.form?.requestSubmit();
              }
            }} />
            <button type="submit" disabled={busy || !message.trim()} aria-label="Enviar consulta"><ChatIcon name="send" size={18} /></button>
          </form>
          <p className="hc-compose-help" id="hc-question-help">Enter para enviar <span>· Shift + Enter para otra línea</span></p>
        </div>
        {error && <p className="hc-error" role="alert">{error} {!!retry && <button type="button" className="hc-retry" disabled={busy} onClick={() => void send(retry)}>Reintentar consulta</button>} <Link to="/contactos" onClick={close}>Ir a Contacto</Link></p>}
        {success && <p className="hc-success" role="status">{success}</p>}
        <footer className="hc-footer"><details><summary><ChatIcon name="lock" size={11} />Tu privacidad importa · Ver detalles</summary><p>Evita compartir datos sensibles en el chat. Si el asistente no puede responder, guarda tu pregunta (con correos, teléfonos y enlaces ocultos) durante 90 días solo para mejorar sus respuestas. Si la IA está habilitada, OpenAI procesa la consulta y el contexto reciente. <Link to="/politicas/privacidad" onClick={close}>Política de privacidad</Link></p></details></footer>
      </div>
    </dialog>
  </>;
}
