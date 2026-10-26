// Lógica pura del tablero de cotizaciones (sin React, sin red): agrupación por estado, indicadores del lote cargado y formato.
// Todo se calcula con campos que el backend ya devuelve en GET /admin/cotizaciones. No inventa estados ni métricas.
import type { Quote } from '../types/quotes';

// Estados comerciales reales del backend (mismas claves que `quoteTransitions`; la prueba lo contrasta). Es también el orden de las columnas.
export const PIPELINE_STATES = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada'] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];
// Máximo que admite el backend por consulta (cotizacion.dto.ts: @Max(100)).
export const PIPELINE_LIMIT = 100;
// Por debajo de este número de cotizaciones resueltas (aceptadas + rechazadas) la tasa no es representativa y no se muestra.
export const MIN_RESOLVED_FOR_RATE = 3;
// Estados cuyo importe sigue «en juego» (aún no se aceptó, rechazó ni anuló).
export const OPEN_STATES: readonly PipelineState[] = ['borrador', 'enviada'];

// `vencida` la deriva el backend (enviada con vigencia pasada); no está en el tipo base `Quote`.
export type PipelineQuote = Quote & { vencida?: boolean };

export interface CurrencyAmount { moneda: string; cents: number }
export interface PipelineSummary {
  loaded: number;
  total: number;
  truncated: boolean;
  counts: Record<PipelineState, number>;
  unclassified: number;
  openAmounts: CurrencyAmount[];
  accepted: number;
  resolved: number;
  acceptanceRate: number | null;
}

export const isPipelineState = (value: unknown): value is PipelineState => typeof value === 'string' && (PIPELINE_STATES as readonly string[]).includes(value);

export function emptyColumns(): Record<PipelineState, PipelineQuote[]> {
  return { borrador: [], enviada: [], aceptada: [], rechazada: [], anulada: [] };
}

// Agrupa conservando el orden recibido (el backend entrega de la más reciente a la más antigua). Un estado desconocido no se reasigna a otra columna.
export function groupByState(items: readonly PipelineQuote[]): { columns: Record<PipelineState, PipelineQuote[]>; unclassified: PipelineQuote[] } {
  const columns = emptyColumns();
  const unclassified: PipelineQuote[] = [];
  for (const item of items) {
    if (isPipelineState(item.estado)) columns[item.estado].push(item);
    else unclassified.push(item);
  }
  return { columns, unclassified };
}

// Importe en céntimos enteros (evita el error acumulado de sumar decimales). Un valor no numérico devuelve null y se excluye de las sumas.
export function toCents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

const currencyOf = (item: PipelineQuote) => String(item.moneda ?? '').trim().toUpperCase() || 'S/M';

// Suma por moneda; nunca mezcla monedas distintas.
export function sumByCurrency(items: readonly PipelineQuote[], states: readonly PipelineState[]): CurrencyAmount[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!isPipelineState(item.estado) || !states.includes(item.estado)) continue;
    const cents = toCents(item.total);
    if (cents === null) continue;
    const code = currencyOf(item);
    totals.set(code, (totals.get(code) ?? 0) + cents);
  }
  return [...totals].map(([moneda, cents]) => ({ moneda, cents })).sort((a, b) => a.moneda.localeCompare(b.moneda));
}

// `total` es el de la consulta completa (pagination.total); `items` es solo el lote cargado. Los indicadores describen únicamente ese lote.
export function summarizePipeline(items: readonly PipelineQuote[], total: number): PipelineSummary {
  const { columns, unclassified } = groupByState(items);
  const counts = Object.fromEntries(PIPELINE_STATES.map(state => [state, columns[state].length])) as Record<PipelineState, number>;
  const accepted = counts.aceptada;
  const resolved = counts.aceptada + counts.rechazada;
  const safeTotal = Number.isFinite(total) && total >= items.length ? total : items.length;
  return {
    loaded: items.length,
    total: safeTotal,
    truncated: safeTotal > items.length,
    counts,
    unclassified: unclassified.length,
    openAmounts: sumByCurrency(items, OPEN_STATES),
    accepted,
    resolved,
    acceptanceRate: resolved >= MIN_RESOLVED_FOR_RATE ? Math.round((accepted / resolved) * 1000) / 10 : null,
  };
}

const MONEY = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// «1,234.50 PEN»: el mismo criterio de la tabla (importe y código de moneda), con separador de miles.
export const formatMoney = (amount: number, moneda: string) => MONEY.format(amount) + ' ' + moneda;
export const formatCents = (cents: number, moneda: string) => formatMoney(cents / 100, moneda);
export const formatQuoteTotal = (item: PipelineQuote) => {
  const cents = toCents(item.total);
  return cents === null ? 'Importe no disponible' : formatCents(cents, currencyOf(item));
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Fecha de calendario AAAA-MM-DD → «5 oct 2026», sin pasar por Date (evita cambiar el día por zona horaria).
export function formatCalendarDate(value: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return '';
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  return Number(match[3]) + ' ' + MONTHS[month - 1] + ' ' + match[1];
}
// Instante ISO (createdAt) → fecha de calendario en Lima.
export function formatCreatedDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return formatCalendarDate(parts);
}

export type QuoteView = 'tabla' | 'tablero';
export const viewFromParam = (value: string | null): QuoteView => (value === 'tablero' ? 'tablero' : 'tabla');
// Devuelve nuevos parámetros con la vista aplicada y conserva todos los demás (section, contacto…). La tabla es la predeterminada y no se escribe.
export function withView(params: URLSearchParams, view: QuoteView): URLSearchParams {
  const next = new URLSearchParams(params);
  if (view === 'tablero') next.set('vista', 'tablero');
  else next.delete('vista');
  return next;
}
