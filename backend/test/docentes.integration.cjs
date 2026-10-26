// Docentes (alcance reducido): la administración de docentes y ponentes se retiró del sistema académico (los cursos los dictan integrantes
// de la propia empresa), pero SUS TABLAS, MIGRACIÓN (20261020-docentes) Y DATOS SE CONSERVAN. Esta suite, contra un MySQL 8.4 REAL y
// DESECHABLE, sigue verificando la migración (desde una base previa con datos, recuperación ante fallos parciales y restricciones de la
// base) y comprueba el nuevo alcance: sin rutas ni permisos de docentes, y sin Sesiones (módulo retirado y su migración ya no se aplica).
// Se conserva con este nombre porque la CI la invoca como destino `docentes`. No forma parte de `npm test`. Requiere `npm run build`.
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
const { withoutPreinscripciones } = require('./fixtures/preinscripciones-fixture.cjs');

const backend = join(__dirname, '..');
const versions = JSON.parse(readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const MIGRATION = '20261020-docentes';
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NEW_TABLES = ['docentes', 'docente_asignaciones'];
// Migraciones registradas DESPUÉS de la de docentes (db:migrate las aplica también): sus tablas no son parte de lo que esta prueba verifica
// de la migración de docentes. 20261020-sesiones-academicas está RETIRADA: ya no crea `sesiones` ni amplía los ENUM del historial.
const LATER_TABLES = ['convocatoria_horarios'];
const laterHistoryDdl = ddl => ddl;
const statementsOf = name => readFileSync(join(backend, 'migrations', name + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean); // criterio de migrate.cjs

test('Docentes (alcance reducido): migración y datos conservados, sin rutas de docentes ni de Sesiones en MySQL desechable', { timeout: 900000 }, async t => {
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

    // Ids reales de los datos históricos: la prueba de restricciones ya consumió valores de AUTO_INCREMENT (borró sus filas, pero
    // InnoDB no reutiliza los ids), así que no pueden suponerse fijos.
    let historicalAssignmentId;
    await t.test('alcance: el módulo de administración de docentes se retiró (sin rutas ni permisos) y sus tablas y datos se conservan', async () => {
      // Datos históricos escritos por SQL en esta base propia: un docente y su asignación.
      const [teacher] = await db.query("INSERT INTO docentes (nombres,apellidos,doc_pais,doc_tipo,doc_numero,email) VALUES ('Historica','Ficticia','PE','DNI','45678901','historica@docentes.test')");
      const [assignment] = await db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id,rol) VALUES (?,2,'principal')", [teacher.insertId]);
      historicalAssignmentId = assignment.insertId;
      const before = await rows('SELECT (SELECT COUNT(*) FROM docentes) AS d, (SELECT COUNT(*) FROM docente_asignaciones) AS a, (SELECT COUNT(*) FROM academico_historial) AS h');
      assert.deepEqual([before[0].d, before[0].a], [1, 1]);
      const routes = [['GET', D], ['GET', D + '/1'], ['GET', D + '/1/asignaciones'], ['POST', D, {}], ['PATCH', D + '/1', { revision: 1, nombres: 'X' }], ['PUT', D + '/1/estado', { revision: 1, activo: false }],
        ['GET', A], ['GET', A + '/1'], ['POST', A, {}], ['PUT', A + '/1', { revision: 1, rol: 'principal' }], ['PUT', A + '/1/retiro', { revision: 1, motivo: 'x' }], ['PUT', A + '/1/reactivacion', { revision: 1, motivo: 'x' }], ['POST', A + '/1/sustitucion', { revision: 1, motivo: 'x', docente_id: 2 }]];
      for (const [method, path, body] of routes) {
        for (const token of [null, tokens.b, tokens.s, tokens.c, tokens.g]) {
          const r = await request(path, token, method, body);
          assert.ok([401, 403, 404].includes(r.status), 'la ruta retirada no debe responder con éxito: ' + method + ' ' + path + ' → ' + r.status);
        }
        assert.equal((await request(path, tokens.g, method, body)).status, 404, 'ni siquiera el gerente encuentra la ruta retirada ' + method + ' ' + path);
      }
      assert.deepEqual(await rows('SELECT (SELECT COUNT(*) FROM docentes) AS d, (SELECT COUNT(*) FROM docente_asignaciones) AS a, (SELECT COUNT(*) FROM academico_historial) AS h'), before, 'las tablas y los datos históricos no cambian');
      // Las tablas siguen siendo parte del esquema esperado: db:check las exige y la restauración de respaldos las conoce.
      const check = await runScript('check-database.cjs', name);
      assert.equal(check.code, 0, check.output);
    });

    await t.test('sesiones retiradas: sus rutas no existen, su migración no se aplicó y los datos de docentes siguen intactos', async () => {
      assert.ok(Number.isInteger(historicalAssignmentId), 'la prueba anterior dejó la asignación histórica');
      for (const [method, path, body] of [['GET', '/admin/sesiones'], ['GET', '/admin/sesiones/1'], ['POST', '/admin/sesiones', { convocatoria_id: 2, titulo: 'x', fecha: '2026-05-05', hora_inicio: '09:00', hora_fin: '11:00' }],
        ['PATCH', '/admin/sesiones/1', { revision: 1, titulo: 'x' }], ['PUT', '/admin/sesiones/1/estado', { revision: 1, estado: 'cancelada', motivo: 'x' }], ['GET', '/admin/convocatorias/2/sesiones']]) {
        assert.equal((await request(path, tokens.g, method, body)).status, 404, 'ni siquiera el gerente encuentra la ruta retirada ' + method + ' ' + path);
      }
      assert.deepEqual(await rows("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sesiones'"), [], 'db:migrate ya no crea la tabla sesiones');
      assert.deepEqual(await rows("SELECT name FROM horus_migrations WHERE name='20261020-sesiones-academicas'"), [], 'ni registra la migración retirada');
      assert.equal((await rows('SELECT COUNT(*) AS n FROM docente_asignaciones WHERE id=?', [historicalAssignmentId]))[0].n, 1, 'la asignación histórica se conserva');
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
