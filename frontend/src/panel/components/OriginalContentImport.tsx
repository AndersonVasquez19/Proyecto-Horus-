import { useEffect, useRef, useState } from 'react'
import { useAdminAuth } from '../context'
import { panelRequest, errorMessage } from '../services/panelApi'
import PanelDialog from './PanelDialog'
import { useRequestStatus } from '../hooks/useRequestStatus'
import '../../styles/original-content.css'
type Section={key:string;label:string;total:number;titles:string[]}
function ImportDialog({section,onClose,onRestored}:{section:string;onClose:()=>void;onRestored:(message:string)=>void}){
 const {token}=useAdminAuth(),{loading,error,setLoading,setError}=useRequestStatus(section)
 const [inventory,setInventory]=useState<Section|null>(null),[state,setState]=useState('publicado'),[busy,setBusy]=useState(false),[actionError,setActionError]=useState('')
 const lock=useRef(false),controller=useRef<AbortController|null>(null)
 useEffect(()=>{const c=new AbortController();void panelRequest<{sections:Section[]}>('contenido-original',token,'GET',undefined,c.signal).then(r=>{if(!c.signal.aborted)setInventory(r.sections.find(x=>x.key===section)||null)}).catch(e=>{if(!c.signal.aborted)setError(errorMessage(e))}).finally(()=>{if(!c.signal.aborted)setLoading(false)});return()=>{c.abort();controller.current?.abort()}},[section,token,setLoading,setError])
 const restore=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setActionError('');const c=new AbortController();controller.current=c;const timeout=window.setTimeout(()=>c.abort(),30000)
 try{const r=await panelRequest<{mensaje:string}>('contenido-original/'+section,token,'POST',{estado:state},c.signal);onRestored(r.mensaje);onClose()}catch(e){if(!c.signal.aborted)setActionError(errorMessage(e));else setActionError('La operación tardó demasiado. Actualiza los registros antes de reintentar.')}finally{window.clearTimeout(timeout);lock.current=false;setBusy(false)}}
 return <PanelDialog title="Recuperar contenido original" busy={busy} onClose={onClose}><div className="original-import-body">{loading?<p role="status">Consultando contenido original…</p>:error?<p role="alert">{error}</p>:inventory&&<><h3>{inventory.label}</h3><p>{inventory.total} registros de la versión anterior. Los registros existentes, sus cambios y su estado se conservan.</p><label>Visibilidad<select value={state} onChange={e=>setState(e.target.value)} disabled={busy}><option value="publicado">Publicar en la web</option><option value="borrador">Guardar sin publicar</option></select></label></>}{actionError&&<p role="alert" className="hp-error">{actionError}</p>}</div>
 {inventory&&<ul className="original-import-list">{inventory.titles.map(t=><li key={t}>{t}</li>)}</ul>}
 <div className="hp-dialog-footer"><button className="hp-btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="hp-btn hp-btn-primary" disabled={busy||loading||!!error||!inventory} onClick={()=>void restore()}>{busy?'Recuperando…':'Recuperar registros'}</button></div></PanelDialog>
}
export default function OriginalContentImport({section,onRestored}:{section:string;onRestored:(message:string)=>void}){
 const [open,setOpen]=useState(false)
 return <><button className="hp-btn" onClick={()=>setOpen(true)}>Recuperar contenido original</button>{open&&<ImportDialog section={section} onClose={()=>setOpen(false)} onRestored={onRestored}/>}</>
}
