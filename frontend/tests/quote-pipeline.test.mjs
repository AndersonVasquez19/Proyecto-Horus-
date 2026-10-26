import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PIPELINE_STATES, PIPELINE_LIMIT, MIN_RESOLVED_FOR_RATE, groupByState, sumByCurrency, summarizePipeline, toCents,
  formatCalendarDate, formatCreatedDate, formatMoney, formatQuoteTotal, viewFromParam, withView,
} from '../src/panel/services/quotePipeline.ts'
import { quoteTransitions } from '../src/panel/types/quotes.ts'

let seq = 0
const quote = (estado, total = '100.00', moneda = 'PEN', extra = {}) => ({ id: ++seq, numero: 'COT-' + String(seq).padStart(4, '0'), cliente: 'Cliente ' + seq, estado, moneda, total, ...extra })

test('las columnas son exactamente los estados reales del backend, en el orden del flujo', () => {
  assert.deepEqual([...PIPELINE_STATES], ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada'])
  assert.deepEqual([...PIPELINE_STATES].sort(), Object.keys(quoteTransitions).sort(), 'no hay estados inventados ni faltantes respecto a quoteTransitions')
})

test('el lote del tablero coincide con el máximo que admite el backend', () => {
  const dto = readFileSync(new URL('../../backend/src/cotizaciones/cotizacion.dto.ts', import.meta.url), 'utf8')
  const max = /@Max\((\d+)\)\s+limit:/.exec(dto)
  assert.ok(max, 'el DTO declara un máximo para limit')
  assert.equal(PIPELINE_LIMIT, Number(max[1]))
})

test('agrupación por estado: conserva el orden recibido y no reasigna estados desconocidos', () => {
  const a = quote('enviada'), b = quote('borrador'), c = quote('enviada'), d = quote('aceptada'), x = quote('en_negociacion')
  const { columns, unclassified } = groupByState([a, b, c, d, x])
  assert.deepEqual(columns.enviada.map(q => q.id), [a.id, c.id])
  assert.deepEqual(columns.borrador.map(q => q.id), [b.id])
  assert.deepEqual(columns.aceptada.map(q => q.id), [d.id])
  assert.equal(columns.rechazada.length + columns.anulada.length, 0)
  assert.deepEqual(unclassified.map(q => q.id), [x.id], 'un estado ajeno al backend no se cuela en ninguna columna')
  assert.deepEqual(Object.keys(groupByState([]).columns), [...PIPELINE_STATES], 'sin datos, las cinco columnas existen y están vacías')
})

test('importes: monedas separadas, solo borradores y enviadas, céntimos exactos', () => {
  const items = [quote('borrador', '10.10', 'PEN'), quote('enviada', '20.20', 'PEN'), quote('enviada', '5.00', 'USD'), quote('aceptada', '999.00', 'PEN'), quote('rechazada', '1.00', 'USD'), quote('anulada', '7.00', 'PEN')]
  assert.deepEqual(sumByCurrency(items, ['borrador', 'enviada']), [{ moneda: 'PEN', cents: 3030 }, { moneda: 'USD', cents: 500 }])
  const drift = [quote('borrador', 0.1), quote('borrador', 0.2)]
  assert.equal(sumByCurrency(drift, ['borrador'])[0].cents, 30, '0.1 + 0.2 = 0.30 exacto (sin 0.30000000000000004)')
  assert.deepEqual(sumByCurrency([quote('borrador', 'no-es-numero'), quote('borrador', null), quote('borrador', '')], ['borrador']), [], 'un importe ilegible se excluye en lugar de sumar NaN')
  assert.equal(toCents('1234.5'), 123450); assert.equal(toCents(undefined), null)
  assert.equal(sumByCurrency([quote('borrador', '3.00', 'pen'), quote('borrador', '4.00', ' PEN ')], ['borrador']).length, 1, 'el código de moneda se normaliza')
})

test('indicadores del lote: conteos, aceptadas y tasa solo con datos suficientes', () => {
  const few = summarizePipeline([quote('aceptada'), quote('rechazada'), quote('borrador')], 3)
  assert.equal(few.accepted, 1); assert.equal(few.resolved, 2); assert.equal(few.acceptanceRate, null, 'con menos de ' + MIN_RESOLVED_FOR_RATE + ' resueltas no se calcula una tasa')
  const enough = summarizePipeline([quote('aceptada'), quote('aceptada'), quote('rechazada'), quote('enviada'), quote('anulada')], 5)
  assert.equal(enough.resolved, 3); assert.equal(enough.acceptanceRate, 66.7)
  assert.deepEqual(enough.counts, { borrador: 0, enviada: 1, aceptada: 2, rechazada: 1, anulada: 1 })
  assert.equal(enough.truncated, false)
  const empty = summarizePipeline([], 0)
  assert.equal(empty.loaded, 0); assert.equal(empty.acceptanceRate, null); assert.deepEqual(empty.openAmounts, [])
})

test('límite de 100: el resumen distingue el lote del total y no lo presenta como global', () => {
  const batch = Array.from({ length: PIPELINE_LIMIT }, () => quote('enviada'))
  const partial = summarizePipeline(batch, 250)
  assert.equal(partial.loaded, 100); assert.equal(partial.total, 250); assert.equal(partial.truncated, true)
  const exact = summarizePipeline(batch, 100)
  assert.equal(exact.truncated, false, 'exactamente 100 de 100 no es un lote parcial')
  assert.equal(summarizePipeline(batch, Number.NaN).truncated, false, 'un total ilegible no inventa un parcial')
  assert.equal(summarizePipeline(batch, 5).total, 100, 'un total menor que lo cargado se corrige al cargado')
})

test('formato: fechas de calendario sin desfase horario y fecha de creación en Lima', () => {
  assert.equal(formatCalendarDate('2026-10-05'), '5 oct 2026')
  assert.equal(formatCalendarDate('2026-01-31'), '31 ene 2026')
  assert.equal(formatCalendarDate(undefined), ''); assert.equal(formatCalendarDate('2026-13-01'), ''); assert.equal(formatCalendarDate('basura'), '')
  assert.equal(formatCreatedDate('2026-10-26T03:30:00.000Z'), '25 oct 2026', '03:30 UTC es 22:30 del día anterior en Lima')
  assert.equal(formatCreatedDate('no-fecha'), ''); assert.equal(formatCreatedDate(undefined), '')
  assert.match(formatMoney(1234.5, 'PEN'), /^1[,.\s]?234[.,]50 PEN$/)
  assert.equal(formatQuoteTotal(quote('borrador', 'x')), 'Importe no disponible')
})

test('vista: tabla por defecto y ?vista=tablero conserva el resto de parámetros', () => {
  assert.equal(viewFromParam(null), 'tabla'); assert.equal(viewFromParam('otra'), 'tabla'); assert.equal(viewFromParam('tablero'), 'tablero')
  const base = new URLSearchParams('section=cotizaciones&contacto=7')
  const board = withView(base, 'tablero')
  assert.equal(board.get('section'), 'cotizaciones'); assert.equal(board.get('contacto'), '7'); assert.equal(board.get('vista'), 'tablero')
  assert.equal(base.has('vista'), false, 'no muta los parámetros recibidos')
  const back = withView(board, 'tabla')
  assert.equal(back.has('vista'), false); assert.equal(back.get('contacto'), '7'); assert.equal(back.get('section'), 'cotizaciones')
})
