// Lógica de respaldo y restauración de MySQL (sin conexión propia: recibe la conexión o el escritor). Se prueba con dobles en test/backup-lib.test.ts.
// Formato del respaldo (.sql.gz): UNA sentencia por línea, solo CREATE TABLE, INSERT INTO y unos pocos SET. Nunca DROP, GRANT ni USE.
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { escape } = require('mysql2');

const BACKUP_MAGIC = '-- horus-backup v1';
const INSERT_BATCH_ROWS = 200;
const PAGE_ROWS = 1000;
// Cuotas temporales: se conserva la estructura pero no los datos (caducan en minutos y no tienen valor de respaldo).
const EPHEMERAL_TABLES = new Set(['rate_limit_buckets']);
const FIXED_STATEMENTS = new Set(['SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS=0;', 'SET UNIQUE_CHECKS=0;', 'SET FOREIGN_KEY_CHECKS=1;', 'SET UNIQUE_CHECKS=1;']);
const IDENT = /^[A-Za-z0-9_$]+$/;
// Nombres de charset y colación de MySQL/MariaDB (p. ej. utf8mb4, utf8mb4_0900_ai_ci): minúsculas, números y guion bajo.
const NAME_PART = /^[a-z0-9_]{1,64}$/;
// Valores de las copias anteriores, que no registraban la colación.
const FALLBACK_DATABASE = { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' };

const quoteId = name => { if (!IDENT.test(name)) throw new Error('Nombre de tabla o columna no admitido.'); return '`' + name + '`'; };

// Un valor SQL literal. Las fechas llegan como texto (dateStrings) y el JSON también (jsonStrings), así que se respeta el valor original.
function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return value.length ? "X'" + value.toString('hex') + "'" : "''";
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Valor numérico no finito.'); return String(value); }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return escape(value.toISOString().slice(0, 19).replace('T', ' '));
  if (typeof value === 'object') return escape(JSON.stringify(value));
  return escape(String(value));
}

function insertStatements(table, columns, rows, batchSize = INSERT_BATCH_ROWS) {
  const head = 'INSERT INTO ' + quoteId(table) + ' (' + columns.map(quoteId).join(',') + ') VALUES ';
  const statements = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    statements.push(head + chunk.map(row => '(' + columns.map(column => sqlValue(row[column])).join(',') + ')').join(',') + ';');
  }
  return statements;
}

// El DDL de SHOW CREATE TABLE ocupa varias líneas; el formato exige una por sentencia.
const singleLine = ddl => ddl.replace(/\r?\n\s*/g, ' ').trim() + ';';

// Los INSERT que genera este formato solo contienen literales: NULL, números, cadenas entre comillas simples (con \x o '') y binarios X'..'.
// Se valida la línea COMPLETA, no solo su inicio: una subconsulta, un SELECT o una segunda sentencia dentro de un VALUES no pasan.
const LITERAL = String.raw`(?:NULL|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|'[^'\\]*(?:(?:\\[\s\S]|'')[^'\\]*)*'|X'(?:[0-9a-fA-F]{2})*')`;
const TUPLE = '\\(' + LITERAL + '(?:,' + LITERAL + ')*\\)';
const INSERT_LINE = new RegExp('^INSERT INTO `[A-Za-z0-9_$]+` \\(`[A-Za-z0-9_$]+`(?:,`[A-Za-z0-9_$]+`)*\\) VALUES ' + TUPLE + '(?:,' + TUPLE + ')*;$');
const QUOTED = /'[^'\\]*(?:(?:\\[\s\S]|'')[^'\\]*)*'|`[^`]*`/g;
// Fuera de cadenas e identificadores, un CREATE TABLE de este esquema no usa estas construcciones (leen otras tablas, archivos del servidor o encadenan sentencias).
const FORBIDDEN_DDL = /\b(SELECT|UNION|LOAD_FILE|OUTFILE|DUMPFILE|DATA\s+DIRECTORY|INDEX\s+DIRECTORY|CONNECTION|INFILE)\b/i;

function isAllowedStatement(line) {
  if (FIXED_STATEMENTS.has(line)) return true;
  if (/^INSERT INTO /.test(line)) return INSERT_LINE.test(line);
  if (/^CREATE TABLE `[A-Za-z0-9_$]+` \(/.test(line) && line.endsWith(';')) {
    const bare = line.slice(0, -1).replace(QUOTED, '""');
    return !bare.includes(';') && !FORBIDDEN_DDL.test(bare) && !/--|\/\*/.test(bare);
  }
  return false;
}

// El manifiesto es JSON de un archivo no confiable: sus nombres acaban en consultas, así que se validan antes de usarlos.
function validateManifest(manifest, hash) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.tables)) return 'El manifiesto no tiene el formato esperado.';
  for (const table of manifest.tables) {
    if (!table || !IDENT.test(String(table.name)) || !Number.isInteger(table.dumped) || table.dumped < 0) return 'El manifiesto contiene una tabla no válida.';
  }
  if (manifest.sha256 && hash && manifest.sha256 !== hash) return 'El manifiesto no corresponde a este respaldo (firma distinta).';
  // `database` es opcional (las copias anteriores no lo tienen), pero si existe debe ser válido: acabará en un CREATE DATABASE.
  if (manifest.database !== undefined) {
    const { charset, collation } = manifest.database || {};
    if (!NAME_PART.test(String(charset)) || !NAME_PART.test(String(collation)) || typeof charset !== 'string' || typeof collation !== 'string' || !collation.startsWith(charset + '_')) return 'El manifiesto contiene un juego de caracteres o una colación no válidos.';
  }
  return '';
}

// Charset y colación con los que crear la base restaurada. Sin manifiesto o sin el campo (copia anterior) se usa el valor histórico y se indica.
function restoreDatabaseDefaults(manifest) {
  if (manifest && manifest.database) return { ...manifest.database, recorded: true };
  return { ...FALLBACK_DATABASE, recorded: false };
}

// Volcado consistente: una transacción de solo lectura con instantánea REPEATABLE READ. No bloquea tablas ni escribe nada en el servidor.
async function dumpDatabase({ db, write, includeEphemeral = false, now = new Date() }) {
  const manifest = { format: 'horus-backup/1', createdAt: now.toISOString(), tables: [], migrations: [] };
  await db.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const [[version]] = await db.query('SELECT VERSION() AS version');
    manifest.server = String(version.version).split('-')[0];
    // Valores por defecto de la base (los heredan las tablas que se creen después). Se consultan al servidor, no se deducen de las tablas.
    const [[defaults]] = await db.query('SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()');
    if (!defaults || !NAME_PART.test(String(defaults.charset)) || !NAME_PART.test(String(defaults.collation))) throw new Error('No se pudo leer el juego de caracteres y la colación de la base.');
    manifest.database = { charset: String(defaults.charset), collation: String(defaults.collation) };
    await write(BACKUP_MAGIC);
    await write('-- Contiene datos personales y hashes de contraseñas: guárdalo cifrado y fuera del repositorio.');
    for (const statement of ['SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS=0;', 'SET UNIQUE_CHECKS=0;']) await write(statement);
    const [tables] = await db.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    for (const { name } of tables) {
      const id = quoteId(name);
      const [[ddl]] = await db.query('SHOW CREATE TABLE ' + id);
      await write(singleLine(ddl['Create Table']));
      const [[count]] = await db.query('SELECT COUNT(*) AS n FROM ' + id);
      const expected = Number(count.n);
      let dumped = 0;
      if (!(EPHEMERAL_TABLES.has(name) && !includeEphemeral)) {
        const [keys] = await db.query('SHOW KEYS FROM ' + id + " WHERE Key_name = 'PRIMARY'");
        const order = keys.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index)).map(key => quoteId(key.Column_name));
        for (let offset = 0; ; offset += PAGE_ROWS) {
          const paging = order.length ? ' ORDER BY ' + order.join(',') + ' LIMIT ' + PAGE_ROWS + ' OFFSET ' + offset : '';
          const [rows] = await db.query('SELECT * FROM ' + id + paging);
          if (rows.length) for (const statement of insertStatements(name, Object.keys(rows[0]), rows)) await write(statement);
          dumped += rows.length;
          if (!order.length || rows.length < PAGE_ROWS) break;
        }
        if (dumped !== expected) throw new Error('El recuento de ' + name + ' cambió durante el volcado (' + dumped + ' de ' + expected + ').');
      }
      manifest.tables.push({ name, rows: expected, dumped });
    }
    if (tables.some(table => table.name === 'horus_migrations')) {
      const [applied] = await db.query('SELECT name FROM horus_migrations ORDER BY name');
      manifest.migrations = applied.map(row => row.name);
    }
    await write('SET UNIQUE_CHECKS=1;'); await write('SET FOREIGN_KEY_CHECKS=1;');
    return manifest;
  } finally { await db.query('ROLLBACK').catch(() => {}); }
}

// Destino de una restauración: solo bases aisladas con prefijo horus_restore_, nunca la configurada, y servidor local salvo autorización expresa.
function validateRestoreTarget({ target, live, host, allowRemote }) {
  if (!/^horus_restore_[a-z0-9_]{1,40}$/.test(target || '')) return 'El destino debe llamarse horus_restore_<nombre> (minúsculas, números y guiones bajos).';
  if (String(target).toLowerCase() === String(live || '').toLowerCase()) return 'El destino no puede ser la base configurada en DB_NAME.';
  const local = ['localhost', '127.0.0.1', '::1'].includes(host || 'localhost');
  if (!local && allowRemote !== 'true') return 'El servidor no es local: la restauración remota exige ALLOW_RESTORE_DB=true y un destino aislado autorizado.';
  return '';
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(item);
    if (!match) throw new Error('Argumento no reconocido: ' + item);
    args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

module.exports = { restoreDatabaseDefaults, FALLBACK_DATABASE, validateManifest, BACKUP_MAGIC, EPHEMERAL_TABLES, sqlValue, insertStatements, singleLine, isAllowedStatement, dumpDatabase, validateRestoreTarget, sha256File, parseArgs };
