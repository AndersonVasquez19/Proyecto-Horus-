// Inventario explícito local: solo agregados, sin .env, Prisma ni valores de celdas.
// Requiere autorización de lectura, DB_* explícitas y UUID previamente cotejado.
const { escapeId } = require('mysql2');
const { rsaPublicKey } = require('./connection-security.cjs');

function configuration(env, args) {
  if (args.length !== 1 || args[0] !== '--read-only-local') throw new Error('Uso: --read-only-local con configuración privada explícita.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST) || env.DB_NAME !== 'horus_db') throw new Error('Solo se admite horus_db en loopback.');
  if (!env.DB_USER || !env.DB_PASS || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DB_EXPECTED_SERVER_UUID || '')) throw new Error('Faltan credenciales privadas o UUID cotejado.');
  const port = Number(env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT debe ser explícito y válido.');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('No se admite desactivar TLS.');
  if (env.DB_SSL !== 'true' && env.DB_SSL !== 'false') throw new Error('DB_SSL debe ser explícito.');
  if (env.DB_SSL === 'true' && !env.DB_SSL_CA) throw new Error('Falta la CA explícita.');
  return {
    host: env.DB_HOST, port, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASS,
    multipleStatements: false, connectTimeout: 10000,
    ...(env.DB_SSL === 'true' ? { ssl: { ca: env.DB_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true, verifyIdentity: true } } : {}),
  };
}

// Cuenta celdas coincidentes, no ocurrencias ni archivos únicos. Las categorías se solapan.
// Las menciones amplias a localhost también detectan texto y JSON con barras escapadas.
const patterns = [
  ['uploads', '/uploads/'],
  ['apiUploads', '/api/uploads/'],
  ['backendUploads', 'backend/uploads/'],
  ['localhost', 'localhost'],
  ['ipv4Loopback', '127.0.0.1'],
  ['ipv6Loopback', '[::1]'],
];

async function inventory(db, expectedUuid) {
  const [[identity]] = await db.query('SELECT @@server_uuid AS uuid, DATABASE() AS db');
  if (identity.uuid !== expectedUuid || identity.db !== 'horus_db') throw new Error('La identidad local no coincide.');
  await db.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const [columns] = await db.query("SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE' AND c.DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','json','enum','set') ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION");
    const fields = [];
    for (const { tableName, columnName } of columns) {
      const cell = 'LOWER(REPLACE(CAST(' + escapeId(columnName, true) + ' AS CHAR), CHAR(92), CHAR(47)))';
      const expressions = patterns.map(([alias]) => 'COALESCE(SUM(LOCATE(?, ' + cell + ') > 0), 0) AS ' + escapeId(alias, true));
      const [[counts]] = await db.query('SELECT ' + expressions.join(', ') + ' FROM ' + escapeId(tableName, true), patterns.map(([, pattern]) => pattern));
      const result = Object.fromEntries(patterns.map(([key]) => [key, Number(counts[key])]));
      if (Object.values(result).some(n => n > 0)) fields.push({ table: tableName, field: columnName, ...result });
    }
    return { scope: 'local-read-only-aggregates', scannedColumns: columns.length, unit: 'matching-cells-per-column; overlapping-categories', fields };
  } finally { await db.query('ROLLBACK'); }
}

async function main() {
  const options = configuration(process.env, process.argv.slice(2));
  const { createConnection } = require('mysql2/promise');
  const { authPlugins } = require('mysql2');
  const key = rsaPublicKey(process.env.DB_RSA_PUBLIC_KEY);
  const db = await createConnection({ ...options, ...(key ? { authPlugins: { caching_sha2_password: authPlugins.caching_sha2_password({ serverPublicKey: key }) } } : {}) });
  try { console.log(JSON.stringify(await inventory(db, process.env.DB_EXPECTED_SERVER_UUID), null, 2)); }
  finally { await db.end(); }
}

if (require.main === module) main().catch(() => {
  console.error('Inventario no completado. Revisar argumentos, cuenta de lectura, UUID y conexión local; no se muestran datos ni errores SQL.');
  process.exitCode = 1;
});
module.exports = { configuration, inventory };
