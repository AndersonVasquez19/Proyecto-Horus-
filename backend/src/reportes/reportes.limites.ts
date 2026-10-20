import type { ReportFormat } from './reportes.types';

// Límites de volumen y memoria de los reportes. Una exportación se genera completa en memoria antes de responder (así un error
// nunca entrega un archivo a medias); estos topes acotan ese consumo. Si el filtro supera el tope, se responde 422 y se pide
// acotar las fechas o los filtros: nunca se trunca el archivo en silencio.

// Rango máximo entre «desde» y «hasta» (unos 10 años). También acota la serie mensual del resumen a 121 meses.
export const MAX_RANGE_DAYS = 3660;

// Filas máximas de la tabla de un archivo exportado, por formato. El PDF es más costoso por fila (maquetación y páginas).
export const MAX_EXPORT_ROWS: Readonly<Record<ReportFormat, number>> = Object.freeze({ csv: 20_000, xlsx: 20_000, pdf: 3_000 });

// Tope de filas que el servidor recorre para calcular cualquier reporte (también la consulta JSON paginada). Protege la memoria
// de los reportes que agregan en el servidor (ediciones, ocupación, matrículas por edición).
export const MAX_REPORT_ROWS = 20_000;

// Lectura por lotes de las tablas grandes (estudiantes y matrículas), dentro de la misma transacción de solo lectura.
export const BATCH_SIZE = 1_000;

// Exportaciones simultáneas por proceso. Una más responde 429 sin generar nada.
export const MAX_CONCURRENT_EXPORTS = 2;

// Tiempo máximo de la transacción de lectura de un reporte (ms).
export const REPORT_TRANSACTION_TIMEOUT_MS = 30_000;

// Consulta JSON paginada (mismo criterio que las listas del panel).
export const PREVIEW_MAX_LIMIT = 100;
