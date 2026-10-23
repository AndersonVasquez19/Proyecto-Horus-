import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Prisma } from '@prisma/client';
import { MessagesController } from '../src/admin/messages/messages.controller';
import { MessagesService } from '../src/admin/messages/messages.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { createValidationPipe } from '../src/common/validation';
import { PrismaService } from '../src/database/prisma.service';
import { AccessGuard, AccountAccessService } from '../src/permissions/access.guard';
import { can, permissionsOf } from '../src/permissions/policy';

// Etapa 4A.2, fase 1: contrato de privacidad del listado de mensajes que React puede usar HOY.
// Solo memoria (SQLite de node:sqlite), cuentas y datos ficticios, secreto JWT ficticio, sin MySQL, correo ni red externa.
// Estas pruebas FIJAN el comportamiento actual: la restricción que fuerza `vista=resumen` a Coordinación y Secretaría aún NO está activa.
const secret = 'isolated-messages-privacy-secret-32-chars!!';
const jwt = new JwtService({ secret, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } });
const token = (id: number) => jwt.sign({ id, email: 'x@example.test', version: 1 });

const GERENTE = 1, COORDINADORA = 2, SECRETARIA = 3, SIN_ROL = 4;
const ROLES = [['gerente', GERENTE], ['coordinadora', COORDINADORA], ['secretaria', SECRETARIA]] as const;
const LONG_BODY = 'Mensaje ficticio largo. ' + 'x'.repeat(400) + ' FIN-DEL-MENSAJE';

function build() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE contactos (id INTEGER, nombre TEXT, email TEXT, telefono TEXT, asunto TEXT, mensaje TEXT, estado TEXT, origen TEXT, createdAt TEXT, updatedAt TEXT);'
    + ' CREATE TABLE attention_records (recurso TEXT, registro_id INTEGER, estado TEXT, responsable TEXT, notas TEXT);');
  const created = new Date(Date.UTC(2026, 0, 1, 15, 0, 0)).toISOString();
  db.prepare('INSERT INTO contactos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, 'Ana Ficticia', 'ana@example.test', '999000111', 'Curso de prueba', LONG_BODY, 'nuevo', 'web', created, created);
  db.prepare('INSERT INTO contactos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(2, 'Luis Ficticio', 'luis@example.test', '999000222', '[Chatbot] Hola', 'Mensaje corto', 'nuevo', 'chatbot', created, created);
  db.prepare('INSERT INTO attention_records VALUES (?, ?, ?, ?, ?)').run('messages', 1, 'en_proceso', 'Rosa', 'NOTA-PRIVADA');
  const rows = [
    { id: GERENTE, nombre: 'Gerente', email: 'g@example.test', activo: true, session_version: 1, rol: 'GERENTE_GENERAL' },
    { id: COORDINADORA, nombre: 'Coordinadora', email: 'c@example.test', activo: true, session_version: 1, rol: 'COORDINADORA_INSTITUCIONAL' },
    { id: SECRETARIA, nombre: 'Secretaria', email: 's@example.test', activo: true, session_version: 1, rol: 'SECRETARIA' },
    { id: SIN_ROL, nombre: 'Sin rol', email: 'n@example.test', activo: true, session_version: 1, rol: null },
  ];
  const writes: string[] = [];
  const client: any = {
    $queryRaw: async (query: Prisma.Sql) => {
      assert.match(query.sql, /^\s*SELECT/i, 'el listado y el detalle solo ejecutan SELECT');
      return db.prepare(query.sql.replaceAll(' COLLATE utf8mb4_unicode_ci', '')).all(...query.values.map(value => value instanceof Date ? value.toISOString() : value) as SQLInputValue[]);
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
    adminUser: { findUnique: async ({ where, select }: any) => {
      const row = rows.find(candidate => candidate.id === where.id);
      return row ? (select ? Object.fromEntries(Object.keys(select).map(key => [key, (row as any)[key]])) : { ...row }) : null;
    } },
  };
  for (const model of ['contacto', 'attentionRecord']) client[model] = new Proxy({}, { get: (_t, op) => async () => { writes.push(model + '.' + String(op)); assert.fail('escritura prohibida: ' + model + '.' + String(op)); } });
  return { db, client, writes };
}

async function start() {
  const f = build();
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [MessagesController],
    providers: [MessagesService, JwtStrategy, JwtAuthGuard, AccountAccessService, { provide: APP_GUARD, useClass: AccessGuard },
      { provide: ConfigService, useValue: { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined) } }, { provide: PrismaService, useValue: f.client }],
  })
  class PrivacyTestModule {}
  const app = await NestFactory.create(PrivacyTestModule, { logger: false });
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const get = async (route: string, auth?: number) => {
    const response = await fetch(url + '/' + route, { headers: auth ? { Authorization: 'Bearer ' + token(auth) } : {} });
    const text = await response.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* CSV u otro cuerpo */ }
    return { status: response.status, text, body };
  };
  return { ...f, get, close: async () => { await app.close(); f.db.close(); } };
}

const byId = (messages: any[], id: number) => messages.find(message => message.id === id);

test('matriz: solo la gerencia tiene mensajes:exportar; Coordinación y Secretaría solo leen, sin permisos nuevos de mensajes', () => {
  assert.equal(can('GERENTE_GENERAL', 'mensajes:exportar'), true);
  for (const role of ['COORDINADORA_INSTITUCIONAL', 'SECRETARIA']) {
    assert.equal(can(role, 'mensajes:leer'), true);
    assert.equal(can(role, 'mensajes:exportar'), false);
    assert.equal(can(role, 'mensajes:eliminar'), false);
    assert.equal(permissionsOf(role).filter(permission => permission.startsWith('mensajes:')).sort().join(','), 'mensajes:crear,mensajes:editar,mensajes:leer');
  }
});

test('listado sin vista (contrato actual que usa React): los tres roles reciben correo, teléfono y mensaje completo', async () => {
  const f = await start();
  try {
    for (const [name, id] of ROLES) {
      const res = await f.get('admin/messages?page=1&limit=20', id);
      assert.equal(res.status, 200, name);
      assert.equal(res.body.ok, true);
      const row = byId(res.body.messages, 1);
      assert.equal(row.email, 'ana@example.test', name);
      assert.equal(row.telefono, '999000111', name);
      assert.equal(row.mensaje, LONG_BODY, name + ': mensaje íntegro');
      assert.equal(row.vista_previa, undefined, name + ': sin campos de la vista resumen');
      assert.ok(res.body.pagination && res.body.metrics, name + ': pagination y metrics presentes');
    }
  } finally { await f.close(); }
});

test('listado vista=resumen: los tres roles reciben solo los campos mínimos y ningún dato de contacto', async () => {
  const f = await start();
  try {
    for (const [name, id] of ROLES) {
      const res = await f.get('admin/messages?vista=resumen&page=1&limit=20', id);
      assert.equal(res.status, 200, name);
      const row = byId(res.body.messages, 1);
      assert.deepEqual(Object.keys(row).sort(), ['asunto', 'createdAt', 'estado', 'id', 'nombre', 'origen', 'responsable', 'updatedAt', 'vista_previa'], name);
      assert.equal(row.responsable, 'Rosa');
      assert.equal(row.estado, 'en_proceso', 'estado efectivo: el del seguimiento');
      assert.equal(row.origen, 'web');
      assert.equal(byId(res.body.messages, 2).origen, 'chatbot');
      assert.equal(byId(res.body.messages, 2).responsable, null, 'sin seguimiento: responsable null');
      assert.ok(row.vista_previa.length <= 160 && row.vista_previa.length > 0, 'vista_previa acotada a 160 caracteres');
      assert.ok(!res.text.includes('ana@example.test') && !res.text.includes('999000111') && !res.text.includes('FIN-DEL-MENSAJE'), name + ': ni correo, ni teléfono ni mensaje completo');
      assert.ok(!res.text.includes('NOTA-PRIVADA'), 'las notas internas nunca salen en el listado');
      assert.ok(res.body.pagination && res.body.metrics);
    }
  } finally { await f.close(); }
});

test('detalle GET /:id: los tres roles lo obtienen completo; sin sesión 401 y sin rol 403', async () => {
  const f = await start();
  try {
    for (const [name, id] of ROLES) {
      const res = await f.get('admin/messages/1', id);
      assert.equal(res.status, 200, name);
      assert.equal(res.body.message.email, 'ana@example.test');
      assert.equal(res.body.message.telefono, '999000111');
      assert.equal(res.body.message.mensaje, LONG_BODY);
    }
    assert.equal((await f.get('admin/messages/1')).status, 401);
    assert.equal((await f.get('admin/messages/1', SIN_ROL)).status, 403);
    assert.equal((await f.get('admin/messages?vista=resumen', SIN_ROL)).status, 403);
    assert.equal((await f.get('admin/messages/999', GERENTE)).status, 404);
  } finally { await f.close(); }
});

test('exportación reservada a la gerencia: Coordinación, Secretaría y cuenta sin rol reciben 403 también con vista=resumen en el listado', async () => {
  const f = await start();
  try {
    assert.equal((await f.get('admin/messages/exportar')).status, 401);
    for (const id of [COORDINADORA, SECRETARIA, SIN_ROL]) assert.equal((await f.get('admin/messages/exportar', id)).status, 403, 'cuenta ' + id);
    const ok = await f.get('admin/messages/exportar', GERENTE);
    assert.equal(ok.status, 200);
    assert.ok(ok.text.includes('ana@example.test'), 'la gerencia sí exporta correo');
    assert.ok(!ok.text.includes('FIN-DEL-MENSAJE') && !ok.text.includes('NOTA-PRIVADA'), 'el CSV nunca incluye el mensaje ni las notas');
    assert.deepEqual(f.writes, [], 'ninguna escritura');
  } finally { await f.close(); }
});

test('el listado resumen más el detalle y la exportación cubren la bandeja de React sin endpoints nuevos', async () => {
  const f = await start();
  try {
    const list = await f.get('admin/messages?vista=resumen&estado=en_proceso&channel=other&search=Curso&responsable=Rosa&page=1&limit=20', SECRETARIA);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.messages.map((message: any) => message.id), [1], 'los filtros de la bandeja también rigen en la vista resumen');
    assert.equal(list.body.pagination.total, 1);
    const detail = await f.get('admin/messages/' + list.body.messages[0].id, SECRETARIA);
    assert.equal(detail.body.message.email, 'ana@example.test', 'el correo se obtiene del detalle autorizado');
  } finally { await f.close(); }
});
