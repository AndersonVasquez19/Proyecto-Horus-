import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOperationalStats } from '../src/panel/services/operationalStats.ts'

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
