// Integración REAL del panel (H-BACK-01, E3.4.4 fase 2; contrato por_roles de E3.6): React compilado (dist/) ↔ NestJS real (backend/dist) ↔ JWT ↔ Prisma ↔ MySQL 8.4
// desechable. No forma parte de ningún `npm test` ni de la CI: se ejecuta a mano y solo contra un servidor MySQL creado para la ocasión.
// Guía, comandos y casos cubiertos/pendientes: docs/procedimientos/integracion-panel.md.
//
//   PANEL_IT_DB=true PANEL_IT_SERVER_UUID=<@@server_uuid leído por docker exec> DB_HOST=127.0.0.1 DB_PORT=<puerto> DB_USER=root DB_PASS=<clave de un solo uso>
//   npm run build && node scripts/integration-panel.cjs           (desde frontend/, con backend/dist compilado: cd backend && npm run build)
//
// Barreras, todas antes de crear nada (mismas que test/admin-scripts.integration.cjs del backend):
//  1. PANEL_IT_DB=true explícito.  2. DB_HOST de bucle local.  3. @@server_uuid de la conexión = PANEL_IT_SERVER_UUID (obtenido por otra vía).
//  4. Servidor recién creado (Uptime < 1 h) y sin tablas en ninguna base ajena a las del sistema.
// Solo crea y elimina la base horus_panel_it_<hex>. El esquema y las cuentas se crean con los procesos reales y auditados (init-database,
// migrate, admin:create, admin:assign-role con --destino/--servidor/--operador/--motivo). La API arranca desde un directorio vacío (sin .env),
// con la precarga isolate-env, un entorno mínimo explícito, un JWT_SECRET aleatorio de un solo uso y sin credenciales de correo ni de IA.
//
// E3.6: el NestJS real ya registra AccessGuard (acceso.modo = por_roles) y responde 403 por rol. Aquí se comprueba lo que hace React (qué
// muestra y qué solicitudes evita) contra respuestas reales, incluidos un 401 y un 403 reales del servidor. El barrido de autorización por
// ruta está en backend/test/access-guard-http.integration.cjs. La compatibilidad con un backend en modo heredado sigue en los smokes simulados.
//
// Real frente a simulado: todas las respuestas proceden del NestJS real. El servidor de smoke-kit sirve dist/ y reenvía /api/* sin cambios
// (mismo origen, como Caddy en producción). Solo en los casos marcados [SIMULADO] ese reenvío inyecta un fallo de red, un retraso o un
// estado 503/403 en lugar de (o antes de) la respuesta real. Ningún dato de cuentas, token ni contraseña se imprime.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { start, sleep, KEY } = require('./smoke-kit.cjs');

const backend = path.resolve(__dirname, '../../backend');
const mysql = require(require.resolve('mysql2/promise', { paths: [backend] }));
// Matriz real compilada (backend/dist/permissions/policy.js, sin Prisma ni configuración): los permisos esperados salen del backend.
const { permissionsOf } = require(path.join(backend, 'dist/permissions/policy.js'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NAME = /^horus_panel_it_[0-9a-f]{24}$/;
const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const PASSWORD = 'Ficticia-IT-' + randomBytes(6).toString('hex');
const NEW_PASSWORD = 'Ficticia-IT-nueva-' + randomBytes(6).toString('hex');
const OPERATOR = ['--operador=e344-integracion', '--motivo=Integracion E3.4.4 en base desechable'];
const ACCOUNTS = {
  gerente: { nombre: 'Gerente Ficticia', email: 'gerente@horus-it.test', rol: G },
  coord: { nombre: 'Coordinadora Ficticia', email: 'coordinadora@horus-it.test', rol: C },
  sec: { nombre: 'Secretaria Ficticia', email: 'secretaria@horus-it.test', rol: S },
  sinrol: { nombre: 'Cuenta Sinrol Ficticia', email: 'sinrol@horus-it.test', rol: null },
};
const LEGACY_MENU = ['Resumen', 'Educación', 'Servicios tecnológicos', 'Galería de proyectos', 'Preguntas frecuentes', 'Biblioteca de contenido', 'Convenios', 'Mensajes', 'Cotizaciones', 'Consultas del chatbot', 'Información de empresa'];
// Con AccessGuard (por_roles) el gerente, único rol con cuentas:leer, ve además «Roles y usuarios».
const MENU = { gerente: [...LEGACY_MENU, 'Roles y usuarios'], coord: LEGACY_MENU.filter(item => item !== 'Biblioteca de contenido'), sec: ['Educación', 'Mensajes', 'Consultas del chatbot', 'Información de empresa'], sinrol: [] };
// Mensajes de AccessGuard (backend/dist, sin Prisma ni configuración).
const { FORBIDDEN_MESSAGE, NO_ROLE_MESSAGE } = require(path.join(backend, 'dist/permissions/access.guard.js'));
// Permiso de lectura de cada GET del panel (backend/src/permissions/route-inventory.ts): vigila que ninguna cuenta pida datos que no puede leer.
const READ = [['stats', 'estadisticas:leer'], ['messages', 'mensajes:leer'], ['cotizaciones', 'cotizaciones:leer'], ['servicios', 'servicios:leer'], ['cursos', 'cursos:leer'],
  ['preguntas-frecuentes', 'preguntas_frecuentes:leer'], ['galeria', 'galeria:leer'], ['convenios', 'convenios:leer'], ['items', 'items:leer'], ['chatbot', 'chatbot_consultas:leer'],
  ['settings', 'configuracion:leer'], ['users', 'cuentas:leer'], ['contenido-original', 'contenido_original:leer'], ['seguimiento', 'seguimiento_mensajes:leer']];
const CAPACITACIONES = '/admin/dashboard?section=educacion&seccion=capacitaciones';
const PANEL = "/^\\/admin\\/(dashboard|messages)$/.test(location.pathname) && document.querySelector('.hp-sidebar')";
const LOGIN_PAGE = "location.pathname === '/admin/login' && document.querySelector('#email')";

const resources = { admin: null, name: null, created: false, api: null, cwd: null, kit: null };

// ---------- Procesos reales del backend, desde un directorio vacío y con un entorno mínimo ----------
function baseEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    DB_HOST: resources.host, DB_PORT: String(resources.port), DB_NAME: resources.name, DB_USER: process.env.DB_USER, DB_PASS: process.env.DB_PASS, DB_SSL: 'false', ...extra,
  };
}
function runScript(file, args = [], { input, extraEnv } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', path.join(backend, 'test/isolate-env.cjs'), path.join(backend, 'scripts', file), ...args],
      { cwd: resources.cwd, env: baseEnv(extraEnv), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    child.stdin.end(input ?? '');
  });
}
const confirm = () => ['--destino=' + resources.host + ':' + resources.port + '/' + resources.name, '--servidor=' + resources.uuid, ...OPERATOR];
const createAdmin = account => runScript('create-admin.cjs', confirm(), { input: account.nombre + '\n' + account.email + '\n', extraEnv: { ADMIN_INITIAL_PASSWORD: PASSWORD } });
const assignRole = (email, rol) => runScript('assign-role.cjs', ['--email=' + email, '--rol=' + rol, '--apply', '--confirmar=' + email, ...confirm()]);

function stopApi() {
  const child = resources.api; resources.api = null;
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
  else child.kill('SIGKILL');
}
process.on('exit', stopApi); // también si un fallo termina el proceso antes de la limpieza ordenada

async function startApi() {
  const port = await new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)); }); });
  const uploads = path.join(resources.cwd, 'uploads'); fs.mkdirSync(uploads);
  const env = baseEnv({ PORT: String(port), JWT_SECRET: 'it-only-' + randomBytes(24).toString('hex'), MAIL_PROVIDER: 'gmail', UPLOAD_DIR: uploads });
  const child = spawn(process.execPath, ['-r', path.join(backend, 'test/isolate-env.cjs'), path.join(backend, 'dist/main.js')], { cwd: resources.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  resources.api = child;
  let log = ''; child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
  const origin = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(origin + '/api/health')).ok) return { origin, log: () => log }; } catch { /* arrancando */ }
    await sleep(200);
  }
  throw new Error('La API real no arrancó (código ' + child.exitCode + '). Últimas líneas:\n' + log.split('\n').slice(-8).join('\n'));
}

// ---------- Límite real de /admin/login (10 por minuto e IP): se espera a la ventana siguiente en lugar de eludirlo ----------
const logins = { window: -1, count: 0 };
function countLogin() { const w = Math.floor(Date.now() / 60000); if (w !== logins.window) { logins.window = w; logins.count = 0; } logins.count++; }
async function loginSlot() {
  const w = Math.floor(Date.now() / 60000);
  if (w === logins.window && logins.count >= 8) { const wait = (w + 1) * 60000 - Date.now() + 1500; console.log('  ·  (esperando ' + Math.ceil(wait / 1000) + ' s a la ventana siguiente del límite de /admin/login)'); await sleep(wait); }
}

(async () => {
  // ===== 0. Barreras de aislamiento =====
  if (process.env.PANEL_IT_DB !== 'true') { console.error('Requiere PANEL_IT_DB=true y un MySQL desechable identificado (ver docs/procedimientos/integracion-panel.md).'); process.exit(2); }
  resources.host = process.env.DB_HOST || ''; resources.port = Number(process.env.DB_PORT || 0);
  resources.uuid = String(process.env.PANEL_IT_SERVER_UUID ?? '').trim().toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(resources.host) || !resources.port) throw new Error('DB_HOST debe ser de bucle local y DB_PORT explícito.');
  if (!UUID.test(resources.uuid)) throw new Error('PANEL_IT_SERVER_UUID debe ser el server_uuid del MySQL desechable.');
  if (!fs.existsSync(path.join(backend, 'dist/main.js'))) throw new Error('Falta backend/dist: ejecuta "npm run build" en backend/.');
  resources.admin = await mysql.createConnection({ host: resources.host, port: resources.port, user: process.env.DB_USER, password: process.env.DB_PASS });
  const q = async (sql, params) => (await resources.admin.query(sql, params))[0];
  const [{ uuid, uptime, version }] = await q("SELECT @@server_uuid AS uuid, @@version AS version, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime') AS uptime");
  if (String(uuid).toLowerCase() !== resources.uuid) throw new Error('El servidor conectado no es el MySQL desechable identificado.');
  if (!(Number(uptime) < 3600)) throw new Error('El servidor debe ser recién creado (Uptime < 1 h).');
  if (!String(version).startsWith('8.4')) throw new Error('Se esperaba MySQL 8.4.');
  const populated = await q('SELECT DISTINCT TABLE_SCHEMA AS s FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN (?)', [SYSTEM]);
  if (populated.length) throw new Error('El servidor contiene datos en otras bases: no es desechable.');
  console.log('\n== AISLAMIENTO');
  console.log('  ·  MySQL ' + version + ' en ' + resources.host + ':' + resources.port + ' | server_uuid=' + uuid + ' (coincide con el leído por docker exec) | Uptime ' + uptime + ' s | sin bases con tablas');

  resources.name = 'horus_panel_it_' + randomBytes(12).toString('hex');
  if (!NAME.test(resources.name)) throw new Error('Nombre de base inesperado.');
  resources.cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'horus-panel-it-api-')); // el perfil de Edge usa horus-panel-it-<x>
  await q('CREATE DATABASE `' + resources.name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  resources.created = true;
  console.log('  ·  base temporal ' + resources.name + ' creada; directorio de trabajo vacío (sin .env) para scripts y API');

  // ===== 1. Esquema y cuentas con los procesos reales =====
  for (const file of ['init-database.cjs', 'migrate.cjs', 'check-database.cjs']) {
    const result = await runScript(file);
    if (result.code !== 0) throw new Error(file + ' falló (código ' + result.code + ').');
  }
  for (const key of ['gerente', 'coord', 'sec', 'sinrol']) {
    const result = await createAdmin(ACCOUNTS[key]);
    if (result.code !== 0 || !/SIN ROL/.test(result.output)) throw new Error('admin:create falló para la cuenta ' + key + '.');
  }
  for (const key of ['gerente', 'coord', 'sec']) { // el primer rol debe ser GERENTE_GENERAL (regla del script)
    const result = await assignRole(ACCOUNTS[key].email, ACCOUNTS[key].rol);
    if (result.code !== 0) throw new Error('admin:assign-role falló para la cuenta ' + key + '.');
  }
  const db = async () => q('SELECT email, rol, activo, session_version FROM `' + resources.name + '`.admin_users ORDER BY id');
  const audit = await q('SELECT operacion, origen, operador FROM `' + resources.name + '`.admin_auditoria ORDER BY id');
  console.log('  ·  esquema: init + migraciones + db:check correctos; cuentas creadas con admin:create (' + audit.filter(a => a.operacion === 'cuenta_creada').length + ' altas auditadas) y roles con admin:assign-role (' + audit.filter(a => a.operacion === 'rol_asignado').length + ' asignaciones auditadas)');

  // ===== 2. API real =====
  const api = await startApi();
  const connections = await q('SELECT COUNT(*) AS n FROM information_schema.processlist WHERE DB = ?', [resources.name]);
  console.log('  ·  NestJS real (backend/dist) en ' + api.origin + ' con ' + connections[0].n + ' conexión(es) a ' + resources.name);

  // Reenvío transparente de /api/* a la API real, con registro y fallos inyectados SOLO cuando un caso [SIMULADO] los pide.
  const who = new Map(); // token → cuenta (nunca se imprime el token)
  let log = [], faults = [];
  const label = token => (token ? who.get(token) || 'desconocido' : 'sin-token');
  const handler = async (req, res, { route, json }) => {
    if (route === '/__it/log') return json({ log }) || true;
    if (!route.startsWith('/api/')) return false;
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const entry = { method: req.method, route, who: label(token), status: 0, fault: null };
    log.push(entry);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const fault = faults.find(f => route.startsWith(f.route) && (!f.method || f.method === req.method) && f.times > 0);
    if (fault) { fault.times--; entry.fault = fault.kind; }
    if (fault?.kind === 'network') { req.socket.destroy(); return true; }
    if (fault?.kind === 'status') { entry.status = fault.status; return json({ ok: false, mensaje: 'Respuesta simulada.' }, fault.status) || true; }
    if (fault?.kind === 'delay') await sleep(fault.ms);
    if (route === '/api/admin/login' && req.method === 'POST') countLogin();
    const headers = {}; for (const h of ['authorization', 'content-type', 'idempotency-key', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
    const upstream = await fetch(api.origin + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const body = Buffer.from(await upstream.arrayBuffer());
    entry.status = upstream.status;
    if (route === '/api/admin/login' && upstream.ok) { try { const data = JSON.parse(body); who.set(data.token, Object.keys(ACCOUNTS).find(k => ACCOUNTS[k].email === data.user.email)); } catch { /* sin token */ } }
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(body);
    return true;
  };

  const k = await start({ prefix: 'panel-it', handler });
  resources.kit = k;
  const { ck, open, closePages, origin } = k;
  const obs = text => console.log('  OBS ' + text);

  // ---------- Llamadas directas a la API real ----------
  const call = async (route, { token, method = 'GET', body } = {}) => {
    const response = await fetch(api.origin + '/api/' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let data = null; try { data = await response.json(); } catch { /* sin cuerpo */ }
    return { status: response.status, data };
  };
  const login = async (key, password = PASSWORD) => {
    await loginSlot(); countLogin();
    const r = await call('admin/login', { method: 'POST', body: { email: ACCOUNTS[key].email, password } });
    if (r.data?.token) who.set(r.data.token, key);
    return r;
  };
  const jwtPayload = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const leaks = data => /\$2[aby]\$|"password"|session_version|"version"/.test(JSON.stringify(data));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const tokens = {};

  // ===== 3. Contrato real de login y /admin/me =====
  console.log('\n== CONTRATO REAL: POST /api/admin/login y GET /api/admin/me');
  const rows = await db();
  for (const key of ['gerente', 'coord', 'sec', 'sinrol']) {
    const account = ACCOUNTS[key], expected = permissionsOf(account.rol);
    const r = await login(key);
    tokens[key] = r.data?.token;
    const user = r.data?.user || {};
    ck(r.status === 200 && same(Object.keys(r.data).sort(), ['acceso', 'mensaje', 'ok', 'token', 'user']) && same(Object.keys(user).sort(), ['email', 'id', 'nombre', 'permisos', 'rol']), key + ': login 200 con user.{id,nombre,email,rol,permisos} y acceso', { status: r.status, keys: r.data && Object.keys(r.data), user: Object.keys(user) });
    ck(user.rol === account.rol && user.rol === rows.find(row => row.email === account.email).rol, key + ': user.rol = ' + account.rol + ' (el mismo valor que la columna admin_users.rol en MySQL)');
    ck(same(user.permisos, expected), key + ': user.permisos = permissionsOf(' + account.rol + ') de policy.ts (' + expected.length + ' permisos)', { recibidos: user.permisos?.length });
    ck(r.data?.acceso?.modo === 'por_roles' && same(Object.keys(r.data.acceso), ['modo']), key + ': acceso.modo = por_roles');
    ck(!leaks(r.data), key + ': la respuesta no contiene hash, password ni session_version');
    const payload = jwtPayload(tokens[key]);
    ck(same(Object.keys(payload).sort(), ['aud', 'email', 'exp', 'iat', 'id', 'iss', 'version']) && !('rol' in payload) && !('permisos' in payload), key + ': el JWT solo lleva id, email y version (sin rol ni permisos)', Object.keys(payload));
    const me = await call('admin/me', { token: tokens[key] });
    ck(me.status === 200 && same(me.data.user, user) && same(me.data.acceso, { modo: 'por_roles' }) && !leaks(me.data) && same(Object.keys(me.data).sort(), ['acceso', 'ok', 'user']), key + ': /admin/me devuelve exactamente la misma identidad y acceso que el login');
  }
  const wrong = await (async () => { await loginSlot(); countLogin(); return call('admin/login', { method: 'POST', body: { email: ACCOUNTS.gerente.email, password: PASSWORD + 'x' } }); })();
  ck(wrong.status === 401 && !wrong.data?.token && wrong.data?.mensaje === 'Credenciales incorrectas.', 'contraseña incorrecta: 401 genérico y sin token');
  ck((await call('admin/me')).status === 401, '/admin/me sin token: 401');
  ck((await call('admin/me', { token: 'no-es-un-jwt' })).status === 401, '/admin/me con un token mal formado: 401');
  const forged = (() => { const [h, , s] = tokens.sec.split('.'); const p = { ...jwtPayload(tokens.sec), rol: G, permisos: ['cuentas:leer'] }; return h + '.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.' + s; })();
  ck((await call('admin/me', { token: forged })).status === 401, '/admin/me con un JWT alterado (rol y permisos añadidos al payload): 401 por firma');
  const logoutRoutes = [];
  for (const route of ['admin/logout', 'admin/auth/logout', 'admin/session']) for (const method of ['POST', 'DELETE']) logoutRoutes.push((await call(route, { token: tokens.gerente, method })).status);
  ck(logoutRoutes.every(status => status === 404), 'no existe ruta de cierre de sesión en el backend (logout/auth/logout/session: 404); el cierre es solo del cliente', logoutRoutes);
  // AccessGuard activa: el servidor decide con el rol de MySQL (no con lo que muestre React).
  const stats = { gerente: await call('admin/stats', { token: tokens.gerente }), coord: await call('admin/stats', { token: tokens.coord }), sec: await call('admin/stats', { token: tokens.sec }), sinrol: await call('admin/stats', { token: tokens.sinrol }) };
  ck(stats.gerente.status === 200 && stats.coord.status === 200, 'AccessGuard activa: gerente y coordinadora leen /admin/stats (200)', [stats.gerente.status, stats.coord.status]);
  ck(stats.sec.status === 403 && stats.sec.data?.mensaje === FORBIDDEN_MESSAGE, 'AccessGuard activa: la secretaria recibe 403 real en /admin/stats', stats.sec.status);
  ck(stats.sinrol.status === 403 && stats.sinrol.data?.mensaje === NO_ROLE_MESSAGE, 'AccessGuard activa: la cuenta sin rol recibe 403 «sin rol» real en /admin/stats', stats.sinrol.status);
  const users = [await call('admin/users', { token: tokens.gerente }), await call('admin/users', { token: tokens.coord })];
  ck(users[0].status === 200 && users[1].status === 403, 'AccessGuard activa: solo la gerencia lista cuentas (gerente 200, coordinadora 403)', users.map(r => r.status));

  // Datos ficticios mínimos, creados por la API real con la sesión de la gerente.
  const curso = await call('admin/cursos', { token: tokens.gerente, method: 'POST', body: { titulo: 'Capacitación ficticia IT', slug: 'capacitacion-ficticia-it', descripcion: 'Registro ficticio de la prueba integrada.', tipo: 'capacitacion', estado: 'publicado' } });
  const mensaje = await call('admin/messages', { token: tokens.gerente, method: 'POST', body: { nombre: 'Persona Ficticia', email: 'consulta@horus-it.test', asunto: 'Consulta ficticia IT', mensaje: 'Texto ficticio de la prueba integrada.' } });
  const messageId = mensaje.data?.item?.id ?? mensaje.data?.message?.id ?? mensaje.data?.data?.id ?? mensaje.data?.id;
  ck(curso.status === 201 && mensaje.status === 201 && Number.isInteger(messageId), 'datos ficticios creados por la API real (una capacitación y una consulta manual)', { curso: curso.status, mensaje: mensaje.status });

  // ---------- Navegador ----------
  const requests = async () => (await fetch(origin + '/__it/log').then(r => r.json())).log;
  const clean = async () => { await closePages(); log = []; faults = []; const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.clear(); sessionStorage.clear(); 1'); await closePages(); log = []; };
  const restore = async (key, route = '/admin/dashboard', ready) => {
    const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(tokens[key]) + '); 1');
    await p.go(route); await p.wait(PANEL, 'panel (' + route + ')'); if (ready) await p.wait(ready, 'contenido de ' + route); await sleep(600); return p;
  };
  const menu = p => p.evaluate('[...document.querySelectorAll("aside nav .hp-nav-item")].map(b => b.textContent.trim())');
  const heading = p => p.text('main h1');
  const notice = p => p.evaluate('document.querySelector("[data-panel-access]")?.dataset.panelAccess || null');
  const stored = p => p.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')');
  const has = (p, text, scope = 'main') => p.evaluate('[...document.querySelectorAll(' + JSON.stringify(scope + ' button, ' + scope + ' a') + ')].some(b => (b.textContent + " " + (b.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").includes(' + JSON.stringify(text) + '))');
  const readonlyNotice = p => p.evaluate('!!document.querySelector("main [data-panel-readonly]")');
  const calls = async (key, prefix) => (await requests()).filter(r => r.who === key && r.route.startsWith('/api/admin/' + prefix));
  const writes = async key => (await requests()).filter(r => r.who === key && r.method !== 'GET' && r.route !== '/api/admin/login');
  // Modo por_roles: una cuenta sin rol no puede leer nada (permisos vacíos), así que cualquier GET distinto de /admin/me cuenta.
  const forbiddenCalls = async key => { const perms = permissionsOf(ACCOUNTS[key].rol);
    return (await requests()).filter(r => r.who === key && r.method === 'GET' && r.route !== '/api/admin/me')
      .filter(r => { const sub = r.route.slice('/api/admin/'.length).split(/[/?]/)[0]; const need = READ.find(([prefix]) => prefix === sub)?.[1]; return !need || !perms.includes(need); }); };
  const deniedResponses = async key => (await requests()).filter(r => r.who === key && r.status === 403);
  const uiLogin = async (p, key, password = PASSWORD) => {
    await loginSlot();
    await p.go('/admin/login', LOGIN_PAGE);
    await p.type('#email', 0, ACCOUNTS[key].email); await p.type('#password', 0, password);
    await sleep(150); // que React confirme el estado del formulario antes de enviarlo
    await p.evaluate('document.querySelector(".admin-auth__form").requestSubmit(); 1');
  };
  // Espera el panel tras un login por formulario; si no se abre, informa del aviso del formulario y de las respuestas reales de /admin/login.
  const panelAfterLogin = async (p, what) => {
    try { await p.wait(PANEL, what, 15000); } catch {
      const statuses = (await requests()).filter(r => r.route === '/api/admin/login').map(r => r.fault || r.status);
      throw new Error('No se abrió el ' + what + '. Aviso del formulario: «' + (await p.text('#login-error')) + '». Estados de /admin/login: ' + statuses.join(', ') + '. Ruta: ' + (await p.path()));
    }
  };

  // ===== A. Login por la interfaz y restauración =====
  console.log('\n== A. LOGIN POR LA INTERFAZ Y RESTAURACIÓN (real)');
  await clean();
  { const p = await open(); await uiLogin(p, 'gerente'); await panelAfterLogin(p, 'panel tras el login'); await sleep(800);
    const seen = await requests();
    ck((await p.evaluate('location.pathname')) === '/admin/dashboard' && (await heading(p)).includes('Hola'), 'gerente: el login real abre el Resumen');
    ck(seen.filter(r => r.route === '/api/admin/login').map(r => r.status).join() === '200' && !seen.some(r => r.route === '/api/admin/me'), 'el login trae el contrato completo: el panel no consulta /admin/me tras iniciar sesión');
    ck(typeof (await stored(p)) === 'string' && (await stored(p)).split('.').length === 3, 'el token se guarda en localStorage (solo el token)');
    ck(same(await p.evaluate('[Object.keys(localStorage), Object.keys(sessionStorage)]'), [[KEY], []]), 'ni el rol ni los permisos se guardan en el almacenamiento del navegador (solo la clave del token)');
    tokens.gerenteUi = await stored(p); who.set(tokens.gerenteUi, 'gerente');
    log = []; await p.go('/admin/dashboard'); await p.wait(PANEL, 'panel restaurado'); await sleep(800);
    const me = (await requests()).filter(r => r.route === '/api/admin/me');
    ck(me.length === 1 && me[0].status === 200 && (await menu(p)).length === MENU.gerente.length, 'al recargar, la sesión se restaura con una sola consulta real a /admin/me (200)', me); }
  await clean();
  { const p = await open(); await uiLogin(p, 'gerente', PASSWORD + 'x'); await p.wait('document.querySelector("#login-error")', 'error de login');
    ck((await p.text('#login-error')).length > 0 && (await stored(p)) === null && (await p.evaluate('location.pathname')) === '/admin/login', 'contraseña incorrecta: mensaje en el formulario, sin token guardado y sin abrir el panel', await p.text('#login-error')); }

  // ===== B, C, I. Menú e inicio de cada rol =====
  console.log('\n== B/C/I. MENÚ E INICIO POR ROL Y CUENTA SIN ROL (real, modo por_roles)');
  for (const key of ['gerente', 'coord', 'sec', 'sinrol']) {
    await clean();
    const p = await restore(key);
    if (key === 'sinrol') {
      const text = await p.text('main');
      ck((await p.evaluate('location.pathname')) === '/admin/dashboard' && (await notice(p)) === 'sin-rol' && text.includes('Cuenta básica'), 'sin rol: espacio básico en lugar de un inicio de trabajo', { path: await p.path(), notice: await notice(p) });
      ck(same(await menu(p), ['Mi espacio']), 'sin rol: no monta ninguna sección administrativa (solo «Mi espacio»)', await menu(p));
      const other = (await requests()).filter(r => r.who === 'sinrol' && r.route !== '/api/admin/me');
      ck(other.length === 0, 'sin rol: ninguna solicitud administrativa aparte de /admin/me', other);
    } else {
      const home = key === 'sec' ? '/admin/messages' : '/admin/dashboard';
      ck((await p.evaluate('location.pathname')) === home && (await heading(p)).includes(key === 'sec' ? 'Centro de consultas' : 'Hola'), key + ': inicio en ' + home, { path: await p.path(), h1: await heading(p) });
      ck(same(await menu(p), MENU[key]), key + ': menú esperado (' + MENU[key].length + ' secciones)', await menu(p));
      ck((await notice(p)) === null, key + ': sin aviso de acceso en el inicio');
    }
    ck((await p.text('aside')).includes('Roles y usuarios') === (key === 'gerente'), key + ': «Roles y usuarios» ' + (key === 'gerente' ? 'aparece (cuentas:leer)' : 'no aparece'));
    const bad = await forbiddenCalls(key);
    ck(bad.length === 0, key + ': ninguna consulta a datos que no puede leer', bad);
    const denied = await deniedResponses(key);
    ck(denied.length === 0, key + ': ninguna respuesta 403 real (las secciones ocultas no disparan solicitudes no autorizadas)', denied);
    if (key === 'sec') ck((await calls('sec', 'stats')).length === 0, 'secretaria: el inicio en Mensajes no consulta /admin/stats');
  }

  // ===== D/E. Modo consulta y operaciones permitidas =====
  console.log('\n== D/E. MODO CONSULTA Y OPERACIONES (real)');
  await clean();
  { let p = await restore('sec', CAPACITACIONES, 'document.querySelector(".hw-resource, .hp-table tbody tr")');
    ck(!(await has(p, 'Crear capacitación')) && !(await has(p, 'Editar')) && (await readonlyNotice(p)), 'secretaria: Capacitaciones en modo consulta (sin Crear ni Editar, con aviso)');
    await closePages();
    p = await restore('sec', '/admin/dashboard?section=ajustes', 'document.querySelector("main form input")');
    ck((await p.evaluate('[...document.querySelectorAll("main form input")].every(i => i.matches(":disabled"))')) && !(await has(p, 'Guardar configuración')) && (await readonlyNotice(p)), 'secretaria: Información de empresa con campos deshabilitados y sin Guardar');
    await p.evaluate('document.querySelector("main form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); 1'); await sleep(500);
    ck((await calls('sec', 'settings')).every(r => r.method === 'GET'), 'secretaria: enviar el formulario (Enter) no hace PUT /admin/settings');
    await closePages();
    p = await restore('sec', '/admin/messages?id=' + messageId, 'document.querySelector(".hw-inbox-detail form textarea")');
    ck((await has(p, 'Registro manual')) && (await has(p, 'Iniciar atención')) && !(await has(p, 'Eliminar consulta')) && !(await has(p, 'Preparar cotización')), 'secretaria: Mensajes con registro manual e «Iniciar atención»; sin Eliminar ni Preparar cotización');
    ck((await writes('sec')).length === 0, 'secretaria: ninguna escritura hasta aquí', await writes('sec'));
    await p.click('main button', 'Iniciar atención'); await sleep(1500);
    const done = await writes('sec');
    ck(done.length === 1 && done[0].status >= 200 && done[0].status < 300, 'secretaria: «Iniciar atención» (permitida) llega a la API real y se confirma (' + done.map(r => r.method + ' ' + r.route + ' ' + r.status).join(', ') + ')', done); }
  await clean();
  { let p = await restore('coord', CAPACITACIONES, 'document.querySelector(".hw-resource, .hp-table tbody tr")');
    ck((await has(p, 'Crear capacitación')) && (await has(p, 'Editar')) && !(await readonlyNotice(p)), 'coordinadora: Capacitaciones con Crear y Editar');
    await closePages();
    p = await restore('coord', '/admin/messages?id=' + messageId, 'document.querySelector(".hw-inbox-detail form textarea")');
    ck((await has(p, 'Preparar cotización')) && !(await has(p, 'Eliminar consulta')), 'coordinadora: «Preparar cotización» sí; «Eliminar consulta» no');
    await closePages();
    p = await restore('coord', '/admin/dashboard?section=ajustes', 'document.querySelector("main form input")');
    ck(!(await has(p, 'Guardar configuración')) && (await readonlyNotice(p)), 'coordinadora: Información de empresa en modo consulta');
    ck((await writes('coord')).length === 0, 'coordinadora: ninguna escritura', await writes('coord')); }
  await clean();
  { let p = await restore('gerente', '/admin/messages?id=' + messageId, 'document.querySelector(".hw-inbox-detail form textarea")');
    ck((await has(p, 'Eliminar consulta')) && (await has(p, 'Preparar cotización')), 'gerente: Mensajes con Eliminar y Preparar cotización');
    await closePages();
    p = await restore('gerente', '/admin/dashboard?section=ajustes', 'document.querySelector("main form input")');
    ck((await has(p, 'Guardar configuración')) && (await p.evaluate('!document.querySelector("main form input").matches(":disabled")')), 'gerente: Información de empresa editable'); }

  // ===== F. Enlaces directos a secciones prohibidas =====
  console.log('\n== F. ENLACES DIRECTOS SIN PERMISO (real)');
  for (const [route, apiPrefix, what] of [['/admin/dashboard?section=cotizaciones', 'cotizaciones', 'Cotizaciones'], ['/admin/dashboard?section=resumen', 'stats', 'Resumen'], ['/admin/dashboard?section=convenios', 'convenios', 'Convenios'], ['/admin/dashboard?section=contenido', 'items', 'Biblioteca']]) {
    await clean(); const p = await restore('sec', route);
    ck((await notice(p)) === 'denegado' && (await p.path()) === route && (await calls('sec', apiPrefix)).length === 0, 'secretaria → ' + what + ': aviso, sin redirección y sin solicitud a /admin/' + apiPrefix);
  }
  await clean();
  { const p = await restore('coord', '/admin/dashboard?section=contenido');
    ck((await notice(p)) === 'denegado' && (await calls('coord', 'items')).length === 0, 'coordinadora → Biblioteca: aviso y sin consultar /admin/items'); }
  await clean();
  { const p = await restore('gerente', '/admin/dashboard?section=cuentas');
    await p.wait('document.querySelector("[data-accounts] tbody tr")', 'listado real de cuentas');
    ck((await heading(p)) === 'Roles y usuarios' && (await calls('gerente', 'users')).length === 1, 'gerente → ?section=cuentas: abre «Roles y usuarios» con el listado real de /admin/users', { h1: await heading(p), users: await calls('gerente', 'users') }); }
  { const p = await restore('coord', '/admin/dashboard?section=cuentas');
    ck((await notice(p)) === 'denegado' && (await calls('coord', 'users')).length === 0, 'coordinadora → ?section=cuentas: aviso y sin consultar /admin/users'); }

  // ===== J. Errores temporales [SIMULADO sobre la API real] =====
  console.log('\n== J. ERRORES TEMPORALES Y REINTENTO [SIMULADO: fallo inyectado en el reenvío; el resto de respuestas es real]');
  // El fallo se mantiene hasta retirarlo: ante un corte de conexión Chromium repite el GET por su cuenta.
  for (const fault of [{ kind: 'network' }, { kind: 'status', status: 503 }]) {
    await clean(); faults = [{ route: '/api/admin/me', times: Infinity, ...fault }];
    const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(tokens.coord) + '); 1');
    await p.go('/admin/dashboard'); await p.wait('[...document.querySelectorAll("button")].some(b => b.textContent.includes("Reintentar"))', 'aviso con Reintentar');
    const name = fault.kind === 'network' ? 'fallo de red' : '503';
    ck((await stored(p)) === tokens.coord && !(await p.evaluate('!!document.querySelector(".hp-sidebar")')), name + ' en /admin/me al restaurar: aviso con Reintentar, sin abrir el panel y sin borrar la sesión');
    faults = [];
    await p.click('button', 'Reintentar'); await p.wait(PANEL, 'panel tras reintentar'); await sleep(500);
    const me = (await requests()).filter(r => r.route === '/api/admin/me');
    ck(me.length >= 2 && me.slice(0, -1).every(r => r.fault) && me.at(-1).status === 200 && !me.at(-1).fault, name + ': «Reintentar» consulta de nuevo la API real (200) y abre el panel', me.map(r => r.fault || r.status));
  }
  await clean();
  { const p = await restore('coord', CAPACITACIONES, 'document.querySelector(".hw-resource, .hp-table tbody tr")');
    faults = ['/api/admin/cursos', '/api/admin/servicios'].map(route => ({ route, times: Infinity, kind: 'network' }));
    await p.click('aside nav .hp-nav-item', 'Mensajes'); await sleep(300); await p.click('aside nav .hp-nav-item', 'Educación'); await sleep(1500);
    ck((await stored(p)) === tokens.coord && (await p.evaluate('!!document.querySelector(".hp-sidebar")')), 'fallo de red en una sección con la sesión abierta: la sesión se conserva');
    faults = []; }

  // ===== 401 frente a 403 =====
  console.log('\n== 401 FRENTE A 403');
  await clean();
  { const p = await restore('coord', CAPACITACIONES, 'document.querySelector(".hw-resource, .hp-table tbody tr")');
    await sleep(5200); log = []; faults = ['/api/admin/cursos', '/api/admin/servicios'].map(route => ({ route, times: 1, kind: 'status', status: 403 })); // fuera del intervalo mínimo de revalidación (5 s)
    await p.click('aside nav .hp-nav-item', 'Mensajes'); await sleep(300); await p.click('aside nav .hp-nav-item', 'Educación'); await sleep(1500);
    const me = (await requests()).filter(r => r.route === '/api/admin/me');
    ck((await stored(p)) === tokens.coord && (await p.evaluate('!!document.querySelector(".hp-sidebar")')) && me.length >= 1 && me.every(r => r.status === 200), '[SIMULADO] 403 en una sección: no cierra la sesión y revalida con /admin/me real (200)', (await requests()).map(r => r.method + ' ' + r.route + ' ' + (r.fault || r.status))); }
  // 403 REAL. SIMULACIÓN CONTROLADA, EXCLUSIVA DE LA BASE MySQL TEMPORAL de esta ejecución (resources.name, contenedor efímero): un UPDATE
  // directo cambia el rol de la coordinadora a SECRETARIA SIN incrementar session_version. Es la única forma de obtener un 403 real de
  // AccessGuard con un JWT que sigue siendo válido: el panel abierto conserva la lista de permisos anterior, así que «Convenios» sigue en
  // el menú y su GET recibe el 403. NO es un procedimiento administrativo ni debe confundirse con admin:assign-role, que sí incrementa
  // session_version y revoca las sesiones anteriores (lo comprueba la sección G). Al terminar, otro UPDATE directo restaura el rol.
  await clean();
  { const p = await restore('coord', '/admin/dashboard');
    const sessionBefore = (await db()).find(r => r.email === ACCOUNTS.coord.email).session_version;
    await q('UPDATE `' + resources.name + '`.admin_users SET rol = ? WHERE email = ?', [S, ACCOUNTS.coord.email]);
    ACCOUNTS.coord.rol = S;
    await sleep(5200); log = []; // fuera del intervalo mínimo de revalidación tras un 403 (5 s)
    await p.click('aside nav .hp-nav-item', 'Convenios');
    await p.wait('document.body.innerText.includes("no tiene permiso") || document.querySelector("[data-panel-access=denegado]")', 'aviso tras el 403 real', 10000).catch(() => {});
    const shown = { text: (await p.text('main')).includes('no tiene permiso'), notice: await notice(p) };
    await p.wait('document.querySelectorAll("aside nav .hp-nav-item").length === ' + MENU.sec.length, 'menú revalidado', 10000).catch(() => {});
    const seen = await requests();
    const real403 = seen.filter(r => r.route.startsWith('/api/admin/convenios') && r.status === 403 && !r.fault);
    const me = seen.filter(r => r.route === '/api/admin/me');
    ck(real403.length >= 1, '403 REAL de AccessGuard al abrir Convenios con permisos desactualizados (sin fallo inyectado)', seen.map(r => r.method + ' ' + r.route + ' ' + (r.fault || r.status)));
    ck((await stored(p)) === tokens.coord && (await p.evaluate('!!document.querySelector(".hp-sidebar")')) && !(await p.evaluate('!!(' + LOGIN_PAGE + ')')), '403 real: la sesión se conserva (mismo token, panel abierto, sin volver al login)');
    ck(shown.text || shown.notice === 'denegado', '403 real: el panel muestra el aviso de falta de permiso', shown);
    ck(me.length >= 1 && me.every(r => r.status === 200) && same(await menu(p), MENU.sec), '403 real: revalida con /admin/me real (200) y el menú pasa al del rol vigente en MySQL', { me: me.map(r => r.status), menu: await menu(p) });
    ck((await db()).find(r => r.email === ACCOUNTS.coord.email).session_version === sessionBefore, '403 real: no revoca la sesión (session_version sin cambios)');
    await q('UPDATE `' + resources.name + '`.admin_users SET rol = ? WHERE email = ?', [C, ACCOUNTS.coord.email]);
    ACCOUNTS.coord.rol = C; }

  // ===== Sesiones entre pestañas =====
  console.log('\n== SESIONES ENTRE PESTAÑAS');
  await clean();
  { const tab1 = await restore('gerente');
    const tab2 = await open(); await tab2.go('/__empty');
    // Login real de la secretaria (API real) escrito en el almacenamiento compartido, como haría la pantalla de login de otra pestaña.
    await tab2.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(tokens.sec) + '); 1');
    await tab1.wait('location.pathname === "/admin/messages" && document.querySelectorAll("aside nav .hp-nav-item").length === ' + MENU.sec.length, 'cambio de cuenta en la pestaña 1', 10000).catch(() => {});
    ck(same(await menu(tab1), MENU.sec) && (await calls('sec', 'me')).some(r => r.status === 200), 'otra pestaña inicia sesión con otra cuenta: la pestaña 1 la valida con /admin/me real y pasa a esa cuenta (modelo compartido, sin cambios)', await menu(tab1)); }
  await clean();
  { faults = [{ route: '/api/admin/me', times: 1, kind: 'delay', ms: 3000 }];
    const tab1 = await open(); await tab1.go('/__empty'); await tab1.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(tokens.coord) + '); 1');
    await tab1.go('/admin/dashboard', 'document.body'); await sleep(400);
    const tab2 = await open(); await tab2.go('/__empty'); await tab2.evaluate('localStorage.removeItem(' + JSON.stringify(KEY) + '); 1');
    await sleep(3800);
    ck((await tab1.evaluate('!!(' + LOGIN_PAGE + ')')) && !(await tab1.evaluate('!!document.querySelector(".hp-sidebar")')) && (await stored(tab1)) === null, '[SIMULADO: /admin/me real retrasado 3 s] la otra pestaña cierra sesión mientras tanto: la respuesta tardía (200) no reabre el panel'); }

  // ===== H. Cierre de sesión y JWT inválido =====
  console.log('\n== H. CIERRE DE SESIÓN Y JWT INVÁLIDO (real)');
  await clean();
  { const p = await restore('gerente');
    await p.click('.hp-sidebar-bottom button, .hp-sidebar-bottom a', 'Cerrar sesión'); await p.wait(LOGIN_PAGE, 'login tras cerrar sesión');
    ck((await stored(p)) === null && !(await p.text('body')).includes('Tu sesión terminó'), 'Cerrar sesión: vuelve al login, borra el token y no lo presenta como sesión caducada');
    ck(!(await requests()).some(r => r.method !== 'GET' && r.route !== '/api/admin/login'), 'el cierre de sesión no hace ninguna solicitud al backend (no existe ruta de logout)');
    const still = await call('admin/me', { token: tokens.gerente });
    ck(still.status === 200, 'tras cerrar sesión en el panel, el mismo JWT sigue siendo válido en el servidor (sin revocación en logout; caduca a las 8 h o al cambiar session_version)');
    obs('Riesgo: cerrar sesión no revoca el JWT en el servidor. Documentado como pendiente; no se cambia el modelo en esta fase.'); }
  for (const [what, token] of [['un token mal formado', 'no-es-un-jwt'], ['un JWT alterado (rol añadido, firma inválida)', forged]]) {
    await clean(); const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(token) + '); 1');
    await p.go('/admin/dashboard', 'document.body'); await p.wait(LOGIN_PAGE, 'login', 10000).catch(() => {});
    ck((await p.evaluate('!!(' + LOGIN_PAGE + ')')) && (await stored(p)) === null && (await requests()).some(r => r.route === '/api/admin/me' && r.status === 401), 'restaurar con ' + what + ': /admin/me real responde 401, se borra el token y se muestra el login');
  }

  // ===== G. Cambio de rol en MySQL temporal con admin:assign-role =====
  console.log('\n== G. CAMBIO DE ROL CON admin:assign-role Y REVALIDACIÓN (real)');
  await clean();
  { const p = await restore('sec', '/admin/messages');
    const before = (await db()).find(r => r.email === ACCOUNTS.sec.email);
    const result = await assignRole(ACCOUNTS.sec.email, C);
    const after = (await db()).find(r => r.email === ACCOUNTS.sec.email);
    ck(result.code === 0 && after.rol === C && after.session_version === before.session_version + 1, 'admin:assign-role (auditado, con --destino/--servidor) cambia secretaria → COORDINADORA_INSTITUCIONAL e incrementa session_version');
    ck((await call('admin/me', { token: tokens.sec })).status === 401, 'el JWT anterior queda revocado: /admin/me real responde 401');
    await p.click('aside nav .hp-nav-item', 'Educación');
    await p.wait(LOGIN_PAGE, 'login tras la revocación', 10000).catch(() => {});
    ck((await p.evaluate('!!(' + LOGIN_PAGE + ')')) && (await p.text('body')).includes('Tu sesión terminó') && (await stored(p)) === null, 'el panel abierto recibe 401 en su siguiente solicitud y vuelve al login indicando que la sesión terminó');
    ACCOUNTS.sec.rol = C;
    await uiLogin(p, 'sec'); await panelAfterLogin(p, 'panel con el rol nuevo'); await sleep(800);
    tokens.sec = await stored(p); who.set(tokens.sec, 'sec');
    ck((await p.evaluate('location.pathname')) === '/admin/dashboard' && same(await menu(p), MENU.coord), 'al volver a entrar, el menú es el de COORDINADORA_INSTITUCIONAL (inicio en el Resumen)', await menu(p));
    const me = await call('admin/me', { token: tokens.sec });
    ck(me.data?.user?.rol === C && same(me.data.user.permisos, permissionsOf(C)), '/admin/me real informa el rol nuevo leído de MySQL y sus permisos de policy.ts'); }
  obs('admin:assign-role siempre incrementa session_version: un cambio de rol cierra la sesión; no hay revalidación «en caliente» de permisos con el procedimiento autorizado.');

  // ===== Revocación por session_version (cambio de contraseña) =====
  console.log('\n== REVOCACIÓN POR session_version: CAMBIO DE CONTRASEÑA (real)');
  await clean();
  { const p = await restore('sinrol'); const opened = Date.now();
    const changed = await call('admin/password', { token: tokens.sinrol, method: 'POST', body: { current_password: PASSWORD, password: NEW_PASSWORD } });
    ck(changed.status === 200, 'POST /admin/password (autoservicio de una cuenta sin rol, contraseña ficticia) responde 200 con AccessGuard activa');
    ck((await call('admin/me', { token: tokens.sinrol })).status === 401, 'el JWT anterior ya no vale (session_version incrementado)');
    // La cuenta sin rol no tiene secciones que pulsar: su siguiente solicitud es la revalidación al recuperar el foco (como mucho una cada 30 s).
    await sleep(Math.max(0, opened + 31000 - Date.now())); await p.evaluate('window.dispatchEvent(new Event("focus")); 1');
    await p.wait(LOGIN_PAGE, 'login', 10000).catch(() => {});
    ck((await p.evaluate('!!(' + LOGIN_PAGE + ')')) && (await stored(p)) === null && (await requests()).some(r => r.route === '/api/admin/me' && r.status === 401), 'el panel abierto con ese JWT recibe 401 real al revalidar y vuelve al login');
    const relog = await login('sinrol', NEW_PASSWORD);
    ck(relog.status === 200 && relog.data.user.rol === null && same(relog.data.user.permisos, []) && relog.data.acceso.modo === 'por_roles', 'login con la contraseña nueva: rol null, permisos [] y modo por_roles'); }

  // ===== Cierre =====
  console.log('\n== ESTADO FINAL');
  const final = await db();
  ck(same(final.map(r => [r.email, r.rol]), [[ACCOUNTS.gerente.email, G], [ACCOUNTS.coord.email, C], [ACCOUNTS.sec.email, C], [ACCOUNTS.sinrol.email, null]]), 'las cuatro cuentas ficticias existen solo en ' + resources.name + ' con los roles esperados');
  await closePages();
  await teardown();
  // Limpieza oficial (smoke-cleanup.cjs), sin cambios: cierra el árbol de Edge y borra el perfil. En Windows el perfil puede seguir
  // bloqueado unos instantes tras cerrar el navegador (EPERM); la limpieza es idempotente y solo se repite el borrado del perfil.
  for (let attempt = 1; ; attempt++) {
    try { k.cleanup(); if (attempt > 1) console.log('  ·  perfil de Edge borrado al reintento ' + attempt); break; } catch (error) {
      if (attempt >= 30 || !/EPERM|EBUSY/.test(error.message)) throw error;
      if (attempt === 1) console.log('  ·  perfil de Edge aún bloqueado tras cerrar el navegador (EPERM); se reintenta solo su borrado, hasta 30 s');
      await sleep(1000);
    }
  }
  k.finish('Integración real del panel (E3.4.4 fase 2, contrato por_roles de E3.6)');
})().catch(async error => {
  console.error('\nERROR: ' + (error?.stack || error));
  try { await teardown(); } catch (cleanupError) { console.error('Limpieza: ' + cleanupError.message); }
  for (let attempt = 1; resources.kit && attempt <= 30; attempt++) {
    try { await resources.kit.closePages(); resources.kit.cleanup(); break; } catch (cleanupError) {
      if (attempt === 30 || !/EPERM|EBUSY/.test(cleanupError.message)) { console.error('Limpieza del navegador: ' + cleanupError.message); break; }
      await sleep(1000);
    }
  }
  process.exit(1);
});

// Detiene la API, elimina la base temporal (solo horus_panel_it_<hex>) y el directorio de trabajo. Idempotente.
async function teardown() {
  stopApi();
  if (resources.admin) {
    try {
      if (resources.created && NAME.test(resources.name)) {
        await resources.admin.query('DROP DATABASE IF EXISTS `' + resources.name + '`');
        resources.created = false;
        console.log('  ·  base ' + resources.name + ' eliminada (con ella, las cuentas ficticias)');
      }
    } finally { await resources.admin.end(); resources.admin = null; }
  }
  if (resources.cwd) { fs.rmSync(resources.cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); resources.cwd = null; }
}
