export function resolveApiBase(value, hosted = false) {
  const base = (value || '').trim().replace(/\/+$/, '') || '/api'
  if (base === '/api' && !hosted) return base
  let url
  try { url = new URL(base) } catch {
    throw new Error('Configura VITE_API_BASE_URL con la URL completa del backend, por ejemplo https://tu-api.vercel.app/api')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/api') {
    throw new Error('VITE_API_BASE_URL debe ser una URL HTTP(S) terminada en /api, sin credenciales ni parámetros')
  }
  if (hosted && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('En Vercel, VITE_API_BASE_URL debe apuntar a un backend público con HTTPS')
  }
  return base
}

// Proveedor del contenido público (cursos, servicios, preguntas, galería, convenios y ajustes).
// Por defecto NestJS: sin variables, el sitio se comporta exactamente como antes.
// «laravel» exige la URL absoluta de la API de contenido de Laravel, terminada en /api/contenido.
export function resolveContentSource(provider, value, hosted = false) {
  const name = (provider || '').trim().toLowerCase() || 'nestjs'
  if (name === 'nestjs') return { provider: 'nestjs', base: '' }
  if (name !== 'laravel') throw new Error('VITE_CONTENT_PROVIDER debe ser «nestjs» (predeterminado) o «laravel»')
  const base = (value || '').trim().replace(/\/+$/, '')
  let url
  try { url = new URL(base) } catch {
    throw new Error('Con VITE_CONTENT_PROVIDER=laravel configura VITE_CONTENT_API_BASE_URL, por ejemplo https://academico.example.com/api/contenido')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/api/contenido') {
    throw new Error('VITE_CONTENT_API_BASE_URL debe ser una URL HTTP(S) terminada en /api/contenido, sin credenciales ni parámetros')
  }
  if (hosted && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('En Vercel, VITE_CONTENT_API_BASE_URL debe apuntar a un servidor público con HTTPS')
  }
  return { provider: 'laravel', base }
}
