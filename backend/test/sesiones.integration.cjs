// Horarios y sesiones académicas (20261020-sesiones-academicas) contra un MySQL 8.4 REAL y DESECHABLE: migración desde una base previa con
// datos, recuperación ante fallos parciales, restricciones de la base, HTTP real con AccessGuard, solapamientos, concurrencia, estados,
// historial, zona horaria y compatibilidad con Docentes, Ediciones, Matrículas y Reportes. No forma parte de `npm test`. Requiere
// `npm run build` (arranca backend/dist).
//
//   npm run build && node test/run-academic-isolated.cjs sesiones
//
// Barreras (las mismas que Docentes, Ediciones y Matrículas; todas antes de crear nada): SESIONES_TEST_DB=true explícito, DB_HOST de bucle
// local, @@server_uuid igual al del contenedor propio (obtenido por docker exec), servidor recién creado (Uptime < 1 h) y sin bases ajenas.
// Solo crea bases horus_sesiones_it_<hex>. Datos ficticios; jamás toca horus_db ni horus_local.
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

const backend = join(__dirname, '..');
const versions = JSON.parse(readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const MIGRATION = '20261020-sesiones-academicas';
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NEW_TABLES = ['sesiones'];
const statementsOf = name => readFileSync(join(backend, 'migrations', name + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean); // criterio de migrate.cjs

test('Sesiones: migración, restricciones, HTTP, permisos, solapamientos, concurrencia, estados, historial y compatibilidad en MySQL desechable', { timeout: 1200000 }, async t => {
  if (process.env.SESIONES_TEST_DB !== 'true') return t.skip('Requiere SESIONES_TEST_DB=true y un servidor desechable identificado por UUID.');
  assert.ok(versions.includes(MIGRATION), 'la migración de sesiones está registrada en migrate.cjs');
  assert.equal(versions.at(-1), MIGRATION, 'va al final de la sucesión');
  const campos = value => typeof value === 'string' ? JSON.parse(value) : value; // mysql2 devuelve JSON ya interpretado
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  const expectedUuid = String(process.env.SESIONES_TEST_SERVER_UUID ?? '').trim().toLowerCase();
  assert.match(expectedUuid, /^[0-9a-f-]{36}$/);
  const credentials = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS, timezone: 'Z', dateStrings: true };
  const admin = await mysql.createConnection(credentials);
  const q = async (sql, params) => (await admin.query(sql, params))[0];
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-sesiones-'));
  const apiCwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-sesiones-api-'));
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
    const createDb = async () => { const name = 'horus_sesiones_it_' + randomBytes(12).toString('hex'); assert.match(name, /^horus_sesiones_it_[0-9a-f]{24}$/); await q('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); return name; };
    const runSql = async (db, version) => { for (const sql of statementsOf(version)) await db.query(sql); };
    // Base anterior a la migración: esquema inicial + todas las migraciones previas (incluida la de docentes), registradas como lo haría migrate.cjs.
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
      return result;
    }
    // Rechazo esperado y su causa exacta (errno de mysql2): solo códigos y nombres, nunca valores.
    const rejects = async (promise, errno, name) => {
      let error = null; try { await promise; } catch (e) { error = e; }
      assert.ok(error, 'se esperaba un rechazo');
      assert.equal(error.errno, errno, 'errno ' + error.errno + ' ' + String(error.sqlMessage).slice(0, 140));
      if (name) assert.ok(String(error.sqlMessage).includes(name), 'se esperaba «' + name + '» y llegó ' + String(error.sqlMessage).slice(0, 140));
    };

    // ---------------------------------------------------------------------------------------------------------------------
    const { name, db } = await databaseBefore();
    const hash = await bcrypt.hash('Ficticia-sesiones-1', 10);
    for (const [key, rol] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]])
      await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta ficticia', key + '@sesiones.test', hash, rol]);
    await db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Excel Básico','excel-sesiones-it','Curso ficticio','curso','presencial','20 horas','publicado',NOW(),NOW()),('Seguridad Eléctrica','seguridad-sesiones-it','Capacitación ficticia','capacitacion',NULL,NULL,'publicado',NOW(),NOW()),('Redes Híbridas','redes-sesiones-it','Curso ficticio','curso','hibrida','10 horas','publicado',NOW(),NOW())");
    await db.query("INSERT INTO convocatorias (curso_id,nombre,fecha_inicio,fecha_fin,estado,capacidad) VALUES (1,'Edición anterior 1','2026-03-01','2026-03-30','cerrada',10),(2,'Edición anterior 2',NULL,NULL,'planificada',NULL)");
    await db.query("INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero,email) VALUES ('Persona','Ficticia','PE','DNI','00123456','persona@sesiones.test')");
    await db.query('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (1,1)');
    await db.query("INSERT INTO docentes (nombres,apellidos,email) VALUES ('Previo','Uno','previo1@sesiones.test'),('Previo','Dos',NULL)");
    await db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id,rol) VALUES (1,1,'principal'),(2,1,'participante')");
    await db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,actor_rol,campos,revision) VALUES ('convocatoria',1,'creacion','panel',1,'GERENTE_GENERAL',JSON_ARRAY('nombre'),1),('docente',1,'creacion','panel',1,'GERENTE_GENERAL',JSON_ARRAY('nombres'),1),('asignacion_docente',1,'sustitucion','panel',1,'GERENTE_GENERAL',JSON_ARRAY(),1)");

    await t.test('migración desde una base previa con datos: db:check la exige, se aplica una sola vez y no pierde ni altera nada', async () => {
      const pending = await runScript('check-database.cjs', name);
      assert.equal(pending.code, 1); assert.ok(pending.output.includes('sesiones.id: falta'), 'db:check señala la tabla que falta');
      assert.ok(pending.output.includes('academico_historial.entidad: tipo distinto') && pending.output.includes('academico_historial.operacion: tipo distinto'), 'y los ENUM del historial sin ampliar');
      const before = await snapshot(db, ['horus_migrations']);
      for (const table of ['admin_users', 'cursos', 'convocatorias', 'estudiantes', 'matriculas', 'docentes', 'docente_asignaciones', 'academico_historial']) assert.ok(before[table], table);
      const applied = await runScript('migrate.cjs', name);
      assert.equal(applied.code, 0, applied.output);
      const schema = await runScript('check-database.cjs', name);
      assert.equal(schema.code, 0, schema.output); assert.match(schema.output, /Esquema compatible/);
      const after = await snapshot(db, ['horus_migrations', ...NEW_TABLES]);
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no se crean ni eliminan otras tablas');
      for (const table of Object.keys(before)) {
        const expectedDdl = table === 'academico_historial' ? before[table].ddl.replace("'asignacion_docente')", "'asignacion_docente','sesion')").replace("'sustitucion')", "'sustitucion','reprogramacion')") : before[table].ddl;
        assert.equal(after[table].ddl, expectedDdl, table + ': definición sin cambios (salvo los dos ENUM ampliados del historial)');
        assert.equal(after[table].rows, before[table].rows, table + ': filas idénticas');
      }
      assert.equal((await db.query('SELECT COUNT(*) AS n FROM sesiones'))[0][0].n, 0, 'sesiones nace vacía: la migración no inserta datos');
      const again = await runScript('migrate.cjs', name);
      assert.equal(again.code, 0, again.output);
      const [registered] = await db.query('SELECT name FROM horus_migrations ORDER BY name');
      assert.deepEqual(registered.map(r => r.name), [...versions].sort(), 'cada migración registrada una sola vez');
      assert.deepEqual(await snapshot(db, ['horus_migrations', ...NEW_TABLES]), after, 'repetir db:migrate no cambia nada');
    });

    await t.test('estructura real: InnoDB, claves RESTRICT incluida la compuesta, únicos y CHECK aplicados; TIME y DATE sin zona horaria', async () => {
      const [tables] = await db.query("SELECT TABLE_NAME AS t, ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)", [NEW_TABLES]);
      assert.deepEqual(tables.map(r => [r.t, r.e, r.c]), [['sesiones', 'InnoDB', 'utf8mb4_unicode_ci']]);
      const [fks] = await db.query("SELECT k.CONSTRAINT_NAME AS c, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS cols, k.REFERENCED_TABLE_NAME AS r, GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS rc, rc.DELETE_RULE AS d, rc.UPDATE_RULE AS u FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND rc.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='sesiones' AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY 1,3,5,6 ORDER BY 1");
      assert.deepEqual(fks.map(r => [r.c, r.cols, r.r, r.rc, r.d, r.u].join(' ')), [
        'sesiones_asignacion_fk asignacion_id,convocatoria_id docente_asignaciones id,convocatoria_id RESTRICT RESTRICT', 'sesiones_convocatoria_fk convocatoria_id convocatorias id RESTRICT RESTRICT']);
      const [uniques] = await db.query("SELECT INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sesiones' AND NON_UNIQUE=0 AND INDEX_NAME<>'PRIMARY' GROUP BY 1 ORDER BY 1");
      assert.deepEqual(uniques.map(r => r.i + '(' + r.cols + ')'), ['sesiones_id_edicion_uq(id,convocatoria_id)'], 'único solo para la futura clave compuesta de Asistencia: ninguna clave impide sesiones simultáneas');
      const [checks] = await db.query("SELECT CONSTRAINT_NAME AS c, ENFORCED AS e FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK' AND TABLE_NAME='sesiones' ORDER BY 1");
      assert.deepEqual(checks.map(r => r.c + '=' + r.e), ['sesiones_cancelacion_chk=YES', 'sesiones_enlace_chk=YES', 'sesiones_fecha_chk=YES', 'sesiones_horas_chk=YES', 'sesiones_modalidad_chk=YES', 'sesiones_revision_chk=YES', 'sesiones_texto_chk=YES', 'sesiones_titulo_chk=YES']);
      const [types] = await db.query("SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sesiones' AND COLUMN_NAME IN ('fecha','hora_inicio','hora_fin') ORDER BY 1");
      assert.deepEqual(types.map(r => r.c + ':' + r.t), ['fecha:date', 'hora_fin:time', 'hora_inicio:time'], 'hora local de Lima: ni TIMESTAMP ni DATETIME, que dependerían de la zona');
      const [generated] = await db.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sesiones' AND (EXTRA LIKE 'STORED GENERATED%' OR EXTRA LIKE 'VIRTUAL GENERATED%')");
      assert.equal(generated[0].n, 0);
      const [personal] = await db.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sesiones' AND COLUMN_NAME IN ('password','rol','email','telefono','doc_numero','docente_id','estudiante_id')");
      assert.equal(personal[0].n, 0, 'la sesión no copia datos personales ni vincula estudiantes (la asistencia será otro módulo)');
    });

    await t.test('restricciones de la base rechazan datos inválidos aunque se escriba por SQL directo', async () => {
      const ins = (cols, vals) => db.query('INSERT INTO sesiones (convocatoria_id,titulo,fecha,hora_inicio,hora_fin,modalidad' + (cols ? ',' + cols : '') + ") VALUES (1,'Sesión','2026-11-05','14:00:00','16:00:00','presencial'" + (vals ? ',' + vals : '') + ')');
      const bad = (sql, errno, constraint) => rejects(db.query(sql), errno, constraint);
      await ins('', ''); // válida
      const base = (set) => 'INSERT INTO sesiones (convocatoria_id,titulo,fecha,hora_inicio,hora_fin,modalidad,lugar,enlace_url,estado,cancelada_at,cancelacion_motivo,revision) VALUES ' + set;
      await bad(base("(1,'   ','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_titulo_chk');
      await bad(base("(1,'X','2026-11-05','16:00:00','16:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_horas_chk');
      await bad(base("(1,'X','2026-11-05','16:00:00','14:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_horas_chk');
      await bad(base("(1,'X','2026-11-05','14:00:30','16:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_horas_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','24:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_horas_chk');
      await bad(base("(1,'X','2026-11-05','23:00:00','23:59:30','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_horas_chk');
      await bad(base("(1,'X','2026-11-05','-01:00:00','02:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_horas_chk');
      await bad(base("(1,'X','1999-12-31','14:00:00','16:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_fecha_chk');
      await bad(base("(1,'X','2101-01-01','14:00:00','16:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_fecha_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','presencial',NULL,'https://reunion.test/a','programada',NULL,NULL,1)"), 3819, 'sesiones_modalidad_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','virtual','Aula 3',NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_modalidad_chk');
      await db.query(base("(1,'Híbrida','2026-11-06','14:00:00','16:00:00','hibrida','Aula 3','https://reunion.test/a','programada',NULL,NULL,1)"));
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','virtual',NULL,'http://reunion.test/a','programada',NULL,NULL,1)"), 3819, 'sesiones_enlace_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','virtual',NULL,'https://reunion.test/a b','programada',NULL,NULL,1)"), 3819, 'sesiones_enlace_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','virtual',NULL,'javascript:alert(1)','programada',NULL,NULL,1)"), 3819, 'sesiones_enlace_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','presencial','   ',NULL,'programada',NULL,NULL,1)"), 3819, 'sesiones_texto_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'cancelada',NULL,NULL,1)"), 3819, 'sesiones_cancelacion_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'cancelada',NOW(3),'  ',1)"), 3819, 'sesiones_cancelacion_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'programada',NOW(3),NULL,1)"), 3819, 'sesiones_cancelacion_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'realizada',NULL,'Motivo',1)"), 3819, 'sesiones_cancelacion_chk');
      await db.query(base("(1,'Cancelada','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'cancelada',NOW(3),'Motivo ficticio',1)"));
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'programada',NULL,NULL,0)"), 3819, 'sesiones_revision_chk');
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'borrada',NULL,NULL,1)"), 1265);
      await bad(base("(1,'X','2026-11-05','14:00:00','16:00:00','otra',NULL,NULL,'programada',NULL,NULL,1)"), 1265);
      // Referencias: edición y asignación inexistentes, y asignación de OTRA edición (la clave compuesta lo impide).
      await bad(base("(999999,'X','2026-11-05','14:00:00','16:00:00','presencial',NULL,NULL,'programada',NULL,NULL,1)"), 1452, 'sesiones_convocatoria_fk');
      await db.query("INSERT INTO docente_asignaciones (docente_id,convocatoria_id) VALUES (1,2)");
      const [[other]] = await db.query('SELECT id FROM docente_asignaciones WHERE convocatoria_id=2');
      await rejects(db.query("INSERT INTO sesiones (convocatoria_id,asignacion_id,titulo,fecha,hora_inicio,hora_fin,modalidad) VALUES (1,?,'X','2026-11-07','14:00:00','16:00:00','presencial')", [other.id]), 1452, 'sesiones_asignacion_fk');
      await db.query("INSERT INTO sesiones (convocatoria_id,asignacion_id,titulo,fecha,hora_inicio,hora_fin,modalidad) VALUES (2,?,'Con docente','2026-11-07','14:00:00','16:00:00','presencial')", [other.id]);
      await db.query("INSERT INTO sesiones (convocatoria_id,asignacion_id,titulo,fecha,hora_inicio,hora_fin,modalidad) VALUES (1,NULL,'Sin docente','2026-11-08','14:00:00','16:00:00','presencial')");
      // Nada se borra: ni la edición, ni la asignación, ni el docente mientras haya sesiones.
      await db.query("INSERT INTO convocatorias (curso_id,nombre,estado) VALUES (3,'Edición solo con sesión','planificada')");
      const [[lone]] = await db.query("SELECT id FROM convocatorias WHERE nombre='Edición solo con sesión'");
      await db.query("INSERT INTO sesiones (convocatoria_id,titulo,fecha,hora_inicio,hora_fin,modalidad) VALUES (?,'Única','2026-11-09','14:00:00','16:00:00','hibrida')", [lone.id]);
      await rejects(db.query('DELETE FROM convocatorias WHERE id=?', [lone.id]), 1451, 'sesiones_convocatoria_fk');
      await rejects(db.query('DELETE FROM docente_asignaciones WHERE id=?', [other.id]), 1451, 'sesiones_asignacion_fk');
      await rejects(db.query('DELETE FROM docentes WHERE id=1'), 1451);
      await rejects(db.query('UPDATE sesiones SET convocatoria_id=1 WHERE titulo=?', ['Con docente']), 1452, 'sesiones_asignacion_fk');
      // El historial acepta los valores nuevos y sigue rechazando cualquier otro.
      await db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,campos,revision) VALUES ('sesion',1,'reprogramacion','panel',1,JSON_ARRAY('fecha'),2)");
      await rejects(db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,campos,revision) VALUES ('sesiones',1,'creacion','panel',1,JSON_ARRAY(),1)"), 1265);
      await rejects(db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,campos,revision) VALUES ('sesion',1,'cancelacion','panel',1,JSON_ARRAY(),1)"), 1265);
      // Limitación conocida y documentada: MySQL no tiene restricciones de exclusión por intervalos. SQL directo PUEDE insertar sesiones
      // solapadas; solo el servicio (con bloqueos) las impide. Aquí se comprueba para no afirmar una garantía que la base no da.
      await db.query("INSERT INTO sesiones (convocatoria_id,titulo,fecha,hora_inicio,hora_fin,modalidad) VALUES (1,'Solape por SQL 1','2030-01-10','10:00:00','12:00:00','presencial'),(1,'Solape por SQL 2','2030-01-10','11:00:00','13:00:00','presencial')");
      // Se retira todo lo escrito por SQL para dejar la base lista para la prueba HTTP (solo filas de esta prueba, en su base propia).
      await db.query('DELETE FROM academico_historial WHERE entidad = ?', ['sesion']); await db.query('DELETE FROM sesiones'); await db.query('DELETE FROM docente_asignaciones WHERE convocatoria_id = 2'); await db.query('DELETE FROM convocatorias WHERE id = ?', [lone.id]);
    });

    await t.test('fallo parcial: cada prefijo de la migración se completa al reintentar y db:check lo detecta antes', async () => {
      const statements = statementsOf(MIGRATION);
      assert.equal(statements.length, 3); assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS `sesiones` \(/);
      assert.match(statements[1], /^ALTER TABLE `academico_historial` MODIFY `entidad` ENUM\(/); assert.match(statements[2], /^ALTER TABLE `academico_historial` MODIFY `operacion` ENUM\(/);
      for (let applied = 1; applied < statements.length; applied++) {
        const partial = await databaseBefore();
        await partial.db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,estado,createdAt,updatedAt) VALUES ('Curso','parcial-" + applied + "','x','curso','publicado',NOW(),NOW())");
        const before = await snapshot(partial.db, ['horus_migrations']);
        for (const statement of statements.slice(0, applied)) await partial.db.query(statement);
        assert.equal((await runScript('check-database.cjs', partial.name)).code, 1, 'db:check detecta la migración incompleta (' + applied + '/3)');
        assert.equal((await runScript('migrate.cjs', partial.name)).code, 0);
        const check = await runScript('check-database.cjs', partial.name);
        assert.equal(check.code, 0, check.output);
        const after = await snapshot(partial.db, ['horus_migrations', ...NEW_TABLES, 'academico_historial']);
        const { academico_historial, ...rest } = before;
        assert.deepEqual(after, rest, 'los datos previos no cambian en la recuperación');
        assert.equal((await snapshot(partial.db, ['horus_migrations', ...NEW_TABLES])).academico_historial.rows, academico_historial.rows, 'el historial previo conserva sus filas');
      }
      // Una tabla preexistente con otra forma no se corrige en silencio: CREATE TABLE IF NOT EXISTS la omite y db:check la rechaza.
      const alien = await databaseBefore();
      await alien.db.query('CREATE TABLE `sesiones` (`id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY, `titulo` VARCHAR(50) NOT NULL) ENGINE=InnoDB');
      await runScript('migrate.cjs', alien.name);
      const rejected = await runScript('check-database.cjs', alien.name);
      assert.equal(rejected.code, 1); assert.ok(rejected.output.includes('sesiones.convocatoria_id: falta') || rejected.output.includes('sesiones.titulo: tipo distinto'), rejected.output);
    });

    // ---- HTTP real -----------------------------------------------------------------------------------------------------
    // El servidor desechable y el proceso de la API se ponen en zonas horarias DISTINTAS de Lima y entre sí: nada de lo guardado ni
    // devuelto puede depender de ellas. (SET GLOBAL solo afecta a este contenedor propio y desechable.)
    await q("SET GLOBAL time_zone = '+13:00'");
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const apiPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    api = fork(join(__dirname, 'fixtures/access-guard-app.cjs'), [], { cwd: apiCwd, windowsHide: true, silent: true,
      execArgv: ['-r', join(__dirname, 'isolate-env.cjs')], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TZ: 'Pacific/Auckland', NODE_ENV: 'development', DB_HOST: credentials.host, DB_PORT: String(credentials.port), DB_USER: credentials.user, DB_PASS: credentials.password, DB_NAME: name,
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
    for (const key of ['g', 'c', 's', 'b']) { const r = await request('/admin/login', null, 'POST', { email: key + '@sesiones.test', password: 'Ficticia-sesiones-1' }); assert.equal(r.status, 200); tokens[key] = r.body.token; }
    const D = '/admin/docentes', A = '/admin/asignaciones-docentes', E = '/admin/convocatorias', S = '/admin/sesiones';
    const rows = async (sql, params) => (await db.query(sql, params))[0];
    const counts = () => rows('SELECT (SELECT COUNT(*) FROM matriculas) AS m, (SELECT COUNT(*) FROM docente_asignaciones) AS a, (SELECT COUNT(*) FROM docentes) AS d, (SELECT COUNT(*) FROM estudiantes) AS e, (SELECT COUNT(*) FROM convocatorias) AS c');

    // Fixtures de la API: docentes y ediciones nuevos para cada prueba (así los horarios de una no chocan con los de otra).
    let seq = 0;
    const teacher = async (extra = {}) => (await request(D, tokens.g, 'POST', { nombres: 'Docente' + (++seq), apellidos: 'Sesiones', doc_numero: String(80000000 + seq), email: 'docente' + seq + '@sesiones.test', telefono: '987 000 ' + String(100 + seq), ...extra })).body.item;
    const edition = async (nombre, curso_id = 1, open = false) => {
      const r = await request(E, tokens.g, 'POST', { curso_id, nombre, fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 }); assert.equal(r.status, 201, r.text);
      if (!open) return r.body.item;
      const opened = await request(E + '/' + r.body.item.id + '/apertura', tokens.g, 'PUT', { revision: r.body.item.revision }); assert.equal(opened.status, 200, opened.text); return opened.body.item; // abierta: admite matrículas y cierre
    };
    const assign = async (docente, ed, rol) => { const r = await request(A, tokens.g, 'POST', { docente_id: docente.id, convocatoria_id: ed.id, ...(rol ? { rol } : {}) }); assert.equal(r.status, 201, r.text); return r.body.item; };
    const payload = (ed, patch = {}) => ({ convocatoria_id: ed.id ?? ed, titulo: 'Clase ficticia', fecha: '2026-11-05', hora_inicio: '14:00', hora_fin: '16:00', ...patch });
    const create = (body, token = tokens.g) => request(S, token, 'POST', body);
    const ok = async (promise, status = 201) => { const r = await promise; assert.equal(r.status, status, r.text); return r.body.item; };
    const patch = (id, body, token = tokens.g) => request(S + '/' + id, token, 'PATCH', body);
    const state = (id, body, token = tokens.g) => request(S + '/' + id + '/estado', token, 'PUT', body);
    const get = (id, token = tokens.g) => request(S + '/' + id, token);
    // Equipo: docente asignado y activo en una edición nueva.
    const crew = async (nombre, curso_id = 1, open = false) => { const ed = await edition(nombre, curso_id, open); const doc = await teacher(); const asg = await assign(doc, ed); return { ed, doc, asg }; };
    const nonCancelled = (fecha, docente_id) => rows("SELECT s.id, s.hora_inicio AS i, s.hora_fin AS f FROM sesiones s JOIN docente_asignaciones a ON a.id=s.asignacion_id WHERE a.docente_id=? AND s.fecha=? AND s.estado<>'cancelada' ORDER BY 2", [docente_id, fecha]);
    const noOverlap = list => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(list[i].f <= list[j].i || list[j].f <= list[i].i, 'sesiones solapadas aceptadas: ' + JSON.stringify([list[i], list[j]])); };

    await t.test('permisos: sin JWT 401, cuenta básica y secretaría 403 en las 6 rutas; gerente y coordinación pasan la guard', async () => {
      const routes = [['GET', S], ['GET', S + '/1'], ['GET', E + '/1/sesiones'], ['POST', S, {}], ['PATCH', S + '/1', { revision: 1, titulo: 'X' }], ['PUT', S + '/1/estado', { revision: 1, estado: 'realizada' }]];
      const before = await rows('SELECT (SELECT COUNT(*) FROM sesiones) AS s, (SELECT COUNT(*) FROM academico_historial) AS h');
      for (const [method, path, body] of routes) {
        assert.equal((await request(path, null, method, body)).status, 401, 'sin sesión ' + method + ' ' + path);
        assert.equal((await request(path, 'basura', method, body)).status, 401, 'JWT inválido ' + method + ' ' + path);
        for (const key of ['b', 's']) assert.equal((await request(path, tokens[key], method, body)).status, 403, key + ' ' + method + ' ' + path);
      }
      assert.deepEqual(await rows('SELECT (SELECT COUNT(*) FROM sesiones) AS s, (SELECT COUNT(*) FROM academico_historial) AS h'), before, 'las denegaciones no escriben nada');
      for (const key of ['g', 'c']) for (const [method, path, body] of routes) assert.ok(![401, 403].includes((await request(path, tokens[key], method, body)).status), key + ' ' + method + ' ' + path);
      for (const path of ['/sesiones', '/sesiones/1', '/convocatorias/1/sesiones']) assert.ok([401, 404].includes((await request(path)).status), 'no existe ninguna ruta pública de sesiones: ' + path);
    });

    let ed1, doc1, asg1, first;
    await t.test('alta válida: hora de Lima guardada tal cual (sin zona), instante UTC calculado, docente resumido y historial sin datos personales', async () => {
      ({ ed: ed1, doc: doc1, asg: asg1 } = await crew('Edición con sesiones'));
      first = await ok(create(payload(ed1, { titulo: '  Introducción   al curso ', docente_id: doc1.id, lugar: ' Aula  3 ', observaciones: ' Traer laptop ' }), tokens.c));
      assert.deepEqual([first.titulo, first.fecha, first.hora_inicio, first.hora_fin, first.zona_horaria, first.estado, first.revision, first.modalidad, first.lugar, first.observaciones],
        ['Introducción al curso', '2026-11-05', '14:00', '16:00', 'America/Lima', 'programada', 1, 'presencial', 'Aula 3', 'Traer laptop'], 'modalidad heredada del curso; textos normalizados');
      assert.equal(first.inicio_utc, '2026-11-05T19:00:00.000Z', '14:00 en Lima (UTC-5) = 19:00 UTC, aunque la API corra en Pacific/Auckland y MySQL en +13:00');
      assert.equal(first.fin_utc, '2026-11-05T21:00:00.000Z');
      const [stored] = await rows('SELECT fecha, hora_inicio, hora_fin, asignacion_id, estado, cancelada_at FROM sesiones WHERE id=?', [first.id]);
      assert.deepEqual(stored, { fecha: '2026-11-05', hora_inicio: '14:00:00', hora_fin: '16:00:00', asignacion_id: asg1.id, estado: 'programada', cancelada_at: null }, 'la base guarda la hora de pared de Lima, no un instante desplazado');
      assert.deepEqual(Object.keys(first.docente).sort(), ['activo', 'apellidos', 'asignacion_estado', 'asignacion_id', 'especialidad', 'id', 'nombres', 'rol', 'vigente'], 'resumen del docente sin documento, correo ni teléfono');
      assert.deepEqual([first.docente.vigente, first.docente.asignacion_estado, first.docente_id, first.fuera_de_periodo], [true, 'activa', doc1.id, false]);
      assert.equal(first.convocatoria.curso.titulo, 'Excel Básico');
      const history = await rows("SELECT operacion,campos,actor_rol,revision,estado_nuevo FROM academico_historial WHERE entidad='sesion' AND entidad_id=?", [first.id]);
      assert.equal(history.length, 1); assert.deepEqual([history[0].operacion, history[0].actor_rol, history[0].revision, history[0].estado_nuevo], ['creacion', 'COORDINADORA_INSTITUCIONAL', 1, 'programada']);
      assert.deepEqual(campos(history[0].campos), ['convocatoria_id', 'titulo', 'fecha', 'hora_inicio', 'hora_fin', 'modalidad', 'asignacion_id', 'lugar', 'observaciones']);
      assert.ok(!JSON.stringify(history).match(/Introducción|Aula|laptop|docente\d|987/i), 'el historial guarda nombres de campos, nunca valores ni datos personales');
      const minimal = await ok(create(payload(ed1, { fecha: '2026-11-06', hora_inicio: '08:00', hora_fin: '23:59', titulo: 'Mínima' })));
      assert.deepEqual([minimal.docente, minimal.docente_id, minimal.lugar, minimal.enlace_url, minimal.observaciones, minimal.asignacion_id], [null, null, null, null, null, null], 'el docente y el lugar son opcionales');
      assert.equal(minimal.fin_utc, '2026-11-07T04:59:00.000Z', '23:59 Lima ya es el día siguiente en UTC');
      const outside = await ok(create(payload(ed1, { fecha: '2026-12-15', titulo: 'Fuera del periodo' })));
      assert.equal(outside.fuera_de_periodo, true, 'aviso (no rechazo) si cae fuera de las fechas de la edición');
      assert.equal((await ok(request(S + '/' + first.id, tokens.g), 200)).id, first.id);
    });

    await t.test('validación: fechas, horas, intervalos, relaciones, modalidad y campos desconocidos', async () => {
      const { ed, doc } = await crew('Validaciones');
      const before = (await rows('SELECT COUNT(*) AS n FROM sesiones'))[0].n;
      const base = payload(ed, { docente_id: doc.id });
      const status = async (patchBody, expected, label = JSON.stringify(patchBody)) => assert.equal((await create({ ...base, ...patchBody })).status, expected, label);
      for (const fecha of ['2026-02-30', '2026-13-01', '2026-1-1', '05/11/2026', '1999-12-31', '2101-01-01', '2026-11-05T10:00:00Z', '', 20261105, null]) await status({ fecha }, 400, 'fecha ' + String(fecha));
      for (const hora of ['24:00', '9:00', '14:60', '14:00:00', '1400', '', 1400, null, ' 14:00']) { await status({ hora_inicio: hora }, 400, 'inicio ' + String(hora)); await status({ hora_fin: hora }, 400, 'fin ' + String(hora)); }
      for (const [inicio, fin] of [['16:00', '14:00'], ['14:00', '14:00'], ['23:59', '23:59'], ['00:00', '00:00']]) await status({ hora_inicio: inicio, hora_fin: fin }, 422, 'intervalo ' + inicio + '-' + fin);
      for (const campo of ['titulo', 'fecha', 'hora_inicio', 'hora_fin', 'convocatoria_id']) { const copy = { ...base }; delete copy[campo]; assert.equal((await create(copy)).status, 400, 'falta ' + campo); }
      for (const extra of [{ estado: 'cancelada' }, { revision: 3 }, { id: 99 }, { asignacion_id: 1 }, { cancelada_at: '2026-01-01' }, { cancelacion_motivo: 'x' }, { motivo: 'x' }, { zona_horaria: 'UTC' }, { inicio_utc: '2026-11-05T19:00:00Z' }, { rol: 'GERENTE_GENERAL' }])
        await status(extra, 400, JSON.stringify(extra));
      for (const bad of [{ titulo: '' }, { titulo: '   ' }, { titulo: 'x'.repeat(161) }, { lugar: 'x'.repeat(201) }, { observaciones: 'x'.repeat(501) }, { modalidad: 'remota' }, { convocatoria_id: String(ed.id) }, { convocatoria_id: 0 }, { docente_id: String(doc.id) }, { docente_id: 0 }, { docente_id: null },
        { enlace_url: 'http://reunion.test/a' }, { enlace_url: 'ftp://reunion.test' }, { enlace_url: 'javascript:alert(1)' }, { enlace_url: 'https://reunion.test/a b' }, { enlace_url: 'https://' + 'a'.repeat(2050) }, { lugar: 5 }]) await status(bad, 400);
      await status({ convocatoria_id: 999999 }, 404, 'edición inexistente');
      await status({ docente_id: 999999 }, 404, 'docente inexistente');
      await status({ modalidad: 'presencial', enlace_url: 'https://reunion.test/a' }, 422, 'presencial con enlace');
      await status({ modalidad: 'virtual', lugar: 'Aula 3' }, 422, 'virtual con lugar físico');
      const legacy = await edition('Sin modalidad de curso', 2);
      assert.equal((await create(payload(legacy))).status, 422, 'el curso no tiene modalidad y no se indicó');
      const fixed = await ok(create(payload(legacy, { modalidad: 'virtual', enlace_url: ' https://reunion.test/sala-1 ' })));
      assert.deepEqual([fixed.modalidad, fixed.enlace_url, fixed.lugar], ['virtual', 'https://reunion.test/sala-1', null]);
      const hybrid = await edition('Híbrida', 3); const mixed = await ok(create(payload(hybrid, { lugar: 'Aula 1', enlace_url: 'https://reunion.test/h' })));
      assert.deepEqual([mixed.modalidad, mixed.lugar], ['hibrida', 'Aula 1'], 'híbrida admite lugar y enlace');
      // Docente: inactivo, sin asignación, asignación retirada y asignación de otra edición.
      const idle = await teacher(); await assign(idle, await edition('Otra edición del docente'));
      const none = await create({ ...base, docente_id: idle.id }); assert.equal(none.status, 409, 'docente asignado solo a otra edición'); assert.ok(none.body.message && !/idle|Docente\d/.test(none.text));
      const off = await teacher(); await assign(off, ed); await request(D + '/' + off.id + '/estado', tokens.g, 'PUT', { revision: off.revision, activo: false });
      assert.equal((await create({ ...base, docente_id: off.id })).status, 409, 'docente inactivo');
      const gone = await teacher(); const asgGone = await assign(gone, ed); await request(A + '/' + asgGone.id + '/retiro', tokens.g, 'PUT', { revision: asgGone.revision, motivo: 'Renuncia' });
      assert.equal((await create({ ...base, docente_id: gone.id })).status, 409, 'asignación retirada');
      // Edición cancelada y archivada.
      const cancelled = await edition('Cancelada'); await request(E + '/' + cancelled.id + '/cierre', tokens.g, 'PUT', { revision: cancelled.revision, estado: 'cancelada' });
      assert.equal((await create(payload(cancelled))).status, 409, 'edición cancelada');
      assert.equal((await rows('SELECT COUNT(*) AS n FROM sesiones'))[0].n, Number(before) + 2, 'solo las dos altas válidas de esta prueba (la virtual y la híbrida)');
    });

    await t.test('solapamientos: [inicio, fin) por docente (también entre ediciones) y por edición; consecutivas permitidas; canceladas no ocupan', async () => {
      const { ed, doc } = await crew('Solapamientos');
      const other = await edition('Otra edición mismo docente'); await assign(doc, other);
      const colleague = await teacher(); await assign(colleague, ed); await assign(colleague, other);
      const day = '2027-03-10';
      const at = (e, inicio, fin, extra = {}) => create(payload(e, { fecha: day, hora_inicio: inicio, hora_fin: fin, docente_id: doc.id, ...extra }));
      const A1 = await ok(at(ed, '14:00', '16:00'));
      const conflict = async (promise, kinds, label) => { const r = await promise; assert.equal(r.status, 409, label + ' ' + r.text); assert.equal(r.body.codigo, 'CONFLICTO_HORARIO', label); assert.deepEqual([...new Set(r.body.conflictos.flatMap(c => c.tipo))].sort(), kinds, label); return r; };
      await ok(at(ed, '16:00', '18:00')); // consecutiva: termina 16:00 y empieza 16:00
      await ok(at(ed, '12:00', '14:00')); // consecutiva por delante
      await conflict(at(ed, '15:00', '17:00'), ['docente', 'edicion'], 'solape parcial al final');
      await conflict(at(ed, '13:00', '15:00'), ['docente', 'edicion'], 'solape parcial al inicio');
      await conflict(at(ed, '14:30', '15:30'), ['docente', 'edicion'], 'contenida');
      await conflict(at(ed, '11:00', '19:00'), ['docente', 'edicion'], 'que contiene a otras');
      await conflict(at(ed, '14:00', '16:00'), ['docente', 'edicion'], 'idéntica');
      const cross = await conflict(at(other, '15:00', '17:00'), ['docente'], 'mismo docente en otra edición');
      assert.ok(cross.body.conflictos.every(c => c.convocatoria_id === ed.id) && !cross.text.includes(doc.nombres), 'el aviso identifica la sesión en conflicto, sin datos del docente');
      await conflict(create(payload(ed, { fecha: day, hora_inicio: '14:30', hora_fin: '15:30', docente_id: colleague.id })), ['edicion'], 'misma edición, otro docente');
      await conflict(create(payload(ed, { fecha: day, hora_inicio: '14:30', hora_fin: '15:30' })), ['edicion'], 'misma edición, sin docente');
      await ok(create(payload(other, { fecha: day, hora_inicio: '14:30', hora_fin: '15:30', docente_id: colleague.id })), 201); // otra edición y otro docente: sin conflicto
      await ok(create(payload(ed, { fecha: '2027-03-11', hora_inicio: '14:00', hora_fin: '16:00', docente_id: doc.id }))); // otro día
      await ok(at(other, '18:00', '19:00')); // consecutiva con la de 16-18 de otra edición del mismo docente
      // Una sesión cancelada no ocupa el horario; una realizada sí.
      const target = await ok(at(other, '07:00', '08:00'));
      assert.equal((await state(target.id, { revision: 1, estado: 'cancelada', motivo: 'Feriado' })).status, 200);
      await ok(at(other, '07:00', '08:00'));
      const past = await ok(create(payload(ed, { fecha: '2020-05-04', hora_inicio: '09:00', hora_fin: '10:00', docente_id: doc.id })));
      await ok(state(past.id, { revision: 1, estado: 'realizada' }), 200);
      await conflict(create(payload(other, { fecha: '2020-05-04', hora_inicio: '09:30', hora_fin: '10:30', docente_id: doc.id })), ['docente'], 'una sesión realizada sigue ocupando su horario');
      assert.ok(A1.id > 0);
      const accepted = await nonCancelled(day, doc.id);
      assert.equal(accepted.length, 5, 'aceptadas: 12-14, 14-16, 16-18, 18-19 y la segunda de 07-08 (la cancelada no cuenta)');
      noOverlap(accepted);
    });

    await t.test('concurrencia: solicitudes simultáneas por el mismo docente y horario dejan una sola sesión, sin errores internos', async () => {
      const doc = await teacher(); const eds = [];
      for (let i = 0; i < 4; i++) { const e = await edition('Carrera docente ' + i); await assign(doc, e); eds.push(e); }
      const day = '2027-04-05';
      // 1) Mismo docente, mismo horario, cuatro ediciones distintas y dos solicitudes por edición: ocho a la vez.
      const raced = await Promise.all(eds.flatMap(e => [1, 2].map(() => create(payload(e, { fecha: day, hora_inicio: '09:00', hora_fin: '11:00', docente_id: doc.id })))));
      assert.deepEqual(raced.map(r => r.status).sort(), [201, 409, 409, 409, 409, 409, 409, 409], raced.map(r => r.status).join());
      for (const r of raced.filter(x => x.status === 409)) assert.equal(r.body.codigo, 'CONFLICTO_HORARIO');
      assert.equal((await nonCancelled(day, doc.id)).length, 1, 'una sola sesión del docente en ese horario');
      // 2) Ventanas que se solapan entre sí en cadena (9-11, 9:30-11:30, …): lo aceptado nunca se solapa.
      const day2 = '2027-04-06';
      const windows = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30'].map((inicio, i) => [inicio, String(Number(inicio.slice(0, 2)) + 2).padStart(2, '0') + inicio.slice(2), eds[i % 4]]);
      const chain = await Promise.all(windows.map(([inicio, fin, e]) => create(payload(e, { fecha: day2, hora_inicio: inicio, hora_fin: fin, docente_id: doc.id }))));
      assert.ok(chain.every(r => [201, 409].includes(r.status)), chain.map(r => r.status).join());
      assert.ok(chain.some(r => r.status === 201)); noOverlap(await nonCancelled(day2, doc.id));
      // 3) Misma edición sin docente: cinco a la vez.
      const solo = await edition('Carrera de edición');
      const same = await Promise.all([1, 2, 3, 4, 5].map(() => create(payload(solo, { fecha: day, hora_inicio: '09:00', hora_fin: '10:00' }))));
      assert.deepEqual(same.map(r => r.status).sort(), [201, 409, 409, 409, 409]);
      // 4) Reprogramaciones simultáneas de dos sesiones del mismo docente al mismo horario libre.
      const a = await ok(create(payload(eds[0], { fecha: '2027-04-07', hora_inicio: '08:00', hora_fin: '09:00', docente_id: doc.id })));
      const b = await ok(create(payload(eds[1], { fecha: '2027-04-07', hora_inicio: '12:00', hora_fin: '13:00', docente_id: doc.id })));
      const moves = await Promise.all([patch(a.id, { revision: 1, hora_inicio: '15:00', hora_fin: '16:00', motivo: 'Cambio de agenda' }), patch(b.id, { revision: 1, hora_inicio: '15:00', hora_fin: '16:00', motivo: 'Cambio de agenda' })]);
      assert.deepEqual(moves.map(r => r.status).sort(), [200, 409]); noOverlap(await nonCancelled('2027-04-07', doc.id));
      // 5) Misma revisión, dos cambios distintos: un ganador y un 409 (cambio concurrente); la revisión obsoleta se rechaza.
      const c = await ok(create(payload(eds[2], { fecha: '2027-04-08', docente_id: doc.id })));
      const edits = await Promise.all(['Primero', 'Segundo'].map(titulo => patch(c.id, { revision: 1, titulo })));
      assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
      assert.equal((await patch(c.id, { revision: 1, observaciones: 'Obsoleta' })).status, 409, 'revisión obsoleta');
      assert.equal((await get(c.id)).body.item.revision, 2);
      const stateRace = await Promise.all([state(c.id, { revision: 2, estado: 'cancelada', motivo: 'Cancelada' }), patch(c.id, { revision: 2, hora_inicio: '17:00', hora_fin: '18:00', motivo: 'Mover' })]);
      assert.deepEqual(stateRace.map(r => r.status).sort(), [200, 409], 'cancelar y reprogramar a la vez: un ganador');
      // 6) Programar contra desactivar al docente, retirar su asignación y cancelar o archivar la edición: nunca un error interno.
      const deact = await teacher(); const edD = await edition('Carrera desactivación'); const asgD = await assign(deact, edD);
      assert.ok(asgD.id > 0);
      const r1 = await Promise.all([create(payload(edD, { fecha: '2027-04-09', docente_id: deact.id })), request(D + '/' + deact.id + '/estado', tokens.g, 'PUT', { revision: deact.revision, activo: false })]);
      assert.ok([201, 409].includes(r1[0].status) && r1[1].status === 200, r1.map(r => r.status).join());
      const afterOff = await create(payload(edD, { fecha: '2027-04-10', docente_id: deact.id })); assert.equal(afterOff.status, 409);
      const ret = await teacher(); const edR = await edition('Carrera retiro'); const asgR = await assign(ret, edR);
      const r2 = await Promise.all([create(payload(edR, { fecha: '2027-04-09', docente_id: ret.id })), request(A + '/' + asgR.id + '/retiro', tokens.g, 'PUT', { revision: asgR.revision, motivo: 'Renuncia' })]);
      assert.ok([201, 409].includes(r2[0].status) && r2[1].status === 200, r2.map(r => r.status).join());
      const edC = await edition('Carrera cancelación');
      const r3 = await Promise.all([create(payload(edC, { fecha: '2027-04-09' })), request(E + '/' + edC.id + '/cierre', tokens.g, 'PUT', { revision: edC.revision, estado: 'cancelada' })]);
      assert.ok([201, 409].includes(r3[0].status) && r3[1].status === 200, r3.map(r => r.status).join());
    });

    await t.test('reprogramación y edición: motivo, revisión, historial con la programación anterior y nueva, y reglas del docente', async () => {
      const { ed, doc } = await crew('Reprogramación'); const second = await teacher(); const asg2 = await assign(second, ed);
      const s = await ok(create(payload(ed, { fecha: '2027-05-03', docente_id: doc.id })));
      for (const body of [{}, { revision: 1 }, { titulo: 'Sin revisión' }, { revision: 1, motivo: 'Solo motivo' }, { revision: '1', titulo: 'x' }, { revision: 1, estado: 'cancelada' }, { revision: 1, asignacion_id: 1 }, { revision: 1, convocatoria_id: 2 }, { revision: 1, fecha: '2027-02-30' }, { revision: 1, titulo: '' }, { revision: 1, motivo: '   ', fecha: '2027-05-04' }])
        assert.equal((await patch(s.id, body)).status, 400, JSON.stringify(body));
      assert.equal((await patch(999999, { revision: 1, titulo: 'X' })).status, 404);
      assert.equal((await patch(s.id, { revision: 1, hora_inicio: '16:00', hora_fin: '17:00' })).status, 422, 'reprogramar exige motivo');
      assert.equal((await patch(s.id, { revision: 1, hora_inicio: '17:00', hora_fin: '16:00', motivo: 'Intervalo invertido' })).status, 422);
      assert.equal((await patch(s.id, { revision: 1, hora_inicio: '16:00', motivo: 'Fin anterior al nuevo inicio' })).status, 422, 'el intervalo se valida con los valores combinados');
      const moved = await ok(patch(s.id, { revision: 1, fecha: '2027-05-04', hora_inicio: '16:30', hora_fin: '18:00', motivo: ' Cruce con feriado ' }), 200);
      assert.deepEqual([moved.fecha, moved.hora_inicio, moved.hora_fin, moved.revision, moved.inicio_utc], ['2027-05-04', '16:30', '18:00', 2, '2027-05-04T21:30:00.000Z']);
      const trail = await rows("SELECT operacion,estado_anterior,estado_nuevo,motivo,campos,revision,actor_rol FROM academico_historial WHERE entidad='sesion' AND entidad_id=? ORDER BY id", [s.id]);
      assert.deepEqual(trail.map(r => r.operacion), ['creacion', 'reprogramacion']);
      assert.deepEqual([trail[1].estado_anterior, trail[1].estado_nuevo, trail[1].motivo, trail[1].revision, trail[1].actor_rol], ['2027-05-03 14:00-16:00', '2027-05-04 16:30-18:00', 'Cruce con feriado', 2, 'GERENTE_GENERAL']);
      assert.deepEqual(campos(trail[1].campos).sort(), ['fecha', 'hora_fin', 'hora_inicio']);
      // Sin cambios reales: no se toca la revisión ni el historial (una edición con valores iguales es inocua).
      const same = await ok(patch(s.id, { revision: 2, titulo: moved.titulo, fecha: moved.fecha, hora_inicio: moved.hora_inicio }), 200);
      assert.equal(same.revision, 2); assert.equal((await rows("SELECT COUNT(*) AS n FROM academico_historial WHERE entidad='sesion' AND entidad_id=?", [s.id]))[0].n, 2);
      // Cambios que no reprograman: sin motivo; historial 'edicion' con nombres de campo.
      const text = await ok(patch(s.id, { revision: 2, titulo: 'Título nuevo', lugar: 'Aula 9', observaciones: 'Nota interna', enlace_url: '' }), 200);
      assert.deepEqual([text.titulo, text.lugar, text.observaciones, text.revision], ['Título nuevo', 'Aula 9', 'Nota interna', 3]);
      const cleared = await ok(patch(s.id, { revision: 3, lugar: '', observaciones: '' }), 200); assert.deepEqual([cleared.lugar, cleared.observaciones], [null, null]);
      assert.equal((await patch(s.id, { revision: 4, modalidad: 'virtual', lugar: 'Aula 2' })).status, 422, 'virtual no admite lugar físico');
      assert.equal((await patch(s.id, { revision: 4, enlace_url: 'https://reunion.test/x' })).status, 422, 'presencial no admite enlace: primero se cambia la modalidad');
      const virtual = await ok(patch(s.id, { revision: 4, modalidad: 'virtual', enlace_url: 'https://reunion.test/x' }), 200); assert.equal(virtual.modalidad, 'virtual');
      // Docente: cambiar exige motivo; solo a uno asignado, activo y sin conflicto; quitar al docente libera su horario.
      assert.equal((await patch(s.id, { revision: 5, docente_id: second.id })).status, 422);
      assert.equal((await patch(s.id, { revision: 5, docente_id: 999999, motivo: 'Cambio' })).status, 404);
      assert.equal((await patch(s.id, { revision: 5, docente_id: (await teacher()).id, motivo: 'Cambio' })).status, 409, 'no asignado a la edición');
      const swapped = await ok(patch(s.id, { revision: 5, docente_id: second.id, motivo: 'Cambio de docente' }), 200);
      assert.deepEqual([swapped.docente_id, swapped.asignacion_id, swapped.revision], [second.id, asg2.id, 6]);
      assert.equal((await rows("SELECT operacion FROM academico_historial WHERE entidad='sesion' AND entidad_id=? ORDER BY id DESC LIMIT 1", [s.id]))[0].operacion, 'edicion', 'cambiar de docente sin mover la hora es una edición');
      const unassigned = await ok(patch(s.id, { revision: 6, docente_id: null, motivo: 'Docente por definir' }), 200); assert.deepEqual([unassigned.docente, unassigned.docente_id, unassigned.asignacion_id], [null, null, null]);
      // Docente inactivo o asignación retirada: la sesión se conserva y se puede corregir su texto, pero no reprogramar con ese docente.
      const keep = await ok(create(payload(ed, { fecha: '2027-05-10', docente_id: doc.id })));
      await request(D + '/' + doc.id + '/estado', tokens.g, 'PUT', { revision: doc.revision, activo: false });
      const frozenTeacher = (await get(keep.id)).body.item; assert.deepEqual([frozenTeacher.docente.activo, frozenTeacher.docente.vigente, frozenTeacher.estado], [false, false, 'programada'], 'la sesión se conserva');
      assert.equal((await patch(keep.id, { revision: 1, hora_inicio: '15:00', hora_fin: '16:00', motivo: 'Mover' })).status, 409, 'no se reprograma con un docente inactivo');
      assert.equal((await patch(keep.id, { revision: 1, lugar: 'Aula 5' })).status, 200, 'pero el lugar sí se corrige');
      assert.equal((await patch(keep.id, { revision: 2, docente_id: second.id, motivo: 'Reemplazo' })).status, 200, 'y se puede reasignar a otro docente activo');
      const retiree = await teacher(); const asgRet = await assign(retiree, ed);
      const mine = await ok(create(payload(ed, { fecha: '2027-05-11', docente_id: retiree.id })));
      await request(A + '/' + asgRet.id + '/retiro', tokens.g, 'PUT', { revision: asgRet.revision, motivo: 'Renuncia' });
      const withRetired = (await get(mine.id)).body.item; assert.deepEqual([withRetired.docente.asignacion_estado, withRetired.docente.vigente], ['retirada', false]);
      assert.equal((await patch(mine.id, { revision: 1, fecha: '2027-05-12', motivo: 'Mover' })).status, 409, 'asignación retirada');
    });

    await t.test('estados: transiciones, motivos, hora de inicio en Lima, edición archivada y sesiones históricas no modificables en silencio', async () => {
      const { ed, doc } = await crew('Estados', 1, true);
      const future = await ok(create(payload(ed, { fecha: '2099-01-05', docente_id: doc.id })));
      const past = await ok(create(payload(ed, { fecha: '2020-02-03', hora_inicio: '09:00', hora_fin: '11:00', docente_id: doc.id, titulo: 'Histórica' })));
      for (const body of [{}, { revision: 1 }, { estado: 'realizada' }, { revision: 1, estado: 'borrada' }, { revision: '1', estado: 'realizada' }, { revision: 1, estado: 'realizada', fecha: '2020-01-01' }, { revision: 1, estado: 'realizada', motivo: '  ' }, { revision: 1, estado: 'realizada', motivo: 'x'.repeat(301) }])
        assert.equal((await state(past.id, body)).status, 400, JSON.stringify(body));
      assert.equal((await state(999999, { revision: 1, estado: 'cancelada', motivo: 'x' })).status, 404);
      assert.equal((await state(future.id, { revision: 1, estado: 'realizada' })).status, 409, 'una clase futura no puede marcarse como realizada');
      assert.equal((await state(past.id, { revision: 1, estado: 'programada', motivo: 'Mismo estado' })).status, 409, 'mismo estado');
      assert.equal((await state(past.id, { revision: 1, estado: 'cancelada' })).status, 422, 'cancelar exige motivo');
      assert.equal((await state(past.id, { revision: 9, estado: 'realizada' })).status, 409, 'revisión obsoleta');
      const done = await ok(state(past.id, { revision: 1, estado: 'realizada', motivo: ' Se dictó con normalidad ' }), 200);
      assert.deepEqual([done.estado, done.revision, done.cancelada_at, done.cancelacion_motivo], ['realizada', 2, null, null]);
      const trail = async id => rows("SELECT operacion,estado_anterior,estado_nuevo,motivo,campos,revision FROM academico_historial WHERE entidad='sesion' AND entidad_id=? ORDER BY id", [id]);
      assert.deepEqual((await trail(past.id)).map(r => [r.operacion, r.estado_anterior, r.estado_nuevo, r.motivo]).at(-1), ['cambio_estado', 'programada', 'realizada', 'Se dictó con normalidad']);
      // Una realizada es historia: ni se cancela, ni cambia de día, horas, docente o modalidad; solo título y observaciones, con motivo.
      assert.equal((await state(past.id, { revision: 2, estado: 'cancelada', motivo: 'Intento' })).status, 409, 'una realizada no se cancela');
      for (const frozen of [{ fecha: '2020-02-04' }, { hora_inicio: '10:00' }, { hora_fin: '12:00' }, { modalidad: 'virtual' }, { docente_id: null }, { lugar: 'Aula 4' }])
        assert.equal((await patch(past.id, { revision: 2, motivo: 'Corrección', ...frozen })).status, 409, JSON.stringify(frozen));
      assert.equal((await patch(past.id, { revision: 2, observaciones: 'Sin motivo' })).status, 422, 'corregir una realizada exige motivo');
      const fixed = await ok(patch(past.id, { revision: 2, observaciones: 'Asistieron todos', motivo: 'Aclaración posterior' }), 200); assert.equal(fixed.observaciones, 'Asistieron todos');
      assert.equal((await rows("SELECT motivo FROM academico_historial WHERE entidad='sesion' AND entidad_id=? ORDER BY id DESC LIMIT 1", [past.id]))[0].motivo, 'Aclaración posterior');
      // Reabrir una realizada marcada por error: con motivo; vuelve a ser programada y editable.
      assert.equal((await state(past.id, { revision: 3, estado: 'programada' })).status, 422, 'reabrir exige motivo');
      const reopened = await ok(state(past.id, { revision: 3, estado: 'programada', motivo: 'Marcada por error' }), 200); assert.equal(reopened.estado, 'programada');
      assert.equal((await patch(past.id, { revision: 4, hora_inicio: '09:30', motivo: 'Ahora sí se puede mover' })).status, 200);
      // Cancelación: motivo obligatorio, fecha registrada, final e inmodificable; libera el horario.
      const cancelled = await ok(state(future.id, { revision: 1, estado: 'cancelada', motivo: ' Docente enfermo ' }), 200);
      assert.deepEqual([cancelled.estado, cancelled.cancelacion_motivo, !!cancelled.cancelada_at], ['cancelada', 'Docente enfermo', true]);
      assert.deepEqual((await rows('SELECT estado,cancelacion_motivo,cancelada_at IS NOT NULL AS c FROM sesiones WHERE id=?', [future.id]))[0], { estado: 'cancelada', cancelacion_motivo: 'Docente enfermo', c: 1 });
      assert.deepEqual(campos((await trail(future.id)).at(-1).campos), ['estado', 'cancelada_at', 'cancelacion_motivo']);
      for (const to of ['programada', 'realizada', 'cancelada']) assert.equal((await state(future.id, { revision: 2, estado: to, motivo: 'Intento' })).status, 409, 'cancelada es final → ' + to);
      assert.equal((await patch(future.id, { revision: 2, titulo: 'Intento' })).status, 409, 'una cancelada no se edita');
      assert.equal((await get(future.id)).body.item.estado, 'cancelada', 'se conserva: nada se borra');
      await ok(create(payload(ed, { fecha: '2099-01-05', docente_id: doc.id })), 201); // el horario liberado se puede reutilizar
      // Edición archivada: no se programa ni se modifica, pero se puede cancelar para limpiar su calendario.
      const live = await ok(create(payload(ed, { fecha: '2099-02-01', docente_id: doc.id })));
      const old = await ok(create(payload(ed, { fecha: '2020-06-01', hora_inicio: '09:00', hora_fin: '10:00' })));
      const closed = await request(E + '/' + ed.id + '/cierre', tokens.g, 'PUT', { revision: (await request(E + '/' + ed.id, tokens.g)).body.item.revision, estado: 'cerrada' }); assert.equal(closed.status, 200);
      await ok(create(payload(ed, { fecha: '2099-02-02' })), 201); // cerrada a matrículas: la edición sigue dictándose
      const archived = await request(E + '/' + ed.id + '/archivo', tokens.g, 'PUT', { revision: closed.body.item.revision, archivado: true }); assert.equal(archived.status, 200, archived.text);
      assert.equal((await create(payload(ed, { fecha: '2099-03-01' }))).status, 409);
      assert.equal((await patch(live.id, { revision: 1, titulo: 'Intento' })).status, 409);
      assert.equal((await state(old.id, { revision: 1, estado: 'realizada' })).status, 409, 'no se marca realizada en una edición archivada');
      assert.equal((await state(live.id, { revision: 1, estado: 'cancelada', motivo: 'Edición archivada' })).status, 200, 'cancelar sí se permite');
    });

    await t.test('listados: paginación estable, filtros por edición, docente, estado y fechas, orden y calendario por edición', async () => {
      const { ed, doc } = await crew('Listados'); const mate = await teacher(); await assign(mate, ed);
      const day = ['2028-01-10', '2028-01-11', '2028-01-12'];
      const made = [];
      for (const [i, fecha] of day.entries()) for (const [j, hora] of ['08:00', '10:00', '12:00'].entries())
        made.push(await ok(create(payload(ed, { fecha, hora_inicio: hora, hora_fin: String(Number(hora.slice(0, 2)) + 1).padStart(2, '0') + ':00', titulo: `Sesión ${i}-${j}`, ...(j === 0 ? { docente_id: doc.id } : j === 1 ? { docente_id: mate.id } : {}) }))));
      await state(made[0].id, { revision: 1, estado: 'cancelada', motivo: 'Feriado' });
      const ids = [], q = (query, token = tokens.g) => request(S + '?convocatoria_id=' + ed.id + (query ? '&' + query : ''), token);
      for (let page = 1; page <= 3; page++) { const r = await q('limit=4&page=' + page); assert.equal(r.status, 200); assert.deepEqual([r.body.pagination.total, r.body.pagination.pages], [9, 3]); ids.push(...r.body.items.map(i => i.titulo)); }
      assert.deepEqual(ids, made.map(m => m.titulo), 'orden por fecha, hora e id, sin repetir ni omitir entre páginas');
      assert.deepEqual((await q('orden=desc&limit=3')).body.items.map(i => i.titulo), ['Sesión 2-2', 'Sesión 2-1', 'Sesión 2-0']);
      assert.equal((await q('estado=cancelada')).body.pagination.total, 1); assert.equal((await q('estado=programada')).body.pagination.total, 8);
      assert.equal((await q('docente_id=' + doc.id)).body.pagination.total, 3); assert.equal((await q('docente_id=' + mate.id + '&estado=programada')).body.pagination.total, 3);
      assert.equal((await q('desde=2028-01-11&hasta=2028-01-11')).body.pagination.total, 3, 'ambos extremos incluidos');
      assert.equal((await q('desde=2028-01-11')).body.pagination.total, 6); assert.equal((await q('hasta=2028-01-10')).body.pagination.total, 3);
      assert.equal((await q('desde=2028-01-13')).body.pagination.total, 0);
      const byEdition = await request(E + '/' + ed.id + '/sesiones?limit=100', tokens.c); assert.equal(byEdition.status, 200);
      assert.deepEqual(byEdition.body.items.map(i => i.id), (await q('limit=100')).body.items.map(i => i.id), 'la consulta por edición coincide con el filtro');
      assert.equal((await request(E + '/' + ed.id + '/sesiones?docente_id=' + doc.id, tokens.g)).body.pagination.total, 3);
      assert.equal((await request(E + '/999999/sesiones', tokens.g)).status, 404);
      assert.equal((await request(S + '?convocatoria_id=999999', tokens.g)).body.pagination.total, 0);
      for (const bad of ['limit=101', 'page=0', 'page=abc', 'estado=otra', 'desde=2028-02-30', 'desde=ayer', 'hasta=2028-1-1', 'desde=2028-02-02&hasta=2028-02-01', 'orden=random', 'convocatoria_id=0', 'docente_id=x', 'q=algo', 'sort=id'])
        assert.equal((await request(S + '?' + bad, tokens.g)).status, 400, bad);
      assert.equal((await request(E + '/' + ed.id + '/sesiones?convocatoria_id=2', tokens.g)).status, 400, 'la edición va en la ruta, no en la consulta');
      assert.equal((await request(S + '/abc', tokens.g)).status, 400); assert.equal((await request(S + '/999999', tokens.g)).status, 404); assert.equal((await request(S + '/0', tokens.g)).status, 400);
      const item = (await q('limit=1')).body.items[0];
      assert.ok(!JSON.stringify(item).match(/doc_numero|email|telefono|profesion|@sesiones\.test|987 000/), 'sin datos personales del docente');
    });

    await t.test('desactivar, retirar o sustituir a un docente conserva sus sesiones, su historial y las matrículas', async () => {
      const { ed, doc, asg } = await crew('Conservación', 1, true); const reserve = await teacher(); await assign(reserve, ed);
      const student = await request('/admin/estudiantes', tokens.s, 'POST', { nombres: 'Alumna', apellidos: 'Sesiones', doc_numero: '55667788' }); assert.equal(student.status, 201);
      const enrol = await request('/admin/matriculas', tokens.s, 'POST', { estudiante_id: student.body.item.id, convocatoria_id: ed.id, convocatoria_revision: ed.revision }); assert.equal(enrol.status, 201, enrol.text);
      const sessions = [];
      for (const n of [1, 2, 3]) sessions.push(await ok(create(payload(ed, { fecha: '2028-02-0' + n, docente_id: doc.id, titulo: 'Conserva ' + n }))));
      const before = await counts(); const historyBefore = (await rows("SELECT COUNT(*) AS n FROM academico_historial WHERE entidad='sesion'"))[0].n;
      const off = await request(D + '/' + doc.id + '/estado', tokens.g, 'PUT', { revision: doc.revision, activo: false }); assert.equal(off.status, 200);
      assert.deepEqual((await rows('SELECT COUNT(*) AS n, MIN(asignacion_id) AS a FROM sesiones WHERE asignacion_id=?', [asg.id]))[0], { n: 3, a: asg.id }, 'desactivar al docente no toca sus sesiones');
      const retired = await request(A + '/' + asg.id + '/retiro', tokens.g, 'PUT', { revision: asg.revision, motivo: 'Renuncia' }); assert.equal(retired.status, 200);
      assert.equal((await rows('SELECT COUNT(*) AS n FROM sesiones WHERE asignacion_id=?', [asg.id]))[0].n, 3, 'retirar su asignación tampoco');
      for (const s of sessions) { const view = (await get(s.id)).body.item; assert.deepEqual([view.estado, view.docente.vigente, view.docente.asignacion_estado, view.docente.activo], ['programada', false, 'retirada', false]); }
      assert.equal((await create(payload(ed, { fecha: '2028-02-05', docente_id: doc.id }))).status, 409);
      // Sustitución desde el módulo de docentes: la sesión sigue ligada a la asignación que figura en el historial.
      const asgReserve = (await request(A + '?docente_id=' + reserve.id, tokens.g)).body.items[0];
      const swap = await request(A + '/' + asgReserve.id + '/sustitucion', tokens.g, 'POST', { revision: asgReserve.revision, motivo: 'Reemplazo', docente_id: (await teacher()).id }); assert.equal(swap.status, 201, swap.text);
      assert.deepEqual((await counts())[0], { ...before[0], a: before[0].a + 1, d: before[0].d + 1 }, 'matrículas, estudiantes y ediciones intactos; solo cambia lo que hizo el módulo de docentes (un docente y una asignación nuevos)');
      assert.equal((await rows("SELECT COUNT(*) AS n FROM academico_historial WHERE entidad='sesion'"))[0].n, historyBefore, 'ninguna de esas operaciones reescribe el historial de sesiones');
      assert.equal((await request('/admin/matriculas?convocatoria_id=' + ed.id, tokens.s)).body.pagination.total, 1);
    });

    await t.test('compatibilidad: Ediciones, Estudiantes, Matrículas, Reportes y la web pública siguen funcionando con sesiones programadas', async () => {
      const { ed, doc } = await crew('Compatibilidad', 1, true); await ok(create(payload(ed, { fecha: '2028-03-01', docente_id: doc.id })));
      assert.equal((await request(E + '/' + ed.id, tokens.s)).status, 200);
      const edited = await request(E + '/' + ed.id, tokens.g, 'PUT', { revision: ed.revision, capacidad: 25 }); assert.equal(edited.status, 200, 'editar la edición no se ve afectado');
      const closed = await request(E + '/' + ed.id + '/cierre', tokens.c, 'PUT', { revision: edited.body.item.revision, estado: 'cerrada' }); assert.equal(closed.status, 200, 'cerrar una edición con sesiones programadas');
      assert.equal((await request(S + '?convocatoria_id=' + ed.id, tokens.g)).body.pagination.total, 1, 'cerrar la edición conserva sus sesiones');
      assert.equal((await request('/admin/reportes', tokens.c)).status, 200);
      assert.equal((await request('/admin/stats?vista=operativa', tokens.g)).status, 200);
      assert.equal((await request('/admin/me', tokens.b)).status, 200);
      for (const endpoint of ['/cursos', '/servicios', '/galeria', '/convenios', '/settings']) assert.equal((await request(endpoint)).status, 200);
      assert.equal((await request('/admin/cursos/1', tokens.g, 'DELETE')).status, 409, 'un curso con ediciones y sesiones no se borra');
    });

    await t.test('transaccionalidad: si falla el historial no se persiste ni se cambia la sesión', async () => {
      const { ed, doc } = await crew('Historial fallido'); const keep = await ok(create(payload(ed, { fecha: '2028-04-01', docente_id: doc.id })));
      const snap = async () => JSON.stringify(await rows('SELECT (SELECT COUNT(*) FROM sesiones) AS n, (SELECT revision FROM sesiones WHERE id=?) AS r, (SELECT estado FROM sesiones WHERE id=?) AS e, (SELECT hora_inicio FROM sesiones WHERE id=?) AS h', [keep.id, keep.id, keep.id]));
      const before = await snap();
      await db.query("CREATE TRIGGER sesiones_historial_fallo BEFORE INSERT ON academico_historial FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio de auditoría'");
      try {
        assert.equal((await create(payload(ed, { fecha: '2028-04-02' }))).status, 500);
        assert.equal((await patch(keep.id, { revision: 1, hora_inicio: '15:00', hora_fin: '16:00', motivo: 'No debe guardarse' })).status, 500);
        assert.equal((await state(keep.id, { revision: 1, estado: 'cancelada', motivo: 'No debe guardarse' })).status, 500);
        assert.equal(await snap(), before, 'ni la sesión nueva ni los cambios sobreviven sin su historial');
      } finally { await db.query('DROP TRIGGER sesiones_historial_fallo'); }
      assert.equal((await state(keep.id, { revision: 1, estado: 'cancelada', motivo: 'Ahora sí' })).status, 200, 'sin el fallo todo vuelve a funcionar');
    });

    await t.test('errores controlados: nada de SQL, Prisma ni trazas, y 503 si faltara la estructura', async () => {
      assert.ok(leaks.length > 60, 'se recogieron respuestas de error para revisar (' + leaks.length + ')');
      for (const text of leaks) assert.ok(!/prisma|ER_[A-Z_]+|SELECT |INSERT |UPDATE `|stack|\bat\s+\S+\.(js|ts)|sqlMessage|mysql|sesiones_[a-z_]+_(chk|fk|uq|idx)/i.test(text), 'respuesta de error con detalles internos: ' + text.slice(0, 160));
      // Sin la tabla (migración pendiente) las rutas responden 503 neutro, no 500. Se hace al final: la tabla se renombra y se restaura.
      await db.query('RENAME TABLE sesiones TO sesiones_oculta');
      try {
        const listed = await request(S, tokens.g); assert.equal(listed.status, 503); assert.equal(listed.body.message, 'La gestión de sesiones no está disponible. Solicita revisar la estructura académica.');
        assert.equal((await request(S + '/1', tokens.g)).status, 503);
      } finally { await db.query('RENAME TABLE sesiones_oculta TO sesiones'); }
      assert.equal((await request(S, tokens.g)).status, 200);
    });

    t.diagnostic('Base ficticia conservada en el servidor desechable hasta retirar el contenedor propio: ' + name);
  } finally {
    if (api?.connected) { const exited = new Promise(resolve => api.once('exit', resolve)); api.disconnect(); await exited; }
    for (const client of clients) { try { await client.end(); } catch { /* ya cerrada */ } }
    await admin.end();
    for (const dir of [cwd, apiCwd]) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporal propio: se ignora si Windows aún lo retiene */ } }
  }
});
