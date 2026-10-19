export const IMPORT_FIELDS = { doc_numero: 'DNI', nombres: 'Nombres', apellidos: 'Apellidos', email: 'Correo', telefono: 'Teléfono', tipo_persona: 'Tipo de persona' } as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
export type ImportMapping = Partial<Record<ImportField, number>>;
export interface ImportFile { nombre: string; mime: string; contenido: string }
export interface ImportInspection { columnas: string[]; encabezado: number; mapeo: ImportMapping; muestra: string[][]; codificacion: string; separador: string }
export interface ImportInput extends ImportFile { convocatoria_id: number; encabezado: number; codificacion: string; mapeo: ImportMapping }
export interface ImportSummary { importados: number; omitidos: number; rechazados: number; estudiantes_nuevos: number }
export interface ImportRow { fila: number; datos?: { doc_numero: string; nombres: string; apellidos: string }; estado: string; errores: string[]; avisos: string[] }
export interface ImportPreview { filas: ImportRow[]; resumen: ImportSummary; bloqueos: string[]; destino: { id: number; nombre: string; curso: string; capacidad: number | null; disponibles: number | null }; comprobante: string }
export interface ImportResult { operacion: string; resumen: ImportSummary; filas: ImportRow[] }
export function validateImportFile(file: Pick<File, 'name' | 'size'>): string {
  if (!/\.csv$/i.test(file.name)) return 'Exporta una hoja de Excel como CSV. XLSX todavía no está disponible.';
  if (!file.size) return 'El archivo está vacío.';
  return file.size > 49152 ? 'El archivo supera 48 KiB. Divide la hoja en lotes de hasta 200 filas.' : '';
}
export function importOperationId(receipt: string): string {
  try { const id: unknown = JSON.parse(atob(receipt.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).id; return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? id : ''; } catch { return ''; }
}
