const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork, spawnSync } = require('node:child_process');
const { readFileSync, readdirSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const backend = join(__dirname, '..');
// No importar migrate.cjs: carga database.cjs y este lee .env. Mismo parser SQL, solo fixtures.
const versions = JSON.parse(readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const applySql = async (db, version) => { for (const sql of readFileSync(join(backend, 'migrations', version + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean)) await db.query(sql); };

test('Importación CSV: HTTP real, MySQL desechable, atomicidad, permisos y concurrencia', { timeout: 240000 }, async t => {
  if (process.env.IMPORTACIONES_TEST_DB !== 'true') return t.skip('Requiere MySQL 8.4 desechable y UUID.');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS });
  const name = 'horus_importaciones_it_' + randomBytes(12).toString('hex');
  const password = 'Ficticia-' + randomBytes(12).toString('hex');
  let api, apiDir;
  try {
    const [[server]] = await db.query('SELECT @@server_uuid AS uuid, VERSION() AS version');
    assert.equal(server.uuid, process.env.IMPORTACIONES_TEST_SERVER_UUID); assert.match(server.version, /^8\.4\./);
    const [schemas] = await db.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('horus_db','horus_local','horus_group')"); assert.equal(schemas.length, 0);
    await db.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await db.changeUser({ database: name });
    for (const version of ['00000000-initial', ...versions]) {
      if (version === '20261019-importaciones-academicas') break;
      await applySql(db, version);
    }
    await t.test('migración de importaciones conserva datos académicos previos con capacidad aplicada y admite repetición', async () => {
      const [course] = await db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Curso previo ficticio','previo-importacion','Prueba','curso','presencial','20 horas','publicado',NOW(),NOW())");
      const [student] = await db.query("INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES ('Persona previa','Ficticia','PE','DNI','99000000')");
      const [edition] = await db.execute("INSERT INTO convocatorias (curso_id,nombre,capacidad) VALUES (?,'Edición previa',NULL)", [course.insertId]);
      await db.execute('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (?,?)', [student.insertId, edition.insertId]);
      const tables = ['cursos', 'estudiantes', 'convocatorias', 'matriculas', 'academico_historial', 'admin_users'];
      const snapshot = async () => Promise.all(tables.map(async table => (await db.query('SELECT * FROM `' + table + '` ORDER BY id'))[0]));
      const before = await snapshot();
      await applySql(db, '20261019-importaciones-academicas');
      await applySql(db, '20261019-importaciones-academicas');
      assert.deepEqual(await snapshot(), before);
      const [[operations]] = await db.query('SELECT COUNT(*) AS n FROM importaciones_academicas'); assert.equal(operations.n, 0);
    });
    // db:check y la API esperan el esquema completo: se aplican también las migraciones registradas después de la de importaciones (p. ej. docentes).
    for (const version of versions.slice(versions.indexOf('20261019-importaciones-academicas') + 1)) await applySql(db, version);
    apiDir = mkdtempSync(join(tmpdir(), 'horus-importaciones-api-'));
    const schema = spawnSync(process.execPath, ['-r', join(__dirname, 'isolate-env.cjs'), join(backend, 'scripts/check-database.cjs')], { cwd: apiDir, windowsHide: true, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER, DB_PASS: process.env.DB_PASS, DB_NAME: name, DB_RSA_PUBLIC_KEY: process.env.DB_RSA_PUBLIC_KEY } });
    assert.equal(schema.status, 0, schema.stdout);
    const hash = await bcrypt.hash(password, 10);
    for (const [key, role] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]]) await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta ficticia', key + '@importacion.test', hash, role]);
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    api = fork(join(__dirname, 'fixtures/access-guard-app.cjs'), [], { cwd: apiDir, windowsHide: true, silent: true, execArgv: ['-r', join(__dirname, 'isolate-env.cjs')], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development', DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER, DB_PASS: process.env.DB_PASS, DB_NAME: name, JWT_SECRET: randomBytes(32).toString('hex'), PORT: String(port), MAIL_PROVIDER: 'gmail', HORUS_ACCESS_GUARD_FIXTURE: 'e36' } });
    const ready = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('API no inició')), 30000); api.once('message', m => { clearTimeout(timer); resolve(m); }); api.once('exit', () => { clearTimeout(timer); reject(new Error('API terminó')); }); });
    const base = 'http://127.0.0.1:' + ready.port + '/api';
    const request = async (path, token, method = 'POST', body) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
    const tokens = {};
    for (const key of ['g', 'c', 's', 'b']) { const r = await request('/admin/login', null, 'POST', { email: key + '@importacion.test', password }); assert.equal(r.status, 200); tokens[key] = r.body.token; }
    const [course] = await db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Curso ficticio','importacion-ficticia','Prueba','curso','presencial','20 horas','publicado',NOW(),NOW())");
    const edition = async (capacity = 50, state = 'abierta') => { const [r] = await db.execute("INSERT INTO convocatorias (curso_id,nombre,fecha_inicio,fecha_fin,capacidad,estado) VALUES (?,'Edición ficticia','2026-11-01','2026-11-30',?,?)", [course.insertId, capacity, state]); return r.insertId; };
    const main = await edition();
    const path = '/admin/importaciones';
    const input = (rows = ['00123456;Ana;Ficticia'], id = main) => ({ nombre: 'ficticio.csv', mime: 'text/csv', contenido: Buffer.from('DNI;Nombres;Apellidos\n' + rows.join('\n')).toString('base64'), convocatoria_id: id, encabezado: 1, codificacion: 'auto' });
    const preview = (dto, role = 'g') => request(path + '/vista-previa', tokens[role], 'POST', dto);
    const confirm = (dto, p, extra = {}) => request(path + '/confirmacion', tokens.g, 'POST', { ...dto, comprobante: p.body.comprobante, confirmar: true, ...extra });
    const counts = async () => { const out = []; for (const table of ['estudiantes', 'matriculas', 'academico_historial', 'importaciones_academicas']) { const [[r]] = await db.query('SELECT COUNT(*) AS n FROM ' + table); out.push(r.n); } return out; };
    await t.test('JWT y matriz completa: gerente aplica, coordinación previsualiza, secretaría/básica denegadas', async () => {
      for (const [suffix, method] of [['/archivo','POST'], ['/vista-previa','POST'], ['/confirmacion','POST'], ['/ediciones','GET'], ['/resultado/11111111-1111-4111-8111-111111111111','GET']]) {
        assert.equal((await request(path + suffix, null, method, method === 'POST' ? input() : undefined)).status, 401);
        for (const role of ['s', 'b']) assert.equal((await request(path + suffix, tokens[role], method, method === 'POST' ? input() : undefined)).status, 403);
      }
      assert.equal((await preview(input(), 'c')).status, 201);
      assert.equal((await request(path + '/confirmacion', tokens.c, 'POST', input())).status, 403);
    });
    await t.test('vista previa no escribe; DNI válido con cero inicial y archivo revalidado', async () => {
      const before = await counts(), p = await preview(input()); assert.equal(p.status, 201); assert.deepEqual(await counts(), before);
      assert.equal(p.body.filas[0].datos.doc_numero, '00123456'); assert.equal(p.body.resumen.importados, 1);
      assert.equal((await confirm(input(), p, { confirmar: false })).status, 400);
      assert.equal((await confirm(input(), p, { nombre: 'cambiado.csv' })).status, 409);
      assert.equal((await confirm(input(), p, { comprobante: p.body.comprobante + 'x' })).status, 409);
      const otherActor = await request(path + '/confirmacion', tokens.c, 'POST', { ...input(), comprobante: p.body.comprobante, confirmar: true }); assert.equal(otherActor.status, 403);
      assert.deepEqual(await counts(), before);
      assert.deepEqual(readdirSync(apiDir), [], 'el procesamiento no crea archivos temporales');
    });
    await t.test('vista previa funciona con un usuario MySQL que solo tiene SELECT', async () => {
      const user = 'import_ro_' + randomBytes(6).toString('hex'), secret = randomBytes(20).toString('hex'); let prisma;
      try {
        await db.query('CREATE USER ?@\'%\' IDENTIFIED BY ?', [user, secret]); await db.query('GRANT SELECT ON `' + name + '`.* TO ?@\'%\'', [user]);
        // Comprueba autenticación y privilegios del usuario de lectura con el driver del montaje.
        const readConnection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user, password: secret, database: name });
        try { await readConnection.query('SELECT 1'); await assert.rejects(readConnection.query("INSERT INTO estudiantes (nombres,apellidos) VALUES ('No debe','Escribirse')"), e => e.code === 'ER_TABLEACCESS_DENIED_ERROR'); }
        finally { await readConnection.end(); }
        const { PrismaService } = require('../dist/database/prisma.service');
        const { EstudiantesService } = require('../dist/estudiantes/estudiantes.service');
        const { MatriculasService } = require('../dist/matriculas/matriculas.service');
        const { ImportacionesService } = require('../dist/importaciones/importaciones.service');
        // ConfigService da prioridad a process.env: usar configuración explícita para que las
        // credenciales root del montaje nunca sustituyan al usuario SELECT de esta prueba.
        const settings = { DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: user, DB_PASS: secret, DB_NAME: name, DB_RSA_PUBLIC_KEY: process.env.DB_RSA_PUBLIC_KEY, JWT_SECRET: randomBytes(32).toString('hex') };
        const config = { get: (key, fallback) => settings[key] ?? fallback, getOrThrow: key => { if (settings[key] === undefined) throw new Error('Falta configuración ficticia.'); return settings[key]; } };
        prisma = new PrismaService(config); await prisma.$connect();
        try { await prisma.$queryRaw`SELECT 1`; }
        catch (e) {
          const cause = e.meta?.driverAdapterError?.cause;
          t.diagnostic(JSON.stringify({ etapa: 'conexion-select', clase: e.constructor.name, codigo: e.code, original: cause?.originalCode, causa: cause?.kind, rsa: /RSA/i.test(String(e)), autenticacion: /denied|authentication/i.test(String(e)), timeout: /timeout|timed out/i.test(String(e)) }));
          throw new Error('No se pudo abrir la conexión SELECT del usuario de prueba.');
        }
        const service = new ImportacionesService(prisma, new EstudiantesService(prisma), new MatriculasService(prisma), config);
        const r = await service.preview(input(), 1); assert.equal(r.resumen.importados, 1);
      } finally { if (prisma) await prisma.$disconnect(); await db.query('DROP USER IF EXISTS ?@\'%\'', [user]); }
    });
    await t.test('confirmación atómica, doble confirmación y reimportación bloqueadas; historial y recuperación', async () => {
      const dto = input(), p = await preview(dto), r = await confirm(dto, p); assert.equal(r.status, 201); assert.equal(r.body.resumen.importados, 1);
      const [[s]] = await db.query("SELECT doc_numero FROM estudiantes WHERE doc_numero='00123456'"); assert.equal(s.doc_numero, '00123456');
      const [[h]] = await db.query("SELECT actor_id,motivo FROM academico_historial WHERE entidad='matricula' ORDER BY id DESC LIMIT 1"); assert.ok(h.actor_id); assert.equal(h.motivo, 'Importación académica ' + r.body.operacion);
      assert.equal((await confirm(dto, p)).status, 409); assert.equal((await preview(dto)).status, 409);
      const result = await request(path + '/resultado/' + r.body.operacion, tokens.g, 'GET'); assert.equal(result.status, 200); assert.equal(result.body.item.importados, 1); assert.equal(result.body.item.archivo_sha256, undefined);
    });
    await t.test('errores por fila: DNI inválido, duplicados, fórmulas, docentes y nombres obligatorios', async () => {
      const dto = input(['1234567;Ana;Ficticia','00888888;Ana;Ficticia','00888888;Ana;Ficticia','00222222;=CMD();Ficticia','00333333;Docente;Ficticia','00444444;;Ficticia','00555555;Estudiante;Ficticia']);
      const p = await preview(dto); assert.equal(p.status, 201); assert.equal(p.body.resumen.rechazados, 6); assert.equal(p.body.resumen.importados, 1);
      const r = await confirm(dto, p); assert.equal(r.status, 201); assert.equal(r.body.resumen.rechazados, 6);
    });
    await t.test('mapeo manual, tipo de persona y faltantes', async () => {
      const dto = { ...input(), contenido: Buffer.from('Identidad;Primero;Familia;Rol\n00666666;Ana;Ficticia;estudiante\n00777777;Ana;Ficticia;ponente').toString('base64') };
      assert.equal((await preview(dto)).status, 400);
      assert.equal((await preview({ ...dto, mapeo: null })).status, 400);
      assert.equal((await preview({ ...dto, mapeo: { doc_numero: 0, nombres: 1, apellidos: 2, email: null } })).status, 400);
      const p = await preview({ ...dto, mapeo: { doc_numero: 0, nombres: 1, apellidos: 2, tipo_persona: 3 } }); assert.equal(p.status, 201); assert.equal(p.body.resumen.rechazados, 1); assert.equal(p.body.resumen.importados, 1);
    });
    await t.test('existentes se conservan, matrícula activa/anulada omitida y archivados rechazados', async () => {
      const id = await edition(); const dto = input(['00123456;Otro nombre;Otro apellido'], id); const p = await preview(dto); assert.equal(p.body.resumen.estudiantes_nuevos, 0); assert.ok(p.body.filas[0].avisos.length >= 2); assert.equal((await confirm(dto, p)).status, 201);
      const [[s]] = await db.query("SELECT nombres,id FROM estudiantes WHERE doc_numero='00123456'"); assert.equal(s.nombres, 'Ana');
      for (const state of ['activa', 'anulada']) { await db.execute('UPDATE matriculas SET estado=? WHERE estudiante_id=? AND convocatoria_id=?', [state, s.id, id]); const q = await preview(input(['00123456;Ana;Ficticia','00999999;Ana;Ficticia'], id)); assert.equal(q.body.resumen.omitidos, 1); }
      await db.execute('UPDATE estudiantes SET archivado_at=NOW() WHERE id=?', [s.id]); assert.equal((await preview(input(['00123456;Ana;Ficticia'], await edition()))).body.resumen.rechazados, 1); await db.execute('UPDATE estudiantes SET archivado_at=NULL WHERE id=?', [s.id]);
    });
    await t.test('edición inexistente/cerrada/capacidad NULL/cupo insuficiente y curso inexistente', async () => {
      assert.equal((await preview(input(undefined, 2147483647))).status, 400);
      for (const id of [await edition(1, 'cerrada'), await edition(null), await edition(1)]) { const dto = input(['10111111;Ana;Ficticia','10222222;Ana;Ficticia'], id), p = await preview(dto); assert.equal(p.status, 201); assert.ok(p.body.bloqueos.length); assert.equal((await confirm(dto, p)).status, 409); }
      await assert.rejects(db.execute("INSERT INTO convocatorias (curso_id,nombre) VALUES (2147483647,'Sin curso')"), e => e.code === 'ER_NO_REFERENCED_ROW_2');
    });
    await t.test('cambio entre vista previa y confirmación se rechaza sin escrituras', async () => {
      const id = await edition(), dto = input(['10333333;Ana;Ficticia'], id), p = await preview(dto), before = await counts();
      await db.execute('UPDATE convocatorias SET revision=revision+1 WHERE id=?', [id]); assert.equal((await confirm(dto, p)).status, 409); assert.deepEqual(await counts(), before);
    });
    await t.test('dos confirmaciones concurrentes y último cupo: exactamente una transacción gana', async () => {
      const id = await edition(1), a = input(['10444444;Ana;Ficticia'], id), b = input(['10555555;Ana;Ficticia'], id), pa = await preview(a), pb = await preview(b);
      assert.deepEqual((await Promise.all([confirm(a, pa), confirm(b, pb)])).map(r => r.status).sort(), [201, 409]);
      const id2 = await edition(), dto = input(['10666666;Ana;Ficticia'], id2), p = await preview(dto); assert.deepEqual((await Promise.all([confirm(dto, p), confirm(dto, p)])).map(r => r.status).sort(), [201, 409]);
    });
    await t.test('rollback de estudiantes, matrículas, historial y operación ante fallo de historial', async () => {
      const id = await edition(), dto = input(['10777777;Ana;Ficticia','10888888;Ana;Ficticia'], id), p = await preview(dto), before = await counts();
      await db.query("CREATE TRIGGER importacion_fallo BEFORE INSERT ON academico_historial FOR EACH ROW BEGIN IF (SELECT COUNT(*) FROM academico_historial WHERE motivo=NEW.motivo) > 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio en segunda fila'; END IF; END");
      try { const r = await confirm(dto, p); assert.ok(r.status >= 500); assert.deepEqual(await counts(), before); }
      finally { await db.query('DROP TRIGGER importacion_fallo'); }
      assert.equal((await confirm(dto, p)).status, 201);
    });
    await t.test('límite de 200 filas admitido; conserva atomicidad en un lote completo', async () => {
      const id = await edition(200), dto = input(Array.from({ length: 200 }, (_, i) => String(20000000 + i) + ';Persona;Ficticia'), id), p = await preview(dto);
      assert.equal(p.status, 201); assert.equal(p.body.resumen.importados, 200);
      const r = await confirm(dto, p); assert.equal(r.status, 201); assert.equal(r.body.resumen.importados, 200);
      const [[count]] = await db.execute('SELECT COUNT(*) AS n FROM matriculas WHERE convocatoria_id=?', [id]); assert.equal(count.n, 200);
    });
    await t.test('HTTP rechaza binarios, XLSX, macros, corruptos y archivos vacíos', async () => {
      for (const dto of [{ nombre: 'falso.xlsx' }, { nombre: 'macro.xlsm' }, { contenido: '' }, { contenido: Buffer.from('PK\x03\x04').toString('base64') }, { contenido: Buffer.from('DNI;Nombres;Apellidos\n"corrupto').toString('base64') }]) assert.equal((await preview({ ...input(), ...dto })).status, 400);
    });
    if (process.env.IMPORTACIONES_BROWSER === 'true') await t.test('React → NestJS → MySQL: navegador con fixture ficticio', async () => {
      const browser = fork(join(backend, '../frontend/scripts/smoke-importaciones.cjs'), [], { cwd: join(backend, '../frontend'), windowsHide: true, silent: true, execArgv: [], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HORUS_IMPORTACIONES_BROWSER_CHILD: 'true' } });
      let output = ''; browser.once('message', () => browser.send({ type: 'isolated-api', base, password, database: name, edition: main })); browser.stdout.on('data', c => { output += c; }); browser.stderr.on('data', c => { output += c; });
      const code = await new Promise((resolve, reject) => { const timer = setTimeout(() => { browser.kill(); reject(new Error('Timeout navegador')); }, 90000); browser.once('exit', c => { clearTimeout(timer); resolve(c); }); browser.once('error', reject); }); assert.equal(code, 0, output); t.diagnostic(output);
    });
  } finally {
    if (api?.connected) { const exited = new Promise(resolve => api.once('exit', resolve)); api.disconnect(); await exited; }
    if (/^horus_importaciones_it_[a-f0-9]{24}$/.test(name)) await db.query('DROP DATABASE IF EXISTS `' + name + '`');
    await db.end();
    if (apiDir) rmSync(apiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
