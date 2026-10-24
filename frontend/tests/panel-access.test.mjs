import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PANEL_ACTIONS, PANEL_SECTIONS, RESOURCE_READ, RESOURCE_WRITE, panelNavigation } from '../src/panel/context/panelAccess.ts'
import { parseSession } from '../src/panel/context/sessionAccess.ts'
import { canRemove, educationSections, resources, supportsRemove } from '../src/panel/types/workspace.ts'
import { canMoveQuote, quoteTransitionPermission, quoteTransitions } from '../src/panel/types/quotes.ts'

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
// Secciones de trabajo disponibles en cualquier modo. «Roles y usuarios» (cuentas) exige además el modo por_roles y se prueba aparte.
const WORK = PANEL_SECTIONS.filter(rule => rule.anyOf.length && rule.available !== false && !rule.requiresRolesMode).map(rule => rule.key)
const visible = nav => PANEL_SECTIONS.map(rule => rule.key).filter(key => nav.canOpen(key))

test('cursos y capacitaciones nunca ofrecen DELETE, independientemente del rol, modo o estado', () => {
  for (const mode of ['heredado', 'por_roles']) for (const rol of [null, ...Object.keys(PERMISOS)]) {
    const nav = panelNavigation(session(rol, mode))
    for (const scope of educationSections.filter(s => s.resource === 'cursos')) {
      const resource = resources[scope.resource]
      assert.equal(supportsRemove(resource) && nav.can(RESOURCE_WRITE.cursos.eliminar), false, String(rol) + ' ' + mode + ' ' + scope.key)
      for (const estado of resource.states) assert.equal(canRemove(resource, { id: 7, estado }), false)
      assert.ok(resource.fields.find(f => f.key === 'estado').options.includes('archivado'))
      assert.ok(resource.fields.find(f => f.key === 'estado').options.includes('publicado'))
    }
  }
  assert.equal(canRemove({ ...resources.cursos, hardDelete: true }, { id: 7 }), false, 'un indicador antiguo no habilita DELETE')
})

test('servicios conservan borrado definitivo y FAQ conserva archivado', () => {
  for (const estado of resources.servicios.states) assert.equal(canRemove(resources.servicios, { id: 7, estado }), true)
  assert.equal(canRemove(resources.faq, { id: 7, estado: 'publicado' }), true)
  assert.equal(canRemove(resources.faq, { id: 7, estado: 'archivado' }), false)
})

test('las listas de la prueba vienen del backend y no están vacías', () => {
  assert.ok(ALL.length > 60 && PERMISOS.COORDINADORA_INSTITUCIONAL.length > 20 && PERMISOS.SECRETARIA.length > 5)
  assert.ok(ALL.includes('cuentas:leer') && !PERMISOS.SECRETARIA.includes('estadisticas:leer'))
})

test('cada permiso de la navegación existe en el catálogo y es el que exige el GET que carga la sección', () => {
  for (const rule of PANEL_SECTIONS) for (const permission of rule.anyOf) assert.ok(ALL.includes(permission), rule.key + ': ' + permission)
  for (const permission of Object.values(RESOURCE_READ)) assert.ok(ALL.includes(permission), permission)
  const inventory = backend('route-inventory.ts')
  const requiredBy = route => inventory.match(new RegExp("perm\\('GET', '" + route + "', '([a-z_:]+)'"))?.[1]
  const loads = { resumen: 'admin/stats', servicios: 'admin/servicios', galeria: 'admin/galeria', faq: 'admin/preguntas-frecuentes', contenido: 'admin/items', convenios: 'admin/convenios', mensajes: 'admin/messages', cotizaciones: 'admin/cotizaciones', chatbot: 'admin/chatbot/sin-respuesta', ajustes: 'admin/settings', cuentas: 'admin/users', preinscripciones: 'admin/preinscripciones', reportes: 'admin/reportes' }
  assert.equal(requiredBy('admin/reportes/:tipo'), 'reportes_academicos:leer', 'la consulta de un reporte usa el mismo permiso que el catálogo')
  assert.equal(requiredBy('admin/preinscripciones/resumen'), 'preinscripciones:leer', 'el avance por edición usa el mismo permiso de lectura')
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

test('coordinadora: gestión académica, atención y Resumen, sin gestores editoriales', () => {
  const nav = panelNavigation(session('COORDINADORA_INSTITUCIONAL'))
  assert.equal(nav.home, 'resumen')
  assert.deepEqual(visible(nav), ['resumen', 'estudiantes', 'ediciones', 'matriculas', 'preinscripciones', 'reportes', 'importacion-excel', 'mensajes', 'cotizaciones', 'chatbot', 'configuracion'])
  assert.equal(nav.canOpenResource('contenido'), false)
})

test('secretaria: inicia en la Bandeja, sin Resumen (no consulta estadísticas) ni secciones ajenas', () => {
  for (const modo of ['heredado', 'por_roles']) {
    const nav = panelNavigation(session('SECRETARIA', modo))
    assert.equal(nav.home, 'mensajes')
    assert.equal(nav.canOpen('resumen'), false, 'GET /admin/stats exige estadisticas:leer')
    assert.deepEqual(visible(nav), ['estudiantes', 'ediciones', 'matriculas', 'preinscripciones', 'mensajes', 'chatbot', 'configuracion'])
    // Educación: puede leer cursos y capacitaciones, pero no Asesoramiento (que es un servicio).
    assert.equal(nav.canOpenResource('cursos'), true)
    assert.equal(nav.canOpenResource('servicios'), false)
    for (const key of ['servicios', 'galeria', 'faq', 'contenido', 'convenios', 'cotizaciones', 'cuentas']) assert.equal(nav.canOpen(key), false, key)
  }
})

test('gestores editoriales retirados incluso con todos sus permisos y en modo heredado', () => {
  for (const access of [legacyBackend(), session(null, 'heredado'), session('GERENTE_GENERAL', 'por_roles'), session('COORDINADORA_INSTITUCIONAL')]) {
    const nav = panelNavigation(access)
    for (const key of ['cursos', 'educacion', 'servicios', 'galeria', 'faq', 'contenido', 'convenios', 'ajustes']) assert.equal(nav.canOpen(key), false, key)
  }
  assert.equal(panelNavigation(session('SECRETARIA', 'heredado', ['items:leer'])).canOpen('contenido'), false)
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

test('Roles y usuarios: solo en por_roles con cuentas:leer; nunca en heredado, sin rol ni para coordinadora o secretaria', () => {
  const rule = PANEL_SECTIONS.find(item => item.key === 'cuentas')
  assert.equal(rule.available, undefined, 'habilitada')
  assert.equal(rule.requiresRolesMode, true)
  assert.deepEqual(rule.anyOf, ['cuentas:leer'])
  assert.equal(panelNavigation(session('GERENTE_GENERAL', 'por_roles')).canOpen('cuentas'), true)
  // Sin AccessGuard (modo heredado) cualquier sesión podría cambiar roles: la sección no se ofrece ni al gerente.
  assert.equal(panelNavigation(session('GERENTE_GENERAL', 'heredado')).canOpen('cuentas'), false)
  for (const access of [legacyBackend(), session(null, 'heredado'), session(null, 'por_roles'), session('COORDINADORA_INSTITUCIONAL', 'por_roles'), session('SECRETARIA', 'por_roles'), null]) {
    assert.equal(panelNavigation(access).canOpen('cuentas'), false, JSON.stringify(access))
  }
  // Leer cuentas no implica poder cambiar roles: cada operación tiene su permiso.
  const readOnly = panelNavigation(session('COORDINADORA_INSTITUCIONAL', 'por_roles', ['cuentas:leer']))
  assert.equal(readOnly.canOpen('cuentas'), true)
  assert.equal(readOnly.can(PANEL_ACTIONS.asignarRol), false)
  assert.equal(readOnly.can(PANEL_ACTIONS.editarCuenta), false)
  assert.equal(panelNavigation(session('GERENTE_GENERAL', 'por_roles')).can(PANEL_ACTIONS.asignarRol), true)
})

test('secciones desconocidas o con forma rara no se abren; el nombre del rol no concede nada', () => {
  const nav = panelNavigation(session('GERENTE_GENERAL'))
  for (const key of ['', 'admin', 'usuarios', 'certificados', '__proto__', 'constructor', 'toString', undefined, null, 5, {}]) assert.equal(nav.canOpen(key), false, String(key))
  for (const resource of ['', 'items', 'mensajes', '__proto__', 'toString']) assert.equal(nav.canOpenResource(resource), false, resource)
  // Con el rol de gerente pero sin permisos, no se abre nada: lo que decide es la lista del backend.
  assert.deepEqual(visible(panelNavigation(session('GERENTE_GENERAL', 'por_roles', []))), ['configuracion'])
})

test('Estudiantes, Ediciones y Matrículas disponibles; las fases posteriores siguen sin enlaces', () => {
  assert.equal(PANEL_SECTIONS.find(rule => rule.key === 'estudiantes')?.anyOf[0], 'estudiantes:leer')
  assert.equal(PANEL_SECTIONS.find(rule => rule.key === 'ediciones')?.anyOf[0], 'convocatorias:leer')
  assert.equal(PANEL_SECTIONS.find(rule => rule.key === 'matriculas')?.anyOf[0], 'matriculas:leer')
  for (const rule of PANEL_SECTIONS) assert.ok(!/certificados|asistencia|calificaciones|sesiones/.test(rule.key + rule.anyOf.join() + rule.target), rule.key)
})

// ---------- E3.4.3, fase 2: operaciones de escritura ----------
const inventory = backend('route-inventory.ts')
const escape = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
// Permiso que exige una ruta con un único permiso (perm) o, en las que dependen del cuerpo (byField), el permiso base y los adicionales.
const routePermission = (method, route) => inventory.match(new RegExp("perm\\('" + method + "', '" + escape(route) + "', '([a-z_:]+)'"))?.[1]
const routeByField = (method, route) => {
  const match = inventory.match(new RegExp("byField\\('" + method + "', '" + escape(route) + "', '([a-z_]+)', '([a-z_:]+)', \\{([^}]*)\\}"))
  return match && { field: match[1], base: match[2], when: Object.fromEntries([...match[3].matchAll(/([a-z_]+): '([a-z_:]+)'/g)].map(m => [m[1], m[2]])) }
}

test('cada permiso de escritura del panel existe en el catálogo', () => {
  for (const [endpoint, ops] of Object.entries(RESOURCE_WRITE)) for (const permission of Object.values(ops)) assert.ok(ALL.includes(permission), endpoint + ': ' + permission)
  for (const [action, permission] of Object.entries(PANEL_ACTIONS)) assert.ok(ALL.includes(permission), action + ': ' + permission)
})

test('las operaciones de cada recurso del catálogo son las que exigen POST, PUT (y archivar) y DELETE en route-inventory.ts', () => {
  assert.deepEqual(Object.keys(RESOURCE_WRITE).sort(), ['cursos', 'galeria', 'items', 'preguntas-frecuentes', 'servicios'])
  for (const [endpoint, ops] of Object.entries(RESOURCE_WRITE)) {
    const base = 'admin/' + endpoint
    assert.equal(routePermission('POST', base), ops.crear, endpoint + ' POST')
    assert.equal(routePermission('DELETE', base + '/:id'), ops.eliminar, endpoint + ' DELETE')
    const byField = routeByField('PUT', base + '/:id')
    if (ops.archivar) {
      assert.ok(byField, endpoint + ': guardar «archivado» debe exigir un permiso adicional')
      assert.equal(byField.field, 'estado')
      assert.equal(byField.base, ops.editar, endpoint + ' PUT')
      assert.deepEqual(byField.when, { archivado: ops.archivar }, endpoint + ' PUT archivado')
    } else {
      assert.equal(byField, null, endpoint + ': sin permiso de archivar, el PUT no debe depender del estado')
      assert.equal(routePermission('PUT', base + '/:id'), ops.editar, endpoint + ' PUT')
    }
  }
})

test('las demás operaciones del panel coinciden con sus rutas', () => {
  const A = PANEL_ACTIONS
  assert.equal(routePermission('POST', 'admin/uploads'), A.subirImagen)
  assert.equal(routePermission('GET', 'admin/contenido-original'), A.leerContenidoOriginal)
  assert.equal(routePermission('POST', 'admin/contenido-original/:section'), A.restaurarContenidoOriginal)
  assert.equal(routePermission('POST', 'admin/convenios'), A.crearConvenio)
  for (const route of ['admin/convenios/:id', 'admin/convenios/:id/fotos/orden', 'admin/convenios/:id/fotos/:fotoId']) assert.equal(routePermission('PUT', route), A.editarConvenio, route)
  assert.equal(routePermission('POST', 'admin/convenios/:id/fotos'), A.editarConvenio)
  assert.equal(routePermission('DELETE', 'admin/convenios/:id/fotos/:fotoId'), A.editarConvenio)
  assert.equal(routePermission('DELETE', 'admin/convenios/:id'), A.eliminarConvenio)
  assert.equal(routePermission('POST', 'admin/cotizaciones'), A.crearCotizacion)
  assert.equal(routePermission('PUT', 'admin/cotizaciones/:id'), A.editarCotizacion)
  assert.equal(routePermission('POST', 'admin/cotizaciones/:id/correo'), A.enviarCotizacion)
  assert.deepEqual(routeByField('POST', 'admin/cotizaciones/:id/estado'), { field: 'estado', base: A.editarCotizacion, when: { anulada: A.anularCotizacion, enviada: A.enviarCotizacion } })
  assert.equal(routePermission('POST', 'admin/messages'), A.crearMensaje)
  assert.equal(routePermission('DELETE', 'admin/messages/:id'), A.eliminarMensaje)
  assert.equal(routePermission('PUT', 'admin/settings'), A.editarConfiguracion)
  assert.equal(routePermission('PUT', 'admin/users/:id/rol'), A.asignarRol)
  assert.equal(routePermission('PUT', 'admin/users/:id'), A.editarCuenta)
  assert.equal(routePermission('POST', 'admin/estudiantes'), A.crearEstudiante)
  assert.equal(routePermission('PUT', 'admin/estudiantes/:id'), A.editarEstudiante)
  assert.equal(routePermission('PUT', 'admin/estudiantes/:id/archivo'), A.archivarEstudiante)
  assert.equal(routePermission('POST', 'admin/matriculas'), A.crearMatricula)
  assert.equal(routePermission('PUT', 'admin/matriculas/:id/anulacion'), A.anularMatricula)
  assert.equal(routePermission('PUT', 'admin/matriculas/:id/reactivacion'), A.reactivarMatricula)
  assert.equal(routePermission('POST', 'admin/convocatorias'), A.crearEdicion)
  assert.equal(routePermission('PUT', 'admin/convocatorias/:id'), A.editarEdicion)
  assert.equal(routePermission('PUT', 'admin/convocatorias/:id/apertura'), A.editarEdicion)
  assert.equal(routePermission('GET', 'admin/reportes/:tipo/exportar'), A.exportarReporte)
  assert.equal(routePermission('PUT', 'admin/convocatorias/:id/preinscripcion'), A.recepcionEdicion)
  for (const route of ['admin/preinscripciones/:id/validacion', 'admin/preinscripciones/:id/descarte', 'admin/preinscripciones/:id/desistimiento']) assert.equal(routePermission('PUT', route), A.editarPreinscripcion, route)
  assert.equal(routePermission('PATCH', 'admin/preinscripciones/:id'), A.editarPreinscripcion)
  assert.equal(routePermission('POST', 'admin/preinscripciones/:id/conversion'), A.convertirPreinscripcion)
  assert.equal(routePermission('PUT', 'admin/convocatorias/:id/horarios'), A.editarHorarios)
  assert.equal(routePermission('GET', 'admin/convocatorias/:id/horarios'), 'convocatorias:leer')
  assert.equal(routePermission('PUT', 'admin/convocatorias/:id/cierre'), A.cerrarEdicion)
  assert.equal(routePermission('PUT', 'admin/convocatorias/:id/archivo'), A.archivarEdicion)
  // Seguimiento: la ruta es común y el permiso depende de :recurso; la bandeja solo usa «messages».
  for (const [method, route, operation] of [['GET', 'admin/seguimiento/:recurso/:id', 'leer'], ['PUT', 'admin/seguimiento/:recurso/:id', 'editar'], ['POST', 'admin/seguimiento/:recurso/:id/constancia', 'enviar'], ['POST', 'admin/seguimiento/:recurso/:id/correo', 'enviar']]) {
    assert.ok(inventory.includes("follow('" + method + "', '" + route + "', '" + operation + "')"), route)
  }
  assert.ok(catalog.includes("if (recurso === 'messages') return `seguimiento_mensajes:${operation}`;"))
  assert.deepEqual([A.leerSeguimiento, A.editarSeguimiento, A.enviarSeguimiento], ['seguimiento_mensajes:leer', 'seguimiento_mensajes:editar', 'seguimiento_mensajes:enviar'])
})

// Regresión: el commit que añadió `enviada: cotizaciones:enviar` al inventario y al guard real dejó atrás el panel, que seguía ofreciendo
// «Marcar enviada» a una cuenta con editar pero sin enviar (403 seguro al pulsarlo). El botón sale de canMoveQuote, así que se prueba
// esa función, no el texto del componente, y su tabla de permisos se compara con el `when` del backend en vez de copiarlo.
test('cambiar el estado de una cotización: el panel nunca ofrece una transición que el backend rechazaría', () => {
  const A = PANEL_ACTIONS
  const accion = { enviar: A.enviarCotizacion, anular: A.anularCotizacion }
  const esperado = Object.fromEntries(Object.entries(quoteTransitionPermission).map(([estado, op]) => [estado, accion[op]]))
  assert.deepEqual(routeByField('POST', 'admin/cotizaciones/:id/estado').when, esperado, 'la tabla del panel debe coincidir con el `when` del inventario')

  const perms = (edit, send, voidQuote) => ({ edit, send, void: voidQuote })
  // Sin editar no se mueve nada, por muchos otros permisos que tenga la cuenta.
  for (const estado of Object.values(quoteTransitions).flat()) assert.equal(canMoveQuote(estado, perms(false, true, true)), false, 'sin editar: ' + estado)
  // El caso del fallo: editar SIN enviar y SIN anular. Solo quedan las transiciones que no exigen permiso adicional.
  const soloEdita = perms(true, false, false)
  assert.equal(canMoveQuote('enviada', soloEdita), false, 'editar sin enviar no habilita «enviada»')
  assert.equal(canMoveQuote('anulada', soloEdita), false, 'editar sin anular no habilita «anulada»')
  for (const estado of ['aceptada', 'rechazada']) assert.equal(canMoveQuote(estado, soloEdita), true, estado + ' solo exige editar')
  // Cada permiso adicional habilita el suyo y únicamente el suyo.
  assert.deepEqual([canMoveQuote('enviada', perms(true, true, false)), canMoveQuote('anulada', perms(true, true, false))], [true, false])
  assert.deepEqual([canMoveQuote('enviada', perms(true, false, true)), canMoveQuote('anulada', perms(true, false, true))], [false, true])
  // Ninguna transición declarada queda sin clasificar: o no exige nada más, o exige un permiso que el catálogo del panel conoce.
  for (const estado of new Set(Object.values(quoteTransitions).flat())) {
    const extra = quoteTransitionPermission[estado]
    assert.ok(extra === undefined || Object.keys(accion).includes(extra), estado + ': permiso adicional desconocido')
  }
})

const allWrites = [...Object.values(RESOURCE_WRITE).flatMap(ops => Object.values(ops)), ...Object.values(PANEL_ACTIONS)]

test('can(): navegación heredada lo ofrece todo; sin rol en por_roles o sin sesión, nada', () => {
  for (const access of [legacyBackend(), session(null, 'heredado')]) {
    const nav = panelNavigation(access)
    for (const permission of allWrites) assert.equal(nav.can(permission), true, permission)
  }
  for (const access of [session(null, 'por_roles'), null, undefined, parseSession({ user: 'x' }).access]) {
    const nav = panelNavigation(access)
    for (const permission of allWrites) assert.equal(nav.can(permission), false, permission)
  }
  // Con rol decide solo la lista del backend; el nombre del rol no concede nada.
  const nav = panelNavigation(session('GERENTE_GENERAL', 'por_roles', ['cursos:leer']))
  for (const permission of allWrites) assert.equal(nav.can(permission), false, permission)
  for (const value of ['', undefined, null, 5, {}, 'cursos:leer ']) assert.equal(panelNavigation(session('GERENTE_GENERAL')).can(value), false, String(value))
})

test('gerente: todas las operaciones de escritura', () => {
  for (const modo of ['heredado', 'por_roles']) {
    const nav = panelNavigation(session('GERENTE_GENERAL', modo))
    for (const permission of allWrites) assert.equal(nav.can(permission), true, permission)
  }
})

test('secretaria: conserva permisos históricos de lectura; registra y atiende consultas sin eliminarlas', () => {
  for (const modo of ['heredado', 'por_roles']) {
    const nav = panelNavigation(session('SECRETARIA', modo))
    for (const permission of Object.values(RESOURCE_WRITE.cursos)) assert.equal(nav.can(permission), false, permission)
    assert.equal(nav.can(PANEL_ACTIONS.editarConfiguracion), false)
    assert.equal(nav.can(PANEL_ACTIONS.subirImagen), false)
    assert.equal(nav.can(PANEL_ACTIONS.restaurarContenidoOriginal), false)
    assert.equal(nav.can(PANEL_ACTIONS.crearMensaje), true)
    assert.equal(nav.can(PANEL_ACTIONS.eliminarMensaje), false)
    for (const permission of [PANEL_ACTIONS.leerSeguimiento, PANEL_ACTIONS.editarSeguimiento, PANEL_ACTIONS.enviarSeguimiento]) assert.equal(nav.can(permission), true, permission)
    // «Preparar cotización» exige abrir Cotizaciones y crear: ninguno de los dos.
    assert.equal(nav.canOpen('cotizaciones') || nav.can(PANEL_ACTIONS.crearCotizacion), false)
  }
})

test('coordinadora: permisos históricos conservados; sin eliminar consultas, editar configuración ni recuperar contenido original', () => {
  const nav = panelNavigation(session('COORDINADORA_INSTITUCIONAL'))
  const yes = ['cursos:crear', 'cursos:editar', 'cursos:archivar', 'servicios:crear', 'servicios:editar', ...Object.values(RESOURCE_WRITE['preguntas-frecuentes']), ...Object.values(RESOURCE_WRITE.galeria),
    PANEL_ACTIONS.crearConvenio, PANEL_ACTIONS.editarConvenio, PANEL_ACTIONS.eliminarConvenio, PANEL_ACTIONS.subirImagen,
    PANEL_ACTIONS.crearCotizacion, PANEL_ACTIONS.editarCotizacion, PANEL_ACTIONS.enviarCotizacion, PANEL_ACTIONS.anularCotizacion,
    PANEL_ACTIONS.crearMensaje, PANEL_ACTIONS.leerSeguimiento, PANEL_ACTIONS.editarSeguimiento, PANEL_ACTIONS.enviarSeguimiento]
  const no = ['cursos:eliminar', 'servicios:eliminar', ...Object.values(RESOURCE_WRITE.items), PANEL_ACTIONS.eliminarMensaje, PANEL_ACTIONS.editarConfiguracion,
    PANEL_ACTIONS.leerContenidoOriginal, PANEL_ACTIONS.restaurarContenidoOriginal]
  for (const permission of yes) assert.equal(nav.can(permission), true, permission)
  for (const permission of no) assert.equal(nav.can(permission), false, permission)
})

test('editar sin archivar: el panel distingue ambos permisos (guardar «archivado» exige archivar)', () => {
  const nav = panelNavigation(session('COORDINADORA_INSTITUCIONAL', 'por_roles', ['cursos:leer', 'cursos:editar']))
  assert.equal(nav.can(RESOURCE_WRITE.cursos.editar), true)
  assert.equal(nav.can(RESOURCE_WRITE.cursos.archivar), false)
  assert.equal(RESOURCE_WRITE.servicios.archivar, undefined, 'en servicios archivar es una edición')
})
