import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, Module, NotFoundException } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { AccountsController } from '../src/admin/auth/accounts.controller';
import { AccountsService } from '../src/admin/auth/accounts.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { AccountState, ESCALATION_MESSAGE, INACTIVE_ROLE_MESSAGE, LAST_GERENTE_ROLE_MESSAGE, SELF_ROLE_MESSAGE, STALE_ROLE_MESSAGE, planRoleChange } from '../src/admin/auth/account-rules';
import { ACCOUNTS_BUSY_MESSAGE } from '../src/admin/auth/account-locks';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { createValidationPipe } from '../src/common/validation';
import { PrismaService } from '../src/database/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { AccessGuard, AccountAccessService, FORBIDDEN_MESSAGE, NO_ROLE_MESSAGE } from '../src/permissions/access.guard';

// «Roles y usuarios»: cambio de rol desde el panel (PUT /admin/users/:id/rol) y listado (GET /admin/users). Todo ficticio y en memoria:
// sin MySQL, sin correo, sin red fuera de 127.0.0.1 y con un secreto de prueba. Se ejecuta con test/isolate-env.cjs (npm test).
const G = 'GERENTE_GENERAL', K = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const acc = (id: number, activo: boolean, rol: AccountState['rol']): AccountState => ({ id, activo, rol });
const conflict = (message: string) => (error: unknown) => error instanceof ConflictException && (error.getResponse() as any).message === message;
const forbidden = (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as any).message === ESCALATION_MESSAGE;

// ---- Reglas (funciones puras) ----
test('reglas: nadie cambia su propio rol, cuenta inexistente, rol desactualizado y petición sin cambio', () => {
  const accounts = [acc(1, true, G), acc(2, true, K), acc(3, true, null)];
  assert.throws(() => planRoleChange(accounts, 1, S, G, 1), conflict(SELF_ROLE_MESSAGE));
  assert.throws(() => planRoleChange(accounts, 99, S, null, 1), NotFoundException);
  assert.throws(() => planRoleChange(accounts, 2, S, null, 1), conflict(STALE_ROLE_MESSAGE), 'el panel mostraba «sin rol» pero ya era coordinadora');
  assert.throws(() => planRoleChange(accounts, 2, K, S, 1), conflict(STALE_ROLE_MESSAGE), 'tampoco se da por bueno si el destino coincide');
  assert.deepEqual(planRoleChange(accounts, 2, K, K, 1), { changed: false, mensaje: 'La cuenta ya tiene ese rol. No se hicieron cambios.' });
});

test('reglas: asignar, cambiar y retirar roles de cuentas activas; las desactivadas no', () => {
  const accounts = [acc(1, true, G), acc(2, true, null), acc(3, true, S), acc(4, false, null)];
  const assigned = planRoleChange(accounts, 2, S, null, 1);
  assert.ok(assigned.changed); assert.deepEqual([assigned.before, assigned.after, assigned.operacion], [acc(2, true, null), acc(2, true, S), 'rol_asignado']);
  const changed = planRoleChange(accounts, 3, K, S, 1);
  assert.ok(changed.changed && changed.operacion === 'rol_asignado' && changed.after.rol === K);
  const removed = planRoleChange(accounts, 3, null, S, 1);
  assert.ok(removed.changed && removed.operacion === 'rol_retirado' && removed.after.rol === null);
  assert.throws(() => planRoleChange(accounts, 4, S, null, 1), conflict(INACTIVE_ROLE_MESSAGE));
  // Dar GERENTE_GENERAL a otra cuenta activa es posible para un gerente (el panel lo confirma antes de enviarlo).
  assert.ok(planRoleChange(accounts, 2, G, null, 1).changed);
});

test('reglas: siempre queda al menos un GERENTE_GENERAL activo', () => {
  // Dos gerentes activos: uno puede retirar o cambiar el rol del otro (queda quien actúa).
  assert.ok(planRoleChange([acc(1, true, G), acc(2, true, G)], 2, null, G, 1).changed);
  assert.ok(planRoleChange([acc(1, true, G), acc(2, true, G)], 2, K, G, 1).changed);
  // El gerente que queda no puede quitarse el rol: es su propia cuenta (nadie cambia su propio rol).
  assert.throws(() => planRoleChange([acc(1, true, G), acc(2, true, K)], 1, null, G, 1), conflict(SELF_ROLE_MESSAGE));
  // Un gerente desactivado no cuenta ni puede actuar; una cuenta sin rol tampoco.
  assert.throws(() => planRoleChange([acc(1, false, G), acc(2, true, G)], 2, null, G, 1), forbidden);
  assert.throws(() => planRoleChange([acc(1, true, null), acc(2, true, G)], 2, null, G, 1), forbidden);
  // Con la matriz actual quien actúa es siempre un gerente activo, así que la regla del último gerente es una defensa adicional (y la
  // comprobación final releída de la base, assertInvariants, la tercera). Su mensaje existe y es el que se usaría.
  assert.match(LAST_GERENTE_ROLE_MESSAGE, /único GERENTE_GENERAL activo/);
});

test('reglas anti-escalamiento: solo se concede o retira un rol cuyos permisos tenga la cuenta que actúa', () => {
  // Hoy solo el gerente tiene cuentas:asignar_rol. Si la matriz cambiara, una coordinadora con ese permiso no podría dar ni quitar GERENTE.
  assert.throws(() => planRoleChange([acc(1, true, K), acc(2, true, null)], 2, G, null, 1), forbidden);
  assert.throws(() => planRoleChange([acc(1, true, K), acc(2, true, G), acc(3, true, G)], 2, null, G, 1), forbidden);
  assert.throws(() => planRoleChange([acc(1, true, S), acc(2, true, null)], 2, K, null, 1), forbidden, 'la secretaria tiene menos permisos que la coordinadora');
  assert.ok(planRoleChange([acc(1, true, K), acc(2, true, null), acc(9, true, G)], 2, S, null, 1).changed, 'S ⊂ K: permitido por la regla (la ruta seguiría exigiendo cuentas:asignar_rol)');
  // Una cuenta sin rol, desactivada o inexistente no actúa.
  for (const actor of [[acc(1, true, null)], [acc(1, false, G)], []]) assert.throws(() => planRoleChange([...actor, acc(2, true, null), acc(9, true, G)], 2, S, null, 1), forbidden);
});

// ---- Servicio con base simulada (bloqueo de todas las filas, transacción y auditoría) ----
type Row = { id: number; nombre: string; email: string; password: string; activo: boolean; rol: string | null; session_version: number; createdAt: Date };
type Options = { failAudit?: boolean; nowaitAlways?: boolean };
function mysqlNowait() {
  const adapter = Object.assign(new Error('simulado'), { name: 'DriverAdapterError', cause: { originalCode: '3572', originalMessage: 'simulado', kind: 'mysql', code: 3572, message: 'simulado', state: 'HY000' } });
  return new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `3572`.', { code: 'P2010', clientVersion: '6.19.3', meta: { driverAdapterError: adapter } });
}
function database(initial: Partial<Row>[], options: Options = {}) {
  const rows: Row[] = initial.map((row, i) => ({ id: i + 1, nombre: 'Persona ' + (i + 1), email: 'persona' + (i + 1) + '@example.test', password: '$2a$04$hash-ficticio-' + (i + 1), activo: true, rol: null, session_version: 1, createdAt: new Date('2026-10-01T10:00:00Z'), ...row }));
  const audit: any[] = [], queries: string[] = [];
  const pick = (row: Row, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.keys(select).map(key => [key, (row as any)[key]])) : { ...row });
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      queries.push(strings.join('?'));
      if (options.nowaitAlways) throw mysqlNowait();
      return rows.map(row => ({ id: row.id, activo: row.activo ? 1 : 0, rol: row.rol }));
    },
    adminUser: {
      updateMany: async ({ where, data }: any) => {
        const found = rows.filter(row => row.id === where.id && row.activo === where.activo && (where.rol === undefined || row.rol === where.rol));
        for (const row of found) { if ('rol' in data) row.rol = data.rol; if ('activo' in data) row.activo = data.activo; row.session_version += data.session_version.increment; }
        return { count: found.length };
      },
      count: async ({ where }: any) => rows.filter(row => Object.entries(where).every(([key, value]) => (row as any)[key] === value)).length,
    },
    adminAuditoria: { create: async ({ data }: any) => { if (options.failAudit) throw new Error('fallo simulado de la auditoría'); audit.push({ ...data }); return data; } },
  };
  const client = {
    ...tx,
    adminUser: {
      ...tx.adminUser,
      findUnique: async ({ where, select }: any) => { const row = rows.find(item => item.id === where.id); return row ? pick(row, select) : null; },
      findMany: async ({ select }: any) => [...rows].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(row => pick(row, select)),
    },
    $transaction: async (run: (t: typeof tx) => Promise<unknown>) => {
      const saved = rows.map(row => ({ ...row })), entries = audit.length;
      try { return await run(tx); } catch (error) { rows.splice(0, rows.length, ...saved); audit.length = entries; throw error; }
    },
  };
  return { rows, audit, queries, client };
}

test('servicio: asignar un rol bloquea todas las filas, revoca las sesiones de la cuenta y audita en la misma transacción', async () => {
  const db = database([{ rol: G }, { rol: null, session_version: 3 }, { rol: S }]);
  const service = new AccountsService(db.client as any, {} as any, {} as any, {} as any);
  assert.deepEqual(await service.role(2, K, null, 1), { ok: true, mensaje: 'Rol actualizado. La cuenta deberá iniciar sesión de nuevo.', user: { id: 2, rol: K } });
  assert.match(db.queries[0], /^SELECT id, activo, rol FROM admin_users ORDER BY id FOR UPDATE NOWAIT$/);
  assert.equal(db.rows[1].rol, K); assert.equal(db.rows[1].session_version, 4);
  assert.equal(db.rows[0].session_version, 1, 'las demás cuentas no cambian'); assert.equal(db.rows[2].rol, S);
  assert.deepEqual(db.audit, [{ origen: 'panel', actor_id: 1, cuenta_id: 2, operacion: 'rol_asignado', rol_anterior: null, rol_nuevo: K, activo_anterior: true, activo_nuevo: true, resultado: 'aplicado' }]);
  // Retirar: vuelve a cuenta básica (sin rol), con otra revocación y otro registro.
  assert.match((await service.role(2, null, K, 1)).mensaje, /cuenta básica/);
  assert.deepEqual([db.rows[1].rol, db.rows[1].session_version, db.audit[1].operacion, db.audit[1].rol_anterior, db.audit[1].rol_nuevo], [null, 5, 'rol_retirado', K, null]);
});

test('servicio: sin cambio, propio rol, rol desactualizado o último gerente no escriben nada', async () => {
  const db = database([{ rol: G }, { rol: K, session_version: 7 }]);
  const service = new AccountsService(db.client as any, {} as any, {} as any, {} as any);
  const snapshot = JSON.stringify(db.rows);
  assert.match((await service.role(2, K, K, 1)).mensaje, /No se hicieron cambios/);
  await assert.rejects(() => service.role(1, S, G, 1), conflict(SELF_ROLE_MESSAGE));
  await assert.rejects(() => service.role(2, S, null, 1), conflict(STALE_ROLE_MESSAGE));
  assert.equal(db.queries.length, 2, 'el propio rol se rechaza antes de bloquear filas');
  assert.equal(JSON.stringify(db.rows), snapshot); assert.equal(db.audit.length, 0);
  // Último gerente: dos gerentes, uno se lo retira al otro → permitido; luego el que queda no puede perderlo (solo él podría pedirlo).
  const two = database([{ rol: G }, { rol: G }]);
  const s2 = new AccountsService(two.client as any, {} as any, {} as any, {} as any);
  await s2.role(2, null, G, 1);
  await assert.rejects(() => s2.role(1, null, G, 2), (error: unknown) => error instanceof ForbiddenException || error instanceof ConflictException);
  assert.equal(two.rows.filter(row => row.activo && row.rol === G).length, 1, 'siempre queda un gerente activo');
});

test('servicio: si falla la auditoría se revierte el cambio completo; un bloqueo prolongado responde 409 sin cambios', async () => {
  const db = database([{ rol: G }, { rol: null }], { failAudit: true });
  const service = new AccountsService(db.client as any, {} as any, {} as any, {} as any);
  await assert.rejects(() => service.role(2, S, null, 1), /fallo simulado de la auditoría/);
  assert.deepEqual([db.rows[1].rol, db.rows[1].session_version, db.audit.length], [null, 1, 0]);
  const locked = database([{ rol: G }, { rol: null }], { nowaitAlways: true });
  const original = AccountsService.LOCK_RETRY_DELAYS_MS;
  (AccountsService as any).LOCK_RETRY_DELAYS_MS = [1, 1];
  try { await assert.rejects(() => new AccountsService(locked.client as any, {} as any, {} as any, {} as any).role(2, S, null, 1), conflict(ACCOUNTS_BUSY_MESSAGE)); }
  finally { (AccountsService as any).LOCK_RETRY_DELAYS_MS = original; }
  assert.equal(locked.queries.length, 3, 'un intento y dos reintentos con transacciones nuevas');
  assert.equal(locked.rows[1].rol, null);
});

test('servicio: el listado incluye el rol, nunca contraseña ni versión de sesión, y un rol desconocido se informa como null', async () => {
  const db = database([{ nombre: 'Beatriz', rol: G }, { nombre: 'Ana', rol: 'ADMINISTRADOR' }, { nombre: 'Carla', activo: false }]);
  const { users } = await new AccountsService(db.client as any, {} as any, {} as any, {} as any).list();
  assert.deepEqual(users.map(u => [u.nombre, u.rol, u.activo]), [['Ana', null, true], ['Beatriz', G, true], ['Carla', null, false]]);
  for (const user of users) assert.deepEqual(Object.keys(user).sort(), ['activo', 'createdAt', 'email', 'id', 'nombre', 'rol']);
});

// ---- HTTP real con AccessGuard registrada como en AppModule ----
const secret = 'isolated-account-roles-secret-32-characters!';
async function start(initial: Partial<Row>[]) {
  const db = database(initial);
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } })],
    controllers: [AccountsController],
    providers: [AccountsService, JwtStrategy, JwtAuthGuard, AccountAccessService, { provide: APP_GUARD, useClass: AccessGuard },
      { provide: ConfigService, useValue: { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined), getOrThrow: (key: string) => { if (key !== 'JWT_SECRET') throw new Error(key); return secret; } } },
      { provide: PrismaService, useValue: db.client }, { provide: MailService, useValue: { sendMail: async () => true } }],
  })
  class RolesModule {}
  const app = await NestFactory.create(RolesModule, { logger: false });
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl(), jwt = app.get(JwtService);
  const token = (id: number) => jwt.sign({ id, email: 'x@example.test', version: db.rows.find(row => row.id === id)!.session_version });
  const call = async (method: string, route: string, auth?: string, body?: unknown) => {
    const before = JSON.stringify(db.rows);
    const response = await fetch(url + '/admin/' + route, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json().catch(() => null) as any, changed: JSON.stringify(db.rows) !== before };
  };
  return { app, db, call, token };
}

test('HTTP: solo quien tiene cuentas:asignar_rol (gerente) cambia roles; el resto recibe 401/403 sin cambios', async () => {
  const { app, db, call, token } = await start([{ rol: G }, { rol: K }, { rol: S }, { rol: null }, { rol: null }]);
  try {
    const body = { rol: S, rol_actual: null };
    assert.equal((await call('PUT', 'users/5/rol', undefined, body)).status, 401);
    assert.equal((await call('PUT', 'users/5/rol', 'basura', body)).status, 401);
    for (const [id, message] of [[2, FORBIDDEN_MESSAGE], [3, FORBIDDEN_MESSAGE], [4, NO_ROLE_MESSAGE]] as const) {
      const denied = await call('PUT', 'users/5/rol', token(id), body);
      assert.equal(denied.status, 403, 'cuenta ' + id); assert.deepEqual(denied.data, { ok: false, mensaje: message }); assert.equal(denied.changed, false);
    }
    // Ni la coordinadora ni la secretaria pueden darse GERENTE a sí mismas ni leer el listado.
    assert.equal((await call('PUT', 'users/2/rol', token(2), { rol: G, rol_actual: K })).status, 403);
    assert.equal((await call('GET', 'users', token(3))).status, 403);
    const ok = await call('PUT', 'users/5/rol', token(1), body);
    assert.equal(ok.status, 200); assert.deepEqual(ok.data.user, { id: 5, rol: S }); assert.equal(db.rows[4].rol, S);
    assert.equal(db.audit.at(-1).actor_id, 1);
  } finally { await app.close(); }
});

test('HTTP: cuerpo inválido o con campos extra → 400; propio rol → 409; la cuenta modificada debe volver a iniciar sesión', async () => {
  const { app, db, call, token } = await start([{ rol: G }, { rol: null }]);
  try {
    const targetToken = token(2);
    assert.equal((await call('GET', 'users', token(1))).status, 200);
    for (const body of [{}, { rol: S }, { rol_actual: null }, { rol: 'ADMINISTRADOR', rol_actual: null }, { rol: 'gerente_general', rol_actual: null }, { rol: S, rol_actual: null, permisos: ['cuentas:crear'] }, { rol: S, rol_actual: null, activo: true }, [S]]) {
      const result = await call('PUT', 'users/2/rol', token(1), body);
      assert.equal(result.status, 400, JSON.stringify(body)); assert.equal(result.changed, false);
    }
    assert.equal((await call('PUT', 'users/abc/rol', token(1), { rol: S, rol_actual: null })).status, 400);
    assert.equal((await call('PUT', 'users/99/rol', token(1), { rol: S, rol_actual: null })).status, 404);
    const self = await call('PUT', 'users/1/rol', token(1), { rol: S, rol_actual: G });
    assert.equal(self.status, 409); assert.equal(self.changed, false);
    assert.equal((await call('PUT', 'users/2/rol', token(1), { rol: K, rol_actual: S })).status, 409, 'rol_actual desactualizado');
    assert.equal(db.audit.length, 0);
    assert.equal((await call('PUT', 'users/2/rol', token(1), { rol: K, rol_actual: null })).status, 200);
    // La sesión anterior de la cuenta modificada queda revocada (session_version cambió).
    const old = await fetch((await app.getUrl()) + '/admin/users', { headers: { Authorization: 'Bearer ' + targetToken } });
    assert.equal(old.status, 401);
    const listed = await call('GET', 'users', token(1));
    assert.deepEqual(listed.data.users.map((u: any) => u.rol), [G, K]);
    assert.ok(listed.data.users.every((u: any) => !('password' in u) && !('session_version' in u)));
  } finally { await app.close(); }
});
