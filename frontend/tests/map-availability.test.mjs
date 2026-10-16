import test from 'node:test'
import assert from 'node:assert/strict'
import { probeMapReachable, MAP_PROBE_URL } from '../src/mapAvailability.ts'

// Imagen falsa: el test decide cuándo (y si) carga; no hay red.
function fakeImage() {
  const img = { onload: null, onerror: null, _src: '' }
  Object.defineProperty(img, 'src', { get: () => img._src, set: v => { img._src = v } })
  return img
}

test('resuelve true cuando el recurso carga', async () => {
  const img = fakeImage()
  const promise = probeMapReachable({ createImage: () => img, timeoutMs: 1000 })
  assert.ok(img.src.startsWith(MAP_PROBE_URL + '?_='))
  img.onload(new Event("load"))
  assert.equal(await promise, true)
})

test('resuelve false cuando el recurso falla', async () => {
  const img = fakeImage()
  const promise = probeMapReachable({ createImage: () => img, timeoutMs: 1000 })
  img.onerror(new Event("error"))
  assert.equal(await promise, false)
})

test('resuelve false cuando se agota el tiempo y una carga tardía no cambia el resultado', async () => {
  const img = fakeImage()
  const promise = probeMapReachable({ createImage: () => img, timeoutMs: 20 })
  assert.equal(await promise, false)
  assert.equal(img.onload, null)
  assert.equal(img.onerror, null)
})

test('resuelve false (sin rechazar) si asignar la dirección lanza una excepción', async () => {
  const img = { onload: null, onerror: null, set src(_) { throw new Error('bloqueado') } }
  assert.equal(await probeMapReachable({ createImage: () => img, timeoutMs: 1000 }), false)
})
