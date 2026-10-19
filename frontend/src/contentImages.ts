import { API_BASE } from './apiBase'

// Los uploads del mismo backend deben funcionar desde cualquier origen del frontend.
export function resolveContentImage(value: string): string {
  let path = value
  if (!value.startsWith('/')) {
    try {
      const url = new URL(value)
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return value
      path = url.pathname
      if (url.search || url.hash) return value
    } catch { return value }
  }
  return /^\/api\/uploads\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(path) ? API_BASE + path.slice(4) : value
}

// Solo se aplica a respuestas JSON; conserva textos, enlaces externos y campos privados.
export function resolveContentImages<T>(data: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, (key === 'imagen_url' || key === 'logo_url') && typeof item === 'string' ? resolveContentImage(item) : visit(item),
    ]))
  }
  return visit(data) as T
}
