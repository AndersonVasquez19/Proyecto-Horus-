import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Global, HttpException, Module } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Prisma } from '@prisma/client';
import { MessagesController } from '../src/admin/messages/messages.controller';
import { MessagesDuplicadosController } from '../src/admin/messages/duplicados.controller';
import { MessagesModule } from '../src/admin/messages/messages.module';
import { DUPLICADOS_LIMITE_POR_VENTANA, MessagesDuplicadosLimites } from '../src/admin/messages/duplicados.limites';
import { DUPLICADOS_MAX, DUPLICADOS_VENTANA_MS, MessagesDuplicadosService } from '../src/admin/messages/duplicados.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { createValidationPipe } from '../src/common/validation';
import { PrismaService } from '../src/database/prisma.service';
import { AccessGuard, AccountAccessService } from '../src/permissions/access.guard';
import { can } from '../src/permissions/policy';
import { ROUTE_INVENTORY } from '../src/permissions/route-inventory';
import { memoryBuckets } from './fixtures/rate-limit-memory';

// Etapa 4A.2, fase 2: POST /api/admin/messages/duplicados. Solo memoria (SQLite de node:sqlite), cuentas y datos ficticios, secreto JWT ficticio,
// sin MySQL, correo ni red externa. El límite usa el almacén simulado de rate_limit_buckets (la atomicidad REAL entre procesos descansa en las mismas
// sentencias SQL que PublicRateLimitGuard y AsistenteLimites, probadas en MySQL desechable en preinscripciones.integration.cjs).
const secret = 'isolated-messages-duplicados-secret-32-chars!';
const jwt = new JwtService({ secret, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } });
const token = (id: number) => jwt.sign({ id, email: 'x@example.test', version: 1 });

const GERENTE = 1, COORDINADORA = 2, SECRETARIA = 3, SIN_ROL = 4;
const ROLES = [['gerente', GERENTE], ['coordinadora', COORDINADORA], ['secretaria', SECRETARIA]] as const;
const DAY = 24 * 3_600_000;
const BODY = { email: 'ana@example.test', asunto: 'Curso de prueba', mensaje: 'Quiero información sobre el curso ficticio.' };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

type Seed = { id: number; nombre?: string; email: string; telefono?: string; asunto: string; mensaje: string; createdAt?: string; origen?: string };

function build(options: { failStore?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE contactos (id INTEGER, nombre TEXT, email TEXT, telefono TEXT, asunto TEXT, mensaje TEXT, estado TEXT, origen TEXT, createdAt TEXT, updatedAt TEXT);'
    + ' CREATE TABLE attention_records (recurso TEXT, registro_id INTEGER, estado TEXT, responsable TEXT, notas TEXT);');
  const seed = (row: Seed) => {
    const created = row.createdAt ?? ago(60_000);
    db.prepare('INSERT INTO contactos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(row.id, row.nombre ?? 'Ana Ficticia', row.email, row.telefono ?? '999000111', row.asunto, row.mensaje, 'nuevo', row.origen ?? 'web', created, created);
  };
  const snapshot = () => JSON.stringify([db.prepare('SELECT * FROM contactos ORDER BY id').all(), db.prepare('SELECT * FROM attention_records').all()]);
  const store = memoryBuckets();
  const statements: string[] = [];
  const writes: string[] = [];
  const creates: unknown[] = [];
  const rows = [
    { id: GERENTE, nombre: 'Gerente', email: 'g@example.test', activo: true, session_version: 1, rol: 'GERENTE_GENERAL' },
    { id: COORDINADORA, nombre: 'Coordinadora', email: 'c@example.test', activo: true, session_version: 1, rol: 'COORDINADORA_INSTITUCIONAL' },
    { id: SECRETARIA, nombre: 'Secretaria', email: 's@example.test', activo: true, session_version: 1, rol: 'SECRETARIA' },
    { id: SIN_ROL, nombre: 'Sin rol', email: 'n@example.test', activo: true, session_version: 1, rol: null },
  ];
  const client: any = {
    $queryRaw: async (query: Prisma.Sql) => {
      assert.match(query.sql, /^\s*SELECT/i, 'las lecturas solo ejecutan SELECT');
      statements.push(query.sql);
      return db.prepare(query.sql.replaceAll(' COLLATE utf8mb4_unicode_ci', '')).all(...query.values.map(value => value instanceof Date ? value.toISOString() : value) as SQLInputValue[]);
    },
    // El almacén simulado solo admite las dos sentencias de rate_limit_buckets: cualquier otra escritura SQL lanza.
    $transaction: options.failStore
      ? async () => { throw new Error('almacén compartido caído'); }
      : (work: (tx: any) => Promise<unknown>) => store.prisma.$transaction((tx: any) => work({ $executeRaw: tx.$executeRaw, $queryRaw: client.$queryRaw })),
    rateLimitBucket: store.prisma.rateLimitBucket,
    adminUser: { findUnique: async ({ where, select }: any) => {
      const row = rows.find(candidate => candidate.id === where.id);
      return row ? (select ? Object.fromEntries(Object.keys(select).map(key => [key, (row as any)[key]])) : { ...row }) : null;
    } },
    // POST /admin/messages (crear) existente: se permite SOLO para comprobar que sigue funcionando; la comprobación de duplicados nunca lo llama.
    contacto: { create: async ({ data }: any) => { creates.push(data); return { id: 99, ...data }; } },
  };
  client.attentionRecord = new Proxy({}, { get: (_t, op) => async () => { writes.push('attentionRecord.' + String(op)); assert.fail('escritura prohibida: attentionRecord.' + String(op)); } });
  return { db, client, seed, snapshot, store, statements, writes, creates };
}

async function start(options: { failStore?: boolean } = {}) {
  const f = build(options);
  @Global()
  @Module({ providers: [{ provide: PrismaService, useValue: f.client }], exports: [PrismaService] })
  class PrismaStubModule {}
  // Se monta el MessagesModule REAL (controladores y proveedores tal como los registra la aplicación) con guardas y estrategia JWT reales.
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' }), PrismaStubModule, MessagesModule],
    providers: [JwtStrategy, JwtAuthGuard, AccountAccessService, { provide: APP_GUARD, useClass: AccessGuard },
      { provide: ConfigService, useValue: { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined) } }],
  })
  class DuplicadosTestModule {}
  const app = await NestFactory.create(DuplicadosTestModule, { logger: false });
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const call = async (method: string, route: string, auth?: number | string, body?: unknown, raw?: string) => {
    const headers: Record<string, string> = {};
    if (auth !== undefined) headers.Authorization = 'Bearer ' + (typeof auth === 'number' ? token(auth) : auth);
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url + '/' + route, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await response.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* otro cuerpo */ }
    return { status: response.status, text, body: json, headers: response.headers };
  };
  const check = (auth: number | string | undefined, body: unknown = BODY) => call('POST', 'admin/messages/duplicados', auth, body);
  return { ...f, call, check, get: (route: string, auth?: number | string) => call('GET', route, auth), close: async () => { await app.close(); f.db.close(); } };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Autenticación y autorización
// ---------------------------------------------------------------------------------------------------------------------------
test('sin sesión o con token inválido: 401, no se lee nada ni se gasta cuota', async () => {
  const f = await start();
  try {
    f.seed({ id: 1, ...BODY });
    assert.equal((await f.check(undefined)).status, 401);
    assert.equal((await f.check('token.invalido.x')).status, 401);
    assert.equal(f.statements.filter(sql => /contactos/.test(sql)).length, 0, 'sin sesión no se consulta contactos');
    assert.equal(f.store.total(), 0, 'sin sesión no se gasta cuota');
  } finally { await f.close(); }
});

test('cuenta sin rol: 403, sin leer datos ni gastar cuota; Gerencia, Coordinación y Secretaría (mensajes:crear) sí pueden comprobar', async () => {
  const f = await start();
  try {
    f.seed({ id: 1, ...BODY });
    const denied = await f.check(SIN_ROL);
    assert.equal(denied.status, 403);
    assert.ok(!denied.text.includes('ana@example.test'));
    assert.equal(f.statements.filter(sql => /contactos/.test(sql)).length, 0);
    assert.equal(f.store.total(), 0);
    for (const role of ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL', 'SECRETARIA']) assert.equal(can(role, 'mensajes:crear'), true, role);
    for (const [name, id] of ROLES) {
      const res = await f.check(id);
      assert.equal(res.status, 200, name);
      assert.deepEqual(res.body, { hayCoincidencias: true, cantidad: 1 }, name);
    }
  } finally { await f.close(); }
});

test('el inventario de rutas declara POST admin/messages/duplicados con mensajes:crear, y no hay rutas repetidas ni colisiones en admin/messages', () => {
  const entry = ROUTE_INVENTORY.find(route => route.method === 'POST' && route.path === 'admin/messages/duplicados');
  assert.ok(entry, 'ruta en el inventario');
  assert.deepEqual(entry.access, { kind: 'permiso', permission: 'mensajes:crear' });
  const methodName = (code: number) => ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][code] ?? String(code);
  const routes: string[] = [];
  for (const controller of [MessagesController, MessagesDuplicadosController]) {
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
    for (const name of Object.getOwnPropertyNames(controller.prototype).filter(key => key !== 'constructor')) {
      const handler = (controller.prototype as any)[name];
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (sub === undefined) continue;
      routes.push(methodName(Reflect.getMetadata(METHOD_METADATA, handler)) + ' ' + base + (sub === '/' ? '' : '/' + sub));
    }
  }
  assert.equal(new Set(routes).size, routes.length, 'ninguna ruta repetida: ' + routes.join(' | '));
  assert.ok(routes.includes('POST admin/messages/duplicados') && routes.includes('POST admin/messages') && routes.includes('GET admin/messages/:id'));
  // «duplicados» solo se declara con POST: ningún GET/PUT/DELETE literal lo comparte, y la única ruta con parámetro es :id (GET, PUT y DELETE).
  assert.deepEqual(routes.filter(route => route.endsWith('/duplicados')), ['POST admin/messages/duplicados']);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Entrada inválida (400): se valida con las reglas del DTO de creación y no gasta cuota
// ---------------------------------------------------------------------------------------------------------------------------
test('entrada inválida: 400 sin leer contactos ni gastar cuota', async () => {
  const f = await start();
  try {
    const invalid: [string, unknown][] = [
      ['cuerpo vacío', {}],
      ['sin correo', { asunto: BODY.asunto, mensaje: BODY.mensaje }],
      ['sin asunto', { email: BODY.email, mensaje: BODY.mensaje }],
      ['sin mensaje', { email: BODY.email, asunto: BODY.asunto }],
      ['correo inválido', { ...BODY, email: 'no-es-un-correo' }],
      ['asunto solo con espacios', { ...BODY, asunto: '    ' }],
      ['mensaje solo con espacios', { ...BODY, mensaje: '\n  ' }],
      ['asunto de más de 150 caracteres', { ...BODY, asunto: 'a'.repeat(151) }],
      ['mensaje de más de 5000 caracteres', { ...BODY, mensaje: 'm'.repeat(5001) }],
      ['tipos incorrectos', { email: 5, asunto: ['x'], mensaje: {} }],
      ['campo extra: nombre', { ...BODY, nombre: 'Ana' }],
      ['campo extra: telefono', { ...BODY, telefono: '999000111' }],
      ['campo extra: search (búsqueda parcial)', { ...BODY, search: 'ana' }],
      ['campo extra: page/limit/vista', { ...BODY, page: 1, limit: 100, vista: 'resumen' }],
    ];
    for (const [name, body] of invalid) assert.equal((await f.check(SECRETARIA, body)).status, 400, name);
    assert.equal((await f.call('POST', 'admin/messages/duplicados', SECRETARIA, undefined, '{no es json')).status, 400, 'JSON malformado');
    assert.equal(f.statements.filter(sql => /contactos/.test(sql)).length, 0);
    assert.equal(f.store.total(), 0, 'una entrada inválida no gasta cuota');
    // Los parámetros de URL no existen en este contrato: se ignoran y no pueden cambiar el criterio (ni ampliarlo a una búsqueda parcial ni a más filas).
    f.seed({ id: 1, ...BODY });
    f.seed({ id: 2, email: 'luis@example.test', asunto: 'Otro', mensaje: 'Otro texto.' });
    const withParams = await f.call('POST', 'admin/messages/duplicados?search=luis&page=1&limit=100&vista=resumen&email=luis@example.test', SECRETARIA, BODY);
    assert.deepEqual(withParams.body, { hayCoincidencias: true, cantidad: 1 }, 'solo cuenta lo que dice el cuerpo');
    assert.deepEqual((await f.check(SECRETARIA, { ...BODY, email: 'zzz@example.test' })).body, { hayCoincidencias: false, cantidad: 0 });
  } finally { await f.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Coincidencias, normalización y ventana
// ---------------------------------------------------------------------------------------------------------------------------
test('coincidente y no coincidente: exige correo, asunto y mensaje iguales', async () => {
  const f = await start();
  try {
    f.seed({ id: 1, ...BODY });
    assert.deepEqual((await f.check(SECRETARIA)).body, { hayCoincidencias: true, cantidad: 1 });
    for (const [name, body] of [
      ['otro correo', { ...BODY, email: 'luis@example.test' }],
      ['otro asunto', { ...BODY, asunto: 'Otro asunto' }],
      ['otro mensaje', { ...BODY, mensaje: 'Un texto distinto.' }],
      ['mensaje solo prefijo (sin coincidencia parcial)', { ...BODY, mensaje: 'Quiero información' }],
      ['correo solo subcadena (sin coincidencia parcial)', { ...BODY, email: 'na@example.test' }],
    ] as const) assert.deepEqual((await f.check(SECRETARIA, body)).body, { hayCoincidencias: false, cantidad: 0 }, name);
  } finally { await f.close(); }
});

test('normalización: espacios de los extremos y mayúsculas no importan (igual que el algoritmo anterior); «%» y «_» son caracteres literales', async () => {
  const f = await start();
  try {
    f.seed({ id: 1, email: 'ANA@Example.TEST', asunto: 'CURSO de Prueba', mensaje: 'QUIERO información sobre el CURSO ficticio.' });
    f.seed({ id: 2, email: '  maria@example.test ', asunto: ' Taller ', mensaje: 'texto con espacios  ' });
    f.seed({ id: 3, email: 'a_a@example.test', asunto: 'Descuento 100%', mensaje: 'Pido 100% de descuento' });
    assert.equal((await f.check(SECRETARIA, { email: '  ana@example.test  ', asunto: ' curso de prueba ', mensaje: ' quiero información sobre el curso ficticio. ' })).body.cantidad, 1, 'mayúsculas y espacios de entrada');
    assert.equal((await f.check(SECRETARIA, { email: 'maria@example.test', asunto: 'taller', mensaje: 'TEXTO CON ESPACIOS' })).body.cantidad, 1, 'espacios guardados en la base');
    assert.equal((await f.check(SECRETARIA, { email: 'a_a@example.test', asunto: 'Descuento 100%', mensaje: 'Pido 100% de descuento' })).body.cantidad, 1, 'caracteres especiales literales');
    // Con LIKE, «_» y «%» actuarían como comodines y estas consultas coincidirían; con igualdad no.
    assert.equal((await f.check(SECRETARIA, { email: 'axa@example.test', asunto: 'Descuento 100%', mensaje: 'Pido 100% de descuento' })).body.cantidad, 0, '«_» no es comodín');
    assert.equal((await f.check(SECRETARIA, { email: 'a_a@example.test', asunto: 'Descuento 100%', mensaje: 'Pido %' })).body.cantidad, 0, '«%» no es comodín');
    assert.equal((await f.check(SECRETARIA, { email: '%@example.test', asunto: '%', mensaje: '%' })).body.cantidad, 0, 'un comodín no enumera registros');
  } finally { await f.close(); }
});

test('ventana de 7 días: una coincidencia más antigua no cuenta; una de hace 6 días 23 h sí', async () => {
  const f = await start();
  try {
    assert.equal(DUPLICADOS_VENTANA_MS, 7 * DAY);
    f.seed({ id: 1, ...BODY, createdAt: ago(7 * DAY + 60_000) });
    assert.deepEqual((await f.check(SECRETARIA)).body, { hayCoincidencias: false, cantidad: 0 }, 'hace 7 días y un minuto');
    f.seed({ id: 2, ...BODY, createdAt: ago(8 * DAY) });
    f.seed({ id: 3, ...BODY, createdAt: ago(7 * DAY - 3_600_000) });
    assert.deepEqual((await f.check(SECRETARIA)).body, { hayCoincidencias: true, cantidad: 1 }, 'solo la reciente');
  } finally { await f.close(); }
});

test('más de 20 candidatos con el mismo correo: la coincidencia más antigua no se pierde por un límite de filas (el algoritmo anterior miraba solo 20)', async () => {
  const f = await start();
  try {
    f.seed({ id: 1, ...BODY, createdAt: ago(5 * DAY) }); // la buscada es la MÁS antigua de todas
    for (let i = 0; i < 30; i++) f.seed({ id: 100 + i, email: BODY.email, asunto: 'Asunto ' + i, mensaje: 'Mensaje ficticio ' + i, createdAt: ago(60_000 + i * 1000) });
    const listado = await f.get('admin/messages?page=1&limit=20&search=' + encodeURIComponent(BODY.email), SECRETARIA);
    assert.ok(!listado.body.messages.some((m: any) => m.id === 1), 'precondición: el listado de 20 filas NO contiene la consulta buscada (falso negativo del algoritmo anterior)');
    assert.deepEqual((await f.check(SECRETARIA)).body, { hayCoincidencias: true, cantidad: 1 });
  } finally { await f.close(); }
});

test('muchos duplicados: la cantidad se acota a 5 (significa «5 o más»)', async () => {
  const f = await start();
  try {
    assert.equal(DUPLICADOS_MAX, 5);
    for (let i = 0; i < 8; i++) f.seed({ id: 10 + i, ...BODY, createdAt: ago(60_000 + i) });
    assert.deepEqual((await f.check(SECRETARIA)).body, { hayCoincidencias: true, cantidad: 5 });
  } finally { await f.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Privacidad y solo lectura
// ---------------------------------------------------------------------------------------------------------------------------
test('la respuesta no expone datos personales: solo { hayCoincidencias, cantidad }, 200, sin caché', async () => {
  const f = await start();
  try {
    f.seed({ id: 1, nombre: 'Persona Ficticia Uno', telefono: '988777666', ...BODY });
    f.seed({ id: 2, nombre: 'Otra Persona', telefono: '911222333', email: 'otra@example.test', asunto: 'Otro', mensaje: 'Texto privado distinto.' });
    for (const [name, id] of ROLES) {
      const res = await f.check(id);
      assert.equal(res.status, 200, name + ': 200 (es una lectura), no 201');
      assert.deepEqual(Object.keys(res.body).sort(), ['cantidad', 'hayCoincidencias'], name);
      for (const secretValue of ['ana@example.test', 'otra@example.test', 'Persona Ficticia', 'Otra Persona', '988777666', '911222333', 'Texto privado', 'Quiero información', 'Curso de prueba']) assert.ok(!res.text.includes(secretValue), name + ': no devuelve «' + secretValue + '»');
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    const none = await f.check(SECRETARIA, { ...BODY, email: 'nadie@example.test' });
    assert.deepEqual(none.body, { hayCoincidencias: false, cantidad: 0 }, 'sin coincidencias la forma es la misma');
  } finally { await f.close(); }
});

test('no escribe mensajes ni seguimientos: solo SELECT sobre contactos y los contadores de rate_limit_buckets', async () => {
  const f = await start();
  try {
    f.seed({ id: 1, ...BODY });
    f.db.prepare('INSERT INTO attention_records VALUES (?, ?, ?, ?, ?)').run('messages', 1, 'en_proceso', 'Rosa', 'NOTA-PRIVADA');
    const before = f.snapshot();
    for (let i = 0; i < 5; i++) assert.equal((await f.check(i % 2 ? SECRETARIA : GERENTE)).status, 200);
    assert.equal(f.snapshot(), before, 'contactos y attention_records idénticos');
    assert.deepEqual(f.writes, [], 'ningún modelo de seguimiento tocado');
    assert.deepEqual(f.creates, [], 'contacto.create nunca se llama');
    assert.equal(f.statements.length, 5, 'una sola consulta de lectura por comprobación (sin lecturas de seguimiento ni de otras tablas)');
    assert.ok(f.statements.every(sql => /FROM contactos m/.test(sql) && !/attention_records/.test(sql)));
    assert.equal(f.store.total(), 5, 'la única escritura es el contador del límite');
  } finally { await f.close(); }
});

test('revisión estática: SELECT parametrizado sin LIKE ni SQL sin parametrizar; el límite solo toca rate_limit_buckets', () => {
  const dir = path.join(__dirname, '..', 'src', 'admin', 'messages');
  const strip = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\/.*$/gm, '');
  const service = strip('duplicados.service.ts'), limites = strip('duplicados.limites.ts'), controller = strip('duplicados.controller.ts');
  assert.ok(!/LIKE/i.test(service), 'sin LIKE (comodines)');
  assert.ok(!/\$queryRawUnsafe|\$executeRawUnsafe/.test(service + limites));
  assert.ok(!/(prisma|tx)\.\w+\.(create|update|delete|upsert)\w*\s*\(|\$executeRaw/.test(service), 'el servicio no escribe');
  assert.ok(/INSERT INTO rate_limit_buckets/.test(limites) && !/(prisma|tx)\.\w+\.(create|update|delete|upsert)\w*\s*\(/.test(limites));
  assert.ok(!/logger\.\w+\([^)]*\b(dto|email|asunto|mensaje)\b/.test(service), 'los registros no incluyen datos del formulario');
  assert.ok(!/@Get|@Put|@Delete/.test(controller), 'el controlador nuevo solo declara POST');
});

// ---------------------------------------------------------------------------------------------------------------------------
// Límite por cuenta
// ---------------------------------------------------------------------------------------------------------------------------
test('límite por cuenta: 30 comprobaciones por ventana de 15 minutos, la 31 recibe 429 sin leer datos; otra cuenta no se ve afectada', async () => {
  assert.equal(DUPLICADOS_LIMITE_POR_VENTANA, 30);
  for (let intento = 0; intento < 2; intento++) {
    const f = await start();
    try {
      f.seed({ id: 1, ...BODY });
      const window = () => Math.floor(Date.now() / (15 * 60_000));
      const startWindow = window();
      for (let i = 0; i < 30; i++) assert.equal((await f.check(SECRETARIA)).status, 200, 'comprobación ' + (i + 1));
      const reads = f.statements.length;
      const limited = await f.check(SECRETARIA);
      if (window() !== startWindow) continue; // cruzó el límite de la ventana fija durante la prueba: se repite con datos nuevos
      assert.equal(limited.status, 429);
      assert.equal(limited.body.ok, false);
      assert.equal(limited.body.codigo, 'limite_de_uso');
      assert.ok(limited.body.reintentar_en_segundos >= 1 && limited.body.reintentar_en_segundos <= 900);
      assert.ok(!limited.text.includes('ana@example.test') && !('hayCoincidencias' in limited.body));
      assert.equal(f.statements.length, reads, 'la solicitud limitada no lee contactos');
      assert.equal(f.store.total(), 30, 'la rechazada no gasta cuota');
      assert.equal((await f.check(GERENTE)).status, 200, 'el límite es por cuenta');
      assert.equal((await f.check(SECRETARIA)).status, 429, 'sigue limitada dentro de la ventana');
      return;
    } finally { await f.close(); }
  }
  assert.fail('la ventana cambió en las dos pasadas');
});

test('límite compartido entre instancias: dos instancias con el mismo almacén y solicitudes simultáneas admiten exactamente 30', async () => {
  const store = memoryBuckets();
  const a = new MessagesDuplicadosLimites(store.prisma as PrismaService), b = new MessagesDuplicadosLimites(store.prisma as PrismaService);
  const now = new Date(Date.UTC(2026, 9, 22, 15, 0, 0));
  const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).admitir(7, now)));
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 30);
  assert.equal(rejected.length, 20);
  assert.ok(rejected.every(r => r.reason instanceof HttpException && r.reason.getStatus() === 429));
  assert.equal(store.total(), 30, 'las rechazadas no gastan cuota');
  await b.admitir(8, now); // otra cuenta
  await assert.rejects(a.admitir(7, now), (e: unknown) => e instanceof HttpException && e.getStatus() === 429);
  // Ventana nueva (15 minutos después): vuelve a admitir.
  await a.admitir(7, new Date(now.getTime() + 15 * 60_000));
});

test('si el almacén compartido falla: 503 (falla cerrada) y no se lee ningún dato', async () => {
  const f = await start({ failStore: true });
  try {
    f.seed({ id: 1, ...BODY });
    const res = await f.check(SECRETARIA);
    assert.equal(res.status, 503);
    assert.equal(res.body.codigo, 'limite_no_disponible');
    assert.ok(!res.text.includes('almacén compartido caído') && !res.text.includes('ana@example.test'), 'sin detalles internos ni datos');
    assert.equal(f.statements.filter(sql => /contactos/.test(sql)).length, 0, 'no se consultó contactos');
  } finally { await f.close(); }
});

test('el servicio llamado directamente respeta el límite y la ventana con un reloj controlado', async () => {
  const f = build();
  f.seed({ id: 1, ...BODY, createdAt: new Date(Date.UTC(2026, 9, 20, 12, 0, 0)).toISOString() });
  const service = new MessagesDuplicadosService(f.client as PrismaService, new MessagesDuplicadosLimites(f.client as PrismaService));
  const dto = { ...BODY } as any;
  assert.deepEqual(await service.comprobar(dto, 1, new Date(Date.UTC(2026, 9, 22, 12, 0, 0))), { hayCoincidencias: true, cantidad: 1 });
  assert.deepEqual(await service.comprobar(dto, 1, new Date(Date.UTC(2026, 9, 27, 11, 59, 0))), { hayCoincidencias: true, cantidad: 1 }, 'a 7 días menos un minuto');
  assert.deepEqual(await service.comprobar(dto, 1, new Date(Date.UTC(2026, 9, 27, 12, 1, 0))), { hayCoincidencias: false, cantidad: 0 }, 'a 7 días y un minuto');
  assert.deepEqual(await service.comprobar({ email: ' ANA@example.test ', asunto: ' curso DE prueba ', mensaje: 'QUIERO información SOBRE EL CURSO FICTICIO.' } as any, 1, new Date(Date.UTC(2026, 9, 22, 12, 5, 0))), { hayCoincidencias: true, cantidad: 1 }, 'el servicio normaliza aunque no pase por el DTO');
});

// ---------------------------------------------------------------------------------------------------------------------------
// Sin regresiones en las rutas existentes
// ---------------------------------------------------------------------------------------------------------------------------
test('rutas existentes sin cambios: listado completo y resumen, detalle, exportación y creación se comportan como antes', async () => {
  const f = await start();
  try {
    f.seed({ id: 1, nombre: 'Ana Ficticia', telefono: '999000111', ...BODY });
    for (const [name, id] of ROLES) {
      const full = await f.get('admin/messages?page=1&limit=20', id);
      assert.equal(full.status, 200, name);
      assert.equal(full.body.messages[0].email, 'ana@example.test', name + ': el listado sin vista conserva el correo');
      assert.equal(full.body.messages[0].telefono, '999000111');
      assert.ok(full.body.pagination && full.body.metrics);
      const summary = await f.get('admin/messages?vista=resumen&page=1&limit=20', id);
      assert.deepEqual(Object.keys(summary.body.messages[0]).sort(), ['asunto', 'createdAt', 'estado', 'id', 'nombre', 'origen', 'responsable', 'updatedAt', 'vista_previa'], name);
      assert.ok(!summary.text.includes('ana@example.test') && !summary.text.includes('999000111'));
      const detail = await f.get('admin/messages/1', id);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.message.email, 'ana@example.test');
    }
    assert.equal((await f.get('admin/messages/exportar', SECRETARIA)).status, 403, 'exportación reservada a Gerencia');
    assert.equal((await f.get('admin/messages/exportar', GERENTE)).status, 200);
    // «duplicados» NO se interpreta como identificador en GET: sigue el comportamiento de siempre de GET /:id con un valor no numérico (400 de ParseIntPipe).
    assert.equal((await f.get('admin/messages/duplicados', SECRETARIA)).status, 400);
    assert.equal((await f.call('PUT', 'admin/messages/duplicados', GERENTE, { estado: 'atendido' })).status, 400);
    // Crear una consulta sigue funcionando (POST admin/messages) y la comprobación de duplicados no la invoca.
    assert.deepEqual(f.creates, []);
    const created = await f.call('POST', 'admin/messages', SECRETARIA, { nombre: 'Luis Ficticio', ...BODY, telefono: '999000222' });
    assert.equal(created.status, 201);
    assert.equal(f.creates.length, 1);
    assert.equal((await f.call('POST', 'admin/messages', SECRETARIA, { ...BODY })).status, 400, 'POST admin/messages sigue exigiendo el nombre');
    assert.equal(f.creates.length, 1);
    await f.check(SECRETARIA);
    assert.equal(f.creates.length, 1, 'comprobar duplicados no crea nada');
  } finally { await f.close(); }
});
