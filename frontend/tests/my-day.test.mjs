import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AREA_INFO, AREA_READ, MY_DAY_AREAS, formatLimaTime, formatOperatingDate, parseMyDay, pendingLink, queueSummary, visibleMyDay } from '../src/panel/services/myDay.ts'
import { MY_DAY_READ, PANEL_SECTIONS, panelNavigation } from '../src/panel/context/panelAccess.ts'
import { parseSession } from '../src/panel/context/sessionAccess.ts'

// «Mi Día» (Fase 4C-B): lectura de GET /admin/asistente/resumen. Sin red ni React; todos los datos son ficticios.
const here = path.dirname(fileURLToPath(import.meta.url))
const backendFile = (...parts) => fs.readFileSync(path.join(here, '..', '..', 'backend', 'src', ...parts), 'utf8')
const rules = backendFile('asistente', 'asistente.rules.ts')
const policy = backendFile('permissions', 'policy.ts')
const roleList = name => [...policy.match(new RegExp('const ' + name + ': readonly Permission\\[\\] = \\[([\\s\\S]*?)\\];'))[1].matchAll(/'([a-z_]+:[a-z_]+)'/g)].map(m => m[1])
const ALL = [...backendFile('permissions', 'permissions.ts').match(/RESOURCE_OPERATIONS = \{([\s\S]*?)\} as const/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .flatMap(([, resource, ops]) => [...ops.matchAll(/'([a-z_]+)'/g)].map(op => resource + ':' + op[1]))
const PERMISOS = { GERENTE_GENERAL: ALL, COORDINADORA_INSTITUCIONAL: roleList('COORDINADORA_INSTITUCIONAL'), SECRETARIA: roleList('SECRETARIA') }
const backendSections = Object.fromEntries([...rules.match(/SECTION_PERMISSIONS[^=]*= Object\.freeze\(\{([\s\S]*?)\}\);/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .map(([, key, perms]) => [key, [...perms.matchAll(/'([a-z_:]+)'/g)].map(m => m[1])]))
// Lo que el servidor consulta para cada rol: authorizedSections = áreas cuyos permisos tiene TODOS.
const serverAreas = role => Object.keys(backendSections).filter(key => backendSections[key].every(p => PERMISOS[role].includes(p)))
const can = role => permission => PERMISOS[role].includes(permission)

const ok = { estado: 'ok', consultado_en: '2026-10-25T14:00:00.000Z' }
function response(role, pendientes = [], over = {}) {
  const areas = serverAreas(role)
  return {
    ok: true, generado_en: '2026-10-25T14:12:00.000Z', zona_horaria: 'America/Lima', fecha_operativa: '2026-10-25',
    ventana_hoy: { desde_utc: '2026-10-25T05:00:00.000Z', hasta_utc: '2026-10-26T05:00:00.000Z' },
    acceso: { rol: role, permisos_efectivos: PERMISOS[role].length, secciones_autorizadas: areas },
    resumen: { texto: 'Texto básico', pendientes_total: pendientes.length, pendientes_truncados: false, vacio: pendientes.length === 0 },
    pendientes,
    indicadores_atencion: { consultas_registradas: { hoy: 5, total: 40, pendientes: 11, nuevas: 4, en_proceso: 7, mas_de_48_horas_sin_cerrar: 2 }, personas_unicas: { hoy: 4, con_pendientes: 9 }, chatbot: { mensajes_hoy: 31, sin_resolver_hoy: 3, personas: null } },
    secciones: Object.fromEntries(areas.map(area => [area, ok])),
    fuentes: [], explicacion: { estado: 'no_solicitada' }, no_registrado: [], alcance: 'solo_lectura', ...over,
  }
}
const pend = (id, area, severidad, permiso, puedeActuar = true, cantidad = 2) => ({ id, area, severidad, titulo: 'Título ficticio ' + id, cantidad, detalle: 'Detalle ficticio.', permiso, puedeActuar })

test('áreas y permisos de lectura coinciden con SECTION_PERMISSIONS del asistente', () => {
  assert.deepEqual([...MY_DAY_AREAS].sort(), Object.keys(backendSections).sort())
  for (const area of MY_DAY_AREAS) assert.deepEqual([...AREA_READ[area]], backendSections[area], area)
  assert.deepEqual([...MY_DAY_READ].sort(), [...new Set(Object.values(backendSections).flat())].sort(), 'la regla del menú usa la unión de esas lecturas')
  assert.deepEqual(PANEL_SECTIONS.find(rule => rule.key === 'mi-dia').anyOf, MY_DAY_READ)
  for (const area of MY_DAY_AREAS) assert.ok(PANEL_SECTIONS.some(rule => rule.key === AREA_INFO[area].section), 'destino existente: ' + area)
  // Los ids con enlace propio existen en las reglas del backend.
  for (const id of ['mensajes_nuevos', 'mensajes_en_proceso']) assert.ok(rules.includes("item('" + id + "'"), id)
})

test('descripciones de las áreas: coinciden con las consultas del asistente y distinguen apertura de inicio', () => {
  const hours = backendFile('attention', 'attention-rules.ts').match(/HORAS_CONSULTA_ANTIGUA = (\d+)/)[1]
  assert.ok(AREA_INFO.atencion.description.includes(hours + ' horas'), 'plazo de consultas antiguas')
  const data = backendFile('asistente', 'asistente.data.ts')
  assert.match(data, /estado: 'planificada', archivado_at: null, minimo_apertura: \{ not: null \}/, 'aperturas: planificadas con mínimo')
  assert.match(data, /estado: 'planificada', archivado_at: null, fecha_inicio: \{ lte: window\.fechaDb \}/, 'ediciones: planificadas con inicio llegado')
  assert.match(data, /estado: 'activa', cumplimiento: 'pendiente', convocatoria: \{ estado: 'cerrada'/, 'matrículas: activas de ediciones cerradas')
  assert.notEqual(AREA_INFO.aperturas.title, AREA_INFO.ediciones.title)
  assert.equal(AREA_INFO.aperturas.section, AREA_INFO.ediciones.section, 'ambas se resuelven en Ediciones')
  for (const area of MY_DAY_AREAS) assert.ok(AREA_INFO[area].description.length > 40 && AREA_INFO[area].description.length <= 130, area)
})

test('respuesta válida de cada rol: solo sus áreas, sin datos personales', () => {
  for (const role of Object.keys(PERMISOS)) {
    const summary = parseMyDay(response(role, [pend('mensajes_nuevos', 'atencion', 'media', 'seguimiento_mensajes:editar')]))
    assert.ok(summary, role)
    assert.deepEqual(summary.areas, serverAreas(role))
    const view = visibleMyDay(summary, can(role))
    assert.deepEqual(view.areas, serverAreas(role), role)
    assert.equal(view.atencion.hoy, 5)
    const serialized = JSON.stringify(summary)
    assert.ok(!serialized.includes('personas') && !serialized.includes('con_pendientes'), 'no se copian personas únicas')
  }
  assert.ok(!serverAreas('SECRETARIA').includes('cotizaciones'))
  assert.equal(serverAreas('GERENTE_GENERAL').length, 7)
  assert.equal(serverAreas('COORDINADORA_INSTITUCIONAL').length, 7)
})

test('puedeActuar del servidor y permiso de la sesión deciden si un pendiente es accionable', () => {
  const pendientes = [pend('ediciones_listas_para_abrir', 'aperturas', 'alta', 'convocatorias:editar', false), pend('preinscripciones_por_revisar', 'preinscripciones', 'media', 'preinscripciones:editar', true)]
  const view = visibleMyDay(parseMyDay(response('SECRETARIA', pendientes)), can('SECRETARIA'))
  assert.deepEqual(view.pendientes.map(p => [p.id, p.accionable]), [['ediciones_listas_para_abrir', false], ['preinscripciones_por_revisar', true]])
  // Aunque el servidor diga que puede, sin el permiso en la sesión no se presenta como accionable.
  const revoked = visibleMyDay(parseMyDay(response('SECRETARIA', [pendientes[1]])), p => p !== 'preinscripciones:editar' && can('SECRETARIA')(p))
  assert.equal(revoked.pendientes[0].accionable, false)
})

test('revocación: un área cuyos permisos la sesión ya no tiene desaparece con sus pendientes', () => {
  const summary = parseMyDay(response('COORDINADORA_INSTITUCIONAL', [pend('cotizaciones_vencidas', 'cotizaciones', 'alta', 'cotizaciones:editar'), pend('mensajes_nuevos', 'atencion', 'media', 'seguimiento_mensajes:editar')]))
  const view = visibleMyDay(summary, p => p !== 'cotizaciones:leer' && can('COORDINADORA_INSTITUCIONAL')(p))
  assert.ok(!view.areas.includes('cotizaciones'))
  assert.deepEqual(view.pendientes.map(p => p.id), ['mensajes_nuevos'])
  const noMessages = visibleMyDay(summary, p => p !== 'mensajes:leer' && can('COORDINADORA_INSTITUCIONAL')(p))
  assert.equal(noMessages.atencion, null, 'sin mensajes:leer tampoco se muestran sus indicadores')
})

test('respuestas malformadas o incoherentes se rechazan enteras', () => {
  const base = () => response('SECRETARIA', [pend('mensajes_nuevos', 'atencion', 'media', 'seguimiento_mensajes:editar')])
  const cases = {
    nulo: null, texto: 'ok', sinOk: { ...base(), ok: false },
    fecha: { ...base(), fecha_operativa: '2026-02-30' }, generado: { ...base(), generado_en: 'ayer' },
    sinAcceso: { ...base(), acceso: {} }, duplicadas: { ...base(), acceso: { secciones_autorizadas: ['atencion', 'atencion'] } },
    sinEstado: { ...base(), secciones: {} }, estadoRaro: { ...base(), secciones: { ...base().secciones, atencion: { estado: 'quizas' } } },
    pendientesNoLista: { ...base(), pendientes: {} },
    cantidadNegativa: { ...base(), pendientes: [{ ...base().pendientes[0], cantidad: -1 }] },
    cantidadTexto: { ...base(), pendientes: [{ ...base().pendientes[0], cantidad: '3' }] },
    severidad: { ...base(), pendientes: [{ ...base().pendientes[0], severidad: 'critica' }] },
    puedeActuar: { ...base(), pendientes: [{ ...base().pendientes[0], puedeActuar: 'si' }] },
    areaNoAutorizada: { ...base(), pendientes: [pend('cotizaciones_vencidas', 'cotizaciones', 'alta', 'cotizaciones:editar')] },
    pendienteDeAreaConError: { ...base(), secciones: { ...base().secciones, atencion: { estado: 'error', motivo: 'No se pudo consultar.' } } },
    truncados: { ...base(), resumen: {} },
  }
  for (const [name, value] of Object.entries(cases)) assert.equal(parseMyDay(value), null, name)
})

test('fallo de una sola área: se informa con su motivo y el resto se conserva', () => {
  const value = response('GERENTE_GENERAL', [pend('mensajes_nuevos', 'atencion', 'media', 'seguimiento_mensajes:editar')])
  value.secciones.preinscripciones = { estado: 'error', motivo: 'No se pudo consultar esta área. Intenta de nuevo más tarde.' }
  value.secciones.aperturas = { estado: 'no_disponible', motivo: 'Este módulo todavía no está disponible en la base de datos de este entorno.' }
  const summary = parseMyDay(value)
  assert.equal(summary.estados.preinscripciones.estado, 'error')
  assert.equal(summary.estados.aperturas.estado, 'no_disponible')
  assert.equal(summary.estados.atencion.estado, 'ok')
  assert.equal(summary.pendientes.length, 1)
})

test('áreas desconocidas (backend más nuevo) se ignoran con sus pendientes; vacío; indicadores inválidos', () => {
  const value = response('SECRETARIA', [pend('futuro', 'area_futura', 'alta', 'otra:leer')])
  value.acceso.secciones_autorizadas = [...value.acceso.secciones_autorizadas, 'area_futura']
  value.secciones.area_futura = { estado: 'ok' }
  const summary = parseMyDay(value)
  assert.deepEqual(summary.pendientes, [])
  assert.ok(!summary.areas.includes('area_futura'))
  assert.equal(queueSummary(visibleMyDay(summary, can('SECRETARIA'))), 'Nada por revisar en tus áreas.')
  const broken = parseMyDay(response('SECRETARIA', [], { indicadores_atencion: { consultas_registradas: { hoy: -1, pendientes: 2 }, chatbot: { mensajes_hoy: 'x' } } }))
  assert.equal(broken.atencion, null)
  assert.equal(broken.chatbot, null)
  assert.equal(parseMyDay(response('SECRETARIA', [], { indicadores_atencion: null })).atencion, null)
})

test('enlaces: solo filtros que el destino interpreta hoy; el resto va a la sección general', () => {
  assert.equal(pendingLink({ id: 'mensajes_nuevos', area: 'atencion' }), '/admin/messages?estado=nuevo')
  assert.equal(pendingLink({ id: 'mensajes_en_proceso', area: 'atencion' }), '/admin/messages?estado=en_proceso')
  assert.equal(pendingLink({ id: 'mensajes_antiguos', area: 'atencion' }), '/admin/messages', 'antiguas=si no lo lee la bandeja')
  assert.equal(pendingLink({ id: 'cotizaciones_vencidas', area: 'cotizaciones' }), '/admin/dashboard?section=cotizaciones', 'vencida=si no lo lee Cotizaciones')
  assert.equal(pendingLink({ id: 'ediciones_listas_para_abrir', area: 'aperturas' }), '/admin/dashboard?section=ediciones')
  for (const area of MY_DAY_AREAS) assert.ok(!/antiguas|vencida/.test(AREA_INFO[area].href), area)
})

test('resumen de la cola, fechas en Lima y hora de consulta', () => {
  const view = { pendientes: [{ severidad: 'alta' }, { severidad: 'media' }, { severidad: 'info' }] }
  assert.equal(queueSummary(view), '3 puntos para revisar, 1 de prioridad alta.')
  assert.equal(queueSummary({ pendientes: [{ severidad: 'info' }] }), '1 punto para revisar.')
  assert.match(formatOperatingDate('2026-10-25'), /^Domingo,? 25 de octubre de 2026$/)
  assert.match(formatOperatingDate('2026-01-01'), /^Jueves,? 1 de enero de 2026$/, 'sin desplazar el día por zona horaria')
  // 03:30 UTC del 26 = 22:30 del 25 en Lima.
  assert.match(formatLimaTime('2026-10-26T03:30:00.000Z'), /^22:30|10:30/)
})

test('la navegación de Mi Día y la vista usan la misma lista de permisos de la sesión', () => {
  for (const role of Object.keys(PERMISOS)) {
    const access = parseSession({ ok: true, user: { id: 1, nombre: 'Persona Ficticia', email: 'p@example.test', rol: role, permisos: PERMISOS[role] }, acceso: { modo: 'por_roles' } }).access
    const nav = panelNavigation(access)
    const view = visibleMyDay(parseMyDay(response(role)), nav.can)
    assert.deepEqual(view.areas, serverAreas(role), role)
    for (const area of view.areas) assert.equal(nav.canOpen(AREA_INFO[area].section), true, role + ' abre el destino de ' + area)
  }
})
