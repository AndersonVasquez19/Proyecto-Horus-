// H-BACK-01, E3.5 fase 1: preparación de las cuentas administrativas antes de activar AccessGuard (E3.6), contra un MySQL REAL y DESECHABLE
// y el NestJS real compilado (backend/dist). Manual: no forma parte de `npm test`, de test:integration ni de la CI. Procedimiento y
// lista de verificación en docs/procedimientos/preparacion-accessguard.md.
//
//   ACCESS_READINESS_TEST_DB=true ACCESS_READINESS_TEST_SERVER_UUID=<@@server_uuid leído por docker exec> DB_HOST=127.0.0.1 DB_PORT=<puerto>
//   DB_USER=root DB_PASS=<clave de un solo uso>  node --test -r ./test/isolate-env.cjs test/admin-access-readiness.integration.cjs
//
// Desde E3.6 la API arranca tal cual (dist/main.js + AppModule) y AccessGuard ya está activa (ACCESS_MODE = por_roles): las respuestas
// HTTP de esta prueba son las de la aplicación normal con autorización por roles. El recuento por ruta de lo que decide la guard se calcula
// además con la misma lógica compilada que ella usa (requirementFor + canAll sobre ROUTE_INVENTORY) y el estado real de cada cuenta; se
// marca [PREVISTO] y se contrasta con solicitudes reales de muestra. El barrido HTTP completo está en access-guard-http.integration.cjs.
//
// Barreras (las mismas que admin-scripts.integration.cjs; todas antes de crear nada):
//  1. ACCESS_READINESS_TEST_DB=true explícito.  2. DB_HOST de bucle local y DB_PORT explícito.
//  3. @@server_uuid de la conexión = ACCESS_READINESS_TEST_SERVER_UUID, obtenido por otra vía (docker exec en el contenedor propio).
//  4. Servidor recién creado (Uptime < 1 h) y sin tablas en ninguna base ajena a las del sistema.
// Solo crea y elimina una base horus_e35_<hex>. Cuentas y contraseñas ficticias, generadas en cada ejecución y nunca impresas. Sin correo:
// MAIL_PROVIDER sin credenciales y ninguna ruta que envíe. Este proceso no importa database.cjs ni Prisma (no carga ningún .env).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');

const backend = join(__dirname, '..');
const dist = join(backend, 'dist');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NAME = /^horus_e35_[0-9a-f]{24}$/;
const PASSWORD = 'Ficticia-E35-' + randomBytes(6).toString('hex');
const OPERATOR = ['--operador=e35-preparacion', '--motivo=Preparacion E3.5 en base desechable'];
const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const ACCOUNTS = {
  gerente: { nombre: 'Gerente Ficticia', email: 'gerente@horus-e35.test', rol: G },
  coord: { nombre: 'Coordinadora Ficticia', email: 'coordinadora@horus-e35.test', rol: C },
  sec: { nombre: 'Secretaria Ficticia', email: 'secretaria@horus-e35.test', rol: S },
  sinrol: { nombre: 'Cuenta Sinrol Ficticia', email: 'sinrol@horus-e35.test', rol: null },
  recup: { nombre: 'Recuperacion Ficticia', email: 'recuperacion@horus-e35.test', rol: G },
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sorted = list => [...list].sort();

// Dictamen previo a E3.6 a partir de la salida de `admin:assign-role -- --listar` (solo lectura, correos enmascarados). Es la lista de
// verificación automatizable: un gerente activo como mínimo y ninguna cuenta activa sin rol pendiente de decisión.
function preflight(listing) {
  const rows = [...listing.matchAll(/^id (\d+) \| \S+ \| (activa|inactiva) \| (.+)$/gm)].map(([, id, estado, rol]) => ({ id: Number(id), activa: estado === 'activa', rol: rol.trim() }));
  const gerentes = Number((listing.match(/Gerentes generales activos: (\d+)\./) ?? [])[1]);
  const sinRol = rows.filter(row => row.activa && row.rol === 'sin rol').map(row => row.id);
  const bloqueos = [];
  if (!(gerentes >= 1)) bloqueos.push('sin GERENTE_GENERAL activo: activar la guard bloquearía toda la administración');
  if (sinRol.length) bloqueos.push('cuentas activas sin rol (ids ' + sinRol.join(', ') + '): revisar y decidir su tratamiento (asignar rol, conservarla justificadamente sin privilegios o desactivarla)');
  return { cuentas: rows.length, gerentes, sinRol, bloqueos };
}

test('E3.5 fase 1: cuentas administrativas preparadas para AccessGuard en un MySQL desechable (con la guard activa en AppModule, E3.6)', async t => {
  if (process.env.ACCESS_READINESS_TEST_DB !== 'true') return t.skip('Requiere ACCESS_READINESS_TEST_DB=true y un MySQL desechable identificado.');
  assert.ok(existsSync(join(dist, 'main.js')), 'falta backend/dist: ejecuta npm run build');
  // Lógica compilada que usaría la guard (sin Prisma ni configuración).
  const { permissionsOf, canAll } = require(join(dist, 'permissions/policy.js'));
  const { requirementFor } = require(join(dist, 'permissions/access.js'));
  const { ROUTE_INVENTORY } = require(join(dist, 'permissions/route-inventory.js'));
  const { ACCESS_MODE } = require(join(dist, 'permissions/session-access.js'));
  const { LAST_GERENTE_MESSAGE } = require(join(dist, 'admin/auth/account-rules.js'));
  const { FORBIDDEN_MESSAGE, NO_ROLE_MESSAGE } = require(join(dist, 'permissions/access.guard.js'));
  assert.equal(ACCESS_MODE, 'por_roles', 'E3.6: el código probado declara la autorización por roles');
  // Rutas admin/ que la guard concede a CUALQUIER sesión válida, incluso sin rol (kind 'autenticada'). Se cuentan desde el inventario en
  // lugar de fijar un número, pero el conjunto exacto se declara aquí: añadir una ruta de autoservicio obliga a justificarla en esta lista
  // y a comprobar abajo, con una solicitud real, que una cuenta sin rol sigue sin alcanzar datos de gestión.
  const SELF_SERVICE = ROUTE_INVENTORY.filter(e => e.path.startsWith('admin/') && e.access.kind === 'autenticada').map(e => e.method + ' ' + e.path);
  assert.deepEqual(sorted(SELF_SERVICE), sorted([
    'GET admin/me', 'POST admin/password', // autoservicio de la propia cuenta
    // HORUS Assistant: la guard las deja pasar porque no tienen un permiso propio, pero el servicio lee el rol VIGENTE de la base y
    // deniega con 403 a una cuenta sin rol, y limita cada herramienta a los permisos de lectura de ese rol (comprobado más abajo).
    'GET admin/asistente/resumen', 'POST admin/asistente/consultar',
  ]), 'rutas concedidas a cualquier sesión válida: solo autoservicio y HORUS Assistant');

  const host = process.env.DB_HOST || '', port = Number(process.env.DB_PORT || 0);
  const expectedUuid = String(process.env.ACCESS_READINESS_TEST_SERVER_UUID ?? '').trim().toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host) && port > 0, 'DB_HOST de bucle local y DB_PORT explícito');
  assert.match(expectedUuid, UUID, 'ACCESS_READINESS_TEST_SERVER_UUID debe ser el server_uuid del servidor desechable');
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

  const name = 'horus_e35_' + randomBytes(12).toString('hex');
  assert.match(name, NAME);
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-e35-'));
  const dest = host + ':' + port + '/' + name;
  const jwtSecret = 'e35-only-' + randomBytes(24).toString('hex');
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
  const confirm = (uuidValue = expectedUuid) => ['--destino=' + dest, '--servidor=' + uuidValue, ...OPERATOR];
  const createAdmin = (key, confirmation = confirm()) => runScript('create-admin.cjs', confirmation, { input: ACCOUNTS[key].nombre + '\n' + ACCOUNTS[key].email + '\n', extraEnv: { ADMIN_INITIAL_PASSWORD: PASSWORD } });
  const assignRole = (key, rol, confirmation = confirm()) => runScript('assign-role.cjs', ['--email=' + ACCOUNTS[key].email, '--rol=' + rol, '--apply', '--confirmar=' + ACCOUNTS[key].email, ...confirmation]);
  const listar = async () => { const r = await runScript('assign-role.cjs', ['--listar']); assert.equal(r.code, 0, r.output); return r.output; };
  // Nunca se lee el hash de la contraseña: basta su resumen para detectar cambios.
  const snapshot = async () => JSON.stringify([await q('SELECT id, activo, rol, session_version, SHA2(password, 256) AS p FROM admin_users ORDER BY id'), await q('SELECT * FROM admin_auditoria ORDER BY id')]);
  const account = async key => (await q('SELECT id, activo, rol, session_version FROM admin_users WHERE email = ?', [ACCOUNTS[key].email]))[0];
  const lastAudit = async () => (await q('SELECT origen, actor_id, cuenta_id, operacion, rol_anterior, rol_nuevo, activo_anterior, activo_nuevo, operador FROM admin_auditoria ORDER BY id DESC LIMIT 1'))[0];

  async function startApi() {
    const apiPort = await new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)); }); });
    const uploads = join(cwd, 'uploads'); mkdirSync(uploads);
    api = spawn(process.execPath, ['-r', join(__dirname, 'isolate-env.cjs'), join(dist, 'main.js')], { cwd, env: env({ PORT: String(apiPort), JWT_SECRET: jwtSecret, MAIL_PROVIDER: 'gmail', UPLOAD_DIR: uploads }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    api.stdout.on('data', chunk => { apiLog += chunk; }); api.stderr.on('data', chunk => { apiLog += chunk; });
    const origin = 'http://127.0.0.1:' + apiPort;
    for (let i = 0; i < 300 && api.exitCode === null; i++) {
      try { if ((await fetch(origin + '/api/health')).ok) return origin; } catch { /* arrancando */ }
      await sleep(200);
    }
    throw new Error('La API real no arrancó (código ' + api.exitCode + ').');
  }
  function stopApi() {
    const child = api; api = null;
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15_000 });
    else child.kill('SIGKILL');
  }

  try {
    await q('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    created = true;
    await q('USE `' + name + '`');
    assert.equal((await runScript('init-database.cjs')).code, 0, 'init-database.cjs');
    assert.equal((await runScript('migrate.cjs')).code, 0, 'migrate.cjs');
    const schema = await runScript('check-database.cjs');
    assert.equal(schema.code, 0, schema.output);
    assert.match(schema.output, /Esquema compatible/);
    for (const key of ['gerente', 'coord', 'sec', 'sinrol']) { const r = await createAdmin(key); assert.equal(r.code, 0, r.output); }
    const origin = await startApi();

    async function call(route, { method = 'GET', token, body } = {}) {
      const response = await fetch(origin + '/api/' + route, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await response.text();
      let data = null; try { data = JSON.parse(text); } catch { /* sin JSON */ }
      return { status: response.status, data };
    }
    // Límite real de /admin/login (10 por minuto e IP, guardado en la base temporal): se espera a la ventana siguiente, no se elude.
    const logins = { window: -1, count: 0 };
    async function login(key, password = PASSWORD, email = ACCOUNTS[key]?.email) {
      let w = Math.floor(Date.now() / 60_000);
      if (w === logins.window && logins.count >= 8) { await sleep((w + 1) * 60_000 - Date.now() + 1500); w = Math.floor(Date.now() / 60_000); }
      if (w !== logins.window) { logins.window = w; logins.count = 0; }
      logins.count++;
      return call('admin/login', { method: 'POST', body: { email, password } });
    }
    const tokens = {};
    async function freshLogin(key) {
      const r = await login(key);
      assert.equal(r.status, 200, key + ': login correcto');
      tokens[key] = r.data.token;
      const me = await call('admin/me', { token: r.data.token });
      assert.equal(me.status, 200);
      assert.deepEqual(me.data.user, r.data.user, key + ': /admin/me coincide con el login');
      assert.deepEqual(me.data.acceso, { modo: 'por_roles' });
      return me.data.user;
    }
    const setActive = (actorKey, key, activo) => account(key).then(row => call('admin/users/' + row.id, { method: 'PUT', token: tokens[actorKey], body: { activo } }));

    // [PREVISTO] Decisión de AccessGuard en `por_roles` para el estado ACTUAL de la cuenta (leído de la base), por cada ruta del inventario.
    // Misma lógica que AccessGuard.canActivate tras validar el JWT; los recursos de seguimiento se evalúan con messages y reclamaciones.
    async function predict(key) {
      const row = await account(key);
      const rol = row && Number(row.activo) === 1 ? row.rol : undefined;
      const result = { publica: 0, pasa: 0, sinSesion: 0, sinRol: 0, sinPermiso: 0, denegada: 0, total: 0 };
      for (const entry of ROUTE_INVENTORY.filter(e => e.path.startsWith('admin/'))) {
        for (const recurso of entry.access.kind === 'seguimiento' ? ['messages', 'reclamaciones'] : [undefined]) {
          const body = entry.access.kind === 'segun_campo' ? { [entry.access.field]: 'archivado' } : {};
          const req = requirementFor(entry.access, { params: { recurso }, body });
          result.total++;
          if (req.kind === 'publica') result.publica++;
          else if (rol === undefined) result.sinSesion++;
          else if (req.kind === 'autenticada') result.pasa++;
          else if (req.kind === 'denegada') result.denegada++;
          else if (!rol) result.sinRol++;
          else if (canAll(rol, req.permissions)) result.pasa++;
          else result.sinPermiso++;
        }
      }
      return result;
    }

    await t.test('cero gerentes: cuentas creadas sin rol; el script exige GERENTE_GENERAL primero y el dictamen bloquea la activación', async () => {
      const listing = await listar();
      assert.match(listing, /Gerentes generales activos: 0\./);
      const pf = preflight(listing);
      assert.equal(pf.cuentas, 4);
      assert.equal(pf.sinRol.length, 4);
      assert.equal(pf.bloqueos.length, 2, 'sin gerente y con cuentas sin rol');
      const before = await snapshot();
      const rejected = await assignRole('sec', S);
      assert.equal(rejected.code, 1, 'sin gerente, el primer rol debe ser GERENTE_GENERAL');
      assert.equal(await snapshot(), before, 'el rechazo no escribe nada');
      for (const key of ['gerente', 'coord', 'sec', 'sinrol']) {
        const user = await freshLogin(key);
        assert.deepEqual([user.rol, user.permisos], [null, []], key + ': sin rol y sin permisos');
        const p = await predict(key);
        assert.equal(p.pasa, SELF_SERVICE.length, key + ' [PREVISTO]: solo las rutas sin permiso propio (' + SELF_SERVICE.join(', ') + ')');
        assert.equal(p.sinRol, p.total - p.publica - SELF_SERVICE.length, key + ' [PREVISTO]: 403 «sin rol» en todas las rutas con permiso');
        // Real (guard activa): la muestra coincide con lo previsto.
        for (const route of ['admin/cursos', 'admin/users', 'admin/stats', 'admin/messages']) {
          const r = await call(route, { token: tokens[key] });
          assert.deepEqual([r.status, r.data?.mensaje], [403, NO_ROLE_MESSAGE], key + ' ' + route + ': 403 «sin rol» real');
        }
        // Las dos rutas del asistente SÍ pasan la guard: la denegación la hace el servicio con el rol leído de la base. Sin esta
        // comprobación, «pasa» subiría en silencio al añadir una ruta autenticada y nadie vería que expone datos. No llama a OpenAI:
        // el rol se comprueba antes de usar la IA. El cuerpo es válido para que la validación del DTO no responda 400 antes.
        for (const [route, options] of [['admin/asistente/resumen', {}], ['admin/asistente/consultar', { method: 'POST', body: { pregunta: '¿Que pendientes tengo hoy?' } }]]) {
          const r = await call(route, { ...options, token: tokens[key] });
          assert.deepEqual([r.status, r.data?.mensaje], [403, NO_ROLE_MESSAGE], key + ' ' + route + ': el servicio deniega sin rol aunque la guard deje pasar');
        }
      }
      t.diagnostic('Con cero gerentes la guard activa deja las 4 cuentas solo con autoservicio (bloqueo total): previsto y comprobado por muestra.');
    });

    await t.test('asignación auditada de roles: cada una sube session_version, revoca el JWT anterior y el login nuevo trae el rol y permisos reales', async () => {
      for (const key of ['gerente', 'coord', 'sec']) {
        const rol = ACCOUNTS[key].rol, before = await account(key), oldToken = tokens[key];
        const others = Object.keys(tokens).filter(other => other !== key);
        const r = await assignRole(key, rol);
        assert.equal(r.code, 0, r.output);
        const after = await account(key);
        assert.deepEqual([after.rol, after.session_version], [rol, before.session_version + 1]);
        assert.deepEqual(await lastAudit(), { origen: 'terminal', actor_id: null, cuenta_id: before.id, operacion: 'rol_asignado', rol_anterior: null, rol_nuevo: rol, activo_anterior: 1, activo_nuevo: 1, operador: 'e35-preparacion' });
        assert.equal((await call('admin/me', { token: oldToken })).status, 401, key + ': el JWT anterior queda revocado');
        for (const other of others) assert.equal((await call('admin/me', { token: tokens[other] })).status, 200, other + ': otras sesiones intactas');
        const user = await freshLogin(key);
        assert.equal(user.rol, rol);
        assert.deepEqual(sorted(user.permisos), sorted(permissionsOf(rol)), key + ': permisos = matriz real');
        // El rol nuevo surte efecto real en la autorización con la sesión nueva.
        assert.equal((await call('admin/cursos', { token: tokens[key] })).status, 200, key + ': lee cursos con su rol');
      }
      assert.equal((await call('admin/users', { token: tokens.gerente })).status, 200, 'gerente: administra cuentas');
      for (const key of ['coord', 'sec']) assert.equal((await call('admin/users', { token: tokens[key] })).status, 403, key + ': sin administración de cuentas');
      assert.equal((await call('admin/stats', { token: tokens.sec })).status, 403, 'secretaria: sin estadísticas');
      const pf = preflight(await listar());
      assert.equal(pf.gerentes, 1);
      assert.deepEqual(pf.bloqueos.length, 1, 'solo queda la cuenta sin rol');
    });

    await t.test('separación de permisos de los tres roles y decisión prevista de la guard por cuenta', async () => {
      const [g, c, s] = [G, C, S].map(rol => new Set(permissionsOf(rol)));
      for (const p of [...c, ...s]) assert.ok(g.has(p), 'el gerente incluye ' + p);
      for (const p of g) if (p.startsWith('cuentas:')) assert.ok(!c.has(p) && !s.has(p), p + ' es exclusivo del gerente');
      assert.ok(g.has('mensajes:eliminar') && !c.has('mensajes:eliminar') && !s.has('mensajes:eliminar'));
      assert.ok(!s.has('estadisticas:leer') && c.has('estadisticas:leer'));
      assert.ok(!c.has('items:leer'), 'la coordinadora no abre la Biblioteca de contenido');
      const report = {};
      for (const key of ['gerente', 'coord', 'sec', 'sinrol']) report[key] = await predict(key);
      assert.equal(report.gerente.pasa, report.gerente.total - report.gerente.publica, '[PREVISTO] el gerente pasa por todas las rutas administrativas');
      assert.equal(report.gerente.denegada, 0, 'ninguna ruta del inventario queda sin clasificar');
      assert.ok(report.coord.pasa > report.sec.pasa && report.sec.pasa > report.sinrol.pasa);
      assert.equal(report.sinrol.sinRol, report.sinrol.total - report.sinrol.publica - SELF_SERVICE.length);
      t.diagnostic('[PREVISTO] rutas admin no públicas que pasarían (de ' + (report.gerente.total - report.gerente.publica) + '): gerente ' + report.gerente.pasa + ', coordinadora ' + report.coord.pasa + ', secretaria ' + report.sec.pasa + ', sin rol ' + report.sinrol.pasa + '. Permisos: G ' + g.size + ', C ' + c.size + ', S ' + s.size + '.');
    });

    await t.test('contraseña incorrecta: 401 genérico, sin token, idéntico al de un correo inexistente', async () => {
      const wrong = await login('gerente', PASSWORD + 'x');
      const ghost = await login(null, PASSWORD, 'nadie@horus-e35.test');
      assert.equal(wrong.status, 401);
      assert.deepEqual(wrong.data, ghost.data);
      assert.ok(!('token' in (wrong.data ?? {})));
    });

    await t.test('protección del último gerente: panel y script rechazan dejar el sistema sin GERENTE_GENERAL, sin escribir nada', async () => {
      const before = await snapshot();
      const self = await setActive('gerente', 'gerente', false);
      assert.equal(self.status, 409, 'el gerente no puede desactivarse a sí mismo');
      // Con AccessGuard activa la coordinadora ya no alcanza PUT /admin/users/:id: 403 por permisos antes de la regla M-1 (en modo
      // heredado llegaba al servicio y recibía 409 «último gerente»). La regla M-1 sigue cubierta por el script y por las pruebas unitarias.
      const byCoord = await setActive('coord', 'gerente', false);
      assert.deepEqual([byCoord.status, byCoord.data?.mensaje], [403, FORBIDDEN_MESSAGE]);
      assert.ok(!JSON.stringify(byCoord.data).includes(LAST_GERENTE_MESSAGE), 'la denegación no llega a evaluar la regla de negocio');
      const demote = await assignRole('gerente', S);
      assert.equal(demote.code, 1, 'el script no degrada al último gerente');
      assert.equal(await snapshot(), before, 'ninguna escritura ni auditoría');
      assert.equal((await call('admin/me', { token: tokens.gerente })).status, 200, 'la sesión del gerente sigue válida');
    });

    await t.test('cuenta inactiva: desactivar retira el rol y revoca la sesión; no inicia sesión; reactivar no restaura privilegios', async () => {
      const sinrolBefore = await account('sinrol');
      const off = await setActive('gerente', 'sinrol', false);
      assert.equal(off.status, 200);
      const sinrol = await account('sinrol');
      assert.deepEqual([Number(sinrol.activo), sinrol.rol, sinrol.session_version], [0, null, sinrolBefore.session_version + 1]);
      assert.deepEqual(await lastAudit(), { origen: 'panel', actor_id: (await account('gerente')).id, cuenta_id: sinrol.id, operacion: 'cuenta_desactivada', rol_anterior: null, rol_nuevo: null, activo_anterior: 1, activo_nuevo: 0, operador: null });
      assert.equal((await call('admin/me', { token: tokens.sinrol })).status, 401, 'JWT de la cuenta desactivada: 401');
      const wrong = await login('gerente', PASSWORD + 'y');
      const inactive = await login('sinrol');
      assert.equal(inactive.status, 401);
      assert.deepEqual(inactive.data, wrong.data, 'misma respuesta que una contraseña incorrecta (no revela el estado)');
      const before = await snapshot();
      assert.equal((await assignRole('sinrol', S)).code, 1, 'no se asigna rol a una cuenta inactiva');
      assert.equal(await snapshot(), before);
      const inactivePrediction = await predict('sinrol');
      assert.equal(inactivePrediction.sinSesion, inactivePrediction.total - inactivePrediction.publica, '[PREVISTO] 401 en toda ruta no pública');

      // Cuenta CON rol (secretaria): desactivar y reactivar la deja sin rol (M-2) y revoca cada vez.
      const secBefore = await account('sec');
      assert.equal((await setActive('gerente', 'sec', false)).status, 200);
      assert.equal((await setActive('gerente', 'sec', true)).status, 200);
      const sec = await account('sec');
      assert.deepEqual([Number(sec.activo), sec.rol, sec.session_version], [1, null, secBefore.session_version + 2]);
      assert.equal((await call('admin/me', { token: tokens.sec })).status, 401);
      const user = await freshLogin('sec');
      assert.deepEqual([user.rol, user.permisos], [null, []], 'reactivada sin rol');
      const pf = preflight(await listar());
      assert.deepEqual(pf.sinRol, [sec.id], 'el dictamen detecta la cuenta activa sin rol');
      const restored = await assignRole('sec', S);
      assert.equal(restored.code, 0, restored.output);
      assert.equal((await call('admin/me', { token: tokens.sec })).status, 401, 'reasignar revoca de nuevo');
    });

    await t.test('recuperación administrativa documentada: pérdida del único gerente, admin:create + GERENTE_GENERAL, acceso real comprobado', async () => {
      // [SIMULADO] la pérdida: intervención directa en la base (como en M-3), fuera de los scripts y del panel.
      await q("UPDATE admin_users SET activo = 0, session_version = session_version + 1 WHERE email = ? AND rol = 'GERENTE_GENERAL'", [ACCOUNTS.gerente.email]);
      assert.equal((await call('admin/me', { token: tokens.gerente })).status, 401);
      assert.equal((await login('gerente')).status, 401);
      const listing = await listar();
      assert.match(listing, /Gerentes generales activos: 0\./);
      assert.ok(preflight(listing).bloqueos.some(b => b.startsWith('sin GERENTE_GENERAL')));
      // Pasos 1-2: identificar el servidor en solo lectura; usar esos valores. Un servidor distinto no escribe.
      const [, destino, servidor] = listing.match(/--destino=(\S+) --servidor=(\S+)/);
      assert.deepEqual([destino, servidor], [dest, expectedUuid]);
      const before = await snapshot();
      assert.equal((await createAdmin('recup', confirm(randomUUID()))).code, 1, 'otro server_uuid: no se crea');
      assert.equal(await snapshot(), before);
      const createdRecovery = await createAdmin('recup', ['--destino=' + destino, '--servidor=' + servidor, ...OPERATOR]);
      assert.equal(createdRecovery.code, 0, createdRecovery.output);
      const promoted = await assignRole('recup', G, ['--destino=' + destino, '--servidor=' + servidor, ...OPERATOR]);
      assert.equal(promoted.code, 0, 'sin gerente activo no hace falta --permitir-otro-gerente\n' + promoted.output);
      const user = await freshLogin('recup');
      assert.equal(user.rol, G);
      assert.deepEqual(sorted(user.permisos), sorted(permissionsOf(G)));
      const p = await predict('recup');
      assert.equal(p.pasa, p.total - p.publica, '[PREVISTO] el gerente recuperado opera todas las rutas');
      assert.equal((await call('admin/users', { token: tokens.recup })).status, 200, 'real: el gerente recuperado administra cuentas');
      const pf = preflight(await listar());
      assert.deepEqual([pf.gerentes, pf.bloqueos], [1, []], 'dictamen final sin bloqueos');
    });

    await t.test('ninguna salida de scripts ni de la API muestra contraseñas, hashes, credenciales ni el JWT_SECRET', async () => {
      for (const output of [...outputs, apiLog]) {
        for (const secret of [PASSWORD, credentials.password, jwtSecret]) assert.ok(!output.includes(secret), 'sin secretos en la salida');
        assert.ok(!/\$2[aby]\$/.test(output), 'sin hashes');
      }
      for (const token of Object.values(tokens)) assert.ok(![...outputs, apiLog].some(output => output.includes(token)), 'sin tokens');
    });
  } finally {
    stopApi();
    try {
      if (created) { assert.match(name, NAME); await q('DROP DATABASE IF EXISTS `' + name + '`'); }
    } finally {
      await admin.end();
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});
