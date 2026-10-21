// Docentes y ponentes (20261020-docentes) contra un MySQL 8.4 REAL y DESECHABLE: migración desde una base previa con datos,
// recuperación ante fallos parciales, restricciones de la base, HTTP real con AccessGuard, concurrencia, historial y compatibilidad
// con Ediciones, Estudiantes, Matrículas y Reportes. No forma parte de `npm test`. Requiere `npm run build` (arranca backend/dist).
//
//   npm run build && node test/run-academic-isolated.cjs docentes
//
// Barreras (las mismas que Ediciones y Matrículas; todas antes de crear nada): DOCENTES_TEST_DB=true explícito, DB_HOST de bucle local,
// @@server_uuid igual al del contenedor propio (obtenido por docker exec), servidor recién creado (Uptime < 1 h) y sin bases ajenas.
// Solo crea bases horus_docentes_it_<hex>. Datos ficticios; jamás toca horus_db ni horus_local.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork, spawn } = require('node:child_process');
const { readFileSync, mkdtempSync, realpathSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const http = require('node:http');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { validatedPreinscripciones, withoutPreinscripciones } = require('./fixtures/preinscripciones-fixture.cjs');

const backend = join(__dirname, '..');
const versions = JSON.parse(readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const MIGRATION = '20261020-docentes';
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NEW_TABLES = ['docentes', 'docente_asignaciones'];
// Migraciones registradas DESPUÉS de la de docentes (db:migrate las aplica también): sus tablas y la ampliación posterior de los ENUM del
// historial (20261020-sesiones-academicas) no son parte de lo que esta prueba verifica de la migración de docentes.
const LATER_TABLES = ['sesiones'];
const laterHistoryDdl = ddl => ddl.replace("'asignacion_docente')", "'asignacion_docente','sesion')").replace("'sustitucion')", "'sustitucion','reprogramacion')");
const statementsOf = name => readFileSync(join(backend, 'migrations', name + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean); // criterio de migrate.cjs

test('Docentes: migración, restricciones, HTTP, permisos, concurrencia, historial y compatibilidad en MySQL desechable', { timeout: 900000 }, async t => {
  if (process.env.DOCENTES_TEST_DB !== 'true') return t.skip('Requiere DOCENTES_TEST_DB=true y un servidor desechable identificado por UUID.');
  assert.ok(versions.includes(MIGRATION), 'la migración de docentes está registrada en migrate.cjs');
  const campos = value => typeof value === 'string' ? JSON.parse(value) : value; // mysql2 devuelve JSON ya interpretado
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  const expectedUuid = String(process.env.DOCENTES_TEST_SERVER_UUID ?? '').trim().toLowerCase();
  assert.match(expectedUuid, /^[0-9a-f-]{36}$/);
  const credentials = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS, timezone: 'Z', dateStrings: true };
  const admin = await mysql.createConnection(credentials);
  const q = async (sql, params) => (await admin.query(sql, params))[0];
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-docentes-'));
  const apiCwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-docentes-api-'));
  const clients = [];
  let api;
  const leaks = []; // cuerpos de error HTTP: ninguno puede mostrar SQL, Prisma ni trazas
  try {
    const [{ uuid, uptime, version }] = await q("SELECT @@server_uuid AS uuid, VERSION() AS version, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime') AS uptime");
    assert.equal(String(uuid).toLowerCase(), expectedUuid, 'el servidor conectado no es el servidor desechable identificado');
    assert.match(version, /^8\.4\./); assert.ok(Number(uptime) < 3600, 'servidor recién creado');
    assert.deepEqual(await q('SELECT TABLE_SCHEMA AS s FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN (?) GROUP BY TABLE_SCHEMA', [SYSTEM]), [], 'solo se permite un servidor vacío');

    const env = name => ({ PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), DB_HOST: credentials.host, DB_PORT: String(credentials.port), DB_NAME: name, DB_USER: credentials.user, DB_PASS: credentials.password, DB_SSL: 'false' });
    const runScript = (file, name) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-r', join(__dirname, 'isolate-env.cjs'), join(backend, 'scripts', file)], { cwd, env: env(name), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = '';
      child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    const connect = async name => { const c = await mysql.createConnection({ ...credentials, database: name }); clients.push(c); return c; };
    const createDb = async () => { const name = 'horus_docentes_it_' + randomBytes(12).toString('hex'); assert.match(name, /^horus_docentes_it_[0-9a-f]{24}$/); await q('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); return name; };
    const runSql = async (db, version) => { for (const sql of statementsOf(version)) await db.query(sql); };
    // Base anterior a la migración: esquema inicial + todas las migraciones previas, registradas como lo haría migrate.cjs.
    async function databaseBefore() {
      const name = await createDb(); const db = await connect(name);
      await runSql(db, '00000000-initial');
      await db.query('CREATE TABLE IF NOT EXISTS horus_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)');
      for (const previous of versions.slice(0, versions.indexOf(MIGRATION))) { await runSql(db, previous); await db.execute('INSERT INTO horus_migrations (name, applied_at) VALUES (?, ?)', [previous, new Date()]); }
      return { name, db };
    }
    async function snapshot(db, exclude) {
      const [tables] = await db.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY 1");
      const result = {};
      for (const { t: table } of tables) {
        if (exclude.includes(table)) continue;
        const [[create]] = await db.query('SHOW CREATE TABLE `' + table + '`');
        const [rows] = await db.query('SELECT * FROM `' + table + '` ORDER BY 1');
        result[table] = { ddl: create['Create Table'].replace(/ AUTO_INCREMENT=\d+/, ''), rows: JSON.stringify(rows) };
      }
      return withoutPreinscripciones(result); // db:migrate completo también aplica 20261020-preinscripciones: no es parte de lo que verifica esta suite
    }
    // Rechazo esperado y su causa exacta (errno de mysql2): solo códigos y nombres, nunca valores.
    const rejects = async (promise, errno, name) => {
      let error = null; try { await promise; } catch (e) { error = e; }
      assert.ok(error, 'se esperaba un rechazo');
      assert.equal(error.errno, errno, 'errno ' + error.errno + ' ' + String(error.sqlMessage).slice(0, 120));
      if (name) assert.ok(String(error.sqlMessage).includes(name), 'se esperaba «' + name + '» y llegó ' + String(error.sqlMessage).slice(0, 120));
    };

    // ---------------------------------------------------------------------------------------------------------------------
    const { name, db } = await databaseBefore();
    const hash = await bcrypt.hash('Ficticia-docentes-1', 10);
    for (const [key, rol] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]])
      await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta ficticia', key + '@docentes.test', hash, rol]);
    await db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Excel Básico','excel-docentes-it','Curso ficticio','curso','presencial','20 horas','publicado',NOW(),NOW()),('Seguridad Eléctrica','seguridad-docentes-it','Capacitación ficticia','capacitacion',NULL,NULL,'publicado',NOW(),NOW())");
    await db.query("INSERT INTO convocatorias (curso_id,nombre,fecha_inicio,fecha_fin,estado,capacidad) VALUES (1,'Edición anterior 1','2026-03-01','2026-03-30','cerrada',10),(2,'Edición anterior 2',NULL,NULL,'planificada',NULL)");
    await db.query("INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero,email) VALUES ('Persona','Ficticia','PE','DNI','00123456','persona@docentes.test')");
    await db.query('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (1,1)');
    await db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,actor_rol,campos,revision) VALUES ('convocatoria',1,'creacion','panel',1,'GERENTE_GENERAL',JSON_ARRAY('nombre'),1),('matricula',1,'creacion','panel',1,'GERENTE_GENERAL',JSON_ARRAY(),1)");

    await t.test('migración desde una base previa con datos: db:check la exige, se aplica una sola vez y no pierde ni altera nada', async () => {
      const pending = await runScript('check-database.cjs', name);
      assert.equal(pending.code, 1); assert.ok(pending.output.includes('docentes.id: falta') && pending.output.includes('docente_asignaciones.id: falta'), 'db:check señala las tablas que faltan');
      const before = await snapshot(db, ['horus_migrations']);
      for (const table of ['admin_users', 'cursos', 'convocatorias', 'estudiantes', 'matriculas', 'academico_historial']) assert.ok(before[table], table);
      const applied = await runScript('migrate.cjs', name);
      assert.equal(applied.code, 0, applied.output);
      const schema = await runScript('check-database.cjs', name);
      assert.equal(schema.code, 0, schema.output); assert.match(schema.output, /Esquema compatible/);
      const after = await snapshot(db, ['horus_migrations', ...NEW_TABLES, ...LATER_TABLES]);
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no se crean ni eliminan otras tablas');
      for (const table of Object.keys(before)) {
        const expectedDdl = table === 'academico_historial' ? laterHistoryDdl(before[table].ddl.replace("'certificado')", "'certificado','docente','asignacion_docente')")) : before[table].ddl;
        assert.equal(after[table].ddl, expectedDdl, table + ': definición sin cambios (salvo el ENUM ampliado del historial)');
        assert.equal(after[table].rows, before[table].rows, table + ': filas idénticas');
      }
      for (const table of NEW_TABLES) assert.equal((await db.query('SELECT COUNT(*) AS n FROM `' + table + '`'))[0][0].n, 0, table + ' nace vacía: la migración no inserta datos');
      const again = await runScript('migrate.cjs', name);
      assert.equal(again.code, 0, again.output);
      const [registered] = await db.query('SELECT name FROM horus_migrations ORDER BY name');
      assert.deepEqual(registered.map(r => r.name), [...versions].sort(), 'cada migración registrada una sola vez');
      assert.deepEqual(await snapshot(db, ['horus_migrations', ...NEW_TABLES, ...LATER_TABLES]), after, 'repetir db:migrate no cambia nada');
    });

    await t.test('estructura real: InnoDB, claves RESTRICT, únicos, CHECK aplicados y columna generada STORED', async () => {
      const [tables] = await db.query("SELECT TABLE_NAME AS t, ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY 1", [NEW_TABLES]);
      assert.deepEqual(tables.map(r => [r.t, r.e, r.c]), [['docente_asignaciones', 'InnoDB', 'utf8mb4_unicode_ci'], ['docentes', 'InnoDB', 'utf8mb4_unicode_ci']]);
      const [fks] = await db.query("SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS c, REFERENCED_TABLE_NAME AS r, DELETE_RULE AS d, UPDATE_RULE AS u FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY 1,2", [NEW_TABLES]);
      assert.deepEqual(fks.map(r => [r.t, r.c, r.r, r.d, r.u].join(' ')), [
        'docente_asignaciones docente_asignaciones_convocatoria_fk convocatorias RESTRICT RESTRICT', 'docente_asignaciones docente_asignaciones_docente_fk docentes RESTRICT RESTRICT',
        'docente_asignaciones docente_asignaciones_sustituye_fk docente_asignaciones RESTRICT RESTRICT']);
      const [uniques] = await db.query("SELECT TABLE_NAME AS t, INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) AND NON_UNIQUE=0 AND INDEX_NAME<>'PRIMARY' GROUP BY 1,2 ORDER BY 1,2", [NEW_TABLES]);
      assert.deepEqual(uniques.map(r => r.t + '.' + r.i + '(' + r.cols + ')'), [
        'docente_asignaciones.docente_asignaciones_docente_edicion_uq(docente_id,convocatoria_id)', 'docente_asignaciones.docente_asignaciones_id_edicion_uq(id,convocatoria_id)',
        'docente_asignaciones.docente_asignaciones_principal_uq(principal_activo_convocatoria_id)', 'docentes.docentes_documento_uq(doc_pais,doc_tipo,doc_numero)', 'docentes.docentes_email_uq(email)']);
      const [checks] = await db.query("SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS c, ENFORCED AS e FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK' AND TABLE_NAME IN (?) ORDER BY 1,2", [NEW_TABLES]);
      assert.deepEqual(checks.map(r => r.t + '.' + r.c + '=' + r.e), [
        'docente_asignaciones.docente_asignaciones_retiro_chk=YES', 'docente_asignaciones.docente_asignaciones_revision_chk=YES', 'docentes.docentes_activo_chk=YES', 'docentes.docentes_documento_completo_chk=YES',
        'docentes.docentes_documento_formato_chk=YES', 'docentes.docentes_nombres_chk=YES', 'docentes.docentes_revision_chk=YES', 'docentes.docentes_texto_chk=YES']);
      const [[generated]] = await db.query("SELECT EXTRA AS extra, GENERATION_EXPRESSION AS expr FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='docente_asignaciones' AND COLUMN_NAME='principal_activo_convocatoria_id'");
      assert.equal(generated.extra, 'STORED GENERATED'); assert.match(generated.expr, /case when .*principal.*activa.* then `convocatoria_id` else NULL end/is);
      const [[account]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='docentes' AND COLUMN_NAME IN ('password','rol','admin_user_id','cuenta_id','token')");
      assert.equal(account.n, 0, 'docente ≠ cuenta: la tabla no tiene contraseña, rol ni vínculo con admin_users');
    });

    await t.test('restricciones de la base rechazan datos inválidos aunque se escriba por SQL directo', async () => {
      await db.query("INSERT INTO docentes (nombres,apellidos,doc_pais,doc_tipo,doc_numero,email) VALUES ('Uno','Dni','PE','DNI','00000001','Dni@Docentes.Test')");
      await db.query("INSERT INTO docentes (nombres,apellidos) VALUES ('Sin','Datos'),('Sin','Datos Tampoco')");
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES ('Dos','Dni','PE','DNI','00000001')"), 1062, 'docentes_documento_uq');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos,email) VALUES ('Dos','Correo','dni@docentes.TEST')"), 1062, 'docentes_email_uq');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos,doc_numero) VALUES ('Ana','Restricción','12345678')"), 3819, 'docentes_documento_completo_chk');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES ('X','Y','PE','DNI','1234567')"), 3819, 'docentes_documento_formato_chk');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES ('X','Y','PE','DNI','12345678\n')"), 3819, 'docentes_documento_formato_chk');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES ('X','Y','AR','DNI','12345678')"), 3819, 'docentes_documento_formato_chk');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos) VALUES ('   ','Y')"), 3819, 'docentes_nombres_chk');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos) VALUES ('X','')"), 3819, 'docentes_nombres_chk');
      for (const column of ['especialidad', 'profesion', 'email', 'telefono']) await rejects(db.query('INSERT INTO docentes (nombres,apellidos,' + column + ") VALUES ('X','Y','   ')"), 3819, 'docentes_texto_chk');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos,activo) VALUES ('X','Y',2)"), 3819, 'docentes_activo_chk');
      await rejects(db.query("INSERT INTO docentes (nombres,apellidos,revision) VALUES ('X','Y',0)"), 3819, 'docentes_revision_chk');
      await db.query("INSERT INTO docentes (nombres,apellidos) VALUES ('A1','Asig'),('A2','Asig'),('A3','Asig')");
      const [[ids]] = await db.query("SELECT MIN(id) AS a FROM docentes WHERE apellidos='Asig'"); const a = ids.a;
      await db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id,rol) VALUES (?,2,'principal')", [a]);
      await rejects(db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id) VALUES (?,2)", [a]), 1062, 'docente_asignaciones_docente_edicion_uq');
      await rejects(db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id,rol) VALUES (?,2,'principal')", [a + 1]), 1062, 'docente_asignaciones_principal_uq');
      await db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id,rol) VALUES (?,2,'participante'),(?,2,'participante')", [a + 1, a + 2]);
      await db.query("UPDATE docente_asignaciones SET estado='retirada', retirado_at=NOW(3), retiro_motivo='Motivo ficticio' WHERE docente_id=?", [a]);
      await db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id,rol) VALUES (?,1,'principal')", [a + 1]);
      await db.query("UPDATE docente_asignaciones SET rol='principal' WHERE docente_id=? AND convocatoria_id=2", [a + 2]); // el principal anterior está retirado: ahora sí cabe uno
      await rejects(db.query("UPDATE docente_asignaciones SET estado='retirada' WHERE docente_id=? AND convocatoria_id=2", [a + 1]), 3819, 'docente_asignaciones_retiro_chk');
      await rejects(db.query("UPDATE docente_asignaciones SET retirado_at=NOW(3) WHERE docente_id=? AND convocatoria_id=2", [a + 1]), 3819, 'docente_asignaciones_retiro_chk');
      await rejects(db.query("UPDATE docente_asignaciones SET estado='retirada', retirado_at=NOW(3), retiro_motivo='  ' WHERE docente_id=? AND convocatoria_id=2", [a + 1]), 3819, 'docente_asignaciones_retiro_chk');
      await rejects(db.query('UPDATE docente_asignaciones SET revision=0 WHERE id=1'), 3819, 'docente_asignaciones_revision_chk');
      const [[second]] = await db.query('SELECT id FROM docente_asignaciones WHERE convocatoria_id=1');
      await rejects(db.query('UPDATE docente_asignaciones SET sustituye_a_id=? WHERE convocatoria_id=2 AND docente_id=?', [second.id, a + 1]), 1452, 'docente_asignaciones_sustituye_fk');
      await rejects(db.query('DELETE FROM docentes WHERE id=?', [a]), 1451, 'docente_asignaciones_docente_fk');
      await rejects(db.query('DELETE FROM convocatorias WHERE id=2'), 1451);
      await rejects(db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id) VALUES (999999,2)"), 1452, 'docente_asignaciones_docente_fk');
      await rejects(db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id) VALUES (?,999999)", [a]), 1452, 'docente_asignaciones_convocatoria_fk');
      await db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,campos,revision) VALUES ('docente',1,'creacion','panel',1,JSON_ARRAY(),1),('asignacion_docente',1,'creacion','panel',1,JSON_ARRAY(),1)");
      await rejects(db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,campos,revision) VALUES ('otra',1,'creacion','panel',1,JSON_ARRAY(),1)"), 1265);
      // Se retira todo lo escrito por SQL para dejar la base lista para la prueba HTTP (solo filas de esta prueba, en su base propia).
      await db.query('DELETE FROM academico_historial WHERE entidad IN (?, ?)', ['docente', 'asignacion_docente']);
      await db.query('DELETE FROM docente_asignaciones'); await db.query('DELETE FROM docentes');
    });

    await t.test('fallo parcial: cada prefijo de la migración se completa al reintentar y db:check lo detecta antes', async () => {
      const statements = statementsOf(MIGRATION);
      assert.equal(statements.length, 3); assert.ok(statements.slice(0, 2).every(s => /^CREATE TABLE IF NOT EXISTS `\w+` \(/.test(s))); assert.match(statements[2], /^ALTER TABLE `academico_historial` MODIFY `entidad` ENUM\(/);
      for (let applied = 1; applied < statements.length; applied++) {
        const partial = await databaseBefore();
        await partial.db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,estado,createdAt,updatedAt) VALUES ('Curso','parcial-" + applied + "','x','curso','publicado',NOW(),NOW())");
        const before = await snapshot(partial.db, ['horus_migrations']);
        for (const statement of statements.slice(0, applied)) await partial.db.query(statement);
        assert.equal((await runScript('check-database.cjs', partial.name)).code, 1, 'db:check detecta la migración incompleta (' + applied + '/3)');
        assert.equal((await runScript('migrate.cjs', partial.name)).code, 0);
        const check = await runScript('check-database.cjs', partial.name);
        assert.equal(check.code, 0, check.output);
        const after = await snapshot(partial.db, ['horus_migrations', ...NEW_TABLES, ...LATER_TABLES, 'academico_historial']);
        const { academico_historial, ...rest } = before;
        assert.deepEqual(after, rest, 'los datos previos no cambian en la recuperación');
        assert.equal((await snapshot(partial.db, ['horus_migrations', ...NEW_TABLES])).academico_historial.rows, academico_historial.rows, 'el historial previo conserva sus filas');
      }
      // Una tabla preexistente con otra forma no se corrige en silencio: CREATE TABLE IF NOT EXISTS la omite y db:check la rechaza.
      const alien = await databaseBefore();
      await alien.db.query('CREATE TABLE `docentes` (`id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY, `nombres` VARCHAR(50) NOT NULL) ENGINE=InnoDB');
      await runScript('migrate.cjs', alien.name);
      const rejected = await runScript('check-database.cjs', alien.name);
      assert.equal(rejected.code, 1); assert.ok(rejected.output.includes('docentes.apellidos: falta') || rejected.output.includes('docentes.nombres: tipo distinto'), rejected.output);
    });

    // ---- HTTP real -----------------------------------------------------------------------------------------------------
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const apiPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    api = fork(join(__dirname, 'fixtures/access-guard-app.cjs'), [], { cwd: apiCwd, windowsHide: true, silent: true,
      execArgv: ['-r', join(__dirname, 'isolate-env.cjs')], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development', DB_HOST: credentials.host, DB_PORT: String(credentials.port), DB_USER: credentials.user, DB_PASS: credentials.password, DB_NAME: name,
        JWT_SECRET: randomBytes(32).toString('hex'), PORT: String(apiPort), MAIL_PROVIDER: 'gmail', HORUS_ACCESS_GUARD_FIXTURE: 'e36' } });
    const ready = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('API de prueba no inició')), 40000); api.once('message', m => { clearTimeout(timer); resolve(m); }); api.once('exit', () => { clearTimeout(timer); reject(new Error('API de prueba terminó antes de iniciar')); }); });
    const base = 'http://127.0.0.1:' + ready.port + '/api';
    const request = async (path, token, method = 'GET', body) => {
      const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* cuerpo no JSON */ }
      if (r.status >= 400) leaks.push(text);
      return { status: r.status, body: json, text };
    };
    const tokens = {};
    for (const key of ['g', 'c', 's', 'b']) { const r = await request('/admin/login', null, 'POST', { email: key + '@docentes.test', password: 'Ficticia-docentes-1' }); assert.equal(r.status, 200); tokens[key] = r.body.token; }
    const D = '/admin/docentes', A = '/admin/asignaciones-docentes', E = '/admin/convocatorias';
    const rows = async (sql, params) => (await db.query(sql, params))[0];

    await t.test('permisos: sin JWT 401, cuenta básica y secretaría 403 en las 13 rutas; gerente y coordinación pasan la guard', async () => {
      const routes = [['GET', D], ['GET', D + '/1'], ['GET', D + '/1/asignaciones'], ['POST', D, {}], ['PATCH', D + '/1', { revision: 1, nombres: 'X' }], ['PUT', D + '/1/estado', { revision: 1, activo: false }],
        ['GET', A], ['GET', A + '/1'], ['POST', A, {}], ['PUT', A + '/1', { revision: 1, rol: 'principal' }], ['PUT', A + '/1/retiro', { revision: 1, motivo: 'x' }], ['PUT', A + '/1/reactivacion', { revision: 1, motivo: 'x' }], ['POST', A + '/1/sustitucion', { revision: 1, motivo: 'x', docente_id: 2 }]];
      assert.equal(routes.length, 13);
      const before = await rows('SELECT (SELECT COUNT(*) FROM docentes) AS d, (SELECT COUNT(*) FROM docente_asignaciones) AS a, (SELECT COUNT(*) FROM academico_historial) AS h');
      for (const [method, path, body] of routes) {
        assert.equal((await request(path, null, method, body)).status, 401, 'sin sesión ' + method + ' ' + path);
        assert.equal((await request(path, 'basura', method, body)).status, 401, 'JWT inválido ' + method + ' ' + path);
        for (const key of ['b', 's']) assert.equal((await request(path, tokens[key], method, body)).status, 403, key + ' ' + method + ' ' + path);
      }
      assert.deepEqual(await rows('SELECT (SELECT COUNT(*) FROM docentes) AS d, (SELECT COUNT(*) FROM docente_asignaciones) AS a, (SELECT COUNT(*) FROM academico_historial) AS h'), before, 'las denegaciones no escriben nada');
      for (const key of ['g', 'c']) for (const [method, path, body] of routes) assert.ok(![401, 403].includes((await request(path, tokens[key], method, body)).status), key + ' ' + method + ' ' + path);
    });

    const person = { nombres: ' Marta  Elena ', apellidos: ' Pérez   Soto ', doc_numero: '45678901', especialidad: ' Excel   avanzado ', profesion: 'Ingeniera de sistemas', email: ' Marta.Perez@Docentes.Test ', telefono: '976 543 210' };
    let marta;
    await t.test('alta: normalizada, validada, sin cuenta de acceso y con historial sin datos personales', async () => {
      const accounts = (await rows('SELECT COUNT(*) AS n FROM admin_users'))[0].n;
      for (const patch of [{ nombres: '' }, { doc_numero: '1234567' }, { email: 'no-correo' }, { telefono: 'abc' }, { password: 'Clave-ficticia-1' }, { rol: 'GERENTE_GENERAL' }, { activo: false }, { revision: 5 }, { id: 99 }, { doc_numero: 45678901 }])
        assert.equal((await request(D, tokens.g, 'POST', { ...person, ...patch })).status, 400, JSON.stringify(patch));
      const created = await request(D, tokens.c, 'POST', person);
      assert.equal(created.status, 201, created.text); marta = created.body.item;
      assert.deepEqual([marta.nombres, marta.apellidos, marta.email, marta.especialidad, marta.doc_pais, marta.doc_tipo, marta.activo, marta.revision, marta.asignaciones_activas], ['Marta Elena', 'Pérez Soto', 'marta.perez@docentes.test', 'Excel avanzado', 'PE', 'DNI', true, 1, 0]);
      assert.equal((await rows('SELECT COUNT(*) AS n FROM admin_users'))[0].n, accounts, 'registrar un docente no crea ninguna cuenta');
      assert.equal((await rows('SELECT COUNT(*) AS n FROM admin_users WHERE email=?', [marta.email]))[0].n, 0);
      const minimal = await request(D, tokens.g, 'POST', { nombres: 'Solo', apellidos: 'Nombre' }); assert.equal(minimal.status, 201);
      assert.deepEqual([minimal.body.item.doc_numero, minimal.body.item.email, minimal.body.item.especialidad], [null, null, null]);
      const history = await rows("SELECT operacion,campos,actor_id,actor_rol,revision,estado_nuevo FROM academico_historial WHERE entidad='docente' AND entidad_id=?", [marta.id]);
      assert.equal(history.length, 1); assert.equal(history[0].operacion, 'creacion'); assert.equal(history[0].actor_rol, 'COORDINADORA_INSTITUCIONAL');
      assert.deepEqual(campos(history[0].campos), ['nombres', 'apellidos', 'doc_numero', 'especialidad', 'profesion', 'email', 'telefono']);
      assert.ok(!JSON.stringify(history).match(/45678901|Marta|docentes\.test|976/i), 'el historial guarda nombres de campos, nunca datos personales');
    });

    await t.test('duplicados: DNI, correo y homónimos; también en altas simultáneas y en la edición', async () => {
      assert.equal((await request(D, tokens.g, 'POST', { nombres: 'Otra', apellidos: 'Persona', doc_numero: '45678901' })).status, 409);
      assert.equal((await request(D, tokens.g, 'POST', { nombres: 'Otra', apellidos: 'Persona', email: 'MARTA.PEREZ@docentes.test' })).status, 409);
      const homonym = await request(D, tokens.g, 'POST', { nombres: 'marta  elena', apellidos: 'PEREZ soto' });
      assert.equal(homonym.status, 409); assert.equal(homonym.body.codigo, 'POSIBLE_HOMONIMO'); assert.deepEqual(homonym.body.coincidencias, [marta.id]);
      assert.equal((await request(D, tokens.g, 'POST', { nombres: 'marta elena', apellidos: 'perez soto', confirmar_homonimo: true })).status, 201, 'el homónimo confirmado se registra');
      const same = { nombres: 'Carrera', apellidos: 'Simultánea', doc_numero: '11112222', email: 'carrera@docentes.test' };
      const raced = await Promise.all([1, 2, 3].map(() => request(D, tokens.g, 'POST', same)));
      assert.deepEqual(raced.map(r => r.status).sort(), [201, 409, 409], 'tres altas simultáneas con el mismo DNI: una gana');
      assert.equal((await rows('SELECT COUNT(*) AS n FROM docentes WHERE doc_numero=?', ['11112222']))[0].n, 1);
      const racedEmail = await Promise.all(['a', 'b'].map(n => request(D, tokens.g, 'POST', { nombres: 'Correo' + n, apellidos: 'Carrera', email: 'compartido@docentes.test', confirmar_homonimo: true })));
      assert.deepEqual(racedEmail.map(r => r.status).sort(), [201, 409]);
      const other = (await request(D, tokens.g, 'POST', { nombres: 'Tercero', apellidos: 'Distinto' })).body.item;
      assert.equal((await request(D + '/' + other.id, tokens.g, 'PATCH', { revision: 1, doc_numero: '45678901' })).status, 409, 'editar a un DNI ajeno');
      assert.equal((await request(D + '/' + other.id, tokens.g, 'PATCH', { revision: 1, email: 'Marta.Perez@docentes.test' })).status, 409, 'editar a un correo ajeno');
      assert.equal((await request(D + '/' + other.id, tokens.g, 'PATCH', { revision: 1, doc_numero: '45678901' })).status, 409);
      assert.equal((await request(D + '/' + marta.id, tokens.g, 'PATCH', { revision: 1, doc_numero: '45678901', email: marta.email })).status, 200, 'conservar los propios no es duplicado');
      marta = (await request(D + '/' + marta.id, tokens.g)).body.item;
    });

    await t.test('edición: revisión obligatoria, un ganador ante escrituras simultáneas, limpiar campos y registro de campos', async () => {
      const url = D + '/' + marta.id;
      for (const body of [{}, { revision: marta.revision }, { nombres: 'Otro' }, { revision: marta.revision, nombres: '' }, { revision: marta.revision, activo: false }, { revision: marta.revision, rol: 'X' }]) assert.equal((await request(url, tokens.g, 'PATCH', body)).status, 400, JSON.stringify(body));
      const start = marta.revision;
      const races = await Promise.all(['Carmen', 'Rosa'].map(nombres => request(url, tokens.g, 'PATCH', { revision: start, nombres })));
      assert.deepEqual(races.map(r => r.status).sort(), [200, 409], 'un ganador y un 409');
      marta = (await request(url, tokens.g)).body.item; assert.equal(marta.revision, start + 1);
      assert.equal((await request(url, tokens.g, 'PATCH', { revision: start, profesion: 'Obsoleta' })).status, 409, 'revisión obsoleta');
      const cleared = await request(url, tokens.c, 'PATCH', { revision: marta.revision, email: '', telefono: '', especialidad: '', profesion: '', doc_numero: '' });
      assert.equal(cleared.status, 200); assert.deepEqual([cleared.body.item.email, cleared.body.item.telefono, cleared.body.item.especialidad, cleared.body.item.profesion, cleared.body.item.doc_numero, cleared.body.item.doc_pais, cleared.body.item.doc_tipo], [null, null, null, null, null, null, null]);
      marta = cleared.body.item;
      assert.equal((await request(D + '/999999', tokens.g, 'PATCH', { revision: 1, nombres: 'X' })).status, 404);
      const history = await rows("SELECT operacion,campos,revision FROM academico_historial WHERE entidad='docente' AND entidad_id=? ORDER BY id", [marta.id]);
      assert.deepEqual(history.map(r => r.operacion), ['creacion', 'edicion', 'edicion', 'edicion']);
      assert.deepEqual(history.map(r => r.revision), [1, 2, 3, 4], 'cada cambio deja su revisión');
      assert.deepEqual(campos(history[3].campos).sort(), ['doc_numero', 'email', 'especialidad', 'profesion', 'telefono'], 'solo nombres de campos');
    });

    await t.test('listado: paginado, ordenado de forma estable, con filtros por nombre, especialidad y estado', async () => {
      for (let i = 1; i <= 5; i++) assert.equal((await request(D, tokens.g, 'POST', { nombres: 'Lista' + i, apellidos: 'Ordenada', especialidad: i % 2 ? 'Redes y cableado' : 'Contabilidad' })).status, 201);
      const all = [];
      for (let page = 1; page <= 3; page++) { const r = await request(D + '?search=Ordenada&limit=2&page=' + page, tokens.g); assert.equal(r.status, 200); assert.equal(r.body.pagination.total, 5); assert.equal(r.body.pagination.pages, 3); all.push(...r.body.items.map(i => i.nombres)); }
      assert.deepEqual(all, ['Lista1', 'Lista2', 'Lista3', 'Lista4', 'Lista5'], 'orden por apellidos, nombres e id sin repetir ni omitir');
      assert.equal((await request(D + '?search=perez&limit=100', tokens.g)).body.items.every(i => /p[ée]rez/i.test(i.apellidos)), true, 'sin distinguir tildes ni mayúsculas');
      assert.equal((await request(D + '?search=ordenada%20lista3', tokens.g)).body.pagination.total, 1, 'varias palabras: todas deben coincidir');
      assert.equal((await request(D + '?especialidad=redes&search=Ordenada', tokens.g)).body.pagination.total, 3);
      assert.equal((await request(D + '?search=11112222', tokens.g)).body.pagination.total, 1, 'por número de documento');
      assert.equal((await request(D + '?search=%25', tokens.g)).status, 200);
      for (const bad of ['limit=101', 'page=0', 'estado=archivados', 'search=' + 'a'.repeat(101), 'orden=id', 'page=abc']) assert.equal((await request(D + '?' + bad, tokens.g)).status, 400, bad);
      assert.equal((await request(D + '/abc', tokens.g)).status, 400); assert.equal((await request(D + '/999999', tokens.g)).status, 404);
      const item = (await request(D + '?search=Lista1', tokens.g)).body.items[0];
      assert.ok(!('_count' in item) && item.asignaciones_activas === 0);
    });

    // Edición de trabajo y fixtures de asignación.
    const input = { curso_id: 1, nombre: 'Noviembre 2026', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 };
    const teacher = async (n, extra = {}) => (await request(D, tokens.g, 'POST', { nombres: 'Asignable' + n, apellidos: 'Equipo', ...extra })).body.item;
    const edition = async (nombre, open = true) => { const e = (await request(E, tokens.g, 'POST', { ...input, nombre })).body.item; if (open) await validatedPreinscripciones(db, e.id, 10, 'doc'); /* regla vigente: una edición nueva exige 10 preinscripciones validadas para abrirse */ return open ? (await request(E + '/' + e.id + '/apertura', tokens.g, 'PUT', { revision: e.revision })).body.item : e; };
    const assign = (docente_id, convocatoria_id, rol, token = tokens.g) => request(A, token, 'POST', { docente_id, convocatoria_id, ...(rol ? { rol } : {}) });
    let ed;
    await t.test('asignación: existencia, duplicados, un solo principal (también simultáneo) y reglas de la edición', async () => {
      ed = await edition('Equipo docente');
      const [t1, t2, t3] = [await teacher(1), await teacher(2), await teacher(3)];
      assert.equal((await assign(999999, ed.id)).status, 404, 'docente inexistente'); assert.equal((await assign(t1.id, 999999)).status, 404, 'edición inexistente');
      for (const body of [{}, { docente_id: t1.id }, { docente_id: t1.id, convocatoria_id: ed.id, rol: 'jefe' }, { docente_id: String(t1.id), convocatoria_id: ed.id }, { docente_id: t1.id, convocatoria_id: ed.id, estado: 'retirada' }]) assert.equal((await request(A, tokens.g, 'POST', body)).status, 400, JSON.stringify(body));
      const first = await assign(t1.id, ed.id, undefined, tokens.c); assert.equal(first.status, 201, first.text);
      assert.deepEqual([first.body.item.rol, first.body.item.estado, first.body.item.revision, first.body.item.docente.id, first.body.item.convocatoria.curso.titulo], ['participante', 'activa', 1, t1.id, 'Excel Básico']);
      assert.deepEqual(Object.keys(first.body.item.docente).sort(), ['activo', 'apellidos', 'especialidad', 'id', 'nombres'], 'resumen del docente sin datos personales');
      assert.equal((await assign(t1.id, ed.id)).status, 409, 'asignación duplicada');
      const dup = await Promise.all([1, 2, 3].map(() => assign(t2.id, ed.id)));
      assert.deepEqual(dup.map(r => r.status).sort(), [201, 409, 409], 'tres asignaciones simultáneas del mismo docente: una sola fila');
      assert.equal((await rows('SELECT COUNT(*) AS n FROM docente_asignaciones WHERE docente_id=? AND convocatoria_id=?', [t2.id, ed.id]))[0].n, 1);
      const principals = await Promise.all([t3, await teacher(4), await teacher(5)].map(x => assign(x.id, ed.id, 'principal')));
      assert.deepEqual(principals.map(r => r.status).sort(), [201, 409, 409], 'dos principales simultáneos: solo uno');
      assert.equal((await rows("SELECT COUNT(*) AS n FROM docente_asignaciones WHERE convocatoria_id=? AND rol='principal' AND estado='activa'", [ed.id]))[0].n, 1);
      const listed = await request(A + '?convocatoria_id=' + ed.id, tokens.c);
      assert.equal(listed.body.pagination.total, 3, 't1 + t2 + el principal ganador'); assert.equal(listed.body.items[0].rol, 'principal', 'el principal va primero');
      assert.equal((await request(A + '/' + first.body.item.id, tokens.c)).body.item.docente_id, t1.id);
      assert.equal((await request(A + '/999999', tokens.c)).status, 404);
      for (const bad of ['rol=otro', 'estado=otra', 'convocatoria_id=0', 'limit=101']) assert.equal((await request(A + '?' + bad, tokens.c)).status, 400, bad);
      const cancelled = await edition('Cancelada'); await request(E + '/' + cancelled.id + '/cierre', tokens.g, 'PUT', { revision: cancelled.revision, estado: 'cancelada' });
      assert.equal((await assign(t1.id, cancelled.id)).status, 409, 'edición cancelada');
      const planned = await edition('Planificada', false); assert.equal((await assign(t1.id, planned.id)).status, 201, 'edición planificada');
      const closed = await edition('Cerrada'); await request(E + '/' + closed.id + '/cierre', tokens.g, 'PUT', { revision: closed.revision, estado: 'cerrada' });
      assert.equal((await assign(t1.id, closed.id)).status, 201, 'edición cerrada: se registra quién la dictó');
      const closedNow = (await request(E + '/' + closed.id, tokens.g)).body.item;
      assert.equal((await request(E + '/' + closed.id + '/archivo', tokens.g, 'PUT', { revision: closedNow.revision, archivado: true })).status, 200, 'archivar una edición con docentes es posible');
      assert.equal((await assign((await teacher(6)).id, closed.id)).status, 409, 'edición archivada');
    });

    await t.test('roles, retiro, reactivación y sustitución conservan el historial y respetan la revisión', async () => {
      const ed2 = await edition('Cambios de equipo');
      const [p, q2, r2, s2] = [await teacher(11), await teacher(12), await teacher(13), await teacher(14)];
      const ap = (await assign(p.id, ed2.id, 'principal')).body.item, aq = (await assign(q2.id, ed2.id)).body.item;
      assert.equal((await request(A + '/' + aq.id, tokens.g, 'PUT', { revision: aq.revision, rol: 'principal' })).status, 409, 'ya hay principal');
      assert.equal((await request(A + '/' + aq.id, tokens.g, 'PUT', { revision: 1, rol: 'participante' })).status, 409, 'mismo rol');
      let moved = await request(A + '/' + ap.id, tokens.g, 'PUT', { revision: ap.revision, rol: 'participante' }); assert.equal(moved.status, 200); assert.equal(moved.body.item.revision, 2);
      assert.equal((await request(A + '/' + ap.id, tokens.g, 'PUT', { revision: 1, rol: 'principal' })).status, 409, 'revisión obsoleta');
      moved = await request(A + '/' + aq.id, tokens.c, 'PUT', { revision: aq.revision, rol: 'principal' }); assert.equal(moved.status, 200, moved.text);
      const race = await Promise.all([request(A + '/' + ap.id, tokens.g, 'PUT', { revision: 2, rol: 'principal' }), request(A + '/' + aq.id, tokens.g, 'PUT', { revision: 2, rol: 'participante' })]);
      assert.ok(race.every(r => [200, 409].includes(r.status)) && race.some(r => r.status === 200), 'ninguna carrera termina en 500 ni deja dos principales');
      assert.ok((await rows("SELECT COUNT(*) AS n FROM docente_asignaciones WHERE convocatoria_id=? AND rol='principal' AND estado='activa'", [ed2.id]))[0].n <= 1);
      // Retiro
      const now = key => request(A + '/' + key, tokens.g);
      let aqNow = (await now(aq.id)).body.item;
      for (const body of [{ revision: aqNow.revision }, { revision: aqNow.revision, motivo: '  ' }, { motivo: 'Sin revisión' }]) assert.equal((await request(A + '/' + aq.id + '/retiro', tokens.g, 'PUT', body)).status, 400);
      const retired = await request(A + '/' + aq.id + '/retiro', tokens.c, 'PUT', { revision: aqNow.revision, motivo: ' Renuncia por motivos personales ' });
      assert.equal(retired.status, 200, retired.text); assert.deepEqual([retired.body.item.estado, retired.body.item.retiro_motivo, !!retired.body.item.retirado_at], ['retirada', 'Renuncia por motivos personales', true]);
      assert.equal((await request(A + '/' + aq.id + '/retiro', tokens.g, 'PUT', { revision: retired.body.item.revision, motivo: 'Otra vez' })).status, 409, 'ya retirada');
      assert.equal((await assign(q2.id, ed2.id)).status, 409, 'una asignación retirada no se duplica: se reactiva');
      assert.equal((await request(A + '/' + aq.id, tokens.g, 'PUT', { revision: retired.body.item.revision, rol: 'participante' })).status, 409, 'no se cambia el rol de una retirada');
      // Con el principal retirado, otro docente puede serlo (quién quedó como principal depende de la carrera anterior).
      const holderId = (await rows("SELECT id FROM docente_asignaciones WHERE convocatoria_id=? AND rol='principal' AND estado='activa'", [ed2.id]))[0]?.id;
      if (holderId) assert.equal((await request(A + '/' + holderId + '/retiro', tokens.g, 'PUT', { revision: (await now(holderId)).body.item.revision, motivo: 'Libera el principal' })).status, 200);
      assert.equal((await assign(r2.id, ed2.id, 'principal')).status, 201, 'tras retirar al principal cabe otro');
      // Reactivación
      const aqRetired = (await now(aq.id)).body.item;
      const react = await request(A + '/' + aq.id + '/reactivacion', tokens.g, 'PUT', { revision: aqRetired.revision, motivo: 'Vuelve al equipo', rol: 'participante' });
      assert.equal(react.status, 200, react.text); assert.deepEqual([react.body.item.estado, react.body.item.retirado_at, react.body.item.retiro_motivo], ['activa', null, null]);
      assert.equal((await request(A + '/' + aq.id + '/reactivacion', tokens.g, 'PUT', { revision: react.body.item.revision, motivo: 'Otra vez' })).status, 409, 'ya activa');
      // Sustitución atómica
      const holder = (await rows("SELECT id FROM docente_asignaciones WHERE convocatoria_id=? AND rol='principal' AND estado='activa'", [ed2.id]))[0].id;
      const holderRow = (await now(holder)).body.item;
      assert.equal((await request(A + '/' + holder + '/sustitucion', tokens.g, 'POST', { revision: holderRow.revision, motivo: 'Mismo', docente_id: holderRow.docente_id })).status, 400, 'no se sustituye por sí mismo');
      assert.equal((await request(A + '/' + holder + '/sustitucion', tokens.g, 'POST', { revision: holderRow.revision, motivo: 'Inexistente', docente_id: 999999 })).status, 404);
      assert.equal((await request(A + '/' + holder + '/sustitucion', tokens.g, 'POST', { revision: holderRow.revision, motivo: 'Ya está', docente_id: q2.id })).status, 409, 'el sustituto ya está en el equipo');
      await request(D + '/' + s2.id + '/estado', tokens.g, 'PUT', { revision: s2.revision, activo: false });
      assert.equal((await request(A + '/' + holder + '/sustitucion', tokens.g, 'POST', { revision: holderRow.revision, motivo: 'Inactivo', docente_id: s2.id })).status, 409, 'el sustituto inactivo no se acepta');
      assert.equal((await now(holder)).body.item.estado, 'activa', 'una sustitución rechazada no cambia nada');
      await request(D + '/' + s2.id + '/estado', tokens.g, 'PUT', { revision: s2.revision + 1, activo: true });
      const swapped = await request(A + '/' + holder + '/sustitucion', tokens.c, 'POST', { revision: holderRow.revision, motivo: 'Licencia médica', docente_id: s2.id });
      assert.equal(swapped.status, 201, swapped.text);
      assert.deepEqual([swapped.body.anterior.estado, swapped.body.item.estado, swapped.body.item.rol, swapped.body.item.sustituye_a_id, swapped.body.item.docente_id], ['retirada', 'activa', 'principal', holder, s2.id], 'hereda el rol de principal');
      assert.equal((await rows("SELECT COUNT(*) AS n FROM docente_asignaciones WHERE convocatoria_id=? AND rol='principal' AND estado='activa'", [ed2.id]))[0].n, 1);
      const trail = await rows("SELECT entidad_id,operacion,estado_anterior,estado_nuevo,motivo,actor_rol FROM academico_historial WHERE entidad='asignacion_docente' AND entidad_id IN (?,?) ORDER BY id", [holder, swapped.body.item.id]);
      assert.ok(trail.some(r => r.entidad_id === holder && r.operacion === 'cambio_estado' && r.estado_anterior === 'activa' && r.estado_nuevo === 'retirada' && r.motivo === 'Licencia médica' && r.actor_rol === 'COORDINADORA_INSTITUCIONAL'));
      assert.ok(trail.some(r => r.entidad_id === swapped.body.item.id && r.operacion === 'sustitucion'));
      const replaced = await request(D + '/' + p.id + '/asignaciones?estado=todas', tokens.g);
      assert.equal(replaced.status, 200); assert.ok(replaced.body.items.length >= 1);
    });

    await t.test('desactivar un docente conserva sus asignaciones y no admite nuevas; el historial no se pierde', async () => {
      const ed3 = await edition('Docente inactivo');
      const t7 = await teacher(21), t8 = await teacher(22);
      const kept = (await assign(t7.id, ed3.id, 'principal')).body.item;
      const off = await request(D + '/' + t7.id + '/estado', tokens.c, 'PUT', { revision: t7.revision, activo: false });
      assert.equal(off.status, 200, off.text); assert.deepEqual([off.body.item.activo, off.body.item.asignaciones_activas, off.body.item.revision], [false, 1, 2]);
      assert.deepEqual((await request(A + '/' + kept.id, tokens.g)).body.item.estado, 'activa', 'la asignación sigue activa: nada se retira automáticamente');
      assert.equal((await rows('SELECT estado FROM docente_asignaciones WHERE id=?', [kept.id]))[0].estado, 'activa');
      assert.equal((await request(D + '/' + t7.id + '/estado', tokens.g, 'PUT', { revision: 2, activo: false })).status, 409, 'ya inactivo');
      assert.equal((await assign(t7.id, (await edition('Otra edición')).id)).status, 409, 'un inactivo no recibe asignaciones nuevas');
      assert.equal((await request(D + '?search=Asignable21&estado=activos', tokens.g)).body.pagination.total, 0);
      assert.equal((await request(D + '?search=Asignable21&estado=inactivos', tokens.g)).body.pagination.total, 1);
      assert.equal((await request(D + '?search=Asignable21&estado=todos', tokens.g)).body.pagination.total, 1);
      const history = await request(D + '/' + t7.id + '/asignaciones', tokens.g);
      assert.equal(history.status, 200); assert.equal(history.body.items.length, 1); assert.equal(history.body.items[0].docente.activo, false);
      const retired = await request(A + '/' + kept.id + '/retiro', tokens.g, 'PUT', { revision: 1, motivo: 'Docente desactivado' }); assert.equal(retired.status, 200, 'retirar siempre es posible');
      assert.equal((await request(A + '/' + kept.id + '/reactivacion', tokens.g, 'PUT', { revision: 2, motivo: 'Intento' })).status, 409, 'un inactivo no vuelve al equipo');
      assert.equal((await request(D + '/' + t7.id + '/estado', tokens.g, 'PUT', { revision: 2, activo: true })).status, 200);
      assert.equal((await request(A + '/' + kept.id + '/reactivacion', tokens.g, 'PUT', { revision: 2, motivo: 'Vuelve' })).status, 200);
      assert.equal((await request(D + '/' + t7.id + '/asignaciones?estado=retiradas', tokens.g)).body.pagination.total, 0);
      assert.equal((await request(D + '/999999/asignaciones', tokens.g)).status, 404);
      assert.equal((await request(D + '/' + t8.id + '/estado', tokens.g, 'PUT', { revision: 1 })).status, 400);
      const race = await Promise.all([request(D + '/' + t8.id + '/estado', tokens.g, 'PUT', { revision: 1, activo: false }), assign(t8.id, ed3.id)]);
      assert.ok(race[0].status === 200 && [201, 409].includes(race[1].status), 'desactivar y asignar a la vez: sin errores internos (' + race.map(r => r.status) + ')');
    });

    await t.test('transaccionalidad: si falla el historial no se persiste ni el docente ni la asignación', async () => {
      const ed4 = await edition('Historial fallido'); const t9 = await teacher(31);
      const snap = async () => JSON.stringify(await rows('SELECT (SELECT COUNT(*) FROM docentes) AS d, (SELECT COUNT(*) FROM docente_asignaciones) AS a, (SELECT revision FROM docentes WHERE id=?) AS r, (SELECT MAX(id) FROM docente_asignaciones) AS m', [t9.id]));
      const before = await snap();
      await db.query("CREATE TRIGGER docentes_historial_fallo BEFORE INSERT ON academico_historial FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio de auditoría'");
      try {
        assert.equal((await request(D, tokens.g, 'POST', { nombres: 'Sin', apellidos: 'Historial' })).status, 500);
        assert.equal((await request(D + '/' + t9.id, tokens.g, 'PATCH', { revision: 1, profesion: 'No debe guardarse' })).status, 500);
        assert.equal((await request(D + '/' + t9.id + '/estado', tokens.g, 'PUT', { revision: 1, activo: false })).status, 500);
        assert.equal((await assign(t9.id, ed4.id)).status, 500);
        assert.equal(await snap(), before, 'ni el docente ni la asignación cambian sin su historial');
      } finally { await db.query('DROP TRIGGER docentes_historial_fallo'); }
      assert.equal((await assign(t9.id, ed4.id)).status, 201, 'sin el fallo todo vuelve a funcionar');
      const failing = await request(D + '/' + t9.id + '/asignaciones', tokens.g); assert.equal(failing.body.items.length, 1);
      await db.query("CREATE TRIGGER sustitucion_historial_fallo BEFORE INSERT ON academico_historial FOR EACH ROW BEGIN IF NEW.operacion = 'sustitucion' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio'; END IF; END");
      try {
        const current = failing.body.items[0]; const t10 = await teacher(32);
        assert.equal((await request(A + '/' + current.id + '/sustitucion', tokens.g, 'POST', { revision: current.revision, motivo: 'Fallida', docente_id: t10.id })).status, 500);
        const intact = (await request(A + '/' + current.id, tokens.g)).body.item;
        assert.deepEqual([intact.estado, intact.revision], ['activa', current.revision], 'la sustitución fallida se revierte entera: el docente actual sigue activo');
        assert.equal((await rows('SELECT COUNT(*) AS n FROM docente_asignaciones WHERE docente_id=?', [t10.id]))[0].n, 0);
      } finally { await db.query('DROP TRIGGER sustitucion_historial_fallo'); }
    });

    await t.test('compatibilidad: Ediciones, Estudiantes, Matrículas y Reportes siguen funcionando con docentes asignados', async () => {
      const ed5 = await edition('Compatibilidad'); const t11 = await teacher(41); await assign(t11.id, ed5.id, 'principal');
      const student = await request('/admin/estudiantes', tokens.s, 'POST', { nombres: 'Alumna', apellidos: 'Ficticia', doc_numero: '77889900' }); assert.equal(student.status, 201);
      const enrol = await request('/admin/matriculas', tokens.s, 'POST', { estudiante_id: student.body.item.id, convocatoria_id: ed5.id, convocatoria_revision: ed5.revision });
      assert.equal(enrol.status, 201, enrol.text);
      assert.equal((await request('/admin/matriculas?convocatoria_id=' + ed5.id, tokens.s)).body.pagination.total, 1);
      assert.equal((await request(E + '/' + ed5.id, tokens.s)).status, 200);
      const edited = await request(E + '/' + ed5.id, tokens.g, 'PUT', { revision: ed5.revision, capacidad: 25 }); assert.equal(edited.status, 200, 'editar la edición no se ve afectado');
      const closed = await request(E + '/' + ed5.id + '/cierre', tokens.c, 'PUT', { revision: edited.body.item.revision, estado: 'cerrada' }); assert.equal(closed.status, 200);
      assert.equal((await request(A + '?convocatoria_id=' + ed5.id, tokens.g)).body.pagination.total, 1, 'cerrar la edición conserva el equipo docente');
      const reports = await request('/admin/reportes', tokens.c); assert.equal(reports.status, 200);
      assert.equal((await request('/admin/stats?vista=operativa', tokens.g)).status, 200);
      assert.equal((await request('/admin/me', tokens.b)).status, 200);
      for (const endpoint of ['/cursos', '/servicios', '/galeria', '/convenios', '/settings']) assert.equal((await request(endpoint)).status, 200);
      const cancelRace = await edition('Carrera de cancelación'); const t12 = await teacher(42);
      const raced = await Promise.all([request(E + '/' + cancelRace.id + '/cierre', tokens.g, 'PUT', { revision: cancelRace.revision, estado: 'cancelada' }), assign(t12.id, cancelRace.id)]);
      assert.ok([200, 409].includes(raced[0].status) && [201, 409].includes(raced[1].status), 'cancelar y asignar a la vez: sin errores internos (' + raced.map(r => r.status) + ')');
    });

    await t.test('datos personales protegidos y errores controlados: nada de SQL, Prisma ni trazas; nada público', async () => {
      const secrets = ['45678901', 'marta.perez@docentes.test', '976 543 210', '11112222', 'carrera@docentes.test'];
      for (const path of [A + '?limit=100&estado=todas', D + '/' + marta.id + '/asignaciones']) { const r = await request(path, tokens.g); assert.equal(r.status, 200); for (const s of secrets) assert.ok(!r.text.includes(s), 'las asignaciones no exponen ' + s); }
      for (const path of ['/cursos', '/servicios', '/convenios', '/galeria', '/settings', D, A, D + '/1', '/chatbot/message']) {
        const r = await request(path, null, path === '/chatbot/message' ? 'POST' : 'GET', path === '/chatbot/message' ? { message: 'Quiénes son los docentes Marta Pérez Soto' } : undefined);
        assert.ok(![...secrets, 'Pérez Soto', 'Asignable'].some(s => r.text.includes(s)), 'sin datos de docentes en ' + path);
      }
      assert.equal((await request(D, null)).status, 401);
      assert.ok(leaks.length > 20, 'se recogieron respuestas de error para revisar');
      for (const text of leaks) assert.ok(!/prisma|ER_[A-Z_]+|SELECT |INSERT |UPDATE `|stack|\bat\s+\S+\.(js|ts)|sqlMessage|mysql/i.test(text), 'respuesta de error con detalles internos: ' + text.slice(0, 160));
    });

    t.diagnostic('Base ficticia conservada en el servidor desechable hasta retirar el contenedor propio: ' + name);
  } finally {
    if (api?.connected) { const exited = new Promise(resolve => api.once('exit', resolve)); api.disconnect(); await exited; }
    for (const client of clients) { try { await client.end(); } catch { /* ya cerrada */ } }
    await admin.end();
    for (const dir of [cwd, apiCwd]) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporal propio: se ignora si Windows aún lo retiene */ } }
  }
});
