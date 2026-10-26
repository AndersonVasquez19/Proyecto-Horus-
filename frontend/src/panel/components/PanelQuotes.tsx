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
import QuotePipelineBoard from './QuotePipelineBoard';
import QuotePipelineKpis from './QuotePipelineKpis';
import { PIPELINE_LIMIT, summarizePipeline, viewFromParam, withView, type QuoteView } from '../services/quotePipeline';
import { DUPLICATE_UNCERTAIN, duplicateFailure, newOperationKey, parseDuplicateResult, quoteListParams } from '../services/quoteActions';
import { downloadQuotePdf } from '../services/quotePdfDownload';
import { saveBlob } from '../services/reportDownload';
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
 const view=viewFromParam(params.get('vista')),board=view==='tablero';
 // Cambiar de vista conserva el resto de parámetros (section, contacto…) y los filtros, que viven en el estado del componente.
 const setView=(next:QuoteView)=>{if(next!==view)setParams(withView(params,next),{replace:true});};
 const [revision,setRevision]=useState(0),[page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[state,setState]=useState(''),[overdue,setOverdue]=useState(false);
 const overdueOn=overdue&&!board;const [pdfBusy,setPdfBusy]=useState(false);const [confirmDup,setConfirmDup]=useState(false);const dupKey=useRef<{id:number;key:string}|null>(null);
 const [list,setList]=useState<{items:Quote[];pagination:{total:number;pages:number}}|null>(null);
 const [detail,setDetail]=useState<Quote|null>(null),[editing,setEditing]=useState<Quote|QuoteInput|null>(null),[creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[notice,setNotice]=useState(''),[mail,setMail]=useState<MailResult|null>(null);
 const mailBox=useRef<HTMLDivElement>(null),noSendButton=useRef<HTMLButtonElement>(null),sendButton=useRef<HTMLButtonElement>(null);
 // Con confirmación pendiente el foco va a la opción segura («No enviar»); si no, al aviso (los botones se deshabilitan mientras se envía).
 const focusMail=useRef(false); // el foco se mueve cuando los botones ya no están deshabilitados (aquí se sigue ocupado hasta releer el detalle)
 useEffect(()=>{if(mail&&focusMail.current&&!busy){focusMail.current=false;(mail.needsConfirm?noSendButton.current:mailBox.current)?.focus();}},[mail,busy]);
 const dismissMail=()=>{setMail(null);window.setTimeout(()=>sendButton.current?.focus(),0);};
 const lock=useRef(false);const key=[view,page,query,state,overdueOn,revision].join(':');
 const action=useRef<AbortController|null>(null);
 const [statusBlocked,setStatusBlocked]=useState(false),[confirmVoid,setConfirmVoid]=useState(false);
 // Identidad por operación: una respuesta cancelada nunca puede modificar otra apertura.
 useEffect(()=>()=>{action.current?.abort();action.current=null;lock.current=false;},[token]);
 const beginAction=()=>{const ctrl=new AbortController();action.current=ctrl;lock.current=true;setBusy(true);setActionError('');return ctrl;};
 const active=(ctrl:AbortController)=>action.current===ctrl&&!ctrl.signal.aborted;
 const finishAction=(ctrl:AbortController)=>{if(action.current===ctrl){action.current=null;lock.current=false;setBusy(false);}};
 const cancelAction=()=>action.current?.abort();
 const {loading,error,setLoading,setError}=useRequestStatus(key);
 useEffect(()=>{const ctrl=new AbortController();let current=true;
 // El tablero pide un único lote de hasta 100 (máximo del backend) y muestra todos los estados; la tabla conserva 12 por página y su filtro.
 const q=quoteListParams({board,page,query,state,overdue,limit:board?PIPELINE_LIMIT:12});
 void panelRequest<{items:Quote[];pagination:{total:number;pages:number}}>('cotizaciones?'+q,token,'GET',undefined,ctrl.signal).then(data=>{if(current)setList(data)}).catch(e=>{if(current)setError(errorMessage(e))}).finally(()=>{if(current)setLoading(false)});
 return()=>{current=false;ctrl.abort();};},[board,page,query,state,overdue,revision,token,setLoading,setError]);
 const contactId=Number(params.get('contacto'))||0;const contactDenied=contactId>0&&!canCreate;
 // Depende del identificador y no de todos los parámetros: cambiar de vista (?vista=) no debe volver a preparar el formulario.
 useEffect(()=>{const id=contactId;if(!id||!canCreate)return;const ctrl=new AbortController();
 void panelRequest<{message:{nombre:string;email:string;telefono:string}}>('messages/'+id,token,'GET',undefined,ctrl.signal).then(({message})=>{if(ctrl.signal.aborted)return;setEditing({cliente:message.nombre,email:message.email,telefono:message.telefono||'',documento:'',direccion:'',emisor:'',datos_emisor:'',moneda:'PEN',validez:new Date(Date.now()+7*86400000).toISOString().slice(0,10),condiciones:'',conceptos:[{descripcion:'',cantidad:1,precio:0}],descuento:0,tasa:18,contacto_id:id});setCreating(true);if(message.email)void panelRequest<{items:Quote[]}>('cotizaciones?'+new URLSearchParams({page:'1',limit:'20',search:message.email}),token,'GET',undefined,ctrl.signal).then(found=>{if(!ctrl.signal.aborted)setRelated(found.items.filter(q=>q.contacto_id===id).map(q=>({numero:q.numero,estado:q.estado})));}).catch(()=>{/* solo es una ayuda: sin ella el formulario funciona igual */});}).catch(e=>{if(!ctrl.signal.aborted)setActionError(errorMessage(e));});return()=>ctrl.abort();},[contactId,token,canCreate]);
 const refresh=()=>{setDetail(null);setRevision(v=>v+1);};
 const summary=board&&list?summarizePipeline(list.items,list.pagination.total):null;
 const open=async(id:number)=>{if(lock.current)return;const ctrl=beginAction(),timer=window.setTimeout(()=>ctrl.abort(),15000);setMail(null);setNotice('');
 try{const data=await panelRequest<{item:Quote}>('cotizaciones/'+id,token,'GET',undefined,ctrl.signal);if(active(ctrl)){setDetail(data.item);setStatusBlocked(false);}}
 catch(e){if(action.current===ctrl)setActionError(ctrl.signal.aborted?'La consulta se canceló o tardó demasiado. Puedes volver a consultar la cotización.':errorMessage(e));}
 finally{window.clearTimeout(timer);finishAction(ctrl);}};
 const status=async(value:string)=>{if(!detail||lock.current||statusBlocked||!canMove(value)||!(quoteTransitions[detail.estado]||[]).includes(value)||(value==='anulada'&&!confirmVoid))return;
 const ctrl=beginAction(),timer=window.setTimeout(()=>ctrl.abort(),20000);setNotice('');
 try{const data=await panelRequest<{item:Quote}>('cotizaciones/'+detail.id+'/estado',token,'POST',{estado:value,revision:detail.revision},ctrl.signal);if(active(ctrl)){setDetail(data.item);setRevision(v=>v+1);setNotice('Estado actualizado.');}}
 catch(e){if(action.current===ctrl){const uncertain=ctrl.signal.aborted||!(e instanceof PanelApiError)||e.status>=500||e.status<400;setStatusBlocked(uncertain||(e instanceof PanelApiError&&e.status===409));setActionError(uncertain?'No pudimos confirmar el cambio de estado. Puede haberse guardado. Consulta la versión actual antes de realizar otra operación; no se reenviará automáticamente.':errorMessage(e));}}
 finally{window.clearTimeout(timer);if(action.current===ctrl)setConfirmVoid(false);finishAction(ctrl);}};
 // Un fallo de red, un timeout o un 5xx sin cuerpo no prueban que el correo no salió (ver services/mailOutcome.ts): se informa como incierto.
 // Un envío ya registrado exige confirmación explícita. Tras cualquier desenlace se relee el detalle: revisión e historial cambiaron.
 const email=async(confirmed=false)=>{if(!detail||lock.current||statusBlocked||!canSend)return;const id=detail.id,ctrl=beginAction(),timer=window.setTimeout(()=>ctrl.abort(),25000);
 setNotice('');setMail(null);let result:MailResult;
 try{result=mailResultFromSuccess(await panelRequest<unknown>('cotizaciones/'+id+'/correo',token,'POST',{revision:detail.revision,...(confirmed?{confirmar_reenvio:true}:{})},ctrl.signal));}
 catch(e){result=mailResultFromFailure(e instanceof PanelApiError?e:undefined);}
 finally{window.clearTimeout(timer);}
 if(action.current!==ctrl)return;
 setMail(result);focusMail.current=true;
 const readTimer=window.setTimeout(()=>ctrl.abort(),15000);
 try{const fresh=await panelRequest<{item:Quote}>('cotizaciones/'+id,token,'GET',undefined,ctrl.signal);if(active(ctrl))setDetail(current=>current&&current.id===id?fresh.item:current);}catch{if(action.current===ctrl)setStatusBlocked(true);}
 finally{window.clearTimeout(readTimer);finishAction(ctrl);}};
 // PDF real del backend (GET cotizaciones/:id/pdf, solo lectura, mismo permiso que el detalle). Comparte el bloqueo de las demás operaciones: un doble clic no descarga dos veces.
 const pdf=async()=>{if(!detail||lock.current)return;const {id,numero}=detail,ctrl=beginAction(),timer=window.setTimeout(()=>ctrl.abort(),30000);setNotice('');setPdfBusy(true);
 try{const file=await downloadQuotePdf(id,numero,token,ctrl.signal);if(active(ctrl)){saveBlob(file.blob,file.fileName);setNotice('PDF descargado: '+file.fileName+'.');}}
 catch(e){if(action.current===ctrl)setActionError(ctrl.signal.aborted?'La descarga se canceló o tardó demasiado. Puedes volver a intentarla.':errorMessage(e));}
 finally{window.clearTimeout(timer);setPdfBusy(false);finishAction(ctrl);}};
 // Duplicar (POST cotizaciones/:id/duplicar, permiso de crear): crea una copia NUEVA en borrador; la original no cambia. Lleva Idempotency-Key: tras un resultado
 // incierto (red, timeout, 5xx) la clave se conserva para esa cotización y reintentar desde la misma ventana nunca crea una segunda copia. No se reintenta solo.
 const duplicate=async()=>{if(!detail||lock.current||statusBlocked||!canCreate)return;const source=detail;
 if(dupKey.current?.id!==source.id)dupKey.current={id:source.id,key:newOperationKey()};
 const opKey=dupKey.current.key,ctrl=beginAction(),timer=window.setTimeout(()=>ctrl.abort(),25000);setNotice('');let created:ReturnType<typeof parseDuplicateResult>=null;
 try{created=parseDuplicateResult(await panelRequest<unknown>('cotizaciones/'+source.id+'/duplicar',token,'POST',undefined,ctrl.signal,{'Idempotency-Key':opKey}));if(!created&&action.current===ctrl)setActionError(DUPLICATE_UNCERTAIN);}
 catch(e){if(action.current===ctrl){const failure=duplicateFailure(e instanceof PanelApiError?e:undefined,ctrl.signal.aborted);if(failure.kind==='definitivo')dupKey.current=null;setActionError(failure.message);}}
 finally{window.clearTimeout(timer);finishAction(ctrl);}
 if(!created||ctrl.signal.aborted)return;
 dupKey.current=null;setConfirmDup(false);setRevision(v=>v+1);notify.success('Copia creada: '+created.numero+' (borrador).');
 await open(created.id);if(created.needsNewValidity)setNotice('La copia conserva la vigencia vencida de la original. Edita el borrador y fija una vigencia nueva antes de enviarla.');};
 const closeForm=(saved=false)=>{setReadOnlyForm(false);setCreating(false);setEditing(null);setRelated([]);if(params.has('contacto')){if(saved!==true&&origin){navigate(origin,{replace:true});return;}const next=new URLSearchParams(params);next.delete('contacto');setParams(next,{replace:true});}};
 return <><div className="hp-heading hqp-heading"><div><p className="hp-kicker">GESTIÓN COMERCIAL</p><h1>Cotizaciones</h1><p>Prepara propuestas, revisa importes y registra su seguimiento.</p></div><div className="hp-actions hqp-head-actions"><div className="hw-tabs hqp-views" role="group" aria-label="Vista de cotizaciones"><button type="button" aria-pressed={!board} onClick={()=>setView('tabla')}>Tabla</button><button type="button" aria-pressed={board} onClick={()=>setView('tablero')}>Tablero</button></div>{canCreate&&<button className="hp-btn hp-btn-primary" disabled={busy} onClick={()=>{setEditing(null);setCreating(true)}}>Nueva cotización</button>}<button className="hp-btn" onClick={refresh} disabled={busy||loading}>Actualizar</button></div></div>
 {busy&&!detail&&<p role="status">Consultando cotización… <button type="button" className="hp-btn" onClick={cancelAction}>Cancelar consulta</button></p>}
 {confirmVoid&&detail&&<PanelDialog title="Confirmar anulación" className="hq-void-confirm" busy={busy} onClose={()=>{if(!lock.current)setConfirmVoid(false);}}>
 <p>La cotización {detail.numero} quedará anulada. Es un estado terminal: no podrás volver a cambiar su estado ni editarla o enviarla por correo. La propuesta y su historial se conservarán.</p>
 <footer className="hp-dialog-footer"><button type="button" data-autofocus className="hp-btn" disabled={busy} onClick={()=>setConfirmVoid(false)}>Cancelar</button><button type="button" className="hp-btn hp-btn-danger" disabled={busy||!canMove('anulada')} onClick={()=>void status('anulada')}>{busy?'Anulando…':'Confirmar anulación'}</button></footer>
 {busy&&<button type="button" className="hp-btn" onClick={cancelAction}>Detener espera</button>}
 </PanelDialog>}
 {confirmDup&&detail&&<PanelDialog title="Duplicar cotización" className="hq-void-confirm hq-dup-confirm" busy={busy} onClose={()=>{if(!lock.current)setConfirmDup(false);}}>
 <p>Se creará una cotización nueva en <strong>borrador</strong> a partir de {detail.numero}, con los mismos datos, conceptos e importes. La original no cambia y el borrador no se envía al cliente.</p>
 {(detail as {vencida?:boolean}).vencida&&<p>La original tiene la vigencia vencida: la copia conservará esa fecha y tendrás que fijar una vigencia nueva antes de enviarla.</p>}
 {actionError&&<p role="alert" className="hp-error">{actionError}</p>}
 <footer className="hp-dialog-footer"><button type="button" data-autofocus className="hp-btn" disabled={busy} onClick={()=>setConfirmDup(false)}>Cancelar</button><button type="button" className="hp-btn hp-btn-primary" data-confirm-duplicate disabled={busy||!canCreate} onClick={()=>void duplicate()}>{busy?'Duplicando…':'Duplicar'}</button></footer>
 {busy&&<button type="button" className="hp-btn" onClick={cancelAction}>Detener espera</button>}
 </PanelDialog>}
 {contactDenied?<PanelReadOnlyNotice>Tu cuenta no puede crear cotizaciones. Se muestra el listado en modo consulta.</PanelReadOnlyNotice>:!canCreate&&!canEdit&&!canSend&&<PanelReadOnlyNotice>Modo consulta: tu cuenta puede ver las cotizaciones, pero no modificarlas ni enviarlas.</PanelReadOnlyNotice>}
 {notice&&<p role="status" className="hp-notice">{notice}</p>}{(error||actionError)&&<p role="alert" className="hp-error">{error||actionError}</p>}
 <section className="hp-card"><form className="hp-toolbar" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(search.trim())}}><div className="hp-search"><PanelIcon name="search"/><input type="search" aria-label="Buscar cotización" placeholder="Buscar cotización…" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="hp-btn">Buscar</button><select aria-label="Filtrar por estado" value={state} disabled={board||overdueOn} title={board?'El tablero muestra todos los estados':overdueOn?'Con «Vencidas» solo se listan cotizaciones enviadas':undefined} onChange={e=>{setState(e.target.value);setPage(1)}}><option value="">Todos los estados</option>{Object.keys(quoteTransitions).map(v=><option key={v} value={v}>{label(v)}</option>)}</select><button type="button" className="hp-btn hqp-overdue" data-overdue-filter aria-pressed={overdueOn} disabled={board} title={board?'El tablero muestra todos los estados':'Enviadas con la vigencia vencida'} onClick={()=>{setOverdue(v=>!v);setPage(1)}}>{overdueOn?'✓ Solo vencidas':'Vencidas'}</button></form>{overdueOn&&<p className="hp-notice hqp-overdue-note" role="status" data-overdue-note>Mostrando solo cotizaciones enviadas con la vigencia vencida. <button type="button" className="hp-btn" onClick={()=>{setOverdue(false);setPage(1)}}>Quitar filtro</button></p>}
 {loading?<div role="status" className="hp-empty"><span className="hp-loading"/><p>Cargando cotizaciones…</p></div>:error?<div className="hp-empty"><p>No se pudieron cargar las cotizaciones.</p><button className="hp-btn" onClick={refresh}>Reintentar</button></div>:list?.items.length&&board?<>{summary&&<QuotePipelineKpis summary={summary}/>}{summary?.truncated&&<p className="hp-notice hqp-truncated" role="status" data-pipeline-truncated>Mostrando {summary.loaded} de {summary.total} cotizaciones (las más recientes). Para ver las demás usa la búsqueda o la vista Tabla.</p>}<QuotePipelineBoard items={list.items} busy={busy} onOpen={id=>void open(id)}/></>:list?.items.length?<div className="hp-table-wrap"><table className="hp-table"><caption className="hp-sr">Cotizaciones registradas, de la más reciente a la más antigua</caption><thead><tr><th scope="col">Número</th><th scope="col">Cliente</th><th scope="col">Estado</th><th scope="col" className="hp-align-right">Total</th><th scope="col" className="hp-align-right">Acción</th></tr></thead><tbody>{list.items.map(q=><tr key={q.id}><td>{q.numero}</td><td>{q.cliente}</td><td><span className={'hp-badge hp-state-'+q.estado}>{label(q.estado)}</span></td><td className="hp-align-right hq-total-cell">{Number(q.total).toFixed(2)} {q.moneda}</td><td className="hp-align-right"><button className="hp-btn" onClick={()=>void open(q.id)} disabled={busy}>Ver propuesta</button></td></tr>)}</tbody></table></div>:<div className="hp-empty"><h3>{overdueOn&&!query?'No hay cotizaciones vencidas':query||state||overdueOn?'No encontramos coincidencias':'Aún no hay cotizaciones'}</h3><p>{overdueOn&&!query?'Ninguna cotización enviada tiene la vigencia vencida. Quita el filtro para ver todas.':query||state||overdueOn?'Prueba con otra búsqueda o cambia el filtro.':canCreate?'Crea la primera con «Nueva cotización».':'Cuando se registren cotizaciones, aparecerán aquí.'}</p></div>}
 <footer className="hp-pagination-bar"><span>{error?'Sin conexión con los datos':board?'Mostrando '+(list?.items.length??0)+' de '+(list?.pagination.total??0)+' cotizaciones · tablero':(list?.pagination.total??0)+' cotizaciones · 12 por página'}</span>{!board&&<div><button className="hp-btn" disabled={page===1||loading} onClick={()=>setPage(v=>v-1)}>Anterior</button><span>Página {page} de {Math.max(1,list?.pagination.pages||0)}</span><button className="hp-btn" disabled={loading||!!error||page>=(list?.pagination.pages||0)} onClick={()=>setPage(v=>v+1)}>Siguiente</button></div>}</footer></section>
 {detail&&!creating&&<PanelDialog title="Detalle de cotización" onClose={()=>{if(!lock.current){setDetail(null);setStatusBlocked(false);}}} busy={busy}><QuotePrint quote={detail}/>{detail.contacto_id?<p className="hq-no-print"><Link to={'/admin/messages?id='+detail.contacto_id}>Consulta de origen #{detail.contacto_id}</Link></p>:null}<div className="hp-actions hq-no-print"><button className="hp-btn" onClick={()=>window.print()}>Imprimir / guardar PDF</button><button className="hp-btn" data-quote-pdf disabled={busy} onClick={()=>void pdf()}>Descargar PDF</button>{detail.estado==='borrador'&&canEdit&&<button className="hp-btn" disabled={busy||statusBlocked} onClick={()=>{setEditing(detail);setCreating(true)}}>Editar borrador</button>}{canCreate&&<button className="hp-btn" disabled={busy||statusBlocked} onClick={()=>{const {id,revision:copyRevision,...copy}=detail;void id;void copyRevision;setEditing(copy);setCreating(true)}}>Preparar copia</button>}{canCreate&&<button className="hp-btn" data-quote-duplicate disabled={busy||statusBlocked} onClick={()=>{setActionError('');setConfirmDup(true)}}>Duplicar cotización</button>}{(detail.estado!=='borrador'||!canEdit)&&<button className="hp-btn" disabled={busy} onClick={()=>{setEditing(detail);setReadOnlyForm(true);setCreating(true)}}>Ver datos del formulario</button>}{canSend&&detail.email&&['borrador','enviada'].includes(detail.estado)&&<button ref={sendButton} className="hp-btn" disabled={busy||statusBlocked} onClick={()=>void email()}>Enviar por correo</button>}
 {(quoteTransitions[detail.estado]||[]).filter(canMove).map(v=><button className="hp-btn" disabled={busy||statusBlocked} key={v} onClick={()=>{if(v==='anulada')setConfirmVoid(true);else void status(v);}}>Marcar {v}</button>)}</div>{pdfBusy&&<p role="status" className="hp-notice hq-no-print" data-pdf-busy>Generando el PDF…</p>}{actionError&&<p role="alert" className="hp-error hq-no-print">{actionError}</p>}{notice&&<p role="status" className="hp-notice hq-no-print">{notice}</p>}
 {mail&&<div role={mail.kind==='aceptado'?'status':'alert'} className={(mail.kind==='aceptado'?'hp-notice':'hp-error')+' hq-no-print'} data-mail-result={mail.kind} ref={mailBox} tabIndex={-1}><p>{mail.message}</p>
 {mail.needsConfirm&&<div className="hp-actions"><button type="button" className="hp-btn hp-btn-primary" disabled={busy} onClick={()=>void email(true)}>Enviar de todos modos</button><button type="button" ref={noSendButton} className="hp-btn" disabled={busy} onClick={dismissMail}>No enviar</button></div>}</div>}
 {busy&&<button type="button" className="hp-btn" onClick={cancelAction}>Detener espera</button>}
 {statusBlocked&&<p role="alert">Consulta la versión actual para revisar el estado, la revisión y el historial antes de continuar. <button type="button" className="hp-btn" disabled={busy} onClick={()=>void open(detail.id)}>Consultar versión actual</button></p>}
 <section className="hq-no-print"><h3>Historial</h3><ul>{detail.historial.map((h,i)=><li key={i}>{new Date(h.fecha).toLocaleString('es-PE')} · {h.accion} · Administrador #{h.usuario}</li>)}</ul><p>Imprimir o enviar por correo conserva el estado actual. Registra los cambios según la atención realizada.</p></section></PanelDialog>}
 {creating&&<QuoteForm initial={editing||undefined} readOnly={readOnlyForm||!(editing&&'id' in editing?canEdit:canCreate)} related={related} onClose={()=>closeForm()} onSaved={()=>{closeForm(true);refresh();notify.success('Borrador guardado.')}}/>}</>;
}
