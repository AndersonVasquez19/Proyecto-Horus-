import { displayDate } from '../reportes.periodo';
import type { CellValue, ColumnKind, ReportSummaryItem } from '../reportes.types';

// Caracteres de control que XML 1.0 no admite (todos los C0 salvo tabulación y saltos) y sustitutos UTF-16 sueltos. Se retiran en
// los tres formatos para que el mismo texto se vea igual en todos (y el XLSX nunca quede corrupto).
const INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const cleanText = (value: string) => value.replace(INVALID_CHARS, '');

// Inyección de fórmulas (CSV/Excel): un texto que empieza por =, +, -, @ (también sus variantes de ancho completo), o por
// tabulación o salto de línea, se trata como fórmula al abrirlo. Mismo criterio que el CSV del panel (frontend listRecords.ts).
const FORMULA_START = /^\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/;
export const isFormulaLike = (text: string) => FORMULA_START.test(text);
export const neutralizeFormula = (text: string) => isFormulaLike(text) ? "'" + text : text;

export const NOT_APPLICABLE = 'No aplica';
export const PERSONAL_DATA_NOTICE = 'Contiene datos personales. Trátalo de forma confidencial y no lo compartas fuera de Horus Group SRL.';

// Texto plano de una celda para CSV (fechas ISO, inequívocas para Excel en cualquier configuración regional) o PDF (DD/MM/AAAA).
// Un texto en una columna numérica (la etiqueta «Total») se trata como texto.
export function cellText(value: CellValue, kind: ColumnKind, target: 'csv' | 'pdf'): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const text = cleanText(value);
    if (target === 'csv') return neutralizeFormula(text);
    if (kind === 'fecha') return displayDate(text);
    if (kind === 'fecha_hora') return displayDate(text.slice(0, 10)) + text.slice(10);
    return text;
  }
  if (kind === 'decimal') return value.toFixed(1);
  if (kind === 'importe') return value.toFixed(2);
  return String(value);
}

export function summaryText(entry: ReportSummaryItem): string {
  if (entry.valor === null) return NOT_APPLICABLE;
  return entry.tipo === 'decimal' ? entry.valor.toFixed(1) : entry.tipo === 'importe' ? entry.valor.toFixed(2) : String(entry.valor);
}

// Nombre de archivo ASCII seguro para Content-Disposition: horus-reporte-<tipo>-<AAAAMMDD-HHmm>.<ext>
export function reportFileName(tipo: string, generadoLocal: string, extension: string): string {
  const stamp = generadoLocal.replace(/[^0-9]/g, '').replace(/^(\d{8})(\d{4}).*$/, '$1-$2');
  return 'horus-reporte-' + tipo.replace(/[^a-z0-9-]/g, '') + '-' + stamp + '.' + extension;
}
