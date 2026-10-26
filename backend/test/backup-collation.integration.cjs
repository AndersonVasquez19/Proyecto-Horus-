// Integración de la colación en db:backup / db:restore contra un MySQL REAL y DESECHABLE. No forma parte de `npm test` (que no requiere MySQL).
// Ejecución explícita: BACKUP_COLLATION_TEST_DB=true node --test test/backup-collation.integration.cjs  (con DB_* de un servidor de pruebas).
// Solo crea y elimina bases propias: horus_collation_src_<hex> (origen) y horus_restore_col_<hex> (restauraciones); nunca toca DB_NAME ni otras bases.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, realpathSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');

const backend = join(__dirname, '..');
const hex = () => randomBytes(6).toString('hex');

test('db:backup / db:restore conservan la colación de la base original en un MySQL desechable', async t => {
  if (process.env.BACKUP_COLLATION_TEST_DB !== 'true') return t.skip('Requiere BACKUP_COLLATION_TEST_DB=true y un MySQL desechable.');
  const host = process.env.DB_HOST || 'localhost';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'solo servidores locales');
  const admin = await mysql.createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS });
  const created = [];
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'horus-collation-'));
  const run = (script, args, extraEnv = {}) => spawnSync(process.execPath, [join(backend, 'scripts', script), ...args], { cwd: backend, encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  const q = async sql => (await admin.query(sql))[0];
  const collationOf = async db => (await q("SELECT DEFAULT_COLLATION_NAME c FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='" + db + "'"))[0]?.c;
  const tableCollation = async (db, table) => (await q("SELECT TABLE_COLLATION c FROM information_schema.TABLES WHERE TABLE_SCHEMA='" + db + "' AND TABLE_NAME='" + table + "'"))[0].c;
  const backupOf = async collation => {
    const src = 'horus_collation_src_' + hex(); created.push(src);
    await q('CREATE DATABASE `' + src + '` CHARACTER SET utf8mb4 COLLATE ' + collation);
    await q('CREATE TABLE `' + src + '`.`t` (id INT PRIMARY KEY, v VARCHAR(20))');
    await q("INSERT INTO `" + src + "`.`t` VALUES (1,'uno'),(2,'dos')");
    const out = join(dir, collation); const result = run('backup.cjs', ['--dir=' + out], { DB_NAME: src });
    assert.equal(result.status, 0, result.stderr);
    const file = join(out, readdirSync(out).find(name => name.endsWith('.sql.gz')));
    return { src, file, manifestFile: file + '.manifest.json' };
  };
  const restore = (file, target) => run('restore.cjs', ['--file=' + file, '--target=' + target, '--yes'], { DB_NAME: 'horus_collation_no_usada' });
  try {
    const server = (await q('SELECT VERSION() v'))[0].v;
    t.diagnostic('Servidor de pruebas: MySQL ' + server);
    for (const collation of ['utf8mb4_0900_ai_ci', 'utf8mb4_unicode_ci']) {
      await t.test('se conserva ' + collation, async () => {
        const { src, file, manifestFile } = await backupOf(collation);
        assert.deepEqual(JSON.parse(readFileSync(manifestFile, 'utf8')).database, { charset: 'utf8mb4', collation });
        const verify = run('restore.cjs', ['--file=' + file, '--verify-only']);
        assert.equal(verify.status, 0, verify.stderr);
        const target = 'horus_restore_col_' + hex(); created.push(target);
        const result = restore(file, target);
        assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Recuentos verificados/);
        assert.equal(await collationOf(target), collation);
        assert.equal(await tableCollation(target, 't'), await tableCollation(src, 't'), 'la tabla restaurada conserva la de la original');
        await q('CREATE TABLE `' + target + '`.`nueva` (id INT)');
        assert.equal(await tableCollation(target, 'nueva'), collation, 'una tabla posterior hereda la colación predeterminada de la base');
      });
    }
    await t.test('copia anterior sin metadatos: valor histórico y aviso', async () => {
      const { file, manifestFile } = await backupOf('utf8mb4_0900_ai_ci');
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); delete manifest.database; writeFileSync(manifestFile, JSON.stringify(manifest));
      const target = 'horus_restore_col_' + hex(); created.push(target);
      const result = restore(file, target);
      assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /no registra la colación/);
      assert.equal(await collationOf(target), 'utf8mb4_unicode_ci');
    });
    await t.test('colación no admitida: error claro y no se crea la base', async () => {
      const { file, manifestFile } = await backupOf('utf8mb4_unicode_ci');
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); manifest.database = { charset: 'utf8mb4', collation: 'utf8mb4_zz_inexistente_ci' }; writeFileSync(manifestFile, JSON.stringify(manifest));
      const target = 'horus_restore_col_' + hex();
      const result = restore(file, target);
      assert.equal(result.status, 1); assert.match(result.stderr, /no admite la colación «utf8mb4_zz_inexistente_ci»/);
      assert.equal(await collationOf(target), undefined, 'la base de destino no se creó');
    });
    await t.test('colación maliciosa: se rechaza antes de ejecutar SQL', async () => {
      const { file, manifestFile } = await backupOf('utf8mb4_unicode_ci');
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); manifest.database = { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci; DROP DATABASE mysql' }; writeFileSync(manifestFile, JSON.stringify(manifest));
      const target = 'horus_restore_col_' + hex();
      const result = restore(file, target);
      assert.equal(result.status, 1); assert.match(result.stderr, /colación no válidos/);
      assert.equal(await collationOf(target), undefined);
    });
  } finally {
    for (const name of created) await admin.query('DROP DATABASE IF EXISTS `' + name + '`').catch(() => {});
    await admin.end().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});
