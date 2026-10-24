// Configuración JSON exclusivamente por stdin; secretos nunca en argumentos/archivos temporales.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const lib = require('./aiven-copy-lib.cjs');
const HOST = 'mysql-1b22a7e2-horus-group-dev.d.aivencloud.com';
function connectionOptions(c) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') lib.fail('TLS');
  if (!/^[a-f0-9-]{36}$/i.test(c.uuid || '') || c.user !== 'horus_migrator' || typeof c.password !== 'string' || !c.password || c.noWriters !== true) lib.fail('CONFIG');
  if (c.profile === 'aiven') {
    if (c.host !== HOST || c.port !== 28816 || c.database !== 'horus_db' || c.service !== 'mysql-1b22a7e2' || c.version !== '8.4.11') lib.fail('TARGET');
  } else if (c.profile === 'local-source') {
    if (c.host !== '127.0.0.1' || c.port !== 3306 || c.database !== 'horus_db' || c.version !== '8.0.46') lib.fail('SOURCE');
  } else if (c.profile === 'fixture') {
    if (c.host !== '127.0.0.1' || !Number.isInteger(c.port) || c.port <= 1024 || c.port === 3306 || !/^horus_copy_(source|target|bad)$/.test(c.database) || !['8.0.46','8.4.11'].includes(c.version) || c.fixture !== true) lib.fail('FIXTURE');
  } else lib.fail('PROFILE');
  if (typeof c.ca !== 'string' || !c.ca.includes('BEGIN CERTIFICATE')) lib.fail('CA');
  return { host: c.host, port: c.port, database: c.database, user: c.user, password: c.password,
    ssl: { ca: c.ca, rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' },
    multipleStatements: false, flags: '-LOCAL_FILES', connectTimeout: 10000, timezone: 'Z',
    dateStrings: true, jsonStrings: true, supportBigNumbers: true, bigNumberStrings: true };
}
async function identify(db, c) {
  const [[r]] = await db.query('SELECT @@server_uuid uuid, VERSION() version, DATABASE() db, CURRENT_USER() account, CURRENT_ROLE() roles');
  if (r.uuid !== c.uuid || r.version !== c.version || r.db !== c.database || !r.account.startsWith('horus_migrator@') || r.roles !== 'NONE') lib.fail('IDENTITY');
  const [tls] = await db.query("SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')");
  if (!tls.some(r => r.Variable_name === 'Ssl_cipher' && r.Value) || !tls.some(r => r.Variable_name === 'Ssl_version' && /^TLSv1\.[23]$/.test(r.Value))) lib.fail('TLS');
  const [grants] = await db.query('SHOW GRANTS');
  const allowed = new Set(['SELECT','INSERT','UPDATE','DELETE','CREATE','ALTER','INDEX','REFERENCES']);
  const effective = new Set();
  for (const row of grants) {
    const grant = Object.values(row)[0];
    if (/^GRANT USAGE ON \*\.\* TO /.test(grant) && !grant.includes('WITH GRANT OPTION')) continue;
    const match = /^GRANT ([A-Z, ]+) ON `([^`]+)`\.\* TO /.exec(grant);
    if (!match || match[2] !== c.database || grant.includes('WITH GRANT OPTION')) lib.fail('GRANTS');
    for (const p of match[1].split(', ')) { if (!allowed.has(p)) lib.fail('GRANTS'); effective.add(p); }
  }
  if (effective.size !== allowed.size) lib.fail('GRANTS');
}
function outsideRepo(file) {
  const target = path.resolve(file), repo = fs.realpathSync(path.join(__dirname,'../..'));
  const parent = fs.realpathSync(path.dirname(target));
  const relative = path.relative(repo, parent);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) lib.fail('OUTSIDE_REPO');
  return target;
}
async function run(c) {
  if (!['backup','verify','preflight','apply','compare'].includes(c.action)) lib.fail('ACTION');
  const file = outsideRepo(c.file);
  let snapshot;
  if (c.action !== 'backup') snapshot = lib.unseal(fs.readFileSync(file), c.key, c.sha256);
  if (c.action === 'verify') return { verified: true, tables: snapshot.tables.length };
  if (c.action === 'backup' && !['local-source','fixture'].includes(c.profile)) lib.fail('SOURCE');
  if (c.action !== 'backup' && c.profile === 'local-source') lib.fail('TARGET');
  if (c.action === 'backup' && (c.includeRateLimits !== true || fs.existsSync(file))) lib.fail('BACKUP');
  if (c.action === 'apply' && c.approval !== 'IMPORT_EMPTY_DATABASE') lib.fail('APPROVAL');
  if (['apply','preflight'].includes(c.action)) lib.capacity(snapshot, c.quotaBytes, c.usedBytes);
  const db = await mysql.createConnection(connectionOptions(c));
  try {
    await identify(db,c);
    if (c.action === 'backup') {
      snapshot = await lib.capture(db);
      const bytes = lib.seal(snapshot,c.key);
      // Se escribe únicamente el cifrado autenticado; no hay SQL ni JSON en disco.
      fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
      return { sha256: lib.hash(bytes), tables: snapshot.tables.length, rows: snapshot.tables.reduce((n,t)=>n+t.rows.length,0) };
    }
    if (c.action === 'preflight') { await lib.empty(db,snapshot); return { empty: true, identity: true, tls: true }; }
    if (c.action === 'apply') {
      const result = await lib.apply(db,snapshot);
      if ((await require('./check-database.cjs').check(db)).length) lib.fail('SCHEMA');
      return { ...result, schema: true };
    }
    const differences = lib.differences(snapshot,await lib.capture(db));
    if (differences.length) lib.fail('COMPARISON');
    if ((await require('./check-database.cjs').check(db)).length) lib.fail('SCHEMA');
    return { equal: true, schema: true, tables: snapshot.tables.length };
  } finally { await db.end(); }
}
async function main() {
  if (process.argv.length !== 2 || process.stdin.isTTY) lib.fail('STDIN');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 128*1024) lib.fail('CONFIG_SIZE'); }
  const result = await run(JSON.parse(input.replace(/^\uFEFF/,'')));
  process.stdout.write(JSON.stringify({ok:true,...result})+'\n');
}
if (require.main === module) main().catch(() => {
  // Nunca imprimir mensajes SQL/conector, stack, configuración, filas ni hashes de filas.
  process.stderr.write('Copia detenida. No habilitar escritores; conservar cualquier destino parcial. Revise identidad, paquete, permisos y requisitos.\n');
  process.exitCode=1;
});
module.exports = { connectionOptions, identify, run };
