import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ADMIN_ROLES, isAdminRole } from '../src/permissions/roles';
import { ALL_PERMISSIONS, FUTURE_RESOURCES, RESOURCE_OPERATIONS, isPermission, seguimientoPermission } from '../src/permissions/permissions';
import { can, canAll, canAny, permissionsOf } from '../src/permissions/policy';
import { ROUTE_INVENTORY, RouteAccess } from '../src/permissions/route-inventory';
import { isRouteAccess } from '../src/permissions/access';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { AccountsController } from '../src/admin/auth/accounts.controller';
import { AuthController } from '../src/admin/auth/auth.controller';
import { AdminChatbotController } from '../src/admin/chatbot/admin-chatbot.controller';
import { ItemsController } from '../src/admin/items/items.controller';
import { MessagesController } from '../src/admin/messages/messages.controller';
import { AdminReclamacionesController } from '../src/admin/reclamaciones/admin-reclamaciones.controller';
import { StatsController } from '../src/admin/stats/stats.controller';
import { AttentionController } from '../src/attention/attention.module';
import { AdminCursoController, AdminPreguntaFrecuenteController, AdminServicioController, CursoController, PreguntaFrecuenteController, ServicioController } from '../src/catalogo/catalogo.controllers';
import { ChatbotController } from '../src/chatbot/chatbot.controller';
import { ContactoController } from '../src/contacto/contacto.controller';
import { OriginalContentController } from '../src/content-original/content-original.module';
import { AdminConveniosController, ConveniosController } from '../src/convenios/convenios.controllers';
import { CotizacionesController } from '../src/cotizaciones/cotizaciones.module';
import { AdminGaleriaController } from '../src/galeria/admin-galeria.controller';
import { GaleriaController } from '../src/galeria/galeria.controller';
import { HealthController } from '../src/health.controller';
import { ConvocatoriasController } from '../src/convocatorias/convocatorias.controller';
import { EstudiantesController } from '../src/estudiantes/estudiantes.controller';
import { MatriculasController } from '../src/matriculas/matriculas.controller';
import { AsignacionesDocentesController, DocentesController } from '../src/docentes/docentes.controller';
import { EdicionSesionesController, SesionesController } from '../src/sesiones/sesiones.controller';
import { CertificadosController, CertificadosPublicController } from '../src/certificados/certificados.controller';
import { ReportesController } from '../src/reportes/reportes.controller';
import { AsistenteController } from '../src/asistente/asistente.controller';
import { ChatbotPreinscripcionController, PreinscripcionesController, PreinscripcionesPublicController } from '../src/preinscripciones/preinscripciones.controller';
import { ImportacionesController } from '../src/importaciones/importaciones.controller';
import { AdminNewsletterController } from '../src/newsletter/admin-newsletter.controller';
import { NewsletterController } from '../src/newsletter/newsletter.controller';
import { ReclamacionesController } from '../src/reclamaciones/reclamaciones.controller';
import { AdminSettingsController } from '../src/settings/admin-settings.controller';
import { SettingsController } from '../src/settings/settings.controller';
import { AdminUploadsController, PublicUploadsController } from '../src/uploads/uploads.module';

const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';

// ---------------------------------------------------------------------------------------------------------------
// Estructura del catálogo
// ---------------------------------------------------------------------------------------------------------------
test('los tres roles aprobados, y solo esos', () => {
  assert.deepEqual([...ADMIN_ROLES], [G, C, S]);
  for (const role of ADMIN_ROLES) assert.ok(isAdminRole(role));
  for (const value of ['ADMINISTRADOR', 'gerente_general', '', 'SECRETARIA ', null, undefined, 1, {}, ['SECRETARIA']]) assert.equal(isAdminRole(value), false);
});

test('cada permiso tiene un identificador único con el formato recurso:operacion', () => {
  const unique = new Set(ALL_PERMISSIONS);
  assert.equal(unique.size, ALL_PERMISSIONS.length, 'identificadores repetidos');
  for (const id of ALL_PERMISSIONS) assert.match(id, /^[a-z_]+:[a-z_]+$/);
  const expected = Object.entries(RESOURCE_OPERATIONS).reduce((total, [, operations]) => total + operations.length, 0);
  assert.equal(ALL_PERMISSIONS.length, expected);
  for (const [resource, operations] of Object.entries(RESOURCE_OPERATIONS)) {
    assert.equal(new Set(operations).size, operations.length, 'operaciones repetidas en ' + resource);
    for (const operation of operations) assert.ok(isPermission(resource + ':' + operation));
  }
});

test('los permisos de recursos futuros están separados de los actuales', () => {
  for (const resource of FUTURE_RESOURCES) assert.ok(resource in RESOURCE_OPERATIONS);
  assert.deepEqual([...FUTURE_RESOURCES].sort(), ['asistencia', 'auditoria', 'calificaciones'], 'sesiones y certificados dejaron de ser futuros: ya tienen rutas');
  // Reportes académicos ya tienen rutas (src/reportes): consultar con reportes_academicos:leer y exportar con reportes_academicos:exportar.
  assert.ok(!(FUTURE_RESOURCES as readonly string[]).includes('reportes_academicos'));
});

test('no existe ningún permiso de eliminación física del historial académico', () => {
  const forbidden = ['estudiantes', 'matriculas', 'docentes', 'calificaciones', 'certificados', 'asistencia', 'sesiones', 'convocatorias', 'auditoria'];
  for (const id of ALL_PERMISSIONS) {
    const [resource, operation] = id.split(':');
    if (forbidden.includes(resource)) assert.notEqual(operation, 'eliminar', id);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Denegación por defecto
// ---------------------------------------------------------------------------------------------------------------
test('un permiso desconocido o mal formado se deniega, también al gerente', () => {
  for (const role of ADMIN_ROLES) {
    for (const permission of ['cuentas:borrar_todo', 'inexistente:leer', 'cuentas', '', 'cuentas:leer ', 'CUENTAS:LEER', '__proto__', 'constructor', 'toString', null, undefined, 7, {}, ['cuentas:leer']]) {
      assert.equal(can(role, permission), false, role + ' / ' + String(permission));
    }
  }
});

test('un rol desconocido, vacío o de otro tipo no obtiene ningún permiso', () => {
  for (const role of ['ADMINISTRADOR', 'gerente_general', '', ' GERENTE_GENERAL', null, undefined, 0, {}, ['GERENTE_GENERAL'], '__proto__', 'constructor']) {
    assert.equal(can(role, 'cursos:leer'), false, String(role));
    assert.equal(can(role, 'cuentas:crear'), false, String(role));
    assert.deepEqual(permissionsOf(role), []);
  }
});

test('canAll y canAny: vacío o no lista se deniega; todos o alguno', () => {
  assert.equal(canAll(S, []), false);
  assert.equal(canAny(S, []), false);
  assert.equal(canAll(S, 'cursos:leer' as unknown as string[]), false);
  assert.equal(canAll(S, ['cursos:leer', 'mensajes:leer']), true);
  assert.equal(canAll(S, ['cursos:leer', 'cuentas:leer']), false);
  assert.equal(canAny(S, ['cuentas:leer', 'cursos:leer']), true);
  assert.equal(canAny(S, ['cuentas:leer', 'calificaciones:registrar']), false);
});

test('permissionsOf devuelve una copia: modificarla no altera la matriz', () => {
  const copy = permissionsOf(S);
  copy.push('cuentas:crear');
  assert.equal(can(S, 'cuentas:crear'), false);
  assert.ok(!permissionsOf(S).includes('cuentas:crear'));
});

// ---------------------------------------------------------------------------------------------------------------
// Expectativas de seguridad escritas a mano, independientes de la matriz implementada
// ---------------------------------------------------------------------------------------------------------------
const GERENTE_ONLY = [
  'cuentas:leer', 'cuentas:crear', 'cuentas:editar', 'cuentas:asignar_rol',
  'configuracion:editar', 'contenido_original:leer', 'contenido_original:restaurar',
  'cursos:eliminar', 'servicios:eliminar', 'reclamaciones:eliminar', 'reclamaciones:exportar', 'boletin:eliminar', 'boletin:exportar',
  'items:leer', 'items:crear', 'items:editar', 'items:eliminar',
  'estudiantes:exportar', 'importaciones:aplicar', 'certificados:anular', 'calificaciones:corregir_cerradas', 'reportes_academicos:exportar', 'auditoria:leer',
];

test('el gerente general tiene todos los permisos definidos', () => {
  for (const id of ALL_PERMISSIONS) assert.equal(can(G, id), true, id);
  assert.deepEqual(permissionsOf(G), [...ALL_PERMISSIONS].sort());
});

test('las operaciones delicadas son exclusivas del gerente general', () => {
  for (const id of GERENTE_ONLY) {
    assert.equal(can(G, id), true, 'gerente ' + id);
    assert.equal(can(C, id), false, 'coordinadora ' + id);
    assert.equal(can(S, id), false, 'secretaria ' + id);
  }
});

test('la coordinadora: gestión académica y operativa permitida', () => {
  const allowed = [
    'cursos:leer', 'cursos:crear', 'cursos:editar', 'cursos:archivar', 'servicios:editar', 'galeria:eliminar', 'convenios:editar', 'archivos:crear',
    'mensajes:leer', 'mensajes:crear', 'mensajes:editar', 'seguimiento_mensajes:enviar', 'seguimiento_reclamaciones:editar', 'cotizaciones:crear', 'cotizaciones:anular',
    'reclamaciones:leer', 'estadisticas:leer', 'configuracion:leer',
    'estudiantes:leer', 'estudiantes:crear', 'estudiantes:editar', 'estudiantes:archivar',
    'convocatorias:crear', 'convocatorias:editar', 'convocatorias:cerrar',
    'matriculas:crear', 'matriculas:editar', 'matriculas:anular', 'matriculas:confirmar',
    'sesiones:crear', 'asistencia:registrar', 'calificaciones:registrar', 'certificados:emitir', 'importaciones:previsualizar', 'reportes_academicos:leer',
  ];
  for (const id of allowed) assert.equal(can(C, id), true, id);
  for (const id of ['mensajes:eliminar', 'boletin:eliminar']) assert.equal(can(C, id), false, id);
});

test('la secretaria: estudiantes, matrículas y atención permitidos', () => {
  const allowed = [
    'cursos:leer', 'convocatorias:leer', 'configuracion:leer', 'mensajes:leer', 'mensajes:crear', 'mensajes:editar',
    'seguimiento_mensajes:leer', 'seguimiento_mensajes:editar', 'seguimiento_mensajes:enviar', 'chatbot_consultas:leer',
    'estudiantes:leer', 'estudiantes:crear', 'matriculas:leer', 'matriculas:crear', 'matriculas:editar',
  ];
  for (const id of allowed) assert.equal(can(S, id), true, id);
});

test('la secretaria nunca obtiene cuentas, configuración crítica, calificaciones ni certificados', () => {
  const permissions = permissionsOf(S);
  for (const id of permissions) {
    assert.ok(!id.startsWith('cuentas:'), id);
    assert.ok(!id.startsWith('calificaciones:'), id);
    assert.ok(!id.startsWith('certificados:'), id);
    assert.ok(!id.startsWith('contenido_original:'), id);
    assert.ok(!id.startsWith('auditoria:'), id);
    assert.ok(!id.startsWith('importaciones:'), id);
  }
  for (const id of ['configuracion:editar', 'matriculas:anular', 'estudiantes:archivar', 'estudiantes:exportar', 'cursos:eliminar', 'mensajes:eliminar']) assert.equal(can(S, id), false, id);
  // Defensa contra una futura edición descuidada de la matriz: ningún permiso de esos recursos, ni los que se creen más adelante.
  for (const id of ALL_PERMISSIONS) {
    if (/^(cuentas|calificaciones|certificados|importaciones|auditoria|contenido_original):/.test(id) || id === 'configuracion:editar') assert.equal(can(S, id), false, id);
  }
});

test('matriculas:confirmar: gerente y coordinadora sí; secretaria y cuenta sin rol no', () => {
  assert.ok(isPermission('matriculas:confirmar'));
  assert.ok((ALL_PERMISSIONS as readonly string[]).includes('matriculas:confirmar'));
  assert.equal(can(G, 'matriculas:confirmar'), true);
  assert.equal(can(C, 'matriculas:confirmar'), true);
  assert.equal(can(S, 'matriculas:confirmar'), false);
  for (const sinRol of [null, undefined, '', 'ADMIN']) assert.equal(can(sinRol, 'matriculas:confirmar'), false);
  assert.deepEqual(permissionsOf(null), []);
  // Los permisos de matrículas anteriores se conservan: la secretaria sigue sin anular.
  for (const id of ['matriculas:leer', 'matriculas:crear', 'matriculas:editar']) assert.equal(can(S, id), true, id);
  assert.equal(can(S, 'matriculas:anular'), false);
  assert.ok(!(FUTURE_RESOURCES as readonly string[]).includes('matriculas'), 'matriculas es un módulo implementado');
});

test('docentes: catálogo exacto, gerente y coordinadora (propuesta), secretaría y cuenta sin rol denegadas, sin eliminación física', () => {
  assert.deepEqual([...RESOURCE_OPERATIONS.docentes], ['leer', 'crear', 'editar', 'asignar']);
  const all = ['docentes:leer', 'docentes:crear', 'docentes:editar', 'docentes:asignar'];
  for (const id of all) { assert.ok(isPermission(id), id); assert.equal(can(G, id), true, 'gerente ' + id); assert.equal(can(C, id), true, 'coordinadora ' + id); }
  // La secretaría no recibe datos personales de docentes mientras no haya una decisión de negocio.
  for (const id of all) assert.equal(can(S, id), false, 'secretaria ' + id);
  for (const sinRol of [null, undefined, '', 'ADMIN', 'docente', 'DOCENTE']) for (const id of all) assert.equal(can(sinRol, id), false, String(sinRol) + ' ' + id);
  for (const id of ['docentes:eliminar', 'docentes:archivar', 'docentes:exportar', 'docentes:*', 'docentes']) assert.equal(isPermission(id), false, id);
  assert.ok(!(FUTURE_RESOURCES as readonly string[]).includes('docentes'), 'docentes es un módulo implementado');
  assert.deepEqual(permissionsOf(C).filter(id => id.startsWith('docentes:')), [...all].sort());
  assert.deepEqual(permissionsOf(S).filter(id => id.startsWith('docentes:')), []);
});

test('docentes: cada ruta exige el permiso previsto, según los decoradores reales y el inventario', () => {
  const expected: Record<string, string> = {
    'GET admin/docentes': 'docentes:leer', 'GET admin/docentes/:id': 'docentes:leer', 'GET admin/docentes/:id/asignaciones': 'docentes:leer',
    'POST admin/docentes': 'docentes:crear', 'PATCH admin/docentes/:id': 'docentes:editar', 'PUT admin/docentes/:id/estado': 'docentes:editar',
    'GET admin/asignaciones-docentes': 'docentes:leer', 'GET admin/asignaciones-docentes/:id': 'docentes:leer',
    'POST admin/asignaciones-docentes': 'docentes:asignar', 'PUT admin/asignaciones-docentes/:id': 'docentes:asignar',
    'PUT admin/asignaciones-docentes/:id/retiro': 'docentes:asignar', 'PUT admin/asignaciones-docentes/:id/reactivacion': 'docentes:asignar',
    'POST admin/asignaciones-docentes/:id/sustitucion': 'docentes:asignar',
  };
  const inventory = ROUTE_INVENTORY.filter(route => /^admin\/(docentes|asignaciones-docentes)/.test(route.path));
  assert.deepEqual(inventory.map(route => route.method + ' ' + route.path).sort(), Object.keys(expected).sort());
  for (const route of inventory) assert.deepEqual(route.access, { kind: 'permiso', permission: expected[route.method + ' ' + route.path] }, route.path);
  const declared = routeHandlers().filter(route => /^\w+ admin\/(docentes|asignaciones-docentes)/.test(route.key));
  assert.equal(declared.length, Object.keys(expected).length);
  for (const route of declared) assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, route.handler), { kind: 'permiso', permission: expected[route.key] }, route.key);
  // Escribir en el equipo docente nunca se concede con solo leer, y la secretaría no pasa ninguna.
  for (const route of inventory) if (route.method !== 'GET') assert.notEqual((route.access as { permission: string }).permission, 'docentes:leer', route.path);
  for (const route of inventory) assert.equal(can(S, (route.access as { permission: string }).permission), false, 'secretaria ' + route.path);
});

test('sesiones: catálogo exacto sin cambios, gerente y coordinadora completos, secretaría y cuenta sin rol denegadas, sin eliminación física', () => {
  assert.deepEqual([...RESOURCE_OPERATIONS.sesiones], ['leer', 'crear', 'editar'], 'no se añadió un permiso «programar»: reprogramar y cambiar de estado es editar');
  const all = ['sesiones:leer', 'sesiones:crear', 'sesiones:editar'];
  for (const id of all) { assert.ok(isPermission(id), id); assert.equal(can(G, id), true, 'gerente ' + id); assert.equal(can(C, id), true, 'coordinadora ' + id); }
  for (const id of all) assert.equal(can(S, id), false, 'secretaria ' + id);
  for (const sinRol of [null, undefined, '', 'ADMIN', 'docente']) for (const id of all) assert.equal(can(sinRol, id), false, String(sinRol) + ' ' + id);
  for (const id of ['sesiones:eliminar', 'sesiones:programar', 'sesiones:archivar', 'sesiones:*', 'sesiones']) assert.equal(isPermission(id), false, id);
  assert.ok(!(FUTURE_RESOURCES as readonly string[]).includes('sesiones'), 'sesiones es un módulo implementado');
  assert.deepEqual(permissionsOf(C).filter(id => id.startsWith('sesiones:')), [...all].sort());
  assert.deepEqual(permissionsOf(S).filter(id => id.startsWith('sesiones:')), []);
  assert.equal(permissionsOf(C).length, 71, 'la matriz de la coordinadora solo creció en los 3 permisos preinscripciones:leer|editar|convertir (autorizados 2026-10-20)');
});

test('sesiones: cada ruta exige el permiso previsto, según los decoradores reales y el inventario', () => {
  const expected: Record<string, string> = {
    'GET admin/sesiones': 'sesiones:leer', 'GET admin/sesiones/:id': 'sesiones:leer', 'GET admin/convocatorias/:id/sesiones': 'sesiones:leer',
    'POST admin/sesiones': 'sesiones:crear', 'PATCH admin/sesiones/:id': 'sesiones:editar', 'PUT admin/sesiones/:id/estado': 'sesiones:editar',
  };
  const isSessionRoute = (path: string) => /^admin\/sesiones(\/|$)/.test(path) || /^admin\/convocatorias\/:id\/sesiones$/.test(path);
  const inventory = ROUTE_INVENTORY.filter(route => isSessionRoute(route.path));
  assert.deepEqual(inventory.map(route => route.method + ' ' + route.path).sort(), Object.keys(expected).sort());
  for (const route of inventory) assert.deepEqual(route.access, { kind: 'permiso', permission: expected[route.method + ' ' + route.path] }, route.path);
  const declared = routeHandlers().filter(route => isSessionRoute(route.key.split(' ')[1]));
  assert.equal(declared.length, Object.keys(expected).length);
  for (const route of declared) assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, route.handler), { kind: 'permiso', permission: expected[route.key] }, route.key);
  assert.ok(!declared.some(route => route.key.startsWith('DELETE ')), 'no existe ninguna ruta DELETE: una sesión se cancela y se conserva');
  for (const route of inventory) if (route.method !== 'GET') assert.notEqual((route.access as { permission: string }).permission, 'sesiones:leer', route.path);
  for (const route of inventory) assert.equal(can(S, (route.access as { permission: string }).permission), false, 'secretaria ' + route.path);
  // La ruta anidada de ediciones no cambia el permiso de las rutas de ediciones: seguirán exigiendo convocatorias:*.
  const editions = ROUTE_INVENTORY.filter(route => /^admin\/convocatorias/.test(route.path) && !isSessionRoute(route.path));
  assert.ok(editions.length >= 8 && editions.every(route => (route.access as { permission: string }).permission.startsWith('convocatorias:')));
});

test('la coordinadora no administra cuentas ni configuración crítica', () => {
  for (const id of ALL_PERMISSIONS) if (id.startsWith('cuentas:')) assert.equal(can(C, id), false, id);
  assert.equal(can(C, 'configuracion:editar'), false);
  assert.equal(can(C, 'contenido_original:restaurar'), false);
});

test('las decisiones pendientes no se conceden a coordinadora ni secretaria', () => {
  for (const id of ['importaciones:aplicar', 'certificados:anular', 'calificaciones:corregir_cerradas', 'estudiantes:exportar', 'reportes_academicos:exportar', 'items:leer', 'items:editar']) {
    assert.equal(can(C, id), false, id);
    assert.equal(can(S, id), false, id);
  }
  for (const id of ['estudiantes:editar', 'matriculas:anular', 'asistencia:registrar', 'asistencia:leer', 'estadisticas:leer', 'cotizaciones:leer', 'servicios:leer', 'convenios:leer']) assert.equal(can(S, id), false, id);
});

test('E3.4.1: los tres roles registran consultas manuales (mensajes:crear), pero solo el gerente las elimina', () => {
  for (const role of [G, C, S]) assert.equal(can(role, 'mensajes:crear'), true, role);
  assert.equal(can(G, 'mensajes:eliminar'), true);
  for (const role of [C, S]) assert.equal(can(role, 'mensajes:eliminar'), false, role);
  // El ajuste no amplía nada más: los permisos de mensajes de cada rol son exactamente estos.
  const messages = (role: string) => permissionsOf(role).filter(id => id.startsWith('mensajes:'));
  assert.deepEqual(messages(C), ['mensajes:crear', 'mensajes:editar', 'mensajes:leer']);
  assert.deepEqual(messages(S), ['mensajes:crear', 'mensajes:editar', 'mensajes:leer']);
  assert.equal(permissionsOf(C).length, 71, 'coordinadora: 62 permisos anteriores + mensajes:crear + matriculas:confirmar (E4.1) + 4 de docentes + 3 de preinscripciones');
  assert.equal(permissionsOf(S).length, 18, 'secretaria: 14 permisos anteriores + mensajes:crear + 3 de preinscripciones (leer, editar, convertir)');
  // La ruta que registra consultas exige exactamente ese permiso (decorador real e inventario).
  const create = ROUTE_INVENTORY.find(route => route.method === 'POST' && route.path === 'admin/messages');
  assert.deepEqual(create?.access, { kind: 'permiso', permission: 'mensajes:crear' });
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, MessagesController.prototype.create), { kind: 'permiso', permission: 'mensajes:crear' });
});

test('seguimiento: el permiso depende del recurso y un recurso desconocido se deniega', () => {
  assert.equal(seguimientoPermission('messages', 'leer'), 'seguimiento_mensajes:leer');
  assert.equal(seguimientoPermission('reclamaciones', 'enviar'), 'seguimiento_reclamaciones:enviar');
  for (const recurso of ['cotizaciones', '', 'MESSAGES', null, undefined, '__proto__']) assert.equal(seguimientoPermission(recurso, 'leer'), null);
  assert.equal(can(S, seguimientoPermission('reclamaciones', 'leer')), false, 'la secretaria no atiende reclamaciones');
  assert.equal(can(S, seguimientoPermission('messages', 'leer')), true);
  assert.equal(can(S, seguimientoPermission('otro', 'leer')), false);
});

// ---------------------------------------------------------------------------------------------------------------
// Inventario de rutas frente a los controladores reales (solo lectura de metadatos; no cambia ninguna ruta)
// ---------------------------------------------------------------------------------------------------------------
const CONTROLLERS: Function[] = [
  ImportacionesController,
  AccountsController, AuthController, AdminChatbotController, ItemsController, MessagesController, AdminReclamacionesController, StatsController,
  AttentionController, CursoController, AdminCursoController, ServicioController, AdminServicioController, PreguntaFrecuenteController,
  AdminPreguntaFrecuenteController, ChatbotController, ContactoController, OriginalContentController, ConveniosController, AdminConveniosController,
  CotizacionesController, AdminGaleriaController, GaleriaController, HealthController, AdminNewsletterController, NewsletterController,
  ReclamacionesController, AdminSettingsController, SettingsController, PublicUploadsController, AdminUploadsController, EstudiantesController, ConvocatoriasController, MatriculasController, DocentesController, AsignacionesDocentesController, SesionesController, EdicionSesionesController, ReportesController,
  PreinscripcionesPublicController, ChatbotPreinscripcionController, PreinscripcionesController, CertificadosController, CertificadosPublicController, AsistenteController,
];

function normalize(...parts: string[]) { return parts.join('/').split('/').filter(Boolean).join('/'); }

function routeHandlers(): { key: string; controller: Function; handler: Function }[] {
  const routes: { key: string; controller: Function; handler: Function }[] = [];
  for (const controller of CONTROLLERS) {
    const prefix: string = Reflect.getMetadata(PATH_METADATA, controller);
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = controller.prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      routes.push({ key: RequestMethod[method] + ' ' + normalize(prefix, Reflect.getMetadata(PATH_METADATA, handler)), controller, handler });
    }
  }
  return routes;
}

function actualRoutes(): string[] { return routeHandlers().map(route => route.key).sort(); }

// Todos los permisos que una ruta puede llegar a exigir (los condicionados incluidos).
function declaredPermissions(access: RouteAccess): string[] {
  if (access.kind === 'permiso') return [access.permission];
  if (access.kind === 'segun_campo') return [access.base, ...Object.values(access.when)];
  if (access.kind === 'seguimiento') return [seguimientoPermission('messages', access.operation), seguimientoPermission('reclamaciones', access.operation)];
  return [];
}

test('el inventario coincide exactamente con las rutas de los controladores (una ruta nueva sin clasificar hace fallar esta prueba)', () => {
  const inventory = ROUTE_INVENTORY.map(route => route.method + ' ' + route.path).sort();
  assert.equal(new Set(inventory).size, inventory.length, 'rutas repetidas en el inventario');
  assert.deepEqual(actualRoutes(), inventory);
});

test('cada ruta declara con su decorador exactamente la clasificación del inventario (sin decorador, la guard la denegaría)', () => {
  const inventory = new Map(ROUTE_INVENTORY.map(route => [route.method + ' ' + route.path, route.access]));
  for (const { key, controller, handler } of routeHandlers()) {
    assert.equal(Reflect.getMetadata(ACCESS_METADATA, controller), undefined, key + ': la clasificación va en cada ruta, no en el controlador');
    const declared = Reflect.getMetadata(ACCESS_METADATA, handler);
    assert.ok(isRouteAccess(declared), key + ' no declara su acceso');
    assert.deepEqual(declared, inventory.get(key), key);
  }
});

test('toda ruta /admin queda clasificada y solo las de autoservicio y autenticación quedan sin permiso', () => {
  const noPermission = ROUTE_INVENTORY.filter(route => route.path.startsWith('admin/') && route.access.kind !== 'permiso' && route.access.kind !== 'segun_campo' && route.access.kind !== 'seguimiento').map(route => route.method + ' ' + route.path).sort();
  // POST admin/signup: registro público aprobado por el responsable el 2026-10-16; crea cuentas sin rol (test/public-signup.test.ts).
  // POST admin/asistente/consultar: HORUS Assistant v2 (preguntas en lenguaje natural), solo lectura; mismo control de rol que el resumen.
  // GET admin/asistente/resumen: HORUS Assistant, solo lectura; el servicio lee el rol vigente de la base y filtra cada área por permisos (test/asistente.test.ts).
  assert.deepEqual(noPermission, ['GET admin/asistente/resumen', 'GET admin/me', 'POST admin/asistente/consultar', 'POST admin/forgot-password', 'POST admin/login', 'POST admin/password', 'POST admin/reset-password', 'POST admin/signup']);
  for (const route of ROUTE_INVENTORY) {
    assert.ok(isRouteAccess(route.access), route.path);
    if (route.access.kind === 'segun_campo') assert.ok((route.note ?? '').length > 10, route.path + ' debe explicar la condición');
    if (!route.path.startsWith('admin/')) assert.equal(route.access.kind, 'publica', route.path);
  }
  assert.deepEqual(ROUTE_INVENTORY.filter(route => route.access.kind === 'segun_campo').map(route => route.method + ' ' + route.path).sort(),
    ['POST admin/cotizaciones/:id/estado', 'PUT admin/cursos/:id', 'PUT admin/preguntas-frecuentes/:id']);
});

test('las rutas públicas y de autoservicio de /admin son exactamente las aprobadas, según los decoradores reales (independiente del inventario)', () => {
  // Pares método + path obtenidos de los controladores y de su metadato de acceso; no se consulta ROUTE_INVENTORY.
  const byKind = (kind: string) => routeHandlers()
    .filter(route => route.key.split(' ')[1].startsWith('admin/') && Reflect.getMetadata(ACCESS_METADATA, route.handler)?.kind === kind)
    .map(route => route.key).sort();
  assert.deepEqual(byKind('publica'), ['POST admin/forgot-password', 'POST admin/login', 'POST admin/reset-password', 'POST admin/signup']);
  assert.deepEqual(byKind('autenticada'), ['GET admin/asistente/resumen', 'GET admin/me', 'POST admin/asistente/consultar', 'POST admin/password']);
});

test('las rutas de cuentas y registro exigen permisos de cuentas, y ningún permiso de recurso futuro se exige todavía', () => {
  const byKey = new Map(ROUTE_INVENTORY.map(route => [route.method + ' ' + route.path, route]));
  assert.deepEqual(byKey.get('POST admin/register').access, { kind: 'permiso', permission: 'cuentas:crear' });
  assert.deepEqual(byKey.get('GET admin/users').access, { kind: 'permiso', permission: 'cuentas:leer' });
  assert.deepEqual(byKey.get('PUT admin/users/:id').access, { kind: 'permiso', permission: 'cuentas:editar' });
  assert.deepEqual(byKey.get('PUT admin/settings').access, { kind: 'permiso', permission: 'configuracion:editar' });
  const future = new Set<string>(FUTURE_RESOURCES);
  for (const route of ROUTE_INVENTORY) {
    for (const id of declaredPermissions(route.access)) assert.ok(!future.has(id.split(':')[0]), route.path + ' exige un recurso que aún no existe');
  }
});

test('ninguna ruta actual de /admin exigiría a la secretaria cuentas, configuración editable, notas ni certificados', () => {
  for (const route of ROUTE_INVENTORY) {
    for (const id of declaredPermissions(route.access)) {
      if (/^(cuentas|calificaciones|certificados):/.test(id) || id === 'configuracion:editar') assert.equal(can(S, id), false, route.path);
    }
  }
});
