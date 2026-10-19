import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCsv, csvCell, recordsOf } from '../src/panel/services/listRecords.ts'

const paged = { ok: true, messages: [{ id: 2 }, { id: 1 }], pagination: { total: 40, page: 1, limit: 20, pages: 2 }, metrics: { nuevo: 2 } }

test('Mensajes entrega sus registros bajo "messages" y la tabla los lee de ahí', () => {
  // Con la lectura antigua (data.items || []) esta lista salía vacía aunque el servidor devolviera registros.
  assert.deepEqual(recordsOf('messages', paged), [{ id: 2 }, { id: 1 }])
  assert.equal(recordsOf('messages', paged).length, 2)
})

test('el resto de recursos sigue leyendo "items" y no se mezcla con otras claves', () => {
  assert.deepEqual(recordsOf('cursos', { items: [{ id: 9 }], pagination: { total: 1, pages: 1 } }), [{ id: 9 }])
  assert.deepEqual(recordsOf('servicios', { items: [] }), [], 'una lista vacía sigue siendo vacía')
  assert.deepEqual(recordsOf('cursos', { messages: [{ id: 1 }] }), [], 'un recurso que no es Mensajes no toma la clave "messages"')
  assert.deepEqual(recordsOf('galeria', null), [])
  assert.deepEqual(recordsOf('messages', { ...paged, items: [{ id: 99 }] }), [{ id: 2 }, { id: 1 }], 'Mensajes no toma "items"')
})

test('una lista vacía de Mensajes es vacía; una respuesta sin la lista es un error, no un vacío engañoso', () => {
  assert.deepEqual(recordsOf('messages', { ok: true, messages: [], pagination: { total: 0, pages: 0 } }), [])
  for (const broken of [{ ok: true }, { ok: true, items: [{ id: 1 }] }, { ok: true, messages: null }, { ok: true, messages: 'x' }, null, undefined]) {
    assert.throws(() => recordsOf('messages', broken), /formato inesperado/)
  }
})

test('la exportación CSV neutraliza fórmulas, duplica comillas y conserva saltos de línea', () => {
  assert.equal(csvCell('texto'), '"texto"')
  assert.equal(csvCell(null), '""')
  assert.equal(csvCell(7), '"7"')
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  for (const risky of ['+cmd', '-1+1', '@SUM(1)', '  =1+1', '\tTAB', '\nsalto']) assert.ok(csvCell(risky).startsWith('"\''), 'neutraliza ' + JSON.stringify(risky))
  assert.equal(csvCell('línea 1\nlínea 2, con "comillas"'), '"línea 1\nlínea 2, con ""comillas"""', 'un salto en medio del texto no se altera')
  assert.equal(csvCell('a=b'), '"a=b"', 'solo se neutraliza al inicio')
})

test('buildCsv usa BOM, CRLF y el orden de columnas indicado', () => {
  const csv = buildCsv(['id', 'asunto'], [{ id: 1, asunto: '=1+1', extra: 'ignorado' }, { id: 2, asunto: 'ok' }])
  assert.equal(csv, '﻿"id","asunto"\r\n"1","\'=1+1"\r\n"2","ok"')
})
