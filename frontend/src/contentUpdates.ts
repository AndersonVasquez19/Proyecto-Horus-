export const CONTENT_CHANGE_EVENT='horus:content-updated'
export const CONTENT_CHANGE_KEY='horus-public-content-change'
export function notifyContentChange(resource:string){
 if(!['cursos','servicios','galeria','settings','contenido-original','convenios'].includes(resource))return
 window.dispatchEvent(new CustomEvent(CONTENT_CHANGE_EVENT,{detail:resource}))
 try{window.localStorage.setItem(CONTENT_CHANGE_KEY,JSON.stringify({resource,at:Date.now()}))}catch{/* El guardado ya finalizó aunque el navegador no admita almacenamiento local. */}
}
