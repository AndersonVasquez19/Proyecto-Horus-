import { useEffect, useState } from 'react'
import { CONTENT_CHANGE_EVENT, CONTENT_CHANGE_KEY } from '../contentUpdates'
import { publicRequest } from '../api'
import { useRequestStatus } from '../panel/hooks/useRequestStatus'
import { PUBLIC_ERROR_TEXTS, classifyPublicError } from '../publicErrors'
import type { PublicErrorKind } from '../publicErrors'

export function usePublicResource<T>(path: string) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ path: string; data: T } | null>(null)
  const key = path + ':' + revision
  const { loading, error, setLoading, setError } = useRequestStatus(key)
  // Tipo de fallo de la consulta actual (404, red, servidor...): los detalles distinguen "no existe" de "no se pudo cargar".
  const [failure, setFailure] = useState<{ key: string; kind: PublicErrorKind } | null>(null)
  useEffect(()=>{
    const resource=path.split(/[/?]/)[0]
    const matches=(value:string)=>value===resource||value==='contenido-original'
    const local=(event:Event)=>{if(matches((event as CustomEvent<string>).detail))setRevision(v=>v+1)}
    const other=(event:StorageEvent)=>{if(event.key!==CONTENT_CHANGE_KEY||!event.newValue)return;try{const value=JSON.parse(event.newValue) as {resource?:string};if(value.resource&&matches(value.resource))setRevision(v=>v+1)}catch{/* Ignora marcadores inválidos. */}}
    window.addEventListener(CONTENT_CHANGE_EVENT,local);window.addEventListener('storage',other)
    return()=>{window.removeEventListener(CONTENT_CHANGE_EVENT,local);window.removeEventListener('storage',other)}
  },[path])
  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    publicRequest<T>(path, { signal: controller.signal, cache: 'no-store' })
      .then(data => { if (current) setResult({ path, data }) })
      .catch(caught => {
        if (!current) return
        const kind = classifyPublicError(caught, controller.signal.aborted) // abortada con la consulta vigente = se agotó el tiempo
        setFailure({ key, kind }); setError(PUBLIC_ERROR_TEXTS[kind]) // el texto original (red o backend) no llega al visitante
      })
      .finally(() => { window.clearTimeout(timeout); if (current) setLoading(false) })
    return () => { current = false; controller.abort(); window.clearTimeout(timeout) }
  }, [path, revision, key, setLoading, setError])
  const errorKind = error && failure?.key === key ? failure.kind : null
  return { data: result?.path === path ? result.data : null, loading, error, errorKind, reload: () => setRevision(value => value + 1) }
}
