import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as bcrypt from 'bcryptjs';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from '../src/admin/auth/auth.controller';
import { AuthService } from '../src/admin/auth/auth.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { MessagesController } from '../src/admin/messages/messages.controller';
import { MessagesService } from '../src/admin/messages/messages.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { PrismaService } from '../src/database/prisma.service';
import { AccessGuard, AccountAccessService, FORBIDDEN_MESSAGE, NO_ROLE_MESSAGE } from '../src/permissions/access.guard';
import { permissionsOf } from '../src/permissions/policy';
import { ACCESS_MODE, sessionAccess } from '../src/permissions/session-access';

// E3.4.1: contrato de GET /admin/me y del login (rol vigente, permisos y modo de acceso). Controladores, estrategia JWT y servicio de
// autenticación reales; cuentas en memoria, sin MySQL, sin correo y sin red fuera de 127.0.0.1. Secreto y contraseñas ficticios.
const secret = 'isolated-session-access-secret-32-characters!';
const settings = { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined) };
const jwt = new JwtService({ secret, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } });
const PASSWORD = 'Contraseña-ficticia-E341';
const HASH = bcrypt.hashSync(PASSWORD, 4); // coste bajo: solo prueba el contrato, no el endurecimiento (auth-hardening.test.ts)
const VERSION = 7; // distinto de 1 para detectar si se filtrara session_version

type Row = { id: number; nombre: string; email: string; password: string; activo: boolean; session_version: number; rol: string | null };

function accounts() {
  const row = (id: number, nombre: string, rol: string | null, activo = true): Row =>
    ({ id, nombre, email: 'cuenta' + id + '@example.test', password: HASH, activo, session_version: VERSION, rol });
  const rows: Row[] = [
    row(1, 'Gerente', 'GERENTE_GENERAL'), row(2, 'Coordinadora', 'COORDINADORA_INSTITUCIONAL'), row(3, 'Secretaria', 'SECRETARIA'),
    row(4, 'Sin rol', null), row(5, 'Inactiva', 'GERENTE_GENERAL', false), row(6, 'Rol extraño', 'ADMINISTRADOR'),
  ];
  const state = { reads: 0 };
  const pick = (found: Row | undefined, select?: Record<string, boolean>) =>
    !found ? null : select ? Object.fromEntries(Object.keys(select).map(key => [key, (found as any)[key]])) : { ...found };
  const adminUser = {
    findUnique: async ({ where, select }: any) => { state.reads++; return pick(rows.find(candidate => candidate.id === where.id), select); },
    findFirst: async ({ where }: any) => { state.reads++; return pick(rows.find(candidate => candidate.email === where.email)); },
  };
  return { rows, state, client: { adminUser } };
}

const token = (id: number, extra: object = {}) => jwt.sign({ id, email: 'cuenta' + id + '@example.test', version: VERSION, ...extra });
const ROLES: [number, string][] = [[1, 'GERENTE_GENERAL'], [2, 'COORDINADORA_INSTITUCIONAL'], [3, 'SECRETARIA']];

// withAccessGuard (por defecto): replica la composición de AppModule desde E3.6 (AccessGuard global). `false` solo sirve para la
// hipótesis de una reversión incompleta (guard retirada sin volver al modo heredado), que no es una configuración admitida.
async function start(withAccessGuard = true) {
  const db = accounts(); const calls: string[] = [];
  const messages = { create: async () => { calls.push('create'); return { ok: true }; }, remove: async () => { calls.push('remove'); return { ok: true }; } };
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [AuthController, MessagesController],
    providers: [AuthService, JwtStrategy, JwtAuthGuard, AccountAccessService,
      ...(withAccessGuard ? [{ provide: APP_GUARD, useClass: AccessGuard }] : []),
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: settings },
      { provide: PrismaService, useValue: db.client }, { provide: MessagesService, useValue: messages }],
  })
  class SessionAccessTestModule {}
  const app = await NestFactory.create(SessionAccessTestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const call = async (method: string, route: string, auth?: string, body?: object, headers: Record<string, string> = {}) => {
    calls.length = 0;
    const response = await fetch(url + '/' + route, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, text, data: (() => { try { return JSON.parse(text); } catch { return null; } })() as any, reached: calls.length > 0 };
  };
  return { app, db, call };
}

const expectedMe = (id: number, nombre: string, rol: string | null) => ({
  ok: true,
  user: { id, nombre, email: 'cuenta' + id + '@example.test', rol, permisos: rol ? permissionsOf(rol) : [] },
  acceso: { modo: 'por_roles' },
});

// ---------------------------------------------------------------------------------------------------------------
// Función pura
// ---------------------------------------------------------------------------------------------------------------
test('sessionAccess: rol reconocido con sus permisos; null, desconocido u otro tipo sin permisos', () => {
  for (const [, rol] of ROLES) assert.deepEqual(sessionAccess(rol), { rol, permisos: permissionsOf(rol) });
  for (const rol of [null, undefined, '', 'ADMINISTRADOR', 'gerente_general', ' SECRETARIA', 1, {}, ['GERENTE_GENERAL']]) {
    assert.deepEqual(sessionAccess(rol), { rol: null, permisos: [] }, JSON.stringify(rol));
  }
  // La lista entregada es una copia: modificarla no altera la matriz.
  const view = sessionAccess('SECRETARIA');
  view.permisos.push('cuentas:crear');
  assert.ok(!sessionAccess('SECRETARIA').permisos.includes('cuentas:crear'));
});

// ---------------------------------------------------------------------------------------------------------------
// GET /admin/me
// ---------------------------------------------------------------------------------------------------------------
test('GET /admin/me: cada rol recibe su rol vigente, sus permisos exactos y el modo por_roles, sin lecturas extra para el rol', async () => {
  const { app, db, call } = await start();
  try {
    for (const [id, rol] of ROLES) {
      db.state.reads = 0;
      const me = await call('GET', 'admin/me', token(id));
      assert.equal(me.status, 200, rol);
      assert.deepEqual(me.data, expectedMe(id, db.rows[id - 1].nombre, rol), rol);
      // Dos lecturas de JwtStrategy: la de AccessGuard (ruta «autenticada») y la del JwtAuthGuard local, que aporta el rol.
      // La consulta repetida se conserva a propósito en E3.6 (optimización pendiente); el rol no añade una tercera.
      assert.equal(db.state.reads, 2, 'JwtStrategy en AccessGuard y en el JwtAuthGuard local: ' + rol);
    }
    assert.ok((await call('GET', 'admin/me', token(1))).data.user.permisos.includes('cuentas:asignar_rol'));
    assert.ok(!(await call('GET', 'admin/me', token(3))).data.user.permisos.includes('mensajes:eliminar'));
  } finally { await app.close(); }
});

test('GET /admin/me: una cuenta sin rol, o con un valor desconocido en la base, responde 200 con rol null y sin permisos', async () => {
  const { app, call } = await start();
  try {
    assert.deepEqual((await call('GET', 'admin/me', token(4))).data, expectedMe(4, 'Sin rol', null));
    const unknown = await call('GET', 'admin/me', token(6));
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.data, expectedMe(6, 'Rol extraño', null));
  } finally { await app.close(); }
});

test('GET /admin/me: solo campos de la lista blanca; nunca contraseña, hash, session_version ni estado interno', async () => {
  const { app, call } = await start();
  try {
    for (const id of [1, 4, 6]) {
      const me = await call('GET', 'admin/me', token(id));
      assert.deepEqual(Object.keys(me.data).sort(), ['acceso', 'ok', 'user']);
      assert.deepEqual(Object.keys(me.data.user).sort(), ['email', 'id', 'nombre', 'permisos', 'rol']);
      assert.deepEqual(Object.keys(me.data.acceso), ['modo']);
      assert.ok(!me.text.includes(HASH) && !/password|session_version|activo|\$2[aby]\$/i.test(me.text), 'sin datos sensibles');
      assert.ok(!me.text.includes(String(VERSION) + ','), 'sin la versión de sesión');
    }
  } finally { await app.close(); }
});

test('GET /admin/me: el rol sale de la base; el que viaje en el JWT, en cabeceras o en la consulta no cuenta', async () => {
  const { app, db, call } = await start();
  try {
    const forged = token(3, { rol: 'GERENTE_GENERAL', role: 'GERENTE_GENERAL', permisos: ['cuentas:crear'] });
    const headers = { 'X-Rol': 'GERENTE_GENERAL', 'X-Role': 'GERENTE_GENERAL', 'X-Permisos': 'cuentas:crear' };
    assert.deepEqual((await call('GET', 'admin/me?rol=GERENTE_GENERAL&permisos=cuentas:crear', forged, undefined, headers)).data, expectedMe(3, 'Secretaria', 'SECRETARIA'));
    // Un token sin rol de una cuenta sin rol tampoco se «completa» con nada enviado por el cliente.
    assert.deepEqual((await call('GET', 'admin/me', token(4, { rol: 'SECRETARIA' }), undefined, headers)).data, expectedMe(4, 'Sin rol', null));
    // El estado vigente manda: un cambio en la base se refleja en la siguiente solicitud con el mismo token.
    db.rows[2].rol = 'COORDINADORA_INSTITUCIONAL';
    assert.deepEqual((await call('GET', 'admin/me', forged)).data, expectedMe(3, 'Secretaria', 'COORDINADORA_INSTITUCIONAL'));
    db.rows[2].rol = null;
    assert.deepEqual((await call('GET', 'admin/me', forged)).data, expectedMe(3, 'Secretaria', null));
  } finally { await app.close(); }
});

test('GET /admin/me: 401 sin sesión válida (ausente, mal formada, caducada, firma ajena, cuenta inexistente o desactivada, sesión revocada); nunca 403', async () => {
  const { app, db, call } = await start();
  try {
    db.rows[1].session_version = VERSION + 1; // la sesión de la coordinadora quedó revocada
    const invalid = [undefined, 'basura', 'a.b.c', jwt.sign({ id: 3, version: VERSION }, { expiresIn: -10 }),
      new JwtService({ secret: 'another-secret-with-at-least-32-characters' }).sign({ id: 3, version: VERSION }, { issuer: 'horus-api', audience: 'horus-panel' }),
      jwt.sign({ id: 3, version: VERSION }, { audience: 'horus-password-reset' }), token(999), token(5), token(2)];
    for (const session of invalid) {
      const result = await call('GET', 'admin/me', session);
      assert.equal(result.status, 401, String(session).slice(0, 12));
      assert.equal(result.data?.user, undefined, 'sin datos de la cuenta');
    }
  } finally { await app.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------------------------------------------
test('login: conserva sus campos, añade rol, permisos y modo, y el JWT sigue sin rol ni permisos', async () => {
  const { app, call } = await start();
  try {
    for (const [id, nombre, rol] of [[1, 'Gerente', 'GERENTE_GENERAL'], [3, 'Secretaria', 'SECRETARIA'], [4, 'Sin rol', null], [6, 'Rol extraño', null]] as [number, string, string | null][]) {
      const login = await call('POST', 'admin/login', undefined, { email: 'cuenta' + id + '@example.test', password: PASSWORD });
      assert.equal(login.status, 200, nombre);
      const { token: issued, ...rest } = login.data;
      assert.deepEqual(rest, { ok: true, mensaje: 'Login correcto.', ...expectedMe(id, nombre, rol) }, nombre);
      const payload = jwt.verify(issued, { issuer: 'horus-api', audience: 'horus-panel' }) as Record<string, unknown>;
      assert.deepEqual(Object.keys(payload).sort(), ['aud', 'email', 'exp', 'iat', 'id', 'iss', 'version'], 'carga útil del JWT sin cambios');
      assert.ok(!/password|session_version|\$2[aby]\$/i.test(login.text), 'sin datos sensibles');
      // El token emitido sirve para /admin/me con la misma información de acceso.
      assert.deepEqual((await call('GET', 'admin/me', issued)).data, expectedMe(id, nombre, rol));
    }
    // Credenciales incorrectas y cuenta desactivada: misma respuesta que antes, sin información de acceso.
    for (const body of [{ email: 'cuenta3@example.test', password: 'otra-contraseña' }, { email: 'cuenta5@example.test', password: PASSWORD }, { email: 'nadie@example.test', password: PASSWORD }]) {
      const failed = await call('POST', 'admin/login', undefined, body);
      assert.equal(failed.status, 401);
      assert.deepEqual(failed.data, { ok: false, mensaje: 'Credenciales incorrectas.' });
    }
  } finally { await app.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Modo de acceso y guard
// ---------------------------------------------------------------------------------------------------------------
const code = (file: string) => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC = path.join(__dirname, '..', 'src');

// Coherencia entre el registro de la guard y el modo anunciado, aplicada a un texto de app.module.ts. Se aplica también a las dos
// configuraciones incoherentes (falsa garantía y guard activa anunciando «heredado») para demostrar que la prueba las detecta.
const registersAccessGuard = (source: string) => /provide:\s*APP_GUARD\s*,\s*(useClass|useExisting)\s*:\s*AccessGuard\b/.test(source);
const coherent = (source: string, mode: string) => (mode === 'por_roles') === registersAccessGuard(source);

test('el modo declarado coincide con el registro real de AccessGuard: «por_roles» porque AppModule la registra (E3.6)', () => {
  const appModule = code(path.join(SRC, 'app.module.ts'));
  const registered = registersAccessGuard(appModule);
  assert.equal(registered, true, 'E3.6 registra la guard en AppModule');
  const mode = ACCESS_MODE as string; // tipo amplio: la comparación sigue siendo válida si una reversión cambia el valor
  // En ambos sentidos: declarar «por_roles» sin registrar la guard (falsa garantía) o registrarla sin declararlo hace fallar esta prueba.
  assert.equal(mode === 'por_roles', registered);
  assert.ok(coherent(appModule, mode));
  assert.equal(mode, 'por_roles');
  // Las dos configuraciones incoherentes se detectan.
  const withoutGuard = appModule.replace(/\{\s*provide:\s*APP_GUARD\s*,\s*useClass:\s*AccessGuard\s*\}\s*,?/, '');
  assert.notEqual(withoutGuard, appModule, 'la regla localiza el registro real');
  assert.equal(coherent(withoutGuard, 'por_roles'), false, '«por_roles» sin guard registrada: falsa garantía');
  assert.equal(coherent(appModule, 'heredado'), false, 'guard registrada anunciando «heredado»');
  assert.equal(coherent(withoutGuard, 'heredado'), true, 'reversión completa: coherente');
  // Sin interruptores: ni el registro ni el modo dependen de variables de entorno.
  for (const file of ['app.module.ts', 'permissions/session-access.ts', 'permissions/access.guard.ts']) {
    assert.equal(/process\.env|ConfigService|configService/.test(code(path.join(SRC, file))), false, file + ' no lee configuración para la guard o el modo');
  }
  assert.match(code(path.join(SRC, 'permissions/session-access.ts')), /export const ACCESS_MODE: AccessMode = 'por_roles';/);
  // El modo se declara en un único lugar: ningún otro archivo escribe el valor a mano.
  const literal = (file: string) => /['"](heredado|por_roles)['"]/.test(code(file));
  for (const file of ['admin/auth/auth.controller.ts', 'admin/auth/auth.service.ts']) assert.equal(literal(path.join(SRC, file)), false, file);
});

test('con AccessGuard global (como AppModule): /admin/me sigue abierto sin rol y POST /admin/messages exige mensajes:crear', async () => {
  const { app, call } = await start(true);
  try {
    assert.equal((await call('GET', 'admin/me', token(4))).status, 200, 'autoservicio sin rol');
    for (const id of [1, 2, 3]) {
      const created = await call('POST', 'admin/messages', token(id), { nombre: 'Persona', email: 'p@example.test', asunto: 'Consulta', mensaje: 'Texto' });
      assert.equal(created.status, 201, 'registrar consulta: ' + id);
      assert.equal(created.reached, true);
    }
    for (const id of [2, 3]) {
      const removed = await call('DELETE', 'admin/messages/1', token(id));
      assert.equal(removed.status, 403, 'eliminar consulta: ' + id);
      assert.equal(removed.data.mensaje, FORBIDDEN_MESSAGE);
      assert.equal(removed.reached, false);
    }
    assert.equal((await call('DELETE', 'admin/messages/1', token(1))).status, 200);
    const noRole = await call('POST', 'admin/messages', token(4), {});
    assert.equal(noRole.status, 403);
    assert.equal(noRole.data.mensaje, NO_ROLE_MESSAGE);
    assert.equal((await call('POST', 'admin/messages', undefined, {})).status, 401);
    assert.equal((await call('POST', 'admin/messages', token(5), {})).status, 401);
  } finally { await app.close(); }
});

// Hipótesis de reversión incompleta (no admitida): retirar la guard deja a cualquier sesión válida usar las rutas. Por eso la reversión
// devuelve también ACCESS_MODE a «heredado» y la prueba de coherencia anterior lo exige.
test('sin AccessGuard (reversión incompleta, no admitida) los decoradores no protegen: cualquier sesión válida usa las rutas', async () => {
  const { app, call } = await start(false);
  try {
    for (const id of [3, 4, 6]) {
      assert.equal((await call('POST', 'admin/messages', token(id), {})).status, 201);
      assert.equal((await call('DELETE', 'admin/messages/1', token(id))).status, 200);
    }
    assert.equal((await call('DELETE', 'admin/messages/1')).status, 401);
  } finally { await app.close(); }
});
