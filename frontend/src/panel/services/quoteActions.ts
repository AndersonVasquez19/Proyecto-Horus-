// Lógica pura de las operaciones de Cotizaciones que ya existen en el backend y no tenían interfaz (Fase 4D):
// filtro de vencidas (`vencida=si`), duplicar (`POST cotizaciones/:id/duplicar`) y PDF (`GET cotizaciones/:id/pdf`).
// Sin React ni red: se prueba con `test:quote-actions`. No inventa endpoints ni campos.

// Clave de una operación lógica de duplicado. Solo debe ser única (no secreta); randomUUID exige contexto seguro (https o localhost).
export const newOperationKey = (): string => typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : 'op-' + Date.now().toString(36) + '-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

// Parámetros de la lista. `vencida=si` solo se envía activo; con él el estado se omite (el backend ya exige «enviada», y combinarlo con otro estado
// daría una lista vacía engañosa). El tablero muestra todos los estados: ignora el estado y también «vencidas» (su lote y sus indicadores son completos).
export function quoteListParams(opts: { board: boolean; page: number; query: string; state: string; overdue: boolean; limit: number }): URLSearchParams {
  const overdue = opts.overdue && !opts.board;
  const params = new URLSearchParams({ page: String(opts.board ? 1 : opts.page), limit: String(opts.limit), search: opts.query, estado: opts.board || overdue ? '' : opts.state });
  if (overdue) params.set('vencida', 'si');
  return params;
}

export interface DuplicateResult { id: number; numero: string; needsNewValidity: boolean }
// Respuesta de duplicar: `{ ok, item: { id, numero, … }, requiere_nueva_vigencia }`. Una respuesta incompleta devuelve null (se trata como incierta).
export function parseDuplicateResult(data: unknown): DuplicateResult | null {
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  const item = body?.item && typeof body.item === 'object' ? body.item as Record<string, unknown> : null;
  if (!body || body.ok !== true || !item || typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id < 1 || typeof item.numero !== 'string' || !item.numero) return null;
  return { id: item.id, numero: item.numero, needsNewValidity: body.requiere_nueva_vigencia === true };
}

export const DUPLICATE_UNCERTAIN = 'No pudimos confirmar si la copia se creó. Puede haberse guardado: revisa el listado antes de volver a intentarlo. Si lo reintentas desde esta misma ventana no se duplicará.';
export interface DuplicateFailure { kind: 'incierto' | 'definitivo'; message: string }
// Un fallo de red, un timeout, una cancelación o un 5xx no prueban que la copia no se creó. Solo una respuesta 4xx del backend es definitiva.
export function duplicateFailure(error: { status?: number; message?: string } | null | undefined, aborted: boolean): DuplicateFailure {
  const status = error?.status;
  if (aborted || typeof status !== 'number' || status >= 500 || status < 400) return { kind: 'incierto', message: DUPLICATE_UNCERTAIN };
  if (status === 404) return { kind: 'definitivo', message: 'La cotización original ya no existe. Actualiza el listado.' };
  return { kind: 'definitivo', message: error?.message || 'No se pudo duplicar la cotización.' };
}

// ---- PDF ----------------------------------------------------------------------------------------------------------------------
// Nombre del archivo: el que sugiere el backend (Content-Disposition) o, si no se entiende, uno propio a partir del número. Sin separadores de ruta.
export function quotePdfFileName(header: string | null | undefined, numero: string): string {
  const fallback = 'cotizacion-' + (numero.replace(/[^A-Za-z0-9._-]/g, '_') || 'documento') + '.pdf';
  const raw = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header ?? '')?.[1];
  if (!raw) return fallback;
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* se usa tal cual */ }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name || name === '_' || name.includes('..')) return fallback;
  name = name.slice(0, 120);
  return /\.pdf$/i.test(name) ? name : name + '.pdf';
}

export function pdfErrorText(status: number, serverMessage: unknown): string {
  const text = typeof serverMessage === 'string' ? serverMessage : '';
  if (status === 404) return text || 'La cotización ya no existe. Actualiza el listado.';
  if (status === 429) return text || 'Hay demasiadas solicitudes. Inténtalo de nuevo en unos segundos.';
  return 'No se pudo generar el PDF. Inténtalo de nuevo en unos minutos.';
}
