// Reportes (GET /admin/reportes, /:tipo y /:tipo/exportar). Módulo puro, sin React ni red: lo cargan también las pruebas de Node.
// El catálogo del servidor manda: solo se ofrecen los filtros que cada reporte declara y nunca se envía uno que no admite (el backend
// respondería 400). La autorización sigue siendo del backend; aquí solo se decide qué mostrar.
export type ColumnKind = 'texto' | 'entero' | 'decimal' | 'importe' | 'fecha' | 'fecha_hora';
export type CellValue = string | number | null;
export type ReportFormat = 'csv' | 'xlsx' | 'pdf';
export const REPORT_FORMATS: Record<ReportFormat, string> = { csv: 'CSV', xlsx: 'Excel (XLSX)', pdf: 'PDF' };

export interface ReportEntry { tipo: string; titulo: string; descripcion: string; filtros: string[]; estados: string[]; datos_personales: boolean; ambito: 'academico' | 'comercial'; puede_consultar: boolean; puede_exportar: boolean }
export interface ReportCatalog { ok: boolean; formatos: string[]; limites: { filas_exportacion: Record<string, number>; filas_por_pagina: number }; reportes: ReportEntry[] }
export interface ReportColumn { clave: string; titulo: string; tipo: ColumnKind; ancho: number }
export interface ReportSummaryItem { clave: string; etiqueta: string; valor: number | null; tipo: 'entero' | 'decimal' | 'importe' }
export interface ReportDocument {
  tipo: string; titulo: string; descripcion: string; institucion: string; generado_local: string; periodo: { desde: string | null; hasta: string | null; etiqueta: string };
  filtros: { clave: string; etiqueta: string; valor: string }[]; resumen: ReportSummaryItem[]; notas: string[]; datos_personales: boolean;
  tabla: { titulo: string; columnas: ReportColumn[]; filas: Record<string, CellValue>[]; totales: Record<string, CellValue> | null; total_filas: number };
}
export interface ReportPage { ok: boolean; reporte: ReportDocument; pagination: { page: number; limit: number; total: number; pages: number } }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const KINDS = ['texto', 'entero', 'decimal', 'importe', 'fecha', 'fecha_hora'];
const isEntry = (value: unknown): value is ReportEntry => isObject(value) && typeof value.tipo === 'string' && /^[a-z-]+$/.test(value.tipo) && typeof value.titulo === 'string' && typeof value.descripcion === 'string'
  && strings(value.filtros) && strings(value.estados) && typeof value.datos_personales === 'boolean' && (value.ambito === 'academico' || value.ambito === 'comercial')
  && typeof value.puede_consultar === 'boolean' && typeof value.puede_exportar === 'boolean';
export const parseCatalog = (data: unknown): ReportCatalog | null => isObject(data) && Array.isArray(data.reportes) && data.reportes.every(isEntry) && strings(data.formatos) && isObject(data.limites) ? data as unknown as ReportCatalog : null;
export function parseReportPage(data: unknown): ReportPage | null {
  if (!isObject(data) || !isObject(data.reporte) || !isObject(data.pagination)) return null;
  const { tabla } = data.reporte;
  if (!isObject(tabla) || !Array.isArray(tabla.columnas) || !Array.isArray(tabla.filas) || !Array.isArray(data.reporte.resumen) || !Array.isArray(data.reporte.filtros) || !Array.isArray(data.reporte.notas)) return null;
  if (!tabla.columnas.every(column => isObject(column) && typeof column.clave === 'string' && typeof column.titulo === 'string' && KINDS.includes(String(column.tipo)))) return null;
  if (!tabla.filas.every(isObject) || !Number.isInteger(tabla.total_filas) || !['page', 'limit', 'total', 'pages'].every(key => Number.isInteger((data.pagination as Record<string, unknown>)[key]))) return null;
  return data as unknown as ReportPage;
}

export const FILTER_LABELS: Record<string, string> = { desde: 'Desde', hasta: 'Hasta', curso_id: 'Curso', convocatoria_id: 'Edición', estado: 'Estado', cumplimiento: 'Cumplimiento', archivo: 'Archivo', agrupar: 'Agrupar por', moneda: 'Moneda' };
// Valores que el backend admite para cada filtro de lista (ReporteFiltrosDto); `estado` sale del catálogo de cada reporte.
export const FILTER_OPTIONS: Record<string, Record<string, string>> = {
  cumplimiento: { pendiente: 'Pendiente', cumplido: 'Cumplido', no_cumplido: 'No cumplido' },
  archivo: { activos: 'Sin archivar', archivados: 'Archivadas', todos: 'Todas' },
  agrupar: { edicion: 'Edición', curso: 'Curso' },
  moneda: { PEN: 'Soles (PEN)', USD: 'Dólares (USD)' },
};
export const STATE_LABELS: Record<string, string> = {
  activos: 'Activos', inactivos: 'Inactivos', todos: 'Todos', planificada: 'Planificada', abierta: 'Abierta', cerrada: 'Cerrada', cancelada: 'Cancelada', activa: 'Activa', anulada: 'Anulada',
  borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', nuevo: 'Nuevo', en_proceso: 'En proceso',
};
export type ReportFilters = Record<'desde' | 'hasta' | 'curso_id' | 'convocatoria_id' | 'estado' | 'cumplimiento' | 'archivo' | 'agrupar' | 'moneda', string>;
export const EMPTY_FILTERS: ReportFilters = { desde: '', hasta: '', curso_id: '', convocatoria_id: '', estado: '', cumplimiento: '', archivo: '', agrupar: '', moneda: '' };

const validDate = (value: string) => /^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const MAX_DAYS = 3660;
// Mismas reglas de período que el servidor, para avisar antes de enviar; el servidor sigue validando.
export function filterErrors(entry: Pick<ReportEntry, 'filtros'>, filters: ReportFilters): Partial<Record<'desde' | 'hasta', string>> {
  const errors: Partial<Record<'desde' | 'hasta', string>> = {};
  const has = (key: string) => entry.filtros.includes(key);
  if (has('desde') && filters.desde && !validDate(filters.desde)) errors.desde = 'Introduce una fecha válida.';
  if (has('hasta') && filters.hasta && !validDate(filters.hasta)) errors.hasta = 'Introduce una fecha válida.';
  if (has('desde') && has('hasta') && !errors.desde && !errors.hasta && filters.desde && filters.hasta) {
    if (filters.desde > filters.hasta) errors.hasta = 'La fecha final no puede ser anterior a la inicial.';
    else if ((Date.parse(filters.hasta + 'T00:00:00Z') - Date.parse(filters.desde + 'T00:00:00Z')) / 86400000 + 1 > MAX_DAYS) errors.hasta = 'El período no puede superar los 3660 días.';
  }
  return errors;
}
// Solo los filtros que el reporte declara y que tienen valor: enviar uno no admitido responde 400. `page`/`limit` van en la consulta; la
// exportación nunca los lleva y añade `formato` (y `separador` solo en CSV).
export function reportQuery(entry: Pick<ReportEntry, 'filtros'>, filters: ReportFilters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  for (const key of entry.filtros) { const value = (filters as Record<string, string>)[key]; if (value) params.set(key, value); }
  for (const [key, value] of Object.entries(extra)) if (value !== '' && value !== undefined) params.set(key, String(value));
  return params;
}
export function exportQuery(entry: Pick<ReportEntry, 'filtros'>, filters: ReportFilters, format: ReportFormat, separator: 'punto_y_coma' | 'coma') {
  return reportQuery(entry, filters, { formato: format, ...(format === 'csv' ? { separador: separator } : {}) });
}
// ¿Cambió algún filtro desde la última consulta? (la vista previa mostrada ya no corresponde a lo escrito)
export const sameFilters = (a: ReportFilters, b: ReportFilters) => (Object.keys(EMPTY_FILTERS) as (keyof ReportFilters)[]).every(key => a[key] === b[key]);

const number = (value: number, digits: number) => value.toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const calendar = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;
// Un `null` en una fila es un dato ausente (nunca se inventa un cero); en el resumen significa «no aplica».
export function formatCell(value: CellValue | undefined, kind: ColumnKind): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return number(value, kind === 'decimal' ? 1 : kind === 'importe' ? 2 : 0);
  if (kind === 'fecha') return calendar(value);
  if (kind === 'fecha_hora') { const [day, time] = value.split(' '); return time ? calendar(day) + ' ' + time : calendar(day); }
  return value;
}
export const formatSummary = (item: ReportSummaryItem) => item.valor === null ? 'No aplica' : number(item.valor, item.tipo === 'decimal' ? 1 : item.tipo === 'importe' ? 2 : 0);
export const alignRight = (kind: ColumnKind) => kind === 'entero' || kind === 'decimal' || kind === 'importe';

const EXTENSION: Record<ReportFormat, string> = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };
// Nombre del archivo: el que sugiere el backend (Content-Disposition) o, si no se expone o no se entiende, uno propio. Se retiran separadores
// de ruta y caracteres de control; nunca se confía en un nombre con «..» ni vacío.
export function downloadFileName(header: string | null | undefined, tipo: string, format: ReportFormat, now = new Date()) {
  const fallback = 'horus-reporte-' + tipo.replace(/[^a-z-]/g, '') + '-' + now.toISOString().slice(0, 10).replace(/-/g, '') + '.' + EXTENSION[format];
  const raw = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header ?? '')?.[1];
  if (!raw) return fallback;
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* se usa tal cual */ }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  return name && name !== '_' && !name.includes('..') ? name.slice(0, 120) : fallback;
}

// Mensajes de una descarga fallida por estado HTTP. Los 400/404/422/429/503 traen un texto pensado para la persona (se conserva si es una
// cadena); un 500 o una respuesta sin cuerpo usan un mensaje fijo. Nunca se muestra un cuerpo que no sea texto del servidor.
export function downloadErrorText(status: number, serverMessage: unknown): string {
  const text = typeof serverMessage === 'string' ? serverMessage : Array.isArray(serverMessage) ? serverMessage.filter(item => typeof item === 'string').join(' · ') : '';
  if (status === 422) return (text || 'El reporte tiene demasiadas filas para este formato.') + ' Acota el período o los filtros.';
  if (status === 429) return text || 'Hay otras exportaciones en curso. Inténtalo de nuevo en unos segundos.';
  if (status === 400 || status === 404) return text || 'No se pudo generar el reporte con esos filtros.';
  if (status === 503) return 'El servicio de reportes no está disponible por ahora. Inténtalo más tarde.';
  return 'El servidor no pudo generar el archivo. Inténtalo de nuevo en unos minutos.';
}
