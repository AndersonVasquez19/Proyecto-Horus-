import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../scripts/backup-lib.cjs');
const restoreScript = join(__dirname, '..', 'scripts', 'restore.cjs');

type Row = Record<string, unknown>;
// Base simulada: registra cada consulta y responde como lo haría MySQL. Nada se conecta a un servidor.
function fakeDb(tables: Record<string, { ddl: string; rows: Row[]; pk?: string[]; extra?: Record<string, string> }>, countOverride: Record<string, number> = {}, schema = { charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }) {
  const log: string[] = [];
  const db = {
    log,
    async query(sql: string) {
      log.push(sql);
      let m: RegExpMatchArray | null;
      if (/^(SET SESSION|START TRANSACTION|ROLLBACK)/.test(sql)) return [[]];
      if (sql.startsWith('SELECT VERSION()')) return [[{ version: '8.0.36' }]];
      if (sql.includes('information_schema.SCHEMATA')) return [[{ charset: schema.charset, collation: schema.collation }]];
      if (sql.includes('information_schema.COLUMNS')) return [Object.entries(tables).flatMap(([tableName, t]) => Object.keys(t.rows[0] ?? {}).map(columnName => ({ tableName, columnName, extra: t.extra?.[columnName] ?? '' })))];
      if (sql.includes('information_schema.TABLES')) return [Object.keys(tables).sort().map(name => ({ name }))];
      if ((m = sql.match(/^SHOW CREATE TABLE `(\w+)`/))) return [[{ Table: m[1], 'Create Table': tables[m[1]].ddl }]];
      if ((m = sql.match(/^SELECT COUNT\(\*\) AS n FROM `(\w+)`/))) return [[{ n: countOverride[m[1]] ?? tables[m[1]].rows.length }]];
      if ((m = sql.match(/^SHOW KEYS FROM `(\w+)`/))) return [(tables[m[1]].pk ?? ['id']).map((Column_name, i) => ({ Column_name, Seq_in_index: i + 1 }))];
      if ((m = sql.match(/^SELECT \* FROM `(\w+)` ORDER BY .* LIMIT (\d+) OFFSET (\d+)/))) return [tables[m[1]].rows.slice(Number(m[3]), Number(m[3]) + Number(m[2]))];
      if (sql.startsWith('SELECT name FROM horus_migrations')) return [[{ name: '00000000-initial' }]];
      throw new Error('Consulta no prevista: ' + sql);
    },
  };
  return db;
}

test('valores SQL: nulos, números, texto con comillas/saltos/barras, binarios y JSON', () => {
  assert.equal(lib.sqlValue(null), 'NULL'); assert.equal(lib.sqlValue(undefined), 'NULL');
  assert.equal(lib.sqlValue(12), '12'); assert.equal(lib.sqlValue(true), '1'); assert.equal(lib.sqlValue('1.50'), "'1.50'");
  assert.equal(lib.sqlValue("O'Hara\nlínea\\fin"), "'O\\'Hara\\nlínea\\\\fin'");
  assert.equal(lib.sqlValue(Buffer.from('ab')), "X'6162'");
  assert.equal(lib.sqlValue({ a: 1 }), "'{\\\"a\\\":1}'"); // MySQL admite \" dentro de una cadena entre comillas simples
  assert.throws(() => lib.sqlValue(Infinity));
});

test('INSERT por lotes: una sentencia por línea y sin saltos de línea reales', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, texto: 'línea 1\nlínea 2' }));
  const statements: string[] = lib.insertStatements('contactos', ['id', 'texto'], rows, 2);
  assert.equal(statements.length, 3);
  for (const statement of statements) { assert.ok(!/[\r\n]/.test(statement)); assert.ok(lib.isAllowedStatement(statement)); }
  assert.throws(() => lib.insertStatements('mala`tabla', ['id'], [{ id: 1 }]), /no admitido/);
});

test('lista blanca de sentencias: solo CREATE TABLE, INSERT INTO y SET fijos', () => {
  for (const ok of ['SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS=0;', "INSERT INTO `a` (`id`) VALUES (1);", 'CREATE TABLE `a` ( `id` int NOT NULL ) ENGINE=InnoDB;']) assert.equal(lib.isAllowedStatement(ok), true, ok);
  for (const bad of ['DROP TABLE `a`;', 'DROP DATABASE horus_db;', 'USE horus_db;', 'GRANT ALL ON *.* TO x;', 'SET GLOBAL read_only=0;', 'DELETE FROM `a`;', "INSERT INTO `a` (`id`) VALUES (1)", 'TRUNCATE `a`;', 'CREATE DATABASE x;']) assert.equal(lib.isAllowedStatement(bad), false, bad);
});

test('el volcado solo lee: instantánea REPEATABLE READ de solo lectura, sin escrituras y con ROLLBACK final', async () => {
  const db = fakeDb({
    contactos: { ddl: 'CREATE TABLE `contactos` (\n  `id` int NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB', rows: Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, nombre: 'N' + i })) },
    rate_limit_buckets: { ddl: 'CREATE TABLE `rate_limit_buckets` (\n  `id` varchar(64) NOT NULL\n)', rows: [{ id: 'x' }] },
    horus_migrations: { ddl: 'CREATE TABLE `horus_migrations` (`name` varchar(190) NOT NULL)', rows: [{ name: '00000000-initial' }], pk: ['name'] },
  });
  const lines: string[] = [];
  const manifest = await lib.dumpDatabase({ db, write: async (line: string) => { lines.push(line); } });
  assert.equal(db.log[0], 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.match(db.log[1], /^START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY$/);
  assert.equal(db.log[db.log.length - 1], 'ROLLBACK');
  assert.ok(db.log.slice(2, -1).every(sql => /^(SELECT|SHOW)\b/.test(sql)), 'solo SELECT y SHOW durante el volcado');
  assert.equal(lines[0], lib.BACKUP_MAGIC);
  assert.ok(lines.filter(line => !line.startsWith('--')).every(lib.isAllowedStatement), 'todo lo escrito está en la lista blanca');
  assert.ok(lines.every(line => !/[\r\n]/.test(line)), 'una sentencia por línea');
  assert.equal(manifest.tables.find((t: { name: string }) => t.name === 'contactos').dumped, 2500);
  assert.equal(lines.filter(line => line.startsWith('INSERT INTO `contactos`')).length, 13, '2500 filas en lotes de 200');
  const ephemeral = manifest.tables.find((t: { name: string }) => t.name === 'rate_limit_buckets');
  assert.equal(ephemeral.dumped, 0, 'las cuotas temporales conservan estructura, no datos');
  assert.ok(!lines.some(line => line.startsWith('INSERT INTO `rate_limit_buckets`')));
  assert.deepEqual(manifest.migrations, ['00000000-initial']);
  assert.deepEqual(manifest.database, { charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }, 'el manifiesto registra charset y colación de la base, consultados al servidor');
  assert.ok(db.log.some(sql => /information_schema\.SCHEMATA.*DATABASE\(\)/.test(sql)));
  assert.doesNotMatch(JSON.stringify(manifest), /password|mysql:\/\//i, 'sin secretos ni cadenas de conexión');
});

test('columnas generadas: su definición queda en el CREATE TABLE, pero no se insertan (MySQL las recalcula); las demás se copian todas', async () => {
  for (const extra of ['STORED GENERATED', 'VIRTUAL GENERATED', 'PERSISTENT GENERATED']) assert.match(extra, lib.GENERATED_COLUMN);
  for (const extra of ['', 'auto_increment', 'DEFAULT_GENERATED', 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)']) assert.doesNotMatch(extra, lib.GENERATED_COLUMN, extra);
  const ddl = 'CREATE TABLE `certificados` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `matricula_id` int NOT NULL,\n  `estado` enum(\'vigente\',\'anulado\') NOT NULL,\n'
    + '  `vigente_matricula_id` int GENERATED ALWAYS AS ((case when (`estado` = _utf8mb4\'vigente\') then `matricula_id` else NULL end)) STORED,\n'
    + '  `emitido_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB';
  const db = fakeDb({
    certificados: {
      ddl, extra: { id: 'auto_increment', vigente_matricula_id: 'STORED GENERATED', emitido_at: 'DEFAULT_GENERATED' },
      rows: [
        { id: 1, matricula_id: 7, estado: 'anulado', vigente_matricula_id: null, emitido_at: '2026-10-01 10:00:00.000' },
        { id: 2, matricula_id: 7, estado: 'vigente', vigente_matricula_id: 7, emitido_at: '2026-10-02 10:00:00.000' },
      ],
    },
    contactos: { ddl: 'CREATE TABLE `contactos` (`id` int NOT NULL, `nombre` varchar(10))', rows: [{ id: 1, nombre: 'N' }] },
  });
  const lines: string[] = [];
  const manifest = await lib.dumpDatabase({ db, write: async (line: string) => { lines.push(line); } });
  assert.ok(lines.includes(lib.singleLine(ddl)), 'la columna generada se conserva en la definición');
  assert.ok(lib.isAllowedStatement(lib.singleLine(ddl)), 'su CREATE TABLE pasa la lista blanca');
  const inserts = lines.filter(line => line.startsWith('INSERT INTO `certificados`'));
  assert.deepEqual(inserts, ["INSERT INTO `certificados` (`id`,`matricula_id`,`estado`,`emitido_at`) VALUES (1,7,'anulado','2026-10-01 10:00:00.000'),(2,7,'vigente','2026-10-02 10:00:00.000');"]);
  assert.ok(lines.includes("INSERT INTO `contactos` (`id`,`nombre`) VALUES (1,'N');"), 'otras tablas: todas sus columnas');
  assert.deepEqual(manifest.tables.map((t: { name: string; dumped: number; generatedColumns?: string[] }) => [t.name, t.dumped, t.generatedColumns]), [['certificados', 2, ['vigente_matricula_id']], ['contactos', 1, undefined]]);
  assert.equal(lib.validateManifest(manifest, ''), '', 'el manifiesto con generatedColumns sigue siendo válido');
});

test('si el recuento cambia durante el volcado se aborta en lugar de entregar un respaldo incoherente', async () => {
  const db = fakeDb({ contactos: { ddl: 'CREATE TABLE `contactos` (`id` int NOT NULL)', rows: [{ id: 1 }] } }, { contactos: 5 });
  await assert.rejects(() => lib.dumpDatabase({ db, write: async () => {} }), /recuento de contactos cambió/);
  assert.equal(db.log[db.log.length - 1], 'ROLLBACK');
});

test('destino de restauración: solo horus_restore_*, nunca la base configurada ni un servidor remoto sin autorización', () => {
  const ok = { target: 'horus_restore_prueba1', live: 'horus_db', host: 'localhost', allowRemote: undefined };
  assert.equal(lib.validateRestoreTarget(ok), '');
  for (const target of ['horus_db', 'produccion', 'horus_restore_', 'HORUS_RESTORE_X', 'horus_restore_a-b', 'horus_restore_x; DROP DATABASE y', '', undefined]) assert.notEqual(lib.validateRestoreTarget({ ...ok, target }), '', String(target));
  assert.match(lib.validateRestoreTarget({ ...ok, target: 'horus_restore_x', live: 'horus_restore_x' }), /base configurada/);
  assert.match(lib.validateRestoreTarget({ ...ok, host: 'mysql.railway.internal' }), /ALLOW_RESTORE_DB/);
  assert.equal(lib.validateRestoreTarget({ ...ok, host: 'mysql.railway.internal', allowRemote: 'true' }), '');
});

// restore.cjs sin conexión: verificación de firma/contenido y validaciones previas. Proceso aislado (sin .env ni Prisma).
function runRestore(args: string[]) {
  const cwd = realpathSync(tmpdir());
  return spawnSync(process.execPath, [restoreScript, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', DB_NAME: 'horus_db', DB_HOST: 'localhost' } });
}
test('restore: verifica firma y contenido sin conectarse; rechaza manipulaciones, sentencias ajenas y destinos no aislados', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'horus-backup-test-'));
  try {
    const write = (name: string, body: string, sign = true) => {
      const file = join(dir, name); const data = gzipSync(body);
      writeFileSync(file, data); if (sign) writeFileSync(file + '.sha256', createHash('sha256').update(data).digest('hex') + '  ' + name + '\n');
      return file;
    };
    const good = write('ok.sql.gz', [lib.BACKUP_MAGIC, '-- comentario', 'SET NAMES utf8mb4;', 'CREATE TABLE `a` ( `id` int NOT NULL ) ENGINE=InnoDB;', "INSERT INTO `a` (`id`) VALUES (1);", ''].join('\n'));
    let result = runRestore(['--file=' + good, '--verify-only']);
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Respaldo íntegro.*3 sentencias/);
    result = runRestore(['--file=' + good, '--target=horus_db', '--yes']);
    assert.equal(result.status, 1); assert.match(result.stderr, /horus_restore_/);
    result = runRestore(['--file=' + good, '--target=horus_restore_ok']);
    assert.equal(result.status, 1); assert.match(result.stderr, /--yes/, 'sin --yes no se hace nada');
    const hostile = write('hostil.sql.gz', [lib.BACKUP_MAGIC, 'DROP DATABASE horus_db;', ''].join('\n'));
    result = runRestore(['--file=' + hostile, '--verify-only']);
    assert.equal(result.status, 1); assert.match(result.stderr, /no permitida/);
    const unsigned = write('sinfirma.sql.gz', lib.BACKUP_MAGIC + '\n', false);
    result = runRestore(['--file=' + unsigned, '--verify-only']);
    assert.equal(result.status, 1); assert.match(result.stderr, /sha256/);
    writeFileSync(good, gzipSync(lib.BACKUP_MAGIC + '\nSET NAMES utf8mb4;\n'));
    result = runRestore(['--file=' + good, '--verify-only']);
    assert.equal(result.status, 1); assert.match(result.stderr, /no coincide/, 'un archivo modificado tras firmarse se rechaza');
    const corrupt = join(dir, 'roto.sql.gz'); writeFileSync(corrupt, Buffer.from('no es gzip')); writeFileSync(corrupt + '.sha256', createHash('sha256').update(Buffer.from('no es gzip')).digest('hex') + '  roto.sql.gz\n');
    result = runRestore(['--file=' + corrupt, '--verify-only']);
    assert.equal(result.status, 1); assert.match(result.stderr, /comprimido|dañado/);
    assert.doesNotMatch(result.stderr + result.stdout, /password|DB_PASS|ECONN/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('lista blanca estricta: ni subconsultas, ni SELECT, ni opciones de archivo, ni sentencias encadenadas pasan aunque empiecen bien', () => {
  const hostile = [
    "INSERT INTO `a` (`id`) VALUES ((SELECT LOAD_FILE('/etc/hosts')));",
    "INSERT INTO `a` (`id`) VALUES ((SELECT password FROM admin_users LIMIT 1));",
    "INSERT INTO `a` (`id`) VALUES (1); DROP TABLE `b`;",
    "INSERT INTO `a` (`id`) SELECT 1;",
    "INSERT INTO `a` (`id`) VALUES (1) ON DUPLICATE KEY UPDATE `id` = 2;",
    "CREATE TABLE `a` (`id` int) SELECT * FROM admin_users;",
    "CREATE TABLE `a` (`id` int) DATA DIRECTORY='/tmp';",
    "CREATE TABLE `a` (`id` int); DROP TABLE `b`;",
    "CREATE TABLE `a` (`id` int) /* oculto */;",
  ];
  for (const statement of hostile) assert.equal(lib.isAllowedStatement(statement), false, statement);
  // Lo que genera el propio volcado sigue pasando: texto con comillas, barras, saltos, números, NULL, binarios y una línea real de ~0,6 MB.
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, texto: "línea 'comillas' \\ y \n " + 'x'.repeat(3000), nulo: null, real: -1.5e-7, bin: Buffer.from('ab') }));
  const [statement] = lib.insertStatements('t', ['id', 'texto', 'nulo', 'real', 'bin'], rows);
  assert.ok(statement.length > 500_000); assert.equal(lib.isAllowedStatement(statement), true);
  assert.equal(lib.isAllowedStatement("CREATE TABLE `c` ( `id` int NOT NULL AUTO_INCREMENT, `n` varchar(10) DEFAULT 'SELECT x', PRIMARY KEY (`id`) ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"), true, 'una palabra reservada dentro de una cadena no es una construcción');
});

test('manifiesto no confiable: nombres con comillas, tipos erróneos o una firma distinta se rechazan antes de consultar nada', () => {
  const ok = { tables: [{ name: 'contactos', rows: 1, dumped: 1 }], sha256: 'abc' };
  assert.equal(lib.validateManifest(ok, 'abc'), '');
  assert.equal(lib.validateManifest({ tables: [{ name: 'a`; DROP DATABASE x; --', dumped: 1 }] }, 'abc') !== '', true);
  assert.notEqual(lib.validateManifest({ tables: [{ name: 'a', dumped: -1 }] }, 'abc'), '');
  assert.notEqual(lib.validateManifest({ tables: [{ name: 'a', dumped: '1' }] }, 'abc'), '');
  assert.notEqual(lib.validateManifest({ tables: 'no' }, 'abc'), '');
  assert.notEqual(lib.validateManifest(null, 'abc'), '');
  assert.match(lib.validateManifest(ok, 'otra'), /no corresponde/);
});

test('restore: un manifiesto manipulado detiene todo antes de conectarse', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'horus-backup-test-'));
  try {
    const body = gzipSync([lib.BACKUP_MAGIC, 'SET NAMES utf8mb4;', ''].join('\n'));
    const file = join(dir, 'ok.sql.gz'); writeFileSync(file, body);
    const hash = createHash('sha256').update(body).digest('hex'); writeFileSync(file + '.sha256', hash + '  ok.sql.gz\n');
    for (const manifest of ['{ no es json', JSON.stringify({ tables: [{ name: 'x`; DROP DATABASE y; --', dumped: 1 }] }), JSON.stringify({ tables: [], sha256: 'f'.repeat(64) })]) {
      writeFileSync(file + '.manifest.json', manifest);
      const result = runRestore(['--file=' + file, '--target=horus_restore_ok', '--yes']);
      assert.equal(result.status, 1, manifest); assert.match(result.stderr, /manifiesto/i);
      assert.doesNotMatch(result.stderr, /No se pudo restaurar/, 'falló por el manifiesto, no por intentar conectar');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('colación: un manifiesto antiguo (sin database) sigue siendo válido y restaura con el valor histórico', () => {
  const old = { tables: [{ name: 'contactos', rows: 1, dumped: 1 }], sha256: 'abc' };
  assert.equal(lib.validateManifest(old, 'abc'), '');
  assert.deepEqual(lib.restoreDatabaseDefaults(old), { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci', recorded: false });
  assert.deepEqual(lib.restoreDatabaseDefaults(null), { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci', recorded: false }, 'sin archivo de manifiesto');
});

test('colación: los valores registrados se conservan tal cual (0900_ai_ci y unicode_ci)', () => {
  for (const collation of ['utf8mb4_0900_ai_ci', 'utf8mb4_unicode_ci']) {
    const manifest = { tables: [], database: { charset: 'utf8mb4', collation } };
    assert.equal(lib.validateManifest(manifest, 'abc'), '');
    assert.deepEqual(lib.restoreDatabaseDefaults(manifest), { charset: 'utf8mb4', collation, recorded: true });
  }
});

test('colación: valores maliciosos o inválidos en el manifiesto se rechazan antes de cualquier SQL', () => {
  const bad = [
    { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci`; DROP DATABASE x; --' },
    { charset: "utf8mb4' OR '1", collation: 'utf8mb4_unicode_ci' },
    { charset: 'utf8mb4', collation: 'UTF8MB4_UNICODE_CI' },
    { charset: 'utf8mb4', collation: 'latin1_swedish_ci' },
    { charset: 'utf8mb4', collation: '' }, { charset: '', collation: '' },
    { charset: 'utf8mb4', collation: 5 }, { charset: ['utf8mb4'], collation: 'utf8mb4_unicode_ci' },
    { charset: 'utf8mb4', collation: 'utf8mb4_' + 'a'.repeat(70) }, null, 'utf8mb4_unicode_ci', {},
  ];
  for (const database of bad) assert.match(lib.validateManifest({ tables: [], database }, 'abc'), /colación no válidos/, JSON.stringify(database));
});

test('colación: restore con un manifiesto de colación hostil se detiene antes de conectarse', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'horus-backup-test-'));
  try {
    const body = gzipSync([lib.BACKUP_MAGIC, 'SET NAMES utf8mb4;', ''].join('\n'));
    const file = join(dir, 'ok.sql.gz'); writeFileSync(file, body);
    writeFileSync(file + '.sha256', createHash('sha256').update(body).digest('hex') + '  ok.sql.gz\n');
    writeFileSync(file + '.manifest.json', JSON.stringify({ tables: [], database: { charset: 'utf8mb4', collation: 'x`; DROP DATABASE y; --' } }));
    const result = runRestore(['--file=' + file, '--target=horus_restore_ok', '--yes']);
    assert.equal(result.status, 1); assert.match(result.stderr, /colación no válidos/);
    assert.doesNotMatch(result.stderr, /No se pudo restaurar/, 'falló por el manifiesto, no por intentar conectar');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('integridad referencial tras restaurar: una consulta explícita por clave foránea declarada (simples y compuestas), identificadores escapados', async () => {
  const fk = (tableName: string, name: string, cols: [string, string][], refTable: string, refSchema = 'horus_restore_x') => cols.map(([columnName, refColumn]) => ({ tableName, name, columnName, refSchema, refTable, refColumn }));
  const keyRows = [
    ...fk('convocatorias', 'convocatorias_curso_fk', [['curso_id', 'id']], 'cursos'),
    ...fk('certificados', 'certificados_sustituye_fk', [['sustituye_a_id', 'id'], ['matricula_id', 'matricula_id']], 'certificados'),
    ...fk('raro`tabla', 'raro_fk', [['col`x', 'id']], 'cursos'),
  ];
  const orphans: Record<string, number> = { convocatorias: 1, certificados: 0, 'raro`tabla': 0 };
  const log: { sql: string; params?: unknown[] }[] = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      log.push({ sql, params });
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [keyRows];
      if (sql.includes('information_schema.TABLES')) return [['convocatorias', 'cursos', 'certificados', 'raro`tabla'].map(name => ({ name }))];
      const m = sql.match(/^SELECT COUNT\(\*\) AS n FROM `horus_restore_x`\.`((?:[^`]|``)+)` AS c WHERE/);
      if (m) return [[{ n: orphans[m[1].replace(/``/g, '`')] }]];
      throw new Error('Consulta no prevista: ' + sql);
    },
  };
  const result = await lib.referentialIntegrity(db, 'horus_restore_x');
  assert.ok(log.every(entry => !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|SET)\b/.test(entry.sql)), 'solo lee');
  assert.deepEqual(log[0].params, ['horus_restore_x'], 'el esquema va como parámetro');
  assert.deepEqual(result.checked.map((key: { name: string; columns: string[] }) => key.name + ':' + key.columns.join('+')), ['convocatorias_curso_fk:curso_id', 'certificados_sustituye_fk:sustituye_a_id+matricula_id', 'raro_fk:col`x']);
  const composite = log.find(entry => entry.sql.includes('`certificados` AS c'))!.sql;
  assert.equal(composite, 'SELECT COUNT(*) AS n FROM `horus_restore_x`.`certificados` AS c WHERE c.`sustituye_a_id` IS NOT NULL AND c.`matricula_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `horus_restore_x`.`certificados` AS p WHERE p.`id` = c.`sustituye_a_id` AND p.`matricula_id` = c.`matricula_id`)', 'clave compuesta: todas las columnas a la vez y MATCH SIMPLE (NULL no se comprueba)');
  assert.ok(log.some(entry => entry.sql.includes('`raro``tabla` AS c WHERE c.`col``x` IS NOT NULL')), 'comillas inversas duplicadas');
  assert.deepEqual(result.problems.map((p: { relation: string; reason: string }) => p.relation + ': ' + p.reason), ['convocatorias(curso_id) → cursos(id) [convocatorias_curso_fk]: 1 fila huérfana']);

  // Referencia a otra base o a una tabla ausente: fallo sin consultar fuera de la copia.
  const strange = [...fk('a', 'a_fk', [['b_id', 'id']], 'b', 'horus_db'), ...fk('c', 'c_fk', [['d_id', 'id']], 'tabla_ausente')];
  const log2: string[] = [];
  const db2 = { async query(sql: string) { log2.push(sql); if (sql.includes('KEY_COLUMN_USAGE')) return [strange]; if (sql.includes('information_schema.TABLES')) return [[{ name: 'a' }, { name: 'c' }]]; throw new Error('Consulta no prevista: ' + sql); } };
  const result2 = await lib.referentialIntegrity(db2, 'horus_restore_x');
  assert.deepEqual(result2.problems.map((p: { name: string; reason: string }) => p.name + ': ' + p.reason), ['a_fk: referencia otra base de datos', 'c_fk: la tabla referenciada no existe en la copia']);
  assert.ok(!log2.some(sql => sql.includes('horus_db')), 'nunca consulta la otra base');
});
