const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const http = require('node:http');
const backend = join(__dirname, '..');
const versions = JSON.parse(readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));

test('Matrículas: HTTP real, InnoDB, cupos, historial y permisos', { timeout: 240000 }, async t => {
  if (process.env.MATRICULAS_TEST_DB !== 'true') return t.skip('Requiere MySQL 8.4 desechable y UUID.');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  assert.match(process.env.MATRICULAS_TEST_SERVER_UUID || '', /^[0-9a-f-]{36}$/);
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS, timezone: 'Z', dateStrings: true });
  const name = 'horus_matriculas_it_' + randomBytes(12).toString('hex');
  const password = 'Ficticia-matriculas-' + randomBytes(10).toString('hex');
  let api, apiDir;
  try {
    const [[server]] = await db.query("SELECT @@server_uuid AS uuid, VERSION() AS version, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime') AS uptime");
    assert.equal(server.uuid, process.env.MATRICULAS_TEST_SERVER_UUID); assert.match(server.version, /^8\.4\./); assert.ok(Number(server.uptime) < 3600);
    const [tables] = await db.query("SELECT DISTINCT TABLE_SCHEMA FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')");
    assert.deepEqual(tables, [], 'el servidor debe estar recién creado y vacío');
    await db.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await db.changeUser({ database: name });
    for (const version of ['00000000-initial', ...versions]) for (const sql of readFileSync(join(backend, 'migrations', version + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean)) await db.query(sql);
    const hash = await bcrypt.hash(password, 10);
    for (const [key, role] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]]) await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta ficticia', key + '@matriculas.test', hash, role]);
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const apiPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    apiDir = mkdtempSync(join(tmpdir(), 'horus-matriculas-api-'));
    api = fork(join(__dirname, 'fixtures/access-guard-app.cjs'), [], { cwd: apiDir, windowsHide: true, silent: true,
      execArgv: ['-r', join(__dirname, 'isolate-env.cjs')], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development',
        DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER, DB_PASS: process.env.DB_PASS, DB_NAME: name,
        JWT_SECRET: randomBytes(32).toString('hex'), PORT: String(apiPort), MAIL_PROVIDER: 'gmail', HORUS_ACCESS_GUARD_FIXTURE: 'e36' } });
    const ready = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('API no inició')), 30000); api.once('message', m => { clearTimeout(timer); resolve(m); }); api.once('exit', () => { clearTimeout(timer); reject(new Error('API terminó antes de iniciar')); }); });
    const base = 'http://127.0.0.1:' + ready.port + '/api';
    const request = async (path, token, method = 'GET', body) => {
      const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json() };
    };
    const tokens = {};
    for (const key of ['g', 'c', 's', 'b']) { const r = await request('/admin/login', null, 'POST', { email: key + '@matriculas.test', password }); assert.equal(r.status, 200); tokens[key] = r.body.token; }
    const path = '/admin/matriculas';
    const [course] = await db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Curso Matrículas','curso-matriculas','Prueba','curso','presencial','20 horas','publicado',NOW(),NOW())");
    const courseId = course.insertId;
    const students = [];
    for (let i = 0; i < 12; i++) { const [row] = await db.execute("INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES (?,'Ficticia','PE','DNI',?)", ['Persona ' + i, String(12345000 + i)]); students.push(row.insertId); }
    const edition = async (nombre, capacidad = 1, estado = 'abierta') => {
      const [row] = await db.execute("INSERT INTO convocatorias (curso_id,nombre,fecha_inicio,fecha_fin,capacidad,estado) VALUES (?,?,'2026-11-01','2026-11-30',?,?)", [courseId, nombre, capacidad, estado]);
      return row.insertId;
    };
    const main = await edition('Edición principal', 2);
    const input = (student, id = main, revision = 1) => ({ estudiante_id: student, convocatoria_id: id, convocatoria_revision: revision });
    const create = (student, id = main, revision = 1, key = 'g') => request(path, tokens[key], 'POST', input(student, id, revision));
    let enrollment;
    await t.test('rutas existentes y lista paginada vacía', async () => {
      const r = await request(path, tokens.g); assert.equal(r.status, 200); assert.deepEqual(r.body.items, []); assert.equal(r.body.pagination.total, 0);
    });
    await t.test('JWT, cuenta básica y secretaría: anulación y reactivación restringidas', async () => {
      for (const [method, suffix, body] of [['GET', ''], ['GET', '/999999'], ['GET', '/999999/historial'], ['GET', '/ediciones'], ['POST', '', input(students[0])], ['PUT', '/999999/anulacion', { revision: 1, motivo: 'Prueba' }], ['PUT', '/999999/reactivacion', { revision: 1, convocatoria_revision: 1, motivo: 'Prueba' }]]) {
        assert.equal((await request(path + suffix, null, method, body)).status, 401);
        assert.equal((await request(path + suffix, tokens.b, method, body)).status, 403);
        if (method === 'PUT') assert.equal((await request(path + suffix, tokens.s, method, body)).status, 403);
      }
    });
    await t.test('estudiante/edición inexistentes, archivados, estado y capacidad heredada', async () => {
      assert.equal((await create(2147483647)).status, 404); assert.equal((await create(students[0], 2147483647)).status, 404);
      for (const state of ['planificada', 'cerrada', 'cancelada']) assert.equal((await create(students[0], await edition(state, 1, state))).status, 409);
      assert.equal((await create(students[0], await edition('Legado', null))).status, 409);
      const archived = await edition('Archivada'); await db.execute('UPDATE convocatorias SET archivado_at=NOW() WHERE id=?', [archived]); assert.equal((await create(students[0], archived)).status, 409);
      await db.execute('UPDATE estudiantes SET archivado_at=NOW() WHERE id=?', [students[11]]); assert.equal((await create(students[11])).status, 409);
      assert.equal((await create(students[0], main, 2)).status, 409);
    });
    await t.test('alta válida y doble clic concurrente conservan una matrícula y un historial', async () => {
      const results = await Promise.all([create(students[0], main, 1, 's'), create(students[0], main, 1, 'c')]);
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]); enrollment = results.find(r => r.status === 201).body.item;
      assert.equal(enrollment.estado, 'activa'); assert.equal(enrollment.cumplimiento, 'pendiente'); assert.equal(enrollment.revision, 1);
      const [[row]] = await db.execute('SELECT COUNT(*) AS n FROM matriculas WHERE estudiante_id=? AND convocatoria_id=?', [students[0], main]); assert.equal(row.n, 1);
      const history = await request(path + '/' + enrollment.id + '/historial', tokens.s); assert.equal(history.status, 200); assert.equal(history.body.pagination.total, 1);
      assert.equal(history.body.items[0].operacion, 'creacion'); assert.ok(history.body.items[0].actor_id); assert.equal(history.body.items[0].estado_nuevo, 'activa');
    });
    await t.test('dos solicitudes por el último cupo: exactamente un ganador', async () => {
      const results = await Promise.all([create(students[1]), create(students[2])]); assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
      assert.equal((await create(students[3])).status, 409);
      const [[row]] = await db.execute("SELECT COUNT(*) AS n FROM matriculas WHERE convocatoria_id=? AND estado='activa'", [main]); assert.equal(row.n, 2);
    });
    await t.test('anular libera cupo; exige motivo/revisión; reactivar no duplica y comprueba capacidad', async () => {
      const url = path + '/' + enrollment.id;
      for (const body of [{ revision: 1 }, { revision: 1, motivo: ' ' }, { revision: 0, motivo: 'Prueba' }, { revision: 1, motivo: 'a'.repeat(301) }]) assert.equal((await request(url + '/anulacion', tokens.g, 'PUT', body)).status, 400);
      let r = await request(url + '/anulacion', tokens.c, 'PUT', { revision: 1, motivo: ' Solicitud del estudiante ' }); assert.equal(r.status, 200); enrollment = r.body.item;
      assert.equal(enrollment.estado, 'anulada'); assert.equal(enrollment.revision, 2);
      assert.equal((await create(students[0])).status, 409, 'una anulada se reactiva');
      r = await request(url + '/reactivacion', tokens.c, 'PUT', { revision: 2, convocatoria_revision: 1, motivo: 'Retoma su inscripción' }); assert.equal(r.status, 200); enrollment = r.body.item;
      assert.equal(enrollment.estado, 'activa'); assert.equal(enrollment.revision, 3);
      assert.equal((await request(url + '/reactivacion', tokens.g, 'PUT', { revision: 3, convocatoria_revision: 1, motivo: 'Repetida' })).status, 409);
      r = await request(url + '/anulacion', tokens.g, 'PUT', { revision: 3, motivo: 'Retiro' }); assert.equal(r.status, 200); enrollment = r.body.item;
      assert.equal((await create(students[3])).status, 201);
      assert.equal((await request(url + '/reactivacion', tokens.g, 'PUT', { revision: 4, convocatoria_revision: 1, motivo: 'Regreso sin cupo' })).status, 409);
      const h = await request(url + '/historial', tokens.g); assert.equal(h.body.pagination.total, 4); assert.ok(h.body.items.some(i => i.motivo === 'Solicitud del estudiante'));
      assert.equal((await request(url, tokens.g, 'PUT', { revision: 4, estado: 'egresada' })).status, 404);
    });
    await t.test('dos acciones simultáneas sobre una matrícula: una revisión gana', async () => {
      const id = await edition('Acciones'); const created = await create(students[4], id); assert.equal(created.status, 201);
      const url = path + '/' + created.body.item.id + '/anulacion';
      const races = await Promise.all(['A', 'B'].map(motivo => request(url, tokens.g, 'PUT', { revision: 1, motivo }))); assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
      const [[row]] = await db.execute("SELECT COUNT(*) AS n FROM academico_historial WHERE entidad='matricula' AND entidad_id=?", [created.body.item.id]); assert.equal(row.n, 2);
    });
    await t.test('reactivación bloqueada por edición, estudiante o revisión; no toca el historial', async () => {
      const id = await edition('Reactivación restringida', 2); const created = await create(students[10], id); assert.equal(created.status, 201);
      const url = path + '/' + created.body.item.id;
      assert.equal((await request(url + '/anulacion', tokens.g, 'PUT', { revision: 1, motivo: 'Retiro' })).status, 200);
      const reactivate = convocatoria_revision => request(url + '/reactivacion', tokens.c, 'PUT', { revision: 2, convocatoria_revision, motivo: 'Regreso' });
      assert.equal((await reactivate(2)).status, 409);
      for (const state of ['cerrada', 'cancelada', 'planificada']) { await db.execute('UPDATE convocatorias SET estado=? WHERE id=?', [state, id]); assert.equal((await reactivate(1)).status, 409); }
      await db.execute("UPDATE convocatorias SET estado='abierta',archivado_at=NOW() WHERE id=?", [id]); assert.equal((await reactivate(1)).status, 409);
      await db.execute('UPDATE convocatorias SET archivado_at=NULL,capacidad=NULL WHERE id=?', [id]); assert.equal((await reactivate(1)).status, 409);
      await db.execute('UPDATE convocatorias SET capacidad=2 WHERE id=?', [id]); await db.execute('UPDATE estudiantes SET archivado_at=NOW() WHERE id=?', [students[10]]); assert.equal((await reactivate(1)).status, 409);
      assert.equal((await request(url + '/historial', tokens.g)).body.pagination.total, 2);
      await db.execute('UPDATE estudiantes SET archivado_at=NULL WHERE id=?', [students[10]]);
      assert.equal((await reactivate(1)).status, 200);
    });
    await t.test('capacidad y matrícula concurrentes respetan el mismo bloqueo', async () => {
      const id = await edition('Capacidad concurrente', 2); assert.equal((await create(students[5], id)).status, 201);
      const races = await Promise.all([create(students[6], id), request('/admin/convocatorias/' + id, tokens.c, 'PUT', { revision: 1, capacidad: 1 })]);
      assert.deepEqual(races.map(r => r.status).sort(), [races[0].status === 201 ? 201 : 200, 409].sort());
      const [[row]] = await db.execute("SELECT c.capacidad,(SELECT COUNT(*) FROM matriculas m WHERE m.convocatoria_id=c.id AND m.estado='activa') AS ocupados FROM convocatorias c WHERE id=?", [id]); assert.ok(row.ocupados <= row.capacidad);
    });
    await t.test('cierre de edición concurrente con matrícula conserva orden y rechaza la revisión antigua', async () => {
      const id = await edition('Cierre concurrente', 2);
      const races = await Promise.all([create(students[6], id), request('/admin/convocatorias/' + id + '/cierre', tokens.c, 'PUT', { revision: 1, estado: 'cerrada' })]);
      assert.equal(races[1].status, 200); assert.ok([201, 409].includes(races[0].status));
      assert.equal((await create(students[5], id)).status, 409);
      const [[row]] = await db.execute('SELECT revision,estado FROM convocatorias WHERE id=?', [id]); assert.equal(row.revision, 2); assert.equal(row.estado, 'cerrada');
    });
    await t.test('fallo del historial revierte alta y anulación sin registros parciales', async () => {
      const id = await edition('Rollback', 2); const ok = await create(students[7], id); assert.equal(ok.status, 201);
      const cancelled = await create(students[8], id); assert.equal(cancelled.status, 201);
      assert.equal((await request(path + '/' + cancelled.body.item.id + '/anulacion', tokens.g, 'PUT', { revision: 1, motivo: 'Retiro previo' })).status, 200);
      await db.query("CREATE TRIGGER matriculas_fallo BEFORE INSERT ON academico_historial FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio'");
      try {
        assert.equal((await create(students[9], id)).status, 500);
        assert.equal((await request(path + '/' + ok.body.item.id + '/anulacion', tokens.g, 'PUT', { revision: 1, motivo: 'Rollback' })).status, 500);
        assert.equal((await request(path + '/' + cancelled.body.item.id + '/reactivacion', tokens.g, 'PUT', { revision: 2, convocatoria_revision: 1, motivo: 'Rollback regreso' })).status, 500);
        const [rows] = await db.execute('SELECT estado,revision FROM matriculas WHERE convocatoria_id=? ORDER BY id', [id]); assert.deepEqual(rows.map(r => ({ ...r })), [{ estado: 'activa', revision: 1 }, { estado: 'anulada', revision: 2 }]);
      } finally { await db.query('DROP TRIGGER matriculas_fallo'); }
    });
    await t.test('reactivación y alta simultáneas por el último cupo no sobreocupan', async () => {
      const id = await edition('Reactivación concurrente', 1); const previous = await create(students[1], id); assert.equal(previous.status, 201);
      assert.equal((await request(path + '/' + previous.body.item.id + '/anulacion', tokens.g, 'PUT', { revision: 1, motivo: 'Retiro' })).status, 200);
      const races = await Promise.all([create(students[2], id), request(path + '/' + previous.body.item.id + '/reactivacion', tokens.g, 'PUT', { revision: 2, convocatoria_revision: 1, motivo: 'Regreso concurrente' })]);
      assert.ok((races[0].status === 201 && races[1].status === 409) || (races[0].status === 409 && races[1].status === 200));
      const [[row]] = await db.execute("SELECT COUNT(*) AS n FROM matriculas WHERE convocatoria_id=? AND estado='activa'", [id]); assert.equal(row.n, 1);
    });
    await t.test('paginación, filtros combinados, búsqueda y cupos calculados', async () => {
      const r = await request(path + '?limit=1&curso_id=' + courseId + '&convocatoria_id=' + main + '&estado=anulada&estudiante_id=' + students[0] + '&search=Persona', tokens.s);
      assert.equal(r.status, 200); assert.equal(r.body.pagination.total, 1); assert.equal(r.body.items[0].id, enrollment.id); assert.equal(r.body.items[0].estudiante.apellidos, 'Ficticia');
      const options = await request(path + '/ediciones?search=principal', tokens.s); assert.equal(options.status, 200); assert.equal(options.body.items[0].ocupados, 2); assert.equal(options.body.items[0].disponibles, 0);
      assert.equal((await request(path + '/' + enrollment.id + '/historial?limit=2&page=2', tokens.s)).body.items.length, 2);
      for (const q of ['page=0', 'limit=101', 'estado=otro', 'estudiante_id=abc', 'curso_id=0', 'search=' + 'a'.repeat(101), 'unknown=1']) assert.equal((await request(path + '?' + q, tokens.g)).status, 400);
      for (const patch of [{ convocatoria_revision: null }, { estudiante_id: '1' }, { estado: 'activa' }, { motivo: 'Extra' }]) assert.equal((await request(path, tokens.g, 'POST', { ...input(students[0]), ...patch })).status, 400);
    });
    await t.test('relaciones restrictivas y regresión de estudiantes, ediciones, contenido y chatbot', async () => {
      await assert.rejects(db.execute('DELETE FROM estudiantes WHERE id=?', [students[0]]), e => e.errno === 1451);
      await assert.rejects(db.execute('DELETE FROM convocatorias WHERE id=?', [main]), e => e.errno === 1451);
      assert.equal((await request('/admin/estudiantes?search=12345000', tokens.s)).body.pagination.total, 1);
      assert.equal((await request('/admin/convocatorias/' + main, tokens.s)).status, 200);
      for (const endpoint of ['/cursos', '/servicios', '/galeria', '/convenios', '/settings']) assert.equal((await request(endpoint)).status, 200);
      assert.equal((await request('/chatbot/message', null, 'POST', { message: 'Cursos disponibles' })).status, 200);
      assert.equal((await request(path + '/' + enrollment.id, tokens.g, 'DELETE')).status, 404);
    });
    await t.test('resumen operativo: recuentos reales, contrato anterior y autorización intacta', async () => {
      const endpoint = '/admin/stats?vista=operativa';
      const r = await request(endpoint, tokens.g);
      assert.equal(r.status, 200);
      const [[counts]] = await db.query("SELECT (SELECT COUNT(*) FROM estudiantes) AS estudiantes, (SELECT COUNT(*) FROM convocatorias WHERE estado='abierta' AND archivado_at IS NULL) AS edicionesActivas, (SELECT COUNT(*) FROM matriculas) AS matriculasRegistradas, (SELECT COUNT(*) FROM matriculas WHERE estado='activa') AS matriculasVigentes");
      assert.deepEqual(r.body.stats.academico, { ...counts });
      assert.equal(r.body.stats.mensajes.pendientes, r.body.stats.mensajes.nuevos + r.body.stats.mensajes.enProceso);
      assert.equal('catalogo' in r.body.stats, false);
      assert.equal((await request(endpoint, tokens.c)).status, 200);
      for (const token of [tokens.s, tokens.b]) assert.equal((await request(endpoint, token)).status, 403);
      assert.equal((await request(endpoint)).status, 401);
      assert.equal((await request('/admin/stats?vista=desconocida', tokens.g)).status, 400);
      assert.ok((await request('/admin/stats', tokens.g)).body.stats.catalogo, 'contrato anterior conservado');
    });
    if (process.env.MATRICULAS_BROWSER === 'true') await t.test('React ↔ NestJS ↔ MySQL escritorio y móvil', async () => {
      const browser = fork(join(backend, '../frontend/scripts/smoke-matriculas.cjs'), [], { cwd: join(backend, '../frontend'), windowsHide: true, silent: true, execArgv: [],
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HORUS_MATRICULAS_BROWSER_CHILD: 'true', MATRICULAS_SCREENSHOTS_DIR: process.env.MATRICULAS_SCREENSHOTS_DIR } });
      let output = ''; browser.once('message', () => browser.send({ type: 'isolated-api', base, password, database: name }));
      browser.stdout.on('data', c => { output += c; }); browser.stderr.on('data', c => { output += c; });
      const code = await new Promise((resolve, reject) => { const timer = setTimeout(() => { browser.kill(); reject(new Error('Timeout navegador')); }, 90000); browser.once('exit', c => { clearTimeout(timer); resolve(c); }); browser.once('error', reject); });
      assert.equal(code, 0, output); t.diagnostic(output);
    });
  } finally {
    if (api?.connected) { const exited = new Promise(resolve => api.once('exit', resolve)); api.disconnect(); await exited; }
    await db.end();
    // Solo la carpeta de trabajo que creó esta prueba (vacía; la API no escribe en ella).
    if (apiDir) try { rmSync(apiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { t.diagnostic('No se pudo retirar la carpeta temporal propia: ' + apiDir); }
  }
});
