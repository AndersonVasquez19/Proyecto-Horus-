// Copia específica: sin dotenv, Prisma, conexiones implícitas ni SQL proporcionado por el operador.
const crypto = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { isAllowedStatement, singleLine, referentialIntegrity, GENERATED_COLUMN } = require('./backup-lib.cjs');
const LIMIT = 64 * 1024 * 1024;
const MAGIC = Buffer.from('HORUS-AIVEN-1\n');
const fail = code => { throw new Error(code); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const id = value => { if (!/^[a-zA-Z0-9_]+$/.test(value)) fail('IDENTIFIER'); return '`' + value + '`'; };
const canonical = value => JSON.stringify(value);
const encode = value => Buffer.isBuffer(value) ? { hex: value.toString('hex') } : value;
const decode = value => value && typeof value === 'object' ? Buffer.from(value.hex, 'hex') : value;
function comparableDdl(ddl) {
  // MySQL vuelve explícito CHARACTER SET al recrear columnas con COLLATE.
  // Solo quitar esa redundancia fuera de literales/identificadores; la colación
  // determina el charset y ambos se cotejan también en information_schema.COLUMNS.
  return ddl.split(/('(?:[^'\\]|\\[\s\S]|'')*'|`[^`]*`)/g).map((part,i) => i % 2 ? part :
    part.replace(/ CHARACTER SET ([a-z0-9]+) COLLATE (\1_[a-z0-9_]+)/g,' COLLATE $2')).join('');
}

function seal(snapshot, key) {
  if (!/^[a-f0-9]{64}$/i.test(key)) fail('KEY');
  const plain = Buffer.from(canonical(snapshot));
  if (plain.length > LIMIT) fail('SIZE');
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}
function unseal(bytes, key, approvedHash) {
  if (!/^[a-f0-9]{64}$/i.test(key) || bytes.length > LIMIT || hash(bytes) !== approvedHash || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) fail('PACKAGE');
  const n = MAGIC.length;
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(n, n + 12));
  decipher.setAAD(MAGIC); decipher.setAuthTag(bytes.subarray(n + 12, n + 28));
  const compressed = Buffer.concat([decipher.update(bytes.subarray(n + 28)), decipher.final()]);
  const snapshot = JSON.parse(gunzipSync(compressed, { maxOutputLength: LIMIT }).toString('utf8'));
  validate(snapshot);
  return snapshot;
}
function validate(s) {
  if (s?.format !== 'horus-aiven/1' || !Array.isArray(s.tables) || !s.tables.length || !/^[a-z0-9_]+$/.test(s.collation)) fail('MANIFEST');
  const names = new Set();
  for (const t of s.tables) {
    id(t.name);
    if (names.has(t.name)) fail('DUPLICATE_TABLE'); names.add(t.name);
    if (!Array.isArray(t.columns) || !t.columns.length || !Array.isArray(t.rows) || !Array.isArray(t.pk) || !t.pk.length) fail('TABLE');
    if (new Set(t.columns.map(c => c.name)).size !== t.columns.length) fail('COLUMNS');
    for (const c of t.columns) id(c.name);
    if (t.pk.some(c => !t.columns.some(col => col.name === c))) fail('PRIMARY_KEY');
    if (!isAllowedStatement(t.ddl) || !t.ddl.startsWith('CREATE TABLE ' + id(t.name) + ' (')) fail('DDL');
    // No referencias a otros esquemas, comentarios ejecutables, particiones, tablespaces ni motores externos.
    const bare = t.ddl.replace(/'[^'\\]*(?:(?:\\[\s\S]|'')[^'\\]*)*'/g, "''");
    if (/\b(?:DROP|TRUNCATE|REPLACE|DEFINER|TABLESPACE|PARTITION|IF\s+NOT\s+EXISTS)\b|`\s*\./i.test(bare) || !/\) ENGINE=InnoDB\b/.test(bare)) fail('DDL');
    for (const r of t.rows) {
      if (!Array.isArray(r) || r.length !== t.columns.length) fail('ROW');
      for (const v of r) if (!(v === null || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v) || typeof v === 'object' && Object.keys(v).length === 1 && typeof v.hex === 'string' && /^(?:[a-f0-9]{2})*$/.test(v.hex))) fail('VALUE');
    }
  }
  if (!names.has('horus_migrations') || !names.has('rate_limit_buckets')) fail('INCOMPLETE');
  for (const t of s.tables) for (const m of t.ddl.matchAll(/REFERENCES `([^`]+)`/g)) if (!names.has(m[1])) fail('REFERENCE');
}
async function objects(db) {
  for (const [table, column] of [['VIEWS','TABLE_SCHEMA'], ['TRIGGERS','TRIGGER_SCHEMA'], ['ROUTINES','ROUTINE_SCHEMA'], ['EVENTS','EVENT_SCHEMA']]) {
    const [[r]] = await db.query(`SELECT COUNT(*) n FROM information_schema.${table} WHERE ${column}=DATABASE()`);
    if (Number(r.n)) fail('UNSUPPORTED_OBJECTS');
  }
}
async function capture(db) {
  await db.query("SET SESSION time_zone='+00:00'");
  await db.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    await objects(db);
    const [[defaults]] = await db.query('SELECT DEFAULT_COLLATION_NAME collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()');
    const [tables] = await db.query('SELECT TABLE_NAME name, ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME');
    const snapshot = { format: 'horus-aiven/1', collation: defaults.collation, tables: [] };
    let size = 0;
    for (const t of tables) {
      if (t.engine !== 'InnoDB') fail('ENGINE');
      const [[ddl]] = await db.query('SHOW CREATE TABLE ' + id(t.name));
      const [columns] = await db.query('SELECT COLUMN_NAME name, DATA_TYPE type, EXTRA extra, COLUMN_TYPE columnType, IS_NULLABLE nullable, COLUMN_DEFAULT defaultValue, CHARACTER_SET_NAME charset, COLLATION_NAME collation, GENERATION_EXPRESSION generation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [t.name]);
      const [keys] = await db.query('SHOW KEYS FROM ' + id(t.name) + " WHERE Key_name='PRIMARY'");
      const pk = keys.sort((a,b) => a.Seq_in_index-b.Seq_in_index).map(k => k.Column_name);
      if (!pk.length) fail('PRIMARY_KEY');
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const [page] = await db.query('SELECT * FROM ' + id(t.name) + ' ORDER BY ' + pk.map(id).join(',') + ' LIMIT 500 OFFSET ' + offset);
        const encoded = page.map(row => columns.map(c => encode(row[c.name])));
        size += Buffer.byteLength(canonical(encoded)); if (size > LIMIT / 2) fail('SIZE');
        rows.push(...encoded); if (page.length < 500) break;
      }
      snapshot.tables.push({ name: t.name, ddl: singleLine(ddl['Create Table']), columns, pk, rows });
    }
    const [[schema]] = await db.query('SELECT DATABASE() name');
    if ((await referentialIntegrity(db, schema.name)).problems.length) fail('ORPHANS');
    validate(snapshot);
    return snapshot;
  } finally { await db.query('ROLLBACK'); }
}
function differences(expected, actual) {
  // Exact DDL: includes PK/FK, indexes, CHECK/ENFORCED, charset/collation, defaults,
  // generated expressions and AUTO_INCREMENT. Version representation drift fails closed.
  const issues = [];
  if (expected.collation !== actual.collation) issues.push('DATABASE_COLLATION');
  if (canonical(expected.tables.map(t => t.name)) !== canonical(actual.tables.map(t => t.name))) issues.push('TABLES');
  for (const t of expected.tables) {
    const other = actual.tables.find(v => v.name === t.name);
    if (!other) continue;
    if (comparableDdl(t.ddl) !== comparableDdl(other.ddl) || canonical(t.columns) !== canonical(other.columns) || canonical(t.pk) !== canonical(other.pk)) issues.push('STRUCTURE');
    if (t.rows.length !== other.rows.length) issues.push('COUNTS');
    if (hash(canonical(t.rows)) !== hash(canonical(other.rows))) issues.push('VALUES');
  }
  return [...new Set(issues)];
}
async function empty(db, snapshot) {
  await objects(db);
  const [tables] = await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  if (tables.length) fail('NOT_EMPTY');
  const [[r]] = await db.query('SELECT DEFAULT_COLLATION_NAME collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()');
  if (r?.collation !== snapshot.collation) fail('DATABASE_COLLATION');
}
function capacity(snapshot, quota, used) {
  if (!Number.isSafeInteger(quota) || !Number.isSafeInteger(used) || quota <= 0 || used < 0 || quota > 1e9) fail('CAPACITY');
  const reserve = Math.max(Buffer.byteLength(canonical(snapshot)) * 10, 100 * 1024 * 1024);
  if (used + reserve > quota * 0.8) fail('CAPACITY');
}
async function apply(db, snapshot) {
  validate(snapshot);
  const [[lock]] = await db.query("SELECT GET_LOCK('horus_aiven_copy',0) acquired");
  if (Number(lock.acquired) !== 1) fail('LOCK');
  try {
    await empty(db, snapshot);
    await db.query("SET SESSION time_zone='+00:00'");
    await db.query("SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode,'NO_BACKSLASH_ESCAPES','')");
    const [[mode]] = await db.query('SELECT @@SESSION.sql_mode mode');
    if (!/STRICT_(TRANS|ALL)_TABLES/.test(mode.mode)) fail('STRICT_MODE');
    await db.query('SET SESSION foreign_key_checks=0');
    // Unique and CHECK validation remain enabled. DDL commits cannot be rolled back.
    for (const t of snapshot.tables) {
      const [result] = await db.query(t.ddl);
      if (result.warningStatus) {
        const [warnings] = await db.query('SHOW WARNINGS');
        // SHOW CREATE conserva tinyint(1). MySQL 8.4 avisa sobre su ancho de
        // presentación; no cambia valores ni tipos. Ningún otro aviso se tolera.
        if (warnings.some(w => Number(w.Code) !== 1681 || !/^Integer display width is deprecated and will be removed in a future release\.$/.test(w.Message))) fail('DDL_WARNING');
      }
    }
    for (const t of snapshot.tables) {
      const indices = t.columns.map((c,i) => GENERATED_COLUMN.test(c.extra) ? -1 : i).filter(i => i >= 0);
      const sql = 'INSERT INTO ' + id(t.name) + ' (' + indices.map(i => id(t.columns[i].name)).join(',') + ') VALUES (' + indices.map(() => '?').join(',') + ')';
      for (const row of t.rows) {
        const [result] = await db.execute(sql, indices.map(i => decode(row[i])));
        if (result.warningStatus) fail('INSERT_WARNING');
      }
    }
  } finally {
    try { await db.query('SET SESSION foreign_key_checks=1'); }
    finally { await db.query("SELECT RELEASE_LOCK('horus_aiven_copy')"); }
  }
  const actual = await capture(db);
  if (differences(snapshot, actual).length) fail('COMPARISON');
  return { tables: actual.tables.length, rows: actual.tables.reduce((n,t) => n+t.rows.length,0) };
}
module.exports = { seal, unseal, validate, capture, differences, empty, capacity, apply, hash, fail, comparableDdl };
