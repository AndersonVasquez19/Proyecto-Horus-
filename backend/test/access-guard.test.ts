import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Controller, ExecutionContext, Get, Module, Provider, SetMetadata, Type } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from '../src/admin/auth/auth.controller';
import { AccountsController } from '../src/admin/auth/accounts.controller';
import { AuthService } from '../src/admin/auth/auth.service';
import { AccountsService } from '../src/admin/auth/accounts.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { AttentionController } from '../src/attention/attention.module';
import { AttentionService } from '../src/attention/attention.service';
import { AdminCursoController, AdminPreguntaFrecuenteController, AdminServicioController, CursoController } from '../src/catalogo/catalogo.controllers';
import { CatalogoService } from '../src/catalogo/catalogo.service';
import { CotizacionesController } from '../src/cotizaciones/cotizaciones.module';
import { CotizacionesService } from '../src/cotizaciones/cotizaciones.service';
import { HealthController } from '../src/health.controller';
import { AdminSettingsController } from '../src/settings/admin-settings.controller';
import { SettingsService } from '../src/settings/settings.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { PrismaService } from '../src/database/prisma.service';
import { AccessGuard, AccountAccessService, FORBIDDEN_MESSAGE, NO_ROLE_MESSAGE } from '../src/permissions/access.guard';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { requirementFor } from '../src/permissions/access';

// E3.3/E3.6: la guard se prueba en módulos de prueba que replican el registro global de AppModule (APP_GUARD). Cuentas simuladas en
// memoria, servicios sustituidos, sin MySQL, sin correo y sin red fuera de 127.0.0.1. Secreto ficticio. El registro en el AppModule
// real se comprueba al final de este archivo (estructura) y con HTTP real en test/access-guard-http.integration.cjs.
const secret = 'isolated-access-guard-secret-32-characters!';
const settings = { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined) };
const jwt = new JwtService({ secret, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } });

type Row = { id: number; nombre: string; email: string; activo: boolean; session_version: number; rol: string | null };

function accounts() {
  const rows: Row[] = [
    { id: 1, nombre: 'Gerente', email: 'gerente@example.test', activo: true, session_version: 1, rol: 'GERENTE_GENERAL' },
    { id: 2, nombre: 'Coordinadora', email: 'coordinadora@example.test', activo: true, session_version: 1, rol: 'COORDINADORA_INSTITUCIONAL' },
    { id: 3, nombre: 'Secretaria', email: 'secretaria@example.test', activo: true, session_version: 1, rol: 'SECRETARIA' },
    { id: 4, nombre: 'Sin rol', email: 'sinrol@example.test', activo: true, session_version: 1, rol: null },
    { id: 5, nombre: 'Inactiva', email: 'inactiva@example.test', activo: false, session_version: 1, rol: 'GERENTE_GENERAL' },
    { id: 6, nombre: 'Rol extraño', email: 'extrano@example.test', activo: true, session_version: 1, rol: 'ADMINISTRADOR' },
  ];
  // `afterAuth` permite simular un cambio que ocurre entre la autenticación (JwtStrategy) y la lectura de la guard.
  const state = { afterAuth: null as null | ((row: Row) => Row), reads: 0 };
  const adminUser = {
    findUnique: async ({ where, select }: any) => {
      state.reads++;
      const row = rows.find(candidate => candidate.id === where.id);
      if (!row) return null;
      // `afterAuth` solo altera la lectura de la guard (sin `nombre`), no la de JwtStrategy.
      const seen = select && !select.nombre && state.afterAuth ? state.afterAuth({ ...row }) : { ...row };
      return select ? Object.fromEntries(Object.keys(select).map(key => [key, (seen as any)[key]])) : seen;
    },
  };
  return { rows, state, client: { adminUser } };
}

const token = (id: number, extra: object = {}) => jwt.sign({ id, email: 'x@example.test', version: 1, ...extra });

@Controller('admin/sin-clasificar')
class UnclassifiedController {
  @Get() get() { return { ok: true }; }
  @Get('mal-declarada') @SetMetadata(ACCESS_METADATA, { kind: 'permiso', permission: 'cuentas:todo' }) bad() { return { ok: true }; }
}

function stubs(calls: string[]): Provider[] {
  const stub = (names: string[]) => Object.fromEntries(names.map(name => [name, async () => { calls.push(name); return { ok: true }; }]));
  return [
    { provide: AuthService, useValue: stub(['register', 'login']) },
    { provide: AccountsService, useValue: stub(['forgot', 'reset', 'password', 'list', 'status', 'role']) },
    { provide: AttentionService, useValue: stub(['get', 'save', 'receipt', 'send']) },
    { provide: CotizacionesService, useValue: { ...stub(['list', 'detail', 'create', 'edit', 'email', 'status', 'duplicate']), pdf: async () => { calls.push('pdf'); return { buffer: Buffer.from('%PDF-1.3\n'), fileName: 'cotizacion-prueba.pdf' }; } } },
    { provide: CatalogoService, useValue: stub(['list', 'detail', 'create', 'update', 'remove', 'archive']) },
    { provide: SettingsService, useValue: stub(['getAllSettingsAdmin', 'updateSettings']) },
  ];
}

const CONTROLLERS: Type[] = [AuthController, AccountsController, AttentionController, CotizacionesController, CursoController, AdminCursoController,
  AdminServicioController, AdminPreguntaFrecuenteController, HealthController, AdminSettingsController, UnclassifiedController];

async function start(withAccessGuard: boolean) {
  const db = accounts(); const calls: string[] = [];
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: CONTROLLERS,
    providers: [JwtStrategy, JwtAuthGuard, AccountAccessService,
      ...(withAccessGuard ? [{ provide: APP_GUARD, useClass: AccessGuard }] : []),
      { provide: ConfigService, useValue: settings }, { provide: PrismaService, useValue: db.client }, ...stubs(calls)],
  })
  class AccessTestModule {}
  const app = await NestFactory.create(AccessTestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const call = async (method: string, route: string, auth?: string, body?: object, headers: Record<string, string> = {}) => {
    calls.length = 0;
    const response = await fetch(url + '/' + route, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json().catch(() => null) as any, reached: calls.length > 0 };
  };
  return { app, db, call };
}

// ---------------------------------------------------------------------------------------------------------------
// Requisito por solicitud (función pura)
// ---------------------------------------------------------------------------------------------------------------
test('requirementFor: una declaración ausente o mal formada se deniega', () => {
  for (const access of [undefined, null, {}, 'publica', { kind: 'otra' }, { kind: 'permiso' }, { kind: 'permiso', permission: 'cuentas:todo' },
    { kind: 'seguimiento', operation: 'borrar' }, { kind: 'segun_campo', field: 'estado', base: 'cursos:editar', when: {} },
    { kind: 'segun_campo', field: 'estado', base: 'cursos:editar', when: { archivado: 'cursos:destruir' } },
    { kind: 'segun_campo', field: '', base: 'cursos:editar', when: { archivado: 'cursos:archivar' } }]) {
    assert.deepEqual(requirementFor(access, {}), { kind: 'denegada' }, JSON.stringify(access));
  }
});

test('requirementFor: seguimiento depende del recurso de la ruta y un recurso desconocido se deniega', () => {
  const access = { kind: 'seguimiento', operation: 'enviar' };
  assert.deepEqual(requirementFor(access, { params: { recurso: 'messages' } }), { kind: 'permisos', permissions: ['seguimiento_mensajes:enviar'] });
  assert.deepEqual(requirementFor(access, { params: { recurso: 'reclamaciones' } }), { kind: 'permisos', permissions: ['seguimiento_reclamaciones:enviar'] });
  for (const params of [{}, { recurso: 'cotizaciones' }, { recurso: '__proto__' }, { recurso: 'MESSAGES' }, undefined]) assert.deepEqual(requirementFor(access, { params }), { kind: 'denegada' });
});

test('requirementFor: el contenido de la solicitud solo puede añadir exigencias, nunca quitarlas', () => {
  const access = { kind: 'segun_campo', field: 'estado', base: 'cursos:editar', when: { archivado: 'cursos:archivar' } };
  const both = { kind: 'permisos', permissions: ['cursos:editar', 'cursos:archivar'] };
  const edit = { kind: 'permisos', permissions: ['cursos:editar'] };
  for (const estado of ['archivado', ' archivado ', 'ARCHIVADO']) assert.deepEqual(requirementFor(access, { body: { estado } }), both, estado);
  for (const body of [undefined, null, {}, [], 'archivado', { estado: 'publicado' }, { estado: ['archivado'] }, { estado: 1 }, { estado: '__proto__' }, { estado: 'constructor' }, { titulo: 'archivado' }]) {
    assert.deepEqual(requirementFor(access, { body }), edit, JSON.stringify(body));
  }
  const quote = { kind: 'segun_campo', field: 'estado', base: 'cotizaciones:editar', when: { anulada: 'cotizaciones:anular' } };
  assert.deepEqual(requirementFor(quote, { body: { estado: 'anulada' } }), { kind: 'permisos', permissions: ['cotizaciones:editar', 'cotizaciones:anular'] });
  assert.deepEqual(requirementFor(quote, { body: { estado: 'aceptada' } }), { kind: 'permisos', permissions: ['cotizaciones:editar'] });
});

test('la guard deniega cualquier contexto que no sea HTTP', async () => {
  const guard = new AccessGuard(new Reflector(), { canActivate: async () => assert.fail('no debe autenticar') } as any, { find: async () => assert.fail('no debe consultar') } as any);
  await assert.rejects(guard.canActivate({ getType: () => 'rpc' } as unknown as ExecutionContext), (error: any) => error.getStatus() === 403);
});

// ---------------------------------------------------------------------------------------------------------------
// Guard sobre HTTP real (127.0.0.1) con controladores reales
// ---------------------------------------------------------------------------------------------------------------
test('rutas públicas explícitas: sin sesión y sin consultar cuentas', async () => {
  const { app, db, call } = await start(true);
  try {
    for (const [method, route] of [['GET', 'health'], ['GET', 'cursos'], ['GET', 'cursos/1'], ['POST', 'admin/login'], ['POST', 'admin/forgot-password'], ['POST', 'admin/reset-password']]) {
      const result = await call(method, route, undefined, method === 'POST' ? {} : undefined);
      assert.ok(result.status < 400, method + ' ' + route + ' → ' + result.status);
    }
    assert.equal(db.state.reads, 0);
    // Un token inválido en una ruta pública no la bloquea (la ruta no lo evalúa).
    assert.equal((await call('GET', 'cursos', 'basura')).status, 200);
  } finally { await app.close(); }
});

test('401 sin sesión válida: ausente, mal formada, caducada, firma ajena, otra audiencia, cuenta inexistente, desactivada o sesión revocada', async () => {
  const { app, db, call } = await start(true);
  try {
    db.rows[0].session_version = 2; // la sesión versión 1 del gerente quedó revocada
    const invalid = [undefined, 'basura', 'a.b.c', jwt.sign({ id: 2, version: 1 }, { expiresIn: -10 }),
      new JwtService({ secret: 'another-secret-with-at-least-32-characters' }).sign({ id: 2, version: 1 }, { issuer: 'horus-api', audience: 'horus-panel' }),
      jwt.sign({ id: 2, version: 1 }, { audience: 'horus-password-reset' }), token(999), token(5), token(1)];
    for (const session of invalid) {
      for (const [method, route] of [['GET', 'admin/cotizaciones'], ['GET', 'admin/me'], ['GET', 'admin/users'], ['GET', 'admin/sin-clasificar'], ['GET', 'admin/seguimiento/messages/1']]) {
        const result = await call(method, route, session);
        assert.equal(result.status, 401, route + ' con ' + String(session).slice(0, 12));
        assert.equal(result.reached, false);
      }
    }
  } finally { await app.close(); }
});

test('autoservicio: una cuenta sin rol consulta su cuenta y cambia su contraseña, pero nada más', async () => {
  const { app, call } = await start(true);
  try {
    const session = token(4);
    const me = await call('GET', 'admin/me', session);
    assert.equal(me.status, 200);
    assert.equal(me.data.user.id, 4);
    assert.equal(me.data.user.rol, null, '/admin/me informa que la cuenta no tiene rol (E3.4.1)');
    assert.deepEqual(me.data.user.permisos, []);
    assert.equal((await call('POST', 'admin/password', session, { actual: 'x', nueva: 'y' })).status, 200);
    for (const [method, route] of [['GET', 'admin/cursos'], ['GET', 'admin/cotizaciones'], ['GET', 'admin/users'], ['POST', 'admin/register'], ['GET', 'admin/seguimiento/messages/1']]) {
      const result = await call(method, route, session, method === 'POST' ? {} : undefined);
      assert.equal(result.status, 403, route);
      assert.equal(result.data.mensaje, NO_ROLE_MESSAGE);
      assert.equal(result.reached, false);
    }
    // Un valor de rol desconocido en la base equivale a no tener rol.
    assert.equal((await call('GET', 'admin/cursos', token(6))).data.mensaje, NO_ROLE_MESSAGE);
  } finally { await app.close(); }
});

// Acceso básico: una cuenta sin rol (p. ej. recién registrada) entra a su espacio sin autorización previa, pero el backend sigue
// negándole toda operación administrativa. Los tres roles conservan exactamente su alcance. 4 = sin rol; 1, 2, 3 = los tres roles.
test('acceso básico: sin rol usa el autoservicio y recibe 403 en operaciones administrativas; los tres roles conservan su alcance', async () => {
  const { app, call } = await start(true);
  try {
    const roles: Record<number, string | null> = { 4: null, 1: 'GERENTE_GENERAL', 2: 'COORDINADORA_INSTITUCIONAL', 3: 'SECRETARIA' };
    for (const id of [4, 1, 2, 3]) {
      const me = await call('GET', 'admin/me', token(id));
      assert.equal(me.status, 200, 'GET admin/me ' + id);
      assert.equal(me.data.user.rol, roles[id]);
      if (id === 4) assert.deepEqual(me.data.user.permisos, [], 'la cuenta básica no recibe permisos');
      assert.equal((await call('POST', 'admin/password', token(id), { actual: 'x', nueva: 'y' })).status, 200, 'cambio de contraseña ' + id);
    }
    // [método, ruta, cuerpo, estado esperado para gerente, coordinadora, secretaria]. La cuenta sin rol: siempre 403.
    const operations: [string, string, object | undefined, number, number, number][] = [
      ['GET', 'admin/users', undefined, 200, 403, 403],
      ['POST', 'admin/register', {}, 201, 403, 403],
      ['PUT', 'admin/users/2', { activo: false }, 200, 403, 403],
      ['PUT', 'admin/users/2/rol', { rol: 'SECRETARIA', rol_actual: 'COORDINADORA_INSTITUCIONAL' }, 200, 403, 403],
      ['GET', 'admin/cursos', undefined, 200, 200, 200],
      ['POST', 'admin/cursos', {}, 201, 201, 403],
      ['GET', 'admin/cotizaciones', undefined, 200, 200, 403],
      ['PUT', 'admin/settings', { ajustes: {} }, 200, 403, 403],
    ];
    for (const [method, route, body, gerente, coordinadora, secretaria] of operations) {
      const basic = await call(method, route, token(4), body);
      assert.equal(basic.status, 403, 'sin rol ' + method + ' ' + route);
      assert.equal(basic.data.mensaje, NO_ROLE_MESSAGE);
      assert.equal(basic.reached, false, 'sin rol no llega al servicio: ' + method + ' ' + route);
      for (const [id, expected] of [[1, gerente], [2, coordinadora], [3, secretaria]] as const) {
        const result = await call(method, route, token(id), body);
        assert.equal(result.status, expected, roles[id] + ' ' + method + ' ' + route);
        if (expected === 403) { assert.equal(result.data.mensaje, FORBIDDEN_MESSAGE); assert.equal(result.reached, false); }
      }
    }
  } finally { await app.close(); }
});

test('denegación por defecto: una ruta sin decorador o con declaración inválida se deniega incluso al gerente', async () => {
  const { app, call } = await start(true);
  try {
    for (const route of ['admin/sin-clasificar', 'admin/sin-clasificar/mal-declarada']) {
      assert.equal((await call('GET', route)).status, 401, 'sin sesión: ' + route);
      const result = await call('GET', route, token(1));
      assert.equal(result.status, 403, route);
      assert.equal(result.data.mensaje, FORBIDDEN_MESSAGE);
      assert.equal(result.reached, false);
    }
  } finally { await app.close(); }
});

test('cuentas y acceso: solo el gerente crea administradores, lista cuentas o modifica cuentas', async () => {
  const { app, call } = await start(true);
  try {
    for (const id of [2, 3]) {
      for (const [method, route] of [['POST', 'admin/register'], ['GET', 'admin/users'], ['PUT', 'admin/users/1']]) {
        const result = await call(method, route, token(id), method === 'GET' ? undefined : { activo: false });
        assert.equal(result.status, 403, id + ' ' + route);
        assert.equal(result.data.mensaje, FORBIDDEN_MESSAGE);
        assert.equal(result.reached, false);
      }
    }
    assert.equal((await call('POST', 'admin/register', token(1), {})).status, 201);
    assert.equal((await call('GET', 'admin/users', token(1))).status, 200);
    assert.equal((await call('PUT', 'admin/users/2', token(1), { activo: false })).status, 200);
  } finally { await app.close(); }
});

test('el rol se lee de la base: roles o permisos enviados en el JWT, cabeceras o cuerpo no conceden nada', async () => {
  const { app, call } = await start(true);
  try {
    const forged = token(3, { rol: 'GERENTE_GENERAL', role: 'GERENTE_GENERAL', permisos: ['cuentas:crear'] });
    const headers = { 'X-Rol': 'GERENTE_GENERAL', 'X-Role': 'GERENTE_GENERAL', 'X-Permisos': 'cuentas:crear' };
    assert.equal((await call('GET', 'admin/users', forged, undefined, headers)).status, 403);
    assert.equal((await call('POST', 'admin/register', forged, { rol: 'GERENTE_GENERAL', permisos: ['cuentas:crear'] }, headers)).status, 403);
    assert.equal((await call('GET', 'admin/cotizaciones', forged, undefined, headers)).status, 403, 'la secretaria no lee cotizaciones');
    assert.equal((await call('GET', 'admin/cursos', forged)).status, 200, 'pero conserva sus propios permisos');
  } finally { await app.close(); }
});

test('el estado vigente manda: retirar el rol, desactivar o revocar surte efecto en la siguiente solicitud', async () => {
  const { app, db, call } = await start(true);
  try {
    const session = token(3);
    assert.equal((await call('GET', 'admin/cursos', session)).status, 200);
    db.rows[2].rol = null;
    assert.equal((await call('GET', 'admin/cursos', session)).data.mensaje, NO_ROLE_MESSAGE);
    assert.equal((await call('GET', 'admin/me', session)).status, 200, 'sin rol conserva el autoservicio');
    db.rows[2].rol = 'SECRETARIA';
    // Cambios entre la autenticación y la lectura de la guard (carrera): la guard no usa un estado anterior.
    db.state.afterAuth = row => ({ ...row, session_version: row.session_version + 1 });
    assert.equal((await call('GET', 'admin/cursos', session)).status, 401);
    db.state.afterAuth = row => ({ ...row, activo: false });
    assert.equal((await call('GET', 'admin/cursos', session)).status, 401);
    db.state.afterAuth = row => ({ ...row, rol: 'GERENTE_GENERAL' });
    assert.equal((await call('GET', 'admin/users', session)).status, 200, 'el rol vigente en la base es el que cuenta');
    db.state.afterAuth = null;
    db.rows[2].activo = false;
    assert.equal((await call('GET', 'admin/me', session)).status, 401);
  } finally { await app.close(); }
});

test('reglas por rol en rutas reales: permitido y 403 sin permiso', async () => {
  const { app, call } = await start(true);
  try {
    const cases: [number, string, string, number][] = [
      // secretaria: cursos en lectura, atención de mensajes; sin cotizaciones, configuración editable ni reclamaciones
      [3, 'GET', 'admin/cursos', 200], [3, 'POST', 'admin/cursos', 403], [3, 'DELETE', 'admin/cursos/1', 403],
      [3, 'GET', 'admin/settings', 200], [3, 'PUT', 'admin/settings', 403], [3, 'GET', 'admin/cotizaciones', 403],
      [3, 'GET', 'admin/servicios', 403], [3, 'GET', 'admin/preguntas-frecuentes', 403],
      // coordinadora: gestión de catálogo y cotizaciones; sin borrado de cursos ni configuración editable
      [2, 'POST', 'admin/cursos', 201], [2, 'DELETE', 'admin/cursos/1', 403], [2, 'DELETE', 'admin/servicios/1', 403],
      [2, 'GET', 'admin/cotizaciones', 200], [2, 'PUT', 'admin/settings', 403], [2, 'DELETE', 'admin/preguntas-frecuentes/1', 200],
      // gerente: todo lo definido
      [1, 'DELETE', 'admin/cursos/1', 200], [1, 'PUT', 'admin/settings', 200], [1, 'DELETE', 'admin/servicios/1', 200],
    ];
    for (const [id, method, route, expected] of cases) {
      const result = await call(method, route, token(id), method === 'POST' || method === 'PUT' ? {} : undefined);
      assert.equal(result.status, expected, id + ' ' + method + ' ' + route);
      assert.equal(result.reached, expected < 400);
    }
  } finally { await app.close(); }
});

test('acciones condicionadas al recurso: seguimiento según :recurso y cambios de estado según el cuerpo', async () => {
  const { app, call } = await start(true);
  try {
    // La secretaria atiende mensajes, no reclamaciones; un recurso desconocido se deniega a todos.
    assert.equal((await call('GET', 'admin/seguimiento/messages/1', token(3))).status, 200);
    assert.equal((await call('POST', 'admin/seguimiento/messages/1/correo', token(3), {})).status, 201);
    assert.equal((await call('GET', 'admin/seguimiento/reclamaciones/1', token(3))).status, 403);
    assert.equal((await call('GET', 'admin/seguimiento/reclamaciones/1', token(2))).status, 200);
    for (const id of [1, 2, 3]) assert.equal((await call('GET', 'admin/seguimiento/cotizaciones/1', token(id))).status, 403);
    // Archivar o anular con la ruta de edición: exige ambos permisos (hoy la coordinadora tiene los dos; la secretaria ninguno).
    assert.equal((await call('PUT', 'admin/cursos/1', token(2), { estado: 'archivado' })).status, 200);
    assert.equal((await call('PUT', 'admin/cursos/1', token(3), { estado: 'archivado' })).status, 403);
    assert.equal((await call('POST', 'admin/cotizaciones/1/estado', token(2), { estado: 'anulada', revision: 1 })).status, 201);
    assert.equal((await call('POST', 'admin/cotizaciones/1/estado', token(3), { estado: 'aceptada', revision: 1 })).status, 403);
    // PDF de la cotización: mismo permiso que el detalle. Secretaria, cuenta sin rol y sesión anónima nunca llegan al servicio.
    for (const id of [1, 2]) { const ok = await call('GET', 'admin/cotizaciones/1/pdf', token(id)); assert.equal(ok.status, 200); assert.ok(ok.reached); }
    for (const id of [3, 4, 6]) { const denied = await call('GET', 'admin/cotizaciones/1/pdf', token(id)); assert.equal(denied.status, 403); assert.equal(denied.reached, false); }
    const anonymous = await call('GET', 'admin/cotizaciones/1/pdf'); assert.equal(anonymous.status, 401); assert.equal(anonymous.reached, false);
    // Duplicar = crear una cotización nueva: exige cotizaciones:crear (gerente y coordinadora); secretaria, sin rol y anónimo nunca llegan al servicio.
    for (const id of [1, 2]) { const ok = await call('POST', 'admin/cotizaciones/1/duplicar', token(id), {}); assert.equal(ok.status, 201); assert.ok(ok.reached); }
    for (const id of [3, 4, 6]) { const denied = await call('POST', 'admin/cotizaciones/1/duplicar', token(id), {}); assert.equal(denied.status, 403); assert.equal(denied.reached, false); }
    const anonymousCopy = await call('POST', 'admin/cotizaciones/1/duplicar', undefined, {}); assert.equal(anonymousCopy.status, 401); assert.equal(anonymousCopy.reached, false);
  } finally { await app.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Los decoradores solo son metadatos: sin la guard registrada no protegen nada
// ---------------------------------------------------------------------------------------------------------------
// Hipótesis de reversión incompleta (no admitida): por eso registro y ACCESS_MODE van juntos (session-access.test.ts).
test('sin AccessGuard (reversión incompleta, no admitida) los decoradores no cambian nada: rige solo JwtAuthGuard', async () => {
  const { app, db, call } = await start(false);
  try {
    // Cualquier sesión válida, incluso sin rol, sigue entrando como hoy; sin sesión, 401; lo público sigue público.
    for (const id of [3, 4, 6]) {
      assert.equal((await call('GET', 'admin/users', token(id))).status, 200);
      assert.equal((await call('POST', 'admin/register', token(id), {})).status, 201);
      assert.equal((await call('GET', 'admin/cotizaciones', token(id))).status, 200);
    }
    assert.equal((await call('GET', 'admin/cotizaciones')).status, 401);
    assert.equal((await call('GET', 'admin/cotizaciones', token(5))).status, 401);
    assert.equal((await call('GET', 'cursos')).status, 200);
    db.state.reads = 0;
    await call('GET', 'admin/cursos', token(3));
    assert.equal(db.state.reads, 1, 'una sola lectura de la cuenta (JwtStrategy), como antes');
  } finally { await app.close(); }
});

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : []);
}

test('AccessGuard está registrada una sola vez, en AppModule, como APP_GUARD después de PublicRateLimitGuard (E3.6)', () => {
  const src = path.join(__dirname, '..', 'src');
  const code = (file: string) => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const appModule = code(path.join(src, 'app.module.ts'));
  // Orden de la lista = orden de ejecución de las guards globales: primero el límite de frecuencia, después la autorización.
  assert.deepEqual(appModule.match(/provide:\s*APP_GUARD[^}]*/g)?.map(text => text.replace(/\s+/g, ' ').trim()),
    ['provide: APP_GUARD, useClass: PublicRateLimitGuard', 'provide: APP_GUARD, useClass: AccessGuard']);
  // Dependencias de la guard como proveedores de AppModule; JwtStrategy sigue en AuthModule y no se duplica aquí.
  const providers = appModule.match(/providers:\s*\[([\s\S]*?)\]\s*,\s*imports:/)?.[1] ?? '';
  assert.match(providers, /^\s*JwtAuthGuard\s*,\s*AccountAccessService\s*,/);
  assert.ok(!/JwtStrategy/.test(appModule), 'JwtStrategy no se registra en AppModule');
  assert.match(code(path.join(src, 'admin/auth/auth.module.ts')), /providers:\s*\[[^\]]*\bJwtStrategy\b/);
  // Nadie más la registra ni la usa (ni @UseGuards ni otro APP_GUARD), y no hay interruptor por entorno.
  const users = sourceFiles(src).filter(file => /\b(AccessGuard|AccountAccessService)\b/.test(code(file))).map(file => path.relative(src, file).replace(/\\/g, '/')).sort();
  assert.deepEqual(users, ['app.module.ts', 'permissions/access.guard.ts']);
  assert.equal(sourceFiles(src).filter(file => /UseGuards\([^)]*AccessGuard/.test(code(file))).length, 0);
  assert.ok(!/process\.env/.test(appModule), 'el registro no depende de variables de entorno');
});
