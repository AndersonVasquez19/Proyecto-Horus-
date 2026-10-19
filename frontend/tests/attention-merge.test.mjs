import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOlderThan, reconcile, valuesOf } from '../src/panel/services/attentionMerge.ts'

const base = { estado: 'nuevo', responsable: '', notas: 'nota base', respuesta: '' }
const make = patch => ({ ...base, ...patch })

test('A. solo cambió el servidor: se toma el valor remoto', () => {
  const r = reconcile(base, base, make({ notas: 'nota remota', estado: 'en_proceso' }))
  assert.deepEqual(r.merged, make({ notas: 'nota remota', estado: 'en_proceso' }))
  assert.deepEqual(r.conflicts, []); assert.deepEqual(r.remoteOnly.sort(), ['estado', 'notas'])
})

test('B. solo cambió el borrador: se conserva lo escrito', () => {
  const r = reconcile(base, make({ notas: 'nota local' }), base)
  assert.deepEqual(r.merged, make({ notas: 'nota local' })); assert.deepEqual(r.conflicts, [])
})

test('C. campos distintos: fusión segura de ambos', () => {
  const r = reconcile(base, make({ notas: 'nota local' }), make({ respuesta: 'respuesta remota', estado: 'en_proceso' }))
  assert.deepEqual(r.merged, make({ notas: 'nota local', respuesta: 'respuesta remota', estado: 'en_proceso' }))
  assert.deepEqual(r.conflicts, [])
})

test('D. el mismo campo con valores distintos es un CONFLICTO y no se decide en silencio', () => {
  const r = reconcile(base, make({ notas: 'versión local' }), make({ notas: 'versión remota' }))
  assert.deepEqual(r.conflicts, ['notas'])
  assert.equal(r.merged.notas, 'versión local', 'mientras no se elija, el borrador local se conserva intacto')
  const several = reconcile(base, make({ notas: 'a', respuesta: 'x', estado: 'atendido' }), make({ notas: 'b', respuesta: 'y', estado: 'en_proceso' }))
  assert.deepEqual(several.conflicts.sort(), ['estado', 'notas', 'respuesta'])
})

test('E. ambos llegaron al mismo valor: no hay conflicto', () => {
  const r = reconcile(base, make({ notas: 'igual' }), make({ notas: 'igual' }))
  assert.deepEqual(r.conflicts, []); assert.equal(r.merged.notas, 'igual')
})

test('una revisión nueva sin cambios en los campos editables no genera conflicto ni cambia nada', () => {
  const r = reconcile(base, make({ notas: 'local' }), base)
  assert.deepEqual(r.conflicts, []); assert.deepEqual(r.remoteOnly, []); assert.equal(r.merged.notas, 'local')
  const clean = reconcile(base, base, base); assert.deepEqual(clean.merged, base)
})

test('la fusión insegura anterior (conservar siempre lo local) habría ocultado el conflicto', () => {
  // mergeDraft antiguo: keep(k) = local != base  ->  lo local ganaba aunque el servidor también hubiera cambiado ese campo.
  const oldMerge = (local, b, remote) => Object.fromEntries(Object.keys(remote).map(k => [k, local[k] !== b[k] ? local[k] : remote[k]]))
  const local = make({ notas: 'versión local' }), remote = make({ notas: 'versión remota de otra persona' })
  assert.equal(oldMerge(local, base, remote).notas, 'versión local', 'antes: se pisaba la nota ajena sin avisar')
  assert.deepEqual(reconcile(base, local, remote).conflicts, ['notas'], 'ahora: se detecta y exige elegir')
})

test('una respuesta del servidor más antigua que la base aceptada se descarta', () => {
  assert.equal(isOlderThan({ revision: 2 }, { revision: 3 }), true)
  assert.equal(isOlderThan({ revision: 3 }, { revision: 3 }), false)
  assert.equal(isOlderThan({ revision: 4 }, { revision: 3 }), false)
  assert.deepEqual(valuesOf({ ...base, revision: 9, historial: [] }), base)
})
