// Preinscripciones académicas (20261020-preinscripciones) contra MySQL 8.4 u 8.0.46 REAL y DESECHABLE: migración desde una base previa con
// datos, recuperación ante fallos parciales, restricciones de la base, HTTP real con AccessGuard, ambos canales, consentimiento,
// duplicados, límite de frecuencia compartido entre DOS instancias de la API, mínimo de 10 validadas, apertura confirmada, recepción
// posterior a la apertura, capacidad, conversión a matrícula (estudiante nuevo y existente, matrícula anulada, concurrencia y reversión
// transaccional), permisos por rol, privacidad y compatibilidad con Sesiones, Docentes, Contacto, Chatbot y Cotizaciones.
// No forma parte de `npm test`. Requiere `npm run build` (arranca backend/dist).
//
//   npm run build && node test/run-academic-isolated.cjs preinscripciones
//
// Barreras (las mismas que Docentes y Sesiones; todas antes de crear nada): PREINSCRIPCIONES_TEST_DB=true explícito, DB_HOST de bucle
// local, @@server_uuid igual al del contenedor propio (obtenido por docker exec), servidor recién creado (Uptime < 1 h) y sin bases ajenas.
// Solo crea bases horus_preins_it_<hex>. Datos ficticios; jamás toca horus_db ni horus_local. No envía correo: la API no tiene credenciales.
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
const { validatedPreinscripciones } = require('./fixtures/preinscripciones-fixture.cjs');

const backend = join(__dirname, '..');
const versions = JSON.parse(readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const MIGRATION = '20261020-preinscripciones';
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NEW_TABLES = ['preinscripciones', 'preinscripciones_historial'];
// Migraciones registradas DESPUÉS de esta (db:migrate completo también las aplica): sus tablas no son parte de lo que verifica esta suite.
const LATER_TABLES = ['convocatoria_horarios'];
const statementsOf = name => readFileSync(join(backend, 'migrations', name + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean); // criterio de migrate.cjs
const PERSONAL = /@preinscripciones\.test|\b9[0-9]00\d{5}\b|Ficticia Persona|Existente\d|Identidad\d|Coincidente|Verificada/i; // marcador de TODOS los datos personales de esta prueba

test('Preinscripciones: migración, restricciones, HTTP, canales, mínimo de 10, conversión a matrícula, concurrencia, privacidad y compatibilidad en MySQL desechable', { timeout: 1800000 }, async t => {
  if (process.env.PREINSCRIPCIONES_TEST_DB !== 'true') return t.skip('Requiere PREINSCRIPCIONES_TEST_DB=true y un servidor desechable identificado por UUID.');
  assert.ok(versions.includes(MIGRATION), 'la migración está registrada en migrate.cjs');
  assert.ok(versions.indexOf(MIGRATION) > versions.indexOf('20261020-docentes'), 'va después de docentes');
  assert.ok(!versions.includes('20261020-sesiones-academicas'), 'no depende de la migración retirada de sesiones');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  const expectedUuid = String(process.env.PREINSCRIPCIONES_TEST_SERVER_UUID ?? '').trim().toLowerCase();
  assert.match(expectedUuid, /^[0-9a-f-]{36}$/);
  const credentials = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS, timezone: 'Z', dateStrings: true };
  const admin = await mysql.createConnection(credentials);
  const q = async (sql, params) => (await admin.query(sql, params))[0];
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-preins-'));
  const apiCwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-preins-api-'));
  const clients = [], apis = [];
  const leaks = []; // cuerpos de error HTTP: ninguno puede mostrar SQL, Prisma, trazas ni datos personales
  let apiLog = ''; // salida de las APIs: ningún dato personal
  try {
    const [{ uuid, uptime, version }] = await q("SELECT @@server_uuid AS uuid, VERSION() AS version, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime') AS uptime");
    assert.equal(String(uuid).toLowerCase(), expectedUuid, 'el servidor conectado no es el servidor desechable identificado');
    assert.match(version, process.env.HORUS_IT_MYSQL_IMAGE === 'mysql:8.0.46' ? /^8\.0\.46/ : /^8\.4\./, 'versión del servidor desechable esperado');
    assert.ok(Number(uptime) < 3600, 'servidor recién creado');
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
    const createDb = async () => { const name = 'horus_preins_it_' + randomBytes(12).toString('hex'); assert.match(name, /^horus_preins_it_[0-9a-f]{24}$/); await q('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); return name; };
    const runSql = async (db, version) => { for (const sql of statementsOf(version)) await db.query(sql); };
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
    const rejects = async (promise, errno, name) => {
      let error = null; try { await promise; } catch (e) { error = e; }
      assert.ok(error, 'se esperaba un rechazo');
      assert.equal(error.errno, errno, 'errno ' + error.errno + ' ' + String(error.sqlMessage).slice(0, 140));
      if (name) assert.ok(String(error.sqlMessage).includes(name), 'se esperaba «' + name + '» y llegó ' + String(error.sqlMessage).slice(0, 140));
    };
    const LEGACY_EDITION_COLUMNS = 'id,curso_id,nombre,fecha_inicio,fecha_fin,estado,capacidad,archivado_at,revision,createdAt,updatedAt';

    // ---------------------------------------------------------------------------------------------------------------------
    const { name, db } = await databaseBefore();
    const hash = await bcrypt.hash('Ficticia-preins-1', 10);
    for (const [key, rol] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]])
      await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta ficticia', key + '@preins.test', hash, rol]);
    await db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Excel Básico','excel-preins-it','Curso ficticio','curso','presencial','20 horas','publicado',NOW(),NOW()),('Seguridad Eléctrica','seguridad-preins-it','Capacitación ficticia','capacitacion',NULL,NULL,'publicado',NOW(),NOW()),('Curso en borrador','borrador-preins-it','Aún no publicado','curso','virtual','5 horas','borrador',NOW(),NOW())");
    await db.query("INSERT INTO convocatorias (curso_id,nombre,fecha_inicio,fecha_fin,estado,capacidad) VALUES (1,'Edición anterior 1','2026-03-01','2026-03-30','cerrada',10),(2,'Edición anterior 2',NULL,NULL,'planificada',NULL)");
    await db.query("INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero,email) VALUES ('Persona','Anterior','PE','DNI','00123456','anterior@preins.test')");
    await db.query('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (1,1)');
    await db.query("INSERT INTO academico_historial (entidad,entidad_id,operacion,origen,actor_id,actor_rol,campos,revision) VALUES ('convocatoria',1,'creacion','panel',1,'GERENTE_GENERAL',JSON_ARRAY('nombre'),1),('matricula',1,'creacion','panel',1,'GERENTE_GENERAL',JSON_ARRAY('estado'),1)");
    await db.query("INSERT INTO rate_limit_buckets (id,count,expiresAt) VALUES ('previo',1,DATE_ADD(NOW(), INTERVAL 1 HOUR))");

    await t.test('migración desde una base previa con datos: db:check la exige, se aplica una sola vez, conserva las ediciones anteriores y no pierde nada', async () => {
      const pending = await runScript('check-database.cjs', name);
      assert.equal(pending.code, 1);
      assert.ok(pending.output.includes('preinscripciones.id: falta') && pending.output.includes('convocatorias.minimo_apertura: falta') && pending.output.includes('matriculas: falta índice matriculas_id_relaciones_uq'), pending.output);
      const before = await snapshot(db, ['horus_migrations']);
      const legacy = (await db.query('SELECT ' + LEGACY_EDITION_COLUMNS + ' FROM convocatorias ORDER BY id'))[0];
      const applied = await runScript('migrate.cjs', name);
      assert.equal(applied.code, 0, applied.output);
      const schema = await runScript('check-database.cjs', name);
      assert.equal(schema.code, 0, schema.output); assert.match(schema.output, /Esquema compatible/);
      const after = await snapshot(db, ['horus_migrations', ...NEW_TABLES, ...LATER_TABLES]);
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no se crean ni eliminan otras tablas');
      for (const table of Object.keys(before)) {
        if (['convocatorias', 'matriculas'].includes(table)) continue;
        assert.equal(after[table].ddl, before[table].ddl, table + ': definición sin cambios');
        assert.equal(after[table].rows, before[table].rows, table + ': filas idénticas');
      }
      assert.equal(after.academico_historial.ddl, before.academico_historial.ddl, 'el ENUM del historial académico NO se toca: las preinscripciones tienen historial propio');
      // convocatorias y matriculas solo ganan lo previsto; sus filas anteriores no cambian.
      assert.deepEqual((await db.query('SELECT ' + LEGACY_EDITION_COLUMNS + ' FROM convocatorias ORDER BY id'))[0], legacy, 'las ediciones anteriores conservan todos sus valores');
      assert.deepEqual((await db.query('SELECT minimo_apertura, preinscripcion_estado, codigo_publico FROM convocatorias ORDER BY id'))[0], [{ minimo_apertura: null, preinscripcion_estado: 'cerrada', codigo_publico: null }, { minimo_apertura: null, preinscripcion_estado: 'cerrada', codigo_publico: null }], 'anteriores: sin mínimo, recepción cerrada y sin código público');
      assert.equal(after.matriculas.rows, before.matriculas.rows, 'matriculas: filas idénticas');
      assert.equal(after.matriculas.ddl.replace(/,\n  UNIQUE KEY `matriculas_id_relaciones_uq` \(`id`,`estudiante_id`,`convocatoria_id`\)/, ''), before.matriculas.ddl, 'matriculas solo gana el índice único compuesto');
      assert.ok(after.convocatorias.ddl.includes('minimo_apertura') && after.convocatorias.ddl.includes('convocatorias_codigo_publico_uq'));
      for (const table of NEW_TABLES) assert.equal((await db.query('SELECT COUNT(*) AS n FROM `' + table + '`'))[0][0].n, 0, table + ' nace vacía: la migración no inserta datos');
      assert.equal((await db.query("SELECT COUNT(*) AS n FROM rate_limit_buckets WHERE id='previo'"))[0][0].n, 1);
      const again = await runScript('migrate.cjs', name);
      assert.equal(again.code, 0, again.output);
      const [registered] = await db.query('SELECT name FROM horus_migrations ORDER BY name');
      assert.deepEqual(registered.map(r => r.name), [...versions].sort(), 'cada migración registrada una sola vez');
      assert.deepEqual(await snapshot(db, ['horus_migrations', ...NEW_TABLES, ...LATER_TABLES]), after, 'repetir db:migrate no cambia nada');
    });

    await t.test('estructura real: InnoDB, claves RESTRICT incluida la compuesta, únicos, columna generada STORED y CHECK aplicados', async () => {
      const [tables] = await db.query("SELECT TABLE_NAME AS t, ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY 1", [NEW_TABLES]);
      assert.deepEqual(tables.map(r => [r.t, r.e, r.c]), [['preinscripciones', 'InnoDB', 'utf8mb4_unicode_ci'], ['preinscripciones_historial', 'InnoDB', 'utf8mb4_unicode_ci']]);
      const [fks] = await db.query("SELECT k.TABLE_NAME AS tb, k.CONSTRAINT_NAME AS c, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS cols, k.REFERENCED_TABLE_NAME AS r, GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS rc, rc.DELETE_RULE AS d, rc.UPDATE_RULE AS u FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND rc.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN (?) AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY 1,2,4,6,7 ORDER BY 1,2", [NEW_TABLES]);
      assert.deepEqual(fks.map(r => [r.tb, r.c, r.cols, r.r, r.rc, r.d, r.u].join(' ')), [
        'preinscripciones preinscripciones_convertida_por_fk convertida_por admin_users id RESTRICT RESTRICT', 'preinscripciones preinscripciones_convocatoria_fk convocatoria_id convocatorias id RESTRICT RESTRICT',
        'preinscripciones preinscripciones_matricula_fk matricula_id,estudiante_id,convocatoria_id matriculas id,estudiante_id,convocatoria_id RESTRICT RESTRICT', 'preinscripciones_historial preinscripciones_historial_fk preinscripcion_id preinscripciones id RESTRICT RESTRICT']);
      const [uniques] = await db.query("SELECT TABLE_NAME AS tb, INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('preinscripciones','convocatorias','matriculas') AND NON_UNIQUE=0 AND INDEX_NAME<>'PRIMARY' GROUP BY 1,2 ORDER BY 1,2");
      assert.deepEqual(uniques.map(r => r.tb + '.' + r.i + '(' + r.cols + ')'), ['convocatorias.convocatorias_codigo_publico_uq(codigo_publico)', 'matriculas.matriculas_estudiante_convocatoria_uq(estudiante_id,convocatoria_id)', 'matriculas.matriculas_id_relaciones_uq(id,estudiante_id,convocatoria_id)',
        'preinscripciones.preinscripciones_matricula_uq(matricula_id)', 'preinscripciones.preinscripciones_vigente_email_uq(convocatoria_id,vigente_email)']);
      const [checks] = await db.query("SELECT CONSTRAINT_NAME AS c, ENFORCED AS e FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK' AND (TABLE_NAME IN (?) OR CONSTRAINT_NAME IN ('convocatorias_minimo_chk','convocatorias_codigo_chk')) ORDER BY 1", [NEW_TABLES]);
      assert.deepEqual(checks.map(r => r.c + '=' + r.e), ['convocatorias_codigo_chk=YES', 'convocatorias_minimo_chk=YES', 'preinscripciones_contacto_chk=YES', 'preinscripciones_conversion_chk=YES', 'preinscripciones_historial_campos_chk=YES',
        'preinscripciones_historial_origen_chk=YES', 'preinscripciones_historial_revision_chk=YES', 'preinscripciones_nombres_chk=YES', 'preinscripciones_revision_chk=YES']);
      const [generated] = await db.query("SELECT COLUMN_NAME AS c, EXTRA AS e FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preinscripciones' AND (EXTRA LIKE 'STORED GENERATED%' OR EXTRA LIKE 'VIRTUAL GENERATED%')");
      assert.deepEqual(generated.map(r => r.c + ':' + r.e), ['vigente_email:STORED GENERATED']);
      const [personal] = await db.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preinscripciones_historial' AND COLUMN_NAME IN ('nombres','apellidos','email','telefono','doc_numero')");
      assert.equal(personal[0].n, 0, 'el historial no guarda datos personales');
      const [dni] = await db.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preinscripciones' AND COLUMN_NAME REGEXP 'dni|doc_|pago|comprobante|monto'");
      assert.equal(dni[0].n, 0, 'no se piden DNI, pagos ni comprobantes en la preinscripción');
    });

    await t.test('restricciones de la base rechazan datos inválidos aunque se escriba por SQL directo', async () => {
      const insertEmail = (email, estado) => db.execute("INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,estado,consentimiento_at,aviso_version) VALUES (1,'Ana','Pérez',?,'900000001','chatbot',?,NOW(3),'v1')", [email, estado]);
      await insertEmail('dup@preins.test', 'recibida');
      await rejects(insertEmail('dup@preins.test', 'validada'), 1062, 'preinscripciones_vigente_email_uq');
      await rejects(insertEmail('DUP@PREINS.TEST', 'recibida'), 1062, 'preinscripciones_vigente_email_uq'); // sin distinguir mayúsculas
      await insertEmail('dup@preins.test', 'desistida'); await insertEmail('dup@preins.test', 'descartada'); await insertEmail('dup@preins.test', 'descartada'); // los cerrados no bloquean ni se bloquean entre sí
      await rejects(insertEmail('otro@preins.test', 'borrada'), 1265);
      const [[vigente]] = await db.query("SELECT vigente_email FROM preinscripciones WHERE estado='desistida'"); assert.equal(vigente.vigente_email, null, 'la columna generada es NULL al cerrarse');
      await db.query("INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,consentimiento_at,aviso_version) VALUES (2,'Ana','Pérez','dup@preins.test','900000001','formulario',NOW(3),'v1')"); // otra edición: permitido
      for (const [sql, constraint] of [
        ["(1,'  ','X','a1@preins.test','900000001','formulario',NOW(3),'v1')", 'preinscripciones_nombres_chk'], ["(1,'X','','a2@preins.test','900000001','formulario',NOW(3),'v1')", 'preinscripciones_nombres_chk'],
        ["(1,'X','Y','  ','900000001','formulario',NOW(3),'v1')", 'preinscripciones_contacto_chk'], ["(1,'X','Y','a3@preins.test',' ','formulario',NOW(3),'v1')", 'preinscripciones_contacto_chk'], ["(1,'X','Y','a4@preins.test','900000001','formulario',NOW(3),' ')", 'preinscripciones_contacto_chk']])
        await rejects(db.query('INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,consentimiento_at,aviso_version) VALUES ' + sql), 3819, constraint);
      await rejects(db.query("INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,consentimiento_at,aviso_version) VALUES (1,'X','Y','a5@preins.test','900000001','administrativo',NOW(3),'v1')"), 1265);
      await rejects(db.query("INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,consentimiento_at) VALUES (1,'X','Y','a6@preins.test','900000001','formulario',NOW(3))"), 1364); // el aviso de privacidad aceptado es obligatorio
      await rejects(db.query("INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,aviso_version) VALUES (1,'X','Y','a7@preins.test','900000001','formulario','v1')"), 1364); // y el consentimiento tiene fecha
      await rejects(db.query("INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,consentimiento_at,aviso_version,revision) VALUES (1,'X','Y','a8@preins.test','900000001','formulario',NOW(3),'v1',0)"), 3819, 'preinscripciones_revision_chk');
      await rejects(db.query("INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,consentimiento_at,aviso_version) VALUES (999999,'X','Y','a9@preins.test','900000001','formulario',NOW(3),'v1')"), 1452, 'preinscripciones_convocatoria_fk');
      // Conversión: o todo o nada, y la matrícula DEBE ser de la misma edición y del mismo estudiante (clave foránea compuesta).
      const matricula = (await db.query('SELECT id FROM matriculas WHERE estudiante_id=1 AND convocatoria_id=1'))[0][0].id;
      const conv = (estado, ed, mat, est, by, at, email) => db.execute("INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,estado,consentimiento_at,aviso_version,matricula_id,estudiante_id,convertida_por,convertida_at) VALUES (?,'X','Y',?,'900000001','formulario',?,NOW(3),'v1',?,?,?,?)", [ed, email, estado, mat, est, by, at]);
      await rejects(conv('matriculada', 1, null, null, null, null, 'c1@preins.test'), 3819, 'preinscripciones_conversion_chk');
      await rejects(conv('matriculada', 1, matricula, 1, null, null, 'c2@preins.test'), 3819, 'preinscripciones_conversion_chk');
      await rejects(conv('validada', 1, matricula, 1, 1, new Date(), 'c3@preins.test'), 3819, 'preinscripciones_conversion_chk');
      await rejects(conv('matriculada', 2, matricula, 1, 1, new Date(), 'c4@preins.test'), 1452, 'preinscripciones_matricula_fk'); // matrícula de OTRA edición
      await db.query("INSERT INTO estudiantes (nombres,apellidos) VALUES ('Otra','Persona')");
      const other = (await db.query('SELECT MAX(id) AS id FROM estudiantes'))[0][0].id;
      await rejects(conv('matriculada', 1, matricula, other, 1, new Date(), 'c5@preins.test'), 1452, 'preinscripciones_matricula_fk'); // de OTRO estudiante
      await rejects(conv('matriculada', 1, matricula, 1, 999999, new Date(), 'c6@preins.test'), 1452);
      await conv('matriculada', 1, matricula, 1, 1, new Date(), 'c7@preins.test');
      await rejects(conv('matriculada', 1, matricula, 1, 1, new Date(), 'c8@preins.test'), 1062, 'preinscripciones_matricula_uq'); // una matrícula pertenece a lo sumo a una preinscripción
      // Nada se borra: ni la matrícula convertida, ni la edición, ni la preinscripción con historial.
      await rejects(db.query('DELETE FROM matriculas WHERE id=?', [matricula]), 1451, 'preinscripciones_matricula_fk');
      await rejects(db.query('DELETE FROM convocatorias WHERE id=2'), 1451);
      const first = (await db.query("SELECT id FROM preinscripciones WHERE email='c7@preins.test'"))[0][0].id;
      await db.query("INSERT INTO preinscripciones_historial (preinscripcion_id,operacion,actor_id,actor_rol,estado_anterior,estado_nuevo,campos,revision) VALUES (?,'conversion',1,'GERENTE_GENERAL','validada','matriculada',JSON_ARRAY('estado'),2)", [first]);
      await rejects(db.query('DELETE FROM preinscripciones WHERE id=?', [first]), 1451, 'preinscripciones_historial_fk');
      // Historial: la creación no tiene actor (la hace el visitante); todo lo demás sí; campos es un arreglo.
      const hist = (op, canal, actor, campos, rev = 1) => db.execute('INSERT INTO preinscripciones_historial (preinscripcion_id,operacion,canal,actor_id,campos,revision) VALUES (?,?,?,?,?,?)', [first, op, canal, actor, campos, rev]);
      await hist('creacion', 'chatbot', null, '["x"]');
      await rejects(hist('creacion', 'chatbot', 1, '["x"]'), 3819, 'preinscripciones_historial_origen_chk');
      await rejects(hist('creacion', null, null, '["x"]'), 3819, 'preinscripciones_historial_origen_chk');
      await rejects(hist('validacion', null, null, '["x"]'), 3819, 'preinscripciones_historial_origen_chk');
      await rejects(hist('validacion', 'formulario', 1, '["x"]'), 3819, 'preinscripciones_historial_origen_chk');
      await rejects(hist('validacion', null, 1, '{"a":1}'), 3819, 'preinscripciones_historial_campos_chk');
      await rejects(hist('validacion', null, 1, '["x"]', 0), 3819, 'preinscripciones_historial_revision_chk');
      await rejects(hist('borrado', null, 1, '["x"]'), 1265);
      // Ediciones: mínimo positivo y código público con formato; único.
      await rejects(db.query('UPDATE convocatorias SET minimo_apertura=0 WHERE id=1'), 3819, 'convocatorias_minimo_chk');
      await db.query('UPDATE convocatorias SET minimo_apertura=10 WHERE id=1');
      await rejects(db.query("UPDATE convocatorias SET codigo_publico='ABC' WHERE id=1"), 3819, 'convocatorias_codigo_chk');
      await rejects(db.query("UPDATE convocatorias SET codigo_publico=? WHERE id=1", ['G'.repeat(32)]), 3819, 'convocatorias_codigo_chk');
      await db.query("UPDATE convocatorias SET codigo_publico=? WHERE id=1", ['1'.repeat(32)]);
      await rejects(db.query("UPDATE convocatorias SET codigo_publico=? WHERE id=2", ['1'.repeat(32)]), 1062, 'convocatorias_codigo_publico_uq');
      await rejects(db.query("UPDATE convocatorias SET preinscripcion_estado='otra' WHERE id=1"), 1265);
      // Se deja la base lista para la prueba HTTP (solo filas de esta prueba, en su base propia).
      await db.query('DELETE FROM preinscripciones_historial'); await db.query('DELETE FROM preinscripciones'); await db.query('DELETE FROM estudiantes WHERE id=?', [other]);
      await db.query('UPDATE convocatorias SET minimo_apertura=NULL, codigo_publico=NULL WHERE id IN (1,2)');
    });

    await t.test('fallo parcial: cada prefijo de la migración se completa al reintentar, db:check lo detecta antes y un ALTER ya aplicado se omite', async () => {
      const statements = statementsOf(MIGRATION);
      assert.equal(statements.length, 4);
      assert.match(statements[0], /^ALTER TABLE `matriculas` ADD UNIQUE KEY/); assert.match(statements[1], /^CREATE TABLE IF NOT EXISTS `preinscripciones` \(/);
      assert.match(statements[2], /^CREATE TABLE IF NOT EXISTS `preinscripciones_historial` \(/); assert.match(statements[3], /^ALTER TABLE `convocatorias`/);
      const scenarios = [[0], [0, 1], [0, 1, 2], [3], [0, 3], [0, 1, 3]];
      for (const applied of scenarios) {
        const partial = await databaseBefore();
        await partial.db.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,estado,createdAt,updatedAt) VALUES ('Curso','parcial-" + applied.join('') + "','x','curso','publicado',NOW(),NOW())");
        await partial.db.query("INSERT INTO convocatorias (curso_id,nombre,estado) VALUES (1,'Previa','planificada')");
        const before = await snapshot(partial.db, ['horus_migrations', 'convocatorias', 'matriculas']);
        for (const index of applied) await partial.db.query(statements[index]);
        assert.equal((await runScript('check-database.cjs', partial.name)).code, 1, 'db:check detecta la migración incompleta (' + applied.join('+') + ')');
        const run = await runScript('migrate.cjs', partial.name);
        if (run.code !== 0) { const detail = await require(join(backend, 'scripts/migrate.cjs')).applySql(partial.db, MIGRATION).then(() => 'sin error en proceso', e => 'errno ' + e.errno + ' ' + String(e.sqlMessage).slice(0, 120)); assert.fail('migrate.cjs falló en el escenario ' + applied.join('+') + ': ' + detail); }
        const check = await runScript('check-database.cjs', partial.name);
        assert.equal(check.code, 0, check.output);
        const after = await snapshot(partial.db, ['horus_migrations', 'convocatorias', 'matriculas', ...NEW_TABLES, ...LATER_TABLES]);
        assert.deepEqual(after, before, 'los datos previos no cambian en la recuperación');
        assert.equal((await partial.db.query('SELECT COUNT(*) AS n FROM horus_migrations WHERE name = ?', [MIGRATION]))[0][0].n, 1);
      }
      // Una tabla preexistente con otra forma no se corrige en silencio: CREATE TABLE IF NOT EXISTS la omite y db:check la rechaza.
      const alien = await databaseBefore();
      await alien.db.query('CREATE TABLE `preinscripciones` (`id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY, `nombres` VARCHAR(50) NOT NULL) ENGINE=InnoDB');
      await runScript('migrate.cjs', alien.name);
      const rejected = await runScript('check-database.cjs', alien.name);
      assert.equal(rejected.code, 1); assert.ok(rejected.output.includes('preinscripciones.convocatoria_id: falta') || rejected.output.includes('preinscripciones.nombres: tipo distinto'), rejected.output);
      // Una columna con el mismo nombre pero otro tipo tampoco pasa db:check aunque el ALTER se omita.
      const wrong = await databaseBefore();
      await wrong.db.query('ALTER TABLE convocatorias ADD COLUMN minimo_apertura VARCHAR(5) NULL');
      await runScript('migrate.cjs', wrong.name);
      const wrongCheck = await runScript('check-database.cjs', wrong.name);
      assert.equal(wrongCheck.code, 1); assert.ok(wrongCheck.output.includes('convocatorias.minimo_apertura: tipo distinto') || wrongCheck.output.includes('convocatorias.preinscripcion_estado: falta'), wrongCheck.output);
    });

    // ---- HTTP real -----------------------------------------------------------------------------------------------------
    const startApi = async () => {
      const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
      const child = fork(join(__dirname, 'fixtures/access-guard-app.cjs'), [], { cwd: apiCwd, windowsHide: true, silent: true,
        execArgv: ['-r', join(__dirname, 'isolate-env.cjs')], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development', DB_HOST: credentials.host, DB_PORT: String(credentials.port), DB_USER: credentials.user, DB_PASS: credentials.password, DB_NAME: name,
          JWT_SECRET: secret, PORT: String(port), MAIL_PROVIDER: 'gmail', HORUS_ACCESS_GUARD_FIXTURE: 'e36',
          TRUSTED_PROXY_CIDRS: '127.0.0.1/32' } }); // el cliente de pruebas hace de proxy: añade X-Forwarded-For como Caddy y solo confía en ese salto
      child.stdout.on('data', c => { apiLog += c; }); child.stderr.on('data', c => { apiLog += c; });
      apis.push(child);
      const ready = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('API de prueba no inició')), 40000); child.once('message', m => { clearTimeout(timer); resolve(m); }); child.once('exit', () => { clearTimeout(timer); reject(new Error('API de prueba terminó antes de iniciar')); }); });
      return 'http://127.0.0.1:' + ready.port + '/api';
    };
    const secret = randomBytes(32).toString('hex');
    const baseA = await startApi(), baseB = await startApi(); // dos instancias de la misma API contra la misma base
    const call = (base, tracked = true, extraHeaders = {}) => async (path, token, method = 'GET', body) => {
      const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...extraHeaders, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* cuerpo no JSON */ }
      if (r.status >= 400 && tracked) leaks.push(text);
      return { status: r.status, body: json, text };
    };
    const request = call(baseA), requestB = call(baseB);
    // Visitante «desde» una IP concreta, a través de la instancia A o B (X-Forwarded-For lo añade el «proxy» de confianza que es este cliente).
    const fromA = ip => call(baseA, true, { 'X-Forwarded-For': ip }), fromB = ip => call(baseB, true, { 'X-Forwarded-For': ip });
    const tokens = {};
    for (const key of ['g', 'c', 's', 'b']) { const r = await request('/admin/login', null, 'POST', { email: key + '@preins.test', password: 'Ficticia-preins-1' }); assert.equal(r.status, 200); tokens[key] = r.body.token; }
    const ids = {}; for (const key of ['g', 'c', 's', 'b']) ids[key] = (await db.query('SELECT id FROM admin_users WHERE email=?', [key + '@preins.test']))[0][0].id;
    const E = '/admin/convocatorias', P = '/admin/preinscripciones';
    const rows = async (sql, params) => (await db.query(sql, params))[0];
    const clear = () => db.query('DELETE FROM rate_limit_buckets');
    let seq = 0;
    const person = (patch = {}) => { seq++; return { nombres: 'Ficticia' + seq, apellidos: 'Persona', email: 'p' + seq + '@preinscripciones.test', telefono: '9000' + String(10000 + seq), consentimiento: true, ...patch }; };
    // Edición por API (mínimo 10, recepción cerrada al nacer). reception habilita la recepción; el resto de parámetros solo prepara la edición.
    const edition = async (nombre, { curso_id = 1, capacidad = 20, reception = true } = {}) => {
      const r = await request(E, tokens.g, 'POST', { curso_id, nombre, fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad }); assert.equal(r.status, 201, r.text);
      if (!reception) return r.body.item;
      const e = await request(E + '/' + r.body.item.id + '/preinscripcion', tokens.g, 'PUT', { revision: r.body.item.revision, estado: 'abierta' }); assert.equal(e.status, 200, e.text); return e.body.item;
    };
    // Edición anterior a la migración, escrita por SQL (mínimo NULL): abierta o no, con la recepción que se indique y un código público.
    const legacy = async (nombre, { estado = 'abierta', capacidad = 5, reception = 'abierta', curso_id = 1, minimo = null, archivado = false } = {}) => {
      const code = randomBytes(16).toString('hex');
      const [r] = await db.execute('INSERT INTO convocatorias (curso_id,nombre,fecha_inicio,fecha_fin,estado,capacidad,preinscripcion_estado,codigo_publico,minimo_apertura,archivado_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [curso_id, nombre, '2026-11-01', '2026-11-30', estado, capacidad, reception, code, minimo, archivado ? new Date() : null]);
      return { id: r.insertId, codigo_publico: code, revision: 1 };
    };
    const register = (ed, patch = {}, channel = 'formulario', fn = request) => fn(channel === 'formulario' ? '/preinscripciones' : '/chatbot/preinscripcion', null, 'POST', { convocatoria: ed.codigo_publico, ...person(), ...(channel === 'chatbot' ? { confirmacion: true } : {}), ...patch });
    const fresh = async (ed, patch, channel) => { await clear(); return register(ed, patch, channel); }; // cada intento con la cuota limpia: la guard cuenta también los intentos inválidos
    const sign = async (ed, n, channel = 'formulario') => { const created = []; for (let i = 0; i < n; i++) { if (i % 4 === 0) await clear(); const r = await register(ed, {}, channel); assert.equal(r.status, 201, r.text); created.push(seq); } return created; };
    const list = ed => rows('SELECT * FROM preinscripciones WHERE convocatoria_id=? ORDER BY id', [ed.id]);
    const get = (id, token = tokens.g) => request(P + '/' + id, token);
    const act = (id, action, body, token = tokens.g, method = 'PUT') => request(P + '/' + id + '/' + action, token, method, body);
    const validated = async (ed, count) => { await clear(); const people = []; for (let i = 0; i < count; i++) { if (i % 4 === 0) await clear(); const body = { ...person() }; const r = await register(ed, body); assert.equal(r.status, 201, r.text); people.push(body); } const found = await list(ed); const out = []; for (const row of found) { const v = await act(row.id, 'validacion', { revision: row.revision }); assert.equal(v.status, 200, v.text); out.push(v.body.item); } return out; };
    const open = async ed => { const current = (await request(E + '/' + ed.id, tokens.g)).body.item; return request(E + '/' + ed.id + '/apertura', tokens.g, 'PUT', { revision: current.revision }); };
    // Edición abierta (cumpliendo la regla real: 10 validadas) con capacidad para el resto de las pruebas.
    const openEdition = async (nombre, capacidad = 40) => { const ed = await edition(nombre, { capacidad }); const items = await validated(ed, 10); const r = await open(ed); assert.equal(r.status, 200, r.text); return { ed: r.body.item, items }; };
    const student = async (n, extra = {}) => { const r = await request('/admin/estudiantes', tokens.g, 'POST', { nombres: 'Estudiante' + n, apellidos: 'Previo', doc_numero: String(70000000 + n), ...extra }); assert.equal(r.status, 201, r.text); return r.body.item; };
    const counts = async () => (await rows('SELECT (SELECT COUNT(*) FROM estudiantes) AS e, (SELECT COUNT(*) FROM matriculas) AS m, (SELECT COUNT(*) FROM academico_historial) AS h, (SELECT COUNT(*) FROM preinscripciones_historial) AS ph, (SELECT COUNT(*) FROM preinscripciones WHERE estado=\'matriculada\') AS pm'))[0];
    const convert = (id, body, token = tokens.s) => act(id, 'conversion', body, token, 'POST');

    await t.test('H-04: más de 50 llenas no ocultan disponibles; cursor con fechas nulas/iguales, límite y contrato público reales', async () => {
      const fixtures = [];
      try {
        // Las dos ediciones anteriores tienen recepción cerrada. Las primeras 60 candidatas de esta prueba están llenas.
        // Matrículas anuladas en las siguientes no consumen cupo; el orden NULL/fecha/id se contrasta con valores esperados.
        for (let i = 0; i < 123; i++) {
          const ed = await legacy('H04 ficticia ' + i, { capacidad: 1 });
          fixtures.push(ed);
          const date = i < 63 ? null : i < 90 ? '2026-01-02' : '2026-01-03';
          await db.execute('UPDATE convocatorias SET fecha_inicio=?, fecha_fin=NULL WHERE id=?', [date, ed.id]);
          await db.execute('INSERT INTO matriculas (estudiante_id,convocatoria_id,estado) VALUES (1,?,?)', [ed.id, i < 60 ? 'activa' : 'anulada']);
        }
        const expected = fixtures.slice(60, 110).map((ed, offset) => ({
          codigo: ed.codigo_publico, nombre: 'H04 ficticia ' + (offset + 60), apertura_confirmada: true,
          fecha_inicio: offset < 3 ? null : offset < 30 ? '2026-01-02' : '2026-01-03', fecha_fin: null,
          curso: { titulo: 'Excel Básico', tipo: 'curso', modalidad: 'presencial', duracion: '20 horas' },
        }));
        for (const fn of [request, requestB]) {
          const response = await fn('/preinscripciones/convocatorias');
          assert.equal(response.status, 200);
          assert.deepEqual(response.body, { ok: true, items: expected }, '50 disponibles en orden, sin ids, capacidad ni conteos internos');
        }
        // Dejar una sola disponible después de las 60 llenas: nunca debe aparecer una lista falsamente vacía.
        await db.query('UPDATE convocatorias SET preinscripcion_estado=\'cerrada\' WHERE id IN (?)', [fixtures.slice(60, 122).map(ed => ed.id)]);
        const last = await request('/preinscripciones/convocatorias');
        assert.equal(last.status, 200);
        assert.deepEqual(last.body.items.map(ed => ed.codigo), [fixtures[122].codigo_publico]);
        await db.query('UPDATE convocatorias SET preinscripcion_estado=\'cerrada\' WHERE id=?', [fixtures[122].id]);
        assert.deepEqual((await request('/preinscripciones/convocatorias')).body, { ok: true, items: [] });
      } finally {
        if (fixtures.length) {
          const ids = fixtures.map(ed => ed.id);
          await db.query('DELETE FROM matriculas WHERE convocatoria_id IN (?)', [ids]);
          await db.query('DELETE FROM convocatorias WHERE id IN (?)', [ids]);
        }
      }
    });

    await t.test('permisos: sin JWT 401, cuenta básica 403, gerente/coordinación/secretaría pasan; recepción y apertura solo gerente y coordinación', async () => {
      const routes = [['GET', P], ['GET', P + '/resumen'], ['GET', P + '/999999'], ['GET', P + '/999999/historial'], ['PATCH', P + '/999999', { revision: 1, nombres: 'X' }], ['PUT', P + '/999999/validacion', { revision: 1 }],
        ['PUT', P + '/999999/descarte', { revision: 1, motivo: 'x' }], ['PUT', P + '/999999/desistimiento', { revision: 1 }], ['POST', P + '/999999/conversion', { revision: 1, doc_numero: '12345678' }]];
      const before = await counts();
      for (const [method, path, body] of routes) {
        assert.equal((await request(path, null, method, body)).status, 401, 'sin sesión ' + method + ' ' + path);
        assert.equal((await request(path, 'basura', method, body)).status, 401, 'JWT inválido ' + method + ' ' + path);
        assert.equal((await request(path, tokens.b, method, body)).status, 403, 'cuenta sin rol ' + method + ' ' + path);
        for (const key of ['g', 'c', 's']) assert.ok(![401, 403].includes((await request(path, tokens[key], method, body)).status), key + ' ' + method + ' ' + path);
      }
      for (const path of ['/preinscripciones/1', '/preinscripciones/resumen', '/admin/preinscripciones/1']) assert.ok([401, 404].includes((await request(path)).status), path);
      for (const suffix of ['/preinscripcion', '/apertura']) {
        const body = suffix === '/apertura' ? { revision: 1 } : { revision: 1, estado: 'abierta' };
        assert.equal((await request(E + '/999999' + suffix, tokens.s, 'PUT', body)).status, 403, 'secretaría ' + suffix);
        assert.equal((await request(E + '/999999' + suffix, tokens.b, 'PUT', body)).status, 403, 'sin rol ' + suffix);
        for (const key of ['g', 'c']) assert.equal((await request(E + '/999999' + suffix, tokens[key], 'PUT', body)).status, 404, key + ' ' + suffix);
      }
      assert.deepEqual(await counts(), before, 'las denegaciones no escriben nada');
      assert.equal((await request(P + '/1', tokens.g, 'DELETE')).status, 404, 'no existe el borrado físico');
    });

    await t.test('canales: el formulario y el chatbot usan el mismo servicio; el servidor fija el canal y la respuesta es idéntica, sin ids ni datos', async () => {
      await clear();
      const ed = await edition('Edición de canales');
      const form = await register(ed, {}, 'formulario');
      const chat = await register(ed, {}, 'chatbot');
      assert.equal(form.status, 201, form.text); assert.equal(chat.status, 201, chat.text);
      assert.deepEqual(form.body, chat.body); assert.deepEqual(Object.keys(form.body).sort(), ['mensaje', 'ok']);
      assert.ok(!PERSONAL.test(form.text) && !/"id"|estado|recibida/i.test(form.text));
      const saved = await list(ed);
      assert.deepEqual(saved.map(r => r.canal), ['formulario', 'chatbot']);
      for (const row of saved) { assert.equal(row.estado, 'recibida'); assert.equal(row.revision, 1); assert.equal(row.aviso_version, 'preinscripcion-v1'); assert.ok(row.consentimiento_at); assert.equal(row.matricula_id, null); assert.equal(row.estudiante_id, null); }
      const hist = await rows('SELECT * FROM preinscripciones_historial ORDER BY id DESC LIMIT 2');
      assert.deepEqual(hist.map(h => [h.operacion, h.actor_id, h.estado_nuevo, h.revision]).sort(), [['creacion', null, 'recibida', 1], ['creacion', null, 'recibida', 1]]);
      assert.deepEqual(hist.map(h => h.canal).sort(), ['chatbot', 'formulario']);
      assert.ok(!PERSONAL.test(JSON.stringify(hist)), 'el historial no contiene datos personales');
      // El cliente no elige origen ni estado ni nada administrativo, ni entrega datos que no se recogen.
      await clear();
      for (const extra of [{ canal: 'chatbot' }, { origen: 'panel' }, { estado: 'validada' }, { convocatoria_id: ed.id }, { id: 1 }, { dni: '12345678' }, { doc_numero: '12345678' }, { pago: 'S/ 10' }, { comprobante: 'x' }]) {
        const r = await fresh(ed, extra); assert.equal(r.status, 400, JSON.stringify(extra)); assert.ok(!PERSONAL.test(r.text), 'el error no repite datos');
      }
      assert.equal((await fresh(ed, {}, 'formulario')).status, 201);
      assert.equal((await fresh(ed, { confirmacion: true }, 'formulario')).status, 400, 'el formulario no admite «confirmacion»');
      assert.equal((await fresh(ed, { confirmacion: undefined }, 'chatbot')).status, 400, 'el chatbot exige que el visitante confirme sus datos');
      assert.equal((await fresh(ed, { confirmacion: false }, 'chatbot')).status, 400);
    });

    await t.test('consentimiento y validaciones: sin consentimiento explícito no se guarda nada y no se inventan longitudes mínimas', async () => {
      await clear();
      const ed = await edition('Edición de validaciones');
      const before = (await list(ed)).length;
      for (const patch of [{ consentimiento: false }, { consentimiento: 'true' }, { consentimiento: 1 }, { consentimiento: undefined }, { nombres: '   ' }, { apellidos: '' }, { telefono: 'abc' }, { telefono: '' }, { email: 'sin-arroba' }, { email: 'a'.repeat(250) + '@x.pe' }, { convocatoria: '1' }, { convocatoria: 'Z'.repeat(32) }, { nombres: 'a'.repeat(121) }]) {
        const r = await fresh(ed, patch); assert.equal(r.status, 400, JSON.stringify(patch).slice(0, 80)); assert.ok(!PERSONAL.test(r.text), 'el 400 no repite datos personales');
      }
      assert.equal((await list(ed)).length, before, 'ninguna solicitud inválida deja rastro');
      await clear();
      const one = await register(ed, { nombres: 'A', apellidos: 'B', telefono: '9' }); assert.equal(one.status, 201, 'un solo carácter es válido: no hay longitudes mínimas inventadas');
      const row = (await list(ed))[0]; assert.equal(row.nombres, 'A');
      const trimmed = await register(ed, { nombres: '  Con espacios  ', email: '  MAYUS' + seq + '@Preinscripciones.TEST ' }); assert.equal(trimmed.status, 201);
      const saved = (await list(ed)).at(-1); assert.equal(saved.nombres, 'Con espacios'); assert.equal(saved.email, saved.email.trim().toLowerCase());
    });

    await t.test('duplicados: la misma persona no se duplica, la respuesta no revela que ya estaba inscrita y tras desistir puede volver a preinscribirse', async () => {
      await clear();
      const ed = await edition('Edición de duplicados');
      const body = person();
      const first = await register(ed, body); const second = await register(ed, { ...body, email: body.email.toUpperCase() }); const third = await register(ed, body, 'chatbot');
      assert.equal(first.status, 201); assert.equal(second.status, 201); assert.equal(third.status, 201);
      assert.deepEqual(second.body, first.body); assert.deepEqual(third.body, first.body); assert.equal(second.text, first.text, 'cuerpos idénticos byte a byte');
      assert.equal((await list(ed)).length, 1, 'una sola preinscripción vigente');
      await clear();
      const other = await edition('Otra edición de duplicados');
      assert.equal((await register(other, body)).status, 201); assert.equal((await list(other)).length, 1, 'la misma persona puede preinscribirse en otra edición');
      // Carreras: cinco solicitudes simultáneas de la misma persona dejan una sola fila.
      await clear();
      const same = person();
      const race = await Promise.all(Array.from({ length: 5 }, () => register(ed, same)));
      assert.deepEqual(race.map(r => r.status), [201, 201, 201, 201, 201]); assert.equal(new Set(race.map(r => r.text)).size, 1);
      assert.equal((await rows('SELECT COUNT(*) AS n FROM preinscripciones WHERE convocatoria_id=? AND email=?', [ed.id, same.email]))[0].n, 1);
      // Tras desistir, la misma persona puede volver; ambas filas se conservan.
      const row = (await list(ed))[0];
      assert.equal((await act(row.id, 'desistimiento', { revision: row.revision, motivo: 'Ya no puede asistir' })).status, 200);
      await clear();
      assert.equal((await register(ed, body)).status, 201);
      assert.deepEqual((await rows('SELECT estado FROM preinscripciones WHERE convocatoria_id=? AND email=? ORDER BY id', [ed.id, body.email])).map(r => r.estado), ['desistida', 'recibida']);
    });

    await t.test('límite de frecuencia: 5 por minuto por IP compartidos entre formulario, chatbot y DOS instancias de la API (cuota en MySQL)', async () => {
      const ed = await edition('Edición de frecuencia');
      await clear();
      const results = [];
      for (let i = 0; i < 6; i++) results.push((await register(ed, {}, i % 2 ? 'chatbot' : 'formulario', i % 3 === 0 ? request : requestB)).status);
      assert.deepEqual(results, [201, 201, 201, 201, 201, 429], 'la sexta, aunque cambie de canal o de instancia, se bloquea');
      assert.equal((await list(ed)).length, 5);
      const buckets = await rows("SELECT COUNT(*) AS n FROM rate_limit_buckets WHERE count > 0");
      assert.ok(buckets[0].n >= 3, 'las cuotas viven en rate_limit_buckets (MySQL), no en la memoria de cada proceso');
      const blocked = await register(ed, {}, 'chatbot', requestB); assert.equal(blocked.status, 429); assert.deepEqual(Object.keys(blocked.body).sort(), ['mensaje', 'ok']);
      assert.equal((await request('/chatbot/message', null, 'POST', { message: 'cursos' })).status, 200, 'el chat conversacional conserva su propia cuota');
      await clear();
      assert.equal((await register(ed, {})).status, 201, 'la cuota se renueva');
    });

    await t.test('abuso: una IP abusiva recibe 429 con peticiones simultáneas entre dos instancias, no agota el global y otra IP legítima sigue registrando; X-Forwarded-For falsificado no evade el límite', async () => {
      const ed = await edition('Edición de abuso');
      const abuser = '203.0.113.50', legit = '198.51.100.20';
      await clear();
      const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => register(ed, {}, i % 2 ? 'chatbot' : 'formulario', (i % 3 ? fromA : fromB)(abuser))));
      const statuses = burst.map(r => r.status);
      assert.equal(statuses.filter(s => s === 201).length, 5, 'ni 40 simultáneas superan la cuota de la IP: ' + statuses.join(','));
      assert.equal(statuses.filter(s => s === 429).length, 35, 'el resto es 429 limpio, nunca 500 ni 503');
      assert.equal((await list(ed)).length, 5);
      // Solo las admitidas cuentan: ningún cubo supera las 5 admitidas, ni el global.
      assert.equal((await rows('SELECT MAX(count) AS m FROM rate_limit_buckets'))[0].m, 5, 'las 35 rechazadas no consumieron cuota global');
      // Otra IP legítima, en otra red, sigue registrando aunque el abusivo siga insistiendo; también por el chatbot, que comparte la misma cuota.
      assert.equal((await register(ed, {}, 'formulario', fromA(legit))).status, 201);
      assert.equal((await register(ed, {}, 'chatbot', fromB('198.51.101.20'))).status, 201);
      assert.equal((await register(ed, {}, 'formulario', fromA(abuser))).status, 429, 'el abusivo sigue limitado');
      // Una cabecera inventada por el cliente a la izquierda no cambia la IP resuelta (la del proxy de confianza + la real a su derecha).
      assert.equal((await register(ed, {}, 'formulario', fromB('1.2.3.4, falsa.example, ' + abuser))).status, 429, 'X-Forwarded-For falsificado no evade el límite');
      // El cubo guarda solo hashes: ni IP ni correo ni teléfono.
      assert.equal((await rows("SELECT COUNT(*) AS n FROM rate_limit_buckets WHERE id NOT REGEXP '^[0-9a-f]{64}$'"))[0].n, 0);
      assert.ok(!PERSONAL.test(JSON.stringify(await rows('SELECT * FROM rate_limit_buckets'))));
    });

    await t.test('abuso: el tope global propio (60 por minuto) se mantiene exacto con 70 redes distintas simultáneas y no toca la cuota del chat conversacional', async () => {
      const ed = await edition('Edición de tope global');
      await clear();
      const results = await Promise.all(Array.from({ length: 70 }, (_, i) => register(ed, {}, i % 5 ? 'formulario' : 'chatbot', (i % 2 ? fromB : fromA)('10.' + i + '.0.5'))));
      assert.equal(results.filter(r => r.status === 201).length, 60, results.map(r => r.status).join(','));
      assert.equal(results.filter(r => r.status === 429).length, 10);
      assert.equal((await list(ed)).length, 60, 'las 10 rechazadas no dejaron preinscripción');
      assert.equal((await rows('SELECT MAX(count) AS m FROM rate_limit_buckets'))[0].m, 60, 'el global cuenta solo admitidas');
      assert.equal((await fromA('10.99.0.1')('/chatbot/message', null, 'POST', { message: 'cursos' })).status, 200, 'el chat conversacional tiene su cuota propia');
      await clear();
    });

    await t.test('recepción: planificada y ya abierta reciben mientras Gerencia/Coordinación lo mantengan; cerrada, cancelada, archivada, curso no publicado o recepción cerrada, no', async () => {
      await clear();
      const ed = await edition('Edición de recepción');
      assert.equal(ed.preinscripcion_estado, 'abierta'); assert.equal(ed.estado, 'planificada'); assert.equal(ed.minimo_apertura, 10); assert.match(ed.codigo_publico, /^[0-9a-f]{32}$/);
      assert.equal((await register(ed)).status, 201, 'planificada recibe');
      const nuevo = await edition('Nace cerrada', { reception: false });
      assert.equal(nuevo.preinscripcion_estado, 'cerrada', 'una edición nueva no recibe hasta que Gerencia o Coordinación lo decidan');
      const missing = [];
      const attempt = async (label, target) => { await clear(); const r = await register(target); missing.push([label, r.status, r.text]); return r; };
      assert.equal((await attempt('recepción cerrada', nuevo)).status, 404);
      for (const [label, patch] of [['cerrada', { estado: 'cerrada' }], ['cancelada', { estado: 'cancelada' }], ['archivada', { archivado: true }]]) {
        const target = await legacy('Edición ' + label, patch.archivado ? { estado: 'cerrada', archivado: true } : patch);
        assert.equal((await attempt(label, target)).status, 404, label);
      }
      const draft = await legacy('Curso en borrador', { curso_id: 3, estado: 'planificada' });
      assert.equal((await attempt('curso no publicado', draft)).status, 404);
      assert.equal((await attempt('código inexistente', { codigo_publico: 'f'.repeat(32) })).status, 404);
      assert.equal(new Set(missing.map(m => m[2])).size, 1, 'todas las negativas son idénticas: no revelan el motivo');
      // Gerencia/Coordinación pueden cerrar y reabrir la recepción; la secretaría no.
      const current = (await request(E + '/' + ed.id, tokens.c)).body.item;
      assert.equal((await request(E + '/' + ed.id + '/preinscripcion', tokens.s, 'PUT', { revision: current.revision, estado: 'cerrada' })).status, 403);
      const closed = await request(E + '/' + ed.id + '/preinscripcion', tokens.c, 'PUT', { revision: current.revision, estado: 'cerrada' }); assert.equal(closed.status, 200, closed.text);
      assert.equal(closed.body.item.estado, 'planificada', 'cerrar la recepción no cancela ni cierra la edición');
      assert.equal((await attempt('recepción cerrada por coordinación', ed)).status, 404);
      assert.equal((await request(E + '/' + ed.id + '/preinscripcion', tokens.g, 'PUT', { revision: current.revision, estado: 'abierta' })).status, 409, 'revisión obsoleta');
      assert.equal((await request(E + '/' + ed.id + '/preinscripcion', tokens.g, 'PUT', { revision: closed.body.item.revision, estado: 'cerrada' })).status, 409, 'ya estaba cerrada');
      const reopened = await request(E + '/' + ed.id + '/preinscripcion', tokens.g, 'PUT', { revision: closed.body.item.revision, estado: 'abierta' }); assert.equal(reopened.status, 200, reopened.text);
      await clear(); assert.equal((await register(ed)).status, 201);
      // Sin capacidad definida o con la edición cancelada no se puede habilitar la recepción.
      const noCapacity = await request(E + '/2/preinscripcion', tokens.g, 'PUT', { revision: 1, estado: 'abierta' }); assert.equal(noCapacity.status, 409, 'la edición anterior 2 no tiene capacidad');
      const cancelled = await legacy('Cancelada sin recepción', { estado: 'cancelada', reception: 'cerrada' });
      assert.equal((await request(E + '/' + cancelled.id + '/preinscripcion', tokens.g, 'PUT', { revision: 1, estado: 'abierta' })).status, 409);
      assert.equal((await request(E + '/' + cancelled.id + '/preinscripcion', tokens.g, 'PUT', { revision: 1, estado: 'abierta', minimo_apertura: 1 })).status, 400, 'el mínimo no se envía ni se cambia');
    });

    await t.test('listado público: solo ediciones que reciben ahora, con código opaco, sin ids, cupos, conteos ni datos personales', async () => {
      const visible = await edition('Visible en el listado', { capacidad: 7 });
      await sign(visible, 2);
      const hidden = await edition('Oculta por recepción cerrada', { reception: false });
      const full = await legacy('Abierta sin cupos', { estado: 'abierta', capacidad: 1 });
      await db.query("INSERT INTO estudiantes (nombres,apellidos) VALUES ('Cupo','Ocupado')");
      const holder = (await rows('SELECT MAX(id) AS id FROM estudiantes'))[0].id;
      await db.execute('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (?,?)', [holder, full.id]);
      const r = await request('/preinscripciones/convocatorias'); assert.equal(r.status, 200, r.text);
      const codes = r.body.items.map(i => i.codigo);
      assert.ok(codes.includes(visible.codigo_publico)); assert.ok(!codes.includes(hidden.codigo_publico)); assert.ok(!codes.includes(full.codigo_publico), 'sin cupos reales deja de ofrecerse');
      for (const item of r.body.items) assert.deepEqual(Object.keys(item).sort(), ['apertura_confirmada', 'codigo', 'curso', 'fecha_fin', 'fecha_inicio', 'nombre']);
      assert.ok(!/capacidad|matricul|"id"|minimo|conteo|total|recibida|@|9000/i.test(r.text), 'sin cupos, conteos, ids ni datos personales');
      assert.equal(r.body.items.find(i => i.codigo === visible.codigo_publico).fecha_inicio, '2026-11-01');
      assert.equal((await request('/preinscripciones/convocatorias', tokens.b)).status, 200, 'público: ni siquiera usa la sesión');
    });

    await t.test('mínimo de apertura: 9 validadas no abren, las recibidas no cuentan, al llegar a 10 no se abre sola y la apertura la confirma Gerencia o Coordinación', async () => {
      const ed = await edition('Edición con mínimo', { capacidad: 30 });
      await sign(ed, 12);
      assert.equal((await open(ed)).status, 409, 'doce solicitudes recibidas no equivalen a diez validadas');
      const items = await rows('SELECT id, revision FROM preinscripciones WHERE convocatoria_id=? ORDER BY id', [ed.id]);
      for (let i = 0; i < 9; i++) assert.equal((await act(items[i].id, 'validacion', { revision: items[i].revision }, i % 2 ? tokens.s : tokens.c)).status, 200);
      const nine = await open(ed); assert.equal(nine.status, 409); assert.match(nine.body.message, /10/); assert.match(nine.body.message, /9/);
      assert.equal((await rows('SELECT estado FROM convocatorias WHERE id=?', [ed.id]))[0].estado, 'planificada');
      assert.equal((await act(items[9].id, 'validacion', { revision: items[9].revision })).status, 200);
      assert.equal((await rows('SELECT estado FROM convocatorias WHERE id=?', [ed.id]))[0].estado, 'planificada', 'al llegar a 10 el curso NO se abre automáticamente');
      const summary = await request(P + '/resumen?convocatoria_id=' + ed.id, tokens.s); assert.equal(summary.status, 200, summary.text);
      assert.deepEqual(summary.body.items[0].apertura, { minimo: 10, contadas: 10, faltan: 0, cumple_minimo: true });
      assert.deepEqual(summary.body.items[0].conteo, { recibida: 2, validada: 10, matriculada: 0, desistida: 0, descartada: 0, total: 12 });
      assert.equal((await request(E + '/' + ed.id + '/apertura', tokens.s, 'PUT', { revision: 99 })).status, 403, 'la secretaría no confirma la apertura');
      const stale = await request(E + '/' + ed.id + '/apertura', tokens.c, 'PUT', { revision: 1 }); assert.equal(stale.status, 409, 'revisión obsoleta');
      const opened = await open(ed); assert.equal(opened.status, 200, opened.text); assert.equal(opened.body.item.estado, 'abierta');
      assert.equal((await rows('SELECT preinscripcion_estado FROM convocatorias WHERE id=?', [ed.id]))[0].preinscripcion_estado, 'abierta', 'confirmar la apertura no cierra la recepción');
      const history = await rows("SELECT operacion, actor_id, estado_anterior, estado_nuevo FROM academico_historial WHERE entidad='convocatoria' AND entidad_id=? ORDER BY id DESC LIMIT 1", [ed.id]);
      assert.deepEqual(history[0], { operacion: 'cambio_estado', actor_id: ids.g, estado_anterior: 'planificada', estado_nuevo: 'abierta' });
      // Recepción posterior a la apertura: la edición abierta sigue recibiendo mientras haya cupos.
      await clear(); const late = await register(ed); assert.equal(late.status, 201, late.text);
      assert.equal((await request('/preinscripciones/convocatorias')).body.items.find(i => i.codigo === ed.codigo_publico).apertura_confirmada, true);
      // Las ediciones anteriores (mínimo NULL) siguen abriéndose como antes, sin preinscripciones.
      const old = await legacy('Anterior sin mínimo', { estado: 'planificada', reception: 'cerrada' });
      assert.equal((await request(E + '/' + old.id + '/apertura', tokens.g, 'PUT', { revision: 1 })).status, 200, 'compatibilidad con convocatorias históricas');
      // No hay forma de cambiar el mínimo ni de abrir con menos.
      for (const body of [{ revision: 1, minimo_apertura: 1 }, { revision: 1, minimo_apertura: 0 }]) assert.equal((await request(E + '/' + ed.id, tokens.g, 'PUT', body)).status, 400);
      assert.equal((await request(E, tokens.g, 'POST', { curso_id: 1, nombre: 'Con mínimo propio', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 5, minimo_apertura: 1 })).status, 400);
      const tiny = await edition('Capacidad menor al mínimo', { capacidad: 3 }); await sign(tiny, 3);
      for (const row of await rows('SELECT id, revision FROM preinscripciones WHERE convocatoria_id=?', [tiny.id])) assert.equal((await act(row.id, 'validacion', { revision: row.revision })).status, 200);
      assert.equal((await open(tiny)).status, 409, 'ni siquiera con la capacidad completa validada: el mínimo no admite excepciones');
    });

    await t.test('concurrencia: validar frente a abrir, descartar frente a abrir y validaciones simultáneas que superarían la capacidad', async () => {
      // 1) Con 10 validadas, descartar una mientras se confirma la apertura: o se abre antes del descarte o se rechaza; nunca se abre con 9.
      for (let round = 0; round < 6; round++) {
        const ed = await edition('Carrera apertura ' + round, { capacidad: 30 });
        await db.query('DELETE FROM rate_limit_buckets');
        await validatedPreinscripciones(db, ed.id, 10, 'race' + round);
        const target = (await rows('SELECT id, revision FROM preinscripciones WHERE convocatoria_id=? ORDER BY id LIMIT 1', [ed.id]))[0];
        const fresh = (await request(E + '/' + ed.id, tokens.g)).body.item;
        const [o, d] = await Promise.all([request(E + '/' + ed.id + '/apertura', tokens.c, 'PUT', { revision: fresh.revision }), act(target.id, 'descarte', { revision: target.revision, motivo: 'Carrera' }, tokens.s)]);
        assert.equal(d.status, 200, d.text); assert.ok([200, 409].includes(o.status), 'apertura ' + o.status);
        const state = (await rows('SELECT estado FROM convocatorias WHERE id=?', [ed.id]))[0].estado;
        assert.equal(state, o.status === 200 ? 'abierta' : 'planificada');
        if (o.status === 200) {
          const opening = (await rows("SELECT createdAt FROM academico_historial WHERE entidad='convocatoria' AND entidad_id=? AND estado_nuevo='abierta'", [ed.id]))[0].createdAt;
          const discard = (await rows("SELECT createdAt FROM preinscripciones_historial WHERE preinscripcion_id=? AND operacion='descarte'", [target.id]))[0].createdAt;
          assert.ok(opening <= discard, 'si se abrió, fue ANTES de que el descarte tomara el bloqueo: con 10 validadas reales');
        } else assert.match(o.body.message, /9/);
      }
      // 2) Capacidad 3 y cinco solicitudes: validadas simultáneamente, solo caben 3.
      const ed = await edition('Carrera de capacidad', { capacidad: 3 });
      await sign(ed, 5);
      const pending = await rows('SELECT id, revision FROM preinscripciones WHERE convocatoria_id=? ORDER BY id', [ed.id]);
      const outcomes = await Promise.all(pending.map((row, i) => act(row.id, 'validacion', { revision: row.revision }, [tokens.g, tokens.c, tokens.s][i % 3])));
      assert.deepEqual(outcomes.map(o => o.status).sort(), [200, 200, 200, 409, 409]);
      assert.equal((await rows("SELECT COUNT(*) AS n FROM preinscripciones WHERE convocatoria_id=? AND estado='validada'", [ed.id]))[0].n, 3);
      // 3) Dos validaciones simultáneas de la MISMA preinscripción: una gana, la otra recibe 409.
      const one = await edition('Carrera misma fila', { capacidad: 10 }); await sign(one, 1);
      const row = (await rows('SELECT id, revision FROM preinscripciones WHERE convocatoria_id=?', [one.id]))[0];
      const twice = await Promise.all([act(row.id, 'validacion', { revision: row.revision }), act(row.id, 'validacion', { revision: row.revision }, tokens.c)]);
      assert.deepEqual(twice.map(r => r.status).sort(), [200, 409]);
      assert.equal((await rows('SELECT revision FROM preinscripciones WHERE id=?', [row.id]))[0].revision, 2);
      assert.equal((await rows('SELECT COUNT(*) AS n FROM preinscripciones_historial WHERE preinscripcion_id=? AND operacion=?', [row.id, 'validacion']))[0].n, 1);
    });

    await t.test('capacidad máxima y tope de seguridad en la recepción, con la edición ya abierta', async () => {
      const { ed } = await openEdition('Edición con cupos justos', 12);
      await clear(); assert.equal((await register(ed)).status, 201, 'abierta con cupos: recibe');
      // Ocupar todos los cupos con matrículas activas (SQL: solo fija el estado de la prueba).
      for (let i = 0; i < 12; i++) { await db.query("INSERT INTO estudiantes (nombres,apellidos) VALUES ('Ocupa','Cupo')"); const s = (await rows('SELECT MAX(id) AS id FROM estudiantes'))[0].id; await db.execute('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (?,?)', [s, ed.id]); }
      await clear(); const full = await register(ed); assert.equal(full.status, 409); assert.equal(full.body.statusCode, 409);
      assert.ok(!PERSONAL.test(full.text));
      await db.query('UPDATE matriculas SET estado=\'anulada\' WHERE convocatoria_id=? LIMIT 1', [ed.id]);
      await clear(); assert.equal((await register(ed)).status, 201, 'una matrícula anulada libera el cupo');
      // Tope técnico de seguridad: 500 preinscripciones vigentes por edición.
      const big = await legacy('Edición saturada', { estado: 'planificada', capacidad: 100000 });
      const values = []; for (let i = 0; i < 500; i++) values.push(["(" + big.id + ",'Relleno','Masivo','mass" + i + "@preinscripciones.test','900000000','formulario','recibida',NOW(3),'v1')"][0]);
      await db.query('INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,estado,consentimiento_at,aviso_version) VALUES ' + values.join(','));
      await clear(); assert.equal((await register(big)).status, 409, 'el tope de 500 vigentes protege la tabla');
      await db.execute("UPDATE preinscripciones SET estado='descartada' WHERE convocatoria_id=? LIMIT 1", [big.id]);
      await clear(); assert.equal((await register(big)).status, 201, 'descartar libera una plaza de recepción');
    });

    await t.test('gestión administrativa: listado, filtros, resumen, detalle, historial, correcciones, descarte, desistimiento y revisiones', async () => {
      await clear();
      const ed = await edition('Edición de gestión', { capacidad: 30 });
      const a = person({ nombres: 'Lucía', apellidos: 'Fernández Gestión' }), b = person({ nombres: 'Mario', apellidos: 'Gestión Quispe' });
      await register(ed, a); await register(ed, b, 'chatbot'); await register(ed, { ...person(), telefono: a.telefono });
      const rowsAll = await list(ed); assert.equal(rowsAll.length, 3);
      const l = await request(P + '?convocatoria_id=' + ed.id, tokens.s); assert.equal(l.status, 200, l.text);
      assert.equal(l.body.pagination.total, 3); assert.equal(l.body.items[0].convocatoria.nombre, 'Edición de gestión');
      assert.equal((await request(P + '?convocatoria_id=' + ed.id + '&canal=chatbot', tokens.s)).body.pagination.total, 1);
      assert.equal((await request(P + '?convocatoria_id=' + ed.id + '&search=' + encodeURIComponent('Fernández Lucía'), tokens.c)).body.pagination.total, 1);
      assert.equal((await request(P + '?convocatoria_id=' + ed.id + '&search=' + encodeURIComponent(b.email), tokens.c)).body.pagination.total, 1);
      assert.equal((await request(P + '?convocatoria_id=' + ed.id + '&estado=validada', tokens.c)).body.pagination.total, 0);
      assert.equal((await request(P + '?convocatoria_id=' + ed.id + '&limit=2&page=2', tokens.c)).body.items.length, 1);
      for (const bad of ['limit=101', 'page=0', 'estado=activa', 'canal=panel', 'convocatoria_id=abc']) assert.equal((await request(P + '?' + bad, tokens.c)).status, 400, bad);
      const detail = await get(rowsAll[0].id, tokens.s); assert.equal(detail.status, 200); assert.equal(detail.body.item.nombres, rowsAll[0].nombres);
      assert.deepEqual(detail.body.coincidencias.map(c => c.coincide), [['telefono']], 'detecta posibles duplicados por teléfono dentro de la edición');
      assert.equal((await get(999999)).status, 404);
      // Correcciones con revisión; duplicado vigente 409; no se editan estado ni canal.
      const row = rowsAll[0];
      const fixed = await request(P + '/' + row.id, tokens.s, 'PATCH', { revision: row.revision, nombres: ' Lucía María ', email: 'CORREGIDO' + seq + '@Preinscripciones.test' }); assert.equal(fixed.status, 200, fixed.text);
      assert.equal(fixed.body.item.nombres, 'Lucía María'); assert.equal(fixed.body.item.email, 'corregido' + seq + '@preinscripciones.test'); assert.equal(fixed.body.item.revision, 2);
      assert.equal((await request(P + '/' + row.id, tokens.s, 'PATCH', { revision: 1, nombres: 'Obsoleta' })).status, 409);
      assert.equal((await request(P + '/' + row.id, tokens.s, 'PATCH', { revision: 2, email: b.email })).status, 409, 'el correo ya está vigente en la edición');
      for (const bad of [{ revision: 2 }, { revision: 2, estado: 'validada' }, { revision: 2, canal: 'panel' }, { revision: 2, email: 'mal' }]) assert.equal((await request(P + '/' + row.id, tokens.s, 'PATCH', bad)).status, 400, JSON.stringify(bad));
      // Descarte exige motivo; desistimiento no; estados finales.
      assert.equal((await act(rowsAll[1].id, 'descarte', { revision: 1 }, tokens.c)).status, 400);
      const discarded = await act(rowsAll[1].id, 'descarte', { revision: 1, motivo: ' Datos de prueba ' }, tokens.c); assert.equal(discarded.status, 200); assert.equal(discarded.body.item.estado, 'descartada');
      assert.equal((await act(rowsAll[1].id, 'validacion', { revision: 2 })).status, 409, 'descartada es un estado final');
      assert.equal((await request(P + '/' + rowsAll[1].id, tokens.g, 'PATCH', { revision: 2, nombres: 'X' })).status, 409, 'un registro cerrado no se corrige');
      const withdrawn = await act(rowsAll[2].id, 'desistimiento', { revision: 1 }, tokens.s); assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.item.estado, 'desistida');
      const hist = await request(P + '/' + rowsAll[1].id + '/historial', tokens.s); assert.equal(hist.status, 200);
      assert.deepEqual(hist.body.items.map(h => [h.operacion, h.estado_anterior, h.estado_nuevo, h.motivo, h.actor_id, h.actor_rol]), [['descarte', 'recibida', 'descartada', 'Datos de prueba', ids.c, 'COORDINADORA_INSTITUCIONAL'], ['creacion', null, 'recibida', null, null, null]]);
      const editHistory = await request(P + '/' + row.id + '/historial', tokens.g);
      assert.deepEqual(editHistory.body.items[0].campos.sort(), ['email', 'nombres'], 'el historial guarda NOMBRES de campos, nunca valores');
      assert.ok(!PERSONAL.test(JSON.stringify(editHistory.body)), 'sin datos personales en el historial');
      assert.equal((await request(P + '/999999/historial', tokens.g)).status, 404);
      const summary = await request(P + '/resumen?convocatoria_id=' + ed.id, tokens.s);
      assert.deepEqual(summary.body.items[0].conteo, { recibida: 1, validada: 0, matriculada: 0, desistida: 1, descartada: 1, total: 3 });
      assert.deepEqual(summary.body.items[0].cupos, { capacidad: 30, ocupados: 0, disponibles: 30 });
      assert.ok(!PERSONAL.test(summary.text), 'el resumen no contiene datos personales');
      const all = await request(P + '/resumen', tokens.g); assert.equal(all.status, 200); assert.ok(all.body.items.length >= 1);
      // Cerrar una edición no impide limpiar sus preinscripciones; validar en una edición cerrada, sí.
      const closing = await legacy('Se cierra después', { estado: 'planificada', capacidad: 5 });
      await register(closing); const pre = (await list(closing))[0];
      await db.query("UPDATE convocatorias SET estado='cerrada' WHERE id=?", [closing.id]);
      assert.equal((await act(pre.id, 'validacion', { revision: pre.revision })).status, 409);
      assert.equal((await act(pre.id, 'descarte', { revision: pre.revision, motivo: 'Edición cerrada' })).status, 200);
    });

    let eo, validatedItems;
    await t.test('conversión a matrícula: estudiante nuevo con DNI, vínculo, historial y responsable; sin DNI no se crea; estudiante y edición deben ser válidos', async () => {
      ({ ed: eo, items: validatedItems } = await openEdition('Edición para convertir', 30));
      await clear(); const extra = person({ nombres: 'Rosa', apellidos: 'Conversión Nueva' }); await register(eo, extra);
      const row = (await list(eo)).at(-1);
      assert.equal((await convert(row.id, { revision: row.revision })).status, 400, 'sin estudiante ni DNI no se puede crear el estudiante');
      assert.equal((await convert(row.id, { revision: row.revision, doc_numero: '1234567' })).status, 400);
      assert.equal((await convert(row.id, { revision: row.revision, estudiante_id: 1 })).status, 400, 'un estudiante_id sin DNI no basta: el DNI es el ancla de identidad');
      let before = await counts();
      const notValidated = await convert(row.id, { revision: row.revision, doc_numero: '55555551' }); assert.equal(notValidated.status, 409, 'solo se convierte una preinscripción validada');
      assert.deepEqual(await counts(), before);
      const v = await act(row.id, 'validacion', { revision: row.revision }); assert.equal(v.status, 200);
      assert.equal((await convert(row.id, { revision: row.revision, doc_numero: '55555551' })).status, 409, 'revisión obsoleta');
      const wrongPick = await convert(row.id, { revision: v.body.item.revision, doc_numero: '12345678', estudiante_id: 1 });
      assert.equal(wrongPick.status, 409, 'no se vincula un estudiante cuyo DNI no es el tecleado'); assert.equal(wrongPick.body.codigo, 'DNI_NO_COINCIDE'); assert.ok(!PERSONAL.test(wrongPick.text));
      before = await counts();
      const done = await convert(row.id, { revision: v.body.item.revision, doc_numero: '55555551' }, tokens.s); assert.equal(done.status, 201, done.text);
      assert.equal(done.body.item.estado, 'matriculada'); assert.equal(done.body.estudiante_creado, true); assert.equal(done.body.matricula.estado, 'activa');
      const after = await counts();
      assert.deepEqual([after.e, after.m, after.pm], [before.e + 1, before.m + 1, before.pm + 1]);
      const stored = (await rows('SELECT * FROM preinscripciones WHERE id=?', [row.id]))[0];
      const mat = (await rows('SELECT * FROM matriculas WHERE id=?', [stored.matricula_id]))[0];
      assert.equal(mat.convocatoria_id, eo.id); assert.equal(mat.estudiante_id, stored.estudiante_id); assert.equal(mat.estado, 'activa'); assert.equal(mat.cumplimiento, 'pendiente');
      assert.equal(stored.convertida_por, ids.s, 'queda el administrador responsable'); assert.ok(stored.convertida_at);
      const est = (await rows('SELECT * FROM estudiantes WHERE id=?', [stored.estudiante_id]))[0];
      assert.deepEqual([est.nombres, est.apellidos, est.doc_pais, est.doc_tipo, est.doc_numero, est.email, est.telefono], ['Rosa', 'Conversión Nueva', 'PE', 'DNI', '55555551', extra.email, extra.telefono]);
      const hist = (await rows("SELECT operacion, actor_id, actor_rol, estado_anterior, estado_nuevo, campos FROM preinscripciones_historial WHERE preinscripcion_id=? ORDER BY id DESC LIMIT 1", [row.id]))[0];
      assert.deepEqual([hist.operacion, hist.actor_id, hist.actor_rol, hist.estado_anterior, hist.estado_nuevo], ['conversion', ids.s, 'SECRETARIA', 'validada', 'matriculada']);
      assert.deepEqual(hist.campos, ['estado', 'estudiante_id', 'matricula_id', 'estudiante_nuevo', 'control:dni_nuevo', 'control:sin_duplicado_aparente'], 'controles aplicados, como códigos');
      assert.ok(!PERSONAL.test(JSON.stringify(hist)) && !JSON.stringify(hist).includes('55555551'), 'ni datos personales ni el DNI en el historial');
      const academic = (await rows("SELECT operacion, actor_id, actor_rol, motivo FROM academico_historial WHERE entidad='matricula' AND entidad_id=?", [stored.matricula_id]))[0];
      assert.deepEqual([academic.operacion, academic.actor_id, academic.actor_rol], ['creacion', ids.s, 'SECRETARIA']); assert.match(academic.motivo, /preinscripción/);
      assert.equal((await convert(row.id, { revision: stored.revision, doc_numero: '55555552' }, tokens.g)).status, 409, 'no se convierte dos veces');
      // La matrícula creada es una matrícula normal del módulo de Matrículas.
      const viaMatriculas = await request('/admin/matriculas/' + stored.matricula_id, tokens.s); assert.equal(viaMatriculas.status, 200); assert.equal(viaMatriculas.body.item.estudiante.doc_numero, '55555551');
      const ocupados = (await request('/admin/matriculas/ediciones?search=' + encodeURIComponent('Edición para convertir'), tokens.s)).body.items[0]; assert.equal(ocupados.ocupados, 1);
    });

    await t.test('conversión: estudiante existente (por id y por DNI), sin duplicados, matrícula anulada, estudiante archivado y edición no abierta', async () => {
      const mk = async (patch = {}) => { await clear(); await register(eo, person(patch)); const r = (await list(eo)).at(-1); const v = await act(r.id, 'validacion', { revision: r.revision }); assert.equal(v.status, 200, v.text); return v.body.item; };
      // Existente por id.
      // Cada persona ya registrada tiene su identidad (nombres, correo y teléfono) y su preinscripción trae los mismos datos.
      const ident = n => ({ nombres: 'Existente' + n, apellidos: 'Coincidente', email: 'existente' + n + '@preinscripciones.test', telefono: '9100' + String(10000 + n) });
      const known = await student(1, ident(1));
      let p = await mk(ident(1)); let before = await counts();
      const byId = await convert(p.id, { revision: p.revision, estudiante_id: known.id, doc_numero: known.doc_numero }); assert.equal(byId.status, 201, byId.text); assert.equal(byId.body.estudiante_creado, false);
      const byIdHistory = (await rows("SELECT campos FROM preinscripciones_historial WHERE preinscripcion_id=? AND operacion='conversion'", [p.id]))[0].campos;
      assert.deepEqual(byIdHistory, ['estado', 'estudiante_id', 'matricula_id', 'estudiante_existente', 'control:dni_coincide', 'control:nombres_coinciden', 'control:contacto_email', 'control:contacto_telefono']);
      assert.ok(!PERSONAL.test(JSON.stringify(byIdHistory)) && !JSON.stringify(byIdHistory).includes(known.doc_numero));
      assert.deepEqual([(await counts()).e, (await counts()).m], [before.e, before.m + 1], 'no se crea otro estudiante');
      // Existente por DNI: se reutiliza, no se duplica.
      const known2 = await student(2, ident(2)); p = await mk(ident(2)); before = await counts();
      const byDni = await convert(p.id, { revision: p.revision, doc_numero: known2.doc_numero }, tokens.c); assert.equal(byDni.status, 201, byDni.text); assert.equal(byDni.body.estudiante_creado, false);
      assert.equal((await rows('SELECT estudiante_id FROM preinscripciones WHERE id=?', [p.id]))[0].estudiante_id, known2.id);
      assert.equal((await rows('SELECT COUNT(*) AS n FROM estudiantes WHERE doc_numero=?', [known2.doc_numero]))[0].n, 1);
      // Misma persona ya matriculada en la edición: no se crea otra matrícula.
      p = await mk({ ...ident(1), email: 'existente1b@preinscripciones.test' }); before = await counts();
      const dup = await convert(p.id, { revision: p.revision, estudiante_id: known.id, doc_numero: known.doc_numero }); assert.equal(dup.status, 409);
      assert.deepEqual(await counts(), before); assert.equal((await rows('SELECT estado FROM preinscripciones WHERE id=?', [p.id]))[0].estado, 'validada', 'sigue validada: nada cambió');
      // Matrícula ANULADA: tampoco se duplica (se reactiva desde Matrículas).
      const annulled = await student(3, { nombres: p.nombres, apellidos: p.apellidos, email: p.email }); await db.execute("INSERT INTO matriculas (estudiante_id,convocatoria_id,estado) VALUES (?,?,'anulada')", [annulled.id, eo.id]);
      before = await counts();
      const reuse = await convert(p.id, { revision: p.revision, doc_numero: annulled.doc_numero }); assert.equal(reuse.status, 409); assert.match(reuse.body.message, /reactiva/);
      assert.deepEqual(await counts(), before);
      assert.equal((await rows('SELECT COUNT(*) AS n FROM matriculas WHERE estudiante_id=? AND convocatoria_id=?', [annulled.id, eo.id]))[0].n, 1);
      // Estudiante archivado e inexistente.
      const archived = await student(4, { nombres: p.nombres, apellidos: p.apellidos, email: p.email }); await db.execute('UPDATE estudiantes SET archivado_at=NOW(3) WHERE id=?', [archived.id]); before = await counts();
      assert.equal((await convert(p.id, { revision: p.revision, estudiante_id: archived.id, doc_numero: archived.doc_numero })).status, 409);
      assert.equal((await convert(p.id, { revision: p.revision, estudiante_id: 999999, doc_numero: '12345679' })).status, 404);
      assert.deepEqual(await counts(), before);
      // Edición todavía planificada: no se convierte ni se crea el estudiante.
      const planned = await edition('Planificada sin abrir', { capacidad: 30 }); await clear(); await register(planned);
      const planRow = (await list(planned))[0]; const planValid = await act(planRow.id, 'validacion', { revision: planRow.revision }); assert.equal(planValid.status, 200);
      before = await counts();
      const early = await convert(planRow.id, { revision: planValid.body.item.revision, doc_numero: '66666661' }); assert.equal(early.status, 409); assert.match(early.body.message, /abierta/);
      assert.deepEqual(await counts(), before); assert.equal((await rows("SELECT COUNT(*) AS n FROM estudiantes WHERE doc_numero='66666661'"))[0].n, 0);
      // Edición cerrada después de validar: tampoco.
      await db.query("UPDATE convocatorias SET estado='cerrada' WHERE id=?", [planned.id]);
      assert.equal((await convert(planRow.id, { revision: planValid.body.item.revision, doc_numero: '66666661' })).status, 409);
    });

    await t.test('identidad al convertir: nombres o contacto discrepantes, DNI ajeno y posible duplicado se bloquean sin escribir; la corrección auditada permite reintentar; sin PII en errores ni historial', async () => {
      const mk = async (patch = {}) => { await clear(); await register(eo, person(patch)); const r = (await list(eo)).at(-1); const v = await act(r.id, 'validacion', { revision: r.revision }); assert.equal(v.status, 200, v.text); return v.body.item; };
      const ident = n => ({ nombres: 'Identidad' + n, apellidos: 'Verificada', email: 'identidad' + n + '@preinscripciones.test', telefono: '9200' + String(10000 + n) });
      const blocked = async (p, body, codigo, discrepancias) => {
        const before = await counts();
        const r = await convert(p.id, { revision: p.revision, ...body });
        assert.equal(r.status, 409, r.text); assert.equal(r.body.codigo, codigo); assert.deepEqual(r.body.discrepancias, discrepancias);
        assert.ok(!PERSONAL.test(r.text) && !r.text.includes(body.doc_numero), 'el error no repite nombres, correo, teléfono ni DNI');
        assert.deepEqual(await counts(), before, 'un bloqueo no crea estudiante, matrícula ni historial');
        const stored = (await rows('SELECT estado, revision, estudiante_id, matricula_id FROM preinscripciones WHERE id=?', [p.id]))[0];
        assert.deepEqual([stored.estado, stored.revision, stored.estudiante_id, stored.matricula_id], ['validada', p.revision, null, null], 'sigue validada y sin vínculo');
      };
      // 1. Mismo correo y teléfono pero OTRO nombre: el contacto no es prueba de identidad.
      const other = await student(10, { nombres: 'Otra', apellidos: 'Persona Distinta', email: ident(10).email, telefono: ident(10).telefono });
      const byName = await mk(ident(10));
      await blocked(byName, { doc_numero: other.doc_numero }, 'IDENTIDAD_DISCREPANTE', ['nombres']);
      await blocked(byName, { doc_numero: other.doc_numero, estudiante_id: other.id }, 'IDENTIDAD_DISCREPANTE', ['nombres']);
      // 2. Mismo nombre pero ningún contacto coincide con los registrados.
      const moved = await student(11, { ...ident(11), email: 'otro11@preinscripciones.test', telefono: '9299999911' });
      const byContact = await mk(ident(11));
      await blocked(byContact, { doc_numero: moved.doc_numero }, 'IDENTIDAD_DISCREPANTE', ['contacto']);
      // 3. No se puede elegir otro estudiante: el id debe ser el del DNI tecleado, y el DNI debe estar registrado.
      await blocked(byContact, { doc_numero: moved.doc_numero, estudiante_id: other.id }, 'DNI_NO_COINCIDE', ['dni']);
      await blocked(byContact, { doc_numero: '12121299', estudiante_id: moved.id }, 'DNI_NO_COINCIDE', ['dni']);
      // 4. Posible duplicado: la misma persona ya existe y el DNI se tecleó mal; con el DNI correcto se vincula sin crear otro estudiante.
      const twin = await student(12, ident(12)); const typo = await mk(ident(12));
      await blocked(typo, { doc_numero: '12121212' }, 'POSIBLE_DUPLICADO', ['posible_duplicado']);
      assert.equal((await rows("SELECT COUNT(*) AS n FROM estudiantes WHERE doc_numero='12121212'"))[0].n, 0);
      const fixedDni = await convert(typo.id, { revision: typo.revision, doc_numero: twin.doc_numero }); assert.equal(fixedDni.status, 201, fixedDni.text); assert.equal(fixedDni.body.estudiante_creado, false);
      // 5. Contacto compartido por personas distintas (familiares): se permite crear el estudiante nuevo y queda anotado.
      await student(13, { nombres: 'Hermano', apellidos: 'Distinto', email: ident(13).email }); const shared = await mk(ident(13));
      const sharedDone = await convert(shared.id, { revision: shared.revision, doc_numero: '13131313' }); assert.equal(sharedDone.status, 201, sharedDone.text); assert.equal(sharedDone.body.estudiante_creado, true);
      assert.deepEqual((await rows("SELECT campos FROM preinscripciones_historial WHERE preinscripcion_id=? AND operacion='conversion'", [shared.id]))[0].campos.slice(-2), ['control:dni_nuevo', 'control:contacto_compartido']);
      // 6. Resolución documentada: se corrige el dato por su vía auditada y se repite. (a) la preinscripción; (b) el estudiante.
      const fixPre = await request(P + '/' + byName.id, tokens.s, 'PATCH', { revision: byName.revision, nombres: 'Otra', apellidos: 'Persona Distinta' }); assert.equal(fixPre.status, 200, fixPre.text);
      const retryA = await convert(byName.id, { revision: fixPre.body.item.revision, doc_numero: other.doc_numero, estudiante_id: other.id }); assert.equal(retryA.status, 201, retryA.text);
      const fixStudent = await request('/admin/estudiantes/' + moved.id, tokens.g, 'PUT', { revision: moved.revision, email: ident(11).email }); assert.equal(fixStudent.status, 200, fixStudent.text);
      const retryB = await convert(byContact.id, { revision: byContact.revision, doc_numero: moved.doc_numero }); assert.equal(retryB.status, 201, retryB.text);
      const trail = await rows('SELECT operacion, campos FROM preinscripciones_historial WHERE preinscripcion_id=? ORDER BY id', [byName.id]);
      assert.deepEqual(trail.map(h => h.operacion), ['creacion', 'validacion', 'correccion', 'conversion']);
      assert.deepEqual(trail[2].campos.sort(), ['apellidos', 'nombres'], 'la corrección queda registrada por NOMBRE de campo');
      // 7. Reintentos y concurrencia: convertir otra vez no duplica; dos administradores a la vez sobre el mismo estudiante existente dejan una sola matrícula.
      const before = await counts(); assert.equal((await convert(byName.id, { revision: retryA.body.item.revision, doc_numero: other.doc_numero })).status, 409); assert.deepEqual(await counts(), before);
      const racer = await student(14, ident(14)); const race = await mk(ident(14));
      const outcomes = await Promise.all([convert(race.id, { revision: race.revision, doc_numero: racer.doc_numero, estudiante_id: racer.id }, tokens.s), convert(race.id, { revision: race.revision, doc_numero: racer.doc_numero }, tokens.c)]);
      assert.deepEqual(outcomes.map(o => o.status).sort(), [201, 409]);
      assert.equal((await rows('SELECT COUNT(*) AS n FROM matriculas WHERE estudiante_id=? AND convocatoria_id=?', [racer.id, eo.id]))[0].n, 1);
      // 8. El motivo del descarte y del desistimiento no admite datos personales; nada se guarda con ellos.
      const motive = await mk(ident(15)); const historyBefore = (await rows('SELECT COUNT(*) AS n FROM preinscripciones_historial'))[0].n;
      for (const motivo of ['Llamar al 987654321', 'Su DNI es 12345678', 'Escribió a alguien@example.test', 'contraseña: abc']) {
        for (const [action, who] of [['descarte', tokens.c], ['desistimiento', tokens.s]]) {
          const r = await act(motive.id, action, { revision: motive.revision, motivo }, who); assert.equal(r.status, 400, motivo);
          assert.ok(!/987654321|12345678|alguien@|abc/.test(r.text), 'el error no devuelve el dato');
        }
      }
      assert.equal((await rows('SELECT COUNT(*) AS n FROM preinscripciones_historial'))[0].n, historyBefore, 'ningún intento rechazado dejó historial');
      assert.equal((await act(motive.id, 'descarte', { revision: motive.revision, motivo: 'Duplicada: ya existe otra solicitud' }, tokens.c)).status, 200);
      // 9. Auditoría global del historial de esta ejecución: solo nombres de campo y códigos de control, y motivos sin correos ni números largos.
      for (const h of await rows('SELECT campos, motivo FROM preinscripciones_historial')) {
        for (const c of h.campos ?? []) assert.match(c, /^[a-z][a-z_]{0,29}(:[a-z_]{1,29})?$/, 'campo de historial: ' + c);
        if (h.motivo) assert.ok(!/@/.test(h.motivo) && !/\d{7,}/.test(h.motivo), 'motivo sin datos personales');
      }
    });

    await t.test('conversión: cupos, concurrencia (mismo registro, mismo DNI y último cupo) y capacidad llena', async () => {
      // Edición anterior abierta con capacidad 1: se valida (SQL) y se convierte por la API.
      const small = await legacy('Un solo cupo', { estado: 'abierta', capacidad: 1 });
      const mk = async (ed, n) => { await clear(); await register(ed, person()); const r = (await list(ed)).at(-1); const v = await act(r.id, 'validacion', { revision: r.revision }); assert.equal(v.status, 200, v.text); return v.body.item; };
      const first = await mk(small, 1); await db.query("UPDATE convocatorias SET capacidad=2 WHERE id=?", [small.id]);
      const second = await mk(small, 2);
      await db.query("UPDATE convocatorias SET capacidad=1 WHERE id=?", [small.id]);
      let before = await counts();
      const outcomes = await Promise.all([convert(first.id, { revision: first.revision, doc_numero: '77777771' }, tokens.s), convert(second.id, { revision: second.revision, doc_numero: '77777772' }, tokens.c)]);
      assert.deepEqual(outcomes.map(o => o.status).sort(), [201, 409], 'solo cabe una: la otra no deja estudiante ni matrícula');
      const after = await counts(); assert.deepEqual([after.e, after.m, after.pm], [before.e + 1, before.m + 1, before.pm + 1]);
      assert.equal((await rows('SELECT COUNT(*) AS n FROM matriculas WHERE convocatoria_id=? AND estado=\'activa\'', [small.id]))[0].n, 1);
      const loser = outcomes.findIndex(o => o.status === 409); assert.match(outcomes[loser].body.message, /cupos/);
      assert.equal((await rows("SELECT COUNT(*) AS n FROM estudiantes WHERE doc_numero IN ('77777771','77777772')"))[0].n, 1, 'el estudiante de la conversión fallida se revirtió');
      // Misma preinscripción convertida a la vez por dos administradores: una sola matrícula.
      const wide = await legacy('Amplia abierta', { estado: 'abierta', capacidad: 20 });
      const twin = await mk(wide, 1); before = await counts();
      const same = await Promise.all([convert(twin.id, { revision: twin.revision, doc_numero: '88888881' }, tokens.s), convert(twin.id, { revision: twin.revision, doc_numero: '88888881' }, tokens.g)]);
      assert.deepEqual(same.map(o => o.status).sort(), [201, 409]);
      assert.deepEqual([(await counts()).e, (await counts()).m], [before.e + 1, before.m + 1]);
      // Dos preinscripciones distintas con el mismo DNI nuevo, a la vez: un solo estudiante y una sola matrícula.
      const p1 = await mk(wide, 2), p2 = await mk(wide, 3); before = await counts();
      const sameDni = await Promise.all([convert(p1.id, { revision: p1.revision, doc_numero: '88888882' }), convert(p2.id, { revision: p2.revision, doc_numero: '88888882' }, tokens.c)]);
      assert.deepEqual(sameDni.map(o => o.status).sort(), [201, 409]);
      assert.equal((await rows("SELECT COUNT(*) AS n FROM estudiantes WHERE doc_numero='88888882'"))[0].n, 1);
      assert.deepEqual([(await counts()).e, (await counts()).m], [before.e + 1, before.m + 1]);
      // Capacidad llena con una preinscripción ya validada: 409 y nada cambia.
      const full = await mk(wide, 4);
      const active = (await rows("SELECT COUNT(*) AS n FROM matriculas WHERE convocatoria_id=? AND estado='activa'", [wide.id]))[0].n;
      await db.execute('UPDATE convocatorias SET capacidad=? WHERE id=?', [active, wide.id]);
      before = await counts();
      const noRoom = await convert(full.id, { revision: full.revision, doc_numero: '88888883' }); assert.equal(noRoom.status, 409); assert.match(noRoom.body.message, /cupos/);
      assert.deepEqual(await counts(), before, 'sin cupos no se crea estudiante ni matrícula');
      assert.equal((await rows("SELECT COUNT(*) AS n FROM estudiantes WHERE doc_numero='88888883'"))[0].n, 0);
    });

    await t.test('secretaría convierte sin privilegios generales nuevos: no abre ni cierra ediciones, no anula matrículas, no edita estudiantes ni habilita la recepción', async () => {
      const wide = await legacy('Edición de secretaría', { estado: 'abierta', capacidad: 20 });
      await clear(); await register(wide, person({ nombres: 'Para', apellidos: 'Secretaría' }));
      const row = (await list(wide))[0];
      assert.equal((await act(row.id, 'validacion', { revision: row.revision }, tokens.s)).status, 200);
      const done = await convert(row.id, { revision: 2, doc_numero: '99999991' }, tokens.s); assert.equal(done.status, 201, done.text);
      const matricula = done.body.matricula;
      const forbidden = [['PUT', E + '/' + wide.id + '/apertura', { revision: 1 }], ['PUT', E + '/' + wide.id + '/preinscripcion', { revision: 1, estado: 'cerrada' }], ['PUT', E + '/' + wide.id + '/cierre', { revision: 1, estado: 'cerrada' }], ['PUT', E + '/' + wide.id + '/archivo', { revision: 1, archivado: true }],
        ['PUT', E + '/' + wide.id, { revision: 1, capacidad: 30 }], ['PUT', '/admin/matriculas/' + matricula.id + '/anulacion', { revision: 1, motivo: 'x' }], ['PUT', '/admin/estudiantes/' + matricula.estudiante_id, { revision: 1, nombres: 'X' }],
        ['PUT', E + '/' + wide.id + '/horarios', { revision: 1, horarios: [] }], ['GET', '/admin/reportes'], ['GET', '/admin/users']];
      for (const [method, path, body] of forbidden) assert.equal((await request(path, tokens.s, method, body)).status, 403, 'secretaría ' + method + ' ' + path);
      const me = await request('/admin/me', tokens.s); assert.deepEqual(me.body.user.permisos.filter(p => p.startsWith('preinscripciones:')), ['preinscripciones:convertir', 'preinscripciones:editar', 'preinscripciones:leer']);
      assert.ok(!me.body.user.permisos.includes('preinscripciones:exportar'));
      const gerente = await request('/admin/me', tokens.g); assert.ok(gerente.body.user.permisos.includes('preinscripciones:exportar'), 'exportar queda reservado al gerente');
      const coord = await request('/admin/me', tokens.c); assert.ok(!coord.body.user.permisos.includes('preinscripciones:exportar'));
    });

    await t.test('reversión transaccional: si falla el historial de la preinscripción o el de la matrícula, no queda estudiante, matrícula ni vínculo', async () => {
      const wide = await legacy('Edición de reversión', { estado: 'abierta', capacidad: 20 });
      const mk = async () => { await clear(); await register(wide, person()); const r = (await list(wide)).at(-1); const v = await act(r.id, 'validacion', { revision: r.revision }); assert.equal(v.status, 200, v.text); return v.body.item; };
      for (const [table, when, label] of [['preinscripciones_historial', "NEW.operacion='conversion'", 'historial de preinscripciones'], ['academico_historial', "NEW.entidad='matricula'", 'historial académico de la matrícula']]) {
        const p = await mk(); const before = await counts(); const snap = JSON.stringify(await rows('SELECT estado, revision, estudiante_id, matricula_id, convertida_por FROM preinscripciones WHERE id=?', [p.id]));
        await db.query('CREATE TRIGGER fallo_conversion BEFORE INSERT ON `' + table + "` FOR EACH ROW BEGIN IF " + when + " THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio de auditoría'; END IF; END");
        try {
          const failed = await convert(p.id, { revision: p.revision, doc_numero: '44444' + String(Math.floor(Math.random() * 900) + 100) }); assert.equal(failed.status, 500, label);
          assert.deepEqual(await counts(), before, label + ': ni estudiante, ni matrícula, ni historial');
          assert.equal(JSON.stringify(await rows('SELECT estado, revision, estudiante_id, matricula_id, convertida_por FROM preinscripciones WHERE id=?', [p.id])), snap, label + ': la preinscripción sigue validada y sin vínculo');
        } finally { await db.query('DROP TRIGGER fallo_conversion'); }
        const retry = await convert(p.id, { revision: p.revision, doc_numero: '4444' + String(Math.floor(Math.random() * 9000) + 1000) }); assert.equal(retry.status, 201, 'sin el fallo todo vuelve a funcionar: ' + retry.text);
      }
      // Lo mismo para validar y descartar: si falla el historial, no cambia el estado.
      await clear();
      await register(wide, person()); const row = (await list(wide)).at(-1); const n0 = (await list(wide)).length;
      await db.query("CREATE TRIGGER fallo_validacion BEFORE INSERT ON preinscripciones_historial FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo ficticio'");
      try {
        assert.equal((await act(row.id, 'validacion', { revision: row.revision })).status, 500);
        assert.equal((await act(row.id, 'descarte', { revision: row.revision, motivo: 'No debe guardarse' })).status, 500);
        assert.equal((await rows('SELECT estado, revision FROM preinscripciones WHERE id=?', [row.id]))[0].estado, 'recibida');
        await clear(); assert.equal((await register(wide)).status, 500, 'la creación pública tampoco queda a medias');
        assert.equal((await list(wide)).length, n0, 'sin historial no queda la preinscripción nueva');
      } finally { await db.query('DROP TRIGGER fallo_validacion'); }
    });

    await t.test('compatibilidad: Ediciones, Horarios, Estudiantes, Matrículas, Reportes, Contacto, Chatbot y Cotizaciones siguen funcionando', async () => {
      const { ed } = await openEdition('Edición compatible', 30);
      // Horarios recurrentes sobre una edición con preinscripciones (el módulo de Sesiones se retiró: sus rutas ya no existen).
      const horario = await request(E + '/' + ed.id + '/horarios', tokens.c, 'PUT', { revision: ed.revision, horarios: [{ dia_semana: 1, hora_inicio: '19:00', hora_fin: '22:00' }] }); assert.equal(horario.status, 200, horario.text);
      assert.equal(horario.body.convocatoria.revision, ed.revision + 1, 'reemplazar los horarios sube la revisión de la edición');
      assert.equal((await request(E + '/' + ed.id + '/horarios', tokens.s)).body.items.length, 1, 'la secretaría consulta los horarios');
      assert.equal((await request(E + '/' + ed.id, tokens.g, 'PUT', { revision: ed.revision, capacidad: 35 })).status, 409, 'una revisión anterior al cambio de horarios ya no sirve');
      for (const path of ['/admin/sesiones', '/admin/convocatorias/' + ed.id + '/sesiones']) assert.equal((await request(path, tokens.g)).status, 404, path);
      // Ediciones: editar, cerrar con preinscripciones y horarios; Estudiantes y Matrículas.
      const edited = await request(E + '/' + ed.id, tokens.g, 'PUT', { revision: horario.body.convocatoria.revision, capacidad: 35 }); assert.equal(edited.status, 200, edited.text);
      assert.equal(edited.body.item.minimo_apertura, 10); assert.equal(edited.body.item.preinscripcion_estado, 'abierta');
      const s = await student(900); const enrolled = await request('/admin/matriculas', tokens.s, 'POST', { estudiante_id: s.id, convocatoria_id: ed.id, convocatoria_revision: edited.body.item.revision }); assert.equal(enrolled.status, 201, enrolled.text);
      assert.equal((await request('/admin/matriculas/' + enrolled.body.item.id + '/anulacion', tokens.g, 'PUT', { revision: 1, motivo: 'Prueba' })).status, 200);
      const closed = await request(E + '/' + ed.id + '/cierre', tokens.c, 'PUT', { revision: edited.body.item.revision, estado: 'cerrada' }); assert.equal(closed.status, 200, closed.text);
      assert.equal((await request(P + '?convocatoria_id=' + ed.id, tokens.g)).body.pagination.total, 10, 'cerrar la edición conserva sus preinscripciones');
      await clear(); assert.equal((await register(ed)).status, 404, 'cerrada: ya no recibe');
      for (const path of ['/admin/estudiantes', '/admin/matriculas', '/admin/convocatorias', '/admin/convocatorias/' + ed.id + '/horarios', '/admin/reportes', '/admin/cotizaciones', '/admin/messages', '/admin/stats?vista=operativa', '/admin/chatbot/sin-respuesta']) assert.equal((await request(path, tokens.g)).status, 200, path);
      assert.equal((await request('/admin/me', tokens.b)).status, 200);
      // Públicos: contenido, Contacto, Chatbot (contacto y consulta) y el listado de preinscripciones.
      for (const endpoint of ['/cursos', '/servicios', '/galeria', '/convenios', '/settings', '/preinscripciones/convocatorias']) assert.equal((await request(endpoint)).status, 200, endpoint);
      await clear();
      const contact = await request('/chatbot/contact', null, 'POST', { nombre: 'Visitante Chat', email: 'chat@preinscripciones.test', telefono: '900099999', asunto: 'Consulta', mensaje: 'Quiero información', consentimiento: true }); assert.equal(contact.status, 201, contact.text);
      assert.equal((await rows("SELECT origen FROM contactos WHERE email='chat@preinscripciones.test'"))[0].origen, 'chatbot');
      assert.equal((await request('/chatbot/message', null, 'POST', { message: 'cursos' })).status, 200);
      assert.equal((await request('/admin/cursos/1', tokens.g, 'DELETE')).status, 409, 'un curso con ediciones y preinscripciones no se borra');
      // Cotizaciones: la lista y su creación siguen disponibles (idempotencia propia, sin relación con preinscripciones).
      const quotes = await request('/admin/cotizaciones', tokens.c); assert.equal(quotes.status, 200); assert.ok(Array.isArray(quotes.body.items ?? quotes.body));
    });

    await t.test('privacidad: los errores y los registros de la API no contienen SQL, Prisma, trazas ni datos personales; sin estructura la API responde 503 neutro', async () => {
      assert.ok(leaks.length > 60, 'se recogieron respuestas de error para revisar (' + leaks.length + ')');
      for (const text of leaks) {
        assert.ok(!/prisma|ER_[A-Z_]+|SELECT |INSERT |UPDATE `|stack|\bat\s+\S+\.(js|ts)|sqlMessage|mysql|preinscripciones_[a-z_]+_(chk|fk|uq|idx)|convocatorias_[a-z_]+_(chk|uq)/i.test(text), 'respuesta de error con detalles internos: ' + text.slice(0, 160));
        assert.ok(!PERSONAL.test(text), 'respuesta de error con datos personales: ' + text.slice(0, 160));
      }
      assert.ok(!PERSONAL.test(apiLog), 'la salida de las APIs no contiene datos personales');
      assert.ok(!/12345678|clave|password/i.test(apiLog.replace(/Ficticia-preins-1/g, '')), 'ni credenciales');
      // Sin las tablas (migración pendiente) las rutas responden 503 neutro, no 500. Se hace al final: se renombran y se restauran.
      await db.query('SET FOREIGN_KEY_CHECKS=0');
      await db.query('RENAME TABLE preinscripciones_historial TO ph_oculta, preinscripciones TO p_oculta');
      try {
        await clear();
        const ed = (await rows('SELECT codigo_publico FROM convocatorias WHERE codigo_publico IS NOT NULL AND preinscripcion_estado=\'abierta\' AND estado=\'planificada\' AND archivado_at IS NULL AND capacidad IS NOT NULL AND curso_id IN (1,2) LIMIT 1'))[0];
        const listed = await request(P, tokens.g); assert.equal(listed.status, 503); assert.match(listed.body.message, /no está disponible/); assert.ok(!/preinscripciones_|prisma/i.test(listed.text));
        if (ed) { const pub = await register(ed); assert.equal(pub.status, 503); assert.ok(!/prisma|SQL|`/i.test(pub.body.message ?? '')); }
      } finally { await db.query('RENAME TABLE ph_oculta TO preinscripciones_historial, p_oculta TO preinscripciones'); await db.query('SET FOREIGN_KEY_CHECKS=1'); }
      assert.equal((await request(P, tokens.g)).status, 200);
    });

    t.diagnostic('Base ficticia conservada en el servidor desechable hasta retirar el contenedor propio: ' + name);
  } finally {
    for (const child of apis) { if (child.connected) { const exited = new Promise(resolve => child.once('exit', resolve)); child.disconnect(); await exited; } }
    for (const client of clients) { try { await client.end(); } catch { /* ya cerrada */ } }
    await admin.end();
    for (const dir of [cwd, apiCwd]) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporal propio: se ignora si Windows aún lo retiene */ } }
  }
});
