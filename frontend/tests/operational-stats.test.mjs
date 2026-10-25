import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOperationalStats, readPreregistrations } from '../src/panel/services/operationalStats.ts'

const valid = () => ({ ok: true, stats: { academico: { estudiantes: 0, edicionesActivas: 0, matriculasRegistradas: 0, matriculasVigentes: 0 }, mensajes: { total: 0, nuevos: 0, enProceso: 0, atendidos: 0, archivados: 0, pendientes: 0 } }, actividadReciente: { mensajes: [] } })
test('indicadores solo aceptan recuentos completos y actividad con fechas válidas', () => {
  assert.equal(isOperationalStats(valid()), true)
  for (const value of [null, [], {}, { ok: true }, { ...valid(), stats: { catalogo: {} } }]) assert.equal(isOperationalStats(value), false)
  for (const value of [undefined, null, '0', -1, NaN, Infinity, 0.5]) {
    const result = valid(); result.stats.academico.estudiantes = value
    assert.equal(isOperationalStats(result), false)
  }
  const result = valid(); result.actividadReciente.mensajes = [{ id: 1, nombre: 'Prueba', asunto: 'Consulta', estado: 'nuevo', createdAt: 'fecha inválida' }]
  assert.equal(isOperationalStats(result), false)
})

// Bloque aditivo `stats.preinscripciones` (Fase 2A). Estados excluyentes: total = recibidas + validadas + convertidas + descartadas + desistidas.
const block = (extra = {}) => ({ total: 20, vigentes: 14, recibidas: 6, pendientesRevision: 4, validadas: 5, convertidas: 3, descartadas: 4, desistidas: 2, ...extra })
const withBlock = value => { const result = valid(); result.stats.preinscripciones = value; return result }
test('preinscripciones: un bloque coherente se lee tal cual', () => {
  assert.deepEqual(readPreregistrations(withBlock(block())), block())
  assert.equal(isOperationalStats(withBlock(block())), true)
})
test('preinscripciones: ausente, null o defectuoso es «No disponible» (null), nunca ceros', () => {
  assert.equal(readPreregistrations(valid()), null) // backend anterior: sin el bloque
  assert.equal(readPreregistrations(withBlock(null)), null) // módulo no disponible
  for (const value of [undefined, [], 'x', 7, {}, block({ total: undefined }), block({ recibidas: -1 }), block({ validadas: 1.5 }), block({ convertidas: '3' }), block({ desistidas: NaN })])
    assert.equal(readPreregistrations(withBlock(value)), null, JSON.stringify(value))
  for (const value of [null, undefined, [], 'x', { ok: true }, { stats: null }]) assert.equal(readPreregistrations(value), null)
})
test('preinscripciones: totales que no cuadran con sus estados no se muestran', () => {
  assert.equal(readPreregistrations(withBlock(block({ total: 21 }))), null) // total ≠ suma de estados excluyentes
  assert.equal(readPreregistrations(withBlock(block({ vigentes: 15 }))), null) // vigentes = recibidas + validadas + convertidas
  assert.equal(readPreregistrations(withBlock(block({ vigentes: 13 }))), null)
})
test('preinscripciones: «por revisar» nunca supera a las recibidas de las que forma parte', () => {
  assert.equal(readPreregistrations(withBlock(block({ pendientesRevision: 6 }))).pendientesRevision, 6)
  assert.equal(readPreregistrations(withBlock(block({ pendientesRevision: 9 }))).pendientesRevision, 6)
  assert.equal(readPreregistrations(withBlock(block({ total: 0, vigentes: 0, recibidas: 0, pendientesRevision: 0, validadas: 0, convertidas: 0, descartadas: 0, desistidas: 0 }))).total, 0) // vacío real ≠ no disponible
})
test('preinscripciones: un bloque defectuoso no invalida los demás indicadores', () => {
  for (const value of [null, {}, [], 'x', block({ total: 99 })]) assert.equal(isOperationalStats(withBlock(value)), true)
})
