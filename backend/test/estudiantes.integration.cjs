// Integración real: AppModule, JWT/AccessGuard y MySQL. Sin .env, correos, migraciones ni borrados.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const http = require('node:http');

test('Estudiantes: contrato HTTP, permisos y persistencia real en MySQL aislado', { timeout: 120000 }, async t => {
  if (process.env.STUDENTS_TEST_DB !== 'true') return t.skip('Requiere STUDENTS_TEST_DB=true y UUID local explícito.');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  assert.match(process.env.STUDENTS_TEST_SERVER_UUID || '', /^[a-f0-9-]{36}$/i);
  const source = process.env.STUDENTS_TEST_TEMPLATE;
  assert.ok(['horus_db', 'horus_local'].includes(source) || /^horus_students_template_[0-9a-f]{24}$/.test(source || ''), 'plantilla local explícita de solo lectura o plantilla desechable identificada');
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS });
  let api;
  const name = 'horus_estudiantes_it_' + randomBytes(12).toString('hex');
  const password = 'Estudiantes-it-' + randomBytes(12).toString('hex');
  const cwd = mkdtempSync(join(tmpdir(), 'horus-estudiantes-api-'));
  try {
    const [[server]] = await db.query('SELECT @@server_uuid AS uuid');
    assert.equal(server.uuid, process.env.STUDENTS_TEST_SERVER_UUID);
    const [tables] = await db.query('SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?', [source, 'BASE TABLE']);
    assert.ok(tables.some(row => row.n === 'estudiantes'));
    assert.match(name, /^horus_estudiantes_it_[0-9a-f]{24}$/);
    // Solo DDL aditivo en una base nueva, jamás sobre la plantilla.
    await db.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    console.log('Base aislada conservada: ' + name);
    for (const row of tables) {
      assert.match(row.n, /^[a-zA-Z0-9_]+$/);
      await db.query('CREATE TABLE `' + name + '`.`' + row.n + '` LIKE `' + source + '`.`' + row.n + '`');
    }
    await db.changeUser({ database: name });
    const hash = await bcrypt.hash(password, 10);
    for (const [email, rol] of [['gerente@estudiantes.test', 'GERENTE_GENERAL'], ['basica@estudiantes.test', null], ['secretaria@estudiantes.test', 'SECRETARIA']]) {
      await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta de prueba', email, hash, rol]);
    }
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    api = fork(join(__dirname, 'fixtures/access-guard-app.cjs'), [], {
      cwd, windowsHide: true, silent: true, execArgv: ['-r', join(__dirname, 'isolate-env.cjs')],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development',
        DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER, DB_PASS: process.env.DB_PASS, DB_NAME: name,
        JWT_SECRET: randomBytes(32).toString('hex'), PORT: String(port), MAIL_PROVIDER: 'gmail', HORUS_ACCESS_GUARD_FIXTURE: 'e36' },
    });
    // El fixture existente informa rutas; su puerto efímero se publica por IPC para estas pruebas.
    let startupLog = '';
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API aislada no inició a tiempo')), 30000);
      api.once('message', message => { clearTimeout(timer); resolve(message); });
      api.once('exit', () => { clearTimeout(timer); reject(new Error('API aislada terminó antes de iniciar: ' + startupLog.replaceAll(process.env.DB_PASS || '\0', '[oculto]').slice(-1400))); });
      api.stderr.on('data', chunk => { startupLog += chunk; }); api.stdout.on('data', chunk => { startupLog += chunk; });
    });
    const base = 'http://127.0.0.1:' + ready.port + '/api';
    const request = async (path, token, method = 'GET', body) => {
      const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const login = async email => {
      const result = await request('/admin/login', null, 'POST', { email, password });
      assert.equal(result.status, 200);
      return result.body.token;
    };
    const gerente = await login('gerente@estudiantes.test'), basica = await login('basica@estudiantes.test'), secretaria = await login('secretaria@estudiantes.test');
    const path = '/admin/estudiantes';
    await t.test('JWT y cuenta básica no conceden acceso académico', async () => {
      assert.equal((await request(path)).status, 401);
      for (const method of ['GET', 'POST', 'PUT']) assert.equal((await request(path + (method === 'PUT' ? '/1' : ''), basica, method, method === 'GET' ? undefined : {})).status, 403);
    });
    let student;
    const input = { nombres: ' Ana ', apellidos: ' Pérez López ', doc_numero: '00123456', email: ' ANA@example.test ', telefono: '+51 987 654 321' };
    await t.test('alta normalizada, DNI conserva ceros; lista vacía y datos inválidos', async () => {
      const empty = await request(path, gerente);
      assert.equal(empty.status, 200); assert.equal(empty.body.pagination.total, 0);
      for (const body of [{ ...input, nombres: '  ' }, { ...input, doc_numero: '1234567' }, { ...input, doc_numero: '１２３４５６７８' }, { ...input, doc_numero: '12345678\n' }, { ...input, email: null }, { ...input, telefono: 'abc' }, { ...input, rol: 'GERENTE_GENERAL' }]) assert.equal((await request(path, gerente, 'POST', body)).status, 400);
      const created = await request(path, gerente, 'POST', input);
      assert.equal(created.status, 201); student = created.body.item;
      assert.equal(student.nombres, 'Ana'); assert.equal(student.doc_numero, '00123456'); assert.equal(student.email, 'ana@example.test'); assert.equal(student.revision, 1);
      assert.equal((await request(path + '/' + student.id, gerente)).body.item.apellidos, 'Pérez López');
    });
    await t.test('DNI único incluso ante altas simultáneas; contactos compartidos permitidos', async () => {
      assert.equal((await request(path, gerente, 'POST', input)).status, 409);
      const concurrent = await Promise.all([1, 2].map(() => request(path, gerente, 'POST', { ...input, doc_numero: '00234567' })));
      assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
      assert.equal((await request(path, secretaria, 'POST', { ...input, nombres: 'Luis', doc_numero: '00345678' })).status, 201);
    });
    await t.test('búsqueda, paginación y límites', async () => {
      const byName = await request(path + '?search=Perez%20Lopez&limit=1&page=1', gerente);
      assert.equal(byName.status, 200); assert.equal(byName.body.items.length, 1); assert.equal(byName.body.pagination.total, 3); assert.equal(byName.body.pagination.pages, 3);
      const byDni = await request(path + '?search=00123456', gerente); assert.equal(byDni.body.items[0].id, student.id); assert.equal(byDni.body.pagination.total, 1);
      for (const query of ['page=0', 'limit=101', 'estado=otro', 'page=abc', 'unknown=1']) assert.equal((await request(path + '?' + query, gerente)).status, 400);
      assert.equal((await request(path + '?page=2&limit=2', gerente)).body.items.length, 1);
      for (const id of ['0', '-1', 'abc', '2147483648', '9007199254740993']) assert.equal((await request(path + '/' + id, gerente)).status, 400);
    });
    await t.test('edición conserva historial, limpia opcionales y rechaza revisiones obsoletas', async () => {
      const id = '/' + student.id;
      assert.equal((await request(path + id, secretaria, 'PUT', { revision: 1, nombres: 'Otro' })).status, 403);
      for (const body of [{ revision: 1 }, { nombres: 'Otro' }, { revision: 1, email: null }, { revision: 1, apellidos: '' }]) assert.equal((await request(path + id, gerente, 'PUT', body)).status, 400);
      const updated = await request(path + id, gerente, 'PUT', { revision: 1, nombres: 'Ana María', email: '', telefono: '' });
      assert.equal(updated.status, 200); assert.equal(updated.body.item.revision, 2); assert.equal(updated.body.item.email, null); assert.equal(updated.body.item.telefono, null);
      assert.equal((await request(path + id, gerente, 'PUT', { revision: 1, nombres: 'Obsoleto' })).status, 409);
      assert.equal((await request(path + '/2147483647', gerente)).status, 404);
      assert.equal((await request(path + '/2147483647', gerente, 'PUT', { revision: 1, nombres: 'Otro' })).status, 404);
    });
    await t.test('archivo y restauración con revisión; no existe borrado', async () => {
      const archive = path + '/' + student.id + '/archivo';
      assert.equal((await request(archive, basica, 'PUT', { revision: 2, archivado: true })).status, 403);
      assert.equal((await request(archive, secretaria, 'PUT', { revision: 2, archivado: true })).status, 403);
      const archived = await request(archive, gerente, 'PUT', { revision: 2, archivado: true });
      assert.equal(archived.status, 200); assert.ok(archived.body.item.archivado_at); assert.equal(archived.body.item.revision, 3);
      assert.equal((await request(path, gerente)).body.pagination.total, 2);
      assert.equal((await request(path + '?estado=archivados', gerente)).body.pagination.total, 1);
      assert.equal((await request(path + '?estado=todos', gerente)).body.pagination.total, 3);
      assert.equal((await request(path, gerente, 'POST', input)).status, 409);
      assert.equal((await request(archive, gerente, 'PUT', { revision: 2, archivado: false })).status, 409);
      const restored = await request(archive, gerente, 'PUT', { revision: 3, archivado: false });
      assert.equal(restored.status, 200); assert.equal(restored.body.item.archivado_at, null);
      assert.equal((await request(path + '/' + student.id, gerente, 'DELETE')).status, 404);
      const [[stored]] = await db.execute('SELECT COUNT(*) AS n FROM estudiantes WHERE id=?', [student.id]); assert.equal(stored.n, 1);
    });
    await t.test('regresiones públicas de contenido y chatbot', async () => {
      for (const endpoint of ['/cursos', '/servicios', '/convenios', '/galeria', '/settings']) assert.equal((await request(endpoint)).status, 200);
      const chatbot = await request('/chatbot/message', null, 'POST', { message: 'Cursos disponibles' });
      assert.equal(chatbot.status, 200);
    });
    if (process.env.STUDENTS_BROWSER === 'true') {
      const result = await new Promise((resolve, reject) => {
        const browser = fork(join(__dirname, '../../frontend/scripts/smoke-estudiantes.cjs'), [], {
          cwd: join(__dirname, '../../frontend'), windowsHide: true, silent: true, execArgv: [],
          env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
            HORUS_STUDENTS_BROWSER_CHILD: 'true', STUDENTS_SCREENSHOTS_DIR: process.env.STUDENTS_SCREENSHOTS_DIR },
        });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => {
          if (process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
          else browser.kill('SIGTERM');
          reject(new Error('El navegador aislado excedió el tiempo de prueba.'));
        }, 90000);
        browser.once('message', message => {
          if (message?.type === 'request-isolated-api') browser.send({ type: 'isolated-api', base, password, database: name });
        });
        browser.stdout.on('data', chunk => { stdout += chunk; }); browser.stderr.on('data', chunk => { stderr += chunk; });
        browser.once('error', error => { clearTimeout(timer); reject(error); });
        browser.once('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
      });
      console.log(result.stdout); assert.equal(result.status, 0, result.stderr?.slice(-800));
    }
  } finally {
    if (api?.connected) {
      const stopped = new Promise(resolve => api.once('exit', resolve));
      api.disconnect(); await stopped;
    }
    await db.end();
    // Deliberadamente no DROP ni DELETE: se conserva la evidencia aislada.
  }
});
