// H-BACK-01, E3.6: autorización HTTP REAL del AppModule normal, que registra PublicRateLimitGuard → AccessGuard como guards globales
// (ACCESS_MODE = por_roles), contra un MySQL REAL y DESECHABLE y el NestJS compilado (backend/dist). El arranque de prueba
// (test/fixtures/access-guard-app.cjs) importa AppModule SIN registrar ninguna guard propia; solo añade un controlador de sondeo, y esta
// prueba comprueba que toda guard global procede de AppModule. No forma parte de `npm test` ni de test:integration; la CI la ejecuta
// en su paso propio con el MySQL efímero del runner.
//
//   ACCESS_GUARD_HTTP_TEST_DB=true ACCESS_GUARD_HTTP_TEST_SERVER_UUID=<@@server_uuid leído por docker exec> DB_HOST=127.0.0.1 DB_PORT=<puerto>
//   DB_USER=root DB_PASS=<clave de un solo uso>  node --test -r ./test/isolate-env.cjs test/access-guard-http.integration.cjs
//
// Barreras (las de admin-access-readiness.integration.cjs; todas antes de crear nada):
//  1. ACCESS_GUARD_HTTP_TEST_DB=true explícito.  2. DB_HOST de bucle local y DB_PORT explícito.
//  3. @@server_uuid de la conexión = ACCESS_GUARD_HTTP_TEST_SERVER_UUID, obtenido por otra vía (docker exec en el contenedor propio).
//  4. Servidor recién creado (Uptime < 1 h) y sin tablas en ninguna base ajena a las del sistema.
// Solo crea y elimina una base horus_e36_<hex>. Cuentas y contraseñas ficticias, generadas en cada ejecución y nunca impresas. Sin correo:
// MAIL_PROVIDER=gmail sin MAIL_USER/MAIL_PASS (MailService devuelve «failed» sin abrir conexión) y ninguna ruta probada llega a enviar.
// Sin OpenAI (sin clave). Este proceso no importa database.cjs ni Prisma (no carga ningún .env); la API arranca en un directorio vacío.
//
// Ciclo de vida: la API se detiene cortando el canal IPC (cierre ordenado del ensamblado); solo si no sale en 15 s se fuerza la
// terminación de SU PID (taskkill /T en Windows, SIGKILL en Linux). Ante SIGINT/SIGTERM se ejecuta la misma limpieza antes de salir.
// SIGKILL, TerminateProcess o una caída del sistema no permiten limpiar: la API sale sola al perder el canal, pero la base
// horus_e36_<hex> y el temporal horus-e36-* pueden quedar (se retiran eliminando el contenedor desechable propio y ese temporal).
// El segundo test (sin base de datos, siempre activo) comprueba el arranque restringido y el cierre por pérdida de IPC con procesos y
// puertos propios.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { createHmac, randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync, readdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');

const backend = join(__dirname, '..');
const dist = join(backend, 'dist');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NAME = /^horus_e36_[0-9a-f]{24}$/;
const PASSWORD = 'Ficticia-E36-' + randomBytes(6).toString('hex');
const NEW_PASSWORD = 'Ficticia-E36-nueva-' + randomBytes(6).toString('hex');
const OPERATOR = ['--operador=e36-preparatoria', '--motivo=Prueba E3.6 en base desechable'];
const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const ACCOUNTS = {
  gerente: { nombre: 'Gerente Ficticia', email: 'gerente@horus-e36.test', rol: G },
  coord: { nombre: 'Coordinadora Ficticia', email: 'coordinadora@horus-e36.test', rol: C },
  sec: { nombre: 'Secretaria Ficticia', email: 'secretaria@horus-e36.test', rol: S },
  sinrol: { nombre: 'Cuenta Sinrol Ficticia', email: 'sinrol@horus-e36.test', rol: null },
  inactiva: { nombre: 'Cuenta Inactiva Ficticia', email: 'inactiva@horus-e36.test', rol: S },
  revocada: { nombre: 'Cuenta Revocada Ficticia', email: 'revocada@horus-e36.test', rol: S },
};
const ROLE_KEYS = ['gerente', 'coord', 'sec', 'sinrol'];
// Rutas con límite de frecuencia propio (PublicRateLimitGuard, 5 por minuto): se prueban aparte, no en el barrido.
const RATE_LIMITED = new Set(['POST admin/register', 'POST admin/password']);
// Archivos técnicos de la guard de frecuencia: no son datos de negocio.
const TECHNICAL_TABLES = ['rate_limit_buckets'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = join(__dirname, 'fixtures', 'access-guard-app.cjs');
const isolate = join(__dirname, 'isolate-env.cjs');
const freePort = () => new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)); }); });
const portState = port => new Promise(resolve => {
  const socket = net.connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); resolve('abierto'); });
  socket.once('error', () => resolve('cerrado'));
});
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const waitExit = (child, ms) => new Promise(resolve => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
  const timer = setTimeout(() => resolve(null), ms);
  child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
});
// Último recurso, solo sobre un proceso lanzado por esta prueba: su PID (y su árbol en Windows).
async function forceStop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15_000 });
  else child.kill('SIGKILL');
  await waitExit(child, 5_000);
}

// JWT HS256 construido a mano para los intentos de falsificación (mismo emisor y audiencia que JwtStrategy).
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function signJwt(payload, secret, alg = 'HS256') {
  const now = Math.floor(Date.now() / 1000);
  const data = b64({ alg, typ: 'JWT' }) + '.' + b64({ iat: now, exp: now + 600, iss: 'horus-api', aud: 'horus-panel', ...payload });
  return alg === 'none' ? data + '.' : data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
}

test('E3.6: AccessGuard activa en el AppModule normal, HTTP real contra MySQL desechable', async t => {
  if (process.env.ACCESS_GUARD_HTTP_TEST_DB !== 'true') return t.skip('Requiere ACCESS_GUARD_HTTP_TEST_DB=true y un MySQL desechable identificado.');
  assert.ok(existsSync(join(dist, 'main.js')), 'falta backend/dist: ejecuta npm run build');
  const { permissionsOf, canAll } = require(join(dist, 'permissions/policy.js'));
  const { requirementFor } = require(join(dist, 'permissions/access.js'));
  const { ROUTE_INVENTORY } = require(join(dist, 'permissions/route-inventory.js'));
  const { ACCESS_MODE } = require(join(dist, 'permissions/session-access.js'));
  const { FORBIDDEN_MESSAGE, NO_ROLE_MESSAGE } = require(join(dist, 'permissions/access.guard.js'));
  assert.equal(ACCESS_MODE, 'por_roles', 'E3.6: la aplicación normal declara la autorización por roles');

  const host = process.env.DB_HOST || '', port = Number(process.env.DB_PORT || 0);
  const expectedUuid = String(process.env.ACCESS_GUARD_HTTP_TEST_SERVER_UUID ?? '').trim().toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host) && port > 0, 'DB_HOST de bucle local y DB_PORT explícito');
  assert.match(expectedUuid, UUID, 'ACCESS_GUARD_HTTP_TEST_SERVER_UUID debe ser el server_uuid del servidor desechable');
  const credentials = { host, port, user: process.env.DB_USER, password: process.env.DB_PASS };
  const admin = await mysql.createConnection(credentials);
  const q = async (sql, params) => (await admin.query(sql, params))[0];
  try {
    const [{ uuid, uptime }] = await q("SELECT @@server_uuid AS uuid, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime') AS uptime");
    assert.equal(String(uuid).toLowerCase(), expectedUuid, 'el servidor conectado no es el servidor desechable identificado');
    assert.ok(Number(uptime) < 3600, 'el servidor debe ser recién creado (Uptime < 1 h)');
    const populated = await q('SELECT TABLE_SCHEMA AS s FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN (?) GROUP BY TABLE_SCHEMA', [SYSTEM]);
    assert.deepEqual(populated.map(row => row.s), [], 'el servidor no debe contener datos de ninguna base');
  } catch (error) { await admin.end(); throw error; }

  const name = 'horus_e36_' + randomBytes(12).toString('hex');
  assert.match(name, NAME);
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-e36-'));
  const uploads = join(cwd, 'uploads');
  const dest = host + ':' + port + '/' + name;
  const jwtSecret = 'e36-only-' + randomBytes(24).toString('hex');
  let created = false, api = null, apiLog = '';
  const outputs = [];
  const env = extra => ({
    PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    DB_HOST: host, DB_PORT: String(port), DB_NAME: name, DB_USER: credentials.user, DB_PASS: credentials.password, DB_SSL: 'false', ...extra,
  });
  function runScript(file, args = [], { input, extraEnv = {} } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-r', join(__dirname, 'isolate-env.cjs'), join(backend, 'scripts', file), ...args], { cwd, env: env(extraEnv), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); outputs.push(output); resolve({ code, output }); });
      child.stdin.end(input ?? '');
    });
  }
  const confirm = () => ['--destino=' + dest, '--servidor=' + expectedUuid, ...OPERATOR];
  const createAdmin = key => runScript('create-admin.cjs', confirm(), { input: ACCOUNTS[key].nombre + '\n' + ACCOUNTS[key].email + '\n', extraEnv: { ADMIN_INITIAL_PASSWORD: PASSWORD } });
  const assignRole = (key, rol) => runScript('assign-role.cjs', ['--email=' + ACCOUNTS[key].email, '--rol=' + rol, '--apply', '--confirmar=' + ACCOUNTS[key].email, ...confirm()]);
  const account = async key => (await q('SELECT id, activo, rol, session_version FROM admin_users WHERE email = ?', [ACCOUNTS[key].email]))[0];

  // Instantánea de NEGOCIO: CHECKSUM de cada tabla de la base salvo las técnicas, recuento de filas y archivos subidos.
  // Nunca se leen ni se imprimen contraseñas ni hashes: solo sumas de comprobación.
  async function businessSnapshot() {
    const tables = (await q('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [name])).map(row => row.t).filter(table => !TECHNICAL_TABLES.includes(table));
    const sums = await q('CHECKSUM TABLE ' + tables.map(table => '`' + name + '`.`' + table + '`').join(', ') + ' EXTENDED');
    const counts = [];
    for (const table of tables) counts.push([table, Number((await q('SELECT COUNT(*) AS n FROM `' + table + '`'))[0].n)]);
    const files = existsSync(uploads) ? readdirSync(uploads, { recursive: true }).map(String).sort() : [];
    return { tables: tables.length, value: JSON.stringify({ sums: sums.map(row => [row.Table, String(row.Checksum)]), counts, files }) };
  }
  // Cuotas del límite de frecuencia por fila (la guard borra las caducadas, así que no basta comparar la suma).
  const buckets = async () => new Map((await q('SELECT id, count FROM rate_limit_buckets')).map(row => [row.id, Number(row.count)]));
  const bucketGrowth = (before, after) => [...after].reduce((total, [id, count]) => total + Math.max(0, count - (before.get(id) ?? 0)), 0);

  let ready = null;
  async function startApi() {
    const apiPort = await freePort();
    mkdirSync(uploads);
    api = spawn(process.execPath, ['-r', isolate, fixture], {
      cwd, env: env({ PORT: String(apiPort), JWT_SECRET: jwtSecret, MAIL_PROVIDER: 'gmail', UPLOAD_DIR: uploads, HORUS_ACCESS_GUARD_FIXTURE: 'e36' }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    api.stdout.on('data', chunk => { apiLog += chunk; }); api.stderr.on('data', chunk => { apiLog += chunk; });
    ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('El ensamblado de prueba no arrancó a tiempo.')), 60_000);
      api.once('message', message => { clearTimeout(timer); resolve(message); });
      api.once('exit', code => { clearTimeout(timer); reject(new Error('El ensamblado de prueba terminó (código ' + code + '): ' + apiLog.slice(-600))); });
    });
    return 'http://127.0.0.1:' + apiPort;
  }
  async function stopApi() {
    const child = api; api = null;
    if (!child) return null;
    if (child.connected) child.disconnect();
    const exit = await waitExit(child, 15_000);
    if (exit) return { forced: false, ...exit };
    await forceStop(child);
    return { forced: true };
  }
  // Limpieza única (fin normal, fallo o señal): API, base propia, conexión y temporal propio.
  let cleaning = null;
  const cleanup = () => cleaning ??= (async () => {
    await stopApi();
    try {
      if (created) { assert.match(name, NAME); await q('DROP DATABASE IF EXISTS `' + name + '`'); }
    } finally {
      try { await admin.end(); } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
    }
  })();
  const onSignal = signal => { cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await q('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    created = true;
    await q('USE `' + name + '`');
    assert.equal((await runScript('init-database.cjs')).code, 0, 'init-database.cjs');
    assert.equal((await runScript('migrate.cjs')).code, 0, 'migrate.cjs');
    const schema = await runScript('check-database.cjs');
    assert.equal(schema.code, 0, schema.output);
    for (const key of Object.keys(ACCOUNTS)) { const r = await createAdmin(key); assert.equal(r.code, 0, r.output); }
    for (const key of ['gerente', 'coord', 'sec', 'inactiva', 'revocada']) { const r = await assignRole(key, ACCOUNTS[key].rol); assert.equal(r.code, 0, r.output); }
    const origin = await startApi();

    async function call(route, { method = 'GET', token, body, headers = {}, form } = {}) {
      const response = await fetch(origin + '/api/' + route, {
        method,
        headers: { ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: form ?? (body ? JSON.stringify(body) : undefined),
      });
      const text = await response.text();
      let data = null; try { data = JSON.parse(text); } catch { /* sin JSON */ }
      return { status: response.status, data };
    }
    // Límite real de /admin/login (10 por minuto e IP, guardado en la base temporal): se espera a la ventana siguiente, no se elude.
    const logins = { window: -1, count: 0 };
    async function login(key, password = PASSWORD) {
      let w = Math.floor(Date.now() / 60_000);
      if (w === logins.window && logins.count >= 8) { await sleep((w + 1) * 60_000 - Date.now() + 1500); w = Math.floor(Date.now() / 60_000); }
      if (w !== logins.window) { logins.window = w; logins.count = 0; }
      logins.count++;
      return call('admin/login', { method: 'POST', body: { email: ACCOUNTS[key].email, password } });
    }
    const tokens = {}, ids = {};
    for (const key of Object.keys(ACCOUNTS)) ids[key] = (await account(key)).id;
    const denied = (result, label, mensaje = FORBIDDEN_MESSAGE) => {
      assert.equal(result.status, 403, label + ' → ' + result.status);
      assert.equal(result.data?.mensaje, mensaje, label + ': mensaje de la guard');
    };
    const passed = (result, label) => assert.ok(![401, 403].includes(result.status), label + ' debía pasar la guard → ' + result.status);
    const curso = slug => ({ titulo: 'Curso ' + slug, slug, descripcion: 'Curso ficticio de la prueba E3.6.', tipo: 'curso', modalidad: 'virtual', duracion: '4 semanas', estado: 'borrador' });
    const mensaje = { nombre: 'Persona Ficticia', email: 'persona@horus-e36.test', asunto: 'Consulta ficticia', mensaje: 'Mensaje ficticio de la prueba E3.6.' };
    const fixtures = {};

    await t.test('ensamblado: el AppModule real registra PublicRateLimitGuard → AccessGuard, resuelve sus dependencias y no deja rutas admin sin clasificar', () => {
      assert.deepEqual(ready.resolved, { JwtAuthGuard: true, AccountAccessService: true, JwtStrategy: true, PublicRateLimitGuard: true, AccessGuard: true });
      assert.deepEqual(ready.globalGuards, ['PublicRateLimitGuard', 'AccessGuard'], 'exactamente dos guards globales, en este orden');
      // Toda guard global procede de AppModule; el módulo de prueba no registra ninguna (ni una segunda AccessGuard).
      assert.deepEqual(ready.guardProviders, [{ module: 'AppModule', guard: 'PublicRateLimitGuard' }, { module: 'AppModule', guard: 'AccessGuard' }]);
      // (El arranque importa AccessGuard y sus dependencias solo para comprobar que el AppModule las resuelve.)
      const fixtureCode = readFileSync(fixture, 'utf8').replace(/^\s*\/\/.*$/gm, '');
      assert.match(fixtureCode, /Module\(\{\s*imports: \[AppModule\],\s*controllers: \[ProbeController\],\s*\}\)/, 'el módulo de prueba solo importa AppModule y añade el sondeo');
      assert.ok(!/providers\s*:|UseGuards|useGlobalGuards/.test(fixtureCode), 'el arranque de prueba no registra guards ni proveedores');
      const registered = ready.routes.map(route => route.method + ' ' + route.path.replace(/^\/api\//, ''));
      const inventory = ROUTE_INVENTORY.map(entry => entry.method + ' ' + entry.path);
      const probes = ['GET admin/e36-sondeo', 'GET admin/e36-sondeo/mal-declarada'];
      assert.ok(ready.routes.every(route => route.path.startsWith('/api/')), 'prefijo global /api en todas las rutas');
      assert.deepEqual(registered.filter(route => !inventory.includes(route) && !probes.includes(route)), [], 'ruta registrada fuera del inventario');
      assert.deepEqual(inventory.filter(route => !registered.includes(route)), [], 'ruta del inventario no registrada');
      // El arranque de prueba replica main.ts: si main.ts cambia su configuración HTTP, esta comprobación obliga a revisarlo.
      const main = readFileSync(join(backend, 'src', 'main.ts'), 'utf8');
      for (const line of ["app.setGlobalPrefix('api')", 'configureHttpSecurity(app, process.env)', 'app.useGlobalPipes(createValidationPipe())', "app.set('trust proxy', trustedProxies(process.env.TRUSTED_PROXY_CIDRS))", 'NestFactory.create<NestExpressApplication>(AppModule)']) {
        assert.ok(main.includes(line), 'main.ts conserva: ' + line);
      }
      const appModule = readFileSync(join(dist, 'app.module.js'), 'utf8');
      assert.match(appModule, /provide: core_1\.APP_GUARD, useClass: access_guard_1\.AccessGuard/, 'el AppModule compilado registra AccessGuard');
      t.diagnostic('Rutas registradas: ' + registered.length + ' (' + inventory.length + ' del inventario + ' + probes.length + ' de sondeo). Guards globales: ' + ready.globalGuards.join(' → ') + '.');
    });

    await t.test('A. login y /admin/me funcionan con la guard activa para los cuatro perfiles', async () => {
      for (const key of [...ROLE_KEYS, 'inactiva', 'revocada']) {
        const r = await login(key);
        assert.equal(r.status, 200, key + ': login');
        tokens[key] = r.data.token;
        const me = await call('admin/me', { token: tokens[key] });
        assert.equal(me.status, 200, key + ': /admin/me');
        assert.deepEqual(me.data.user, r.data.user);
        assert.equal(me.data.user.rol, ACCOUNTS[key].rol);
        assert.deepEqual([...me.data.user.permisos].sort(), permissionsOf(ACCOUNTS[key].rol));
        // E3.6: login y /admin/me anuncian el modo real; los permisos salen del rol de la base (no del JWT, que no los lleva).
        assert.deepEqual(r.data.acceso, { modo: 'por_roles' });
        assert.deepEqual(me.data.acceso, { modo: 'por_roles' });
        const payload = JSON.parse(Buffer.from(tokens[key].split('.')[1], 'base64url').toString('utf8'));
        assert.deepEqual(Object.keys(payload).sort(), ['aud', 'email', 'exp', 'iat', 'id', 'iss', 'version'], key + ': el JWT no lleva rol ni permisos');
        for (const body of [r.data, me.data]) {
          assert.ok(!/password|session_version|activo|\$2[aby]\$/i.test(JSON.stringify(body)), key + ': sin hashes ni estado interno');
        }
        assert.deepEqual(Object.keys(me.data.user).sort(), ['email', 'id', 'nombre', 'permisos', 'rol']);
      }
    });

    await t.test('B. el gerente realiza operaciones autorizadas (cuentas, catálogo, mensajes, archivos)', async () => {
      const users = await call('admin/users', { token: tokens.gerente });
      assert.equal(users.status, 200);
      assert.equal(users.data.users.length, Object.keys(ACCOUNTS).length);
      const course = await call('admin/cursos', { method: 'POST', token: tokens.gerente, body: curso('curso-e36-gerente') });
      assert.equal(course.status, 201, JSON.stringify(course.data));
      fixtures.curso = course.data.item?.id;
      assert.ok(Number.isSafeInteger(fixtures.curso), 'id del curso creado');
      const message = await call('admin/messages', { method: 'POST', token: tokens.gerente, body: mensaje });
      assert.equal(message.status, 201);
      fixtures.mensaje = message.data.message.id;
      assert.equal((await call('admin/items', { token: tokens.gerente })).status, 200);
      assert.equal((await call('admin/stats', { token: tokens.gerente })).status, 200);
      const form = new FormData(); form.append('file', new Blob([PNG], { type: 'image/png' }), 'e36.png');
      const upload = await call('admin/uploads', { method: 'POST', token: tokens.gerente, form });
      passed(upload, 'POST admin/uploads (gerente)');
      t.diagnostic('POST admin/uploads (gerente): ' + upload.status);
      const off = await call('admin/users/' + ids.inactiva, { method: 'PUT', token: tokens.gerente, body: { activo: false } });
      assert.equal(off.status, 200, 'el gerente desactiva una cuenta');
    });

    await t.test('C. la coordinadora recibe 403 al administrar cuentas (antes llegaba al servicio y obtenía 409 por la regla del último gerente)', async () => {
      denied(await call('admin/users', { token: tokens.coord }), 'GET admin/users');
      denied(await call('admin/users/' + ids.gerente, { method: 'PUT', token: tokens.coord, body: { activo: false } }), 'PUT admin/users/:gerente');
      denied(await call('admin/register', { method: 'POST', token: tokens.coord, body: { nombre: 'Intrusa Ficticia', email: 'intrusa@horus-e36.test', password: PASSWORD } }), 'POST admin/register');
      assert.equal((await q('SELECT COUNT(*) AS n FROM admin_users WHERE email = ?', ['intrusa@horus-e36.test']))[0].n, 0);
      assert.equal(Number((await account('gerente')).activo), 1);
      // Lo suyo sí: catálogo y archivado con la ruta de edición (cursos:editar + cursos:archivar).
      const own = await call('admin/cursos', { method: 'POST', token: tokens.coord, body: curso('curso-e36-coordinadora') });
      assert.equal(own.status, 201);
      assert.equal((await call('admin/cursos/' + fixtures.curso, { method: 'PUT', token: tokens.coord, body: { estado: 'archivado' } })).status, 200);
      assert.equal((await call('admin/cotizaciones', { token: tokens.coord })).status, 200);
    });

    await t.test('D. la secretaria recibe 403 al administrar cursos, pero conserva la lectura', async () => {
      assert.equal((await call('admin/cursos', { token: tokens.sec })).status, 200);
      assert.equal((await call('admin/cursos/' + fixtures.curso, { token: tokens.sec })).status, 200);
      denied(await call('admin/cursos', { method: 'POST', token: tokens.sec, body: curso('curso-e36-secretaria') }), 'POST admin/cursos');
      denied(await call('admin/cursos/' + fixtures.curso, { method: 'PUT', token: tokens.sec, body: { titulo: 'Cambiado' } }), 'PUT admin/cursos/:id');
      denied(await call('admin/cursos/' + fixtures.curso, { method: 'PUT', token: tokens.sec, body: { estado: 'publicado' } }), 'PUT admin/cursos/:id estado');
      denied(await call('admin/cursos/' + fixtures.curso, { method: 'DELETE', token: tokens.sec }), 'DELETE admin/cursos/:id');
    });

    await t.test('E. cuenta sin rol: 403 «sin rol» en rutas protegidas; conserva /admin/me y el cambio de su propia contraseña', async () => {
      for (const [method, route] of [['GET', 'admin/cursos'], ['GET', 'admin/messages'], ['GET', 'admin/users'], ['POST', 'admin/messages'], ['GET', 'admin/seguimiento/messages/' + fixtures.mensaje]]) {
        denied(await call(route, { method, token: tokens.sinrol, body: method === 'POST' ? mensaje : undefined }), 'sin rol ' + method + ' ' + route, NO_ROLE_MESSAGE);
      }
      const me = await call('admin/me', { token: tokens.sinrol });
      assert.deepEqual([me.status, me.data.user.rol, me.data.user.permisos], [200, null, []]);
      const before = await account('sinrol');
      const change = await call('admin/password', { method: 'POST', token: tokens.sinrol, body: { current_password: PASSWORD, password: NEW_PASSWORD } });
      assert.ok([200, 201].includes(change.status), 'autoservicio de contraseña → ' + change.status);
      assert.equal((await account('sinrol')).session_version, before.session_version + 1, 'cambiar la contraseña revoca las sesiones');
      assert.equal((await call('admin/me', { token: tokens.sinrol })).status, 401, 'el JWT anterior queda revocado');
      const again = await login('sinrol', NEW_PASSWORD);
      assert.equal(again.status, 200);
      tokens.sinrol = again.data.token;
    });

    await t.test('F. cuenta desactivada: su JWT y su login dan 401', async () => {
      assert.equal(Number((await account('inactiva')).activo), 0);
      for (const route of ['admin/me', 'admin/cursos', 'admin/messages']) {
        const r = await call(route, { token: tokens.inactiva });
        assert.equal(r.status, 401, route);
      }
      assert.equal((await login('inactiva')).status, 401);
    });

    await t.test('G. JWT revocado por session_version: 401; el login nuevo trae el rol vigente de la base', async () => {
      const before = await account('revocada');
      assert.equal((await call('admin/cotizaciones', { token: tokens.revocada })).status, 403, 'como secretaria no lee cotizaciones');
      const r = await assignRole('revocada', C);
      assert.equal(r.code, 0, r.output);
      assert.equal((await account('revocada')).session_version, before.session_version + 1);
      for (const route of ['admin/me', 'admin/cursos', 'admin/cotizaciones']) {
        const old = await call(route, { token: tokens.revocada });
        assert.equal(old.status, 401, 'JWT anterior en ' + route);
      }
      const again = await login('revocada');
      assert.equal(again.data.user.rol, C);
      assert.equal((await call('admin/cotizaciones', { token: again.data.token })).status, 200, 'el rol nuevo surte efecto');
      // Token firmado con el secreto real pero con una versión distinta de la vigente: también 401 (manipular `version` no sirve).
      const stale = signJwt({ id: ids.revocada, email: ACCOUNTS.revocada.email, version: before.session_version }, jwtSecret);
      assert.equal((await call('admin/cursos', { token: stale })).status, 401);
    });

    await t.test('H. roles falsificados en JWT, cabeceras o cuerpo no conceden privilegios', async () => {
      const headers = { 'X-Rol': G, 'X-Role': G, 'X-Permisos': 'cuentas:crear,cuentas:leer', 'X-User-Id': String(ids.gerente) };
      const version = (await account('sec')).session_version;
      // Peor caso: un JWT válido (firmado con el secreto real) de la secretaria al que se añaden rol y permisos de gerente.
      const forged = signJwt({ id: ids.sec, email: ACCOUNTS.sec.email, version, rol: G, role: G, permisos: permissionsOf(G) }, jwtSecret);
      assert.equal((await call('admin/cursos', { token: forged })).status, 200, 'el token falsificado sigue siendo de la secretaria');
      denied(await call('admin/users', { token: forged, headers }), 'GET admin/users con JWT+cabeceras');
      denied(await call('admin/cotizaciones', { token: forged, headers }), 'GET admin/cotizaciones');
      denied(await call('admin/cursos', { method: 'POST', token: tokens.sec, headers, body: { ...curso('curso-e36-falso'), rol: G, permisos: ['cursos:crear'] } }), 'POST admin/cursos con rol en el cuerpo');
      denied(await call('admin/users', { token: tokens.sinrol, headers }), 'sin rol con cabeceras', NO_ROLE_MESSAGE);
      // Identidad ajena: firma con otro secreto o sin firma → 401.
      const otherSecret = signJwt({ id: ids.gerente, email: ACCOUNTS.gerente.email, version: 1 }, 'otro-secreto-' + randomBytes(16).toString('hex'));
      const unsigned = signJwt({ id: ids.gerente, email: ACCOUNTS.gerente.email, version: 1 }, '', 'none');
      for (const token of [otherSecret, unsigned, 'basura']) {
        const r = await call('admin/users', { token, headers });
        assert.equal(r.status, 401);
        assert.ok(!('users' in (r.data ?? {})));
      }
    });

    await t.test('I/K/L. barrido HTTP de TODAS las rutas administrativas por rol: 403 exacto donde la política deniega, guard superada donde concede', async () => {
      // Esperado calculado con la política compilada (requirementFor + canAll) y contrastado con la matriz de Estudiantes y los totales independientes.
      const routes = [];
      for (const entry of ROUTE_INVENTORY) {
        if (!entry.path.startsWith('admin/') || entry.access.kind === 'publica' || RATE_LIMITED.has(entry.method + ' ' + entry.path)) continue;
        const variants = entry.access.kind === 'seguimiento' ? ['messages', 'reclamaciones', 'cotizaciones'] : [undefined];
        const bodies = entry.access.kind === 'segun_campo' ? [{}, ...Object.keys(entry.access.when).map(value => ({ [entry.access.field]: value }))] : [entry.method === 'GET' || entry.method === 'DELETE' ? undefined : {}];
        for (const recurso of variants) for (const body of bodies) {
          const path = entry.path.replace(':recurso', recurso ?? '').replace(':section', 'seccion-e36-inexistente').replace(/:\w+/g, '999999');
          routes.push({ label: entry.method + ' ' + path + (body && Object.keys(body).length ? ' ' + JSON.stringify(body) : ''), method: entry.method, path, body, requirement: requirementFor(entry.access, { params: { recurso }, body }), sweep: !(body && Object.keys(body).length) });
        }
      }
      const expectation = (key, route) => {
        const rol = ACCOUNTS[key].rol;
        if (route.requirement.kind === 'autenticada') return 'pasa';
        if (route.requirement.kind === 'denegada') return 'denegada';
        if (!rol) return 'sinRol';
        return canAll(rol, route.requirement.permissions) ? 'pasa' : 'sinPermiso';
      };
      // Contrato independiente de la política: exactamente cinco rutas; secretaría solo lee y crea; la cuenta básica no accede.
      const students = routes.filter(route => /^admin\/estudiantes(?:\/|$)/.test(route.path));
      const editions = routes.filter(route => /^admin\/convocatorias(?:\/|$)/.test(route.path)); // incluye los horarios de la edición (convocatorias:leer/editar)
      const enrollments = routes.filter(route => /^admin\/matriculas(?:\/|$)/.test(route.path));
      assert.deepEqual(enrollments.map(route => route.label), [
        'GET admin/matriculas', 'GET admin/matriculas/ediciones', 'GET admin/matriculas/999999', 'GET admin/matriculas/999999/historial',
        'POST admin/matriculas', 'PUT admin/matriculas/999999/anulacion', 'PUT admin/matriculas/999999/cumplimiento', 'PUT admin/matriculas/999999/reactivacion',
      ]);
      // Confirmar el cumplimiento (matriculas:confirmar) es solo de Gerencia y Coordinación, como anular y reactivar.
      assert.deepEqual(ROLE_KEYS.map(key => enrollments.map(route => expectation(key, route))), [
        Array(8).fill('pasa'), Array(8).fill('pasa'), [...Array(5).fill('pasa'), ...Array(3).fill('sinPermiso')], Array(8).fill('sinRol'),
      ]);
      assert.deepEqual(editions.map(route => route.label), [
        'GET admin/convocatorias', 'GET admin/convocatorias/cursos', 'GET admin/convocatorias/999999', 'POST admin/convocatorias',
        'PUT admin/convocatorias/999999', 'PUT admin/convocatorias/999999/apertura', 'PUT admin/convocatorias/999999/cierre', 'PUT admin/convocatorias/999999/archivo', 'PUT admin/convocatorias/999999/preinscripcion',
        'GET admin/convocatorias/999999/horarios', 'PUT admin/convocatorias/999999/horarios',
      ]);
      // Horarios: la secretaría los consulta (convocatorias:leer) pero no los reemplaza (convocatorias:editar).
      assert.deepEqual(ROLE_KEYS.map(key => editions.map(route => expectation(key, route))), [
        Array(11).fill('pasa'), Array(11).fill('pasa'), [...Array(3).fill('pasa'), ...Array(6).fill('sinPermiso'), 'pasa', 'sinPermiso'], Array(11).fill('sinRol'),
      ]);
      // Preinscripciones: nueve rutas administrativas. Gerencia, Coordinación y Secretaría las usan todas (leer, editar y convertir); la cuenta básica ninguna.
      const preregistrations = routes.filter(route => /^admin\/preinscripciones(?:\/|$)/.test(route.path));
      assert.equal(preregistrations.length, 9);
      assert.deepEqual(ROLE_KEYS.map(key => preregistrations.map(route => expectation(key, route))), [Array(9).fill('pasa'), Array(9).fill('pasa'), Array(9).fill('pasa'), Array(9).fill('sinRol')]);
      assert.deepEqual(students.map(route => route.label), [
        'GET admin/estudiantes', 'GET admin/estudiantes/999999', 'POST admin/estudiantes',
        'PUT admin/estudiantes/999999', 'PUT admin/estudiantes/999999/archivo',
      ]);
      assert.deepEqual(ROLE_KEYS.map(key => students.map(route => expectation(key, route))), [
        ['pasa', 'pasa', 'pasa', 'pasa', 'pasa'], // gerente
        ['pasa', 'pasa', 'pasa', 'pasa', 'pasa'], // coordinación
        ['pasa', 'pasa', 'pasa', 'sinPermiso', 'sinPermiso'], // secretaría
        ['sinRol', 'sinRol', 'sinRol', 'sinRol', 'sinRol'], // cuenta básica
      ]);
      // Docentes y certificados se retiraron del alcance académico: ya no existe ninguna ruta administrativa de ninguno de los dos.
      assert.deepEqual(routes.filter(route => /^admin\/(docentes|asignaciones-docentes|certificados)(?:\/|$)/.test(route.path)), []);
      // Sesiones se retiró: ya no existe ninguna ruta de sesiones (ni la general ni la de una edición).
      assert.deepEqual(routes.filter(route => /^admin\/sesiones(?:\/|$)/.test(route.path) || /\/sesiones$/.test(route.path)), []);
      const plan = ROLE_KEYS.flatMap(key => routes.map(route => ({ key, route, expected: expectation(key, route) })));
      const before = await businessSnapshot();
      for (const route of [...students, ...editions, ...enrollments]) {
        assert.equal((await call(route.path, { method: route.method, body: route.body })).status, 401, 'sin sesión: ' + route.label);
      }
      for (const { key, route, expected } of plan.filter(item => item.expected !== 'pasa')) {
        denied(await call(route.path, { method: route.method, token: tokens[key], body: route.body }), key + ' ' + route.label, expected === 'sinRol' ? NO_ROLE_MESSAGE : FORBIDDEN_MESSAGE);
      }
      assert.deepEqual(await businessSnapshot(), before, 'ninguna denegación del barrido modificó datos de negocio ni archivos');
      const statuses = {};
      for (const { key, route } of plan.filter(item => item.expected === 'pasa')) {
        const r = await call(route.path, { method: route.method, token: tokens[key], body: route.body });
        // El resumen del asistente es una ruta autenticada sin permiso propio: la guard deja pasar a la cuenta sin rol y es el
        // servicio quien la rechaza con el rol leído de la base (ver admin-access-readiness). POST admin/asistente/consultar con
        // cuerpo vacío responde 400 por la validación del DTO antes del servicio, así que sigue la regla general.
        if (key === 'sinrol' && route.label === 'GET admin/asistente/resumen') {
          denied(r, key + ' ' + route.label + ' (denegación del servicio)', NO_ROLE_MESSAGE);
          statuses[r.status] = (statuses[r.status] ?? 0) + 1;
          continue;
        }
        passed(r, key + ' ' + route.label);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      }
      // A las 70 variantes admin no públicas de E3.5 (seguimiento ×2) se añadió PUT admin/users/:id/rol:
      // exige cuentas:asignar_rol, exclusivo del gerente. Pasan G 71, C 54, S 14, sin rol 2. Aquí se excluyen POST admin/register
      // y POST admin/password (límite de frecuencia, probadas aparte) y se añade el recurso «cotizaciones» (denegado).
      // Estudiantes añade cinco rutas: G +5, C +5, S +3 (lista, detalle y alta), sin rol +0. Los permisos existentes no cambian.
      // Así, los totales del barrido pasan de [69, 53, 13, 1] a [74, 58, 16, 1] (sin las variantes con estado en el cuerpo).
      const count = key => plan.filter(item => item.key === key && item.route.sweep && item.expected === 'pasa').length;
      // Ediciones suma ocho rutas para gerente/coordinadora y tres lecturas para secretaría; cuenta básica sigue sin acceso.
      // Matrículas: siete rutas G/C y cinco S (cuatro lecturas y alta); anulación/reactivación restringidas.
      // Importaciones: Gerencia +5; Coordinación +4 (solo aplicar se deniega); Secretaría y básica +0.
      // Reportes académicos: Gerencia +3 (catálogo, consulta y exportación); Coordinación +2 (sin reportes_academicos:exportar);
      // Secretaría y básica +0 (sin reportes_academicos:leer). La matriz de roles no cambia.
      // Docentes y asignaciones: sus trece rutas se retiraron (Gerencia y Coordinación −13).
      // Sesiones: seis rutas para Gerencia y Coordinación; Secretaría y básica +0. Los totales pasan de [110, 92, 24, 1] a [116, 98, 24, 1].
      // Preinscripciones: nueve rutas administrativas para Gerencia, Coordinación y Secretaría (leer, editar y convertir) y una de recepción en Ediciones
      // (convocatorias:editar) solo para Gerencia y Coordinación: [126, 108, 33, 1].
      // Rutas añadidas después (la matriz de roles no cambia):
      // - Cumplimiento de matrícula (matriculas:confirmar): G +1, C +1.
      // - Certificados (retirados): cuatro lecturas y emisión G/C +5; anulación y sustitución solo G +2 ya no existen: G −7, C −5; S y básica +0.
      // - Asistente (resumen y consultar, autenticadas sin permiso propio): +2 para cada rol, también la cuenta básica
      //   (la guard la deja pasar; el servicio la deniega, comprobado arriba y en admin-access-readiness).
      // - Cotizaciones: PDF (cotizaciones:leer) y duplicar (cotizaciones:crear): G/C +2.
      // - Mensajes: exportar CSV (mensajes:exportar) solo G +1; comprobar duplicados (mensajes:crear) G/C/S +1.
      // Totales tras retirar Docentes (−13 G/C) y Certificados (−7 G, −5 C): [120, 101, 36, 3].
      // - Sesiones (retiradas): sus seis rutas G/C ya no existen (G −6, C −6).
      // - Horarios de la edición: GET (convocatorias:leer) G/C/S +1 y PUT (convocatorias:editar) G/C +1.
      // Totales actuales: [116, 97, 37, 3].
      assert.deepEqual(ROLE_KEYS.map(count), [116, 97, 37, 3]);
      for (const key of ROLE_KEYS) {
        const own = plan.filter(item => item.key === key && item.route.path.startsWith('admin/seguimiento/cotizaciones/'));
        // Un requisito «denegada» se resuelve antes de mirar el rol: 403 genérico también para la cuenta sin rol.
        assert.ok(own.length === 4 && own.every(item => item.expected === 'denegada'), key + ': recurso de seguimiento no clasificado → 403');
      }
      const tally = Object.fromEntries(ROLE_KEYS.map(key => [key, { pasa: 0, denegada: 0 }]));
      for (const item of plan) tally[item.key][item.expected === 'pasa' ? 'pasa' : 'denegada']++;
      t.diagnostic('Barrido: ' + routes.length + ' solicitudes por rol (' + plan.length + ' en total). ' + ROLE_KEYS.map(key => key + ' ' + tally[key].pasa + ' pasan / ' + tally[key].denegada + ' 403').join('; ') + '. Códigos tras superar la guard: ' + JSON.stringify(statuses) + '.');
    });

    await t.test('K. seguimiento y permisos condicionados por el cuerpo, con registros reales', async () => {
      const id = fixtures.mensaje;
      assert.equal((await call('admin/seguimiento/messages/' + id, { token: tokens.sec })).status, 200, 'secretaria: seguimiento de mensajes');
      denied(await call('admin/seguimiento/reclamaciones/' + id, { token: tokens.sec }), 'secretaria: seguimiento de reclamaciones');
      assert.equal((await call('admin/seguimiento/reclamaciones/999999', { token: tokens.coord })).status, 404, 'coordinadora pasa la guard; el registro no existe');
      for (const key of ['gerente', 'coord', 'sec']) denied(await call('admin/seguimiento/cotizaciones/' + id, { token: tokens[key] }), key + ': recurso desconocido');
      // segun_campo: «archivado» exige además cursos:archivar; con mayúsculas o espacios también.
      for (const estado of ['archivado', ' ARCHIVADO ']) denied(await call('admin/cursos/' + fixtures.curso, { method: 'PUT', token: tokens.sec, body: { estado } }), 'secretaria archiva ' + JSON.stringify(estado));
      assert.equal((await call('admin/cursos/' + fixtures.curso, { method: 'PUT', token: tokens.coord, body: { estado: 'borrador' } })).status, 200, 'coordinadora reactiva');
      // cotizaciones: «anulada» exige cotizaciones:anular; la coordinadora lo tiene (llega al servicio: 404), la secretaria no tiene ni editar.
      assert.equal((await call('admin/cotizaciones/999999/estado', { method: 'POST', token: tokens.coord, body: { estado: 'anulada', revision: 1 } })).status, 404);
      denied(await call('admin/cotizaciones/999999/estado', { method: 'POST', token: tokens.sec, body: { estado: 'anulada', revision: 1 } }), 'secretaria anula');
    });

    await t.test('L. denegación por defecto con la guard real: ruta sin decorador o mal declarada → 403 también al gerente', async () => {
      for (const route of ['admin/e36-sondeo', 'admin/e36-sondeo/mal-declarada']) {
        const anonymous = await call(route);
        // Sin sesión responde JwtAuthGuard (dentro de AccessGuard) con su mensaje propio: 401 antes de evaluar la clasificación.
        assert.equal(anonymous.status, 401, 'sin sesión: ' + route);
        const r = await call(route, { token: tokens.gerente });
        denied(r, 'gerente ' + route);
        assert.ok(!('alcanzada' in (r.data ?? {})), 'el controlador no se ejecuta');
      }
    });

    await t.test('J. rutas públicas siguen accesibles sin sesión (y un token basura no las bloquea)', async () => {
      for (const route of ['health', 'settings', 'cursos', 'servicios', 'preguntas-frecuentes', 'convenios', 'galeria']) {
        assert.equal((await call(route)).status, 200, route);
        assert.equal((await call(route, { token: 'basura' })).status, 200, route + ' con token basura');
      }
      assert.equal((await call('cursos/999999')).status, 404, 'pública: llega al servicio');
      assert.equal((await call('uploads/no-existe-e36.png')).status, 404);
      const wrong = await call('admin/login', { method: 'POST', body: { email: ACCOUNTS.gerente.email, password: PASSWORD + 'x' } });
      assert.equal(wrong.status, 401, 'login incorrecto: 401 genérico del servicio, no de la guard');
      assert.ok(!('token' in (wrong.data ?? {})));
    });

    await t.test('8. conservación de cursos: 403 (autorización) antes que 409 (negocio) y 404 (inexistente); registros e imágenes intactos', async () => {
      const count = async () => Number((await q('SELECT COUNT(*) AS n FROM cursos'))[0].n);
      // El curso de prueba recibe una imagen subida de verdad para comprobar que ningún intento la elimina.
      const form = new FormData(); form.append('file', new Blob([PNG], { type: 'image/png' }), 'curso-e36.png');
      const upload = await call('admin/uploads', { method: 'POST', token: tokens.gerente, form });
      assert.equal(upload.status, 201);
      const imagen = '/api' + upload.data.path;
      assert.equal((await call('admin/cursos/' + fixtures.curso, { method: 'PUT', token: tokens.gerente, body: { imagen_url: imagen } })).status, 200);
      const file = join(uploads, imagen.split('/').pop());
      assert.ok(existsSync(file), 'la imagen está en el directorio temporal de subidas');
      const snapshot = await businessSnapshot();
      const before = await count();
      const conflict = await call('admin/cursos/' + fixtures.curso, { method: 'DELETE', token: tokens.gerente });
      assert.equal(conflict.status, 409, 'gerente: borrado físico prohibido por negocio');
      assert.equal((await call('admin/cursos/999999', { method: 'DELETE', token: tokens.gerente })).status, 404, 'gerente: inexistente');
      denied(await call('admin/cursos/' + fixtures.curso, { method: 'DELETE', token: tokens.sec }), 'secretaria: existente');
      denied(await call('admin/cursos/999999', { method: 'DELETE', token: tokens.sec }), 'secretaria: inexistente (no revela existencia)');
      denied(await call('admin/cursos/' + fixtures.curso, { method: 'DELETE', token: tokens.coord }), 'coordinadora: sin cursos:eliminar');
      assert.equal(await count(), before, 'ningún curso perdido');
      assert.deepEqual(await businessSnapshot(), snapshot, 'registros, relaciones y archivos sin cambios (409, 404 y 403)');
      assert.deepEqual(readFileSync(file), PNG, 'la imagen del curso sigue intacta');
      const detail = await call('admin/cursos/' + fixtures.curso, { token: tokens.gerente });
      assert.equal(detail.status, 200);
      assert.equal(detail.data.item.imagen_url, imagen);
    });

    await t.test('6. sin efectos ante denegaciones con cuerpos VÁLIDOS: negocio, relaciones, auditoría, archivos y correo intactos', async () => {
      const before = await businessSnapshot();
      const quotas = await buckets();
      const form = () => { const f = new FormData(); f.append('file', new Blob([PNG], { type: 'image/png' }), 'denegada.png'); return f; };
      const attempts = [
        ['coord', 'POST', 'admin/register', { nombre: 'Intrusa Dos', email: 'intrusa2@horus-e36.test', password: PASSWORD }],
        ['coord', 'PUT', 'admin/users/' + ids.gerente, { activo: false }],
        ['coord', 'PUT', 'admin/settings', { telefono_principal: '+51 000 000 000' }],
        ['coord', 'DELETE', 'admin/messages/' + fixtures.mensaje],
        ['sec', 'POST', 'admin/cursos', curso('curso-e36-denegado')],
        ['sec', 'PUT', 'admin/cursos/' + fixtures.curso, { estado: 'archivado' }],
        ['sec', 'DELETE', 'admin/cursos/' + fixtures.curso],
        ['sec', 'POST', 'admin/uploads', null, form],
        ['sec', 'POST', 'admin/seguimiento/reclamaciones/' + fixtures.mensaje + '/correo', { asunto: 'x', mensaje: 'y' }],
        ['sinrol', 'POST', 'admin/messages', mensaje],
        ['sinrol', 'PUT', 'admin/messages/' + fixtures.mensaje, { estado: 'atendido' }],
        ['sinrol', 'POST', 'admin/seguimiento/messages/' + fixtures.mensaje + '/correo', { asunto: 'x', mensaje: 'y' }],
        ['sinrol', 'POST', 'admin/seguimiento/messages/' + fixtures.mensaje + '/constancia', {}],
      ];
      for (const [key, method, route, body, makeForm] of attempts) {
        denied(await call(route, { method, token: tokens[key], body: body ?? undefined, form: makeForm ? makeForm() : undefined }), key + ' ' + method + ' ' + route, key === 'sinrol' ? NO_ROLE_MESSAGE : FORBIDDEN_MESSAGE);
      }
      const after = await businessSnapshot();
      assert.equal(after.value, before.value, 'tablas de negocio (incluidas admin_auditoria e intentos de correo), relaciones y archivos sin cambios');
      const technical = bucketGrowth(quotas, await buckets());
      // POST admin/register es la única ruta de la lista con límite de frecuencia. Si PublicRateLimitGuard se ejecuta antes que AccessGuard, el
      // intento denegado consume cuota (escritura técnica: 2 incrementos, individual y global); si AccessGuard va primero, no escribe nada.
      const rateFirst = ready.globalGuards.indexOf('PublicRateLimitGuard') < ready.globalGuards.indexOf('AccessGuard');
      assert.equal(rateFirst, true, 'E3.6 fija el orden PublicRateLimitGuard → AccessGuard');
      assert.equal(technical, 2, 'el intento denegado consumió cuota (escritura técnica coherente con el orden)');
      assert.ok(!/Notificación aceptada|nodemailer|smtp/i.test(apiLog), 'ningún envío de correo');
      t.diagnostic(after.tables + ' tablas de negocio comparadas por CHECKSUM y recuento. Escritura técnica observada: rate_limit_buckets +' + technical + ' (orden de guards: ' + ready.globalGuards.join(' → ') + ').');
    });

    await t.test('compatibilidad con validación: con permiso, un cuerpo inválido da 400; sin permiso, 403 antes de validar', async () => {
      assert.equal((await call('admin/cursos', { method: 'POST', token: tokens.coord, body: { titulo: '' } })).status, 400);
      denied(await call('admin/cursos', { method: 'POST', token: tokens.sec, body: { titulo: '' } }), 'secretaria con cuerpo inválido');
      assert.equal((await call('admin/cursos/abc', { token: tokens.sec })).status, 400, 'ParseIntPipe sigue actuando tras la guard');
    });

    await t.test('compatibilidad con PublicRateLimitGuard: con la guard activa el límite de POST admin/register (5/min) sigue aplicándose', async () => {
      // Las seis solicitudes deben caer en una ventana de un minuto en la que nadie haya usado aún la cuota de esta ruta: la prueba 6
      // también envía un POST admin/register (denegado, pero con la guard de frecuencia primero consume cuota). Se espera a la siguiente.
      await sleep(60_000 - (Date.now() % 60_000) + 1000);
      const created = await call('admin/register', { method: 'POST', token: tokens.gerente, body: { nombre: 'Registrada Ficticia', email: 'registrada@horus-e36.test', password: PASSWORD } });
      assert.equal(created.status, 201, 'el gerente crea una cuenta');
      assert.equal((await q('SELECT rol FROM admin_users WHERE email = ?', ['registrada@horus-e36.test']))[0].rol, null, 'la cuenta nace sin rol');
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await call('admin/register', { method: 'POST', token: tokens.gerente, body: {} })).status);
      assert.deepEqual(statuses, [400, 400, 400, 400, 429], 'cuatro llegan a la validación; la sexta del minuto es 429');
    });

    await t.test('orden PublicRateLimitGuard → AccessGuard: cuotas, 429, 401/403 antes de agotar la cuota y rutas sin límite intactas', async () => {
      assert.deepEqual(ready.globalGuards, ['PublicRateLimitGuard', 'AccessGuard']);
      // Todas las secuencias caen en una ventana de un minuto nueva (no se eluden los límites: se espera a la siguiente).
      await sleep(60_000 - (Date.now() % 60_000) + 1000);
      const window = Math.floor(Date.now() / 60_000);
      const post = (route, token, body) => call(route, { method: 'POST', token, body });

      // a) POST admin/register (5/min): cada intento sin sesión o sin permiso consume cuota; mientras queda cuota responde 401/403;
      //    agotada, 429 incluso para el gerente con un cuerpo válido, y no se crea la cuenta.
      const valid = { nombre: 'Cuota Ficticia', email: 'cuota@horus-e36.test', password: PASSWORD };
      let quotas = await buckets();
      const reg = [await post('admin/register', undefined, valid), await post('admin/register', 'basura', valid), await post('admin/register', tokens.sinrol, valid),
        await post('admin/register', tokens.coord, valid), await post('admin/register', tokens.sec, valid), await post('admin/register', tokens.gerente, valid)];
      assert.deepEqual(reg.map(r => r.status), [401, 401, 403, 403, 403, 429]);
      assert.deepEqual([reg[2].data?.mensaje, reg[3].data?.mensaje], [NO_ROLE_MESSAGE, FORBIDDEN_MESSAGE]);
      // Solo las solicitudes ADMITIDAS consumen cuota: cinco intentos × (cuota individual + global de la ruta). El sexto, rechazado con 429, no suma
      // nada (antes sumaba 2 y así una IP abusiva agotaba el global de todos).
      assert.equal(bucketGrowth(quotas, await buckets()), 10, 'cinco intentos admitidos × (individual + global); el 429 no consume cuota');
      assert.equal(Number((await q('SELECT COUNT(*) AS n FROM admin_users WHERE email = ?', [valid.email]))[0].n), 0, 'el 429 no crea la cuenta');

      // b) POST admin/password (5/min, autoservicio): 401 sin sesión válida y 400 con la contraseña actual incorrecta consumen cuota;
      //    el sexto intento, aun con datos correctos, es 429 y no cambia la contraseña ni revoca sesiones.
      const secBefore = await account('sec');
      const wrong = { current_password: PASSWORD + 'x', password: NEW_PASSWORD };
      const pwd = [await post('admin/password', undefined, wrong), await post('admin/password', 'basura', wrong), await post('admin/password', tokens.sec, wrong),
        await post('admin/password', tokens.sec, wrong), await post('admin/password', tokens.sec, wrong), await post('admin/password', tokens.sec, { current_password: PASSWORD, password: NEW_PASSWORD })];
      assert.deepEqual(pwd.map(r => r.status), [401, 401, 400, 400, 400, 429]);
      assert.equal((await account('sec')).session_version, secBefore.session_version, 'el 429 no cambia la contraseña');
      assert.equal((await call('admin/me', { token: tokens.sec })).status, 200, 'la sesión de la secretaria sigue válida');

      // c) POST admin/login (10/min, pública): diez intentos fallidos dan 401; el undécimo, con credenciales correctas, 429 sin token.
      const fails = [];
      for (let i = 0; i < 10; i++) fails.push((await call('admin/login', { method: 'POST', body: { email: ACCOUNTS.gerente.email, password: PASSWORD + 'x' } })).status);
      assert.deepEqual(fails, Array(10).fill(401));
      const blocked = await call('admin/login', { method: 'POST', body: { email: ACCOUNTS.gerente.email, password: PASSWORD } });
      assert.equal(blocked.status, 429);
      assert.ok(!('token' in (blocked.data ?? {})));
      logins.window = window; logins.count = 11; // el ayudante login() respeta la cuota ya consumida
      assert.equal(Math.floor(Date.now() / 60_000), window, 'las tres secuencias cayeron en la misma ventana');

      // d) Rutas fuera del límite: sin 429 por repetición y sin escritura técnica; conservan su 200/403 habitual.
      quotas = await buckets();
      for (let i = 0; i < 12; i++) assert.equal((await call('admin/cursos', { token: tokens.sec })).status, 200, 'GET admin/cursos #' + i);
      for (let i = 0; i < 7; i++) denied(await call('admin/settings', { method: 'PUT', token: tokens.coord, body: { telefono_principal: '+51 000 000 000' } }), 'PUT admin/settings #' + i);
      for (let i = 0; i < 7; i++) denied(await call('admin/messages', { method: 'POST', token: tokens.sinrol, body: mensaje }), 'POST admin/messages #' + i, NO_ROLE_MESSAGE);
      for (let i = 0; i < 7; i++) assert.equal((await call('cursos')).status, 200, 'GET cursos (pública) #' + i);
      assert.equal(bucketGrowth(quotas, await buckets()), 0, 'las rutas sin límite no consumen cuota');
      t.diagnostic('Orden verificado: ' + ready.globalGuards.join(' → ') + '. register ' + reg.map(r => r.status).join('/') + '; password ' + pwd.map(r => r.status).join('/') + '; login 10×401 → 429.');
    });

    await t.test('ciclo de vida: al cortar el canal IPC el ensamblado deja de escuchar y sale solo, sin terminación forzada', async () => {
      const { pid } = api, apiPort = Number(new URL(origin).port);
      assert.equal(await portState(apiPort), 'abierto');
      const exit = await stopApi();
      assert.deepEqual(exit, { forced: false, code: 0, signal: null }, 'cierre ordenado (código 0)');
      assert.equal(alive(pid), false, 'el proceso del ensamblado ya no existe');
      assert.equal(await portState(apiPort), 'cerrado', 'el puerto temporal ya no escucha');
      t.diagnostic('Cierre por pérdida de IPC: código ' + exit.code + ', sin terminación forzada; puerto temporal cerrado.');
    });

    await t.test('ninguna salida de scripts ni de la API muestra contraseñas, hashes, credenciales, el JWT_SECRET ni tokens', async () => {
      for (const output of [...outputs, apiLog]) {
        for (const secret of [PASSWORD, NEW_PASSWORD, credentials.password, jwtSecret]) assert.ok(!output.includes(secret), 'sin secretos en la salida');
        assert.ok(!/\$2[aby]\$/.test(output), 'sin hashes');
      }
      for (const token of Object.values(tokens)) assert.ok(![...outputs, apiLog].some(output => output.includes(token)), 'sin tokens');
    });
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
});

test('E3.6 ciclo de vida del ensamblado de prueba: arranque restringido y cierre por pérdida de IPC (sin base de datos)', async t => {
  assert.ok(existsSync(join(dist, 'main.js')), 'falta backend/dist: ejecuta npm run build');
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-e36-ciclo-'));
  const children = [];
  // Configuración ficticia; ningún caso llega a una base real (puertos cerrados o un servidor TCP propio que nunca responde).
  const base = {
    HORUS_ACCESS_GUARD_FIXTURE: 'e36', DB_HOST: '127.0.0.1', DB_NAME: 'horus_e36_ciclo', DB_USER: 'ficticio', DB_PASS: 'ficticia-' + randomBytes(6).toString('hex'),
    DB_SSL: 'false', JWT_SECRET: 'e36-ciclo-' + randomBytes(24).toString('hex'), MAIL_PROVIDER: 'gmail', UPLOAD_DIR: join(cwd, 'uploads'),
  };
  function launch(extra, { ipc = true, omit = [] } = {}) {
    const env = { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...base, ...extra };
    for (const key of omit) delete env[key];
    const child = spawn(process.execPath, ['-r', isolate, fixture], { cwd, env, stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])], windowsHide: true });
    child.log = ''; child.messages = [];
    child.stdout.on('data', chunk => { child.log += chunk; }); child.stderr.on('data', chunk => { child.log += chunk; });
    if (ipc) child.on('message', message => child.messages.push(message));
    children.push(child);
    return child;
  }
  // Centinela: un proceso propio que no es el ensamblado; ningún cierre debe afectarlo.
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  const sockets = [];
  let connected;
  const accepted = new Promise(resolve => { connected = resolve; });
  const blackHole = net.createServer(socket => { sockets.push(socket); socket.on('error', () => {}); connected(socket); });
  await new Promise(resolve => blackHole.listen(0, '127.0.0.1', resolve));
  try {
    await t.test('sin canal IPC no arranca (código 2) ni abre su puerto', async () => {
      const port = await freePort();
      const child = launch({ PORT: String(port), DB_PORT: '1' }, { ipc: false });
      assert.deepEqual(await waitExit(child, 15_000), { code: 2, signal: null });
      assert.match(child.log, /Arranque exclusivo de la prueba E3\.6/);
      assert.equal(await portState(port), 'cerrado');
    });
    await t.test('sin marcador HORUS_ACCESS_GUARD_FIXTURE no arranca (código 2)', async () => {
      const child = launch({ PORT: String(await freePort()), DB_PORT: '1' }, { omit: ['HORUS_ACCESS_GUARD_FIXTURE'] });
      assert.deepEqual(await waitExit(child, 15_000), { code: 2, signal: null });
      assert.deepEqual(child.messages, []);
    });
    await t.test('con DB_HOST que no es de bucle local no arranca (código 2)', async () => {
      const child = launch({ PORT: String(await freePort()), DB_PORT: '3306', DB_HOST: 'mysql.e36.invalid' });
      assert.deepEqual(await waitExit(child, 15_000), { code: 2, signal: null });
      assert.match(child.log, /DB_HOST debe ser de bucle local/);
    });
    await t.test('error de inicialización (base inaccesible): sale con 1, sin «ready» y sin abrir su puerto', async () => {
      const port = await freePort();
      const child = launch({ PORT: String(port), DB_PORT: String(await freePort()) });
      assert.deepEqual(await waitExit(child, 60_000), { code: 1, signal: null });
      assert.deepEqual(child.messages, []);
      assert.match(child.log, /Fallo del ensamblado de prueba/);
      assert.equal(await portState(port), 'cerrado');
    });
    await t.test('pérdida de IPC durante el arranque: sale con 3 sin esperar el timeout de conexión (10 s) y libera la conexión', async () => {
      const port = await freePort();
      const child = launch({ PORT: String(port), DB_PORT: String(blackHole.address().port) });
      const first = await Promise.race([accepted.then(socket => ({ socket })), waitExit(child, 60_000).then(exit => ({ exit }))]);
      assert.ok(first.socket, 'el ensamblado debía estar conectando con la base: ' + JSON.stringify(first.exit) + ' ' + child.log.slice(-400));
      const { socket } = first;
      const started = Date.now();
      child.disconnect();
      assert.deepEqual(await waitExit(child, 8_000), { code: 3, signal: null });
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 8_000);
      await new Promise(resolve => (socket.destroyed || socket.readableEnded ? resolve() : socket.once('close', resolve)));
      assert.equal(alive(child.pid), false);
      assert.equal(await portState(port), 'cerrado');
      t.diagnostic('Desconexión durante el arranque: salida en ' + elapsed + ' ms con código 3; la conexión con la base quedó cerrada.');
    });
    await t.test('los procesos ajenos al ensamblado siguen intactos', () => {
      assert.equal(alive(sentinel.pid), true, 'el proceso centinela sigue vivo');
      assert.equal(alive(process.pid), true);
      assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null), 'todos los ensamblados lanzados terminaron solos');
    });
  } finally {
    for (const child of children) await forceStop(child);
    await forceStop(sentinel);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => blackHole.close(resolve));
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
});
