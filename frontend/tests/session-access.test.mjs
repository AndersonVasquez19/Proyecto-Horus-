import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCESS_MODES, ADMIN_ROLES, hasPermission, parseSession } from '../src/panel/context/sessionAccess.ts'

// Contrato de sesión del backend (login y /admin/me) interpretado por el panel. Todo ficticio. Los permisos de estas pruebas son
// listas arbitrarias: el panel no tiene matriz propia, copia lo que informa el backend.
const identity = { id: 7, nombre: 'Persona Ficticia', email: 'persona@example.test' }
const full = (rol, permisos, modo = 'heredado', extraUser = {}) => ({ ok: true, token: 'no-se-usa', user: { ...identity, rol, permisos, ...extraUser }, acceso: { modo } })

test('los tres roles reconocidos y los dos modos son exactamente los del backend', () => {
  assert.deepEqual([...ADMIN_ROLES], ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL', 'SECRETARIA'])
  assert.deepEqual([...ACCESS_MODES], ['heredado', 'por_roles'])
})

test('contrato nuevo: cada rol llega con los permisos y el modo que informó el backend, sin matriz local', () => {
  const samples = { GERENTE_GENERAL: ['cuentas:leer', 'cursos:leer', 'mensajes:eliminar'], COORDINADORA_INSTITUCIONAL: ['cursos:leer', 'mensajes:crear'], SECRETARIA: ['mensajes:crear', 'mensajes:leer'] }
  for (const rol of ADMIN_ROLES) {
    for (const modo of ACCESS_MODES) {
      const parsed = parseSession(full(rol, samples[rol], modo))
      assert.equal(parsed.kind, 'roles', rol)
      assert.deepEqual(parsed.user, identity)
      assert.deepEqual(parsed.access, { contract: 'roles', mode: modo, rol, permisos: samples[rol] })
    }
  }
  // Lo que el backend NO envía no se inventa: el panel no completa permisos a partir del rol.
  assert.deepEqual(parseSession(full('GERENTE_GENERAL', [])).access.permisos, [])
})

test('cuenta sin rol: rol null y lista vacía, distinto de «el backend no informó nada»', () => {
  for (const modo of ACCESS_MODES) {
    const parsed = parseSession(full(null, [], modo))
    assert.equal(parsed.kind, 'roles')
    assert.deepEqual(parsed.access, { contract: 'roles', mode: modo, rol: null, permisos: [] })
  }
  const legacy = parseSession({ ok: true, user: identity })
  assert.equal(legacy.access.contract, 'antiguo')
  assert.notEqual(legacy.access.contract, parseSession(full(null, [])).access.contract, 'sin rol (conocido) ≠ sin datos (desconocido)')
})

test('backend antiguo (sin rol, permisos ni acceso): modo heredado, sin rol ni permisos concedidos', () => {
  for (const response of [{ ok: true, user: identity }, { ok: true, token: 'x', user: identity }, { user: identity }]) {
    const parsed = parseSession(response)
    assert.equal(parsed.kind, 'antiguo')
    assert.deepEqual(parsed.user, identity)
    assert.deepEqual(parsed.access, { contract: 'antiguo', mode: 'heredado', rol: null, permisos: [] })
  }
})

test('solo se conserva la identidad conocida: ningún otro campo de la respuesta pasa al estado de la sesión', () => {
  const extra = { password: 'x', session_version: 3, isAdmin: true, role: 'GERENTE_GENERAL', activo: true }
  for (const response of [{ ok: true, user: { ...identity, ...extra } }, full('SECRETARIA', ['mensajes:leer'], 'heredado', extra)]) {
    const parsed = parseSession(response)
    assert.deepEqual(Object.keys(parsed.user).sort(), ['email', 'id', 'nombre'])
    assert.deepEqual(Object.keys(parsed.access).sort(), ['contract', 'mode', 'permisos', 'rol'])
  }
})

test('los permisos se copian y no se pueden alterar después: ni desde la respuesta original ni desde el estado', () => {
  const response = full('SECRETARIA', ['mensajes:leer', 'mensajes:leer', 'mensajes:crear'])
  const { access } = parseSession(response)
  assert.deepEqual(access.permisos, ['mensajes:leer', 'mensajes:crear'], 'sin duplicados')
  response.user.permisos.push('cuentas:crear')
  response.user.rol = 'GERENTE_GENERAL'
  assert.deepEqual(access.permisos, ['mensajes:leer', 'mensajes:crear'])
  assert.equal(access.rol, 'SECRETARIA')
  assert.throws(() => access.permisos.push('cuentas:crear'), TypeError)
  assert.throws(() => { 'use strict'; access.rol = 'GERENTE_GENERAL' }, TypeError)
})

test('respuestas mal formadas o incoherentes: inválidas, nunca con privilegios por defecto', () => {
  const bad = [
    undefined, null, 'texto', 42, [], {}, { ok: true }, { user: null }, { user: 'x' }, { user: [] }, { user: [identity] },
    { user: { ...identity, id: 0 } }, { user: { ...identity, id: -1 } }, { user: { ...identity, id: '7' } }, { user: { ...identity, id: 1.5 } },
    { user: { ...identity, id: NaN } }, { user: { ...identity, id: Number.MAX_SAFE_INTEGER + 2 } }, { user: { nombre: 'x', email: 'y' } },
    { user: { ...identity, nombre: undefined } }, { user: { ...identity, email: 5 } },
    // contrato a medias: se necesitan los tres campos o ninguno
    { user: { ...identity, rol: 'SECRETARIA' } }, { user: { ...identity, permisos: [] } }, { acceso: { modo: 'heredado' }, user: identity },
    { user: { ...identity, rol: 'SECRETARIA', permisos: ['a:b'] } }, { user: { ...identity, rol: null, permisos: [] } },
    { user: { ...identity, permisos: [] }, acceso: { modo: 'heredado' } }, { user: { ...identity, rol: null }, acceso: { modo: 'heredado' } },
    // rol
    full('ADMINISTRADOR', ['a:b']), full('gerente_general', ['a:b']), full(' SECRETARIA', ['a:b']), full(1, []), full(undefined, []), full({}, []), full(['SECRETARIA'], []),
    // permisos
    full('SECRETARIA', 'mensajes:leer'), full('SECRETARIA', null), full('SECRETARIA', { 0: 'a:b' }), full('SECRETARIA', ['a:b', 5]), full('SECRETARIA', ['']),
    full('SECRETARIA', [null]), full('SECRETARIA', ['x'.repeat(101)]), full('SECRETARIA', Array.from({ length: 501 }, (_, i) => 'recurso:op' + i)),
    // sin rol no puede haber permisos
    full(null, ['mensajes:leer']), full(null, ['cuentas:crear']),
    // modo
    full('SECRETARIA', ['a:b'], 'desconocido'), { ...full('SECRETARIA', ['a:b']), acceso: { modo: undefined } }, full('SECRETARIA', ['a:b'], 'POR_ROLES'), full('SECRETARIA', ['a:b'], null),
    { user: { ...identity, rol: 'SECRETARIA', permisos: ['a:b'] }, acceso: 'por_roles' }, { user: { ...identity, rol: 'SECRETARIA', permisos: ['a:b'] }, acceso: null },
    { user: { ...identity, rol: 'SECRETARIA', permisos: ['a:b'] }, acceso: [] }, { user: { ...identity, rol: 'SECRETARIA', permisos: ['a:b'] }, acceso: {} },
  ]
  for (const response of bad) assert.deepEqual(parseSession(response), { kind: 'invalid' }, JSON.stringify(response)?.slice(0, 120))
})

test('un rol o permisos «sobrantes» fuera del lugar del contrato no cuentan', () => {
  // El rol solo se lee de user.rol; ni la raíz de la respuesta ni nombres parecidos conceden nada.
  const parsed = parseSession({ ok: true, user: identity, rol: 'GERENTE_GENERAL', permisos: ['cuentas:crear'], role: 'GERENTE_GENERAL', acceso: undefined })
  assert.equal(parsed.kind, 'invalid', 'acceso presente (aunque sea undefined) sin el resto del contrato es un contrato a medias')
  const plain = parseSession({ ok: true, user: { ...identity, role: 'GERENTE_GENERAL', roles: ['GERENTE_GENERAL'] }, rol: 'GERENTE_GENERAL', permisos: ['cuentas:crear'] })
  assert.equal(plain.kind, 'antiguo')
  assert.deepEqual(plain.access, { contract: 'antiguo', mode: 'heredado', rol: null, permisos: [] })
})

test('hasPermission: solo reconoce lo que contiene la lista recibida', () => {
  const list = ['cursos:leer', 'mensajes:crear']
  assert.equal(hasPermission(list, 'cursos:leer'), true)
  assert.equal(hasPermission(list, 'mensajes:crear'), true)
  for (const permiso of ['cursos:crear', 'cursos:', 'cursos', 'CURSOS:LEER', ' cursos:leer', 'mensajes:eliminar', '', undefined, null, 5, {}]) assert.equal(hasPermission(list, permiso), false, String(permiso))
  for (const missing of [null, undefined, [], 'cursos:leer', {}, 5, { includes: () => true }]) assert.equal(hasPermission(missing, 'cursos:leer'), false)
  assert.equal(hasPermission(parseSession({ ok: true, user: identity }).access.permisos, 'cursos:leer'), false, 'backend antiguo: no concede nada')
})

// ---- Lo que el panel nunca guarda ni usa como fuente ----
const here = path.dirname(fileURLToPath(import.meta.url))
const panel = path.join(here, '..', 'src', 'panel')
const source = file => fs.readFileSync(path.join(panel, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

test('el rol y los permisos viven solo en memoria: el módulo no toca el almacenamiento y el contexto solo guarda el token', () => {
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(source('context/sessionAccess.ts')))
  const context = source('context/AdminAuthContext.tsx')
  const storageLines = context.split('\n').filter(line => /localStorage|sessionStorage/.test(line))
  assert.ok(storageLines.length > 0)
  for (const line of storageLines) {
    assert.ok(/STORAGE_KEY/.test(line), 'solo la clave del token: ' + line.trim())
    assert.ok(!/access|rol|permisos|user/i.test(line.replace(/STORAGE_KEY/g, '')), 'sin rol, permisos ni usuario: ' + line.trim())
  }
  assert.ok(!/sessionStorage/.test(context))
  // La identidad no se reconstruye del JWT: el panel no decodifica el token.
  assert.ok(!/atob\(|JSON\.parse\(|split\('\.'\)/.test(context), 'el contexto no interpreta el contenido del JWT')
})
