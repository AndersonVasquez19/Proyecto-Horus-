import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAdminAuth } from '../context';
import { PanelApiError, panelRequest, errorMessage } from '../services/panelApi';
import { mailResultFromFailure, mailResultFromSuccess, type MailResult } from '../services/mailOutcome';
import { useRequestStatus } from '../hooks/useRequestStatus';
import type { Quote, QuoteInput } from '../types/quotes';
import { quoteTransitions, canMoveQuote } from '../types/quotes';
import QuoteForm from './QuoteForm';
import QuotePrint from './QuotePrint';
import PanelDialog from './PanelDialog';
import { notify } from '../services/notify';
import { label } from '../types/workspace';
import PanelIcon from './PanelIcon';
import '../styles/quotes.css';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { PanelReadOnlyNotice } from './PanelAccessNotice';
export default function PanelQuotes() {
 const {token}=useAdminAuth();
 // Operaciones según los permisos de la sesión (E3.4.3, fase 2). Pasar a «anulada» exige además anular y a «enviada» exige además enviar
 // (canMoveQuote, espejo del inventario del backend); ?contacto= (preparar desde una consulta) exige crear.
 const access=usePanelAccess();const canCreate=access.can(PANEL_ACTIONS.crearCotizacion),canEdit=access.can(PANEL_ACTIONS.editarCotizacion),canSend=access.can(PANEL_ACTIONS.enviarCotizacion),canVoid=access.can(PANEL_ACTIONS.anularCotizacion);
 const canMove=(target:string)=>canMoveQuote(target,{edit:canEdit,send:canSend,void:canVoid});const [params,setParams]=useSearchParams();const location=useLocation(),navigate=useNavigate();const fromState=(location.state as {from?:unknown}|null)?.from;const origin=typeof fromState==='string'&&/^\/admin\/[\w?=&%.-]*$/.test(fromState)?fromState:'';const [readOnlyForm,setReadOnlyForm]=useState(false);const [related,setRelated]=useState<{numero:string;estado:string}[]>([]);
 const [revision,setRevision]=useState(0),[page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[state,setState]=useState('');
 const [list,setList]=useState<{items:Quote[];pagination:{total:number;pages:number}}|null>(null);
 const [detail,setDetail]=useState<Quote|null>(null),[editing,setEditing]=useState<Quote|QuoteInput|null>(null),[creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[notice,setNotice]=useState(''),[mail,setMail]=useState<MailResult|null>(null);
 const mailBox=useRef<HTMLDivElement>(null),noSendButton=useRef<HTMLButtonElement>(null),sendButton=useRef<HTMLButtonElement>(null);
 // Con confirmación pendiente el foco va a la opción segura («No enviar»); si no, al aviso (los botones se deshabilitan mientras se envía).
 const focusMail=useRef(false); // el foco se mueve cuando los botones ya no están deshabilitados (aquí se sigue ocupado hasta releer el detalle)
 useEffect(()=>{if(mail&&focusMail.current&&!busy){focusMail.current=false;(mail.needsConfirm?noSendButton.current:mailBox.current)?.focus();}},[mail,busy]);
 const dismissMail=()=>{setMail(null);window.setTimeout(()=>sendButton.current?.focus(),0);};
 const lock=useRef(false);const key=[page,query,state,revision].join(':');
 const {loading,error,setLoading,setError}=useRequestStatus(key);
 useEffect(()=>{const ctrl=new AbortController();let current=true;
 const q=new URLSearchParams({page:String(page),limit:'12',search:query,estado:state});
 void panelRequest<{items:Quote[];pagination:{total:number;pages:number}}>('cotizaciones?'+q,token,'GET',undefined,ctrl.signal).then(data=>{if(current)setList(data)}).catch(e=>{if(current)setError(errorMessage(e))}).finally(()=>{if(current)setLoading(false)});
 return()=>{current=false;ctrl.abort();};},[page,query,state,revision,token,setLoading,setError]);
 const contactDenied=Number(params.get('contacto'))>0&&!canCreate;
 useEffect(()=>{const id=Number(params.get('contacto'));if(!id||!canCreate)return;const ctrl=new AbortController();
 void panelRequest<{message:{nombre:string;email:string;telefono:string}}>('messages/'+id,token,'GET',undefined,ctrl.signal).then(({message})=>{if(ctrl.signal.aborted)return;setEditing({cliente:message.nombre,email:message.email,telefono:message.telefono||'',documento:'',direccion:'',emisor:'',datos_emisor:'',moneda:'PEN',validez:new Date(Date.now()+7*86400000).toISOString().slice(0,10),condiciones:'',conceptos:[{descripcion:'',cantidad:1,precio:0}],descuento:0,tasa:18,contacto_id:id});setCreating(true);if(message.email)void panelRequest<{items:Quote[]}>('cotizaciones?'+new URLSearchParams({page:'1',limit:'20',search:message.email}),token,'GET',undefined,ctrl.signal).then(found=>{if(!ctrl.signal.aborted)setRelated(found.items.filter(q=>q.contacto_id===id).map(q=>({numero:q.numero,estado:q.estado})));}).catch(()=>{/* solo es una ayuda: sin ella el formulario funciona igual */});}).catch(e=>{if(!ctrl.signal.aborted)setActionError(errorMessage(e));});return()=>ctrl.abort();},[params,token,canCreate]);
 const refresh=()=>{setDetail(null);setRevision(v=>v+1);};
 const open=async(id:number)=>{if(lock.current)return;lock.current=true;setBusy(true);setActionError('');setMail(null);try{const data=await panelRequest<{item:Quote}>('cotizaciones/'+id,token);setDetail(data.item);}catch(e){setActionError(errorMessage(e));}finally{lock.current=false;setBusy(false);}};
 const status=async(value:string)=>{if(!detail||lock.current||!canMove(value))return;lock.current=true;setBusy(true);setActionError('');try{const data=await panelRequest<{item:Quote}>('cotizaciones/'+detail.id+'/estado',token,'POST',{estado:value,revision:detail.revision});setDetail(data.item);setRevision(v=>v+1);setNotice('Estado actualizado.');}catch(e){setActionError(errorMessage(e));}finally{lock.current=false;setBusy(false);}};
 // Un fallo de red, un timeout o un 5xx sin cuerpo no prueban que el correo no salió (ver services/mailOutcome.ts): se informa como incierto.
 // Un envío ya registrado exige confirmación explícita. Tras cualquier desenlace se relee el detalle: revisión e historial cambiaron.
 const email=async(confirmed=false)=>{if(!detail||lock.current||!canSend)return;const id=detail.id,ctrl=new AbortController(),timer=window.setTimeout(()=>ctrl.abort(),25000);
 lock.current=true;setBusy(true);setActionError('');setNotice('');setMail(null);let result:MailResult;
 try{result=mailResultFromSuccess(await panelRequest<unknown>('cotizaciones/'+id+'/correo',token,'POST',{revision:detail.revision,...(confirmed?{confirmar_reenvio:true}:{})},ctrl.signal));}
 catch(e){result=mailResultFromFailure(e instanceof PanelApiError?e:undefined);}
 finally{window.clearTimeout(timer);}
 setMail(result);focusMail.current=true;
 try{const fresh=await panelRequest<{item:Quote}>('cotizaciones/'+id,token);setDetail(current=>current&&current.id===id?fresh.item:current);}catch{/* el detalle se actualiza al reabrirlo */}
 finally{lock.current=false;setBusy(false);}};
 const closeForm=(saved=false)=>{setReadOnlyForm(false);setCreating(false);setEditing(null);setRelated([]);if(params.has('contacto')){if(saved!==true&&origin){navigate(origin,{replace:true});return;}const next=new URLSearchParams(params);next.delete('contacto');setParams(next,{replace:true});}};
 return <><div className="hp-heading"><div><p className="hp-kicker">GESTIÓN COMERCIAL</p><h1>Cotizaciones</h1><p>Prepara propuestas, revisa importes y registra su seguimiento.</p></div><div className="hp-actions">{canCreate&&<button className="hp-btn hp-btn-primary" onClick={()=>{setEditing(null);setCreating(true)}}>Nueva cotización</button>}<button className="hp-btn" onClick={refresh} disabled={busy||loading}>Actualizar</button></div></div>
 {contactDenied?<PanelReadOnlyNotice>Tu cuenta no puede crear cotizaciones. Se muestra el listado en modo consulta.</PanelReadOnlyNotice>:!canCreate&&!canEdit&&!canSend&&<PanelReadOnlyNotice>Modo consulta: tu cuenta puede ver las cotizaciones, pero no modificarlas ni enviarlas.</PanelReadOnlyNotice>}
 {notice&&<p role="status" className="hp-notice">{notice}</p>}{(error||actionError)&&<p role="alert" className="hp-error">{error||actionError}</p>}
 <section className="hp-card"><form className="hp-toolbar" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(search.trim())}}><div className="hp-search"><PanelIcon name="search"/><input type="search" aria-label="Buscar cotización" placeholder="Buscar cotización…" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="hp-btn">Buscar</button><select aria-label="Filtrar por estado" value={state} onChange={e=>{setState(e.target.value);setPage(1)}}><option value="">Todos los estados</option>{Object.keys(quoteTransitions).map(v=><option key={v} value={v}>{label(v)}</option>)}</select></form>
 {loading?<div role="status" className="hp-empty"><span className="hp-loading"/><p>Cargando cotizaciones…</p></div>:error?<div className="hp-empty"><p>No se pudieron cargar las cotizaciones.</p><button className="hp-btn" onClick={refresh}>Reintentar</button></div>:list?.items.length?<div className="hp-table-wrap"><table className="hp-table"><caption className="hp-sr">Cotizaciones registradas, de la más reciente a la más antigua</caption><thead><tr><th scope="col">Número</th><th scope="col">Cliente</th><th scope="col">Estado</th><th scope="col" className="hp-align-right">Total</th><th scope="col" className="hp-align-right">Acción</th></tr></thead><tbody>{list.items.map(q=><tr key={q.id}><td>{q.numero}</td><td>{q.cliente}</td><td><span className={'hp-badge hp-state-'+q.estado}>{label(q.estado)}</span></td><td className="hp-align-right hq-total-cell">{Number(q.total).toFixed(2)} {q.moneda}</td><td className="hp-align-right"><button className="hp-btn" onClick={()=>void open(q.id)} disabled={busy}>Ver propuesta</button></td></tr>)}</tbody></table></div>:<div className="hp-empty"><h3>{query||state?'No encontramos coincidencias':'Aún no hay cotizaciones'}</h3><p>{query||state?'Prueba con otra búsqueda o cambia el filtro.':canCreate?'Crea la primera con «Nueva cotización».':'Cuando se registren cotizaciones, aparecerán aquí.'}</p></div>}
 <footer className="hp-pagination-bar"><span>{error?'Sin conexión con los datos':(list?.pagination.total??0)+' cotizaciones'} · 12 por página</span><div><button className="hp-btn" disabled={page===1||loading} onClick={()=>setPage(v=>v-1)}>Anterior</button><span>Página {page} de {Math.max(1,list?.pagination.pages||0)}</span><button className="hp-btn" disabled={loading||!!error||page>=(list?.pagination.pages||0)} onClick={()=>setPage(v=>v+1)}>Siguiente</button></div></footer></section>
 {detail&&!creating&&<PanelDialog title="Detalle de cotización" onClose={()=>setDetail(null)} busy={busy}><QuotePrint quote={detail}/>{detail.contacto_id?<p className="hq-no-print"><Link to={'/admin/messages?id='+detail.contacto_id}>Consulta de origen #{detail.contacto_id}</Link></p>:null}<div className="hp-actions hq-no-print"><button className="hp-btn" onClick={()=>window.print()}>Imprimir / guardar PDF</button>{detail.estado==='borrador'&&canEdit&&<button className="hp-btn" onClick={()=>{setEditing(detail);setCreating(true)}}>Editar borrador</button>}{canCreate&&<button className="hp-btn" onClick={()=>{const {id,revision:copyRevision,...copy}=detail;void id;void copyRevision;setEditing(copy);setCreating(true)}}>Preparar copia</button>}{(detail.estado!=='borrador'||!canEdit)&&<button className="hp-btn" onClick={()=>{setEditing(detail);setReadOnlyForm(true);setCreating(true)}}>Ver datos del formulario</button>}{canSend&&detail.email&&['borrador','enviada'].includes(detail.estado)&&<button ref={sendButton} className="hp-btn" disabled={busy} onClick={()=>void email()}>Enviar por correo</button>}
 {(quoteTransitions[detail.estado]||[]).filter(canMove).map(v=><button className="hp-btn" disabled={busy} key={v} onClick={()=>void status(v)}>Marcar {v}</button>)}</div>{actionError&&<p role="alert" className="hp-error hq-no-print">{actionError}</p>}{notice&&<p role="status" className="hp-notice hq-no-print">{notice}</p>}
 {mail&&<div role={mail.kind==='aceptado'?'status':'alert'} className={(mail.kind==='aceptado'?'hp-notice':'hp-error')+' hq-no-print'} data-mail-result={mail.kind} ref={mailBox} tabIndex={-1}><p>{mail.message}</p>
 {mail.needsConfirm&&<div className="hp-actions"><button type="button" className="hp-btn hp-btn-primary" disabled={busy} onClick={()=>void email(true)}>Enviar de todos modos</button><button type="button" ref={noSendButton} className="hp-btn" disabled={busy} onClick={dismissMail}>No enviar</button></div>}</div>}
 <section className="hq-no-print"><h3>Historial</h3><ul>{detail.historial.map((h,i)=><li key={i}>{new Date(h.fecha).toLocaleString('es-PE')} · {h.accion} · Administrador #{h.usuario}</li>)}</ul><p>Imprimir o enviar por correo conserva el estado actual. Registra los cambios según la atención realizada.</p></section></PanelDialog>}
 {creating&&<QuoteForm initial={editing||undefined} readOnly={readOnlyForm||!(editing&&'id' in editing?canEdit:canCreate)} related={related} onClose={()=>closeForm()} onSaved={()=>{closeForm(true);refresh();notify.success('Borrador guardado.')}}/>}</>;
}
