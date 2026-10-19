import { API_BASE, CONTENT_API_BASE, CONTENT_PROVIDER } from './apiBase'
import { resolveContentImages } from './contentImages'
import { publicBaseFor } from './contentSource'

export class PublicApiError extends Error {
  constructor(message: string, public status: number, public details: string[] = []) { super(message) }
}
export async function publicRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Lecturas de contenido: NestJS salvo que el build elija Laravel (contentSource.ts). Lo demás, siempre NestJS.
  const base = publicBaseFor(path, options.method, API_BASE, CONTENT_PROVIDER, CONTENT_API_BASE)
  const response = await fetch(base + '/' + path, options)
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.ok === false) {
    const details = data?.mensaje || data?.message
    const messages: string[] = Array.isArray(details) ? details : [typeof details === 'string' ? details : 'No se pudo completar la solicitud.']
    throw new PublicApiError(messages.join(' · '), response.status, messages)
  }
  if (!data) throw new PublicApiError('El servidor devolvió una respuesta inválida.', response.status)
  return resolveContentImages(data) as T
}
