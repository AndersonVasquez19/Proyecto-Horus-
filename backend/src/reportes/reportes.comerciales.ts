import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HORAS_CONSULTA_ANTIGUA, MESSAGE_STATES } from '../attention/attention-rules';
import { QUOTE_STATES } from '../cotizaciones/quote-rules';
import type { ReporteFiltrosDto } from './reportes.dto';
import { BATCH_SIZE, MAX_REPORT_ROWS } from './reportes.limites';
import { LIMA_OFFSET_HOURS, Period, calendarDate, limaDateTime, limaToday, monthsBetween, toCalendar } from './reportes.periodo';
import type { ReportColumn, ReportRow, ReportSummaryItem, ReportTable } from './reportes.types';

// Reportes comerciales y de atención al cliente. Se construyen con el MISMO motor que los académicos (ReportesService.build): devuelven
// {resumen, tabla} y los tres formatos (CSV, XLSX y PDF) los renderizan. Todo se deriva de columnas que ya existen (cotizaciones.estado,
// moneda, validez, subtotal…total, createdAt; contactos.estado/origen/createdAt; attention_records.estado): sin migración.
//
// Lo que estos reportes SON y NO SON:
//  - Un importe «cotizado» es lo que Horus propuso por escrito. NO es un ingreso recibido ni una venta cobrada: el sistema no registra pagos,
//    facturas ni cobranzas. «Aceptada» es un REGISTRO administrativo (con nota opcional), no prueba de pago.
//  - Nunca se suman monedas distintas (PEN y USD): cada moneda tiene sus propias cifras.
//  - Son agregados u hojas de trabajo SIN datos personales: no incluyen cliente, correo, teléfono, documento, dirección, asunto ni mensaje de las
//    consultas. Para identificar un caso se usa su número (cotización) o su ID (consulta) en el panel, con los permisos de ese módulo.
type Tx = Prisma.TransactionClient;
type Filters = ReporteFiltrosDto;
export interface CommercialMode { window: { skip: number; take: number } | null; maxRows: number; limitLabel: string }
export interface CommercialBuilt { tabla: ReportTable; resumen: ReportSummaryItem[] }

export const QUOTE_STATE_LABELS: Readonly<Record<string, string>> = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', anulada: 'Anulada' };
export const INQUIRY_STATE_LABELS: Readonly<Record<string, string>> = { nuevo: 'Nuevo', en_proceso: 'En proceso', atendido: 'Atendido', archivado: 'Archivado' };
export const CURRENCIES = ['PEN', 'USD'] as const;
export const CURRENCY_LABELS: Readonly<Record<string, string>> = { PEN: 'Soles (PEN)', USD: 'Dólares (USD)' };
const ORIGIN_LABELS: Readonly<Record<string, string>> = { web: 'Formulario web', chatbot: 'Chatbot', manual: 'Registro manual' };

const col = (clave: string, titulo: string, tipo: ReportColumn['tipo'], ancho: number): ReportColumn => ({ clave, titulo, tipo, ancho });
const item = (clave: string, etiqueta: string, valor: number | null, tipo: 'entero' | 'decimal' | 'importe' = 'entero'): ReportSummaryItem => ({ clave, etiqueta, valor, tipo });
const percent = (part: number, whole: number) => whole > 0 ? Math.round((part * 1000) / whole) / 10 : null;
const money = (value: Prisma.Decimal | null | undefined) => value ? Number(value.toFixed(2)) : 0;
const createdRange = (p: Period) => p.fromUtc || p.toUtc ? { createdAt: { ...(p.fromUtc ? { gte: p.fromUtc } : {}), ...(p.toUtc ? { lt: p.toUtc } : {}) } } : {};
const monthOf = (date: Date) => new Date(date.getTime() - LIMA_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 7);
const labelOf = (labels: Readonly<Record<string, string>>, value: string) => labels[value] ?? value;
const currenciesFor = (q: Filters): readonly string[] => q.moneda ? [q.moneda] : CURRENCIES;

function checkSource(total: number, what: string) {
  if (total > MAX_REPORT_ROWS) throw new UnprocessableEntityException('El reporte recorre ' + total + ' ' + what + ' y el máximo es ' + MAX_REPORT_ROWS + '. Acota el período o los filtros.');
}
function checkOutput(total: number, mode: CommercialMode) {
  if (total > mode.maxRows) throw new UnprocessableEntityException('El reporte tiene ' + total + ' filas y el máximo para ' + mode.limitLabel + ' es ' + mode.maxRows + '. Acota el período o los filtros.');
}
const pageOf = <T>(mode: CommercialMode, rows: T[]): T[] => mode.window ? rows.slice(mode.window.skip, mode.window.skip + mode.window.take) : rows;

async function inBatches<T>(total: number, fetch: (skip: number, take: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = [];
  while (all.length < total) {
    const batch = await fetch(all.length, BATCH_SIZE);
    all.push(...batch);
    if (batch.length < BATCH_SIZE) break;
  }
  return all;
}

// Cotización con el filtro de período (fecha de creación) y de moneda.
const quoteWhere = (q: Filters, p: Period): Prisma.CotizacionWhereInput => ({ ...createdRange(p), ...(q.moneda ? { moneda: q.moneda } : {}) });

// ------------------------------------------------------------------------------------------------------------------------------
// 1. Cotizaciones por estado (conteos; sin importes)
export async function quotesByState(tx: Tx, q: Filters, p: Period): Promise<CommercialBuilt> {
  const groups = await tx.cotizacion.groupBy({ by: ['estado'], where: quoteWhere(q, p), orderBy: { estado: 'asc' }, _count: { _all: true } });
  const counts = new Map(groups.map(group => [group.estado, group._count._all]));
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const known = new Set<string>(QUOTE_STATES);
  // Un estado desconocido (dato histórico) no se descarta ni se oculta: aparece como fila propia para que el total siempre cuadre.
  const states = [...QUOTE_STATES, ...[...counts.keys()].filter(state => !known.has(state)).sort()];
  const open = (counts.get('borrador') ?? 0) + (counts.get('enviada') ?? 0);
  return {
    resumen: [
      item('total', 'Cotizaciones en el reporte', total), item('abiertas', 'Abiertas (borrador o enviada: aún sin decisión)', open),
      item('aceptadas', 'Aceptadas (registro administrativo)', counts.get('aceptada') ?? 0),
      item('tasa_aceptacion', 'Aceptadas sobre el total (%)', percent(counts.get('aceptada') ?? 0, total), 'decimal'),
    ],
    tabla: {
      titulo: 'Cotizaciones por estado', total_filas: states.length,
      columnas: [col('estado', 'Estado', 'texto', 18), col('cantidad', 'Cotizaciones', 'entero', 14), col('porcentaje', '% del total', 'decimal', 12)],
      filas: states.map(state => ({ estado: labelOf(QUOTE_STATE_LABELS, state), cantidad: counts.get(state) ?? 0, porcentaje: percent(counts.get(state) ?? 0, total) })),
      totales: { estado: 'Total', cantidad: total, porcentaje: total > 0 ? 100 : null },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------
// 2. Cotizaciones enviadas con la vigencia vencida (hoja de trabajo)
// Mismo criterio que isExpired / `vencida=si` del listado y HORUS Assistant: estado «enviada» y validez anterior al día de hoy en Lima.
export async function expiredQuotes(tx: Tx, q: Filters, p: Period, mode: CommercialMode, now: Date): Promise<CommercialBuilt> {
  const today = limaToday(now);
  const where: Prisma.CotizacionWhereInput = {
    estado: 'enviada', ...(q.moneda ? { moneda: q.moneda } : {}),
    // El período filtra por la FECHA DE VENCIMIENTO (validez); además debe haber vencido ya.
    validez: { lt: calendarDate(today), ...(p.desde ? { gte: calendarDate(p.desde) } : {}), ...(p.hasta ? { lte: calendarDate(p.hasta) } : {}) },
  };
  const total = await tx.cotizacion.count({ where });
  checkOutput(total, mode);
  const sums = await tx.cotizacion.groupBy({ by: ['moneda'], where, orderBy: { moneda: 'asc' }, _sum: { total: true }, _count: { _all: true } });
  const oldest = await tx.cotizacion.aggregate({ where, _min: { validez: true } });
  const rows = mode.window
    ? await tx.cotizacion.findMany({ where, orderBy: [{ validez: 'asc' }, { id: 'asc' }], skip: mode.window.skip, take: mode.window.take, select: { id: true, numero: true, moneda: true, total: true, validez: true, createdAt: true, contacto_id: true } })
    : await inBatches(total, (skip, take) => tx.cotizacion.findMany({ where, orderBy: [{ validez: 'asc' }, { id: 'asc' }], skip, take, select: { id: true, numero: true, moneda: true, total: true, validez: true, createdAt: true, contacto_id: true } }));
  const todayMs = calendarDate(today).getTime();
  const sumOf = (currency: string) => money(sums.find(group => group.moneda === currency)?._sum.total);
  const oldestDays = oldest._min.validez ? Math.round((todayMs - oldest._min.validez.getTime()) / 86_400_000) : null;
  return {
    resumen: [
      item('total', 'Cotizaciones enviadas con vigencia vencida', total),
      ...currenciesFor(q).map(c => item('importe_' + c.toLowerCase(), 'Importe cotizado vencido en ' + labelOf(CURRENCY_LABELS, c) + ' (no es ingreso)', sumOf(c), 'importe')),
      item('mayor_atraso', 'Mayor atraso (días desde el vencimiento)', oldestDays),
    ],
    tabla: {
      titulo: 'Cotizaciones vencidas', total_filas: total, totales: null,
      columnas: [
        col('numero', 'Número', 'texto', 18), col('moneda', 'Moneda', 'texto', 8), col('total', 'Importe cotizado', 'importe', 16), col('vigencia', 'Vigencia hasta', 'fecha', 13),
        col('dias', 'Días vencida', 'entero', 12), col('creada', 'Creada', 'fecha_hora', 17), col('consulta', 'Con consulta de origen', 'texto', 14),
      ],
      filas: rows.map(row => ({
        numero: row.numero, moneda: row.moneda, total: money(row.total), vigencia: toCalendar(row.validez), dias: Math.round((todayMs - row.validez.getTime()) / 86_400_000),
        creada: limaDateTime(row.createdAt), consulta: row.contacto_id ? 'Sí' : 'No',
      })),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------
// 3. Importes cotizados por estado y moneda
export async function quoteAmounts(tx: Tx, q: Filters, p: Period): Promise<CommercialBuilt> {
  const where: Prisma.CotizacionWhereInput = { ...quoteWhere(q, p), ...(q.estado ? { estado: q.estado } : {}) };
  const groups = await tx.cotizacion.groupBy({
    by: ['moneda', 'estado'], where, orderBy: [{ moneda: 'asc' }, { estado: 'asc' }],
    _count: { _all: true }, _sum: { subtotal: true, descuento: true, impuesto: true, total: true },
  });
  const order = (state: string) => { const i = (QUOTE_STATES as readonly string[]).indexOf(state); return i < 0 ? 99 : i; };
  const sorted = [...groups].sort((a, b) => a.moneda.localeCompare(b.moneda) || order(a.estado) - order(b.estado) || a.estado.localeCompare(b.estado));
  const totalOf = (currency: string, state: string) => money(groups.find(group => group.moneda === currency && group.estado === state)?._sum.total);
  const countOf = (currency: string) => groups.filter(group => group.moneda === currency).reduce((sum, group) => sum + group._count._all, 0);
  const summary: ReportSummaryItem[] = [item('cotizaciones', 'Cotizaciones en el reporte', groups.reduce((sum, group) => sum + group._count._all, 0))];
  for (const c of currenciesFor(q)) {
    const tag = c.toLowerCase(), label = labelOf(CURRENCY_LABELS, c);
    summary.push(
      item('cotizaciones_' + tag, 'Cotizaciones en ' + label, countOf(c)),
      item('enviadas_' + tag, 'Importe en propuestas enviadas, pendientes de respuesta — ' + label, totalOf(c, 'enviada'), 'importe'),
      item('aceptadas_' + tag, 'Importe en propuestas aceptadas (registro administrativo, no es ingreso cobrado) — ' + label, totalOf(c, 'aceptada'), 'importe'),
    );
  }
  return {
    resumen: summary,
    tabla: {
      titulo: 'Importes por estado', total_filas: sorted.length,
      // Sin fila de totales: sumar soles con dólares sería incorrecto. Cada fila ya lleva su moneda.
      totales: null,
      columnas: [
        col('moneda', 'Moneda', 'texto', 8), col('estado', 'Estado', 'texto', 14), col('cantidad', 'Cotizaciones', 'entero', 13), col('subtotal', 'Subtotal', 'importe', 15),
        col('descuento', 'Descuento', 'importe', 15), col('impuesto', 'Impuesto', 'importe', 15), col('total', 'Importe total cotizado', 'importe', 19),
      ],
      filas: sorted.map(group => ({
        moneda: group.moneda, estado: labelOf(QUOTE_STATE_LABELS, group.estado), cantidad: group._count._all, subtotal: money(group._sum.subtotal),
        descuento: money(group._sum.descuento), impuesto: money(group._sum.impuesto), total: money(group._sum.total),
      })),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------
// Consultas de Atención (mensajes). El estado de una consulta es el del seguimiento si existe y, si no, el de la consulta
// (message-state.ts: COALESCE(attention_records.estado, contactos.estado)). El seguimiento se une por (recurso='messages', registro_id)
// y no por el FK histórico `contacto_id`, igual que la bandeja y el seguimiento. No se leen nombre, correo, teléfono, asunto ni mensaje.
export interface Inquiry { id: number; estado: string; origen: string; createdAt: Date }

async function loadInquiries(tx: Tx, where: Prisma.ContactoWhereInput): Promise<Inquiry[]> {
  const total = await tx.contacto.count({ where });
  checkSource(total, 'consultas');
  const base = await inBatches(total, (skip, take) => tx.contacto.findMany({ where, orderBy: { id: 'asc' }, skip, take, select: { id: true, estado: true, origen: true, createdAt: true } }));
  const states = new Map<number, string>();
  for (let i = 0; i < base.length; i += BATCH_SIZE) {
    const ids = base.slice(i, i + BATCH_SIZE).map(row => row.id);
    const records = await tx.attentionRecord.findMany({ where: { recurso: 'messages', registro_id: { in: ids } }, select: { registro_id: true, estado: true } });
    for (const record of records) states.set(record.registro_id, record.estado);
  }
  return base.map(row => ({ id: row.id, estado: states.get(row.id) ?? row.estado, origen: row.origen, createdAt: row.createdAt }));
}
const isOpen = (inquiry: Inquiry) => inquiry.estado === 'nuevo' || inquiry.estado === 'en_proceso';
const isOld = (inquiry: Inquiry, now: Date) => isOpen(inquiry) && inquiry.createdAt.getTime() < now.getTime() - HORAS_CONSULTA_ANTIGUA * 3_600_000;

// 4. Consultas por estado
export async function inquiriesByState(tx: Tx, p: Period, now: Date): Promise<CommercialBuilt> {
  const inquiries = await loadInquiries(tx, createdRange(p));
  const counts = new Map<string, number>();
  for (const inquiry of inquiries) counts.set(inquiry.estado, (counts.get(inquiry.estado) ?? 0) + 1);
  const total = inquiries.length;
  const known = new Set<string>(MESSAGE_STATES);
  const states = [...MESSAGE_STATES, ...[...counts.keys()].filter(state => !known.has(state)).sort()];
  const open = (counts.get('nuevo') ?? 0) + (counts.get('en_proceso') ?? 0);
  const old = inquiries.filter(inquiry => isOld(inquiry, now)).length;
  return {
    resumen: [
      item('total', 'Consultas recibidas en el reporte', total), item('abiertas', 'Abiertas (nuevo o en proceso)', open),
      item('antiguas', 'Abiertas con más de ' + HORAS_CONSULTA_ANTIGUA + ' horas (al generar)', old),
      item('cerradas', 'Cerradas (atendido o archivado)', total - open),
      item('porcentaje_cerradas', 'Cerradas sobre el total (%)', percent(total - open, total), 'decimal'),
    ],
    tabla: {
      titulo: 'Consultas por estado', total_filas: states.length,
      columnas: [col('estado', 'Estado', 'texto', 18), col('cantidad', 'Consultas', 'entero', 12), col('porcentaje', '% del total', 'decimal', 12)],
      filas: states.map(state => ({ estado: labelOf(INQUIRY_STATE_LABELS, state), cantidad: counts.get(state) ?? 0, porcentaje: percent(counts.get(state) ?? 0, total) })),
      totales: { estado: 'Total', cantidad: total, porcentaje: total > 0 ? 100 : null },
    },
  };
}

// 5. Consultas abiertas con más de 48 horas (hoja de trabajo). Antigüedad = horas desde que se RECIBIÓ la consulta (createdAt) hasta ahora.
export async function oldOpenInquiries(tx: Tx, q: Filters, p: Period, mode: CommercialMode, now: Date): Promise<CommercialBuilt> {
  const threshold = new Date(now.getTime() - HORAS_CONSULTA_ANTIGUA * 3_600_000);
  const createdAt = { ...(p.fromUtc ? { gte: p.fromUtc } : {}), lt: p.toUtc && p.toUtc < threshold ? p.toUtc : threshold };
  const inquiries = (await loadInquiries(tx, { createdAt })).filter(inquiry => isOld(inquiry, now) && (!q.estado || inquiry.estado === q.estado));
  inquiries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id); // la más antigua primero
  checkOutput(inquiries.length, mode);
  const hours = (inquiry: Inquiry) => Math.floor((now.getTime() - inquiry.createdAt.getTime()) / 3_600_000);
  const count = (state: string) => inquiries.filter(inquiry => inquiry.estado === state).length;
  return {
    resumen: [
      item('total', 'Consultas abiertas con más de ' + HORAS_CONSULTA_ANTIGUA + ' horas', inquiries.length), item('nuevo', 'De ellas, nuevas (nadie las ha revisado)', count('nuevo')),
      item('en_proceso', 'De ellas, en proceso', count('en_proceso')), item('mayor_antiguedad', 'Mayor antigüedad (horas)', inquiries.length ? hours(inquiries[0]) : null),
    ],
    tabla: {
      titulo: 'Consultas abiertas antiguas', total_filas: inquiries.length, totales: null,
      columnas: [col('id', 'ID de consulta', 'entero', 12), col('estado', 'Estado', 'texto', 14), col('origen', 'Origen', 'texto', 16), col('recibida', 'Recibida', 'fecha_hora', 17), col('horas', 'Horas abierta', 'entero', 13)],
      filas: pageOf(mode, inquiries).map(inquiry => ({
        id: inquiry.id, estado: labelOf(INQUIRY_STATE_LABELS, inquiry.estado), origen: labelOf(ORIGIN_LABELS, inquiry.origen), recibida: limaDateTime(inquiry.createdAt), horas: hours(inquiry),
      })),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------
// 6. Actividad comercial y de atención por mes (meses de Lima). Cada cifra se cuenta por la fecha de CREACIÓN del registro; el estado de las
// consultas y cotizaciones es el VIGENTE al generar (no se reconstruye el estado que tenían ese mes: el sistema no guarda una serie histórica
// de estados consultable sin leer el historial JSON).
export async function monthlyActivity(tx: Tx, p: Period, mode: CommercialMode): Promise<CommercialBuilt> {
  const inquiries = await loadInquiries(tx, createdRange(p));
  const where = createdRange(p);
  const totalQuotes = await tx.cotizacion.count({ where });
  checkSource(totalQuotes, 'cotizaciones');
  const quotes = await inBatches(totalQuotes, (skip, take) => tx.cotizacion.findMany({ where, orderBy: { id: 'asc' }, skip, take, select: { estado: true, createdAt: true, contacto_id: true } }));
  const months = monthsBetween(p.desde!, p.hasta!);
  const blank = () => ({ consultas: 0, cerradas: 0, cotizaciones: 0, con_consulta: 0, aceptadas: 0 });
  const series = new Map(months.map(month => [month, blank()]));
  for (const inquiry of inquiries) { const row = series.get(monthOf(inquiry.createdAt)); if (row) { row.consultas++; if (!isOpen(inquiry)) row.cerradas++; } }
  for (const quote of quotes) { const row = series.get(monthOf(quote.createdAt)); if (row) { row.cotizaciones++; if (quote.contacto_id) row.con_consulta++; if (quote.estado === 'aceptada') row.aceptadas++; } }
  const rows = months.map(month => ({ mes: month, ...series.get(month)! }));
  const sum = (key: keyof ReturnType<typeof blank>) => rows.reduce((total, row) => total + row[key], 0);
  return {
    resumen: [
      item('consultas', 'Consultas recibidas en el período', sum('consultas')), item('consultas_cerradas', 'De ellas, cerradas hoy (atendido o archivado)', sum('cerradas')),
      item('cotizaciones', 'Cotizaciones creadas en el período', sum('cotizaciones')), item('con_consulta', 'De ellas, creadas desde una consulta', sum('con_consulta')),
      item('aceptadas', 'De ellas, aceptadas hoy (registro administrativo)', sum('aceptadas')),
    ],
    tabla: {
      titulo: 'Actividad mensual', total_filas: rows.length,
      columnas: [
        col('mes', 'Mes', 'texto', 10), col('consultas', 'Consultas recibidas', 'entero', 14), col('cerradas', 'Cerradas hoy', 'entero', 12), col('cotizaciones', 'Cotizaciones creadas', 'entero', 14),
        col('con_consulta', 'Creadas desde una consulta', 'entero', 16), col('aceptadas', 'Aceptadas hoy', 'entero', 12),
      ],
      filas: pageOf(mode, rows as unknown as ReportRow[]),
      totales: { mes: 'Total', consultas: sum('consultas'), cerradas: sum('cerradas'), cotizaciones: sum('cotizaciones'), con_consulta: sum('con_consulta'), aceptadas: sum('aceptadas') },
    },
  };
}
