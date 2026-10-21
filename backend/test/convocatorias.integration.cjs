// HTTP real y MySQL 8.4 desechable, sin .env ni bases habituales. Conserva la base ficticia hasta retirar el contenedor propio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { validatedPreinscripciones } = require('./fixtures/preinscripciones-fixture.cjs');
const http = require('node:http');
const backend = join(__dirname, '..');
const versions = JSON.parse(readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const migration = '20261018-convocatorias-capacidad';

test('Ediciones: migración conservadora, HTTP, permisos, concurrencia y trazabilidad en MySQL desechable', { timeout: 180000 }, async t => {
  if (process.env.EDITIONS_TEST_DB !== 'true') return t.skip('Requiere EDITIONS_TEST_DB=true y un servidor desechable identificado por UUID.');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  assert.match(process.env.EDITIONS_TEST_SERVER_UUID || '', /^[0-9a-f-]{36}$/);
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS, timezone: 'Z', dateStrings: true });
  let api;
  const name = 'horus_ediciones_it_' + randomBytes(12).toString('hex');
  const password = 'Ficticia-ediciones-' + randomBytes(10).toString('hex');
  const runSql = async version => {
    for (const sql of readFileSync(join(backend, 'migrations', version + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean)) await db.query(sql);
  };
  try {
    const [[server]] = await db.query("SELECT @@server_uuid AS uuid, VERSION() AS version, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime') AS uptime");
    assert.equal(server.uuid, process.env.EDITIONS_TEST_SERVER_UUID); assert.match(server.version, /^8\.4\./); assert.ok(Number(server.uptime) < 3600);
    const [populated] = await db.query("SELECT DISTINCT TABLE_SCHEMA AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')");
    assert.deepEqual(populated, [], 'solo se permite un servidor vacío y recién creado');
    assert.match(name, /^horus_ediciones_it_[0-9a-f]{24}$/);
    await db.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await db.changeUser({ database: name });
    await runSql('00000000-initial');
    for (const version of versions) { if (version === migration) break; await runSql(version); }
    const [course] = await db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Excel Básico','excel-ediciones-test','Curso de prueba','curso','presencial','20 horas','publicado',NOW(),NOW())");
    const courseId = course.insertId;
    await db.query("INSERT INTO convocatorias (curso_id,nombre) VALUES (?, 'Edición anterior')", [courseId]);
    const [before] = await db.query('SELECT * FROM convocatorias');
    const [courseBefore] = await db.query('SELECT * FROM cursos');
    await t.test('migración aditiva conserva datos anteriores sin inventar capacidad y CHECK impide cero', async () => {
      await runSql(migration);
      const [after] = await db.query('SELECT * FROM convocatorias');
      assert.equal(after.length, before.length); const { capacidad, ...rest } = after[0]; assert.equal(capacidad, null); assert.deepEqual(rest, before[0]);
      await assert.rejects(db.query('UPDATE convocatorias SET capacidad=0'), e => e.errno === 3819);
    });
    // La API compilada de hoy selecciona las columnas que añade 20261020-preinscripciones (minimo_apertura, preinscripcion_estado, codigo_publico):
    // el resto del esquema vigente se completa con las migraciones registradas después de la de esta suite, como haría db:migrate.
    for (const version of versions.slice(versions.indexOf(migration) + 1)) await runSql(version);
    const hash = await bcrypt.hash(password, 10);
    for (const [key, role] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]]) await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta ficticia', key + '@ediciones.test', hash, role]);
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const apiPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    api = fork(join(__dirname, 'fixtures/access-guard-app.cjs'), [], { cwd: mkdtempSync(join(tmpdir(), 'horus-ediciones-api-')), windowsHide: true, silent: true,
      execArgv: ['-r', join(__dirname, 'isolate-env.cjs')], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development',
        DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER, DB_PASS: process.env.DB_PASS, DB_NAME: name,
        JWT_SECRET: randomBytes(32).toString('hex'), PORT: String(apiPort), MAIL_PROVIDER: 'gmail', HORUS_ACCESS_GUARD_FIXTURE: 'e36' } });
    const ready = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('API de prueba no inició')), 30000); api.once('message', m => { clearTimeout(timer); resolve(m); }); api.once('exit', () => { clearTimeout(timer); reject(new Error('API de prueba terminó antes de iniciar')); }); });
    const base = 'http://127.0.0.1:' + ready.port + '/api';
    const request = async (path, token, method = 'GET', body) => {
      const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json() };
    };
    const tokens = {};
    for (const key of ['g', 'c', 's', 'b']) { const r = await request('/admin/login', null, 'POST', { email: key + '@ediciones.test', password }); assert.equal(r.status, 200); tokens[key] = r.body.token; }
    const path = '/admin/convocatorias';
    const input = { curso_id: courseId, nombre: ' Noviembre 2026 ', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 };
    let edition;
    await t.test('permisos por operación: sin JWT 401, básica 403, secretaría solo lee', async () => {
      for (const [method, suffix, body] of [['GET', '', undefined], ['GET', '/cursos', undefined], ['GET', '/1', undefined], ['POST', '', input], ['PUT', '/1', { revision: 1, capacidad: 10 }], ['PUT', '/1/apertura', { revision: 1 }], ['PUT', '/1/cierre', { revision: 1, estado: 'cancelada' }], ['PUT', '/1/archivo', { revision: 1, archivado: true }]]) {
        assert.equal((await request(path + suffix, null, method, body)).status, 401);
        assert.equal((await request(path + suffix, tokens.b, method, body)).status, 403);
        assert.equal((await request(path + suffix, tokens.s, method, body)).status, method === 'GET' ? 200 : 403);
      }
    });
    await t.test('alta normalizada y persistencia, calendario y capacidad estrictos, curso existente', async () => {
      for (const patch of [{ capacidad: 0 }, { capacidad: '20' }, { capacidad: 1.5 }, { fecha_inicio: '2026-02-30' }, { fecha_fin: '2026-10-31' }, { estado: 'cerrada' }, { curso_id: null }]) assert.equal((await request(path, tokens.g, 'POST', { ...input, ...patch })).status, 400);
      assert.equal((await request(path, tokens.g, 'POST', { ...input, curso_id: 2147483647 })).status, 404);
      const result = await request(path, tokens.c, 'POST', input); assert.equal(result.status, 201); edition = result.body.item;
      assert.equal(edition.nombre, 'Noviembre 2026'); assert.equal(edition.fecha_inicio, '2026-11-01'); assert.equal(edition.capacidad, 20); assert.equal(edition.estado, 'planificada'); assert.equal(edition.revision, 1);
      assert.equal((await request(path + '/' + edition.id, tokens.s)).body.item.curso.titulo, 'Excel Básico');
      for (const q of ['limit=101', 'page=0', 'estado=otro', 'archivo=otro', 'curso_id=abc', 'unknown=1']) assert.equal((await request(path + '?' + q, tokens.g)).status, 400);
      const filtered = await request(path + '?curso_id=' + courseId + '&search=Noviembre&estado=planificada&limit=1', tokens.g); assert.equal(filtered.body.pagination.total, 1); assert.equal(filtered.body.items[0].id, edition.id);
      assert.equal((await request(path + '/cursos?search=Excel&limit=1', tokens.s)).body.pagination.total, 1);
    });
    await t.test('duplicados, también concurrentes y según colación; cambio de nombre protegido', async () => {
      assert.equal((await request(path, tokens.g, 'POST', { ...input, nombre: 'noviembre 2026' })).status, 409);
      const result = await Promise.all([1, 2].map(() => request(path, tokens.g, 'POST', { ...input, nombre: 'Diciembre 2026' })));
      assert.deepEqual(result.map(r => r.status).sort(), [201, 409]);
      assert.equal((await request(path + '/' + edition.id, tokens.g, 'PUT', { revision: 1, nombre: 'Diciembre 2026' })).status, 409);
    });
    await t.test('edición y fechas combinadas; dos escrituras simultáneas: un ganador y un 409', async () => {
      const url = path + '/' + edition.id;
      assert.equal((await request(url, tokens.g, 'PUT', { revision: 1 })).status, 400);
      assert.equal((await request(url, tokens.g, 'PUT', { revision: 1, curso_id: courseId })).status, 400);
      assert.equal((await request(url, tokens.g, 'PUT', { revision: 1, fecha_inicio: '2026-12-01' })).status, 400);
      const results = await Promise.all([25, 30].map(capacidad => request(url, tokens.g, 'PUT', { revision: 1, capacidad })));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); edition = results.find(r => r.status === 200).body.item;
      assert.equal(edition.revision, 2);
      assert.equal((await request(url, tokens.g, 'PUT', { revision: 1, capacidad: 40 })).status, 409);
    });
    await t.test('capacidad no baja de ocupación existente; apertura y cierre preservan trazabilidad', async () => {
      const [student] = await db.query("INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES ('Persona','Ficticia','PE','DNI','00123456')");
      // Fixture SQL únicamente: no se desarrolla ni llama a una API de Matrículas.
      await db.query('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (?,?)', [student.insertId, edition.id]);
      await db.query('INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES (?,?,?,?,?)', ['Otra', 'Ficticia', 'PE', 'DNI', '00123457']);
      const [[student2]] = await db.query("SELECT id FROM estudiantes WHERE doc_numero='00123457'");
      await db.query('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (?,?)', [student2.id, edition.id]);
      assert.equal((await request(path + '/' + edition.id, tokens.g, 'PUT', { revision: 2, capacidad: 1 })).status, 409);
      assert.equal((await request(path + '/1/apertura', tokens.g, 'PUT', { revision: 1 })).status, 409, 'anterior sin fechas/capacidad no se abre');
      await db.query("UPDATE convocatorias SET fecha_inicio='2026-11-01',fecha_fin='2026-11-30',capacidad=1 WHERE id=1");
      await db.query('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (?,1),(?,1)', [student.insertId, student2.id]);
      assert.equal((await request(path + '/1/apertura', tokens.g, 'PUT', { revision: 1 })).status, 409, 'tampoco se abre un legado con ocupación superior a su capacidad');
      await db.query('UPDATE convocatorias SET fecha_inicio=NULL,fecha_fin=NULL,capacidad=NULL WHERE id=1');
      assert.equal((await request(path + '/' + edition.id + '/apertura', tokens.c, 'PUT', { revision: 2 })).status, 409, 'una edición nueva no se abre sin 10 preinscripciones validadas');
      await validatedPreinscripciones(db, edition.id, 10, 'ed'); // regla vigente (20261020-preinscripciones): 10 validadas insertadas por SQL en la base desechable
      edition = (await request(path + '/' + edition.id + '/apertura', tokens.c, 'PUT', { revision: 2 })).body.item;
      assert.equal(edition.estado, 'abierta'); assert.equal(edition.revision, 3);
      assert.equal((await request(path + '/' + edition.id + '/archivo', tokens.g, 'PUT', { revision: 3, archivado: true })).status, 409);
      const races = await Promise.all([
        request(path + '/' + edition.id + '/cierre', tokens.c, 'PUT', { revision: 3, estado: 'cerrada' }),
        request(path + '/' + edition.id, tokens.g, 'PUT', { revision: 3, capacidad: 40 }),
      ]);
      assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
      edition = (await request(path + '/' + edition.id, tokens.g)).body.item;
      if (edition.estado === 'abierta') edition = (await request(path + '/' + edition.id + '/cierre', tokens.c, 'PUT', { revision: edition.revision, estado: 'cerrada' })).body.item;
      assert.equal(edition.estado, 'cerrada');
      assert.equal((await request(path + '/' + edition.id, tokens.g, 'PUT', { revision: edition.revision, capacidad: 50 })).status, 409);
      assert.equal((await request(path + '/' + edition.id + '/apertura', tokens.g, 'PUT', { revision: edition.revision })).status, 409);
      const [history] = await db.query("SELECT operacion,campos,actor_id,revision FROM academico_historial WHERE entidad='convocatoria' AND entidad_id=? ORDER BY id", [edition.id]);
      assert.equal(history.length, edition.revision); assert.equal(history[0].operacion, 'creacion');
      assert.ok(history.every(r => r.actor_id && Array.isArray(r.campos)), 'mysql2 devuelve JSON como array; solo se guardan nombres de campos');
    });
    await t.test('archivo/restauración, unicidad conservada y ningún DELETE', async () => {
      let r = await request(path + '/' + edition.id + '/archivo', tokens.g, 'PUT', { revision: edition.revision, archivado: true }); assert.equal(r.status, 200); edition = r.body.item; assert.ok(edition.archivado_at);
      assert.equal((await request(path + '?archivo=archivados', tokens.s)).body.pagination.total, 1);
      assert.equal((await request(path, tokens.g, 'POST', input)).status, 409);
      r = await request(path + '/' + edition.id + '/archivo', tokens.c, 'PUT', { revision: edition.revision, archivado: false }); assert.equal(r.status, 200); assert.equal(r.body.item.archivado_at, null);
      assert.equal((await request(path + '/' + edition.id, tokens.g, 'DELETE')).status, 404);
      assert.deepEqual((await db.query('SELECT * FROM cursos'))[0], courseBefore);
    });
    await t.test('historial y edición se revierten juntos si falla la auditoría; cancelación terminal', async () => {
      let other = (await request(path + '?search=Diciembre', tokens.g)).body.items[0];
      const [before] = await db.query('SELECT * FROM convocatorias WHERE id=?', [other.id]);
      await db.query("CREATE TRIGGER ediciones_historial_fallo BEFORE INSERT ON academico_historial FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio de auditoría'");
      try {
        assert.equal((await request(path + '/' + other.id, tokens.g, 'PUT', { revision: other.revision, capacidad: 45 })).status, 500);
        assert.deepEqual((await db.query('SELECT * FROM convocatorias WHERE id=?', [other.id]))[0], before, 'no se persiste una edición sin historial');
      } finally { await db.query('DROP TRIGGER ediciones_historial_fallo'); }
      const cancelled = await request(path + '/' + other.id + '/cierre', tokens.c, 'PUT', { revision: other.revision, estado: 'cancelada' });
      assert.equal(cancelled.status, 200); other = cancelled.body.item; assert.equal(other.estado, 'cancelada');
      assert.equal((await request(path + '/' + other.id + '/apertura', tokens.g, 'PUT', { revision: other.revision })).status, 409);
    });
    await t.test('regresiones: Estudiantes, autenticación, catálogo, contenido y chatbot', async () => {
      const student = await request('/admin/estudiantes', tokens.s, 'POST', { nombres: 'Ana', apellidos: 'Ficticia', doc_numero: '00123458' }); assert.equal(student.status, 201);
      const updated = await request('/admin/estudiantes/' + student.body.item.id, tokens.g, 'PUT', { revision: 1, nombres: 'Ana María' }); assert.equal(updated.status, 200);
      assert.equal((await request('/admin/estudiantes?search=00123458', tokens.s)).body.pagination.total, 1);
      assert.equal((await request('/admin/me', tokens.b)).status, 200);
      for (const endpoint of ['/cursos', '/servicios', '/galeria', '/convenios', '/settings']) assert.equal((await request(endpoint)).status, 200);
      assert.equal((await request('/chatbot/message', null, 'POST', { message: 'Cursos disponibles' })).status, 200);
    });
    if (process.env.EDITIONS_BROWSER === 'true') await t.test('React ↔ API ↔ MySQL en navegador de escritorio y móvil', async () => {
      const browser = fork(join(backend, '../frontend/scripts/smoke-ediciones.cjs'), [], { cwd: join(backend, '../frontend'), windowsHide: true, silent: true, execArgv: [],
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HORUS_EDITIONS_BROWSER_CHILD: 'true', EDITIONS_SCREENSHOTS_DIR: process.env.EDITIONS_SCREENSHOTS_DIR } });
      let output = '';
      browser.once('message', () => browser.send({ type: 'isolated-api', base, password, database: name }));
      browser.stdout.on('data', chunk => { output += chunk; }); browser.stderr.on('data', chunk => { output += chunk; });
      const status = await new Promise((resolve, reject) => { const timer = setTimeout(() => { browser.kill(); reject(new Error('Navegador excedió tiempo')); }, 90000); browser.once('exit', code => { clearTimeout(timer); resolve(code); }); browser.once('error', reject); });
      assert.equal(status, 0, output); t.diagnostic(output);
    });
    t.diagnostic('Base ficticia conservada en el servidor desechable: ' + name);
  } finally {
    if (api?.connected) { const exited = new Promise(resolve => api.once('exit', resolve)); api.disconnect(); await exited; }
    await db.end();
  }
});
