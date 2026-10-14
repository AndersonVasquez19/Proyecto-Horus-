import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { AuthController } from '../src/admin/auth/auth.controller';
import { AccountsController } from '../src/admin/auth/accounts.controller';
import { AuthService } from '../src/admin/auth/auth.service';
import { AccountsService } from '../src/admin/auth/accounts.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { PrismaService } from '../src/database/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { createValidationPipe } from '../src/common/validation';

// Cuentas simuladas en memoria: no se usa MySQL, ni datos reales, ni se envía correo.
const secret = 'isolated-admin-security-secret-32-characters';

type Row = { id: number; nombre: string; email: string; password: string; activo: boolean; session_version: number; createdAt: Date };

function fakeDatabase() {
  const rows: Row[] = []; let sequence = 0;
  const match = (row: Row, where: any) => Object.entries(where).every(([key, value]) => (row as any)[key] === value);
  const adminUser = {
    findFirst: async ({ where }: any) => rows.find(row => match(row, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find(row => match(row, where)) ?? null,
    create: async ({ data }: any) => {
      if (rows.some(row => row.email === data.email)) throw new PrismaClientKnownRequestError('Duplicate', { code: 'P2002', clientVersion: 'test' });
      const row: Row = { id: ++sequence, activo: true, session_version: 1, createdAt: new Date(), ...data }; rows.push(row); return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const found = rows.filter(row => match(row, where));
      for (const row of found) for (const [key, value] of Object.entries(data)) (row as any)[key] = (value as any)?.increment ? (row as any)[key] + (value as any).increment : value;
      return { count: found.length };
    },
  };
  // Auditoría y transacción simuladas: si la función de la transacción falla, se descartan las filas y los registros que añadió.
  const audit: any[] = [];
  const client: any = { adminUser, adminAuditoria: { create: async ({ data }: any) => { audit.push({ ...data }); return data; } } };
  client.$transaction = async (run: (tx: any) => unknown) => {
    const saved = { rows: rows.map(row => ({ ...row })), audit: audit.length };
    try { return await run(client); } catch (error) { rows.splice(0, rows.length, ...saved.rows); audit.length = saved.audit; throw error; }
  };
  return { rows, audit, client };
}

const values: Record<string, string> = { JWT_SECRET: secret, MAIL_USER: 'noreply@example.test' };
// Configuración mínima aislada (no lee variables del entorno real).
const settings = { get: (key: string) => values[key], getOrThrow: (key: string) => { if (values[key] === undefined) throw new Error(key); return values[key]; } };

async function start() {
  const db = fakeDatabase(); const sent: any[] = [];
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } })],
    controllers: [AuthController, AccountsController],
    providers: [AuthService, AccountsService, JwtStrategy,
      { provide: ConfigService, useValue: settings },
      { provide: PrismaService, useValue: db.client },
      { provide: MailService, useValue: { sendMail: async (options: any) => { sent.push(options); return true; } } },
    ],
  })
  class AdminSecurityModule {}
  const app = await NestFactory.create(AdminSecurityModule, { logger: false });
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const call = async (route: string, method = 'GET', body?: object, token?: string) => {
    const response = await fetch(url + '/admin/' + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json().catch(() => null) as any };
  };
  const seed = async (nombre: string, email: string, password: string) => db.client.adminUser.create({ data: { nombre, email, password: bcrypt.hashSync(password, 4) } });
  return { app, db, sent, call, seed, jwt: app.get(JwtService) };
}

const newAdmin = { nombre: 'Nueva Persona', email: 'nueva@example.test', password: 'Password-nueva-123' };

test('nobody can create an administrator without a valid session', async () => {
  const { app, db, call, seed, jwt } = await start();
  try {
    const existing = await seed('Admin existente', 'admin@example.test', 'Password-existente-1');
    await seed('Admin inactivo', 'inactivo@example.test', 'Password-inactivo-1'); db.rows[1].activo = false;
    const before = db.rows.length;
    const invalidSessions: (string | undefined)[] = [
      undefined, 'invalid', 'a.b.c',
      jwt.sign({ id: existing.id, version: 1 }, { expiresIn: -10 }),                       // sesión expirada
      jwt.sign({ id: 999, version: 1 }),                                                    // cuenta inexistente
      jwt.sign({ id: db.rows[1].id, version: 1 }),                                          // cuenta desactivada
      jwt.sign({ id: existing.id, version: 9 }),                                            // sesión revocada
      jwt.sign({ id: existing.id, version: 1 }, { audience: 'horus-password-reset' }),      // token de otro propósito
      new JwtService({ secret: 'another-secret-with-at-least-32-characters' }).sign({ id: existing.id, version: 1 }, { issuer: 'horus-api', audience: 'horus-panel' }), // firma ajena
    ];
    for (const token of invalidSessions) {
      const result = await call('register', 'POST', newAdmin, token);
      assert.equal(result.status, 401, 'registro con token ' + String(token).slice(0, 12));
      assert.equal(result.data?.token, undefined);
    }
    assert.equal(db.rows.length, before, 'ninguna cuenta nueva');
    assert.equal(db.audit.length, 0, 'sin cuenta creada no hay registro de auditoría');
  } finally { await app.close(); }
});

test('an authorized session creates plain administrators: no token is returned and no privilege can be chosen', async () => {
  const { app, db, call, seed } = await start();
  try {
    await seed('Admin existente', 'admin@example.test', 'Password-existente-1');
    const login = await call('login', 'POST', { email: 'admin@example.test', password: 'Password-existente-1' });
    assert.equal(login.status, 200);
    assert.ok(login.data.token, 'el login de una cuenta existente sigue funcionando');
    // Campos extra (roles, estado, identificador, versión de sesión) se rechazan: no hay escalada de privilegios.
    for (const extra of [{ role: 'owner' }, { rol: 'super' }, { activo: true }, { id: 1 }, { session_version: 99 }, { admin: true }]) {
      assert.equal((await call('register', 'POST', { ...newAdmin, ...extra }, login.data.token)).status, 400);
    }
    assert.equal(db.rows.length, 1);
    const created = await call('register', 'POST', newAdmin, login.data.token);
    assert.equal(created.status, 201);
    assert.equal(created.data.token, undefined, 'la respuesta no entrega una sesión de la cuenta nueva');
    assert.deepEqual(Object.keys(created.data.user).sort(), ['email', 'id', 'nombre']);
    assert.equal(db.rows.length, 2);
    assert.notEqual(db.rows[1].password, newAdmin.password, 'la contraseña se guarda cifrada');
    assert.equal((db.rows[1] as any).rol, undefined, 'la cuenta nace sin rol');
    // Auditoría (M-4): quién creó qué cuenta, sin correo, nombre, contraseña ni token.
    assert.deepEqual(db.audit, [{ origen: 'panel', actor_id: db.rows[0].id, cuenta_id: db.rows[1].id, operacion: 'cuenta_creada', rol_anterior: null, rol_nuevo: null, activo_anterior: null, activo_nuevo: true, resultado: 'aplicado' }]);
    assert.equal((await call('register', 'POST', newAdmin, login.data.token)).status, 409);
    assert.equal(db.audit.length, 1, 'un correo repetido no deja registro');
    // La cuenta nueva entra por el login normal y obtiene exactamente los mismos permisos que cualquier administrador.
    const second = await call('login', 'POST', { email: newAdmin.email, password: newAdmin.password });
    assert.equal(second.status, 200);
    assert.equal((await call('me', 'GET', undefined, second.data.token)).status, 200);
    assert.equal((await call('login', 'POST', { email: newAdmin.email, password: 'otra-contraseña-123' })).status, 401);
  } finally { await app.close(); }
});

test('changing the password revokes old sessions and keeps login working', async () => {
  const { app, db, call, seed } = await start();
  try {
    await seed('Admin existente', 'admin@example.test', 'Password-existente-1');
    const { data: first } = await call('login', 'POST', { email: 'admin@example.test', password: 'Password-existente-1' });
    assert.equal((await call('me', 'GET', undefined, first.token)).status, 200);
    assert.equal((await call('password', 'POST', { current_password: 'incorrecta-123', password: 'Password-cambiada-1' }, first.token)).status, 400);
    assert.equal((await call('password', 'POST', { current_password: 'Password-existente-1', password: 'Password-cambiada-1' }, first.token)).status, 200);
    // La sesión anterior queda revocada: tampoco puede crear administradores.
    assert.equal((await call('me', 'GET', undefined, first.token)).status, 401);
    assert.equal((await call('register', 'POST', newAdmin, first.token)).status, 401);
    assert.equal(db.rows.length, 1);
    assert.equal((await call('login', 'POST', { email: 'admin@example.test', password: 'Password-existente-1' })).status, 401);
    const again = await call('login', 'POST', { email: 'admin@example.test', password: 'Password-cambiada-1' });
    assert.equal(again.status, 200);
    assert.equal((await call('register', 'POST', newAdmin, again.data.token)).status, 201);
  } finally { await app.close(); }
});

test('password recovery still works, is single-use and does not reveal whether an account exists', async () => {
  const { app, sent, call, seed } = await start();
  try {
    await seed('Admin existente', 'admin@example.test', 'Password-existente-1');
    const unknown = await call('forgot-password', 'POST', { email: 'nadie@example.test' });
    const known = await call('forgot-password', 'POST', { email: 'admin@example.test' });
    assert.equal(unknown.status, 200); assert.equal(known.status, 200);
    assert.deepEqual(unknown.data, known.data, 'misma respuesta exista o no la cuenta');
    assert.equal(sent.length, 1, 'solo se envía correo a una cuenta activa (simulado, no real)');
    const link = new URL(String(sent[0].text).match(/https?:\/\/\S+/)![0]);
    const token = link.searchParams.get('token')!;
    assert.equal(link.pathname, '/admin/reset-password');
    assert.equal((await call('reset-password', 'POST', { token, password: 'Password-recuperada-1' })).status, 200);
    assert.equal((await call('reset-password', 'POST', { token, password: 'Password-otra-vez-1' })).status >= 400, true, 'el enlace no se reutiliza');
    assert.equal((await call('login', 'POST', { email: 'admin@example.test', password: 'Password-existente-1' })).status, 401);
    assert.equal((await call('login', 'POST', { email: 'admin@example.test', password: 'Password-recuperada-1' })).status, 200);
  } finally { await app.close(); }
});
