import { useRequestStatus } from '../../hooks/useRequestStatus';
import { useEffect, useState } from 'react';
import { useLatest } from '../../hooks/useLatest';
import { useAdminAuth } from '../../context';
import { panelRequest, errorMessage } from '../../services/panelApi';
import type { Row } from '../../types/workspace';
export interface CollectionResponse { items?:Row[];messages?:Row[];pagination?:{total:number;pages:number};metrics?:Record<string,number> }
export const collectionRows=(data:CollectionResponse)=>data.items||data.messages||[];
export function useCollection(endpoint:string,catalog=false,revision=0,params='page=1&limit=20'){
 const {token}=useAdminAuth();const latestToken=useLatest(token);const [data,setData]=useState<CollectionResponse>({});
 const {loading,error,setLoading,setError}=useRequestStatus(JSON.stringify([endpoint,catalog,revision,params]));
 useEffect(()=>{const c=new AbortController();let live=true;const timeout=window.setTimeout(()=>c.abort(),15000);
 void panelRequest<CollectionResponse>(endpoint+'?'+params,latestToken.current,'GET',undefined,c.signal).then(r=>{if(endpoint==='messages'&&r.pagination&&!Array.isArray(r.messages))throw new Error('El servidor devolvió una lista con un formato inesperado.');if(live)setData(r)}).catch(e=>{if(live)setError(c.signal.aborted?'La consulta tardó demasiado. Reintenta la carga.':errorMessage(e))}).finally(()=>{window.clearTimeout(timeout);if(live)setLoading(false)});
 return()=>{live=false;c.abort();window.clearTimeout(timeout)};
 },[latestToken,endpoint,catalog,revision,params,setLoading,setError]);
 return{rows:collectionRows(data),loading,error,total:data.pagination?.total||0,pages:data.pagination?.pages||0,metrics:data.metrics||{}};
}
export const dateLabel=(value:unknown,calendarDate=false)=>{
 const raw=calendarDate&&value?String(value).slice(0,10)+'T12:00:00':String(value);
 if(!value||Number.isNaN(new Date(raw).getTime()))return'Sin fecha';
 return new Date(raw).toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric'});
};
export const plainText=(value:unknown)=>String(value??'').replace(/<[^>]*>/g,'');
