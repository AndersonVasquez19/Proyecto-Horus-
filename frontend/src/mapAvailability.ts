// Comprobación de si Google Maps es alcanzable desde el navegador. `navigator.onLine` solo indica que hay una interfaz
// de red activa (puede haber red local sin Internet), así que NO se usa como prueba definitiva de que el mapa cargará:
// únicamente sirve para descartar rápido el caso «sin red». Para el resto se intenta cargar un recurso público del mismo
// host que el mapa (imagen: no depende de CORS y la CSP del sitio ya permite `img-src https:`).
export const MAP_PROBE_URL = 'https://www.google.com/favicon.ico'
export const MAP_PROBE_TIMEOUT_MS = 6000

export interface ProbeImage {
  onload: ((ev: Event) => unknown) | null
  onerror: ((ev: Event) => unknown) | null
  src: string
}

export interface ProbeOptions {
  url?: string
  timeoutMs?: number
  createImage?: () => ProbeImage
}

// Resuelve `true` si el recurso carga antes del tiempo límite y `false` si falla o se agota el tiempo. Nunca rechaza.
export function probeMapReachable({ url = MAP_PROBE_URL, timeoutMs = MAP_PROBE_TIMEOUT_MS, createImage = () => new Image() }: ProbeOptions = {}): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const img = createImage()
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    img.onload = () => finish(true)
    img.onerror = () => finish(false)
    try {
      // El parámetro evita que una respuesta en caché oculte una pérdida de conexión posterior.
      img.src = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now()
    } catch {
      finish(false)
    }
  })
}
