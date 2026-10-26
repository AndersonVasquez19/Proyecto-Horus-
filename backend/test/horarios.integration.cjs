// Horarios recurrentes de las ediciones (20261023-convocatoria-horarios) y retirada de Sesiones (20261020-sesiones-academicas, migración
// RETIRADA) contra un MySQL REAL y DESECHABLE: instalación desde cero, actualización desde el estado actual de horus_db (sin sesiones ni
// preinscripciones), compatibilidad con bases que SÍ aplicaron la migración retirada, inconsistencias que db:check no debe aceptar,
// respaldo y restauración, restricciones de la base, HTTP real con AccessGuard, validación, permisos, concurrencia y atomicidad.
// No forma parte de `npm test`. Requiere `npm run build` (arranca backend/dist).
//
//   npm run build && node test/run-academic-isolated.cjs horarios        (MySQL 8.4)
//   HORUS_IT_MYSQL_IMAGE=mysql:8.0.46 node test/run-academic-isolated.cjs horarios   (misma versión mayor que horus_db, si la imagen existe)
//
// El destino `sesiones` del ejecutor es un alias de esta suite (la CI manual lo sigue invocando con ese nombre).
//
// Barreras (las mismas que las demás suites académicas; todas antes de crear nada): HORARIOS_TEST_DB=true explícito, DB_HOST de bucle local,
// @@server_uuid igual al del contenedor propio (obtenido por docker exec), servidor recién creado (Uptime < 1 h) y sin bases ajenas.
// Solo crea bases horus_horarios_it_<hex> y horus_restore_horarios_<hex>. Datos ficticios; jamás toca horus_db ni horus_local.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork, spawn } = require('node:child_process');
const { readFileSync, readdirSync, mkdtempSync, realpathSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const http = require('node:http');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { validatedPreinscripciones } = require('./fixtures/preinscripciones-fixture.cjs');

const backend = join(__dirname, '..');
// Lista de migraciones leída como texto, como en las demás suites: requerir migrate.cjs cargaría database.cjs y, con él, dotenv (backend/.env).
const migrateSource = readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8');
const versions = JSON.parse(migrateSource.match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const retired = Object.fromEntries([...migrateSource.match(/const retired = Object\.freeze\(\{([\s\S]*?)\}\);/)[1].matchAll(/'(\d{8}-[a-z0-9-]+)':/g)].map(match => [match[1], true]));
const MIGRATION = '20261023-convocatoria-horarios';
const RETIRED = '20261020-sesiones-academicas';
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const statementsOf = name => readFileSync(join(backend, 'migrations', name + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean); // criterio de migrate.cjs
// Estado actual conocido de horus_db: aplicadas todas las migraciones hasta 20261020-docentes (16 de 18); pendientes las de sesiones y
// preinscripciones. La de sesiones ya no se aplicará; la de preinscripciones sigue pendiente; la de horarios es nueva.
const CURRENT_HORUS_DB = versions.slice(0, versions.indexOf('20261020-docentes') + 1);
const LEAK = /prisma|ER_[A-Z_]+|SELECT |INSERT |UPDATE `|stack|\bat\s+\S+\.(js|ts)|sqlMessage|mysql|convocatoria_horarios_[a-z_]+_(chk|fk|uq)/i;

test('Horarios: migraciones (nueva, actualización, histórica e inconsistente), respaldo, restricciones, HTTP, permisos, concurrencia y atomicidad en MySQL desechable', { timeout: 1800000 }, async t => {
  if (process.env.HORARIOS_TEST_DB !== 'true') return t.skip('Requiere HORARIOS_TEST_DB=true y un servidor desechable identificado por UUID.');
  assert.ok(versions.includes(MIGRATION) && versions.at(-1) === MIGRATION, 'la migración de horarios es la última registrada');
  assert.ok(RETIRED in retired && !versions.includes(RETIRED), 'la migración de sesiones está retirada');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  const expectedUuid = String(process.env.HORARIOS_TEST_SERVER_UUID ?? '').trim().toLowerCase();
  assert.match(expectedUuid, /^[0-9a-f-]{36}$/);
  const credentials = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS, timezone: 'Z', dateStrings: true };
  const admin = await mysql.createConnection(credentials);
  const q = async (sql, params) => (await admin.query(sql, params))[0];
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-horarios-'));
  const apiCwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-horarios-api-'));
  const clients = [];
  let api;
  const leaks = []; // cuerpos de error HTTP: ninguno puede mostrar SQL, Prisma ni trazas
  try {
    const [{ uuid, uptime, version }] = await q("SELECT @@server_uuid AS uuid, VERSION() AS version, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime') AS uptime");
    assert.equal(String(uuid).toLowerCase(), expectedUuid, 'el servidor conectado no es el servidor desechable identificado');
    assert.match(version, process.env.HORUS_IT_MYSQL_IMAGE === 'mysql:8.0.46' ? /^8\.0\.46/ : /^8\.4\./, 'versión del servidor desechable esperado');
    assert.ok(Number(uptime) < 3600, 'servidor recién creado');
    assert.deepEqual(await q('SELECT TABLE_SCHEMA AS s FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN (?) GROUP BY TABLE_SCHEMA', [SYSTEM]), [], 'solo se permite un servidor vacío');
    t.diagnostic('MySQL desechable ' + version);

    const env = name => ({ PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), DB_HOST: credentials.host, DB_PORT: String(credentials.port), DB_NAME: name, DB_USER: credentials.user, DB_PASS: credentials.password, DB_SSL: 'false' });
    const runScript = (file, name, args = []) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-r', join(__dirname, 'isolate-env.cjs'), join(backend, 'scripts', file), ...args], { cwd, env: env(name), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = '';
      child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    const connect = async name => { const c = await mysql.createConnection({ ...credentials, database: name }); clients.push(c); return c; };
    const createDb = async (prefix = 'horus_horarios_it_') => {
      const name = prefix + randomBytes(12).toString('hex'); assert.match(name, /^horus_(horarios_it|restore_horarios)_[0-9a-f]{24}$/);
      await q('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); return name;
    };
    const runSql = async (db, version) => { for (const sql of statementsOf(version)) await db.query(sql); };
    // Base con las migraciones indicadas aplicadas y registradas como lo haría migrate.cjs (y, opcionalmente, la retirada de sesiones).
    async function databaseWith(list) {
      const name = await createDb(); const db = await connect(name);
      await runSql(db, '00000000-initial');
      await db.query('CREATE TABLE IF NOT EXISTS horus_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)');
      for (const version of list) { await runSql(db, version); await db.execute('INSERT INTO horus_migrations (name, applied_at) VALUES (?, ?)', [version, new Date()]); }
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
    const tableExists = async (db, table) => (await db.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]))[0][0].n === 1;
    const registered = async db => (await db.query('SELECT name FROM horus_migrations ORDER BY name'))[0].map(r => r.name);
    const enumOf = async (db, column) => (await db.query("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'academico_historial' AND COLUMN_NAME = ?", [column]))[0][0].t;
    const rejects = async (promise, errno, name) => {
      let error = null; try { await promise; } catch (e) { error = e; }
      assert.ok(error, 'se esperaba un rechazo');
      assert.equal(error.errno, errno, 'errno ' + error.errno + ' ' + String(error.sqlMessage).slice(0, 140));
      if (name) assert.ok(String(error.sqlMessage).includes(name), 'se esperaba «' + name + '» y llegó ' + String(error.sqlMessage).slice(0, 140));
    };
    const seed = async (db, tag) => {
      await db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Excel Básico',?,'Curso ficticio','curso','presencial','20 horas','publicado',NOW(),NOW())", ['excel-horarios-' + tag]);
      await db.query("INSERT INTO convocatorias (curso_id,nombre,fecha_inicio,fecha_fin,estado,capacidad) VALUES (1,'Edición anterior 1','2026-03-01','2026-03-30','cerrada',10),(1,'Edición anterior 2',NULL,NULL,'planificada',NULL)");
      await db.query("INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero,email) VALUES ('Persona','Ficticia','PE','DNI','00123456','persona@horarios.test')");
      await db.query('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (1,1)');
      await db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,actor_rol,campos,revision) VALUES ('convocatoria',1,'creacion','panel',1,'GERENTE_GENERAL',JSON_ARRAY('nombre'),1)");
    };
    const BASE_ENTIDAD = "enum('estudiante','convocatoria','matricula','certificado','docente','asignacion_docente')";
    const BASE_OPERACION = "enum('creacion','edicion','archivado','restauracion','cambio_estado','anulacion','confirmacion','emision','sustitucion')";

    // ---------------------------------------------------------------------------------------------------------------------
    await t.test('base nueva: db:init + db:migrate aplican la secuencia vigente (con horarios, sin sesiones) y db:check la acepta', async () => {
      const name = await createDb(); await connect(name);
      const init = await runScript('init-database.cjs', name); assert.equal(init.code, 0, init.output);
      assert.equal((await runScript('check-database.cjs', name)).code, 1, 'sin migrar, db:check falla');
      const migrated = await runScript('migrate.cjs', name); assert.equal(migrated.code, 0, migrated.output);
      const check = await runScript('check-database.cjs', name); assert.equal(check.code, 0, check.output); assert.match(check.output, /Esquema compatible/);
      const db = await connect(name);
      assert.deepEqual(await registered(db), [...versions].sort(), 'todas las vigentes, una sola vez, y ninguna retirada');
      assert.equal(await tableExists(db, 'sesiones'), false, 'una base nueva no crea la tabla de sesiones');
      assert.equal(await tableExists(db, 'convocatoria_horarios'), true);
      assert.equal(await enumOf(db, 'entidad'), BASE_ENTIDAD); assert.equal(await enumOf(db, 'operacion'), BASE_OPERACION);
      assert.equal((await db.query('SELECT COUNT(*) AS n FROM convocatoria_horarios'))[0][0].n, 0, 'la migración no inserta datos');
      const again = await runScript('migrate.cjs', name); assert.equal(again.code, 0, again.output);
      assert.deepEqual(await registered(db), [...versions].sort(), 'repetir db:migrate no registra nada más');
    });

    // ---------------------------------------------------------------------------------------------------------------------
    const current = await databaseWith(CURRENT_HORUS_DB);
    await seed(current.db, 'actual');
    await t.test('actualización desde el estado actual de horus_db (16/18): se aplican preinscripciones y horarios, nunca sesiones, sin perder datos', async () => {
      const { name, db } = current;
      const pending = await runScript('check-database.cjs', name);
      assert.equal(pending.code, 1); assert.ok(pending.output.includes('convocatoria_horarios.id: falta') && pending.output.includes('preinscripciones.id: falta'), pending.output);
      assert.ok(!/sesiones/.test(pending.output), 'db:check ya no exige la tabla de sesiones: ' + pending.output);
      const before = await snapshot(db, ['horus_migrations']);
      const migrated = await runScript('migrate.cjs', name); assert.equal(migrated.code, 0, migrated.output);
      const check = await runScript('check-database.cjs', name); assert.equal(check.code, 0, check.output);
      assert.deepEqual(await registered(db), [...versions].sort());
      assert.equal(await tableExists(db, 'sesiones'), false, 'la migración retirada no se aplicó');
      const after = await snapshot(db, ['horus_migrations', 'convocatoria_horarios', 'preinscripciones', 'preinscripciones_historial']);
      for (const table of Object.keys(before)) {
        if (table === 'convocatorias' || table === 'matriculas') continue; // ganan las columnas e índice de 20261020-preinscripciones (los verifica su suite)
        assert.equal(after[table].ddl, before[table].ddl, table + ': definición sin cambios');
        assert.equal(after[table].rows, before[table].rows, table + ': filas idénticas');
      }
      assert.equal(after.matriculas.rows, before.matriculas.rows); assert.equal(await enumOf(db, 'entidad'), BASE_ENTIDAD, 'el historial no gana valores de sesiones');
      assert.deepEqual((await db.query('SELECT id, nombre, estado, revision FROM convocatorias ORDER BY id'))[0], [{ id: 1, nombre: 'Edición anterior 1', estado: 'cerrada', revision: 1 }, { id: 2, nombre: 'Edición anterior 2', estado: 'planificada', revision: 1 }]);
      const again = await runScript('migrate.cjs', name); assert.equal(again.code, 0, again.output);
      assert.deepEqual(await snapshot(db, ['horus_migrations']), await snapshot(db, ['horus_migrations']), 'repetir db:migrate no cambia nada');
    });

    // ---------------------------------------------------------------------------------------------------------------------
    await t.test('compatibilidad histórica: una base que SÍ aplicó la migración retirada conserva sesiones, datos y registro, y db:check la verifica entera', async () => {
      const legacy = await databaseWith([...CURRENT_HORUS_DB, RETIRED]);
      await seed(legacy.db, 'historica');
      await legacy.db.query("INSERT INTO sesiones (convocatoria_id,titulo,fecha,hora_inicio,hora_fin,modalidad) VALUES (1,'Clase histórica','2026-03-05','19:00:00','22:00:00','presencial')");
      await legacy.db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,actor_rol,campos,revision) VALUES ('sesion',1,'reprogramacion','panel',1,'GERENTE_GENERAL',JSON_ARRAY('fecha'),2)");
      const sessionsBefore = await snapshot(legacy.db, ['horus_migrations']);
      const migrated = await runScript('migrate.cjs', legacy.name); assert.equal(migrated.code, 0, migrated.output);
      const check = await runScript('check-database.cjs', legacy.name); assert.equal(check.code, 0, check.output);
      assert.deepEqual(await registered(legacy.db), [...versions, RETIRED].sort(), 'el registro histórico de la migración retirada se conserva');
      const after = await snapshot(legacy.db, ['horus_migrations']);
      assert.equal(after.sesiones.ddl, sessionsBefore.sesiones.ddl, 'la tabla histórica no cambia'); assert.equal(after.sesiones.rows, sessionsBefore.sesiones.rows, 'ni sus filas');
      assert.equal(after.academico_historial.rows, sessionsBefore.academico_historial.rows, 'las filas históricas del historial (entidad sesion, operación reprogramacion) se conservan');
      assert.match(await enumOf(legacy.db, 'entidad'), /'sesion'\)$/); assert.match(await enumOf(legacy.db, 'operacion'), /'reprogramacion'\)$/);
      // Una estructura histórica alterada no se acepta en silencio.
      await legacy.db.query('ALTER TABLE `sesiones` DROP CHECK `sesiones_revision_chk`');
      const tampered = await runScript('check-database.cjs', legacy.name);
      assert.equal(tampered.code, 1); assert.ok(tampered.output.includes('sesiones: falta restricción sesiones_revision_chk'), tampered.output);
    });

    // ---------------------------------------------------------------------------------------------------------------------
    await t.test('inconsistencias: restos de la migración retirada SIN su registro (aplicación parcial) se informan y no se corrigen ni borran', async () => {
      const [createSesiones, widenEntidad] = statementsOf(RETIRED);
      // Solo la tabla.
      const partial = await databaseWith(CURRENT_HORUS_DB);
      await partial.db.query(createSesiones);
      assert.equal((await runScript('migrate.cjs', partial.name)).code, 0);
      const check = await runScript('check-database.cjs', partial.name);
      assert.equal(check.code, 1); assert.ok(check.output.includes('sesiones: la tabla existe pero ' + RETIRED), check.output);
      assert.equal(await tableExists(partial.db, 'sesiones'), true, 'db:check no borra nada');
      // Solo el ENUM ampliado del historial.
      const enumOnly = await databaseWith(CURRENT_HORUS_DB);
      await enumOnly.db.query(widenEntidad);
      assert.equal((await runScript('migrate.cjs', enumOnly.name)).code, 0);
      const enumCheck = await runScript('check-database.cjs', enumOnly.name);
      assert.equal(enumCheck.code, 1); assert.ok(enumCheck.output.includes('academico_historial.entidad: tipo distinto'), enumCheck.output);
      // Una tabla de horarios preexistente con otra forma no se corrige en silencio: CREATE TABLE IF NOT EXISTS la omite y db:check la rechaza.
      const alien = await databaseWith(CURRENT_HORUS_DB);
      await alien.db.query('CREATE TABLE `convocatoria_horarios` (`id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY, `convocatoria_id` INT NOT NULL, `dia` VARCHAR(10) NOT NULL) ENGINE=InnoDB');
      assert.equal((await runScript('migrate.cjs', alien.name)).code, 0);
      const rejected = await runScript('check-database.cjs', alien.name);
      assert.equal(rejected.code, 1); assert.ok(rejected.output.includes('convocatoria_horarios.dia_semana: falta') && rejected.output.includes('columnas no previstas (dia)'), rejected.output);
    });

    // ---------------------------------------------------------------------------------------------------------------------
    await t.test('respaldo y restauración: una base con horarios y otra con la tabla histórica de sesiones se restauran y db:check las acepta', async () => {
      const legacy = await databaseWith([...CURRENT_HORUS_DB, RETIRED]);
      await seed(legacy.db, 'respaldo');
      assert.equal((await runScript('migrate.cjs', legacy.name)).code, 0);
      await legacy.db.query("INSERT INTO sesiones (convocatoria_id,titulo,fecha,hora_inicio,hora_fin,modalidad) VALUES (1,'Clase histórica','2026-03-05','19:00:00','22:00:00','presencial')");
      await legacy.db.query("INSERT INTO convocatoria_horarios (convocatoria_id,dia_semana,hora_inicio,hora_fin) VALUES (1,1,'19:00:00','22:00:00'),(1,6,'09:00:00','13:00:00')");
      for (const source of [legacy.name, current.name]) {
        const dir = join(cwd, 'backups-' + randomBytes(4).toString('hex'));
        const backup = await runScript('backup.cjs', source, ['--dir=' + dir]); assert.equal(backup.code, 0, backup.output);
        const file = join(dir, readdirSync(dir).find(f => f.endsWith('.sql.gz')));
        assert.equal((await runScript('restore.cjs', source, ['--file=' + file, '--verify-only'])).code, 0);
        const target = 'horus_restore_horarios_' + randomBytes(12).toString('hex'); // nombre propio y libre: restore.cjs la crea (nunca DB_NAME)
        const restore = await runScript('restore.cjs', source, ['--file=' + file, '--target=' + target, '--yes']);
        assert.equal(restore.code, 0, restore.output); assert.match(restore.output, /Integridad referencial verificada/);
        const check = await runScript('check-database.cjs', target); assert.equal(check.code, 0, check.output);
        const restored = await connect(target), original = await connect(source);
        // La base restaurada puede tener otra colación POR DEFECTO; SHOW CREATE TABLE escribe entonces «CHARACTER SET utf8mb4 COLLATE …» donde la
        // original escribía solo «COLLATE …». Es la misma colación de columna: se normaliza solo esa notación; filas y resto del DDL, idénticos.
        const same = snap => Object.fromEntries(Object.entries(snap).map(([table, entry]) => [table, { ...entry, ddl: entry.ddl.replace(/ CHARACTER SET utf8mb4 COLLATE utf8mb4_/g, ' COLLATE utf8mb4_') }]));
        assert.deepEqual(same(await snapshot(restored, ['rate_limit_buckets'])), same(await snapshot(original, ['rate_limit_buckets'])), source + ': copia idéntica (incluidos horus_migrations, horarios y, si existía, la tabla histórica de sesiones)');
      }
    });

    // ---------------------------------------------------------------------------------------------------------------------
    const { name, db } = current; // base actualizada desde el estado de horus_db: se reutiliza para las restricciones y para HTTP
    await t.test('restricciones reales: día 1–7, fin posterior al inicio, minutos exactos, sin duplicados, clave foránea y borrado restringido', async () => {
      const insert = (values) => db.query('INSERT INTO convocatoria_horarios (convocatoria_id,dia_semana,hora_inicio,hora_fin) VALUES (?,?,?,?)', values);
      await insert([2, 1, '19:00:00', '22:00:00']);
      await insert([2, 3, '19:00:00', '22:00:00']); await insert([1, 1, '19:00:00', '22:00:00']); // otro día y otra edición: válidos
      await insert([2, 6, '09:00:00', '13:00:00']); await insert([2, 6, '13:00:00', '17:00:00']); // consecutivos el mismo día
      for (const dia of [0, 8, -1]) await rejects(insert([2, dia, '08:00:00', '09:00:00']), 3819, 'convocatoria_horarios_dia_chk');
      for (const [inicio, fin] of [['22:00:00', '19:00:00'], ['19:00:00', '19:00:00'], ['19:00:30', '20:00:00'], ['19:00:00', '23:59:30'], ['23:00:00', '24:00:00']]) await rejects(insert([2, 2, inicio, fin]), 3819, 'convocatoria_horarios_horas_chk');
      await rejects(insert([2, 1, '19:00:00', '21:00:00']), 1062, 'convocatoria_horarios_inicio_uq'); // mismo día y misma hora de inicio
      await rejects(insert([999999, 1, '08:00:00', '09:00:00']), 1452, 'convocatoria_horarios_convocatoria_fk');
      await rejects(db.query('DELETE FROM convocatorias WHERE id = 2'), 1451, 'convocatoria_horarios_convocatoria_fk'); // RESTRICT: nada se borra en cascada
      await rejects(db.query('UPDATE convocatorias SET id = 99 WHERE id = 2'), 1451);
      // MySQL no tiene restricciones de exclusión: un solapamiento parcial escrito por SQL directo pasa. Lo impide el servicio (probado por HTTP).
      await insert([2, 3, '20:00:00', '23:00:00']);
      assert.equal((await db.query("SELECT CAST(hora_inicio AS CHAR) AS h FROM convocatoria_horarios WHERE convocatoria_id=2 AND dia_semana=6 ORDER BY hora_inicio"))[0].map(r => r.h).join(','), '09:00:00,13:00:00', 'TIME sin desplazamiento de zona');
      await db.query('DELETE FROM convocatoria_horarios'); // solo filas de esta prueba, en su base propia
    });

    // ---- HTTP real ---------------------------------------------------------------------------------------------------
    // El servidor desechable y la API se ponen en zonas horarias DISTINTAS de Lima y entre sí: nada guardado ni devuelto puede depender de ellas.
    await q("SET GLOBAL time_zone = '+13:00'"); // solo afecta a este contenedor propio y desechable
    const hash = await bcrypt.hash('Ficticia-horarios-1', 10);
    for (const [key, rol] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]])
      await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta ficticia', key + '@horarios.test', hash, rol]);
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
    for (const key of ['g', 'c', 's', 'b']) { const r = await request('/admin/login', null, 'POST', { email: key + '@horarios.test', password: 'Ficticia-horarios-1' }); assert.equal(r.status, 200); tokens[key] = r.body.token; }
    const E = '/admin/convocatorias';
    const H = id => E + '/' + id + '/horarios';
    const rows = async (sql, params) => (await db.query(sql, params))[0];
    const stored = id => rows("SELECT id, dia_semana, CAST(hora_inicio AS CHAR) AS i, CAST(hora_fin AS CHAR) AS f FROM convocatoria_horarios WHERE convocatoria_id=? ORDER BY dia_semana, hora_inicio", [id]);
    const revisionOf = async id => (await rows('SELECT revision FROM convocatorias WHERE id=?', [id]))[0].revision;
    const edition = async nombre => { const r = await request(E, tokens.g, 'POST', { curso_id: 1, nombre, fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 }); assert.equal(r.status, 201, r.text); return r.body.item; };
    const LUN = { dia_semana: 1, hora_inicio: '19:00', hora_fin: '22:00' }, MIE = { dia_semana: 3, hora_inicio: '19:00', hora_fin: '22:00' }, SAB = { dia_semana: 6, hora_inicio: '09:00', hora_fin: '13:00' };

    await t.test('HTTP: consultar, crear, repetir sin cambios, actualizar y vaciar los horarios con la revisión de la edición', async () => {
      const ed = await edition('Edición con horarios');
      const empty = await request(H(ed.id), tokens.g); assert.equal(empty.status, 200, empty.text);
      assert.deepEqual(empty.body, { ok: true, convocatoria: { id: ed.id, nombre: 'Edición con horarios', estado: 'planificada', archivada: false, revision: ed.revision, modificable: true }, zona_horaria: 'America/Lima', items: [] });
      const created = await request(H(ed.id), tokens.c, 'PUT', { revision: ed.revision, horarios: [SAB, LUN, MIE] });
      assert.equal(created.status, 200, created.text); assert.equal(created.body.cambios, true); assert.equal(created.body.convocatoria.revision, ed.revision + 1);
      assert.deepEqual(created.body.items.map(i => [i.dia_semana, i.dia, i.hora_inicio, i.hora_fin]), [[1, 'lunes', '19:00', '22:00'], [3, 'miércoles', '19:00', '22:00'], [6, 'sábado', '09:00', '13:00']]);
      assert.deepEqual((await stored(ed.id)).map(r => [r.dia_semana, r.i, r.f]), [[1, '19:00:00', '22:00:00'], [3, '19:00:00', '22:00:00'], [6, '09:00:00', '13:00:00']], 'hora de pared de Lima, sin zona');
      const history = await rows("SELECT entidad, operacion, campos, revision, estado_anterior, estado_nuevo, actor_rol FROM academico_historial WHERE entidad='convocatoria' AND entidad_id=? ORDER BY id", [ed.id]);
      const last = history.at(-1); assert.deepEqual([last.operacion, typeof last.campos === 'string' ? JSON.parse(last.campos) : last.campos, last.revision, last.estado_anterior, last.estado_nuevo, last.actor_rol], ['edicion', ['horarios'], ed.revision + 1, '0 horarios', '3 horarios', 'COORDINADORA_INSTITUCIONAL']);
      const listed = await request(H(ed.id), tokens.s); assert.equal(listed.status, 200); assert.deepEqual(listed.body.items, created.body.items, 'la secretaría consulta lo mismo');
      const same = await request(H(ed.id), tokens.g, 'PUT', { revision: ed.revision + 1, horarios: [LUN, MIE, SAB] });
      assert.equal(same.status, 200); assert.equal(same.body.cambios, false); assert.equal(await revisionOf(ed.id), ed.revision + 1, 'reenviar lo mismo no sube la revisión');
      assert.equal((await rows("SELECT COUNT(*) AS n FROM academico_historial WHERE entidad='convocatoria' AND entidad_id=?", [ed.id]))[0].n, history.length, 'ni deja historial');
      const ids = Object.fromEntries(created.body.items.map(i => [i.dia_semana, i.id]));
      const updated = await request(H(ed.id), tokens.g, 'PUT', { revision: ed.revision + 1, horarios: [LUN, { ...MIE, hora_fin: '21:30' }, SAB, { dia_semana: 6, hora_inicio: '14:00', hora_fin: '17:00' }] });
      assert.equal(updated.status, 200, updated.text);
      const byKey = Object.fromEntries(updated.body.items.map(i => [i.dia_semana + ' ' + i.hora_inicio, i]));
      assert.equal(byKey['1 19:00'].id, ids[1], 'el lunes no cambió: conserva su id'); assert.equal(byKey['6 09:00'].id, ids[6]);
      assert.notEqual(byKey['3 19:00'].id, ids[3], 'cambiar el fin es retirar y crear'); assert.equal(byKey['3 19:00'].hora_fin, '21:30');
      assert.equal(updated.body.items.length, 4, 'varios tramos el mismo día');
      const cleared = await request(H(ed.id), tokens.g, 'PUT', { revision: ed.revision + 2, horarios: [] });
      assert.equal(cleared.status, 200); assert.deepEqual(cleared.body.items, []); assert.deepEqual(await stored(ed.id), []);
      // La edición se sigue editando con la revisión nueva; con la anterior, 409.
      assert.equal((await request(E + '/' + ed.id, tokens.g, 'PUT', { revision: ed.revision + 2, capacidad: 25 })).status, 409);
      assert.equal((await request(E + '/' + ed.id, tokens.g, 'PUT', { revision: ed.revision + 3, capacidad: 25 })).status, 200);
    });

    await t.test('HTTP: validación estricta (400), horas inválidas, duplicados y solapamientos (422) sin escribir nada', async () => {
      const ed = await edition('Edición de validación');
      const ok = await request(H(ed.id), tokens.g, 'PUT', { revision: ed.revision, horarios: [LUN] }); assert.equal(ok.status, 200);
      const before = JSON.stringify(await stored(ed.id)); const revision = await revisionOf(ed.id);
      for (const body of [{}, { horarios: [LUN] }, { revision }, { revision, horarios: [{ ...LUN, dia_semana: 0 }] }, { revision, horarios: [{ ...LUN, dia_semana: 8 }] }, { revision, horarios: [{ ...LUN, dia_semana: '1' }] },
        { revision, horarios: [{ ...LUN, hora_inicio: '7:00' }] }, { revision, horarios: [{ ...LUN, hora_fin: '24:00' }] }, { revision, horarios: [{ ...LUN, hora_fin: '22:00:00' }] },
        { revision, horarios: [{ ...LUN, id: 1 }] }, { revision, horarios: [LUN], convocatoria_id: 1 }, { revision, horarios: 'lunes' }]) {
        const r = await request(H(ed.id), tokens.g, 'PUT', body); assert.equal(r.status, 400, JSON.stringify(body) + ' → ' + r.text);
      }
      const cases = [
        [[{ ...LUN, hora_inicio: '22:00', hora_fin: '19:00' }], 'HORARIO_INVALIDO'], [[{ ...LUN, hora_fin: '19:00' }], 'HORARIO_INVALIDO'],
        [[LUN, LUN], 'HORARIO_DUPLICADO'], [[LUN, { ...LUN, hora_fin: '21:00' }], 'HORARIO_SOLAPADO'], [[LUN, { dia_semana: 1, hora_inicio: '20:00', hora_fin: '23:00' }], 'HORARIO_SOLAPADO'],
        [[SAB, { dia_semana: 6, hora_inicio: '10:00', hora_fin: '11:00' }], 'HORARIO_SOLAPADO'],
      ];
      for (const [horarios, codigo] of cases) {
        const r = await request(H(ed.id), tokens.g, 'PUT', { revision, horarios }); assert.equal(r.status, 422, r.text); assert.equal(r.body.codigo, codigo, r.text);
      }
      assert.equal(JSON.stringify(await stored(ed.id)), before, 'ningún rechazo escribió nada'); assert.equal(await revisionOf(ed.id), revision);
      const consecutive = await request(H(ed.id), tokens.g, 'PUT', { revision, horarios: [{ dia_semana: 1, hora_inicio: '09:00', hora_fin: '12:00' }, { dia_semana: 1, hora_inicio: '12:00', hora_fin: '14:00' }, LUN] });
      assert.equal(consecutive.status, 200, 'tramos consecutivos el mismo día no se solapan: ' + consecutive.text);
    });

    await t.test('HTTP: permisos reales (AccessGuard): leer con convocatorias:leer, reemplazar con convocatorias:editar; 401 sin sesión y 404 sin edición', async () => {
      const ed = await edition('Edición de permisos');
      for (const [token, get, put] of [[tokens.g, 200, 200], [tokens.c, 200, 409], [tokens.s, 200, 403], [tokens.b, 403, 403], [null, 401, 401]]) {
        assert.equal((await request(H(ed.id), token)).status, get, 'GET ' + String(token && Object.keys(tokens).find(k => tokens[k] === token)));
        assert.equal((await request(H(ed.id), token, 'PUT', { revision: ed.revision, horarios: [LUN] })).status, put, 'PUT ' + String(token && Object.keys(tokens).find(k => tokens[k] === token)));
      }
      assert.equal((await stored(ed.id)).length, 1, 'solo el gerente escribió (la coordinadora llegó después con una revisión ya usada: 409)');
      assert.equal((await request(H(999999), tokens.g)).status, 404); assert.equal((await request(H(999999), tokens.g, 'PUT', { revision: 1, horarios: [] })).status, 404);
      assert.equal((await request(H('abc'), tokens.g)).status, 400);
      for (const path of ['/admin/sesiones', '/admin/sesiones/1', E + '/' + ed.id + '/sesiones']) assert.equal((await request(path, tokens.g)).status, 404, 'Sesiones retirado: ' + path);
    });

    await t.test('HTTP: una edición cancelada o archivada no cambia sus horarios (409); una cerrada sí', async () => {
      const closing = await edition('Edición cerrada');
      await validatedPreinscripciones(db, closing.id, 10, 'hor-cerrada');
      const opened = await request(E + '/' + closing.id + '/apertura', tokens.g, 'PUT', { revision: closing.revision }); assert.equal(opened.status, 200, opened.text);
      const closed = await request(E + '/' + closing.id + '/cierre', tokens.g, 'PUT', { revision: opened.body.item.revision, estado: 'cerrada' }); assert.equal(closed.status, 200, closed.text);
      assert.equal((await request(H(closing.id), tokens.g, 'PUT', { revision: closed.body.item.revision, horarios: [SAB] })).status, 200, 'cerrada: sigue dictándose');
      const cancel = await edition('Edición cancelada');
      const cancelled = await request(E + '/' + cancel.id + '/cierre', tokens.g, 'PUT', { revision: cancel.revision, estado: 'cancelada' }); assert.equal(cancelled.status, 200, cancelled.text);
      assert.equal((await request(H(cancel.id), tokens.g, 'PUT', { revision: cancelled.body.item.revision, horarios: [LUN] })).status, 409);
      const archived = await request(E + '/' + cancel.id + '/archivo', tokens.g, 'PUT', { revision: cancelled.body.item.revision, archivado: true }); assert.equal(archived.status, 200, archived.text);
      assert.equal((await request(H(cancel.id), tokens.g, 'PUT', { revision: archived.body.item.revision, horarios: [LUN] })).status, 409);
      const view = await request(H(cancel.id), tokens.s); assert.deepEqual([view.body.convocatoria.archivada, view.body.convocatoria.modificable], [true, false]);
      assert.deepEqual(await stored(cancel.id), []);
    });

    await t.test('HTTP: concurrencia real: dos reemplazos simultáneos con la misma revisión → uno gana y el otro 409; también frente a editar la edición', async () => {
      for (let round = 0; round < 5; round++) {
        const ed = await edition('Edición concurrente ' + round);
        const [a, b] = await Promise.all([
          request(H(ed.id), tokens.g, 'PUT', { revision: ed.revision, horarios: [LUN] }),
          request(H(ed.id), tokens.c, 'PUT', { revision: ed.revision, horarios: [MIE, SAB] }),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409], 'ronda ' + round + ': ' + a.text + ' / ' + b.text);
        const winner = a.status === 200 ? a : b;
        assert.deepEqual((await stored(ed.id)).map(r => r.dia_semana), winner.body.items.map(i => i.dia_semana), 'el estado final es exactamente el del ganador (sin mezclas)');
        assert.equal(await revisionOf(ed.id), ed.revision + 1, 'la revisión sube una sola vez');
        const [h, e] = await Promise.all([
          request(H(ed.id), tokens.g, 'PUT', { revision: ed.revision + 1, horarios: [SAB] }),
          request(E + '/' + ed.id, tokens.c, 'PUT', { revision: ed.revision + 1, capacidad: 30 }),
        ]);
        assert.deepEqual([h.status, e.status].sort(), [200, 409], 'horarios frente a edición, ronda ' + round + ': ' + h.text + ' / ' + e.text);
        assert.equal(await revisionOf(ed.id), ed.revision + 2);
      }
    });

    await t.test('HTTP: atomicidad: si falla el historial, no queda ningún cambio de horarios ni de revisión', async () => {
      const ed = await edition('Edición atómica');
      const first = await request(H(ed.id), tokens.g, 'PUT', { revision: ed.revision, horarios: [LUN, MIE] }); assert.equal(first.status, 200);
      const before = JSON.stringify(await stored(ed.id)), revision = await revisionOf(ed.id);
      await db.query("CREATE TRIGGER horarios_historial_fallo BEFORE INSERT ON academico_historial FOR EACH ROW BEGIN IF NEW.entidad='convocatoria' AND JSON_CONTAINS(NEW.campos, '\"horarios\"') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio de auditoría'; END IF; END");
      try {
        const failed = await request(H(ed.id), tokens.g, 'PUT', { revision, horarios: [SAB] }); assert.equal(failed.status, 500, failed.text);
        assert.equal(JSON.stringify(await stored(ed.id)), before, 'los tramos anteriores siguen intactos (ni borrados ni añadidos)'); assert.equal(await revisionOf(ed.id), revision);
      } finally { await db.query('DROP TRIGGER horarios_historial_fallo'); }
      assert.equal((await request(H(ed.id), tokens.g, 'PUT', { revision, horarios: [SAB] })).status, 200, 'sin el fallo todo vuelve a funcionar');
    });

    await t.test('errores controlados: nada de SQL, Prisma ni trazas, y 503 neutro si faltara la tabla (migración pendiente)', async () => {
      assert.ok(leaks.length > 20, 'se recogieron respuestas de error para revisar (' + leaks.length + ')');
      for (const text of leaks) assert.ok(!LEAK.test(text), 'respuesta de error con detalles internos: ' + text.slice(0, 160));
      const ed = await edition('Edición sin tabla');
      await db.query('RENAME TABLE convocatoria_horarios TO convocatoria_horarios_oculta');
      try {
        const listed = await request(H(ed.id), tokens.g); assert.equal(listed.status, 503, listed.text); assert.match(listed.body.message, /^La gestión de horarios no está disponible/);
        assert.equal((await request(H(ed.id), tokens.g, 'PUT', { revision: ed.revision, horarios: [LUN] })).status, 503);
        assert.equal((await request(E + '/' + ed.id, tokens.g)).status, 200, 'el resto de Ediciones sigue funcionando');
        assert.ok(!LEAK.test(listed.text));
      } finally { await db.query('RENAME TABLE convocatoria_horarios_oculta TO convocatoria_horarios'); }
      assert.equal((await request(H(ed.id), tokens.g)).status, 200);
    });

    t.diagnostic('Bases ficticias conservadas en el servidor desechable hasta retirar el contenedor propio.');
  } finally {
    if (api?.connected) { const exited = new Promise(resolve => api.once('exit', resolve)); api.disconnect(); await exited; }
    for (const client of clients) { try { await client.end(); } catch { /* ya cerrada */ } }
    await admin.end();
    for (const dir of [cwd, apiCwd]) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporal propio: se ignora si Windows aún lo retiene */ } }
  }
});
