import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { PanelApiError, panelRequest, errorMessage } from '../services/panelApi';
import PanelDialog from './PanelDialog';
import PanelInputField from './PanelInputField';
import { quoteFieldError, quoteRetryWarning } from './quoteFormFeedback';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import type { Quote, QuoteInput } from '../types/quotes';
const CREATE_TIMEOUT_MS=25000,CHECK_TIMEOUT_MS=15000;
// Clave de una operación lógica de creación. Solo debe ser única (no secreta); randomUUID exige contexto seguro (https o localhost).
const newOperationKey=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():'op-'+Date.now().toString(36)+'-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
export default function QuoteForm({initial,onClose,onSaved,related=[],readOnly=false}:{initial?:Quote|QuoteInput;onClose:()=>void;onSaved:()=>void;related?:{numero:string;estado:string}[];readOnly?:boolean}) {
 const {token}=useAdminAuth();const lock=useRef(false);
 const formId=useId(),formRef=useRef<HTMLFormElement>(null);
 const [fieldErrors,setFieldErrors]=useState<{id:string;label:string;message:string}[]>([]);
 const pendingFocus=useRef<string|null>(null);
 // Identidades de UI estables: quitar una fila no reutiliza el control de otra.
 const [lineKeys,setLineKeys]=useState(()=>initial?.conceptos.map((_,i)=>i)||[0]);
 const nextLineKey=useRef(lineKeys.length);
 const [lineNotice,setLineNotice]=useState('');
 const fieldId=(key:string)=>formId+'-'+key;
 const fieldError=(key:string)=>fieldErrors.find(e=>e.id===fieldId(key))?.message;
 useEffect(()=>{if(pendingFocus.current){document.getElementById(pendingFocus.current)?.focus();pendingFocus.current=null;}},[lineKeys]);
 const [form,setForm]=useState<QuoteInput>(()=>({cliente:initial?.cliente||'',email:initial?.email||'',telefono:initial?.telefono||'',documento:initial?.documento||'',direccion:initial?.direccion||'',emisor:initial?.emisor||'',datos_emisor:initial?.datos_emisor||'',moneda:initial?.moneda||'PEN',validez:initial?.validez||new Date(Date.now()+7*86400000).toISOString().slice(0,10),condiciones:initial?.condiciones||'',conceptos:initial?.conceptos.map(({descripcion,cantidad,precio})=>({descripcion,cantidad,precio:Number(precio)}))||[{descripcion:'',cantidad:1,precio:0}],descuento:Number(initial?.descuento||0),tasa:Number(initial?.tasa??18),...(initial?.contacto_id?{contacto_id:initial.contacto_id}:{})}));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 // Cambios = el formulario difiere de lo que se abrió (o de lo último guardado). Cerrar con cambios pide confirmación.
 const [baseline,setBaseline]=useState(()=>JSON.stringify(form));
 const {confirmLeave,clear}=useUnsavedChangesControl(JSON.stringify(form)!==baseline,'cotización');
 const requestClose=()=>confirmLeave(onClose);
 const editing=initial && 'id' in initial;
 const setText=(key:keyof QuoteInput,value:string)=>setForm(v=>({...v,[key]:value}));
 // Una creación sin resultado conocido (red, timeout, 5xx o 2xx ilegible) puede haberse guardado. El formulario NO repite el POST por sí solo;
 // permite comprobar la lista y exige una confirmación explícita. Cada creación envía `Idempotency-Key`: la clave se conserva mientras el contenido enviado no cambie
 // (un reintento idéntico no duplica en el backend) y se renueva si la persona edita el formulario. Editar usa `revision`, así que un reintento obsoleto responde 409.
 const operation=useRef<{key:string;body:string}|null>(null);
 const [attemptBody,setAttemptBody]=useState('');
 const [phase,setPhase]=useState<'idle'|'uncertain'|'confirming'>('idle'),[check,setCheck]=useState<{state:'idle'|'loading'|'done'|'error';matches:{numero:string;estado:string}[]}>({state:'idle',matches:[]});
 const attemptAt=useRef(0),uncertainBox=useRef<HTMLDivElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false};},[]);
 useEffect(()=>{if(phase==='uncertain'&&check.state==='idle')uncertainBox.current?.focus();},[phase,check.state]);
 const post=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setPhase(current=>current==='confirming'?'uncertain':current);const ctrl=new AbortController(),timer=window.setTimeout(()=>ctrl.abort(),CREATE_TIMEOUT_MS);attemptAt.current=Date.now();
  try{const sent=JSON.stringify(form);setAttemptBody(sent);if(!editing&&operation.current?.body!==sent)operation.current={key:newOperationKey(),body:sent};
   await panelRequest(editing?'cotizaciones/'+initial.id:'cotizaciones',token,editing?'PUT':'POST',{...form,...(editing?{revision:initial.revision}:{})},ctrl.signal,!editing&&operation.current?{'Idempotency-Key':operation.current.key}:undefined);setBaseline(JSON.stringify(form));clear();onSaved();}
  catch(e){const uncertain=!editing&&(!(e instanceof PanelApiError)||e.status>=500||e.status<400);if(!alive.current)return;if(uncertain){setPhase('uncertain');setCheck({state:'idle',matches:[]});}else{setPhase('idle');setError(errorMessage(e));}}
  finally{window.clearTimeout(timer);lock.current=false;if(alive.current)setBusy(false);}};
 const checkList=async()=>{setCheck({state:'loading',matches:[]});const ctrl=new AbortController(),timer=window.setTimeout(()=>ctrl.abort(),CHECK_TIMEOUT_MS);
  try{const data=await panelRequest<{items:Quote[]}>('cotizaciones?'+new URLSearchParams({page:'1',limit:'20',search:form.cliente.trim().slice(0,100)}),token,'GET',undefined,ctrl.signal);
   const since=attemptAt.current-120000; // margen por diferencias de reloj entre el navegador y el servidor
   if(alive.current)setCheck({state:'done',matches:data.items.filter(q=>q.cliente===form.cliente.trim()&&!!q.createdAt&&new Date(q.createdAt).getTime()>=since&&(!form.contacto_id||q.contacto_id===form.contacto_id)).map(q=>({numero:q.numero,estado:q.estado}))});}
  catch{if(alive.current)setCheck({state:'error',matches:[]});}finally{window.clearTimeout(timer);}};
 const validate=()=>{
  const errors=[...(formRef.current?.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')||[])].flatMap(control=>{
   const message=quoteFieldError(control);
   return message?[{id:control.id,label:control.dataset.errorLabel||control.labels?.[0]?.querySelector('.hp-field-label')?.firstChild?.textContent||'Campo',message}]:[];
  });
  setFieldErrors(errors);return errors;
 };
 const focusField=(id:string)=>document.getElementById(id)?.focus();
 const submit=(event:SubmitEvent<HTMLFormElement>)=>{event.preventDefault();if(lock.current||readOnly)return;const errors=validate();if(errors.length){focusField(errors[0].id);return;}if(phase!=='idle'){setPhase('confirming');return;}void post();};
 const addLine=()=>{if(form.conceptos.length>=50)return;const key=nextLineKey.current++;pendingFocus.current=fieldId('descripcion-'+key);setLineKeys(v=>[...v,key]);setForm(v=>({...v,conceptos:[...v.conceptos,{descripcion:'',cantidad:1,precio:0}]}));setLineNotice('Concepto añadido. '+(form.conceptos.length+1)+' de 50.');};
 const removeLine=(index:number)=>{if(form.conceptos.length<=1)return;const key=lineKeys[index],remaining=lineKeys.filter((_,n)=>n!==index);pendingFocus.current=fieldId('descripcion-'+remaining[Math.min(index,remaining.length-1)]);setLineKeys(remaining);setForm(v=>({...v,conceptos:v.conceptos.filter((_,n)=>n!==index)}));setFieldErrors(v=>v.filter(e=>!['descripcion','cantidad','precio'].some(name=>e.id===fieldId(name+'-'+key))));setLineNotice('Concepto quitado. '+remaining.length+' de 50.');};
 const input=(key:keyof QuoteInput,label:string,maxLength:number,help?:string)=><PanelInputField key={key} id={fieldId(key)} label={label} type={key==='email'?'email':key==='telefono'?'tel':'text'} value={String(form[key])} maxLength={maxLength} required={key==='cliente'||key==='emisor'} help={help} error={fieldError(key)} onChange={e=>setText(key,e.target.value)}/>;
 const multiline=(key:'datos_emisor'|'condiciones',label:string,maxLength:number,help?:string)=><label className="hp-input-field hqf-wide" htmlFor={fieldId(key)}>
  <span className="hp-field-label">{label}<span className="hp-field-status">Opcional</span></span>
  <textarea id={fieldId(key)} data-error-label={label} rows={3} value={form[key]} maxLength={maxLength} aria-invalid={!!fieldError(key)} aria-describedby={[help?fieldId(key)+'-help':'',fieldError(key)?fieldId(key)+'-error':''].filter(Boolean).join(' ')||undefined} onChange={e=>setText(key,e.target.value)}/>
  {help&&<small className="hp-field-help" id={fieldId(key)+'-help'}>{help}</small>}
  {fieldError(key)&&<small className="hp-field-error" id={fieldId(key)+'-error'}>{fieldError(key)}</small>}
 </label>;
 return <PanelDialog title={readOnly?'Datos de la cotización':editing?'Editar borrador':'Nueva cotización'} className="hqf-dialog" lockScroll busy={busy} onClose={requestClose}>
 <form ref={formRef} id={formId} noValidate onSubmit={submit} className="hp-form hqf-form" onInput={event=>{
  const control=event.target;
  if(control instanceof HTMLInputElement||control instanceof HTMLSelectElement||control instanceof HTMLTextAreaElement){
   const message=quoteFieldError(control);
   setFieldErrors(v=>v.flatMap(e=>e.id===control.id?(message?[{...e,message}]:[]):[e]));
  }
 }}>
 <div className="hqf-body">
 <p className="hqf-intro">{readOnly?'Consulta los datos de la propuesta. Este formulario es de solo lectura.':'Prepara y guarda un borrador. El envío por correo se realiza desde el detalle.'}</p>
 {error&&<p role="alert" className="hp-error">{error}</p>}
 {fieldErrors.length>0&&<div role="alert" className="hp-form-summary hqf-summary"><h3>Revisa los campos indicados</h3><ul>{fieldErrors.map(e=><li key={e.id}><button type="button" onClick={()=>focusField(e.id)}>{e.label}: {e.message}</button></li>)}</ul></div>}
 {related.length>0&&phase==='idle'&&<p role="status" className="hp-notice" data-quote-related>Esta consulta ya tiene {related.length===1?'una cotización asociada':related.length+' cotizaciones asociadas'}: {related.map(q=>q.numero+' ('+q.estado+')').join(', ')}. Continúa solo si necesitas otra.</p>}
 {phase!=='idle'&&<div ref={uncertainBox} tabIndex={-1} role="alert" className="hp-error" data-quote-uncertain={phase}>
  <p>No pudimos confirmar si la cotización se guardó: puede que el servidor la haya creado y solo se haya perdido la respuesta. Tu borrador se conserva y no se volverá a enviar automáticamente.</p>
  {check.state==='loading'&&<p role="status">Comprobando la lista…</p>}
  {check.state==='error'&&<p>No pudimos consultar la lista. Puedes reintentarlo.</p>}
  {check.state==='done'&&(check.matches.length?<><p>Encontramos {check.matches.length===1?'una cotización reciente':check.matches.length+' cotizaciones recientes'} de este cliente{form.contacto_id?' asociada(s) a la misma consulta':''}. Es posible que ya se haya guardado, pero no podemos asegurar que sea esta solicitud:</p><ul data-quote-matches>{check.matches.map(q=><li key={q.numero}>{q.numero} · {q.estado}</li>)}</ul><div className="hp-actions"><button type="button" className="hp-btn hp-btn-primary" onClick={()=>{clear();onSaved();}}>Ya se guardó: cerrar y actualizar la lista</button></div></>:<p>No encontramos una cotización reciente de este cliente. Eso no garantiza que no se haya creado: puede tardar en aparecer.</p>)}
  {phase==='confirming'?<><p><strong>{quoteRetryWarning(attemptBody===JSON.stringify(form))}</strong></p><div className="hp-actions"><button type="button" className="hp-btn hp-btn-primary" disabled={busy} onClick={()=>setPhase('uncertain')}>Volver</button><button type="button" className="hp-btn hp-btn-danger" disabled={busy} onClick={()=>{const errors=validate();if(errors.length){setPhase('uncertain');focusField(errors[0].id);}else void post();}}>Guardar de todos modos</button></div></>:<div className="hp-actions"><button type="button" className="hp-btn" disabled={busy||check.state==='loading'} onClick={()=>void checkList()}>{check.state==='idle'?'Comprobar en la lista':'Comprobar de nuevo'}</button></div>}
 </div>}
 <fieldset disabled={busy||readOnly} className="hqf-fields" aria-label="Datos de la cotización">
 <section className="hqf-section" aria-labelledby={fieldId('client-title')}>
  <h3 id={fieldId('client-title')}>Datos del cliente</h3>
  <div className="hqf-grid">
   <div className="hqf-wide">{input('cliente','Cliente',160)}</div>
   {input('documento','Documento',30)}{input('telefono','Teléfono',30)}
   <div className="hqf-wide">{input('email','Correo del cliente',254,'Opcional para guardar; necesario para enviar la propuesta por correo.')}</div>
   <div className="hqf-wide">{input('direccion','Dirección',300)}</div>
  </div>
 </section>
 <section className="hqf-section" aria-labelledby={fieldId('issuer-title')}>
  <h3 id={fieldId('issuer-title')}>Emisor de la propuesta</h3>
  <div className="hqf-grid"><div className="hqf-wide">{input('emisor','Emisor de la propuesta',160)}</div>{multiline('datos_emisor','Datos del emisor',500,'Revisa la información que aparecerá en la propuesta.')}</div>
 </section>
 <section className="hqf-section" aria-labelledby={fieldId('items-title')}>
  <h3 id={fieldId('items-title')}>Conceptos de cotización <span className="hqf-count">{form.conceptos.length} de 50</span></h3>
  <label className="hp-input-field hqf-currency" htmlFor={fieldId('moneda')}><span className="hp-field-label">Moneda</span>
   <select id={fieldId('moneda')} data-error-label="Moneda" value={form.moneda} onChange={e=>setText('moneda',e.target.value)}><option value="PEN">Soles (PEN)</option><option value="USD">Dólares (USD)</option></select>
  </label>
  {form.conceptos.map((line,i)=>{const key=lineKeys[i];return <div className="hqf-line" key={key} role="group" aria-labelledby={fieldId('line-title-'+key)}>
   <h4 id={fieldId('line-title-'+key)}>Concepto {i+1}</h4>
   <div className="hqf-line-grid">
    <PanelInputField id={fieldId('descripcion-'+key)} label={'Descripción '+(i+1)} required maxLength={500} value={line.descripcion} error={fieldError('descripcion-'+key)} onChange={e=>setForm(v=>({...v,conceptos:v.conceptos.map((x,n)=>n===i?{...x,descripcion:e.target.value}:x)}))}/>
    <PanelInputField id={fieldId('cantidad-'+key)} label="Cantidad" data-error-label={'Cantidad del concepto '+(i+1)} type="number" min={1} max={10000} step={1} required value={line.cantidad} error={fieldError('cantidad-'+key)} onChange={e=>setForm(v=>({...v,conceptos:v.conceptos.map((x,n)=>n===i?{...x,cantidad:Number(e.target.value)}:x)}))}/>
    <PanelInputField id={fieldId('precio-'+key)} label="Precio unitario" data-error-label={'Precio unitario del concepto '+(i+1)} type="number" min={0} max={1000000} step=".01" required value={line.precio} error={fieldError('precio-'+key)} onChange={e=>setForm(v=>({...v,conceptos:v.conceptos.map((x,n)=>n===i?{...x,precio:Number(e.target.value)}:x)}))}/>
   </div>
   <div className="hqf-line-actions">{form.conceptos.length===1&&<small>La cotización necesita al menos un concepto.</small>}<button className="hp-btn" type="button" disabled={form.conceptos.length===1} onClick={()=>removeLine(i)}>Quitar concepto {i+1}</button></div>
  </div>;})}
  <button id={fieldId('add')} className="hp-btn" type="button" disabled={form.conceptos.length>=50} onClick={addLine}>Añadir concepto</button>
  <p className="hqf-help">Entre 1 y 50 conceptos. Los precios usan la moneda elegida.</p>
 </section>
 <section className="hqf-section" aria-labelledby={fieldId('terms-title')}>
  <h3 id={fieldId('terms-title')}>Importes y condiciones</h3>
  <div className="hqf-grid">
   <PanelInputField id={fieldId('descuento')} label="Descuento" help="Importe en la moneda elegida." type="number" min={0} max={10000000000} step=".01" required value={form.descuento} error={fieldError('descuento')} onChange={e=>setForm(v=>({...v,descuento:Number(e.target.value)}))}/>
   <PanelInputField id={fieldId('tasa')} label="Impuesto (%)" type="number" min={0} max={100} step=".01" required value={form.tasa} error={fieldError('tasa')} onChange={e=>setForm(v=>({...v,tasa:Number(e.target.value)}))}/>
   <div className="hqf-wide"><PanelInputField id={fieldId('validez')} label="Válida hasta" type="date" required value={form.validez} error={fieldError('validez')} onChange={e=>setText('validez',e.target.value)}/></div>
   {multiline('condiciones','Condiciones',5000)}
  </div>
  <p className="hqf-total-note">El total se calcula al guardar. Revisa los datos del emisor antes de enviar la propuesta.</p>
 </section>
 </fieldset>
 <p className="hqf-sr-status" role="status">{lineNotice}</p>
 </div>
 <footer className="hq-actions hqf-footer"><span>{readOnly?'Solo lectura':'Guardar conserva el estado borrador.'}</span><button className="hp-btn" type="button" onClick={requestClose} disabled={busy}>{readOnly?'Cerrar':'Cancelar'}</button>{!readOnly&&<button className="hp-btn hp-btn-primary" type="submit" disabled={busy||phase==='confirming'}>{busy?'Guardando…':phase==='idle'?'Guardar borrador':'Guardar de nuevo…'}</button>}</footer>
 </form></PanelDialog>;
}
