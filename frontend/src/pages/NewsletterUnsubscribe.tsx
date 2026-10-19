import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { publicRequest } from '../api';
import { classifyWriteError, writeErrorMessage } from '../publicErrors';

const SUBMIT_TIMEOUT_MS = 25_000; // igual que Contactos
const INVALID_LINK = 'Este enlace de baja no es válido o ya venció. Solicita la baja desde Contactos.';
const UNCONFIRMED = 'No pudimos confirmar tu baja. Es posible que sigas suscrito: inténtalo nuevamente o contacta con el equipo.';

// Nunca se afirma que la baja se hizo si el servidor no lo confirmó: todo fallo aclara que sigue sin confirmarse.
function unsubscribeError(error: unknown, timedOut: boolean) {
  const { kind, uncertain } = classifyWriteError(error, timedOut);
  if (uncertain) return UNCONFIRMED;
  if (kind === 'badRequest' || kind === 'notFound') return INVALID_LINK;
  return writeErrorMessage(error, timedOut) + ' Tu baja aún no está confirmada.';
}

export default function NewsletterUnsubscribe(){
 const [params]=useSearchParams();const token=(params.get('token')||'').trim();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 const locked=useRef(false),controller=useRef<AbortController|null>(null),message=useRef<HTMLParagraphElement>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{if(error||done)message.current?.focus()},[error,done]);
 const unsubscribe=async()=>{
  if(locked.current||done)return;
  locked.current=true;setBusy(true);setError('');
  const abort=new AbortController();controller.current=abort;let timedOut=false;
  const timer=window.setTimeout(()=>{timedOut=true;abort.abort()},SUBMIT_TIMEOUT_MS);
  try{
   await publicRequest<{ok?:boolean}>('newsletter/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:abort.signal});
   setDone(true); // el servidor respondió 200: la baja quedó confirmada (repetirla también responde 200)
  }catch(e){
   if(abort.signal.aborted&&!timedOut)return;
   setError(unsubscribeError(e,timedOut));
  }finally{window.clearTimeout(timer);locked.current=false;if(controller.current===abort)controller.current=null;setBusy(false)}
 };
 return <section className="public-catalog-detail"><h1>Cancelar suscripción</h1><p>Confirma que deseas dejar de recibir novedades.</p>{token?<button className="btn-coral" disabled={busy||done} aria-busy={busy} onClick={()=>void unsubscribe()}>{busy?'Procesando…':'Dar de baja mi suscripción'}</button>:<p role="status">El enlace está incompleto. Solicita la baja desde Contactos.</p>}{error&&<p ref={message} tabIndex={-1} role="alert">{error}</p>}{done&&<p ref={message} tabIndex={-1} role="status">Tu suscripción fue cancelada. Ya no recibirás novedades.</p>}<p><Link to="/contactos?asunto=Baja%20de%20suscripción">Contactar con el equipo</Link></p></section>;
}
