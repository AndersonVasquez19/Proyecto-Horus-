import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quoteListParams, parseDuplicateResult, duplicateFailure, DUPLICATE_UNCERTAIN, quotePdfFileName, pdfErrorText, newOperationKey } from '../src/panel/services/quoteActions.ts'

// Lógica pura de las operaciones de Cotizaciones de la Fase 4D (filtro de vencidas, duplicar y PDF). Sin React ni red.
const base = { board: false, page: 2, query: 'ana', state: 'borrador', overdue: false, limit: 12 }

test('lista: sin filtro de vencidas no envía «vencida» y conserva el estado', () => {
  const p = quoteListParams(base)
  assert.equal(p.get('vencida'), null)
  assert.equal(p.get('estado'), 'borrador')
  assert.equal(p.get('page'), '2'); assert.equal(p.get('limit'), '12'); assert.equal(p.get('search'), 'ana')
})

test('lista: con vencidas envía vencida=si (único valor admitido por el backend) y no combina un estado', () => {
  const p = quoteListParams({ ...base, overdue: true })
  assert.equal(p.get('vencida'), 'si')
  assert.equal(p.get('estado'), '')
})

test('lista: el tablero ignora estado y vencidas y pide un único lote', () => {
  const p = quoteListParams({ ...base, board: true, overdue: true, limit: 100 })
  assert.equal(p.get('vencida'), null); assert.equal(p.get('estado'), ''); assert.equal(p.get('page'), '1'); assert.equal(p.get('limit'), '100')
})

test('duplicar: interpreta la respuesta real del backend', () => {
  assert.deepEqual(parseDuplicateResult({ ok: true, item: { id: 7, numero: 'COT-2026-7' }, requiere_nueva_vigencia: false }), { id: 7, numero: 'COT-2026-7', needsNewValidity: false })
  assert.equal(parseDuplicateResult({ ok: true, item: { id: 7, numero: 'COT-2026-7' }, requiere_nueva_vigencia: true }).needsNewValidity, true)
})

test('duplicar: una respuesta incompleta o inválida no se da por creada', () => {
  for (const bad of [null, undefined, 'x', {}, { ok: false }, { ok: true }, { ok: true, item: {} }, { ok: true, item: { id: '7', numero: 'A' } }, { ok: true, item: { id: 0, numero: 'A' } }, { ok: true, item: { id: 1.5, numero: 'A' } }, { ok: true, item: { id: 3, numero: '' } }]) {
    assert.equal(parseDuplicateResult(bad), null, JSON.stringify(bad))
  }
})

test('duplicar: red, cancelación o 5xx son inciertos; un 4xx es definitivo', () => {
  assert.equal(duplicateFailure(undefined, false).kind, 'incierto')
  assert.equal(duplicateFailure({ status: 409, message: 'x' }, true).kind, 'incierto')
  assert.equal(duplicateFailure({ status: 500 }, false).kind, 'incierto')
  assert.equal(duplicateFailure({ status: 503 }, false).kind, 'incierto')
  assert.equal(duplicateFailure({ status: 200 }, false).kind, 'incierto')
  assert.equal(duplicateFailure(undefined, false).message, DUPLICATE_UNCERTAIN)
  assert.deepEqual(duplicateFailure({ status: 409, message: 'La cotización original tiene conceptos ilegibles y no se puede duplicar.' }, false), { kind: 'definitivo', message: 'La cotización original tiene conceptos ilegibles y no se puede duplicar.' })
  assert.equal(duplicateFailure({ status: 404, message: 'Cotización no encontrada.' }, false).kind, 'definitivo')
  assert.equal(duplicateFailure({ status: 403, message: '' }, false).message, 'No se pudo duplicar la cotización.')
})

test('clave de operación: cumple el formato del backend (16–128, A-Za-z0-9._:-) y no se repite', () => {
  const a = newOperationKey(), b = newOperationKey()
  assert.match(a, /^[A-Za-z0-9._:-]{16,128}$/)
  assert.notEqual(a, b)
})

test('PDF: toma el nombre del backend, lo sanea y siempre termina en .pdf', () => {
  assert.equal(quotePdfFileName('attachment; filename="cotizacion-COT-2026-1.pdf"', 'COT-2026-1'), 'cotizacion-COT-2026-1.pdf')
  assert.equal(quotePdfFileName(null, 'COT-2026-1'), 'cotizacion-COT-2026-1.pdf')
  assert.equal(quotePdfFileName('attachment; filename="../../etc/passwd"', 'COT-1'), 'cotizacion-COT-1.pdf')
  assert.equal(quotePdfFileName('attachment; filename="a/b\\c.pdf"', 'COT-1'), 'a_b_c.pdf')
  assert.equal(quotePdfFileName('attachment; filename="propuesta"', 'COT-1'), 'propuesta.pdf')
  assert.equal(quotePdfFileName(undefined, 'COT 2026/1'), 'cotizacion-COT_2026_1.pdf')
  assert.equal(quotePdfFileName("attachment; filename*=UTF-8''Propuesta%20Ni%C3%B1o.pdf", 'COT-1'), 'Propuesta Niño.pdf')
})

test('PDF: los errores usan mensajes controlados y nunca texto técnico', () => {
  assert.match(pdfErrorText(404, undefined), /ya no existe/)
  assert.equal(pdfErrorText(404, 'Cotización no encontrada.'), 'Cotización no encontrada.')
  assert.match(pdfErrorText(500, 'Internal server error ER_SECRET'), /No se pudo generar el PDF/)
  assert.doesNotMatch(pdfErrorText(500, 'Internal server error ER_SECRET'), /ER_SECRET/)
})
