import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PANEL_SECTIONS, RESOURCE_READ, panelNavigation } from '../src/panel/context/panelAccess.ts'
import { parseSession } from '../src/panel/context/sessionAccess.ts'

// Navegación del panel según los permisos de la sesión (E3.4.3, fase 1). Todo ficticio.
// Las listas de permisos de cada rol NO se copian aquí: se leen del código del backend (policy.ts y permissions.ts), de modo que si la
// matriz cambia estas pruebas usan la nueva. El panel, en cambio, no conoce la matriz: solo recibe la lista de la sesión.
const here = path.dirname(fileURLToPath(import.meta.url))
const backend = file => fs.readFileSync(path.join(here, '..', '..', 'backend', 'src', 'permissions', file), 'utf8')
const literals = text => [...text.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map(match => match[1])
const policy = backend('policy.ts')
const roleList = name => literals(policy.match(new RegExp('const ' + name + ': readonly Permission\\[\\] = \\[([\\s\\S]*?)\\];'))[1])
const catalog = backend('permissions.ts')
const ALL = [...catalog.match(/RESOURCE_OPERATIONS = \{([\s\S]*?)\} as const/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .flatMap(([, resource, ops]) => [...ops.matchAll(/'([a-z_]+)'/g)].map(op => resource + ':' + op[1]))
const PERMISOS = { GERENTE_GENERAL: ALL, COORDINADORA_INSTITUCIONAL: roleList('COORDINADORA_INSTITUCIONAL'), SECRETARIA: roleList('SECRETARIA') }

const identity = { id: 7, nombre: 'Persona Ficticia', email: 'persona@example.test' }
const session = (rol, modo = 'heredado', permisos = rol ? PERMISOS[rol] : []) => parseSession({ ok: true, user: { ...identity, rol, permisos }, acceso: { modo } }).access
const legacyBackend = () => parseSession({ ok: true, user: identity }).access
const WORK = PANEL_SECTIONS.filter(rule => rule.anyOf.length && rule.available !== false).map(rule => rule.key)
const visible = nav => PANEL_SECTIONS.map(rule => rule.key).filter(key => nav.canOpen(key))

test('las listas de la prueba vienen del backend y no están vacías', () => {
  assert.ok(ALL.length > 60 && PERMISOS.COORDINADORA_INSTITUCIONAL.length > 20 && PERMISOS.SECRETARIA.length > 5)
  assert.ok(ALL.includes('cuentas:leer') && !PERMISOS.SECRETARIA.includes('estadisticas:leer'))
})

test('cada permiso de la navegación existe en el catálogo y es el que exige el GET que carga la sección', () => {
  for (const rule of PANEL_SECTIONS) for (const permission of rule.anyOf) assert.ok(ALL.includes(permission), rule.key + ': ' + permission)
  for (const permission of Object.values(RESOURCE_READ)) assert.ok(ALL.includes(permission), permission)
  const inventory = backend('route-inventory.ts')
  const requiredBy = route => inventory.match(new RegExp("perm\\('GET', '" + route + "', '([a-z_:]+)'"))?.[1]
  const loads = { resumen: 'admin/stats', servicios: 'admin/servicios', galeria: 'admin/galeria', faq: 'admin/preguntas-frecuentes', contenido: 'admin/items', convenios: 'admin/convenios', mensajes: 'admin/messages', cotizaciones: 'admin/cotizaciones', chatbot: 'admin/chatbot/sin-respuesta', ajustes: 'admin/settings', cuentas: 'admin/users' }
  for (const [key, route] of Object.entries(loads)) assert.deepEqual(PANEL_SECTIONS.find(rule => rule.key === key).anyOf, [requiredBy(route)], key)
  assert.equal(requiredBy('admin/stats/actividad'), 'estadisticas:leer', 'el resumen también carga la actividad')
  for (const [resource, route] of Object.entries({ cursos: 'admin/cursos', servicios: 'admin/servicios', faq: 'admin/preguntas-frecuentes', galeria: 'admin/galeria', contenido: 'admin/items' })) assert.equal(RESOURCE_READ[resource], requiredBy(route), resource)
})

test('gerente: todas las secciones de trabajo actuales e inicio en Resumen', () => {
  for (const modo of ['heredado', 'por_roles']) {
    const nav = panelNavigation(session('GERENTE_GENERAL', modo))
    assert.equal(nav.kind, 'roles')
    assert.equal(nav.home, 'resumen')
    for (const key of [...WORK, 'configuracion']) assert.ok(nav.canOpen(key), key)
    for (const resource of Object.keys(RESOURCE_READ)) assert.ok(nav.canOpenResource(resource), resource)
  }
})

test('coordinadora: contenido, atención y Resumen; sin Biblioteca de contenido', () => {
  const nav = panelNavigation(session('COORDINADORA_INSTITUCIONAL'))
  assert.equal(nav.home, 'resumen')
  assert.deepEqual(visible(nav), ['resumen', 'cursos', 'servicios', 'galeria', 'faq', 'convenios', 'mensajes', 'cotizaciones', 'chatbot', 'ajustes', 'configuracion'])
  assert.equal(nav.canOpenResource('contenido'), false)
})

test('secretaria: inicia en la Bandeja, sin Resumen (no consulta estadísticas) ni secciones ajenas', () => {
  for (const modo of ['heredado', 'por_roles']) {
    const nav = panelNavigation(session('SECRETARIA', modo))
    assert.equal(nav.home, 'mensajes')
    assert.equal(nav.canOpen('resumen'), false, 'GET /admin/stats exige estadisticas:leer')
    assert.deepEqual(visible(nav), ['cursos', 'mensajes', 'chatbot', 'ajustes', 'configuracion'])
    // Educación: puede leer cursos y capacitaciones, pero no Asesoramiento (que es un servicio).
    assert.equal(nav.canOpenResource('cursos'), true)
    assert.equal(nav.canOpenResource('servicios'), false)
    for (const key of ['servicios', 'galeria', 'faq', 'contenido', 'convenios', 'cotizaciones', 'cuentas']) assert.equal(nav.canOpen(key), false, key)
  }
})

test('Biblioteca de contenido: solo con items:leer cuando hay rol', () => {
  assert.equal(panelNavigation(session('SECRETARIA', 'heredado', ['items:leer'])).canOpen('contenido'), true)
  assert.equal(panelNavigation(session('SECRETARIA', 'heredado', ['items:leer'])).canOpenResource('contenido'), true)
  assert.equal(panelNavigation(session('COORDINADORA_INSTITUCIONAL', 'heredado', ['cursos:leer'])).canOpen('contenido'), false)
})

test('backend antiguo y cuenta sin rol en modo heredado: navegación heredada completa, sin Cuentas y acceso', () => {
  for (const access of [legacyBackend(), session(null, 'heredado')]) {
    const nav = panelNavigation(access)
    assert.equal(nav.kind, 'legacy')
    assert.equal(nav.home, 'resumen')
    assert.deepEqual(visible(nav), [...WORK, 'configuracion'])
    assert.equal(nav.canOpen('cuentas'), false)
  }
  // El backend antiguo no aporta permisos: la navegación heredada no se apoya en ninguno inventado.
  assert.deepEqual(legacyBackend().permisos, [])
})

test('modo por_roles sin rol: solo autoservicio (Ajustes), sin inicio de trabajo', () => {
  const nav = panelNavigation(session(null, 'por_roles'))
  assert.equal(nav.kind, 'sin-rol')
  assert.equal(nav.home, null)
  assert.deepEqual(visible(nav), ['configuracion'])
  for (const resource of Object.keys(RESOURCE_READ)) assert.equal(nav.canOpenResource(resource), false)
})

test('rol sin ningún permiso de lectura: sin inicio, solo Ajustes', () => {
  const nav = panelNavigation(session('SECRETARIA', 'por_roles', ['mensajes:crear']))
  assert.equal(nav.home, null)
  assert.deepEqual(visible(nav), ['configuracion'])
})

test('sesión no validada o inválida: ninguna sección, ni siquiera Ajustes', () => {
  for (const access of [null, undefined, parseSession({ user: 'x' }).access]) {
    const nav = panelNavigation(access)
    assert.equal(nav.kind, 'none')
    assert.equal(nav.home, null)
    assert.deepEqual(visible(nav), [])
    assert.equal(nav.canOpenResource('cursos'), false)
  }
})

test('Cuentas y acceso no se habilita en E3.4.3: ni en heredado ni en por_roles, ni siquiera con cuentas:leer', () => {
  const rule = PANEL_SECTIONS.find(item => item.key === 'cuentas')
  assert.equal(rule.available, false)
  assert.equal(rule.requiresRolesMode, true)
  for (const modo of ['heredado', 'por_roles']) assert.equal(panelNavigation(session('GERENTE_GENERAL', modo)).canOpen('cuentas'), false, modo)
})

test('secciones desconocidas o con forma rara no se abren; el nombre del rol no concede nada', () => {
  const nav = panelNavigation(session('GERENTE_GENERAL'))
  for (const key of ['', 'admin', 'usuarios', 'estudiantes', 'matriculas', 'certificados', '__proto__', 'constructor', 'toString', undefined, null, 5, {}]) assert.equal(nav.canOpen(key), false, String(key))
  for (const resource of ['', 'items', 'mensajes', '__proto__', 'toString']) assert.equal(nav.canOpenResource(resource), false, resource)
  // Con el rol de gerente pero sin permisos, no se abre nada: lo que decide es la lista del backend.
  assert.deepEqual(visible(panelNavigation(session('GERENTE_GENERAL', 'por_roles', []))), ['configuracion'])
})

test('no hay enlaces a módulos académicos todavía', () => {
  for (const rule of PANEL_SECTIONS) assert.ok(!/estudiantes|convocatorias|matriculas|certificados|asistencia|calificaciones|sesiones/.test(rule.key + rule.anyOf.join() + rule.target), rule.key)
})
