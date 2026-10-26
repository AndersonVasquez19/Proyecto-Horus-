import test from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_MAP_STATE, locationMapReducer as r } from '../src/locationMapState.ts'

test('el estado inicial es la tarjeta, sin mapa', () => {
  assert.deepEqual(INITIAL_MAP_STATE, { view: 'card', notice: null })
})

test('pulsar el botón con Internet muestra el mapa', () => {
  assert.deepEqual(r(INITIAL_MAP_STATE, { type: 'show', online: true }), { view: 'map', notice: null })
})

test('pulsar el botón sin conexión clara no crea el mapa y avisa', () => {
  assert.deepEqual(r(INITIAL_MAP_STATE, { type: 'show', online: false }), { view: 'card', notice: 'offline' })
})

test('desconectarse con el mapa abierto lo retira y vuelve a la tarjeta', () => {
  const open = r(INITIAL_MAP_STATE, { type: 'show', online: true })
  assert.deepEqual(r(open, { type: 'offline' }), { view: 'card', notice: 'offline' })
})

test('desconectarse con la tarjeta visible no cambia nada', () => {
  assert.equal(r(INITIAL_MAP_STATE, { type: 'offline' }), INITIAL_MAP_STATE)
})

test('recuperar la conexión nunca reactiva el mapa', () => {
  const offline = r(r(INITIAL_MAP_STATE, { type: 'show', online: true }), { type: 'offline' })
  const back = r(offline, { type: 'online' })
  assert.equal(back.view, 'card')
  assert.equal(back.notice, null)
  assert.equal(r(INITIAL_MAP_STATE, { type: 'online' }), INITIAL_MAP_STATE)
})

test('con el mapa abierto, volver a tener conexión lo deja abierto sin cambios', () => {
  const open = r(INITIAL_MAP_STATE, { type: 'show', online: true })
  assert.equal(r(open, { type: 'online' }), open)
})

test('ocultar el mapa devuelve la tarjeta', () => {
  const open = r(INITIAL_MAP_STATE, { type: 'show', online: true })
  assert.deepEqual(r(open, { type: 'hide' }), INITIAL_MAP_STATE)
})

test('una secuencia desconexión → reconexión → desconexión nunca deja un mapa abierto sin acción', () => {
  let s = r(INITIAL_MAP_STATE, { type: 'show', online: true })
  for (const type of ['offline', 'online', 'offline', 'online']) s = r(s, { type })
  assert.equal(s.view, 'card')
})
