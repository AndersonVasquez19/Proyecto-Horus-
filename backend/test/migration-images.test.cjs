const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configuration, inventory } = require('../scripts/inventory-migration-images.cjs');
const uuid = '00000000-0000-0000-0000-000000000001';
const env = { DB_HOST: '127.0.0.1', DB_PORT: '3307', DB_NAME: 'horus_db', DB_USER: 'fixture_reader', DB_PASS: 'fixture-only', DB_EXPECTED_SERVER_UUID: uuid, DB_SSL: 'false' };

test('rechaza destino remoto, otra base, UUID ausente y ejecución implícita', () => {
  for (const patch of [{ DB_HOST: 'example.invalid' }, { DB_NAME: 'otro' }, { DB_EXPECTED_SERVER_UUID: '' }, { DB_PORT: '' }, { DB_SSL: '' }]) {
    assert.throws(() => configuration({ ...env, ...patch }, ['--read-only-local']));
  }
  assert.throws(() => configuration(env, []));
  assert.throws(() => configuration(env, ['--read-only-local', '--extra']));
  assert.equal(configuration(env, ['--read-only-local']).multipleStatements, false);
});

test('TLS exige CA y verificación de identidad', () => {
  assert.throws(() => configuration({ ...env, DB_SSL: 'true' }, ['--read-only-local']));
  assert.throws(() => configuration({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, ['--read-only-local']));
  const options = configuration({ ...env, DB_SSL: 'true', DB_SSL_CA: 'fixture-ca' }, ['--read-only-local']);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.verifyIdentity, true);
});

test('identidad incorrecta detiene antes de inspeccionar columnas', async () => {
  let calls = 0;
  await assert.rejects(inventory({ query: async () => { calls++; return [[{ uuid: 'otro', db: 'horus_db' }]]; } }, uuid), /identidad/);
  assert.equal(calls, 1);
});

test('solo devuelve agregados, parametriza patrones y escapa identificadores', async () => {
  const queries = [];
  const db = { query: async (sql, values) => {
    queries.push(sql);
    if (sql.startsWith('SELECT @@')) return [[{ uuid, db: 'horus_db' }]];
    if (sql.includes('information_schema.COLUMNS')) return [[{ tableName: 'fixture`table', columnName: 'image`field' }]];
    if (sql.startsWith('SELECT COALESCE')) {
      assert.ok(sql.includes('`fixture``table`'));
      assert.ok(sql.includes('`image``field`'));
      assert.equal(values.length, 6);
      return [[{ uploads: '3', apiUploads: 2, backendUploads: 0, localhost: 1, ipv4Loopback: 0, ipv6Loopback: 0 }]];
    }
    return [[]];
  } };
  const result = await inventory(db, uuid);
  assert.deepEqual(result.fields, [{ table: 'fixture`table', field: 'image`field', uploads: 3, apiUploads: 2, backendUploads: 0, localhost: 1, ipv4Loopback: 0, ipv6Loopback: 0 }]);
  assert.ok(queries.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.ok(queries.every(sql => /^(SELECT|SET SESSION TRANSACTION|START TRANSACTION|ROLLBACK)/.test(sql)));
});

test('fallo de consulta cierra la instantánea sin devolver informe parcial', async () => {
  const queries = [];
  await assert.rejects(inventory({ query: async sql => {
    queries.push(sql);
    if (sql.startsWith('SELECT @@')) return [[{ uuid, db: 'horus_db' }]];
    if (sql.includes('information_schema.COLUMNS')) throw new Error('fixture');
    return [[]];
  } }, uuid), /fixture/);
  assert.equal(queries.at(-1), 'ROLLBACK');
});
