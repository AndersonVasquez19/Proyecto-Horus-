import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExportError, MESSAGE_EXPORT_COLUMNS, fetchAllPages, toExportRows } from '../src/panel/services/messageExport.ts'
import { buildMessagePayload, hasMessageDraft } from '../src/panel/services/messageCreate.ts'
import { buildCsv } from '../src/panel/services/listRecords.ts'

// Servidor simulado: 25 consultas en páginas de 10 (ids 25..1, como el orden «más reciente primero»).
const rowsOf = n => Array.from({ length: n }, (_, i) => ({ id: n - i, nombre: 'Persona ' + (n - i), email: 'p' + (n - i) + '@example.test', telefono: '', asunto: 'Asunto ' + (n - i), mensaje: 'Texto', estado: 'nuevo', createdAt: '2026-01-01T10:00:00.000Z' }))
const pager = (all, size = 10, hook = () => {}) => async page => { hook(page); return { rows: all.slice((page - 1) * size, page * size), total: all.length, pages: Math.ceil(all.length / size) } }

test('exporta TODAS las páginas, no solo la visible', async () => {
  const rows = await fetchAllPages(pager(rowsOf(25)))
  assert.equal(rows.length, 25); assert.deepEqual(rows.map(r => r.id), rowsOf(25).map(r => r.id))
})

test('sin resultados: lista vacía y una sola petición', async () => {
  let calls = 0
  assert.deepEqual(await fetchAllPages(pager([], 10, () => calls++)), []); assert.equal(calls, 1)
})

test('un error en una página intermedia NO entrega un archivo parcial', async () => {
  await assert.rejects(() => fetchAllPages(pager(rowsOf(25), 10, page => { if (page === 2) throw new Error('500 interno SECRETO') })),
    error => error instanceof ExportError && error.code === 'failed' && /página 2/.test(error.message) && /No se descargó ningún archivo/.test(error.message) && !/SECRETO/.test(error.message))
})

test('si cambia el total durante la descarga se aborta como inconsistente', async () => {
  const all = rowsOf(25); let grown = false
  const fetchPage = async page => { if (page === 2 && !grown) { grown = true; all.unshift({ ...all[0], id: 26 }) } return pager(all)(page) }
  await assert.rejects(() => fetchAllPages(fetchPage), error => error.code === 'inconsistent')
})

test('ids repetidos entre páginas (desplazamiento del orden) se detectan', async () => {
  const all = rowsOf(25)
  const fetchPage = async page => { const r = await pager(all)(page); return page === 2 ? { ...r, rows: [all[9], ...r.rows.slice(1)] } : r }
  await assert.rejects(() => fetchAllPages(fetchPage), error => error.code === 'inconsistent')
})

test('menos registros de los anunciados también es inconsistente', async () => {
  const all = rowsOf(25)
  await assert.rejects(() => fetchAllPages(async page => { const r = await pager(all)(page); return page === 3 ? { ...r, rows: r.rows.slice(1) } : r }), error => error.code === 'inconsistent')
})

test('cancelar detiene la descarga y no devuelve nada', async () => {
  const controller = new AbortController(); let calls = 0
  await assert.rejects(() => fetchAllPages(pager(rowsOf(25), 10, page => { calls++; if (page === 1) controller.abort() }), { signal: controller.signal }), error => error.code === 'aborted')
  assert.equal(calls, 1)
})

test('demasiadas páginas: se pide acotar los filtros antes de descargar el inventario', async () => {
  let calls = 0
  await assert.rejects(() => fetchAllPages(pager(rowsOf(25), 10, () => calls++), { maxPages: 2 }), error => error.code === 'too_large')
  assert.equal(calls, 1, 'solo se pidió la primera página')
})

test('el CSV incluye columnas estables, el estado archivado y neutraliza fórmulas', () => {
  const rows = [
    { ...rowsOf(1)[0], id: 1, nombre: '=HYPERLINK("http://x")', asunto: '+SUMA(1)', mensaje: '@cmd', estado: 'archivado' },
    { ...rowsOf(1)[0], id: 2, nombre: '-2+3', asunto: '[Chatbot] Hola', estado: 'nuevo', notas: 'NOTA PRIVADA', respuesta: 'RESPUESTA INTERNA', historial: [{ accion: 'x' }] },
  ]
  const csv = buildCsv([...MESSAGE_EXPORT_COLUMNS], toExportRows(rows))
  const lines = csv.replace('﻿', '').split('\r\n')
  assert.equal(lines[0], '"id","nombre","correo","telefono","asunto","origen","estado","fecha"')
  assert.match(lines[1], /^"1","'=HYPERLINK\(""http:\/\/x""\)"/); assert.match(lines[1], /"'\+SUMA\(1\)"/); assert.match(lines[1], /"Web \/ manual","archivado"/)
  assert.match(lines[2], /"'-2\+3"/); assert.match(lines[2], /"Chatbot","nuevo"/)
  assert.ok(!/NOTA PRIVADA|RESPUESTA INTERNA|historial|@cmd/.test(csv), 'no exporta notas, respuestas, historial ni el cuerpo del mensaje')
})

test('registro manual: payload recortado y teléfono opcional omitido', () => {
  assert.deepEqual(buildMessagePayload({ nombre: '  Ana  ', email: ' ana@example.test ', telefono: '   ', asunto: 'Hola', mensaje: ' Texto ' }), { nombre: 'Ana', email: 'ana@example.test', asunto: 'Hola', mensaje: 'Texto' })
  assert.equal(buildMessagePayload({ nombre: 'A', email: 'a@b.c', telefono: '987654321', asunto: 'x', mensaje: 'y' }).telefono, '987654321')
  assert.equal(hasMessageDraft({ nombre: '  ', email: '' }), false); assert.equal(hasMessageDraft({ asunto: 'x' }), true)
})

test('posibles duplicados: mismo correo, asunto y mensaje, sin distinguir mayúsculas; otro asunto no coincide', async () => {
  const { findPossibleDuplicates } = await import('../src/panel/services/messageCreate.ts')
  const rows = [
    { id: 1, email: 'ANA@example.test', asunto: ' Hola ', mensaje: 'Texto' },
    { id: 2, email: 'ana@example.test', asunto: 'Otro', mensaje: 'Texto' },
    { id: 3, email: 'otra@example.test', asunto: 'Hola', mensaje: 'Texto' },
  ]
  assert.deepEqual(findPossibleDuplicates(rows, { email: 'ana@example.test ', asunto: 'hola', mensaje: ' texto ' }).map(r => r.id), [1])
  assert.deepEqual(findPossibleDuplicates([], { email: 'a@b.c' }), [])
})
