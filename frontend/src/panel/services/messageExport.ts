// Exportación CSV de las consultas filtradas. Sin importaciones, para poder probarlo con `node --test`.
// La descarga se arma con el endpoint paginado actual, página a página (en serie, lotes de 100) y solo se entrega si el conjunto es completo y coherente.

export type ExportErrorCode = 'aborted' | 'failed' | 'inconsistent' | 'too_large'
export class ExportError extends Error {
  code: ExportErrorCode // sin «parameter property»: Node solo "borra" tipos al probar este módulo
  constructor(code: ExportErrorCode, message: string) { super(message); this.code = code }
}
export interface PageResult<T> { rows: T[]; total: number; pages: number }

export const EXPORT_PAGE_SIZE = 100 // máximo que acepta el servidor
export const EXPORT_MAX_PAGES = 100 // 10 000 consultas: más allá se pide acotar con filtros en vez de cargar todo el inventario

// Recorre las páginas y devuelve TODOS los registros, o lanza ExportError sin devolver nada parcial.
// Comprobaciones (conservadoras, sin reintentos automáticos):
//  - el total y el número de páginas no cambian entre páginas (alguien registró, eliminó o movió consultas durante la descarga);
//  - no hay ids repetidos (un desplazamiento del orden entre páginas repetiría registros);
//  - la cantidad recibida coincide con el total anunciado.
// Limitación: con paginación por desplazamiento, un registro que sale del conjunto mientras otro entra a la vez dejaría el total intacto y no se detecta.
export async function fetchAllPages<T extends { id: number }>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  options: { maxPages?: number; signal?: AbortSignal; onProgress?: (done: number, pages: number) => void } = {},
): Promise<T[]> {
  const { maxPages = EXPORT_MAX_PAGES, signal, onProgress } = options
  const read = async (page: number) => {
    if (signal?.aborted) throw new ExportError('aborted', 'Exportación cancelada. No se descargó ningún archivo.')
    try { return await fetchPage(page) }
    catch (error) {
      if (error instanceof ExportError) throw error
      if (signal?.aborted) throw new ExportError('aborted', 'Exportación cancelada. No se descargó ningún archivo.')
      throw new ExportError('failed', 'No se pudo completar la exportación (falló la página ' + page + '). No se descargó ningún archivo; vuelve a intentarlo.')
    }
  }
  const valid = (result: PageResult<T>) => Array.isArray(result?.rows) && Number.isInteger(result.total) && result.total >= 0 && Number.isInteger(result.pages) && result.pages >= 0
  const first = await read(1)
  if (!valid(first)) throw new ExportError('failed', 'El servidor devolvió una lista con un formato inesperado. No se descargó ningún archivo.')
  if (first.pages > maxPages) throw new ExportError('too_large', 'Hay demasiadas consultas para exportar de una vez (' + first.total + '). Acota la búsqueda o los filtros e inténtalo de nuevo.')
  const all: T[] = [...first.rows], seen = new Set(first.rows.map(row => row.id))
  if (seen.size !== first.rows.length) throw new ExportError('inconsistent', 'Los datos recibidos contienen registros repetidos. No se descargó ningún archivo.')
  onProgress?.(1, first.pages)
  for (let page = 2; page <= first.pages; page++) {
    const next = await read(page)
    if (!valid(next) || next.total !== first.total || next.pages !== first.pages) throw new ExportError('inconsistent', 'Las consultas cambiaron mientras se exportaba. No se descargó ningún archivo; vuelve a exportar.')
    for (const row of next.rows) {
      if (seen.has(row.id)) throw new ExportError('inconsistent', 'Las consultas cambiaron mientras se exportaba. No se descargó ningún archivo; vuelve a exportar.')
      seen.add(row.id); all.push(row)
    }
    onProgress?.(page, first.pages)
  }
  if (all.length !== first.total) throw new ExportError('inconsistent', 'La cantidad de consultas recibidas no coincide con el total. No se descargó ningún archivo; vuelve a exportar.')
  return all
}

// Columnas estables. Solo datos de la consulta: nunca notas privadas, respuestas internas ni historial (no forman parte de este listado).
export const MESSAGE_EXPORT_COLUMNS = ['id', 'nombre', 'correo', 'telefono', 'asunto', 'origen', 'estado', 'fecha'] as const
export function toExportRows(rows: Array<Record<string, unknown>>) {
  return rows.map(row => ({
    id: row.id, nombre: row.nombre, correo: row.email, telefono: row.telefono, asunto: row.asunto,
    origen: String(row.asunto ?? '').startsWith('[Chatbot]') ? 'Chatbot' : 'Web / manual',
    estado: row.estado, // estado administrativo efectivo que entrega el servidor (incluye «archivado»)
    fecha: row.createdAt,
  }))
}
