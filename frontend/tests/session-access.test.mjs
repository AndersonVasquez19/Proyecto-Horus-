import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCESS_MODES, ADMIN_ROLES, hasPermission, parseSession } from '../src/panel/context/sessionAccess.ts'
import { ACCESS_DENIED, LOGIN_FAILURE, REFRESH_AFTER_DENIED_MS, REFRESH_ON_FOCUS_MS, RESTORE_FAILURE, classifySessionFailure, createRefreshGate, sameAccess } from '../src/panel/context/sessionRefresh.ts'

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

// ---- E3.4.4, fase 1: revalidación de la sesión abierta, 401 frente a 403 y fallo de /admin/me tras el login ----
test('intervalo mínimo: el foco consulta como mucho una vez cada 30 s y un 403, una cada 5 s (sin ráfagas ni bucles)', () => {
  let now = 1000
  const gate = createRefreshGate(() => now)
  assert.equal(gate.request('focus'), true, 'la primera revalidación se permite')
  let allowed = 0
  for (let i = 0; i < 200; i++) { now += 100; if (gate.request('focus') || gate.request('denied')) allowed++ } // 20 s de foco y 403 continuos
  assert.equal(allowed, 4, 'en 20 s de avisos continuos solo pasan las de cada 5 s (403), nunca una por aviso')
  now += REFRESH_AFTER_DENIED_MS - 1
  assert.equal(gate.request('denied'), false)
  now += 1
  assert.equal(gate.request('denied'), true)
  now += REFRESH_ON_FOCUS_MS - 1
  assert.equal(gate.request('focus'), false)
  now += 1
  assert.equal(gate.request('focus'), true)
  // Una validación hecha por otro camino (login, restauración, reintento) también cuenta.
  now += 60_000; gate.mark()
  assert.equal(gate.request('focus'), false)
  assert.equal(gate.request('denied'), false)
  now += REFRESH_AFTER_DENIED_MS
  assert.equal(gate.request('denied'), true)
  // Por defecto usa el reloj monótono del navegador, leído en cada llamada.
  assert.equal(createRefreshGate().request('focus'), true)
})

test('sameAccess: detecta cambios de rol, permisos, modo o contrato; el orden de los permisos no importa', () => {
  const access = (rol, permisos, modo = 'heredado') => parseSession(full(rol, permisos, modo)).access
  const legacy = parseSession({ ok: true, user: identity }).access
  assert.equal(sameAccess(access('SECRETARIA', ['mensajes:leer', 'mensajes:crear']), access('SECRETARIA', ['mensajes:crear', 'mensajes:leer'])), true)
  assert.equal(sameAccess(legacy, parseSession({ ok: true, user: identity }).access), true, 'backend antiguo estable')
  assert.equal(sameAccess(access(null, []), access(null, [])), true, 'cuenta sin rol estable')
  const changes = [
    [access('SECRETARIA', ['mensajes:leer']), access('COORDINADORA_INSTITUCIONAL', ['mensajes:leer'])], // cambio de rol
    [access('SECRETARIA', ['mensajes:leer', 'mensajes:crear']), access('SECRETARIA', ['mensajes:leer'])], // permiso retirado
    [access('SECRETARIA', ['mensajes:leer']), access('SECRETARIA', ['mensajes:leer', 'cursos:leer'])], // permiso añadido
    [access('SECRETARIA', ['mensajes:leer']), access('SECRETARIA', ['cursos:leer'])], // mismo tamaño, otro permiso
    [access('SECRETARIA', ['mensajes:leer'], 'heredado'), access('SECRETARIA', ['mensajes:leer'], 'por_roles')], // cambio de modo
    [legacy, access(null, [])], // backend antiguo frente a cuenta sin rol
    [access('GERENTE_GENERAL', ['cursos:leer']), access(null, [])], // rol retirado
  ]
  for (const [a, b] of changes) { assert.equal(sameAccess(a, b), false, JSON.stringify([a, b])); assert.equal(sameAccess(b, a), false) }
  assert.equal(sameAccess(null, legacy), false)
  assert.equal(sameAccess(null, null), true)
})

test('fallos de /admin/me: 401, 403, red o servidor temporal y respuesta incompatible se distinguen', () => {
  const http = status => Object.assign(new Error('texto del servidor ER_SECRET'), { status })
  assert.equal(classifySessionFailure(http(401)), 'unauthorized')
  assert.equal(classifySessionFailure(http(403)), 'forbidden', '403 no es una sesión vencida')
  for (const error of [new TypeError('Failed to fetch'), Object.assign(new Error('aborted'), { name: 'AbortError' }), http(408), http(429), http(500), http(502), http(503), http(504), null, undefined])
    assert.equal(classifySessionFailure(error), 'temporary', String(error?.status ?? error?.name ?? error))
  for (const status of [200, 204, 302, 400, 404, 405]) assert.equal(classifySessionFailure(http(status)), 'incompatible', String(status))
  assert.equal(classifySessionFailure(http(401), true), 'incompatible', 'una respuesta con forma inesperada nunca concede nada')
})

test('mensajes: claros, en español, sin texto del servidor y sin decir que la sesión venció ante un 403', () => {
  for (const kind of ['unauthorized', 'forbidden', 'temporary', 'incompatible']) assert.ok(LOGIN_FAILURE[kind].startsWith('No pudimos abrir tu sesión'), kind)
  assert.notEqual(new Set(Object.values(LOGIN_FAILURE)).size, 1, 'cada motivo tiene su mensaje')
  assert.ok(RESTORE_FAILURE.temporary.startsWith('No pudimos validar tu sesión'))
  assert.ok(RESTORE_FAILURE.incompatible.includes('no es compatible con este panel'))
  for (const text of [ACCESS_DENIED, LOGIN_FAILURE.forbidden, RESTORE_FAILURE.forbidden]) assert.ok(!/venci|expir|terminó/i.test(text), text)
  assert.ok(/permiso/.test(ACCESS_DENIED))
  for (const text of [ACCESS_DENIED, ...Object.values(LOGIN_FAILURE), ...Object.values(RESTORE_FAILURE)]) assert.ok(!/\b(40\d|50\d)\b|status|token|JWT|Forbidden|Unauthorized/i.test(text), text)
})

test('403 en las peticiones del panel: mensaje uniforme, sin el texto ni el cuerpo del servidor, sin cerrar la sesión ni avisar desde /admin/me', () => {
  const api = source('services/panelApi.ts')
  const denied = api.slice(api.indexOf('response.status === 403'), api.indexOf('if (!response.ok'))
  assert.ok(/throw new PanelApiError\(ACCESS_DENIED, 403\)/.test(denied), 'mensaje uniforme, sin cuerpo')
  assert.ok(/path !== 'me'/.test(denied) && /reportAccessDenied\(token\)/.test(denied), 'avisa para revalidar, salvo el propio /admin/me (evita un bucle)')
  assert.ok(!/reportExpiredSession/.test(denied), 'un 403 no cierra la sesión')
  assert.ok(/reportAccessDenied/.test(source('components/ImageUpload.tsx')) && /denied \|\|/.test(source('components/ImageUpload.tsx')), 'la subida de imágenes trata el 403 igual y detiene el lote')
  const context = source('context/AdminAuthContext.tsx')
  assert.ok(/ACCESS_DENIED_EVENT/.test(context) && /revalidate\('denied'\)/.test(context) && /revalidate\('focus'\)/.test(context))
  assert.ok(!/setInterval/.test(context), 'sin consultas periódicas: solo foco, pestaña visible y 403, con intervalo mínimo')
})
