// Ruta a la que se vuelve después de volver a iniciar sesión. Solo se aceptan rutas internas del panel conocidas, sin
// destinos externos (evita redirecciones abiertas) y solo con parámetros de navegación inocuos: nunca tokens, correos,
// textos ni identificadores de otras cuentas. Sin importaciones y sin sintaxis no "borrable" para probarlo con `node --test`.
const ALLOWED_PATHS = ['/admin/dashboard', '/admin/messages']
const KEPT_PARAMS = ['section', 'seccion', 'estado', 'vista', 'id']
const BASE = 'https://horus.invalid'

export function safeAdminReturn(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 300) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32)) return null
  let url: URL
  try { url = new URL(value, BASE) } catch { return null }
  if (url.origin !== BASE || !ALLOWED_PATHS.includes(url.pathname)) return null
  const params = new URLSearchParams()
  for (const key of KEPT_PARAMS) {
    const found = url.searchParams.get(key)
    if (found && /^[A-Za-z0-9_-]{1,40}$/.test(found)) params.set(key, found)
  }
  const search = params.toString()
  return url.pathname + (search ? '?' + search : '')
}
