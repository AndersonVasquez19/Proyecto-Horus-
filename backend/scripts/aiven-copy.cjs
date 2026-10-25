// Configuración JSON exclusivamente por stdin; secretos nunca en argumentos/archivos temporales.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const net = require('node:net');
const mysql = require('mysql2');
const lib = require('./aiven-copy-lib.cjs');
const HOST = 'mysql-1b22a7e2-horus-group-dev.d.aivencloud.com';
const EXPECTED_TABLES = 30;
// Huella SHA-256 (64 hex, sin separadores) del certificado hoja DER. Es un dato público,
// pero solo es válida si se obtuvo por una vía independiente de la propia conexión TLS.
const FINGERPRINT = /^[a-f0-9]{64}$/;
function pinnedIdentity(expected) {
  if (!FINGERPRINT.test(expected || '')) lib.fail('PIN');
  const want = Buffer.from(expected, 'hex');
  // Defensa adicional: no sustituye la validación de CA ni la identidad del hostname.
  return (_host, cert) => {
    const raw = cert && Buffer.isBuffer(cert.raw) ? cert.raw : null;
    const got = raw ? crypto.createHash('sha256').update(raw).digest() : null;
    if (!got || got.length !== want.length || !crypto.timingSafeEqual(got, want)) return new Error('PIN');
    return undefined;
  };
}
function connectionOptions(c) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') lib.fail('TLS');
  // inspect es de solo lectura y no depende de la ventana sin escritores.
  const readOnlyAction = c.action === 'inspect';
  if (!/^[a-f0-9-]{36}$/i.test(c.uuid || '') || c.user !== 'horus_migrator' || typeof c.password !== 'string' || !c.password || (c.noWriters !== true && !readOnlyAction)) lib.fail('CONFIG');
  if (readOnlyAction && c.profile !== 'local-source' && c.profile !== 'fixture') lib.fail('SOURCE');
  if (c.profile === 'aiven') {
    if (c.host !== HOST || c.port !== 28816 || c.database !== 'horus_db' || c.service !== 'mysql-1b22a7e2' || c.version !== '8.4.11') lib.fail('TARGET');
  } else if (c.profile === 'local-source') {
    if (c.host !== '127.0.0.1' || c.port !== 3306 || c.database !== 'horus_db' || c.version !== '8.0.46') lib.fail('SOURCE');
  } else if (c.profile === 'fixture') {
    if (c.host !== '127.0.0.1' || !Number.isInteger(c.port) || c.port <= 1024 || c.port === 3306 || !/^horus_copy_(source|target|bad)$/.test(c.database) || !['8.0.46','8.4.11'].includes(c.version) || c.fixture !== true) lib.fail('FIXTURE');
  } else lib.fail('PROFILE');
  if (typeof c.ca !== 'string' || !c.ca.includes('BEGIN CERTIFICATE')) lib.fail('CA');
  if (c.profile === 'local-source' || c.tlsFingerprint256 !== undefined) pinnedIdentity(c.tlsFingerprint256);
  // mysql2 no transmite ssl.checkServerIdentity. La huella se comprueba en startTLS, antes
  // de que ClientHandshake.sendCredentials continúe. CA y hostname siguen siendo obligatorios.
  const ssl = { ca: c.ca, rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' };
  return { host: c.host, port: c.port, database: c.database, user: c.user, password: c.password, ssl,
    multipleStatements: false, flags: '-LOCAL_FILES', connectTimeout: 10000, timezone: 'Z',
    dateStrings: true, jsonStrings: true, supportBigNumbers: true, bigNumberStrings: true };
}
async function createVerifiedConnection(c) {
  const options = connectionOptions(c);
  // startTLS es una integración interna auditada para esta versión. Ante una actualización,
  // detenerse ANTES de abrir un socket y revisar el orden TLS -> comprobación -> credenciales.
  if (require('mysql2/package.json').version !== '3.24.3') lib.fail('MYSQL2_TLS_VERSION');
  const pin = c.profile === 'local-source' || c.tlsFingerprint256 !== undefined
    ? pinnedIdentity(c.tlsFingerprint256) : null;
  const db = mysql.createConnection(options);
  let verified = false;
  try {
    if (typeof db.startTLS !== 'function' || typeof db._handleNetworkError !== 'function' || !db.packetParser) lib.fail('MYSQL2_TLS_API');
    // Solo esta instancia; sin modificar prototipos, dependencias ni TLS global.
    // Conserva el transporte/analizador de mysql2, pero pasa el host también para IP:
    // el startTLS original omite ese campo y Node acaba verificando "localhost".
    db.startTLS = function (onSecure) {
      this.stream.removeAllListeners('data');
      let established = false;
      const socket = tls.connect({
        socket: this.stream, host: options.host,
        servername: net.isIP(options.host) ? undefined : options.host,
        ca: options.ssl.ca, rejectUnauthorized: true, minVersion: 'TLSv1.2',
        checkServerIdentity: (_host, cert) => tls.checkServerIdentity(options.host, cert) || (pin ? pin(options.host, cert) : undefined)
      }, () => {
        try {
          if (!(socket instanceof tls.TLSSocket) || socket.encrypted !== true || socket.authorized !== true) lib.fail('TLS');
          const cert = socket.getPeerCertificate(true);
          // Comprobar también IP/SAN explícitamente: mysql2 omite servername para hosts IP.
          const identityError = tls.checkServerIdentity(options.host, cert);
          if (identityError) throw identityError;
          const pinError = pin && pin(options.host, cert);
          if (pinError) throw pinError;
          verified = true;
        } catch (failure) { return onSecure(failure); }
        established = true;
        onSecure();
      });
      socket.on('error', error => established ? this._handleNetworkError(error) : onSecure(error));
      socket.on('data', data => this.packetParser.execute(data));
      this.stream = socket;
    };
    await new Promise((resolve, reject) => db.connect(error => error ? reject(error) : resolve()));
    if (!verified) lib.fail('TLS');
    return db.promise();
  } catch (error) {
    db.destroy();
    throw error;
  }
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
// Solo lectura: identidad, TLS, privilegios, objetos y recuentos. Devuelve agregados y nombres de tabla;
// nunca filas, valores, UUID, cuenta ni huella. Cada comprobación fallida queda en `checks` y `ok` pasa a false.
async function inspect(db, c) {
  const checks = {};
  const [[r]] = await db.query('SELECT @@server_uuid uuid, VERSION() version, @@port port, DATABASE() db, CURRENT_USER() account');
  checks.uuid = r.uuid === c.uuid;
  checks.version = r.version === c.version;
  checks.port = Number(r.port) === c.port;
  checks.database = r.db === c.database;
  checks.user = typeof r.account === 'string' && r.account.startsWith('horus_migrator@');
  const [tls] = await db.query("SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')");
  const version = tls.find(v => v.Variable_name === 'Ssl_version')?.Value;
  checks.tls = !!tls.find(v => v.Variable_name === 'Ssl_cipher')?.Value && /^TLSv1\.[23]$/.test(version || '');
  const allowed = new Set(['SELECT','INSERT','UPDATE','DELETE','CREATE','ALTER','INDEX','REFERENCES']);
  const [grants] = await db.query('SHOW GRANTS');
  const privileges = new Set();
  let grantOption = false, scopeOk = true;
  for (const row of grants) {
    const grant = Object.values(row)[0];
    if (grant.includes('WITH GRANT OPTION')) grantOption = true;
    if (/^GRANT USAGE ON \*\.\* TO /.test(grant)) continue;
    const m = /^GRANT ([A-Z, ]+) ON `([^`]+)`\.\* TO /.exec(grant);
    if (!m || m[2] !== c.database) { scopeOk = false; continue; }
    for (const p of m[1].split(', ')) privileges.add(p);
  }
  const names = [...privileges].sort();
  checks.grantsScope = scopeOk && !grantOption;
  checks.selectGranted = privileges.has('SELECT');
  checks.grantsExact = scopeOk && !grantOption && names.length === allowed.size && names.every(p => allowed.has(p));
  await db.query("SET SESSION time_zone='+00:00'");
  await db.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const objectCounts = {};
    for (const [table, column, key] of [['VIEWS','TABLE_SCHEMA','views'], ['TRIGGERS','TRIGGER_SCHEMA','triggers'], ['ROUTINES','ROUTINE_SCHEMA','routines'], ['EVENTS','EVENT_SCHEMA','events']]) {
      const [[o]] = await db.query(`SELECT COUNT(*) n FROM information_schema.${table} WHERE ${column}=DATABASE()`);
      objectCounts[key] = Number(o.n);
    }
    checks.noExtraObjects = Object.values(objectCounts).every(n => n === 0);
    const [tables] = await db.query("SELECT TABLE_NAME name, ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    checks.tableCount = tables.length === EXPECTED_TABLES;
    checks.innodb = tables.every(t => t.engine === 'InnoDB');
    const counts = {};
    let total = 0;
    for (const t of tables) {
      const [[n]] = await db.query('SELECT COUNT(*) n FROM ' + lib.quoteIdentifier(t.name));
      counts[t.name] = Number(n.n); total += counts[t.name];
    }
    if (c.expectedRows !== undefined) checks.expectedRows = total === c.expectedRows;
    return { ok: Object.values(checks).every(Boolean), checks, tls: { version: version || null }, privileges: names,
      objects: objectCounts, tables: tables.length, rows: total, counts };
  } finally { await db.query('ROLLBACK'); }
}
function outsideRepo(file) {
  const target = path.resolve(file), repo = fs.realpathSync(path.join(__dirname,'../..'));
  const parent = fs.realpathSync(path.dirname(target));
  const relative = path.relative(repo, parent);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) lib.fail('OUTSIDE_REPO');
  return target;
}
async function run(c) {
  if (!['backup','verify','preflight','apply','compare','inspect'].includes(c.action)) lib.fail('ACTION');
  if (c.action === 'inspect') {
    // Sin archivo, clave ni respaldo: lectura de la fuente local y nada más.
    if (c.file || c.key || c.includeRateLimits === true) lib.fail('INSPECT');
    const db = await createVerifiedConnection(c);
    try { return await inspect(db, c); } finally { await db.end(); }
  }
  const file = outsideRepo(c.file);
  let snapshot;
  if (c.action !== 'backup') snapshot = lib.unseal(fs.readFileSync(file), c.key, c.sha256);
  if (c.action === 'verify') return { verified: true, tables: snapshot.tables.length };
  if (c.action === 'backup' && !['local-source','fixture'].includes(c.profile)) lib.fail('SOURCE');
  if (c.action !== 'backup' && c.profile === 'local-source') lib.fail('TARGET');
  if (c.action === 'backup' && (c.includeRateLimits !== true || fs.existsSync(file))) lib.fail('BACKUP');
  if (c.action === 'apply' && c.approval !== 'IMPORT_EMPTY_DATABASE') lib.fail('APPROVAL');
  if (['apply','preflight'].includes(c.action)) lib.capacity(snapshot, c.quotaBytes, c.usedBytes);
  const db = await createVerifiedConnection(c);
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
  if (result.ok === false) process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
  // Nunca imprimir mensajes SQL/conector, stack, configuración, filas ni hashes de filas.
  process.stderr.write('Copia detenida. No habilitar escritores; conservar cualquier destino parcial. Revise identidad, paquete, permisos y requisitos.\n');
  process.exitCode=1;
});
module.exports = { connectionOptions, createVerifiedConnection, pinnedIdentity, identify, inspect, run };
