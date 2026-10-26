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
import { MessageExportQueryDto } from '../src/admin/messages/dto/export-messages.dto';
import { EXPORT_BATCH_SIZE, MAX_EXPORT_MESSAGES, messageExportCells, renderMessagesCsv } from '../src/admin/messages/messages.export';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { createValidationPipe } from '../src/common/validation';
import { PrismaService } from '../src/database/prisma.service';
import { AccessGuard, AccountAccessService } from '../src/permissions/access.guard';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { can, permissionsOf } from '../src/permissions/policy';
import { ALL_PERMISSIONS, isPermission } from '../src/permissions/permissions';
import { ROUTE_INVENTORY } from '../src/permissions/route-inventory';

// Etapa 4A: exportación controlada de consultas. Solo memoria: SQLite (node:sqlite) ejecuta el SQL de lectura real sobre datos ficticios,
// sin MySQL, sin correo, sin red fuera de 127.0.0.1 y con un secreto JWT ficticio. Ninguna escritura es posible: el simulador solo acepta SELECT.
const secret = 'isolated-messages-export-secret-32-chars!';
const jwt = new JwtService({ secret, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } });
const token = (id: number) => jwt.sign({ id, email: 'x@example.test', version: 1 });

const SECRET_BODY = 'TEXTO-PRIVADO-DEL-MENSAJE';
interface Contact { id: number; nombre: string; email: string; telefono: string; asunto: string; mensaje: string; estado: string; origen: string; createdAt: string }
const contact = (id: number, extra: Partial<Contact> = {}): Contact => ({
  id, nombre: 'Persona ficticia ' + id, email: 'p' + id + '@example.test', telefono: '999000' + String(id).padStart(3, '0'), asunto: 'Consulta ' + id,
  mensaje: SECRET_BODY + id, estado: 'nuevo', origen: 'web', createdAt: new Date(Date.UTC(2026, 0, 1, 15, 0, 0) + id * 60_000).toISOString(), ...extra,
});

function build(contacts: Contact[], attention: Array<{ recurso: string; registro_id: number; estado: string; responsable: string }> = []) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE contactos (id INTEGER, nombre TEXT, email TEXT, telefono TEXT, asunto TEXT, mensaje TEXT, estado TEXT, origen TEXT, createdAt TEXT, updatedAt TEXT);'
    + ' CREATE TABLE attention_records (recurso TEXT, registro_id INTEGER, estado TEXT, responsable TEXT, notas TEXT);');
  const insert = db.prepare('INSERT INTO contactos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const c of contacts) insert.run(c.id, c.nombre, c.email, c.telefono, c.asunto, c.mensaje, c.estado, c.origen, c.createdAt, c.createdAt);
  db.exec('COMMIT');
  for (const a of attention) db.prepare('INSERT INTO attention_records VALUES (?, ?, ?, ?, ?)').run(a.recurso, a.registro_id, a.estado, a.responsable, 'NOTA-PRIVADA');
  const queries: Prisma.Sql[] = [];
  const reads = { transactions: 0, writes: 0 };
  const rows: Array<{ id: number; nombre: string; email: string; activo: boolean; session_version: number; rol: string | null }> = [
    { id: 1, nombre: 'Gerente', email: 'g@example.test', activo: true, session_version: 1, rol: 'GERENTE_GENERAL' },
    { id: 2, nombre: 'Coordinadora', email: 'c@example.test', activo: true, session_version: 1, rol: 'COORDINADORA_INSTITUCIONAL' },
    { id: 3, nombre: 'Secretaria', email: 's@example.test', activo: true, session_version: 1, rol: 'SECRETARIA' },
    { id: 4, nombre: 'Sin rol', email: 'n@example.test', activo: true, session_version: 1, rol: null },
  ];
  const client: any = {
    $queryRaw: async (query: Prisma.Sql) => {
      assert.match(query.sql, /^\s*SELECT/i, 'la exportación solo ejecuta SELECT');
      queries.push(query);
      return db.prepare(query.sql.replaceAll(' COLLATE utf8mb4_unicode_ci', '')).all(...query.values.map(value => value instanceof Date ? value.toISOString() : value) as SQLInputValue[]);
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>, options?: { isolationLevel?: string }) => { reads.transactions++; assert.equal(options?.isolationLevel, 'RepeatableRead'); return work(client); },
    adminUser: { findUnique: async ({ where, select }: any) => {
      const row = rows.find(candidate => candidate.id === where.id);
      return row ? (select ? Object.fromEntries(Object.keys(select).map(key => [key, (row as any)[key]])) : { ...row }) : null;
    } },
  };
  // Cualquier intento de escribir sobre mensajes o seguimientos falla la prueba.
  for (const model of ['contacto', 'attentionRecord']) client[model] = new Proxy({}, { get: (_t, op) => async () => { reads.writes++; assert.fail('escritura prohibida: ' + model + '.' + String(op)); } });
  return { db, client, queries, reads };
}

async function start(contacts: Contact[], attention?: Parameters<typeof build>[1]) {
  const f = build(contacts, attention);
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [MessagesController],
    providers: [MessagesService, JwtStrategy, JwtAuthGuard, AccountAccessService, { provide: APP_GUARD, useClass: AccessGuard },
      { provide: ConfigService, useValue: { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined) } }, { provide: PrismaService, useValue: f.client }],
  })
  class ExportTestModule {}
  const app = await NestFactory.create(ExportTestModule, { logger: false });
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const get = async (route: string, auth?: string) => {
    const response = await fetch(url + '/' + route, { headers: auth ? { Authorization: 'Bearer ' + auth } : {} });
    // Buffer.toString conserva el BOM (response.text() lo descartaría y no se podría comprobar).
    return { response, status: response.status, text: Buffer.from(await response.arrayBuffer()).toString('utf8') };
  };
  return { ...f, app, get, close: async () => { await app.close(); f.db.close(); } };
}

// ---------------------------------------------------------------------------------------------------------------
// Permisos (la propuesta para Coordinación y Secretaría queda sin conceder)
// ---------------------------------------------------------------------------------------------------------------
test('mensajes:exportar existe, es solo del gerente y no se concede por poder leer mensajes', () => {
  assert.ok(isPermission('mensajes:exportar'));
  assert.ok(ALL_PERMISSIONS.includes('mensajes:exportar'));
  assert.equal(can('GERENTE_GENERAL', 'mensajes:exportar'), true);
  for (const role of ['COORDINADORA_INSTITUCIONAL', 'SECRETARIA']) {
    assert.equal(can(role, 'mensajes:leer'), true, role + ' sigue leyendo');
    assert.equal(can(role, 'mensajes:exportar'), false, role + ' no exporta');
    assert.equal(permissionsOf(role).includes('mensajes:exportar'), false);
  }
  for (const role of [null, undefined, 'ADMINISTRADOR', '']) assert.equal(can(role, 'mensajes:exportar'), false);
});

test('la ruta está clasificada, exige mensajes:exportar y se declara antes de :id', () => {
  const entry = ROUTE_INVENTORY.find(route => route.method === 'GET' && route.path === 'admin/messages/exportar');
  assert.deepEqual(entry?.access, { kind: 'permiso', permission: 'mensajes:exportar' });
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, MessagesController.prototype.exportCsv), { kind: 'permiso', permission: 'mensajes:exportar' });
  // La lectura, el detalle y el resto de rutas conservan su permiso.
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, MessagesController.prototype.findAll), { kind: 'permiso', permission: 'mensajes:leer' });
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, MessagesController.prototype.findOne), { kind: 'permiso', permission: 'mensajes:leer' });
  const order = Object.getOwnPropertyNames(MessagesController.prototype);
  assert.ok(order.indexOf('exportCsv') < order.indexOf('findOne'), 'exportar debe declararse antes de :id');
});

// ---------------------------------------------------------------------------------------------------------------
// HTTP: autenticación, autorización, filtros, límites, privacidad y ausencia de escrituras
// ---------------------------------------------------------------------------------------------------------------
test('autenticación y autorización: sin sesión 401; secretaria, coordinadora y cuenta sin rol 403; gerente 200; nada se lee si se deniega', async () => {
  const f = await start([contact(1), contact(2)]);
  try {
    assert.equal((await f.get('admin/messages/exportar')).status, 401);
    assert.equal((await f.get('admin/messages/exportar', 'token.invalido.x')).status, 401);
    for (const id of [3, 2, 4]) assert.equal((await f.get('admin/messages/exportar', token(id))).status, 403, 'cuenta ' + id);
    assert.equal(f.queries.length, 0, 'ninguna consulta de datos antes de autorizar');
    assert.equal(f.reads.transactions, 0);
    const ok = await f.get('admin/messages/exportar', token(1));
    assert.equal(ok.status, 200);
    // Regresión: la lectura y el detalle siguen disponibles para la secretaria y la coordinadora, y «exportar» no se confunde con un id.
    for (const id of [3, 2]) assert.equal((await f.get('admin/messages?page=1&limit=20', token(id))).status, 200);
    assert.equal((await f.get('admin/messages/1', token(3))).status, 200);
    assert.equal((await f.get('admin/messages/exportar', token(3))).status, 403, 'sigue siendo 403 (no 400 de ParseIntPipe)');
  } finally { await f.close(); }
});

test('cabeceras y contenido: adjunto, sin caché, BOM, CRLF, columnas fijas y sin texto del mensaje ni del seguimiento', async () => {
  const f = await start([contact(1), contact(2, { origen: 'chatbot', asunto: '[Chatbot] Hola' }), contact(3, { origen: 'manual' })], [{ recurso: 'messages', registro_id: 2, estado: 'archivado', responsable: 'Equipo' }]);
  try {
    const res = await f.get('admin/messages/exportar', token(1));
    assert.equal(res.status, 200);
    assert.match(res.response.headers.get('content-type') ?? '', /^text\/csv/);
    assert.match(res.response.headers.get('content-disposition') ?? '', /^attachment; filename="horus-consultas-\d{8}-\d{4}\.csv"$/);
    assert.equal(res.response.headers.get('cache-control'), 'no-store');
    assert.ok(res.text.startsWith('﻿'), 'BOM UTF-8');
    const lines = res.text.slice(1).split('\r\n');
    assert.equal(lines[0], 'ID;Nombre;Correo;Teléfono;Asunto;Origen;Estado;Recibida (hora de Lima)');
    assert.deepEqual(lines.slice(1, 4).map(line => line.split(';')[0]), ['3', '2', '1'], 'orden de la bandeja: más reciente primero');
    assert.match(lines[2], /;Chatbot;Archivado;/, 'estado efectivo del seguimiento y origen legible');
    assert.ok(lines.some(line => line.startsWith('Filas;3')));
    assert.ok(lines.some(line => line.startsWith('Aviso;')));
    for (const secretText of [SECRET_BODY, 'NOTA-PRIVADA', 'notas', 'historial', 'respuesta']) assert.ok(!res.text.includes(secretText), 'no debe exportar ' + secretText);
    // Mismo número de campos en todas las líneas de datos.
    for (const line of lines.slice(0, 4)) assert.equal(line.split(';').length, 8);
  } finally { await f.close(); }
});

test('filtros de la bandeja: estado efectivo, canal, búsqueda y responsable; un filtro inválido se rechaza', async () => {
  const contacts = [contact(1, { estado: 'nuevo', nombre: 'Ana Quispe' }), contact(2, { asunto: '[Chatbot] Duda', origen: 'chatbot' }), contact(3, { estado: 'atendido' }), contact(4)];
  const f = await start(contacts, [{ recurso: 'messages', registro_id: 4, estado: 'en_proceso', responsable: 'Equipo A' }, { recurso: 'messages', registro_id: 3, estado: 'archivado', responsable: 'Equipo B' }]);
  try {
    const ids = async (query: string) => {
      const res = await f.get('admin/messages/exportar?' + query, token(1));
      assert.equal(res.status, 200, query);
      return res.text.slice(1).split('\r\n').slice(1).filter(line => /^\d+[;,]/.test(line)).map(line => Number(line.split(/[;,]/)[0]));
    };
    assert.deepEqual(await ids('estado=archivado'), [3], 'el estado de la bandeja es el del seguimiento');
    assert.deepEqual(await ids('estado=en_proceso'), [4]);
    assert.deepEqual(await ids('channel=chatbot'), [2]);
    assert.deepEqual(await ids('channel=other'), [4, 3, 1]);
    assert.deepEqual(await ids('search=Quispe'), [1]);
    assert.deepEqual(await ids('responsable=Equipo%20B'), [3]);
    assert.deepEqual(await ids('estado=nuevo&channel=other&search=Quispe'), [1]);
    assert.deepEqual(await ids('estado=nuevo&formato=csv&separador=coma'), [2, 1]);
    for (const bad of ['estado=inexistente', 'channel=otro', 'formato=xlsx', 'separador=tab', 'antiguas=no', 'page=1', 'limit=5', 'vista=resumen', 'columnas=mensaje', 'search=' + 'a'.repeat(101)]) {
      assert.equal((await f.get('admin/messages/exportar?' + bad, token(1))).status, 400, bad);
    }
  } finally { await f.close(); }
});

test('límites: lee por lotes sin repetir ni perder filas y rechaza con 422, sin leer datos, lo que supera el máximo', async () => {
  const many = Array.from({ length: EXPORT_BATCH_SIZE * 2 + 37 }, (_, index) => contact(index + 1));
  const f = await start(many);
  try {
    const res = await f.get('admin/messages/exportar', token(1));
    assert.equal(res.status, 200);
    const idsOut = res.text.slice(1).split('\r\n').filter(line => /^\d+;/.test(line)).map(line => Number(line.split(';')[0]));
    assert.equal(idsOut.length, many.length);
    assert.equal(new Set(idsOut).size, many.length, 'sin repetidos');
    assert.deepEqual(idsOut, many.map(c => c.id).reverse(), 'orden estable');
    assert.equal(f.queries.length, 1 + 3, 'un conteo y tres lotes acotados');
    assert.ok(f.queries.slice(1).every(q => /LIMIT/.test(q.sql) && q.values.includes(EXPORT_BATCH_SIZE)), 'cada lectura tiene LIMIT');
    assert.equal(f.reads.transactions, 1, 'una sola transacción de lectura');
  } finally { await f.close(); }
  const over = await start(Array.from({ length: MAX_EXPORT_MESSAGES + 1 }, (_, index) => contact(index + 1)));
  try {
    const res = await over.get('admin/messages/exportar', token(1));
    assert.equal(res.status, 422);
    assert.match(res.text, /Acota la búsqueda/);
    assert.equal(over.queries.length, 1, 'solo el conteo: no se leyeron datos personales');
    assert.ok(!res.text.includes('example.test'));
    const narrowed = await over.get('admin/messages/exportar?search=ficticia%205000', token(1));
    assert.equal(narrowed.status, 200, 'acotando con filtros sí se exporta');
  } finally { await over.close(); }
});

test('antiguas=si: el corte de 48 h es el mismo en el conteo y en todos los lotes aunque el reloj avance (sin repetir ni perder filas)', async () => {
  // 1 100 consultas (3 lotes) que cruzan el umbral de 48 h según avance el reloj, y Date.now() avanza 1 h por lectura: con el corte recalculado por
  // consulta, el conteo y cada lote verían un conjunto distinto y la lectura repetiría o perdería filas. Todas son antiguas respecto a la hora real.
  const base = Date.UTC(2026, 0, 10, 12, 0, 0);
  const many = Array.from({ length: 1_100 }, (_, index) => contact(index + 1, { createdAt: new Date(base - 48 * 3_600_000 + index * 60_000).toISOString() }));
  const f = await start(many);
  const realNow = Date.now; let ticks = 0;
  Date.now = () => base + (ticks++) * 3_600_000;
  try {
    const res = await f.get('admin/messages/exportar?antiguas=si', token(1));
    Date.now = realNow;
    assert.equal(res.status, 200);
    const idsOut = res.text.slice(1).split('\r\n').filter(line => /^\d+;/.test(line)).map(line => Number(line.split(';')[0]));
    assert.equal(idsOut.length, many.length);
    assert.equal(new Set(idsOut).size, many.length, 'sin repetidos');
    const cutoffs = new Set(f.queries.flatMap(q => q.values).filter((value): value is Date => value instanceof Date).map(value => value.toISOString()));
    assert.equal(f.queries.length, 1 + 3);
    assert.equal(cutoffs.size, 1, 'un solo corte para el conteo y los tres lotes');
  } finally { Date.now = realNow; await f.close(); }
});

test('solo lectura: exportar no modifica mensajes ni seguimientos y no registra datos personales en el log', async () => {
  const contacts = [contact(1, { nombre: 'Rosa Ficticia', email: 'rosa@example.test' }), contact(2)];
  const f = await start(contacts, [{ recurso: 'messages', registro_id: 1, estado: 'en_proceso', responsable: 'Equipo' }]);
  const logs: string[] = [];
  const service = f.app.get(MessagesService) as unknown as { logger: { log: (message: string) => void } };
  service.logger.log = (message: string) => { logs.push(message); };
  try {
    const before = f.db.prepare('SELECT * FROM contactos ORDER BY id').all();
    const beforeAttention = f.db.prepare('SELECT * FROM attention_records').all();
    assert.equal((await f.get('admin/messages/exportar?search=Rosa', token(1))).status, 200);
    assert.deepEqual(f.db.prepare('SELECT * FROM contactos ORDER BY id').all(), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM attention_records').all(), beforeAttention);
    assert.equal(f.reads.writes, 0);
    assert.ok(f.queries.every(q => /^\s*SELECT/i.test(q.sql)));
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^Exportación de consultas: cuenta=1 filas=1 filtros=search$/);
    assert.ok(!/Rosa|example\.test/.test(logs[0]), 'el log no incluye la búsqueda ni datos personales');
  } finally { await f.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// CSV válido y protección contra inyección de fórmulas
// ---------------------------------------------------------------------------------------------------------------
test('CSV: neutraliza fórmulas (también las de ancho completo y las que empiezan por salto o tabulación) y escapa comillas, separadores y saltos', () => {
  const hostile = ['=HYPERLINK("http://x","clic")', '+SUMA(1;1)', '-2+3', '@SUM(A1)', '\t=1+1', '\n=1+1', '  =1+1', '＝1+1', '＋1', '－1', '＠x'];
  for (const value of hostile) {
    const [, nombre, , telefono] = messageExportCells({ ...contact(1), nombre: value, telefono: value, createdAt: new Date('2026-01-01T15:00:00Z') });
    assert.ok(nombre.startsWith("'"), JSON.stringify(value) + ' en nombre');
    assert.ok(telefono.startsWith("'"), JSON.stringify(value) + ' en teléfono');
  }
  const text = renderMessagesCsv([{ ...contact(1), nombre: 'Ana "la" Gómez; Pérez', asunto: 'línea 1\r\nlínea 2', email: '=cmd|\' /C calc\'!A0' }], new Date('2026-01-02T00:00:00Z')).toString('utf8');
  const lines = text.slice(1).split('\r\n');
  assert.equal(lines[0].split(';').length, 8);
  assert.ok(text.includes('"Ana ""la"" Gómez; Pérez"'));
  assert.ok(text.includes('"línea 1\r\nlínea 2"'));
  assert.ok(text.includes("'=cmd|"), 'la fórmula queda como texto');
  assert.ok(!/(^|;)=/.test(lines[1]), 'ninguna celda comienza por =');
  // Separador clásico.
  assert.ok(renderMessagesCsv([contact(1)], new Date(), 'coma').toString('utf8').split('\r\n')[0].includes('ID,Nombre,Correo'));
  // Un valor desconocido de origen o estado no rompe el archivo ni se pierde.
  assert.equal(messageExportCells({ ...contact(1), origen: 'otro', estado: 'raro', createdAt: 'no-es-fecha' }).slice(5).join('|'), 'otro|raro|');
});

test('CSV vacío: conserva encabezados y recuento sin filas de datos', () => {
  const lines = renderMessagesCsv([], new Date('2026-01-02T00:00:00Z')).toString('utf8').slice(1).split('\r\n');
  assert.equal(lines[0].split(';')[0], 'ID');
  assert.ok(lines.includes('Filas;0;;;;;;'));
});

test('el DTO de exportación no admite page, limit ni columnas y valida estado, canal, formato y separador', async () => {
  const pipe = createValidationPipe();
  const run = (value: object) => pipe.transform(value, { type: 'query', metatype: MessageExportQueryDto });
  assert.deepEqual({ ...(await run({ estado: 'nuevo', channel: 'chatbot', search: ' Ana ', separador: 'coma', formato: 'csv' })) }, { estado: 'nuevo', channel: 'chatbot', search: 'Ana', separador: 'coma', formato: 'csv' });
  for (const bad of [{ page: '1' }, { limit: '1000' }, { vista: 'resumen' }, { estado: 'x' }, { formato: 'pdf' }, { separador: ';' }]) await assert.rejects(run(bad), JSON.stringify(bad));
});
