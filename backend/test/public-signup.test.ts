import 'reflect-metadata';
import { mock, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { HttpException, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { AuthController } from '../src/admin/auth/auth.controller';
import { AccountsController } from '../src/admin/auth/accounts.controller';
import { AuthService, AUTH_UNAVAILABLE, PUBLIC_SIGNUP_REASON, SIGNUP_CREATED, SIGNUP_DUPLICATE } from '../src/admin/auth/auth.service';
import { AccountsService } from '../src/admin/auth/accounts.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { BCRYPT_COST } from '../src/admin/auth/password-security';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { PublicRateLimitGuard } from '../src/common/public-rate-limit.guard';
import { memoryBuckets } from './fixtures/rate-limit-memory';
import { createValidationPipe } from '../src/common/validation';
import { PrismaService } from '../src/database/prisma.service';
import { AccessGuard, AccountAccessService, FORBIDDEN_MESSAGE, NO_ROLE_MESSAGE } from '../src/permissions/access.guard';

// Registro público (POST /admin/signup), login de cuentas sin rol y con rol, y AccessGuard real registrada como APP_GUARD (igual que
// AppModule). Todo ficticio: cuentas en memoria, secreto de prueba, sin MySQL, sin correo y sin red fuera de 127.0.0.1.
// Se ejecuta con test/isolate-env.cjs (npm test).
const secret = 'isolated-public-signup-secret-32-characters';
const settings = { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined) };
const PASSWORD = 'Contraseña-ficticia-1';

type Row = { id: number; nombre: string; email: string; password: string; activo: boolean; session_version: number; rol: string | null };

function fakeDatabase() {
  const rows: Row[] = []; const audit: any[] = []; let sequence = 0;
  const state = { failWith: null as null | Error };
  const pick = (row: Row, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.keys(select).map(key => [key, (row as any)[key]])) : { ...row });
  const guard = () => { if (state.failWith) throw state.failWith; };
  const adminUser = {
    findFirst: async ({ where, select }: any) => { guard(); const row = rows.find(item => item.email === where.email); return row ? pick(row, select) : null; },
    findUnique: async ({ where, select }: any) => { guard(); const row = rows.find(item => item.id === where.id); return row ? pick(row, select) : null; },
    create: async ({ data, select }: any) => {
      guard();
      if (rows.some(row => row.email === data.email)) throw new PrismaClientKnownRequestError('Duplicate', { code: 'P2002', clientVersion: 'test' });
      // Como MySQL: `rol` no tiene valor por defecto (NULL) y `activo` vale 1 si no se indica.
      const row: Row = { id: ++sequence, activo: true, session_version: 1, rol: null, ...data }; rows.push(row); return pick(row, select);
    },
  };
  const client: any = { adminUser, adminAuditoria: { create: async ({ data }: any) => { audit.push({ ...data }); return data; } } };
  client.$transaction = async (run: (tx: any) => unknown) => {
    const saved = { rows: rows.map(row => ({ ...row })), audit: audit.length };
    try { return await run(client); } catch (error) { rows.splice(0, rows.length, ...saved.rows); audit.length = saved.audit; throw error; }
  };
  const seed = (nombre: string, email: string, rol: string | null) => {
    const row: Row = { id: ++sequence, nombre, email, password: bcrypt.hashSync(PASSWORD, 4), activo: true, session_version: 1, rol }; rows.push(row); return row;
  };
  return { rows, audit, state, client, seed };
}

async function start() {
  const db = fakeDatabase(); const reached: string[] = [];
  // AccountsService sustituido: basta con saber si una solicitud llegó al servicio (no debe llegar cuando AccessGuard la deniega).
  const accounts = Object.fromEntries(['forgot', 'reset', 'password', 'list', 'status'].map(name => [name, async () => { reached.push(name); return { ok: true, items: [] }; }]));
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } })],
    controllers: [AuthController, AccountsController],
    providers: [AuthService, JwtStrategy, JwtAuthGuard, AccountAccessService, { provide: APP_GUARD, useClass: AccessGuard },
      { provide: AccountsService, useValue: accounts }, { provide: ConfigService, useValue: settings }, { provide: PrismaService, useValue: db.client }],
  })
  class PublicSignupModule {}
  const app = await NestFactory.create(PublicSignupModule, { logger: false });
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const call = async (route: string, method = 'GET', body?: unknown, token?: string) => {
    reached.length = 0;
    const response = await fetch(url + '/admin/' + route, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json().catch(() => null) as any, reached: reached.length > 0 };
  };
  return { app, db, call };
}

const visitor = { nombre: 'Visitante Ficticia', email: 'visitante@example.test', password: PASSWORD };

test('registro público sin sesión: crea una cuenta activa, SIN rol, con hash seguro y auditada, sin devolver token ni datos', async () => {
  const { app, db, call } = await start();
  try {
    const created = await call('signup', 'POST', { ...visitor, email: '  Visitante@Example.TEST ' });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data, SIGNUP_CREATED);
    assert.deepEqual(Object.keys(created.data as object).sort(), ['mensaje', 'ok'], 'sin token, identificador ni datos de la cuenta');
    assert.equal(db.rows.length, 1);
    const [row] = db.rows;
    assert.equal(row.email, 'visitante@example.test', 'correo normalizado');
    assert.equal(row.nombre, 'Visitante Ficticia');
    assert.equal(row.rol, null, 'la cuenta nace sin rol');
    assert.equal(row.activo, true);
    assert.notEqual(row.password, PASSWORD);
    assert.equal(bcrypt.getRounds(row.password), BCRYPT_COST, 'mismo coste bcrypt que las demás contraseñas');
    assert.ok(await bcrypt.compare(PASSWORD, row.password));
    // Auditoría: autorregistro (sin actor), sin correo, nombre, contraseña ni token.
    assert.deepEqual(db.audit, [{ origen: 'panel', actor_id: null, cuenta_id: row.id, operacion: 'cuenta_creada', rol_anterior: null, rol_nuevo: null, activo_anterior: null, activo_nuevo: true, resultado: 'aplicado', motivo: PUBLIC_SIGNUP_REASON }]);
  } finally { await app.close(); }
});

test('registro público: correo duplicado (también con otra capitalización o espacios) responde 409 sin crear ni auditar', async () => {
  const { app, db, call } = await start();
  try {
    db.seed('Gerente Ficticia', 'gerente@example.test', 'GERENTE_GENERAL');
    for (const email of ['gerente@example.test', 'GERENTE@example.test', ' gerente@example.test ']) {
      const result = await call('signup', 'POST', { ...visitor, email });
      assert.equal(result.status, 409, email);
      assert.deepEqual(result.data, { ok: false, mensaje: SIGNUP_DUPLICATE });
    }
    assert.equal((await call('signup', 'POST', visitor)).status, 201);
    assert.equal((await call('signup', 'POST', visitor)).status, 409, 'una segunda alta con el mismo correo');
    assert.equal(db.rows.length, 2); assert.equal(db.audit.length, 1);
    assert.equal(db.rows[0].rol, 'GERENTE_GENERAL', 'la cuenta existente no se modifica');
    // Carrera: si dos altas pasan la comprobación previa a la vez, la restricción UNIQUE de la base decide y también responde 409.
    const original = db.client.adminUser.findFirst; db.client.adminUser.findFirst = async () => null;
    try { assert.equal((await call('signup', 'POST', visitor)).status, 409); } finally { db.client.adminUser.findFirst = original; }
    assert.equal(db.rows.length, 2); assert.equal(db.audit.length, 1, 'la transacción fallida no deja auditoría');
  } finally { await app.close(); }
});

test('registro público: datos inválidos se rechazan con 400 antes de crear nada', async () => {
  const { app, db, call } = await start();
  try {
    const invalid: unknown[] = [
      {}, { ...visitor, password: undefined }, { ...visitor, password: '1234567' }, { ...visitor, password: 'x'.repeat(73) },
      { ...visitor, password: 'ñ'.repeat(37) }, // 37 caracteres pero 74 bytes UTF-8: supera el límite de bcrypt
      { ...visitor, password: 12345678 }, { ...visitor, email: 'no-es-un-correo' }, { ...visitor, email: '' },
      { ...visitor, email: 'a'.repeat(250) + '@example.test' }, { ...visitor, nombre: '' }, { ...visitor, nombre: '   ' },
      { ...visitor, nombre: 'n'.repeat(101) }, { ...visitor, website: 42 }, [visitor], 'texto',
    ];
    for (const body of invalid) assert.equal((await call('signup', 'POST', body)).status, 400, JSON.stringify(body)?.slice(0, 60));
    assert.equal(db.rows.length, 0); assert.equal(db.audit.length, 0);
    // Contraseñas límite válidas: 8 caracteres y 72 bytes.
    assert.equal((await call('signup', 'POST', { ...visitor, password: '12345678' })).status, 201);
    assert.equal((await call('signup', 'POST', { ...visitor, email: 'otra@example.test', password: 'ñ'.repeat(36) })).status, 201);
  } finally { await app.close(); }
});

test('registro público: nadie puede asignarse un rol ni otros campos privilegiados (400, sin cuenta creada)', async () => {
  const { app, db, call } = await start();
  try {
    const privileged = [
      { rol: 'GERENTE_GENERAL' }, { rol: 'COORDINADORA_INSTITUCIONAL' }, { rol: 'SECRETARIA' }, { rol: null }, { role: 'GERENTE_GENERAL' },
      { permisos: ['cuentas:crear'] }, { activo: true }, { id: 1 }, { session_version: 99 }, { admin: true }, { acceso: { modo: 'heredado' } },
    ];
    for (const extra of privileged) {
      const result = await call('signup', 'POST', { ...visitor, ...extra });
      assert.equal(result.status, 400, JSON.stringify(extra));
      assert.equal(result.data?.token, undefined);
    }
    assert.equal(db.rows.length, 0); assert.equal(db.audit.length, 0);
  } finally { await app.close(); }
});

test('registro público: el campo trampa relleno recibe la misma respuesta pero no crea cuenta', async () => {
  const { app, db, call } = await start();
  try {
    const bot = await call('signup', 'POST', { ...visitor, website: 'https://spam.example.test' });
    assert.equal(bot.status, 201);
    assert.deepEqual(bot.data, SIGNUP_CREATED);
    assert.equal(db.rows.length, 0); assert.equal(db.audit.length, 0);
    assert.equal((await call('signup', 'POST', { ...visitor, website: '' })).status, 201, 'vacío: registro normal');
    assert.equal(db.rows.length, 1);
  } finally { await app.close(); }
});

test('login: credenciales incorrectas siguen respondiendo 401 con el mensaje genérico', async () => {
  const { app, db, call } = await start();
  try {
    db.seed('Sin Rol', 'sinrol@example.test', null);
    for (const body of [{ email: 'sinrol@example.test', password: 'Otra-contraseña-1' }, { email: 'nadie@example.test', password: PASSWORD }]) {
      const result = await call('login', 'POST', body);
      assert.equal(result.status, 401);
      assert.deepEqual(result.data, { ok: false, mensaje: 'Credenciales incorrectas.' });
    }
  } finally { await app.close(); }
});

test('cuenta registrada públicamente: inicia sesión sin rol ni permisos y AccessGuard le deniega toda ruta administrativa', async () => {
  const { app, db, call } = await start();
  try {
    db.seed('Gerente Ficticia', 'gerente@example.test', 'GERENTE_GENERAL');
    assert.equal((await call('signup', 'POST', visitor)).status, 201);
    const login = await call('login', 'POST', { email: visitor.email, password: PASSWORD });
    assert.equal(login.status, 200);
    assert.ok(login.data.token);
    assert.deepEqual(login.data.user, { id: db.rows[1].id, nombre: visitor.nombre, email: visitor.email, rol: null, permisos: [] });
    assert.deepEqual(login.data.acceso, { modo: 'por_roles' });
    const token = login.data.token;
    // Autoservicio permitido a cualquier sesión válida.
    const me = await call('me', 'GET', undefined, token);
    assert.equal(me.status, 200); assert.equal(me.data.user.rol, null); assert.deepEqual(me.data.user.permisos, []);
    // Rutas con permiso: 403 con el mensaje de cuenta sin rol, sin llegar al servicio (no se exponen cuentas ni se crean administradores).
    for (const [route, method, body] of [['users', 'GET', undefined], ['users/1', 'PUT', { activo: false }], ['register', 'POST', { nombre: 'Otra', email: 'otra@example.test', password: PASSWORD }]] as const) {
      const denied = await call(route, method, body, token);
      assert.equal(denied.status, 403, method + ' ' + route);
      assert.deepEqual(denied.data, { ok: false, mensaje: NO_ROLE_MESSAGE });
      assert.equal(denied.reached, false, method + ' ' + route + ' no llega al servicio');
    }
    assert.equal(db.rows.length, 2, 'la cuenta sin rol no pudo crear otra');
    assert.equal(db.rows[1].rol, null, 'el rol sigue vacío');
  } finally { await app.close(); }
});

test('rutas administrativas sin sesión responden 401; una cuenta con rol válido conserva sus permisos', async () => {
  const { app, db, call } = await start();
  try {
    db.seed('Gerente Ficticia', 'gerente@example.test', 'GERENTE_GENERAL');
    db.seed('Secretaria Ficticia', 'secretaria@example.test', 'SECRETARIA');
    for (const [route, method] of [['me', 'GET'], ['users', 'GET'], ['users/1', 'PUT'], ['register', 'POST'], ['password', 'POST']] as const) {
      const result = await call(route, method, method === 'GET' ? undefined : {});
      assert.equal(result.status, 401, method + ' ' + route + ' sin sesión'); assert.equal(result.reached, false);
    }
    const gerente = (await call('login', 'POST', { email: 'gerente@example.test', password: PASSWORD })).data;
    assert.equal(gerente.user.rol, 'GERENTE_GENERAL'); assert.ok(gerente.user.permisos.includes('cuentas:leer'));
    const listed = await call('users', 'GET', undefined, gerente.token);
    assert.equal(listed.status, 200); assert.equal(listed.reached, true, 'el gerente sí llega al listado de cuentas');
    const secretaria = (await call('login', 'POST', { email: 'secretaria@example.test', password: PASSWORD })).data;
    assert.equal(secretaria.user.rol, 'SECRETARIA'); assert.equal(secretaria.user.permisos.includes('cuentas:leer'), false);
    const denied = await call('users', 'GET', undefined, secretaria.token);
    assert.equal(denied.status, 403); assert.deepEqual(denied.data, { ok: false, mensaje: FORBIDDEN_MESSAGE }); assert.equal(denied.reached, false);
  } finally { await app.close(); }
});

test('base sin la estructura esperada (migraciones pendientes): login y registro responden 503 neutro, sin detalles internos', async () => {
  const { app, db, call } = await start();
  try {
    db.seed('Sin Rol', 'sinrol@example.test', null);
    for (const code of ['P2022', 'P2021']) {
      db.state.failWith = new PrismaClientKnownRequestError('The column `horus_db.admin_users.rol` does not exist in the current database.', { code, clientVersion: 'test' });
      for (const [route, body] of [['login', { email: 'sinrol@example.test', password: PASSWORD }], ['signup', visitor]] as const) {
        const result = await call(route, 'POST', body);
        assert.equal(result.status, 503, code + ' ' + route);
        assert.deepEqual(result.data, { ok: false, mensaje: AUTH_UNAVAILABLE });
        assert.doesNotMatch(JSON.stringify(result.data), /column|horus_db|admin_users|rol`|P20/i);
      }
    }
    // Cualquier otro error interno sigue siendo un 500 sin texto del servidor.
    db.state.failWith = new Error('fallo interno con detalle sensible');
    const other = await call('login', 'POST', { email: 'sinrol@example.test', password: PASSWORD });
    assert.equal(other.status, 500); assert.doesNotMatch(JSON.stringify(other.data), /sensible/);
    db.state.failWith = null;
    assert.equal(db.rows.length, 1); assert.equal(db.audit.length, 0);
  } finally { await app.close(); }
});

// ---- Límites de frecuencia del registro público ----
function limiter() {
  const { prisma } = memoryBuckets();
  const guard = new PublicRateLimitGuard(prisma);
  const call = (path: string, ip = '203.0.113.1') => guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method: 'POST', path, ip, socket: { remoteAddress: ip } }) }) } as any);
  return { call };
}
const tooMany = (error: unknown) => error instanceof HttpException && error.getStatus() === 429;

test('registro público: 3 por minuto y 10 por hora por IP, y un tope global de 30 por minuto', async t => {
  const clock = { now: Date.UTC(2026, 9, 16, 10, 0, 5) };
  mock.method(Date, 'now', () => clock.now);
  t.after(() => mock.restoreAll());
  const l = limiter();
  for (let i = 0; i < 3; i++) assert.equal(await l.call('/api/admin/signup'), true);
  await assert.rejects(() => l.call('/api/admin/signup'), tooMany, 'cuarto intento en el mismo minuto');
  await assert.rejects(() => l.call('/API/admin/signup/'), tooMany, 'variantes de la ruta comparten cubo');
  assert.equal(await l.call('/api/admin/signup', '203.0.113.2'), true, 'otra IP tiene su propio cubo');
  // Tope por hora: aunque cada minuto respete el límite, la misma IP no supera 10 intentos en la hora.
  const h = limiter(); let accepted = 0;
  for (let minute = 0; minute < 6; minute++) {
    clock.now = Date.UTC(2026, 9, 16, 11, minute, 5);
    for (let i = 0; i < 3; i++) { try { await h.call('/api/admin/signup', '198.51.100.7'); accepted++; } catch (error) { assert.ok(tooMany(error)); } }
  }
  assert.equal(accepted, 10);
  clock.now = Date.UTC(2026, 9, 16, 12, 0, 5);
  assert.equal(await h.call('/api/admin/signup', '198.51.100.7'), true, 'la hora siguiente vuelve a admitir');
  // Tope global: 30 por minuto entre todas las IP; el login conserva su propia cuota.
  const g = limiter(); let blocked = 0;
  clock.now = Date.UTC(2026, 9, 16, 13, 0, 5);
  for (let i = 0; i < 35; i++) { try { await g.call('/api/admin/signup', '192.0.2.' + i); } catch (error) { assert.ok(tooMany(error)); blocked++; } }
  assert.equal(blocked, 5);
  assert.equal(await g.call('/api/admin/login', '192.0.2.200'), true, 'un registro masivo no agota la cuota del login');
});
