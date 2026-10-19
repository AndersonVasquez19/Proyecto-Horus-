import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Link } from 'react-router-dom';
import { chatRequest, internalPath, type ChatReply, type ChatTurn } from './chatApi';
import './chatbot.css';
import GuidedMenu from './GuidedMenu';
import ChatIcon from './ChatIcon';
import RobotMascot from './RobotMascot';
import { writeErrorMessage } from '../../publicErrors';
import { contactSummary, followUpQuestions } from './chatContext';

const greeting: ChatTurn = {
  role: 'assistant',
  content: '¡Hola! Soy el asistente de Horus. Te ayudo a consultar cursos, servicios y preguntas frecuentes. ¿Qué estás buscando?',
};
const initialContact = { nombre: '', email: '', telefono: '', asunto: '', mensaje: '', consentimiento: false };

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(true);
  const [menuVersion, setMenuVersion] = useState(0);
  const [turns, setTurns] = useState<ChatTurn[]>([greeting]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(''); // pregunta cuyo envío falló: se ofrece reenviarla (solo consultas; las solicitudes de contacto nunca se reintentan solas)
  const [contactOpen, setContactOpen] = useState(false);
  const [contact, setContact] = useState(initialContact);
  const [quote, setQuote] = useState(false); // la solicitud actual pide una cotización (se registra como Contacto con origen chatbot)
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState('Información del catálogo');
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
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
  }, [turns, busy, open, menuOpen]);
  useEffect(() => () => controller.current?.abort(), []);
  // En pantallas táctiles no se enfoca el campo solo: abriría el teclado y taparía la respuesta recién recibida.
  const focusInput = () => { if (!window.matchMedia('(pointer: coarse)').matches) input.current?.focus(); };
  useEffect(() => {
    if (open && !busy && !contactOpen && !menuOpen) focusInput();
  }, [open, busy, contactOpen, menuOpen]);
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
    setMenuOpen(true); setMenuVersion(value => value + 1);
    setContact(initialContact); setContactOpen(false); setMode('Información del catálogo');
    focusInput();
  };
  const send = async (text = message) => {
    const question = text.trim();
    if (!question || question.length > 1000 || locked.current) return;
    locked.current = true; setBusy(true); setError(''); setSuccess(''); setRetry('');
    setMenuOpen(false);
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
  const startContact = (topic?: string, asQuote = false) => {
    setError(''); setSuccess(''); setQuote(asQuote);
    setContact(previous => ({ ...previous,
      asunto: asQuote ? (topic ? 'Cotización: ' + topic : 'Solicitud de cotización').slice(0, 140) : topic ? ('Consulta: ' + topic).slice(0, 140) : previous.asunto || 'Consulta desde el asistente',
      mensaje: topic ? (asQuote ? 'Quisiera una cotización para: ' : 'Quisiera información sobre: ') + topic : previous.mensaje || [...turns].reverse().find(turn => turn.role === 'user')?.content || '',
    }));
    setContactOpen(true);
  };
  const submitContact = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current || !contact.consentimiento) return;
    locked.current = true; setBusy(true); setError('');
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 22000);
    try {
      const response = await chatRequest<{ ok: boolean; id: number }>('contact', { ...contact, tipo: quote ? 'cotizacion' : 'contacto' }, abort.signal);
      setSuccess(quote ? 'Solicitud de cotización #' + response.id + ' registrada. El equipo de Horus preparará la propuesta y te contactará; no es una compra ni una reserva.' : 'Solicitud #' + response.id + ' registrada. El equipo de Horus podrá contactarte.');
      setContact(initialContact); setContactOpen(false); setQuote(false);
    } catch (err) {
      // Escritura: si el resultado es incierto (tiempo agotado, red caída, 200 ilegible) se advierte antes de reenviar; nunca se reintenta solo.
      setError(writeErrorMessage(err, abort.signal.aborted));
    } finally { window.clearTimeout(timeout); locked.current = false; setBusy(false); }
  };

  const summary = contactSummary(turns);
  const last = turns[turns.length - 1];
  const suggestions = last?.suggestions?.length ? last.suggestions : followUpQuestions(last);
  const includeSummary = () => {
    const combined = [contact.mensaje.trim(), summary].filter(Boolean).join('\n\n');
    if (combined.length > 5000) { setError('El resumen supera el límite. Reduce tu consulta antes de añadirlo.'); return; }
    setContact(previous => ({ ...previous, mensaje: combined })); setError('');
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
          <div className="hc-header-copy"><span className="hc-header-brand">HORUS GROUP</span><h2 id="hc-title">Asistente Horus</h2><p>Un poco de ayuda. Muchas posibilidades.</p></div>
          <button type="button" className="hc-close" aria-label="Cerrar chat" onClick={close}><ChatIcon name="close" size={18} /></button>
        </header>
        <div className="hc-toolbar"><span><i aria-hidden="true" />{mode}</span><button onClick={reset} disabled={busy}><ChatIcon name="reset" size={12} />Nueva conversación</button></div>
        {contactOpen ? <div className="hc-contact">
          <button type="button" className="hc-back" onClick={() => { setContactOpen(false); setError(''); }} disabled={busy}>← Volver al chat</button>
          <h3>{quote ? 'Solicita tu cotización' : 'Hablemos de lo que necesitas'}</h3><p>{quote ? 'Cuéntanos qué necesitas y autoriza que nuestro equipo te contacte con una propuesta. No es una compra ni una reserva.' : 'Revisa tu consulta y autoriza que nuestro equipo te contacte.'}</p>
          <p className="hc-data-note" id="hc-data-note"><strong>¿Qué datos pedimos y para qué?</strong> Tu nombre, correo, teléfono y el mensaje, solo para que el equipo de Horus responda esta solicitud. Quedan en la bandeja de mensajes del equipo; no se inscribe, reserva ni compra nada y no se envía ningún correo automático.</p>
          <form onSubmit={submitContact} aria-describedby="hc-data-note">
            <fieldset disabled={busy}>
              <label>Nombre<input autoFocus required maxLength={100} autoComplete="name" value={contact.nombre} onChange={e => setContact({ ...contact, nombre: e.target.value })} /></label>
              <label>Correo<input required type="email" maxLength={254} autoComplete="email" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></label>
              <label>Teléfono<input required type="tel" maxLength={30} pattern="(?=.*\d)[+\(\)\d\s.\-]+" autoComplete="tel" value={contact.telefono} onChange={e => setContact({ ...contact, telefono: e.target.value })} /></label>
              <label>Asunto<input required maxLength={140} value={contact.asunto} onChange={e => setContact({ ...contact, asunto: e.target.value })} /></label>
              <label>Tu consulta<textarea required maxLength={5000} rows={3} value={contact.mensaje} onChange={e => setContact({ ...contact, mensaje: e.target.value })} /></label>
              {summary && <div className="hc-summary"><button className="hc-back" type="button" disabled={contact.mensaje.includes(summary)} onClick={includeSummary}>{contact.mensaje.includes(summary) ? 'Resumen añadido' : 'Añadir mis últimas consultas'}</button><p>Se añadirán hasta cuatro preguntas al texto de arriba. Puedes revisarlas y editarlas antes de enviar.</p></div>}
              <label className="hc-consent"><input type="checkbox" required checked={contact.consentimiento} onChange={e => setContact({ ...contact, consentimiento: e.target.checked })} /><span>Autorizo a Horus a usar estos datos para atender mi consulta. <Link to="/politicas/privacidad" onClick={close}>Ver privacidad</Link>.</span></label>
              <button className="hc-submit" type="submit">{busy ? 'Registrando…' : quote ? 'Enviar solicitud de cotización' : 'Enviar solicitud'}</button>
            </fieldset>
          </form>
        </div> : <>
          <div ref={log} className="hc-log" role="log" aria-label="Conversación con Horus" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
            {turns.length === 1 && <div className="hc-welcome">
              <div className="hc-welcome-art" aria-hidden="true"><span className="hc-welcome-halo" /><RobotMascot /><span className="hc-welcome-spark hc-welcome-spark-one">✦</span><span className="hc-welcome-spark hc-welcome-spark-two">✦</span><span className="hc-welcome-hello">¡Hola!</span></div>
              <span className="hc-eyebrow">TU ASISTENTE VIRTUAL</span>
              <h3>¿Qué hacemos <span>hoy?</span></h3>
              <p>Encuentra tu próximo curso o la solución que tu proyecto necesita.</p>
            </div>}
            {(turns.length === 1 ? [] : turns).map((turn, index) => <article key={index} className={'hc-message hc-' + turn.role}>
              <strong>{turn.role === 'assistant' && <span className="hc-message-avatar"><RobotMascot portrait /></span>}{turn.role === 'user' ? 'Tú' : 'Horus'}</strong><p>{turn.content}</p>
              {!!turn.sources?.length && <details className="hc-sources"><summary>Información consultada ({turn.sources.length})</summary>
                {turn.sources.map(source => { const href = internalPath(source.href); return <div key={source.id}><strong>{source.title}</strong><p>{source.text}</p>{href && <Link to={href} onClick={close}>Ver en el sitio</Link>}</div>; })}
              </details>}
            </article>)}
            {busy && <p className="hc-thinking" role="status"><span className="hc-thinking-dots" aria-hidden="true"><i /><i /><i /></span>Consultando información…</p>}
            {menuOpen && <GuidedMenu key={menuVersion}
              onAnswer={(question, answer) => {
                setTurns(previous => [...previous, { role: 'user' as const, content: question }, answer].slice(-30));
                setMode('Información del catálogo'); setError(''); setSuccess(''); setMenuOpen(false);
              }}
              onContact={startContact}
              onAsk={question => void send(question)}
              onWrite={() => { setMenuOpen(false); input.current?.focus(); }}
            />}
          </div>
          <div className="hc-compose">
            {!menuOpen && !busy && !!suggestions.length && <div className="hc-followups" role="group" aria-label="Preguntas sugeridas">{suggestions.map(question => <button key={question} type="button" onClick={() => void send(question)}>{question}</button>)}</div>}
            {!menuOpen && <button type="button" className="hc-menu-return" disabled={busy} onClick={() => setMenuOpen(true)}><ChatIcon name="menu" size={13} />Volver al menú</button>}
            <form onSubmit={event => { event.preventDefault(); void send(); }}>
              <label className="hc-sr" htmlFor="hc-question">Escribe tu consulta</label>
              <input ref={input} id="hc-question" placeholder="¿Cómo podemos ayudarte?" value={message} maxLength={1000} disabled={busy} onChange={event => setMessage(event.target.value)} />
              <button type="submit" disabled={busy || !message.trim()} aria-label="Enviar consulta"><ChatIcon name="send" size={18} /></button>
            </form>
            <div className="hc-actions" role="group" aria-label="Hablar con el equipo de Horus">
              <button type="button" className="hc-handoff hc-handoff-quote" onClick={() => startContact(undefined, true)} disabled={busy}><ChatIcon name="tools" size={15} />Solicitar cotización</button>
              <button type="button" className="hc-handoff" onClick={() => startContact()} disabled={busy}><ChatIcon name="person" size={15} />Solicitar atención del equipo</button>
            </div>
          </div>
        </>}
        {error && <p className="hc-error" role="alert">{error} {!!retry && !contactOpen && <button type="button" className="hc-retry" disabled={busy} onClick={() => void send(retry)}>Reintentar consulta</button>} <Link to="/contactos" onClick={close}>Ir a Contacto</Link></p>}
        {success && <p className="hc-success" role="status">{success}</p>}
        <footer className="hc-footer"><details><summary><ChatIcon name="lock" size={11} />Tu privacidad importa · Ver detalles</summary><p>Evita compartir datos sensibles en el chat. Si el asistente no puede responder, guarda tu pregunta (con correos, teléfonos y enlaces ocultos) durante 90 días solo para mejorar sus respuestas. Si la IA está habilitada, OpenAI procesa la consulta y el contexto reciente. <Link to="/politicas/privacidad" onClick={close}>Política de privacidad</Link></p></details></footer>
      </div>
    </dialog>
  </>;
}
