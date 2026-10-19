import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mailResultFromFailure, mailResultFromSuccess } from '../src/panel/services/mailOutcome.ts'

const api = (status, body, message = 'x') => ({ status, body, message })

test('éxito: se presenta como aceptado por el proveedor, no como entregado', () => {
  const r = mailResultFromSuccess({ ok: true, envio: 'aceptado', mensaje: 'El proveedor aceptó el correo.' })
  assert.equal(r.kind, 'aceptado'); assert.equal(r.needsConfirm, false)
})

test('resultados estructurados del servidor se respetan', () => {
  assert.equal(mailResultFromFailure(api(503, { envio: 'fallido', mensaje: 'No se pudo enviar.' })).kind, 'fallido')
  assert.equal(mailResultFromFailure(api(502, { envio: 'incierto', mensaje: 'No pudimos confirmar.' })).kind, 'incierto')
  const blocked = mailResultFromFailure(api(409, { envio: 'bloqueado', motivo: 'incierto', mensaje: 'Revisa el historial.' }))
  assert.equal(blocked.kind, 'bloqueado'); assert.equal(blocked.needsConfirm, true)
})

test('REGRESIÓN: red caída, timeout, 500 y 504 sin cuerpo son INCIERTOS y no invitan a reintentar a ciegas', () => {
  // Comportamiento anterior: cualquier error se mostraba como «no se pudo enviar / reintenta» (o "Failed to fetch"), aunque el proveedor ya hubiera aceptado.
  const old = error => error instanceof Error ? error.message : 'Reintenta el envío.'
  assert.match(old(new TypeError('Failed to fetch')), /Failed to fetch/, 'antes: error técnico crudo')
  for (const failure of [undefined, null, new TypeError('Failed to fetch'), { name: 'AbortError', message: 'aborted' }, api(500, null), api(502, null), api(504, null, 'No se pudo completar la operación (504).')]) {
    const r = mailResultFromFailure(failure)
    assert.equal(r.kind, 'incierto', JSON.stringify(failure)); assert.equal(r.needsConfirm, false)
    assert.doesNotMatch(r.message, /Failed to fetch|reintent|vuelve a intentar|no se (pudo )?envi/i)
  }
})

test('errores explicados por el servidor (validación, correo no disponible) se muestran tal cual y son definitivos', () => {
  assert.deepEqual(mailResultFromFailure(api(400, null, 'Guarda una respuesta antes de enviarla.')).kind, 'error')
  assert.equal(mailResultFromFailure(api(503, undefined, 'El correo no está disponible. La cotización sigue guardada.')).kind, 'error')
})

test('409 sin cuerpo de envío es una revisión obsoleta, no un envío bloqueado', () => {
  assert.equal(mailResultFromFailure(api(409, null, 'La respuesta cambió. Recarga el caso antes de enviarla.')).kind, 'obsoleto')
})

test('409 de cotización: la propuesta vencida conserva su mensaje; la revisión obsoleta y el reenvío bloqueado siguen distintos', () => {
  const vencida = mailResultFromFailure(api(409, null, 'La propuesta está vencida.'))
  assert.equal(vencida.kind, 'conflicto'); assert.equal(vencida.message, 'La propuesta está vencida.'); assert.equal(vencida.needsConfirm, false)
  const obsoleta = mailResultFromFailure(api(409, null, 'La cotización cambió. Recárgala antes de enviar.'))
  assert.equal(obsoleta.kind, 'obsoleto'); assert.match(obsoleta.message, /pudo haber salido/)
  assert.equal(mailResultFromFailure(api(409, null, 'La cotización cambió en otra sesión. Recárgala antes de continuar.')).kind, 'obsoleto')
  const bloqueado = mailResultFromFailure(api(409, { envio: 'bloqueado', motivo: 'ya_aceptado', mensaje: 'Ya aceptado.' }, 'Ya aceptado.'))
  assert.equal(bloqueado.kind, 'bloqueado'); assert.equal(bloqueado.needsConfirm, true)
  // Un conflicto de negocio no es ni un envío realizado ni uno incierto.
  assert.notEqual(vencida.kind, 'incierto'); assert.notEqual(vencida.kind, 'aceptado')
})
