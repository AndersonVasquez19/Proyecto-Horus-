import { useEffect, useRef, useState } from 'react';
import type { ChatTurn } from './chatApi';
import { publicRequest } from '../../api';
import { usePublicResource } from '../../hooks/usePublicResource';
import { publicErrorMessage } from '../../publicErrors';
import ChatIcon from './ChatIcon';
type Section='cursos'|'servicios'|'preguntas-frecuentes';
type Item={id:number;titulo?:string;pregunta?:string;descripcion?:string;respuesta?:string;temario?:string;modalidad?:string;duracion?:string;fecha_inicio?:string;alcance?:string};
type Props={onAnswer:(question:string,answer:ChatTurn)=>void;onContact:(topic?:string)=>void;onAsk:(question:string)=>void;onWrite:()=>void};
// Áreas que Horus publica en el sitio: cada atajo envía una pregunta que el asistente responde solo con contenido publicado.
const quickAsks:{label:string;hint:string;question:string;icon:'help'|'person'|'chat'}[]=[
 {label:'Asesoramiento',hint:'Orientación tecnológica',question:'¿Qué servicios de asesoramiento ofrecen?',icon:'person'},
 {label:'Convenios',hint:'Alianzas publicadas',question:'¿Qué convenios tienen?',icon:'help'},
 {label:'Contacto',hint:'Teléfono, correo y horario',question:'¿Cómo puedo contactar al equipo?',icon:'chat'}];
const titles:Record<Section,string>={cursos:'Cursos y capacitaciones',servicios:'Servicios tecnológicos','preguntas-frecuentes':'Preguntas frecuentes'};
const name=(item:Item)=>item.titulo||item.pregunta||'Contenido publicado';
const text=(value?:string)=>value?.replace(/<[^>]*>/g,'').trim()||'Este dato todavía no está publicado. Puedes solicitar información al equipo.';
function GuidedCatalog({section,onAnswer,onContact,onWrite}:{section:Section}&Props){
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[modality,setModality]=useState(''),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>{controller.current?.abort();controller.current=null},[]);
 const params=new URLSearchParams({page:String(page),limit:'20',...(search.trim()?{search:search.trim()}:{}),...(modality?{modalidad:modality}:{})});
 const {data,loading,error,reload}=usePublicResource<{items:Item[];pagination:{pages:number;total:number}}>(section+'?'+params);
 const item=data?.items.find(x=>String(x.id)===selected);
 const answer=async(action:'descripcion'|'temario'|'modalidad'|'fecha'|'alcance'|'respuesta',label:string)=>{
 if(!item||controller.current)return;const c=new AbortController();controller.current=c;setBusy(true);setActionError('');const timeout=window.setTimeout(()=>c.abort(),15000);
 try{const {item:current}=await publicRequest<{item:Item}>(section+'/'+item.id,{signal:c.signal});if(c.signal.aborted)return;
 const content=action==='modalidad'?'Modalidad: '+text(current.modalidad)+'\nDuración: '+text(current.duracion):action==='fecha'?current.fecha_inicio?'Fecha publicada: '+current.fecha_inicio.slice(0,10)+'. Consulta la vigencia y disponibilidad con el equipo.':'Sin fecha publicada. Consulta con el equipo.':text(current[action]);
 onAnswer(label+': '+name(current),{role:'assistant',content:(name(current)+'\n\n'+content).slice(0,4000),sources:[{id:section+'-'+current.id,title:name(current),text:content}]});
 }catch(e){if(controller.current===c)setActionError(publicErrorMessage(e,c.signal.aborted));}
 finally{window.clearTimeout(timeout);if(controller.current===c){controller.current=null;setBusy(false)}}
 };
 return <><fieldset disabled={busy}><label>Buscar por nombre<input type="search" maxLength={100} value={search} onChange={e=>{setPage(1);setSelected('');setSearch(e.target.value)}}/></label>{section==='cursos'&&<label>Modalidad<select value={modality} onChange={e=>{setPage(1);setSelected('');setModality(e.target.value)}}><option value="">Todas</option><option value="presencial">Presencial</option><option value="virtual">Virtual</option><option value="hibrida">Híbrida</option></select></label>}
 {!loading&&!error&&<><p role="status">{data?.pagination.total||0} opciones publicadas</p><label>Selecciona una opción<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Elige una opción</option>{data?.items.map(x=><option key={x.id} value={x.id}>{name(x)}</option>)}</select></label>{item&&<div className="hc-guide-actions">{(section==='cursos'?[['temario','Ver temario'],['modalidad','Modalidad y duración'],['fecha','Fecha publicada']]:section==='servicios'?[['descripcion','Conocer servicio'],['alcance','Ver alcance']]:[['respuesta','Ver respuesta']]).map(([action,label])=><button type="button" key={action} onClick={()=>void answer(action as 'temario'|'modalidad'|'fecha'|'descripcion'|'alcance'|'respuesta',label)}>{label}</button>)}<button type="button" onClick={()=>onContact(name(item))}>Solicitar información</button></div>}</>}
 </fieldset>{(loading||busy)&&<p role="status">Consultando contenido publicado…</p>}{(error||actionError)&&<p role="alert" className="hc-guide-error">{error||actionError}</p>}<div className="hc-guide-actions"><button disabled={loading||busy||page===1} onClick={()=>{setSelected('');setPage(v=>v-1)}}>Anterior</button><span>Página {page}</span><button disabled={loading||busy||!!error||page>=(data?.pagination.pages||0)} onClick={()=>{setSelected('');setPage(v=>v+1)}}>Siguiente</button><button disabled={loading||busy} onClick={reload}>Actualizar opciones</button></div><button className="hc-back" onClick={onWrite}>Prefiero escribir mi consulta</button></>;
}
export default function GuidedMenu(props:Props){
 const [section,setSection]=useState<Section|null>(null);
 return <section className="hc-guide" aria-label="Opciones del asistente"><div className="hc-guide-heading"><strong>{section?titles[section]:'Elige una opción para comenzar'}</strong>{section&&<button onClick={()=>setSection(null)}>← Menú</button>}</div>{section?<GuidedCatalog key={section} section={section} {...props}/>:<div className="hc-guide-options">{(Object.keys(titles) as Section[]).map(key=><button type="button" key={key} onClick={()=>setSection(key)}><span className={'hc-option-icon hc-option-'+key}><ChatIcon name={key==='cursos'?'book':key==='servicios'?'tools':'help'} size={18}/></span><span className="hc-option-copy"><strong>{titles[key]}</strong><small>Consultar contenido publicado</small></span><span className="hc-option-arrow"><ChatIcon name="arrow" size={14}/></span></button>)}{quickAsks.map(item=><button type="button" key={item.label} onClick={()=>props.onAsk(item.question)}><span className="hc-option-icon hc-option-contact"><ChatIcon name={item.icon} size={18}/></span><span className="hc-option-copy"><strong>{item.label}</strong><small>{item.hint}</small></span><span className="hc-option-arrow"><ChatIcon name="arrow" size={14}/></span></button>)}<button type="button" className="hc-option-write" onClick={props.onWrite}><span>Prefiero escribir mi consulta</span><ChatIcon name="send" size={14}/></button></div>}</section>;
}
