import { test } from 'node:test'
import assert from 'node:assert/strict'
import { channelSplit, chatbotResolvedPercent, overviewKpis, parseChatbotMetrics, percentOf, preregistrationSegments, quoteSummary } from '../src/panel/services/overviewAnalytics.ts'

const prereg = (extra = {}) => ({ total: 20, vigentes: 14, recibidas: 6, pendientesRevision: 4, validadas: 5, convertidas: 3, descartadas: 4, desistidas: 2, ...extra })
const stats = (preinscripciones) => ({ ok: true, stats: { academico: { estudiantes: 12, edicionesActivas: 2, matriculasRegistradas: 9, matriculasVigentes: 7 }, mensajes: { total: 8, nuevos: 3, enProceso: 3, atendidos: 1, archivados: 1, pendientes: 6 }, preinscripciones }, actividadReciente: { mensajes: [] } })

test('porcentajes: un decimal, y sin base no hay porcentaje (nunca 0 % inventado)', () => {
  assert.equal(percentOf(1, 3), 33.3)
  assert.equal(percentOf(2, 3), 66.7)
  assert.equal(percentOf(5, 20), 25)
  assert.equal(percentOf(0, 20), 0)
  for (const [part, total] of [[0, 0], [3, 0], [-1, 5], [1.5, 5], [1, NaN], [undefined, 4]]) assert.equal(percentOf(part, total), null)
})

test('preinscripciones: cinco estados excluyentes cuyo reparto suma el total', () => {
  const segments = preregistrationSegments(prereg())
  assert.deepEqual(segments.map(s => s.key), ['recibidas', 'validadas', 'convertidas', 'descartadas', 'desistidas'])
  assert.deepEqual(segments.map(s => s.value), [6, 5, 3, 4, 2])
  assert.equal(segments.reduce((sum, s) => sum + s.value, 0), 20)
  assert.deepEqual(segments.map(s => s.percent), [30, 25, 15, 20, 10])
  assert.equal(segments.find(s => s.key === 'convertidas').label, 'Convertidas') // no se renombra a «matriculadas»
})

test('preinscripciones: sin solicitudes no se calculan porcentajes', () => {
  const empty = preregistrationSegments(prereg({ total: 0, vigentes: 0, recibidas: 0, pendientesRevision: 0, validadas: 0, convertidas: 0, descartadas: 0, desistidas: 0 }))
  assert.ok(empty.every(s => s.value === 0 && s.percent === null))
})

test('origen de las consultas: partición completa chatbot + resto = total', () => {
  const split = channelSplit([{ total: 3, chatbot: 1 }, { total: 0, chatbot: 0 }, { total: 5, chatbot: 4 }])
  assert.deepEqual(split, { total: 8, chatbot: 5, otros: 3, chatbotPercent: 62.5, otrosPercent: 37.5 })
  assert.equal(split.chatbot + split.otros, split.total)
})

test('origen de las consultas: sin consultas no hay porcentajes; datos incoherentes no afirman nada', () => {
  assert.deepEqual(channelSplit([]), { total: 0, chatbot: 0, otros: 0, chatbotPercent: null, otrosPercent: null })
  assert.deepEqual(channelSplit([{ total: 0, chatbot: 0 }, { total: 0, chatbot: 0 }]), { total: 0, chatbot: 0, otros: 0, chatbotPercent: null, otrosPercent: null })
  for (const bad of [[{ total: 1, chatbot: 2 }], [{ total: -1, chatbot: 0 }], [{ total: 1.5, chatbot: 0 }], [{ total: '3', chatbot: 1 }], [null], [{ total: 3 }]])
    assert.equal(channelSplit(bad), null, JSON.stringify(bad))
})

const metrics = (extra = {}) => ({ dias: 30, interacciones: 10, resueltas: 7, sinRespuesta: 3, conIa: 4, conCatalogo: 6, ...extra })
test('chatbot: lee las métricas coherentes y calcula el porcentaje con respuesta', () => {
  const parsed = parseChatbotMetrics({ ok: true, items: [{ id: 1, pregunta: 'ignorada' }], metrics: metrics() })
  assert.deepEqual(parsed, metrics())
  assert.equal(chatbotResolvedPercent(parsed), 70)
  assert.equal('items' in parsed, false) // no arrastra el texto de las preguntas
})

test('chatbot: sin interacciones no hay porcentaje, pero el bloque es válido', () => {
  const none = parseChatbotMetrics({ metrics: metrics({ interacciones: 0, resueltas: 0, sinRespuesta: 0, conIa: 0, conCatalogo: 0 }) })
  assert.equal(none.interacciones, 0)
  assert.equal(chatbotResolvedPercent(none), null)
})

test('chatbot: formatos inesperados o cifras que no cuadran no se muestran', () => {
  for (const bad of [null, [], 'x', {}, { metrics: {} }, { metrics: null }, { metrics: [] },
    { metrics: metrics({ resueltas: 8 }) }, // resueltas + sin respuesta ≠ interacciones
    { metrics: metrics({ conIa: 8, conCatalogo: 8 }) }, // modos que suman más que las interacciones
    { metrics: metrics({ interacciones: -1 }) }, { metrics: metrics({ resueltas: 7.5 }) }, { metrics: metrics({ dias: 0 }) },
    { metrics: metrics({ conIa: undefined }) }, { metrics: metrics({ sinRespuesta: '3' }) }])
    assert.equal(parseChatbotMetrics(bad), null, JSON.stringify(bad))
})

test('cotizaciones: abiertas = borrador + enviada; los estados desconocidos no cuentan en el desglose', () => {
  assert.deepEqual(quoteSummary({ borrador: 1, enviada: 2, aceptada: 1, rechazada: 0, anulada: 0 }), { total: 4, abiertas: 3 })
  assert.deepEqual(quoteSummary({}), { total: 0, abiertas: 0 })
  assert.deepEqual(quoteSummary({ borrador: -2, enviada: 'x' }), { total: 0, abiertas: 0 })
})

test('indicadores: sin datos del servidor ningún valor es un número (ni cero)', () => {
  const kpis = overviewKpis(null, null)
  assert.deepEqual(kpis.map(k => k.key), ['estudiantes', 'ediciones', 'matriculas', 'vigentes', 'preinscripciones', 'consultas'])
  assert.ok(kpis.every(k => k.value === undefined))
})

test('indicadores: valores reales y preinscripciones por revisar', () => {
  const kpis = overviewKpis(stats(prereg()), prereg())
  assert.deepEqual(kpis.map(k => k.value), [12, 2, 9, 7, 4, 6])
  assert.equal(kpis.find(k => k.key === 'preinscripciones').sub, '20 en total · 5 validadas')
  assert.equal(kpis.find(k => k.key === 'ediciones').title, 'Ediciones abiertas')
})

test('indicadores: preinscripciones no disponible es null y «No disponible», no cero; las demás siguen', () => {
  const kpis = overviewKpis(stats(null), null)
  const card = kpis.find(k => k.key === 'preinscripciones')
  assert.equal(card.value, null)
  assert.equal(card.sub, 'No disponible')
  assert.deepEqual(kpis.filter(k => k.key !== 'preinscripciones').map(k => k.value), [12, 2, 9, 7, 6])
})

test('indicadores: cero real de estudiantes se conserva como 0', () => {
  const data = stats(null); data.stats.academico.estudiantes = 0
  assert.equal(overviewKpis(data, null)[0].value, 0)
})
