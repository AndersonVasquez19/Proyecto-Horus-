// Origen de las lecturas públicas de contenido. Sin importaciones ni sintaxis que no sea "borrable"
// para poder probarlo con `node --test` (tests/content-source.test.mjs).
//
// NestJS es el proveedor predeterminado. Con VITE_CONTENT_PROVIDER=laravel, solo las lecturas GET
// de estos recursos se piden a la API de contenido de Laravel; formularios, chatbot, sesión, panel
// e imágenes subidas (/api/uploads) siguen en NestJS.

export const CONTENT_RESOURCES = ['cursos', 'servicios', 'preguntas-frecuentes', 'galeria', 'convenios', 'settings'] as const

export type ContentProvider = 'nestjs' | 'laravel'

export function contentResource(path: string): string {
  return path.replace(/^\/+/, '').split(/[/?#]/)[0] ?? ''
}

// Base a la que se añade '/' + path. Cualquier valor no reconocido vuelve a NestJS.
export function publicBaseFor(path: string, method: string | undefined, apiBase: string, provider: string | undefined, contentBase: string | undefined): string {
  const reading = !method || method.toUpperCase() === 'GET'
  const managed = (CONTENT_RESOURCES as readonly string[]).includes(contentResource(path))
  return provider === 'laravel' && contentBase && reading && managed ? contentBase.replace(/\/+$/, '') : apiBase
}
