'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const mysql = require('mysql2/promise');

test('H-03: HTTP y dos clientes Prisma contra MySQL propio, sin escrituras parciales', { timeout: 60000 }, async t => {
  if (process.env.CATALOGO_TEST_DB !== 'true') return t.skip('Usar exclusivamente node test/run-catalogo-isolated.cjs');
  assert.equal(process.env.DB_HOST, '127.0.0.1');
  assert.match(process.env.CATALOGO_TEST_SERVER_UUID || '', /^[0-9a-f-]{36}$/);
  const connection = { host: '127.0.0.1', port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS };
  const db = await mysql.createConnection(connection);
  const name = 'horus_h03_' + randomBytes(12).toString('hex');
  const clients = [], apps = [];
  try {
    const [[identity]] = await db.query("SELECT @@server_uuid AS uuid, VERSION() AS version, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime') AS uptime");
    assert.equal(identity.uuid, process.env.CATALOGO_TEST_SERVER_UUID); assert.match(identity.version, /^8\.4\./); assert.ok(Number(identity.uptime) < 300);
    const [schemas] = await db.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys')");
    assert.deepEqual(schemas, [], 'Se exige servidor recién creado y vacío');
    assert.match(name, /^horus_h03_[0-9a-f]{24}$/);
    await db.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await db.changeUser({ database: name });
    // Esquema real de cursos: solo las dos sentencias versionadas que lo definen.
    const initial = readFileSync(join(__dirname, '../migrations/00000000-initial.sql'), 'utf8');
    await db.query(initial.match(/CREATE TABLE IF NOT EXISTS `cursos`[\s\S]*?ENGINE=InnoDB;/)[0]);
    const original = readFileSync(join(__dirname, '../migrations/20261002-original-design.sql'), 'utf8');
    await db.query(original.split(';').find(s => /^\s*ALTER TABLE cursos /.test(s)));
    require('reflect-metadata');
    const { Module } = require('@nestjs/common');
    const { NestFactory } = require('@nestjs/core');
    const { ConfigService } = require('@nestjs/config');
    const { PrismaService } = require('../dist/database/prisma.service');
    const { CatalogoService } = require('../dist/catalogo/catalogo.service');
    const { AdminCursoController } = require('../dist/catalogo/catalogo.controllers');
    const { createValidationPipe } = require('../dist/common/validation');
    // El guard del controlador real usa Passport. Registrar la estrategia ficticia en este proceso
    // evita depender del AuthModule o de cuentas reales; no se modifica el guard de producción.
    require('passport').use('jwt', { authenticate() { this.success({ id: 1 }); } });
    let gate;
    for (let index = 0; index < 2; index++) {
      const prisma = new PrismaService(new ConfigService({ DB_HOST: connection.host, DB_PORT: connection.port, DB_USER: connection.user, DB_PASS: connection.password, DB_NAME: name }));
      clients.push(prisma); await prisma.$connect();
      assert.equal((await prisma.$queryRawUnsafe('SELECT @@server_uuid AS uuid'))[0].uuid, identity.uuid);
      // Único instrumento: retener ambas lecturas iniciales ya completadas. Bloqueo, relectura,
      // escritura, commit y rollback usan el cliente/transacción reales, sin dobles de persistencia.
      const curso = new Proxy(prisma.curso, { get(target, key) {
        if (key === 'findFirst') return async args => {
          const row = await target.findFirst(args);
          const active = gate;
          if (active && args.where.id === 1) { active.arrived++; if (active.arrived === 2) active.release(); await active.ready; }
          return row;
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
      const facade = new Proxy(prisma, { get(target, key) { if (key === 'curso') return curso; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
      class FixtureModule {}
      // Autenticación sustituida solo en este módulo de prueba; no es evidencia de AccessGuard/JWT.
      Module({ controllers: [AdminCursoController], providers: [{ provide: CatalogoService, useValue: new CatalogoService(facade) }] })(FixtureModule);
      const app = await NestFactory.create(FixtureModule, { logger: ['error'] }); apps.push(app);
      app.setGlobalPrefix('api'); app.useGlobalPipes(createValidationPipe()); await app.listen(0, '127.0.0.1');
    }
    const put = async (index, payload) => {
      const result = await fetch((await apps[index].getUrl()) + '/api/admin/cursos/1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: result.status, body: await result.json() };
    };
    const row = async () => (await db.query('SELECT * FROM cursos WHERE id=1'))[0][0];
    const seed = async () => {
      gate = null;
      await db.query('DELETE FROM cursos');
      await db.query("INSERT INTO cursos (id,titulo,slug,descripcion,tipo,modalidad,duracion,createdAt,updatedAt) VALUES (1,'Inicial','inicial','Ficticio','capacitacion','virtual','10 h',NOW(),NOW()),(2,'Otro','ocupado','Ficticio','capacitacion','virtual','10 h',NOW(),NOW())");
    };
    const race = async payloads => {
      let release; const ready = new Promise(resolve => { release = resolve; }); gate = { arrived: 0, release, ready };
      try { return await Promise.all(payloads.map((payload, i) => put(i, payload))); }
      finally { gate = null; }
    };
    await t.test('tipo frente a limpieza: un 200 y un 409, fila válida y perdedor sin cambios parciales', async () => {
      for (let iteration = 0; iteration < 6; iteration++) {
        await seed(); const before = await row();
        const payloads = [{ tipo: 'curso', titulo: 'Tipo ganador' }, { limpiar: ['modalidad', 'duracion'], titulo: 'Limpieza ganadora' }];
        const result = await race(payloads);
        assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
        const final = await row(), winner = result.findIndex(r => r.status === 200);
        assert.equal(final.titulo, payloads[winner].titulo);
        assert.equal(final.tipo, winner === 0 ? 'curso' : 'capacitacion');
        assert.equal(final.modalidad, winner === 0 ? 'virtual' : null); assert.equal(final.duracion, winner === 0 ? '10 h' : null);
        assert.equal(final.slug, before.slug); assert.equal(final.descripcion, before.descripcion);
      }
    });
    await t.test('mismo campo y updatedAt idéntico: la comparación completa sigue devolviendo 409', async () => {
      await seed();
      // Prisma @updatedAt usa reloj JS. Congelar Date en este proceso garantiza el mismo segundo,
      // conservando los motores y conexiones MySQL reales.
      const NativeDate = Date; const fixed = NativeDate.parse('2026-10-23T12:00:00Z');
      await db.query("UPDATE cursos SET updatedAt='2026-10-23 12:00:00' WHERE id=1");
      const before = await row();
      global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
      let result;
      try { result = await race([{ titulo: 'Uno' }, { titulo: 'Dos' }]); } finally { global.Date = NativeDate; }
      assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
      const final = await row();
      assert.equal(final.titulo, result[0].status === 200 ? 'Uno' : 'Dos');
      assert.equal(final.updatedAt.getTime(), before.updatedAt.getTime());
    });
    await t.test('slug duplicado: HTTP 409 y rollback íntegro; la siguiente escritura funciona', async () => {
      await seed(); const before = await row();
      const result = await put(0, { titulo: 'No debe persistir', slug: 'ocupado', limpiar: ['modalidad'] });
      assert.equal(result.status, 409); assert.deepEqual(await row(), before);
      assert.equal((await put(1, { titulo: 'Secuencial' })).status, 200);
    });
  } finally {
    for (const app of apps) await app.close();
    for (const client of clients) await client.$disconnect();
    await db.end();
    // No DROP: el runner retira únicamente su contenedor y su volumen anónimo.
  }
});
