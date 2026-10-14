import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Comprobaciones sin base de datos: el orden, el registro y la seguridad de las migraciones SQL. La aplicación real se prueba en test:integration (MySQL aislado).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { versions } = require('../scripts/migrate.cjs') as { versions: string[] };
const dir = join(__dirname, '..', 'migrations');
const read = (name: string) => readFileSync(join(dir, name + '.sql'), 'utf8');
const statements = (sql: string) => sql.split(';').map(s => s.trim()).filter(Boolean); // mismo criterio que scripts/migrate.cjs
// UPDATE existentes y justificados: 1) deja en NULL referencias huérfanas antes de crear la clave foránea; 2) deriva `origen` de los contactos del chatbot ya guardados.
// Migraciones obligatorias y su orden relativo de ejecución. Si una desaparece de `versions` o se reordena, la prueba falla; las migraciones NUEVAS se añaden
// al final de `versions` sin tocar esta lista (no hay que mantener ninguna como «la última»). Añade aquí una migración solo si pasa a ser obligatoria.
const REQUIRED_ORDER = ['20260909-create-catalogo', '20260921-create-cotizaciones', '20261002-complete-institutional', '20261002-original-design', '20261002-create-convenios',
  '20261003-remove-otros-category', '20261009-chatbot-metrics', '20261010-newsletter-default-novedades', '20261011-cotizaciones-idempotencia'];
// Las que el código desplegado necesita ya aplicadas (RAILWAY.md debe decirlo): el cliente Prisma selecciona sus columnas.
const REQUIRED_BEFORE_DEPLOY = ['20261009-chatbot-metrics', '20261011-cotizaciones-idempotencia', '20261014-admin-rol'];
const ALLOWED_UPDATES = new Set(['20261002-complete-institutional', '20261009-chatbot-metrics']);

test('migraciones: cada archivo SQL está registrado en migrate.cjs y viceversa, sin duplicados', () => {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => f.slice(0, -4)).filter(f => f !== '00000000-initial'); // la inicial la aplica db:init
  assert.deepEqual([...files].sort(), [...versions].sort());
  assert.equal(new Set(versions).size, versions.length);
});

test('migraciones: el orden de ejecución es el de migrate.cjs y sus fechas nunca retroceden', () => {
  const dates = versions.map(v => v.slice(0, 8));
  assert.ok(versions.every(v => /^\d{8}-[a-z0-9-]+$/.test(v)));
  assert.deepEqual([...dates].sort(), dates, 'una migración nueva va siempre al final');
});

test('migraciones: todas las obligatorias siguen registradas y en su orden relativo (aunque se añadan migraciones posteriores)', () => {
  const positions = REQUIRED_ORDER.map(name => versions.indexOf(name));
  REQUIRED_ORDER.forEach((name, i) => assert.notEqual(positions[i], -1, name + ' ya no está registrada en migrate.cjs'));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'las migraciones obligatorias cambiaron de orden: ' + REQUIRED_ORDER.join(' < '));
  assert.ok(new Set(positions).size === positions.length);
  for (const name of REQUIRED_ORDER) assert.ok(read(name).trim().length > 0, name + ' está vacía o no existe');
});

test('migraciones: no borran estructura ni datos y los UPDATE están autorizados', () => {
  for (const name of versions) {
    for (const statement of statements(read(name))) {
      assert.ok(!/^(DROP|TRUNCATE|DELETE|RENAME)\b/i.test(statement) && !/\bDROP\s+(TABLE|DATABASE|COLUMN|INDEX)\b/i.test(statement), name + ': sentencia destructiva');
      if (/^UPDATE\b/i.test(statement)) assert.ok(ALLOWED_UPDATES.has(name), name + ': UPDATE no autorizado');
      if (/^INSERT\b/i.test(statement)) assert.fail(name + ': las migraciones no insertan datos de ejemplo');
      assert.ok(/^(ALTER TABLE|CREATE TABLE|CREATE INDEX|UPDATE|SET)\b/i.test(statement), name + ': sentencia no reconocida: ' + statement.slice(0, 40));
    }
    assert.ok(statements(read(name)).length > 0, name + ' está vacía');
  }
});

test('migraciones: la 20261009 y la 20261011 están reflejadas en schema.prisma y en db:check; la documentación de despliegue nombra todas y declara las obligatorias', () => {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8'), check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  for (const column of ['idempotencia_clave', 'idempotencia_huella']) {
    assert.ok(read('20261011-cotizaciones-idempotencia').includes(column) && schema.includes(column) && check.includes(column), column);
  }
  for (const table of ['chatbot_interacciones', 'chatbot_preguntas_sin_respuesta']) assert.ok(read('20261009-chatbot-metrics').includes(table) && schema.includes(table) && check.includes(table), table);
  const railway = readFileSync(join(__dirname, '..', '..', 'RAILWAY.md'), 'utf8');
  for (const name of versions) assert.ok(railway.includes(name), 'RAILWAY.md debe nombrar ' + name);
  // El requisito «antes de desplegar» debe constar junto a esas migraciones, sin importar cuál sea la última de la lista.
  const statement = railway.split(/\r?\n/).find(line => /requeridas? antes de desplegar/i.test(line)) ?? '';
  for (const name of REQUIRED_BEFORE_DEPLOY) assert.ok(statement.includes(name), 'RAILWAY.md debe declarar ' + name + ' como requerida antes de desplegar');
});

test('migraciones: la 20261014 añade solo la columna rol (nula, sin valor predeterminado) y está reflejada en schema.prisma y db:check', () => {
  const sql = statements(read('20261014-admin-rol'));
  assert.equal(sql.length, 1);
  assert.match(sql[0], /^ALTER TABLE admin_users ADD COLUMN rol ENUM\('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA'\) NULL$/);
  assert.ok(!/DEFAULT/i.test(sql[0]), 'ningún rol se concede de forma implícita');
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8'), check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  assert.match(schema, /\r?\n  rol AdminRol\?\r?\n/);
  assert.ok(!/rol AdminRol[^\n]*@default/.test(schema));
  assert.ok(check.includes("['admin_users','rol',") && check.includes('GERENTE_GENERAL'));
  assert.ok(versions.indexOf('20261014-admin-rol') > versions.indexOf('20261011-cotizaciones-idempotencia'));
});

test('migraciones: la 20261011 es aditiva y admite filas existentes (columnas nulas, índice único que tolera varios NULL)', () => {
  const sql = statements(read('20261011-cotizaciones-idempotencia'));
  assert.equal(sql.length, 3);
  assert.ok(sql.slice(0, 2).every(s => /^ALTER TABLE cotizaciones ADD COLUMN idempotencia_\w+ \w+\(\d+\) NULL$/.test(s)));
  assert.match(sql[2], /^ALTER TABLE cotizaciones ADD UNIQUE KEY cotizaciones_idempotencia_clave \(idempotencia_clave\)$/);
});
