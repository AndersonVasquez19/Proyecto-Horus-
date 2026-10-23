// H-BACK-01 E4.2: estructura de datos académicos (20261015-academico-estructura) contra un MySQL 8.4 REAL y DESECHABLE, con
// Prisma 6.19.3 y su adaptador MariaDB. No forma parte de `npm test` ni de test:integration; la CI la ejecuta en su MySQL efímero.
// E4.3b (20261016-academico-solo-dni): documento académico solo DNI peruano. Actualización desde E4.2 con y sin datos, detención
// segura ante CE/PASAPORTE (modo estricto y no estricto), recuperación de una migración parcial, rechazo por SQL directo y Prisma.
// Algunas pruebas cambian @@GLOBAL.sql_mode de ESTE servidor desechable (los scripts hijos heredan el modo global) y lo restauran.
//
//   ACADEMICO_SCHEMA_TEST_DB=true ACADEMICO_SCHEMA_TEST_SERVER_UUID=<@@server_uuid leído por docker exec> DB_HOST=127.0.0.1 DB_PORT=<puerto>
//   DB_USER=root DB_PASS=<clave de un solo uso>  node --test -r ./test/isolate-env.cjs test/academico-schema.integration.cjs
//
// Barreras (las mismas que E3.5 y E3.6; todas antes de crear nada):
//  1. ACADEMICO_SCHEMA_TEST_DB=true explícito.  2. DB_HOST de bucle local y DB_PORT explícito.
//  3. @@server_uuid de la conexión = ACADEMICO_SCHEMA_TEST_SERVER_UUID, obtenido por otra vía (docker exec en el contenedor propio).
//  4. Servidor recién creado (Uptime < 1 h) y sin tablas en ninguna base ajena a las del sistema.
// Solo crea y elimina bases horus_e42_<hex> y horus_restore_e42_<hex> (destino de db:restore). Datos ficticios (ningún documento ni nombre real). Este proceso no importa database.cjs
// (no carga ningún .env): los scripts reales se lanzan como procesos hijos con un directorio de trabajo temporal y un entorno mínimo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, realpathSync, readFileSync, readdirSync } = require('node:fs');
const { gunzipSync } = require('node:zlib');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const { PrismaClient, Prisma, DocumentoTipo } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

const backend = join(__dirname, '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NAME = /^horus_e42_[0-9a-f]{24}$/;
const MIGRATION = '20261015-academico-estructura';
const SOLO_DNI = '20261016-academico-solo-dni';
const ACADEMIC_TABLES = ['estudiantes', 'convocatorias', 'matriculas', 'certificados', 'academico_historial'];
// La lista `versions` se lee como texto: importar migrate.cjs cargaría database.cjs y, con él, un posible backend/.env.
const VERSIONS = JSON.parse(readFileSync(join(backend, 'scripts', 'migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const statementsOf = name => readFileSync(join(backend, 'migrations', name + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean); // criterio de migrate.cjs

test('E4.2: estructura académica en MySQL 8.4 desechable (instalación, actualización, recuperación, restricciones y Prisma)', async t => {
  if (process.env.ACADEMICO_SCHEMA_TEST_DB !== 'true') return t.skip('Requiere ACADEMICO_SCHEMA_TEST_DB=true y un MySQL desechable identificado.');
  assert.deepEqual(VERSIONS.slice(VERSIONS.indexOf(MIGRATION)), [MIGRATION, SOLO_DNI, '20261018-convocatorias-capacidad', '20261019-importaciones-academicas', '20261020-docentes', '20261020-preinscripciones', '20261023-convocatoria-horarios'], 'las migraciones académicas conservan su orden y añaden importaciones, docentes, preinscripciones y horarios al final (20261020-sesiones-academicas está retirada)');
  const host = process.env.DB_HOST || '', port = Number(process.env.DB_PORT || 0);
  const expectedUuid = String(process.env.ACADEMICO_SCHEMA_TEST_SERVER_UUID ?? '').trim().toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host) && port > 0, 'DB_HOST de bucle local y DB_PORT explícito');
  assert.match(expectedUuid, UUID, 'ACADEMICO_SCHEMA_TEST_SERVER_UUID debe ser el server_uuid del servidor desechable');
  const credentials = { host, port, user: process.env.DB_USER, password: process.env.DB_PASS, timezone: 'Z' };
  const admin = await mysql.createConnection(credentials);
  const q = async (sql, params) => (await admin.query(sql, params))[0];
  try {
    const [{ uuid, uptime }] = await q("SELECT @@server_uuid AS uuid, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime') AS uptime");
    assert.equal(String(uuid).toLowerCase(), expectedUuid, 'el servidor conectado no es el servidor desechable identificado');
    assert.ok(Number(uptime) < 3600, 'el servidor debe ser recién creado (Uptime < 1 h)');
    const populated = await q('SELECT TABLE_SCHEMA AS s FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN (?) GROUP BY TABLE_SCHEMA', [SYSTEM]);
    assert.deepEqual(populated.map(row => row.s), [], 'el servidor no debe contener datos de ninguna base');
    assert.match(String((await q('SELECT VERSION() AS v'))[0].v), /^8\.4\./, 'MySQL 8.4');
  } catch (error) { await admin.end(); throw error; }

  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-e42-'));
  const created = [], clients = [];
  const env = name => ({
    PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    DB_HOST: host, DB_PORT: String(port), DB_NAME: name, DB_USER: credentials.user, DB_PASS: credentials.password, DB_SSL: 'false',
  });
  function runScript(file, name, args = []) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-r', join(__dirname, 'isolate-env.cjs'), join(backend, 'scripts', file), ...args], { cwd, env: env(name), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
  }
  async function createDb() {
    const name = 'horus_e42_' + randomBytes(12).toString('hex');
    assert.match(name, NAME);
    await q('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    created.push(name);
    return name;
  }
  async function connectTo(name) { return mysql.createConnection({ ...credentials, database: name }); }
  // Estado anterior a `version`: init + todas las migraciones previas, registradas como lo haría migrate.cjs.
  async function databaseBefore(version) {
    const name = await createDb();
    const init = await runScript('init-database.cjs', name);
    assert.equal(init.code, 0, init.output);
    const db = await connectTo(name);
    try {
      await db.query('CREATE TABLE IF NOT EXISTS horus_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)');
      for (const previous of VERSIONS.slice(0, VERSIONS.indexOf(version))) {
        for (const statement of statementsOf(previous)) await db.query(statement);
        await db.execute('INSERT INTO horus_migrations (name, applied_at) VALUES (?, ?)', [previous, new Date()]);
      }
    } finally { await db.end(); }
    return name;
  }
  const databaseAtE41 = () => databaseBefore(MIGRATION); // sin tablas académicas
  const databaseAtE42 = async () => {
    const name = await databaseBefore(SOLO_DNI);
    // Aislar las pruebas históricas de DNI: capacidad, importaciones, docentes, preinscripciones y horarios son independientes y ya están en su línea base.
    // La actualización natural E4.3b → capacidad, con datos y sin esta preparación, se prueba en convocatorias.integration.cjs;
    // la de docentes (desde una base previa con datos, con fallos parciales) en docentes.integration.cjs, la de horarios (y la retirada de sesiones) en
    // horarios.integration.cjs y la de preinscripciones (tablas, columnas de convocatorias y clave compuesta de matrículas) en preinscripciones.integration.cjs.
    const db = await connectTo(name);
    try {
      for (const version of ['20261018-convocatorias-capacidad', '20261019-importaciones-academicas', '20261020-docentes', '20261020-preinscripciones', '20261023-convocatoria-horarios']) {
        for (const statement of statementsOf(version)) await db.query(statement);
        await db.execute('INSERT INTO horus_migrations (name, applied_at) VALUES (?, ?)', [version, new Date()]);
      }
    } finally { await db.end(); }
    return name;
  }; // esquema documental E4.2 (todavía con CE y PASAPORTE)
  // empty: las tablas académicas deben seguir vacías (instalación o actualización sin datos académicos).
  async function migrateAndCheck(name, { empty = true } = {}) {
    const migrate = await runScript('migrate.cjs', name);
    assert.equal(migrate.code, 0, migrate.output);
    const schema = await runScript('check-database.cjs', name);
    assert.equal(schema.code, 0, schema.output);
    assert.match(schema.output, /Esquema compatible/);
    const db = await connectTo(name);
    try {
      const [rows] = await db.query('SELECT name FROM horus_migrations ORDER BY name');
      assert.deepEqual(rows.map(row => row.name), [...VERSIONS].sort(), 'cada migración registrada una sola vez');
      if (empty) for (const table of ACADEMIC_TABLES) assert.equal((await db.query('SELECT COUNT(*) AS n FROM `' + table + '`'))[0][0].n, 0, table + ' vacía: la migración no inserta datos');
    } finally { await db.end(); }
  }
  // Ejecuta fn con @@GLOBAL.sql_mode = mode en ESTE servidor desechable (las conexiones nuevas, incluidas las de los scripts hijos,
  // lo heredan) y restaura siempre el valor anterior.
  async function withGlobalSqlMode(mode, fn) {
    const [{ previous }] = await q('SELECT @@GLOBAL.sql_mode AS previous');
    await q('SET GLOBAL sql_mode = ?', [mode]);
    try { return await fn(); } finally { await q('SET GLOBAL sql_mode = ?', [previous]); }
  }
  // Estructura real leída de information_schema (independiente de db:check).
  async function structure(name) {
    const db = await connectTo(name);
    try {
      const [checks] = await db.query("SELECT tc.TABLE_NAME AS t, tc.CONSTRAINT_NAME AS c, tc.ENFORCED AS e FROM information_schema.TABLE_CONSTRAINTS tc WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.CONSTRAINT_TYPE = 'CHECK' ORDER BY 1, 2");
      const [fks] = await db.query('SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS c, REFERENCED_TABLE_NAME AS r, DELETE_RULE AS d, UPDATE_RULE AS u FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY 1, 2', [ACADEMIC_TABLES]);
      const [uniques] = await db.query("SELECT TABLE_NAME AS t, INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY' GROUP BY 1, 2 ORDER BY 1, 2", [ACADEMIC_TABLES]);
      const [[generated]] = await db.query("SELECT EXTRA AS extra, GENERATION_EXPRESSION AS expr FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificados' AND COLUMN_NAME = 'vigente_matricula_id'");
      const [tables] = await db.query('SELECT TABLE_NAME AS t, ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY 1', [ACADEMIC_TABLES]);
      return { checks: checks.filter(row => ACADEMIC_TABLES.includes(row.t)), fks, uniques, generated, tables };
    } finally { await db.end(); }
  }
  // Instantánea de todo lo previo a E4.2: definición (SHOW CREATE TABLE) y filas completas de cada tabla.
  async function snapshot(name, exclude) {
    const db = await connectTo(name);
    try {
      const [tables] = await db.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY 1");
      const result = {};
      for (const { t: table } of tables) {
        if (exclude.includes(table)) continue;
        const [[create]] = await db.query('SHOW CREATE TABLE `' + table + '`');
        const [rows] = await db.query('SELECT * FROM `' + table + '` ORDER BY 1');
        result[table] = { ddl: create['Create Table'].replace(/ AUTO_INCREMENT=\d+/, ''), rows: JSON.stringify(rows) };
      }
      return result;
    } finally { await db.end(); }
  }
  function prismaFor(name) {
    const client = new PrismaClient({ adapter: new PrismaMariaDb({ host, port, user: credentials.user, password: credentials.password, database: name, connectionLimit: 4, timezone: '+00:00' }) });
    clients.push(client);
    return client;
  }
  // Rechazo esperado y su causa exacta. Con el adaptador, Prisma 6.19.3 entrega una violación de CHECK (3819) como DriverAdapterError
  // (cause.kind = 'mysql', cause.code = 3819, nombre de la restricción en el mensaje), no como PrismaClientKnownRequestError.
  //   'chk:<nombre o prefijo>' = CHECK violado;  'uq:<índice>' = P2002 (Prisma) o 1062 (SQL) en ese índice;  otro valor = código exacto.
  // Solo se devuelven códigos y nombres de restricciones: nunca parámetros ni configuración.
  async function rejects(promise, expected) {
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assert.ok(error, 'se esperaba un rechazo');
    const cause = error.cause?.kind === 'mysql' ? error.cause : null;
    const code = cause ? String(cause.code) : String(error.errno ?? error.code ?? error.name);
    const message = cause ? String(cause.message) : String(error.sqlMessage ?? '');
    const target = error.meta?.driverAdapterError?.cause?.constraint?.index ?? error.meta?.target;
    const name = (message.match(/(?:constraint|key) [`'](?:\w+\.)?(\w+)[`']/i) ?? [])[1] ?? (typeof target === 'string' ? target : undefined);
    const shown = code + (name ? '@' + name : '');
    if (expected?.startsWith?.('chk:')) assert.ok(code === '3819' && name?.startsWith(expected.slice(4)), 'se esperaba ' + expected + ' y llegó ' + shown);
    else if (expected?.startsWith?.('uq:')) assert.ok(['P2002', '1062'].includes(code) && name === expected.slice(3), 'se esperaba ' + expected + ' y llegó ' + shown);
    else if (expected !== undefined) assert.equal(code, String(expected), 'se esperaba ' + expected + ' y llegó ' + shown);
    return { code: shown };
  }

  try {
    let fresh;
    await t.test('instalación desde cero: init + migraciones (dos veces) + db:check; estructura real verificada', async () => {
      fresh = await createDb();
      const init = await runScript('init-database.cjs', fresh);
      assert.equal(init.code, 0, init.output);
      await migrateAndCheck(fresh);
      await migrateAndCheck(fresh); // idempotente: no reaplica ni duplica
      const s = await structure(fresh);
      assert.deepEqual(s.tables.map(row => [row.t, row.e, row.c]), [...ACADEMIC_TABLES].sort().map(table => [table, 'InnoDB', 'utf8mb4_unicode_ci']));
      assert.deepEqual(s.checks.map(row => row.t + '.' + row.c + '=' + row.e), [
        'academico_historial.academico_historial_campos_chk=YES', 'academico_historial.academico_historial_origen_chk=YES',
        'certificados.certificados_anulacion_chk=YES', 'certificados.certificados_codigo_chk=YES', 'certificados.certificados_documento_chk=YES',
        'certificados.certificados_fechas_chk=YES', 'certificados.certificados_nombres_chk=YES',
        'convocatorias.convocatorias_capacidad_chk=YES', 'convocatorias.convocatorias_codigo_chk=YES', 'convocatorias.convocatorias_fechas_chk=YES', 'convocatorias.convocatorias_minimo_chk=YES',
        'convocatorias.convocatorias_nombre_chk=YES', 'convocatorias.convocatorias_revision_chk=YES',
        'estudiantes.estudiantes_documento_completo_chk=YES', 'estudiantes.estudiantes_documento_formato_chk=YES', 'estudiantes.estudiantes_nombres_chk=YES', 'estudiantes.estudiantes_revision_chk=YES',
        'matriculas.matriculas_confirmacion_chk=YES', 'matriculas.matriculas_revision_chk=YES',
      ]);
      assert.deepEqual(s.fks.map(row => [row.t, row.c, row.r, row.d, row.u].join(' ')), [
        'certificados certificados_anulado_por_fk admin_users RESTRICT RESTRICT', 'certificados certificados_emitido_por_fk admin_users RESTRICT RESTRICT',
        'certificados certificados_matricula_fk matriculas RESTRICT RESTRICT', 'certificados certificados_sustituye_fk certificados RESTRICT RESTRICT',
        'convocatorias convocatorias_curso_fk cursos RESTRICT RESTRICT',
        'matriculas matriculas_confirmado_por_fk admin_users RESTRICT RESTRICT', 'matriculas matriculas_convocatoria_fk convocatorias RESTRICT RESTRICT',
        'matriculas matriculas_estudiante_fk estudiantes RESTRICT RESTRICT',
      ]);
      assert.deepEqual(s.uniques.map(row => row.t + '.' + row.i + '(' + row.cols + ')'), [
        'certificados.certificados_codigo_uq(codigo_verificacion)', 'certificados.certificados_id_matricula_uq(id,matricula_id)',
        'certificados.certificados_sustituye_uq(sustituye_a_id,matricula_id)', 'certificados.certificados_vigente_uq(vigente_matricula_id)',
        'convocatorias.convocatorias_codigo_publico_uq(codigo_publico)',
        'estudiantes.estudiantes_documento_uq(doc_pais,doc_tipo,doc_numero)', 'matriculas.matriculas_estudiante_convocatoria_uq(estudiante_id,convocatoria_id)',
        'matriculas.matriculas_id_relaciones_uq(id,estudiante_id,convocatoria_id)',
      ]);
      assert.equal(s.generated.extra, 'STORED GENERATED');
      assert.match(s.generated.expr, /case when \(`estado` = _utf8mb4\\?'vigente\\?'\) then `matricula_id` else NULL end/i);
      t.diagnostic('estructura: 5 tablas InnoDB, ' + s.checks.length + ' CHECK aplicados, ' + s.fks.length + ' claves foráneas RESTRICT, ' + s.uniques.length + ' índices únicos, columna generada ' + s.generated.extra);
    });

    await t.test('actualización desde E4.1 con datos habituales: tablas y filas previas idénticas, cursos sin transformar', async () => {
      const name = await databaseAtE41();
      const db = await connectTo(name);
      try {
        await db.query("INSERT INTO admin_users (nombre, email, password, rol, createdAt, updatedAt) VALUES ('Gerente Ficticia', 'gerente@horus-e42.test', 'hash-ficticio', 'GERENTE_GENERAL', NOW(), NOW())");
        await db.query("INSERT INTO cursos (titulo, slug, descripcion, tipo, modalidad, duracion, fecha_inicio, estado, createdAt, updatedAt) VALUES ('Curso Ficticio', 'curso-ficticio-e42', 'Descripción ficticia', 'curso', 'virtual', '40 horas', '2026-11-03 09:30:00', 'publicado', NOW(), NOW()), ('Capacitación Ficticia', 'capacitacion-ficticia-e42', 'Descripción ficticia', 'capacitacion', NULL, NULL, NULL, 'borrador', NOW(), NOW())");
        await db.query("INSERT INTO servicios (titulo, slug, descripcion, categoria, estado, createdAt, updatedAt) VALUES ('Servicio Ficticio', 'servicio-ficticio-e42', 'Descripción ficticia', 'soporte', 'publicado', NOW(), NOW())");
        await db.query("INSERT INTO contactos (nombre, email, telefono, asunto, mensaje, createdAt, updatedAt) VALUES ('Contacto Ficticio', 'contacto@horus-e42.test', '000000000', 'Asunto', 'Mensaje ficticio', NOW(), NOW())");
      } finally { await db.end(); }
      const before = await snapshot(name, ['horus_migrations']);
      assert.ok(before.cursos && before.admin_users && before.cotizaciones, 'instantánea de las tablas habituales');
      await migrateAndCheck(name);
      const after = await snapshot(name, ['horus_migrations', ...ACADEMIC_TABLES, 'importaciones_academicas', 'docentes', 'docente_asignaciones', 'preinscripciones', 'preinscripciones_historial', 'convocatoria_horarios']);
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no se crean ni eliminan otras tablas');
      for (const table of Object.keys(before)) {
        assert.equal(after[table].ddl, before[table].ddl, table + ': definición sin cambios');
        assert.equal(after[table].rows, before[table].rows, table + ': filas sin cambios');
      }
      const check = await connectTo(name);
      try {
        const [cursos] = await check.query("SELECT slug, DATE_FORMAT(fecha_inicio, '%Y-%m-%d %H:%i:%s') AS f, estado FROM cursos ORDER BY id");
        assert.deepEqual(cursos.map(row => [row.slug, row.f, row.estado]), [['curso-ficticio-e42', '2026-11-03 09:30:00', 'publicado'], ['capacitacion-ficticia-e42', null, 'borrador']]);
      } finally { await check.end(); }
      t.diagnostic('actualización: ' + Object.keys(before).length + ' tablas previas con definición y filas idénticas tras migrar');
    });

    await t.test('recuperación ante migración parcialmente aplicada: cada prefijo de la E4.2 se completa al reintentar', async () => {
      const statements = statementsOf(MIGRATION);
      assert.equal(statements.length, 5);
      assert.ok(statements.every(s => /^CREATE TABLE IF NOT EXISTS `\w+` \(/.test(s)));
      for (let applied = 1; applied < statements.length; applied++) {
        const name = await databaseAtE41();
        const db = await connectTo(name);
        try { for (const statement of statements.slice(0, applied)) await db.query(statement); } finally { await db.end(); }
        const partial = await runScript('check-database.cjs', name);
        assert.equal(partial.code, 1, 'db:check detecta la migración incompleta (' + applied + '/5)');
        await migrateAndCheck(name);
      }
      t.diagnostic('recuperación: 4 estados parciales (1-4 de 5 sentencias aplicadas, sin registrar) completados por db:migrate y aceptados por db:check');
    });

    await t.test('una tabla preexistente con otra forma no se corrige en silencio: migrate se detiene sin tocarla y db:check la rechaza', async () => {
      const name = await databaseAtE41();
      const db = await connectTo(name);
      try { await db.query('CREATE TABLE `estudiantes` (`id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY, `nombres` VARCHAR(120) NOT NULL, `apellidos` VARCHAR(120) NOT NULL, `doc_tipo` VARCHAR(20) NULL, `doc_numero` BIGINT NULL) ENGINE=InnoDB'); }
      finally { await db.end(); }
      const before = await snapshot(name, ['horus_migrations']);
      const migrate = await runScript('migrate.cjs', name);
      // CREATE TABLE IF NOT EXISTS omite la tabla existente (E4.2 se registra) y la comprobación previa de la migración de solo DNI
      // no encuentra doc_pais: migrate termina con error sin modificar la tabla ajena.
      assert.equal(migrate.code, 1, migrate.output);
      assert.match(migrate.output, /No se pudo aplicar la migración/);
      assert.equal((await snapshot(name, ['horus_migrations', 'convocatorias', 'matriculas', 'certificados', 'academico_historial'])).estudiantes.ddl, before.estudiantes.ddl, 'estudiantes sin cambios');
      const schema = await runScript('check-database.cjs', name);
      assert.equal(schema.code, 1);
      for (const fragment of ['estudiantes.doc_pais: falta', 'estudiantes.doc_numero: tipo distinto', 'falta índice estudiantes_documento_uq', 'falta restricción estudiantes_documento_completo_chk'])
        assert.ok(schema.output.includes(fragment), 'db:check informa: ' + fragment);
    });

    await t.test('restricciones y compatibilidad con Prisma 6.19.3 (adaptador MariaDB) sobre la instalación nueva', async () => {
      assert.equal(Prisma.prismaVersion.client, '6.19.3');
      const prisma = prismaFor(fresh);
      const raw = await connectTo(fresh);
      const codes = {};
      const note = (key, result) => { codes[key] = result.code; return result; };
      try {
        const gerente = await prisma.adminUser.create({ data: { nombre: 'Gerente Ficticia', email: 'gerente@horus-e42.test', password: 'hash-ficticio', rol: 'GERENTE_GENERAL' } });
        const coord = await prisma.adminUser.create({ data: { nombre: 'Coordinadora Ficticia', email: 'coordinadora@horus-e42.test', password: 'hash-ficticio', rol: 'COORDINADORA_INSTITUCIONAL' } });
        const sec = await prisma.adminUser.create({ data: { nombre: 'Secretaria Ficticia', email: 'secretaria@horus-e42.test', password: 'hash-ficticio', rol: 'SECRETARIA' } });
        const curso = await prisma.curso.create({ data: { titulo: 'Curso Ficticio', slug: 'curso-ficticio-e42', descripcion: 'Ficticio', tipo: 'curso', duracion: '40 horas', fecha_inicio: new Date('2026-11-03T09:30:00Z'), estado: 'publicado' } });
        const cursoAntes = await raw.query('SELECT * FROM cursos WHERE id = ?', [curso.id]).then(([rows]) => JSON.stringify(rows));

        // Estudiantes y documentos
        const sinDoc1 = await prisma.estudiante.create({ data: { nombres: 'Ana Ficticia', apellidos: 'Prueba Uno' } });
        const sinDoc2 = await prisma.estudiante.create({ data: { nombres: 'Luis Ficticio', apellidos: 'Prueba Dos' } });
        assert.equal(sinDoc1.doc_tipo, null); assert.equal(sinDoc2.doc_numero, null); // varios sin documento conviven
        const dni = await prisma.estudiante.create({ data: { nombres: 'Rosa Ficticia', apellidos: 'Prueba Tres', doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00012345' } });
        assert.equal((await prisma.estudiante.findUnique({ where: { id: dni.id } })).doc_numero, '00012345', 'conserva los ceros iniciales');
        assert.equal((await prisma.estudiante.findUnique({ where: { doc_pais_doc_tipo_doc_numero: { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00012345' } } })).id, dni.id, 'búsqueda por la identidad compuesta');
        // E4.3b: el cliente generado solo conoce DNI.
        assert.deepEqual({ ...DocumentoTipo }, { DNI: 'DNI' }, 'DocumentoTipo de Prisma: solo DNI');
        await prisma.estudiante.create({ data: { nombres: 'Carlos Ficticio', apellidos: 'Prueba Cuatro', doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00000000' } }); // solo ceros
        await prisma.estudiante.create({ data: { nombres: 'Mononimo', apellidos: '', doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00012346' } }); // número contiguo, sin apellidos
        assert.equal((await prisma.estudiante.findMany({ where: { doc_numero: { startsWith: '000' } }, orderBy: { doc_numero: 'asc' } })).map(e => e.doc_numero).join(','), '00000000,00012345,00012346');
        const estudiantes = await prisma.estudiante.count();
        // CE y PASAPORTE ya no existen en el cliente: Prisma los rechaza antes de enviar nada a MySQL.
        note('CE vía Prisma', await rejects(prisma.estudiante.create({ data: { nombres: 'Ce', apellidos: 'Ficticio', doc_pais: 'PE', doc_tipo: 'CE', doc_numero: 'AB123' } }), 'PrismaClientValidationError'));
        note('PASAPORTE vía Prisma', await rejects(prisma.estudiante.create({ data: { nombres: 'Pas', apellidos: 'Ficticio', doc_pais: 'FR', doc_tipo: 'PASAPORTE', doc_numero: '24AB12345' } }), 'PrismaClientValidationError'));
        note('cambiar a CE vía Prisma', await rejects(prisma.estudiante.update({ where: { id: dni.id }, data: { doc_tipo: 'CE' } }), 'PrismaClientValidationError'));
        note('estudiante duplicado', await rejects(prisma.estudiante.create({ data: { nombres: 'Dup', apellidos: 'Dup', doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00012345' } }), 'uq:estudiantes_documento_uq'));
        // Contacto opcional y compartible (email VARCHAR(254), telefono VARCHAR(30)): sin UNIQUE, ni solo ni dentro de otro índice.
        const contactCols = await raw.query("SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, COLUMN_DEFAULT AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estudiantes' AND COLUMN_NAME IN ('email', 'telefono') ORDER BY 1").then(([rows]) => rows);
        assert.deepEqual(contactCols.map(r => [r.c, r.t, r.n, r.d]), [['email', 'varchar(254)', 'YES', null], ['telefono', 'varchar(30)', 'YES', null]]);
        const contactIdx = await raw.query("SELECT INDEX_NAME AS i, COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estudiantes' AND COLUMN_NAME IN ('email', 'telefono')").then(([rows]) => rows);
        assert.deepEqual(contactIdx, [], 'email y telefono no pertenecen a ningún índice (ni UNIQUE)');
        assert.equal(sinDoc1.email, null); assert.equal(sinDoc1.telefono, null); // registro sin correo ni teléfono
        const conContacto1 = await prisma.estudiante.create({ data: { nombres: 'Contacto Uno', apellidos: 'Ficticio', email: 'contacto@horus-e42.test', telefono: '+51 999 000 111' } });
        const conContacto2 = await prisma.estudiante.create({ data: { nombres: 'Contacto Dos', apellidos: 'Ficticio', email: 'contacto@horus-e42.test', telefono: '+51 999 000 111' } }); // contacto compartido
        assert.equal((await prisma.estudiante.findUnique({ where: { id: conContacto2.id } })).email, 'contacto@horus-e42.test');
        assert.equal(await prisma.estudiante.count({ where: { email: 'contacto@horus-e42.test', telefono: '+51 999 000 111' } }), 2);
        const soloEmail = await prisma.estudiante.create({ data: { nombres: 'Solo Email', apellidos: 'Ficticio', email: 'solo@horus-e42.test' } });
        assert.equal(soloEmail.telefono, null);
        const actualizado = await prisma.estudiante.update({ where: { id: conContacto1.id }, data: { telefono: null, email: 'a'.repeat(243) + '@horus.test' } }); // 254 caracteres: el máximo
        assert.equal(actualizado.email.length, 254); assert.equal(actualizado.telefono, null);
        await raw.query('INSERT INTO estudiantes (nombres, apellidos, email, telefono) VALUES (?, ?, NULL, NULL), (?, ?, ?, ?)', ['Sql Uno', 'Ficticio', 'Sql Dos', 'Ficticio', 'contacto@horus-e42.test', '+51 999 000 111']); // SQL directo
        await prisma.estudiante.deleteMany({ where: { id: { in: [conContacto1.id, conContacto2.id, soloEmail.id] } } });
        await raw.query("DELETE FROM estudiantes WHERE nombres IN ('Sql Uno', 'Sql Dos')");
        // [caso, documento, rechazo esperado]. Un documento parcial viola la regla de completitud (y a veces también la de formato: MySQL informa una).
        const FORMATO = 'chk:estudiantes_documento_formato_chk', PARCIAL = 'chk:estudiantes_documento_';
        const invalid = [
          ['documento parcial (solo tipo)', { doc_tipo: 'DNI' }, PARCIAL], ['documento parcial (sin país)', { doc_tipo: 'DNI', doc_numero: '12345678' }, PARCIAL],
          ['documento parcial (sin número)', { doc_pais: 'PE', doc_tipo: 'DNI' }, PARCIAL], ['documento parcial (sin tipo)', { doc_pais: 'PE', doc_numero: '12345678' }, 'chk:estudiantes_documento_completo_chk'],
          ['DNI de 7 dígitos', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1234567' }, FORMATO], ['DNI de 9 dígitos', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '123456789' }, FORMATO],
          ['DNI con letras', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1234567A' }, FORMATO], ['DNI de otro país', { doc_pais: 'AR', doc_tipo: 'DNI', doc_numero: '12345678' }, FORMATO],
          ['DNI con país en minúsculas', { doc_pais: 'pe', doc_tipo: 'DNI', doc_numero: '12345678' }, FORMATO], ['DNI de 8 letras', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: 'ABCDEFGH' }, FORMATO],
          ['DNI de 13 dígitos', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1234567890123' }, FORMATO], ['DNI de 20 dígitos', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1'.repeat(20) }, FORMATO],
          ['DNI con guion', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1234-5678' }, FORMATO], ['DNI con espacio', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1234 5678' }, FORMATO],
          ['DNI de 21 caracteres', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1'.repeat(21) }, 'P2000'], ['país de 1 letra', { doc_pais: 'P', doc_tipo: 'DNI', doc_numero: '12345678' }, FORMATO],
          ['DNI con salto de línea final', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '12345678\n' }, FORMATO], ['DNI con U+2028 final', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '12345678 ' }, FORMATO],
          ['país numérico', { doc_pais: '12', doc_tipo: 'DNI', doc_numero: '12345678' }, FORMATO], ['número vacío', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '' }, FORMATO],
        ];
        for (const [label, doc, expected] of invalid) note(label, await rejects(prisma.estudiante.create({ data: { nombres: 'Rechazo', apellidos: 'Ficticio', ...doc } }), expected));
        note('nombres en blanco', await rejects(prisma.estudiante.create({ data: { nombres: '   ', apellidos: 'Ficticio' } }), 'chk:estudiantes_nombres_chk'));
        note('revisión 0', await rejects(prisma.estudiante.update({ where: { id: sinDoc1.id }, data: { revision: 0 } }), 'chk:estudiantes_revision_chk'));
        note('quitar solo el número', await rejects(prisma.estudiante.update({ where: { id: dni.id }, data: { doc_numero: null } }), PARCIAL));
        assert.equal(await prisma.estudiante.count(), estudiantes, 'ningún rechazo dejó filas');
        await prisma.estudiante.update({ where: { id: sinDoc1.id }, data: { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '87654321', revision: { increment: 1 } } }); // completar más tarde
        await prisma.estudiante.update({ where: { id: sinDoc1.id }, data: { doc_pais: null, doc_tipo: null, doc_numero: null, revision: { increment: 1 } } }); // retirarlo entero
        await prisma.estudiante.update({ where: { id: sinDoc2.id }, data: { archivado_at: new Date() } }); // archivado sin borrado
        assert.ok((await prisma.estudiante.findUnique({ where: { id: sinDoc2.id } })).archivado_at instanceof Date);
        // sql_mode no estricto: un ENUM inválido pasaría a '' pero los CHECK lo siguen rechazando.
        await raw.query("SET SESSION sql_mode = ''");
        note('tipo inválido sin modo estricto (SQL)', await rejects(raw.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('X', 'Y', 'PE', 'LIBRETA', '12345678')"), 'chk:estudiantes_documento_formato_chk'));
        await raw.query('SET SESSION sql_mode = DEFAULT');

        // Convocatorias
        const conv = await prisma.convocatoria.create({ data: { curso_id: curso.id, nombre: 'Noviembre 2026', fecha_inicio: new Date('2026-11-16T00:00:00Z'), fecha_fin: new Date('2026-12-11T00:00:00Z'), estado: 'abierta' } });
        const conv2 = await prisma.convocatoria.create({ data: { curso_id: curso.id, nombre: 'Sin fechas todavía' } });
        assert.equal(conv2.estado, 'planificada');
        const leida = await prisma.convocatoria.findUnique({ where: { id: conv.id }, include: { curso: true } });
        assert.equal(leida.fecha_inicio.toISOString().slice(0, 10), '2026-11-16'); assert.equal(leida.curso.slug, 'curso-ficticio-e42');
        assert.equal((await prisma.curso.findUnique({ where: { id: curso.id }, include: { convocatorias: true } })).convocatorias.length, 2);
        note('convocatoria con fin anterior al inicio', await rejects(prisma.convocatoria.create({ data: { curso_id: curso.id, nombre: 'Mal', fecha_inicio: new Date('2026-12-01T00:00:00Z'), fecha_fin: new Date('2026-11-30T00:00:00Z') } }), 'chk:convocatorias_fechas_chk'));
        note('convocatoria sin nombre', await rejects(prisma.convocatoria.create({ data: { curso_id: curso.id, nombre: ' ' } }), 'chk:convocatorias_nombre_chk'));
        note('convocatoria de curso inexistente (P2003)', await rejects(prisma.convocatoria.create({ data: { curso_id: 999999, nombre: 'Huérfana' } }), 'P2003'));
        note('borrar curso con convocatorias (Prisma)', await rejects(prisma.curso.delete({ where: { id: curso.id } }), 'P2003'));
        note('borrar curso con convocatorias (SQL)', await rejects(raw.query('DELETE FROM cursos WHERE id = ?', [curso.id]), 1451));
        note('cambiar id de curso referenciado (SQL)', await rejects(raw.query('UPDATE cursos SET id = 999998 WHERE id = ?', [curso.id]), 1451));
        note('convocatoria con revisión 0', await rejects(prisma.convocatoria.update({ where: { id: conv.id }, data: { revision: 0 } }), 'chk:convocatorias_revision_chk'));
        note('convocatoria con revisión negativa (SQL)', await rejects(raw.query('UPDATE convocatorias SET revision = -1 WHERE id = ?', [conv.id]), 'chk:convocatorias_revision_chk'));
        assert.equal((await prisma.convocatoria.findUnique({ where: { id: conv.id } })).revision, 1, 'la revisión de la convocatoria no cambió');
        await prisma.convocatoria.update({ where: { id: conv2.id }, data: { estado: 'cancelada', archivado_at: new Date(), revision: { increment: 1 } } });
        assert.equal(await raw.query('SELECT * FROM cursos WHERE id = ?', [curso.id]).then(([rows]) => JSON.stringify(rows)), cursoAntes, 'el curso (y su fecha_inicio) no cambia por sus convocatorias');

        // Matrículas
        const mat = await prisma.matricula.create({ data: { estudiante_id: dni.id, convocatoria_id: conv.id } });
        assert.deepEqual([mat.estado, mat.cumplimiento, mat.confirmado_por, mat.confirmado_rol, mat.confirmado_at], ['activa', 'pendiente', null, null, null]);
        const matSinDoc = await prisma.matricula.create({ data: { estudiante_id: sinDoc2.id, convocatoria_id: conv.id } }); // sin documento también se matricula
        note('matrícula duplicada', await rejects(prisma.matricula.create({ data: { estudiante_id: dni.id, convocatoria_id: conv.id } }), 'uq:matriculas_estudiante_convocatoria_uq'));
        note('matrícula de estudiante inexistente (P2003)', await rejects(prisma.matricula.create({ data: { estudiante_id: 999999, convocatoria_id: conv.id } }), 'P2003'));
        note('borrar estudiante matriculado (Prisma)', await rejects(prisma.estudiante.delete({ where: { id: dni.id } }), 'P2003'));
        note('borrar convocatoria con matrículas (SQL)', await rejects(raw.query('DELETE FROM convocatorias WHERE id = ?', [conv.id]), 1451));
        note('cumplido sin datos de confirmación', await rejects(prisma.matricula.update({ where: { id: mat.id }, data: { cumplimiento: 'cumplido' } }), 'chk:matriculas_confirmacion_chk'));
        note('cumplido sin rol', await rejects(prisma.matricula.update({ where: { id: mat.id }, data: { cumplimiento: 'cumplido', confirmado_por: coord.id, confirmado_at: new Date() } }), 'chk:matriculas_confirmacion_chk'));
        note('confirmación por SECRETARIA (SQL, modo estricto)', await rejects(raw.query("UPDATE matriculas SET cumplimiento = 'cumplido', confirmado_por = ?, confirmado_rol = 'SECRETARIA', confirmado_at = NOW(3) WHERE id = ?", [sec.id, mat.id]), 1265));
        await raw.query("SET SESSION sql_mode = ''");
        note('confirmación por SECRETARIA (SQL, sin modo estricto)', await rejects(raw.query("UPDATE matriculas SET cumplimiento = 'cumplido', confirmado_por = ?, confirmado_rol = 'SECRETARIA', confirmado_at = NOW(3) WHERE id = ?", [sec.id, mat.id]), 'chk:matriculas_confirmacion_chk'));
        await raw.query('SET SESSION sql_mode = DEFAULT');
        note('confirmado_por inexistente (P2003)', await rejects(prisma.matricula.update({ where: { id: mat.id }, data: { cumplimiento: 'cumplido', confirmado_por: 999999, confirmado_rol: 'GERENTE_GENERAL', confirmado_at: new Date() } }), 'P2003'));
        note('matrícula con revisión 0', await rejects(prisma.matricula.update({ where: { id: mat.id }, data: { revision: 0 } }), 'chk:matriculas_revision_chk'));
        note('matrícula nueva con revisión 0 (SQL)', await rejects(raw.query('INSERT INTO matriculas (estudiante_id, convocatoria_id, revision) VALUES (?, ?, 0)', [sinDoc1.id, conv2.id]), 'chk:matriculas_revision_chk'));
        note('pendiente con datos de confirmación', await rejects(prisma.matricula.update({ where: { id: matSinDoc.id }, data: { confirmado_por: coord.id, confirmado_rol: 'COORDINADORA_INSTITUCIONAL', confirmado_at: new Date() } }), 'chk:matriculas_confirmacion_chk'));
        assert.equal((await prisma.matricula.findUnique({ where: { id: mat.id } })).cumplimiento, 'pendiente', 'ningún rechazo modificó la matrícula');

        // Historial en la MISMA transacción que el cambio: si el historial falla, el cambio no queda aplicado.
        note('transacción con historial inválido', await rejects(prisma.$transaction(async tx => {
          await tx.matricula.update({ where: { id: mat.id }, data: { cumplimiento: 'cumplido', confirmado_por: coord.id, confirmado_rol: 'COORDINADORA_INSTITUCIONAL', confirmado_at: new Date(), revision: { increment: 1 } } });
          await tx.academicoHistorial.create({ data: { entidad: 'matricula', entidad_id: mat.id, operacion: 'confirmacion', origen: 'panel' } }); // falta actor_id
        }), 'chk:academico_historial_origen_chk'));
        assert.equal((await prisma.matricula.findUnique({ where: { id: mat.id } })).cumplimiento, 'pendiente', 'rollback completo');
        assert.equal(await prisma.academicoHistorial.count(), 0);
        await prisma.$transaction(async tx => {
          const updated = await tx.matricula.update({ where: { id: mat.id }, data: { cumplimiento: 'cumplido', confirmado_por: coord.id, confirmado_rol: 'COORDINADORA_INSTITUCIONAL', confirmado_at: new Date(), revision: { increment: 1 } } });
          await tx.academicoHistorial.create({ data: { entidad: 'matricula', entidad_id: mat.id, operacion: 'confirmacion', origen: 'panel', actor_id: coord.id, actor_rol: 'COORDINADORA_INSTITUCIONAL', estado_anterior: 'pendiente', estado_nuevo: 'cumplido', campos: ['cumplimiento', 'confirmado_por', 'confirmado_rol', 'confirmado_at'], revision: updated.revision } });
        });
        const confirmada = await prisma.matricula.findUnique({ where: { id: mat.id }, include: { confirmador: { select: { id: true } } } });
        assert.deepEqual([confirmada.cumplimiento, confirmada.confirmado_rol, confirmada.confirmador.id, confirmada.revision], ['cumplido', 'COORDINADORA_INSTITUCIONAL', coord.id, 2]);
        const [historial] = await prisma.academicoHistorial.findMany({ where: { entidad: 'matricula', entidad_id: mat.id } });
        assert.deepEqual(historial.campos, ['cumplimiento', 'confirmado_por', 'confirmado_rol', 'confirmado_at']);
        await prisma.academicoHistorial.create({ data: { entidad: 'estudiante', entidad_id: dni.id, operacion: 'edicion', origen: 'terminal', operador: 'e42-prueba', campos: [] } });
        note('historial con campos no array', await rejects(prisma.academicoHistorial.create({ data: { entidad: 'estudiante', entidad_id: dni.id, operacion: 'edicion', origen: 'terminal', operador: 'e42', campos: { nombres: 'valor' } } }), 'chk:academico_historial_campos_chk'));
        note('historial de terminal sin operador', await rejects(prisma.academicoHistorial.create({ data: { entidad: 'estudiante', entidad_id: dni.id, operacion: 'edicion', origen: 'terminal' } }), 'chk:academico_historial_origen_chk'));
        note('borrar administradora que confirmó (SQL)', await rejects(raw.query('DELETE FROM admin_users WHERE id = ?', [coord.id]), 1451));

        // Certificados
        const snapshotData = matricula => ({
          matricula_id: matricula, estudiante_nombres: dni.nombres, estudiante_apellidos: dni.apellidos, estudiante_doc_pais: 'PE', estudiante_doc_tipo: 'DNI', estudiante_doc_numero: '00012345',
          curso_titulo: curso.titulo, curso_tipo: 'curso', curso_duracion: '40 horas', convocatoria_nombre: conv.nombre, convocatoria_fecha_inicio: conv.fecha_inicio, convocatoria_fecha_fin: conv.fecha_fin, emitido_por: coord.id,
        });
        const code = () => randomBytes(16).toString('hex').toUpperCase().slice(0, 26);
        const vigente = id => raw.query('SELECT vigente_matricula_id AS v FROM certificados WHERE id = ?', [id]).then(([[row]]) => row.v);
        const a = await prisma.certificado.create({ data: { ...snapshotData(mat.id), codigo_verificacion: code() } });
        assert.equal(a.estado, 'vigente'); assert.equal(a.estudiante_doc_numero, '00012345'); assert.ok(!('vigente_matricula_id' in a), 'Prisma no expone la columna generada');
        assert.equal(await vigente(a.id), mat.id, 'columna generada = matricula_id si vigente');
        note('segundo vigente (Prisma)', await rejects(prisma.certificado.create({ data: { ...snapshotData(mat.id), codigo_verificacion: code() } }), 'uq:certificados_vigente_uq'));
        note('segundo vigente (SQL)', await rejects(raw.query('INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [mat.id, code(), 'X', 'Y', 'PE', 'DNI', '00012345', 'C', 'curso', 'N', coord.id]), 'uq:certificados_vigente_uq'));
        // Dos emisiones simultáneas en conexiones distintas: exactamente una prospera.
        const conns = [await connectTo(fresh), await connectTo(fresh)];
        try {
          const conc = await prisma.matricula.create({ data: { estudiante_id: sinDoc1.id, convocatoria_id: conv.id } });
          const insert = c => c.query('INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [conc.id, code(), 'X', 'Y', 'PE', 'DNI', '11111111', 'C', 'curso', 'N', coord.id]);
          const results = await Promise.allSettled(conns.map(insert));
          assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
          assert.equal(results.find(r => r.status === 'rejected').reason.errno, 1062);
          codes['emisiones simultáneas'] = '1 aceptada, 1 rechazada (1062)';
        } finally { await Promise.all(conns.map(c => c.end())); }
        note('código duplicado', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), codigo_verificacion: a.codigo_verificacion } }), 'uq:certificados_codigo_uq'));
        note('código en minúsculas', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), codigo_verificacion: 'abcdefghijklmnop' } }), 'chk:certificados_codigo_chk'));
        note('código de 15 caracteres', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), codigo_verificacion: 'ABCDEFGHIJKLMNO' } }), 'chk:certificados_codigo_chk'));
        note('certificado sin documento (SQL)', await rejects(raw.query('INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)', [matSinDoc.id, code(), 'X', 'Y', 'C', 'curso', 'N', coord.id]), 1048));
        note('certificado con DNI inválido', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), estudiante_doc_numero: '1234', codigo_verificacion: code() } }), 'chk:certificados_documento_chk'));
        note('certificado con DNI y salto de línea final', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), estudiante_doc_numero: '00012345\n', codigo_verificacion: code() } }), 'chk:certificados_documento_chk'));
        note('certificado con país distinto de PE', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), estudiante_doc_pais: 'FR', codigo_verificacion: code() } }), 'chk:certificados_documento_chk'));
        note('certificado PASAPORTE vía Prisma', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), estudiante_doc_pais: 'FR', estudiante_doc_tipo: 'PASAPORTE', estudiante_doc_numero: '24AB12345', codigo_verificacion: code() } }), 'PrismaClientValidationError'));
        note('certificado con nombres en blanco', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), estudiante_nombres: '   ', codigo_verificacion: code() } }), 'chk:certificados_nombres_chk'));
        note('certificado con nombres vacíos (SQL)', await rejects(raw.query('INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [matSinDoc.id, code(), '', 'Y', 'PE', 'DNI', '00012345', 'C', 'curso', 'N', coord.id]), 'chk:certificados_nombres_chk'));
        note('certificado con fin de convocatoria anterior al inicio', await rejects(prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), convocatoria_fecha_inicio: new Date('2026-12-01T00:00:00Z'), convocatoria_fecha_fin: new Date('2026-11-30T00:00:00Z'), codigo_verificacion: code() } }), 'chk:certificados_fechas_chk'));
        assert.equal(await prisma.certificado.count({ where: { matricula_id: matSinDoc.id } }), 0, 'ningún certificado rechazado quedó guardado');
        note('escribir la columna generada (SQL)', await rejects(raw.query('UPDATE certificados SET vigente_matricula_id = NULL WHERE id = ?', [a.id]), 3105));
        note('anular sin motivo', await rejects(prisma.certificado.update({ where: { id: a.id }, data: { estado: 'anulado', anulado_por: gerente.id, anulado_at: new Date() } }), 'chk:certificados_anulacion_chk'));
        note('vigente con datos de anulación', await rejects(prisma.certificado.update({ where: { id: a.id }, data: { anulacion_motivo: 'x' } }), 'chk:certificados_anulacion_chk'));

        // Sustitución trazable: anular A y emitir B que lo sustituye, en una transacción (el orden lo impone el índice de vigentes).
        const b = await prisma.$transaction(async tx => {
          await tx.certificado.update({ where: { id: a.id }, data: { estado: 'anulado', anulado_por: gerente.id, anulado_at: new Date(), anulacion_motivo: 'Error tipográfico en el nombre (ficticio)' } });
          return tx.certificado.create({ data: { ...snapshotData(mat.id), codigo_verificacion: code(), sustituye_a_id: a.id } });
        });
        assert.equal(await vigente(a.id), null, 'columna generada = NULL si anulado');
        assert.equal(await vigente(b.id), mat.id);
        const cadena = await prisma.certificado.findUnique({ where: { id: a.id }, include: { sustituido_por: true, anulador: { select: { id: true } } } });
        assert.deepEqual([cadena.estado, cadena.sustituido_por.id, cadena.anulador.id, cadena.anulacion_motivo.length > 0], ['anulado', b.id, gerente.id, true], 'el anulado se conserva y enlaza a su sustituto');
        assert.equal((await prisma.certificado.findUnique({ where: { id: b.id }, include: { sustituye_a: true } })).sustituye_a.id, a.id);
        note('reactivar el anulado con otro vigente', await rejects(raw.query("UPDATE certificados SET estado = 'vigente', anulado_por = NULL, anulado_at = NULL, anulacion_motivo = NULL WHERE id = ?", [a.id]), 'uq:certificados_vigente_uq'));
        await prisma.certificado.update({ where: { id: b.id }, data: { estado: 'anulado', anulado_por: gerente.id, anulado_at: new Date(), anulacion_motivo: 'Prueba de doble sustitución (ficticia)' } });
        note('sustituir dos veces el mismo certificado', await rejects(prisma.certificado.create({ data: { ...snapshotData(mat.id), codigo_verificacion: code(), sustituye_a_id: a.id } }), 'uq:certificados_sustituye_uq'));
        const otra = await prisma.matricula.create({ data: { estudiante_id: sinDoc2.id, convocatoria_id: conv2.id } });
        note('sustituir un certificado de otra matrícula (P2003)', await rejects(prisma.certificado.create({ data: { ...snapshotData(otra.id), codigo_verificacion: code(), sustituye_a_id: b.id } }), 'P2003'));
        const cruzada = note('sustituir un certificado de otra matrícula (SQL)', await rejects(raw.query('INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por, sustituye_a_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [otra.id, code(), 'X', 'Y', 'PE', 'DNI', '00012345', 'C', 'curso', 'N', coord.id, b.id]), 1452));
        assert.equal(cruzada.code, '1452@certificados_sustituye_fk', 'la FK compuesta de sustitución es la que rechaza');
        const c = await prisma.certificado.create({ data: { ...snapshotData(mat.id), codigo_verificacion: code(), sustituye_a_id: b.id } });
        assert.equal(await prisma.certificado.count({ where: { matricula_id: mat.id, estado: 'vigente' } }), 1);
        assert.equal(await prisma.certificado.count({ where: { matricula_id: mat.id } }), 3, 'los anulados se conservan');
        note('borrar certificado sustituido (SQL)', await rejects(raw.query('DELETE FROM certificados WHERE id = ?', [a.id]), 1451));
        note('borrar matrícula con certificados (Prisma)', await rejects(prisma.matricula.delete({ where: { id: mat.id } }), 'P2003'));
        note('borrar administrador emisor (SQL)', await rejects(raw.query('DELETE FROM admin_users WHERE id = ?', [coord.id]), 1451));
        const porCodigo = await prisma.certificado.findUnique({ where: { codigo_verificacion: c.codigo_verificacion }, select: { estado: true, estudiante_doc_numero: true, convocatoria_fecha_fin: true } });
        assert.deepEqual([porCodigo.estado, porCodigo.estudiante_doc_numero, porCodigo.convocatoria_fecha_fin.toISOString().slice(0, 10)], ['vigente', '00012345', '2026-12-11']);
        // Lo que MySQL NO impide (lo harán los servicios): emitir con una matrícula sin cumplimiento confirmado, o con datos que no coincidan con el estudiante.
        const libre = await prisma.certificado.create({ data: { ...snapshotData(matSinDoc.id), codigo_verificacion: code() } });
        assert.equal(libre.estado, 'vigente');
        codes['NO comprobado por MySQL'] = 'emisión sobre matrícula pendiente aceptada (regla del servicio)';
        assert.equal(await raw.query('SELECT * FROM cursos WHERE id = ?', [curso.id]).then(([rows]) => JSON.stringify(rows)), cursoAntes, 'el curso sigue intacto');
      } finally { await raw.end(); }
      for (const [label, result] of Object.entries(codes)) t.diagnostic(label + ' -> ' + result);
    });

    // Instalación completa (init + migraciones) sobre una base nueva, sin pasar todavía por db:check.
    async function installed() {
      const name = await createDb();
      for (const script of ['init-database.cjs', 'migrate.cjs']) { const run = await runScript(script, name); assert.equal(run.code, 0, run.output); }
      return name;
    }

    await t.test('db:check rechaza estructuras incorrectas que conservan los nombres de las restricciones (auditoría E4.2)', async () => {
      // [caso, sentencias que estropean la estructura, mensaje esperado de db:check]
      const cases = [
        ['CHECK con el nombre correcto y expresión TRUE', ['ALTER TABLE convocatorias DROP CHECK convocatorias_revision_chk', 'ALTER TABLE convocatorias ADD CONSTRAINT convocatorias_revision_chk CHECK (TRUE)'], 'convocatorias: restricción convocatorias_revision_chk con otra expresión'],
        ['columna generada con la condición invertida', ["ALTER TABLE certificados MODIFY vigente_matricula_id INT GENERATED ALWAYS AS (CASE WHEN estado <> 'vigente' THEN matricula_id ELSE NULL END) STORED"], 'certificados.vigente_matricula_id: no es la columna generada STORED prevista'],
        ['UNIQUE(email), incompatible con contactos compartidos', ['ALTER TABLE estudiantes ADD UNIQUE KEY estudiantes_email_uq (email)'], 'estudiantes: índice único no previsto estudiantes_email_uq (email): email y telefono deben poder compartirse'],
        // Reverificación de Codex: los nombres de índice son locales a cada tabla; un nombre previsto en certificados no vale en estudiantes.
        ['UNIQUE(email) con el nombre de un índice de certificados', ['ALTER TABLE estudiantes ADD UNIQUE KEY certificados_codigo_uq (email)'], 'estudiantes: índice único no previsto certificados_codigo_uq (email): email y telefono deben poder compartirse'],
        ['UNIQUE(telefono) con el nombre de un índice de certificados', ['ALTER TABLE estudiantes ADD UNIQUE KEY certificados_codigo_uq (telefono)'], 'estudiantes: índice único no previsto certificados_codigo_uq (telefono): email y telefono deben poder compartirse'],
        ['índice previsto con las columnas en otro orden', ['ALTER TABLE convocatorias DROP INDEX convocatorias_estado_idx, ADD KEY convocatorias_estado_idx (fecha_inicio, estado)'], 'convocatorias: índice convocatorias_estado_idx distinto (no único sobre fecha_inicio, estado; se esperaba no único sobre estado, fecha_inicio)'],
        ['índice previsto sobre otra columna (email)', ['ALTER TABLE estudiantes DROP INDEX estudiantes_documento_uq, ADD UNIQUE KEY estudiantes_documento_uq (email)'], 'estudiantes: índice estudiantes_documento_uq distinto (único sobre email; se esperaba único sobre doc_pais, doc_tipo, doc_numero): email y telefono deben poder compartirse'],
        ['índice único previsto convertido en no único', ['ALTER TABLE certificados DROP INDEX certificados_codigo_uq, ADD KEY certificados_codigo_uq (codigo_verificacion)'], 'certificados: índice certificados_codigo_uq distinto (no único sobre codigo_verificacion; se esperaba único sobre codigo_verificacion)'],
        ['índice no único previsto convertido en único', ['ALTER TABLE estudiantes DROP INDEX estudiantes_nombre_idx, ADD UNIQUE KEY estudiantes_nombre_idx (apellidos, nombres)'], 'estudiantes: índice estudiantes_nombre_idx distinto (único sobre apellidos, nombres; se esperaba no único sobre apellidos, nombres)'],
        // Reverificación de Codex: db:check no comparaba SUB_PART, así que un índice por prefijo pasaba por el completo.
        ['UNIQUE por prefijo doc_numero(1) con el nombre del índice previsto', ['ALTER TABLE estudiantes DROP INDEX estudiantes_documento_uq, ADD UNIQUE KEY estudiantes_documento_uq (doc_pais, doc_tipo, doc_numero(1))'], 'estudiantes: índice estudiantes_documento_uq con longitud de prefijo distinta (columnas doc_pais, doc_tipo, doc_numero; longitud completa, completa, 1; se esperaba completa, completa, completa)'],
        ['índice no único por prefijo sobre columnas previstas', ['ALTER TABLE estudiantes DROP INDEX estudiantes_nombre_idx, ADD KEY estudiantes_nombre_idx (apellidos(5), nombres)'], 'estudiantes: índice estudiantes_nombre_idx con longitud de prefijo distinta (columnas apellidos, nombres; longitud 5, completa; se esperaba completa, completa)'],
        ['índice por prefijo sobre email reutilizando un nombre previsto', ['ALTER TABLE estudiantes DROP INDEX estudiantes_nombre_idx, ADD KEY estudiantes_nombre_idx (email(10))'], 'estudiantes: índice estudiantes_nombre_idx distinto (no único sobre email; se esperaba no único sobre apellidos, nombres)'],
        ['UNIQUE por prefijo sobre email con un nombre de otra tabla', ['ALTER TABLE estudiantes ADD UNIQUE KEY certificados_codigo_uq (email(10))'], 'estudiantes: índice único no previsto certificados_codigo_uq (email): email y telefono deben poder compartirse'],
        // Reverificación de Codex: Number() igualaba ambos umbrales.
        ['CHECK con un umbral decimal que coma flotante redondea a 1', ['ALTER TABLE convocatorias DROP CHECK convocatorias_revision_chk', 'ALTER TABLE convocatorias ADD CONSTRAINT convocatorias_revision_chk CHECK (revision >= 1.00000000000000000001)'], 'convocatorias: restricción convocatorias_revision_chk con otra expresión'],
        ['id sin AUTO_INCREMENT (tabla sin referencias)', ['ALTER TABLE academico_historial MODIFY id INT NOT NULL'], 'academico_historial.id: falta AUTO_INCREMENT'],
        // estudiantes.id está referenciado por matriculas: MySQL solo permite alterarlo con FOREIGN_KEY_CHECKS=0 en la sesión.
        ['id sin AUTO_INCREMENT (tabla referenciada)', ['SET FOREIGN_KEY_CHECKS=0', 'ALTER TABLE estudiantes MODIFY id INT NOT NULL'], 'estudiantes.id: falta AUTO_INCREMENT'],
        // E4.3b: un esquema que vuelva a admitir CE o PASAPORTE, o que pierda la longitud exacta del DNI, se rechaza.
        ['ENUM de estudiantes con CE reintroducido', ["ALTER TABLE estudiantes MODIFY doc_tipo ENUM('DNI','CE') NULL"], "estudiantes.doc_tipo: admite tipos de documento distintos de DNI (enum('DNI','CE')); falta aplicar 20261016-academico-solo-dni"],
        ['ENUM de certificados con PASAPORTE reintroducido', ["ALTER TABLE certificados MODIFY estudiante_doc_tipo ENUM('DNI','PASAPORTE') NOT NULL"], "certificados.estudiante_doc_tipo: admite tipos de documento distintos de DNI (enum('DNI','PASAPORTE'))"],
        ['CHECK de estudiantes sin CHAR_LENGTH (vuelve a aceptar un salto de línea final)', ['ALTER TABLE estudiantes DROP CHECK estudiantes_documento_formato_chk', "ALTER TABLE estudiantes ADD CONSTRAINT estudiantes_documento_formato_chk CHECK (doc_tipo IS NULL OR (doc_pais IS NOT NULL AND doc_numero IS NOT NULL AND doc_tipo = 'DNI' AND REGEXP_LIKE(doc_pais, '^PE$', 'c') AND REGEXP_LIKE(doc_numero, '^[0-9]{8}$', 'c')))"], 'estudiantes: restricción estudiantes_documento_formato_chk con otra expresión'],
        ['CHECK de certificados que admite PASAPORTE', ['ALTER TABLE certificados DROP CHECK certificados_documento_chk', "ALTER TABLE certificados ADD CONSTRAINT certificados_documento_chk CHECK ((estudiante_doc_tipo = 'DNI' AND REGEXP_LIKE(estudiante_doc_pais, '^PE$', 'c') AND REGEXP_LIKE(estudiante_doc_numero, '^[0-9]{8}$', 'c') AND CHAR_LENGTH(estudiante_doc_numero) = 8) OR estudiante_doc_tipo = 'PASAPORTE')"], 'certificados: restricción certificados_documento_chk con otra expresión'],
        ['sin la regla de formato de estudiantes', ['ALTER TABLE estudiantes DROP CHECK estudiantes_documento_formato_chk'], 'estudiantes: falta restricción estudiantes_documento_formato_chk'],
      ];
      for (const [label, statements, message] of cases) {
        const name = await installed();
        const db = await connectTo(name);
        try { for (const statement of statements) await db.query(statement); } finally { await db.end(); }
        const schema = await runScript('check-database.cjs', name);
        assert.equal(schema.code, 1, label + ': db:check debe fallar');
        assert.ok(schema.output.includes(message), label + ': db:check debe informar «' + message + '»');
        t.diagnostic('rechazado: ' + label + ' -> ' + message);
      }
      // Control: la misma regla reescrita con otro formato (paréntesis, mayúsculas, sin comillas inversas, el mismo valor exacto escrito
      // como 1.0 o 01.000) se sigue aceptando tal como MySQL la devuelve.
      for (const expression of ['((((REVISION)) >= 1))', 'revision >= 1.0', 'revision >= 01.000']) {
        const name = await installed();
        const db = await connectTo(name);
        try { for (const statement of ['ALTER TABLE convocatorias DROP CHECK convocatorias_revision_chk', 'ALTER TABLE convocatorias ADD CONSTRAINT convocatorias_revision_chk CHECK (' + expression + ')']) await db.query(statement); }
        finally { await db.end(); }
        const schema = await runScript('check-database.cjs', name);
        assert.equal(schema.code, 0, expression + ': ' + schema.output);
        t.diagnostic('aceptado: la misma expresión con otro formato -> ' + expression);
      }
    });

    await t.test('literales numéricos tal como los guarda MySQL 8.4: negativos, decimales e IN conservan su valor exacto', async () => {
      const { canonical } = require('../scripts/sql-expression.cjs'); // sin dependencias: no carga database.cjs ni .env
      const name = await createDb();
      const db = await connectTo(name);
      try {
        const declared = { p_neg: 'x > -1', p_neg_dec: 'y <> -(1.50)', p_fino: 'y >= 1.00000000000000000001', p_ceros: 'y >= 01.000', p_punto: 'y >= .5', p_in: 'x in (1, 2.0, -3)' };
        await db.query('CREATE TABLE sonda (x INT, y DECIMAL(40,30), ' + Object.entries(declared).map(([c, e]) => 'CONSTRAINT ' + c + ' CHECK (' + e + ')').join(', ') + ') ENGINE=InnoDB');
        const [rows] = await db.query("SELECT CONSTRAINT_NAME AS c, CHECK_CLAUSE AS e FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY 1");
        assert.equal(rows.length, Object.keys(declared).length);
        for (const { c, e } of rows) {
          assert.equal(canonical(e), canonical(declared[c]), c + ': lo que devuelve MySQL (' + e + ') equivale a lo declarado');
          t.diagnostic(c + ': ' + declared[c] + '  ->  MySQL: ' + e);
        }
        const stored = Object.fromEntries(rows.map(({ c, e }) => [c, e]));
        assert.notEqual(canonical(stored.p_fino), canonical('y >= 1'), '1.00000000000000000001 no se confunde con 1');
        assert.equal(canonical(stored.p_ceros), canonical('y >= 1'), '01.000 es 1');
        assert.notEqual(canonical(stored.p_neg), canonical('x > 1'), '-1 no es 1');
        // MySQL aplica de verdad la diferencia: 1 no cumple y >= 1.00000000000000000001.
        await rejects(db.query('INSERT INTO sonda (x, y) VALUES (1, 1)'), 'chk:p_fino');
        await db.query('INSERT INTO sonda (x, y) VALUES (1, 1.00000000000000000001)');
      } finally { await db.end(); }
    });

    // ---------------------------------------------------------------------------------------------------------------------------------
    // E4.3b: 20261016-academico-solo-dni (solo DNI peruano en estudiantes y certificados).
    const [ALTER_ESTUDIANTES, ALTER_CERTIFICADOS] = statementsOf(SOLO_DNI);
    const codigo = () => randomBytes(16).toString('hex').toUpperCase().slice(0, 26);
    const FORMATO_EST = 'chk:estudiantes_documento_formato_chk', FORMATO_CERT = 'chk:certificados_documento_chk';
    // Datos académicos ficticios válidos en E4.2 y en solo DNI: ceros iniciales, estudiante sin documento y archivado, matrícula
    // confirmada, certificado anulado y su sustituto vigente, e historial.
    async function seedDni(db) {
      await db.query("INSERT INTO admin_users (nombre, email, password, rol, createdAt, updatedAt) VALUES ('Coordinadora Ficticia', 'coordinadora@horus-e43.test', 'hash-ficticio', 'COORDINADORA_INSTITUCIONAL', NOW(), NOW())");
      const [[{ coord }]] = await db.query('SELECT MAX(id) AS coord FROM admin_users');
      await db.query("INSERT INTO cursos (titulo, slug, descripcion, tipo, estado, createdAt, updatedAt) VALUES ('Curso Ficticio', 'curso-ficticio-e43', 'Ficticio', 'curso', 'publicado', NOW(), NOW())");
      const [[{ curso }]] = await db.query('SELECT MAX(id) AS curso FROM cursos');
      const [cv] = await db.query("INSERT INTO convocatorias (curso_id, nombre, fecha_inicio, fecha_fin) VALUES (?, 'Noviembre 2026', '2026-11-16', '2026-12-11')", [curso]);
      const [e1] = await db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero, email) VALUES ('Rosa Ficticia', 'Prueba', 'PE', 'DNI', '00012345', 'compartido@horus-e43.test')");
      const [e2] = await db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('Luis Ficticio', 'Prueba', 'PE', 'DNI', '00000001')");
      await db.query("INSERT INTO estudiantes (nombres, apellidos, archivado_at) VALUES ('Sin Documento', 'Ficticio', '2026-10-01 10:00:00.000')");
      const [m1] = await db.query("INSERT INTO matriculas (estudiante_id, convocatoria_id, cumplimiento, confirmado_por, confirmado_rol, confirmado_at, revision) VALUES (?, ?, 'cumplido', ?, 'COORDINADORA_INSTITUCIONAL', '2026-12-12 10:00:00.123', 2)", [e1.insertId, cv.insertId, coord]);
      const [m2] = await db.query('INSERT INTO matriculas (estudiante_id, convocatoria_id) VALUES (?, ?)', [e2.insertId, cv.insertId]);
      const cert = (matricula, doc, sustituye = null) => db.query("INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, convocatoria_fecha_inicio, convocatoria_fecha_fin, emitido_por, emitido_at, sustituye_a_id) VALUES (?, ?, 'Nombre Ficticio', 'Prueba', ?, ?, ?, 'Curso Ficticio', 'curso', 'Noviembre 2026', '2026-11-16', '2026-12-11', ?, '2026-12-13 09:00:00.789', ?)", [matricula, codigo(), ...doc, coord, sustituye]).then(([r]) => r.insertId);
      const a = await cert(m1.insertId, ['PE', 'DNI', '00012345']);
      await db.query("UPDATE certificados SET estado = 'anulado', anulado_por = ?, anulado_at = '2026-12-14 08:00:00.000', anulacion_motivo = 'Error tipográfico (ficticio)' WHERE id = ?", [coord, a]);
      await cert(m1.insertId, ['PE', 'DNI', '00012345'], a);
      await db.query("INSERT INTO academico_historial (entidad, entidad_id, operacion, origen, operador, campos) VALUES ('certificado', ?, 'anulacion', 'terminal', 'e43-prueba', JSON_ARRAY('estado'))", [a]);
      return { coord, m2: m2.insertId, cert };
    }
    async function seeded(databaseAt, corrupt = async () => {}) {
      const name = await databaseAt();
      const db = await connectTo(name);
      try { await corrupt(db, await seedDni(db)); } finally { await db.end(); }
      return name;
    }
    // Líneas de SHOW CREATE TABLE que desaparecen y aparecen.
    const ddlChanges = (before, after) => ({ removed: before.split('\n').filter(l => !after.split('\n').includes(l)), added: after.split('\n').filter(l => !before.split('\n').includes(l)) });
    // Entre E4.2 y solo DNI cambian EXACTAMENTE dos líneas por tabla (el ENUM y el CHECK de formato); el resto de cada tabla es idéntico.
    function assertOnlyDocumentChanged(before, after) {
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no se crean ni eliminan tablas');
      for (const table of Object.keys(before)) {
        assert.equal(after[table].rows, before[table].rows, table + ': filas idénticas');
        if (!['estudiantes', 'certificados'].includes(table)) assert.equal(after[table].ddl, before[table].ddl, table + ': definición idéntica');
      }
      for (const [table, column, check, nullable] of [['estudiantes', 'doc_tipo', 'estudiantes_documento_formato_chk', 'DEFAULT NULL'], ['certificados', 'estudiante_doc_tipo', 'certificados_documento_chk', 'NOT NULL']]) {
        const { removed, added } = ddlChanges(before[table].ddl, after[table].ddl);
        assert.equal(before[table].ddl.split('\n').length, after[table].ddl.split('\n').length, table + ': mismo número de líneas');
        assert.equal(removed.length, 2, table + ': dos líneas retiradas');
        assert.ok(removed[0].trim().startsWith('`' + column + "` enum('DNI','CE','PASAPORTE') "), table + ': se retira el ENUM de E4.2');
        assert.ok(removed[1].trim().startsWith('CONSTRAINT `' + check + '` CHECK '), table + ': se retira el CHECK de E4.2');
        assert.equal(added.length, 2, table + ': dos líneas nuevas');
        assert.equal(added[0].trim(), '`' + column + "` enum('DNI') COLLATE utf8mb4_unicode_ci " + nullable + ',', table + ': ENUM solo DNI');
        assert.match(added[1], new RegExp('CONSTRAINT `' + check + '` CHECK .*= _utf8mb4\'DNI\'.*\\^PE\\$.*\\^\\[0-9\\]\\{8\\}\\$.*char_length\\(`(estudiante_)?doc_numero`\\) = 8'), table + ': CHECK de solo DNI');
        assert.ok(!/CE|PASAPORTE/.test(added.join('\n')), table + ': sin CE ni PASAPORTE');
      }
    }

    await t.test('E4.3b: db:check rechaza el esquema de E4.2; la actualización sin registros solo cambia el ENUM y el CHECK de documento', async () => {
      const name = await databaseAtE42();
      const pending = await runScript('check-database.cjs', name);
      assert.equal(pending.code, 1, 'un esquema que todavía admite CE o PASAPORTE no es compatible');
      for (const fragment of ["estudiantes.doc_tipo: admite tipos de documento distintos de DNI (enum('DNI','CE','PASAPORTE')); falta aplicar 20261016-academico-solo-dni",
        "certificados.estudiante_doc_tipo: admite tipos de documento distintos de DNI (enum('DNI','CE','PASAPORTE'))",
        'estudiantes: restricción estudiantes_documento_formato_chk con otra expresión', 'certificados: restricción certificados_documento_chk con otra expresión'])
        assert.ok(pending.output.includes(fragment), 'db:check informa: ' + fragment);
      const before = await snapshot(name, ['horus_migrations']);
      await migrateAndCheck(name);
      assertOnlyDocumentChanged(before, await snapshot(name, ['horus_migrations']));
      await migrateAndCheck(name); // repetir no reaplica nada
      t.diagnostic('actualización sin registros: ' + Object.keys(before).length + ' tablas; solo cambian 2 líneas en estudiantes y 2 en certificados');
    });

    await t.test('E4.3b: actualización desde E4.2 con estudiantes y certificados DNI válidos: todos los datos se conservan idénticos', async () => {
      const name = await seeded(databaseAtE42);
      const before = await snapshot(name, ['horus_migrations']);
      await migrateAndCheck(name, { empty: false });
      const after = await snapshot(name, ['horus_migrations']);
      assertOnlyDocumentChanged(before, after);
      const db = await connectTo(name);
      try {
        const [est] = await db.query('SELECT doc_pais, doc_tipo, doc_numero, archivado_at IS NOT NULL AS archivado FROM estudiantes ORDER BY id');
        assert.deepEqual(est.map(r => [r.doc_pais, r.doc_tipo, r.doc_numero, r.archivado]), [['PE', 'DNI', '00012345', 0], ['PE', 'DNI', '00000001', 0], [null, null, null, 1]], 'ceros iniciales y estudiante sin documento conservados');
        const [certs] = await db.query('SELECT estado, vigente_matricula_id IS NOT NULL AS vigente, sustituye_a_id IS NOT NULL AS sustituye, estudiante_doc_numero FROM certificados ORDER BY id');
        assert.deepEqual(certs.map(r => [r.estado, r.vigente, r.sustituye, r.estudiante_doc_numero]), [['anulado', 0, 0, '00012345'], ['vigente', 1, 1, '00012345']], 'certificado anulado y su sustituto, con la columna generada');
      } finally { await db.end(); }
      t.diagnostic('actualización con datos: ' + Object.keys(before).length + ' tablas con filas idénticas (3 estudiantes, 2 matrículas, 2 certificados, 1 historial)');
    });

    // La migración se detiene ANTES de cualquier sentencia: ni datos, ni estructura, ni horus_migrations cambian (modo estricto y no estricto).
    async function blockedUpgrade(label, corrupt, fragments, secret) {
      const name = await seeded(databaseAtE42, corrupt);
      const before = await snapshot(name, []);
      const [{ mode }] = await q('SELECT @@GLOBAL.sql_mode AS mode');
      assert.match(mode, /STRICT_TRANS_TABLES/, 'el servidor arranca en modo estricto');
      for (const sqlMode of [null, '']) {
        const run = sqlMode === null ? await runScript('migrate.cjs', name) : await withGlobalSqlMode(sqlMode, () => runScript('migrate.cjs', name));
        const where = label + (sqlMode === null ? ' (modo estricto)' : ' (modo no estricto)');
        assert.equal(run.code, 1, where + ': ' + run.output);
        assert.match(run.output, /Migración 20261016-academico-solo-dni detenida antes de modificar datos o estructura/, where);
        for (const fragment of fragments) assert.ok(run.output.includes(fragment), where + ': informa «' + fragment + '»');
        assert.ok(!run.output.includes(secret), where + ': no muestra el valor del documento');
        assert.deepEqual(await snapshot(name, []), before, where + ': ni datos, ni estructura, ni horus_migrations cambian');
        t.diagnostic('detenida: ' + where + ' -> ' + run.output.trim().split('\n').pop().slice(0, 170));
      }
      const schema = await runScript('check-database.cjs', name);
      assert.equal(schema.code, 1, label + ': db:check sigue rechazando el esquema de E4.2');
    }
    const insertCert = (db, matricula, coord, doc) => db.query("INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por) VALUES (?, ?, 'Nombre Ficticio', 'Prueba', ?, ?, ?, 'Curso Ficticio', 'curso', 'Noviembre 2026', ?)", [matricula, codigo(), ...doc, coord]);

    await t.test('E4.3b: con un estudiante CE la actualización se detiene sin modificar nada', async () => {
      await blockedUpgrade('estudiante CE', db => db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('Ce Ficticio', 'Prueba', 'PE', 'CE', 'ZQ90817')"), ['(estudiantes: CE 1)'], 'ZQ90817');
    });

    await t.test('E4.3b: con un certificado PASAPORTE la actualización se detiene sin modificar nada', async () => {
      await blockedUpgrade('certificado PASAPORTE', (db, seed) => insertCert(db, seed.m2, seed.coord, ['FR', 'PASAPORTE', '24ZQ90817']), ['(certificados: PASAPORTE 1)'], '24ZQ90817');
    });

    await t.test('E4.3b: con DNI que E4.2 aceptaba y la regla nueva rechaza (terminador final) la actualización se detiene', async () => {
      await blockedUpgrade('DNI con terminador final', async (db, seed) => {
        // E4.2 los admitía: el «$» de ICU coincide antes de un salto de línea final.
        await db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('Dni Ficticio', 'Prueba', 'PE', 'DNI', ?)", ['90817263\n']);
        await insertCert(db, seed.m2, seed.coord, ['PE', 'DNI', '90817263 ']);
      }, ['estudiantes: DNI con formato no admitido 1', 'certificados: DNI con formato no admitido 1'], '90817263');
    });

    await t.test('E4.3b: cada ALTER aplicado directamente (sin la comprobación previa) con filas no DNI falla sin cambiar nada, en modo estricto y no estricto', async () => {
      const cases = [
        ['estudiante CE', db => db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('Ce', 'Ficticio', 'PE', 'CE', 'AB123')"), ALTER_ESTUDIANTES, 1265, FORMATO_EST],
        ['estudiante PASAPORTE', db => db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('Pas', 'Ficticio', 'FR', 'PASAPORTE', '24AB12345')"), ALTER_ESTUDIANTES, 1265, FORMATO_EST],
        ['estudiante DNI con salto de línea final', db => db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('Dni', 'Ficticio', 'PE', 'DNI', ?)", ['12345678\n']), ALTER_ESTUDIANTES, FORMATO_EST, FORMATO_EST],
        ['certificado PASAPORTE', (db, seed) => insertCert(db, seed.m2, seed.coord, ['FR', 'PASAPORTE', '24AB12345']), ALTER_CERTIFICADOS, 1265, FORMATO_CERT],
        ['certificado CE', (db, seed) => insertCert(db, seed.m2, seed.coord, ['PE', 'CE', 'AB123']), ALTER_CERTIFICADOS, 1265, FORMATO_CERT],
      ];
      for (const [label, corrupt, statement, strictError, lenientError] of cases) {
        const name = await seeded(databaseAtE42, corrupt);
        const before = await snapshot(name, []);
        for (const [sqlMode, expected] of [['STRICT_TRANS_TABLES', strictError], ['', lenientError]]) {
          const db = await connectTo(name);
          try {
            await db.query('SET SESSION sql_mode = ?', [sqlMode]);
            const result = await rejects(db.query(statement), expected);
            t.diagnostic('ALTER directo, ' + label + ', sql_mode=' + JSON.stringify(sqlMode) + ' -> ' + result.code);
          } finally { await db.end(); }
          assert.deepEqual(await snapshot(name, []), before, label + ' (' + JSON.stringify(sqlMode) + '): el ALTER fallido no cambia datos ni estructura');
        }
      }
    });

    await t.test('E4.3b: recuperación de una migración parcialmente aplicada (DDL sin transacción conjunta)', async () => {
      for (const applied of [1, 2]) {
        const name = await seeded(databaseAtE42);
        const db = await connectTo(name);
        try { for (const statement of [ALTER_ESTUDIANTES, ALTER_CERTIFICADOS].slice(0, applied)) await db.query(statement); } finally { await db.end(); }
        const partial = await runScript('check-database.cjs', name);
        if (applied === 1) {
          assert.equal(partial.code, 1, 'db:check detecta que falta el ALTER de certificados');
          assert.ok(partial.output.includes('certificados.estudiante_doc_tipo: admite tipos de documento distintos de DNI') && !partial.output.includes('estudiantes.doc_tipo'), partial.output);
        } else assert.equal(partial.code, 0, 'estructura completa aunque la migración no esté registrada: ' + partial.output);
        const before = await snapshot(name, ['horus_migrations']);
        await migrateAndCheck(name, { empty: false }); // repite ambos ALTER (idempotentes) y registra la migración una sola vez
        const after = await snapshot(name, ['horus_migrations']);
        for (const table of Object.keys(before)) {
          assert.equal(after[table].rows, before[table].rows, applied + '/2 ' + table + ': filas idénticas');
          if (!(applied === 1 && table === 'certificados')) assert.equal(after[table].ddl, before[table].ddl, applied + '/2 ' + table + ': definición idéntica');
        }
        t.diagnostic('recuperación: ' + applied + '/2 sentencias aplicadas sin registrar -> db:migrate completa y db:check aceptado, datos idénticos');
      }
      // Parcial y, entre ambos ALTER, llega un certificado PASAPORTE (certificados aún lo admite): repetir db:migrate se detiene sin tocar nada.
      const name = await seeded(databaseAtE42, async (db, seed) => {
        await db.query(ALTER_ESTUDIANTES);
        await insertCert(db, seed.m2, seed.coord, ['FR', 'PASAPORTE', '24AB12345']);
      });
      const before = await snapshot(name, []);
      const run = await runScript('migrate.cjs', name);
      assert.equal(run.code, 1, run.output);
      assert.ok(run.output.includes('(certificados: PASAPORTE 1)'), run.output);
      assert.deepEqual(await snapshot(name, []), before, 'estado parcial conservado tal cual: nada se convierte ni se borra');
      const schema = await runScript('check-database.cjs', name);
      assert.equal(schema.code, 1);
      t.diagnostic('parcial con PASAPORTE posterior: detenida sin cambios; db:check sigue señalando certificados');
    });

    await t.test('E4.3b: MySQL solo acepta DNI peruano de 8 dígitos por SQL directo (modo estricto y no estricto)', async () => {
      const name = await installed();
      const db = await connectTo(name);
      try {
        const seed = await seedDni(db);
        const [[{ est0 }]] = await db.query('SELECT COUNT(*) AS est0 FROM estudiantes');
        const insertEst = doc => db.query('INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES (?, ?, ?, ?, ?)', ['Sql', 'Ficticio', ...doc]);
        const terminators = { '\\n': '\n', '\\r': '\r', '\\r\\n': '\r\n', '\\v': '\v', '\\f': '\f', 'U+0085': '\u0085', 'U+2028': ' ', 'U+2029': ' ' };
        // [caso, documento, rechazo en modo estricto (null = el mismo CHECK)]. En modo no estricto un tipo fuera del ENUM se guarda como '' y lo rechaza el CHECK.
        const cases = [
          ['CE', ['PE', 'CE', 'AB123'], 1265], ['PASAPORTE', ['FR', 'PASAPORTE', '24AB12345'], 1265], ['tipo vacío', ['PE', '', '12345678'], 1265], ['tipo desconocido', ['PE', 'LIBRETA', '12345678'], 1265],
          ['7 dígitos', ['PE', 'DNI', '1234567'], null], ['9 dígitos', ['PE', 'DNI', '123456789'], null], ['20 dígitos', ['PE', 'DNI', '1'.repeat(20)], null],
          ['país ES', ['ES', 'DNI', '12345678'], null], ['país en minúsculas', ['pe', 'DNI', '12345678'], null], ['letras', ['PE', 'DNI', 'ABCDEFGH'], null],
          ['ancho completo', ['PE', 'DNI', '１２３４５６７８'], null], ['espacio de no separación', ['PE', 'DNI', '1234567 '], null], ['espacio final', ['PE', 'DNI', '12345678 '], null],
          ['7 dígitos + \\n (8 caracteres)', ['PE', 'DNI', '1234567\n'], null], ['\\n inicial', ['PE', 'DNI', '\n12345678'], null],
          ...Object.entries(terminators).map(([label, end]) => ['8 dígitos + ' + label, ['PE', 'DNI', '12345678' + end], null]),
        ];
        for (const sqlMode of ['STRICT_TRANS_TABLES', '']) {
          await db.query('SET SESSION sql_mode = ?', [sqlMode]);
          const lenient = sqlMode === '';
          for (const [label, doc, strictError] of cases) {
            const where = label + ' sql_mode=' + JSON.stringify(sqlMode);
            const est = await rejects(insertEst(doc), lenient || strictError === null ? FORMATO_EST : strictError);
            const cert = await rejects(insertCert(db, seed.m2, seed.coord, doc), lenient || strictError === null ? FORMATO_CERT : strictError);
            t.diagnostic('rechazado ' + where + ': estudiantes ' + est.code + ', certificados ' + cert.code);
          }
          // Cambiar un documento existente a CE o PASAPORTE tampoco es posible.
          await rejects(db.query("UPDATE estudiantes SET doc_tipo = 'CE', doc_numero = 'AB123' WHERE doc_numero = '00012345'"), lenient ? FORMATO_EST : 1265);
          await rejects(db.query("UPDATE certificados SET estudiante_doc_pais = 'FR', estudiante_doc_tipo = 'PASAPORTE' WHERE estado = 'vigente'"), lenient ? FORMATO_CERT : 1265);
        }
        await db.query('SET SESSION sql_mode = DEFAULT');
        const [[{ est1 }]] = await db.query('SELECT COUNT(*) AS est1 FROM estudiantes');
        assert.equal(Number(est1), Number(est0), 'ningún rechazo dejó filas');
        // Válido: DNI de 8 dígitos ASCII con ceros iniciales, por SQL directo, se guarda sin cambios.
        await insertEst(['PE', 'DNI', '00000000']);
        await insertCert(db, seed.m2, seed.coord, ['PE', 'DNI', '00000001']);
        const [[row]] = await db.query("SELECT doc_tipo, HEX(doc_numero) AS hex FROM estudiantes WHERE nombres = 'Sql'");
        assert.deepEqual([row.doc_tipo, row.hex], ['DNI', '3030303030303030'], 'texto exacto con ceros iniciales');
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM certificados WHERE matricula_id = ?', [seed.m2]))[0][0].n, 1);
      } finally { await db.end(); }
      const schema = await runScript('check-database.cjs', name);
      assert.equal(schema.code, 0, schema.output);
    });

    await t.test('E4.3b: db:check acepta la regla de solo DNI escrita con otro formato equivalente', async () => {
      const name = await installed();
      const db = await connectTo(name);
      try {
        for (const statement of ['ALTER TABLE estudiantes DROP CHECK estudiantes_documento_formato_chk',
          "ALTER TABLE estudiantes ADD CONSTRAINT estudiantes_documento_formato_chk CHECK (((doc_tipo IS NULL)) OR ((doc_pais IS NOT NULL) AND (doc_numero IS NOT NULL) AND (doc_tipo = 'DNI') AND regexp_like(doc_pais, '^PE$', 'c') AND regexp_like(doc_numero, '^[0-9]{8}$', 'c') AND (char_length(doc_numero) = 8.0)))"]) await db.query(statement);
      } finally { await db.end(); }
      const schema = await runScript('check-database.cjs', name);
      assert.equal(schema.code, 0, schema.output);
    });

    await t.test('db:backup y db:restore reales con certificados vigentes y anulados: se conservan datos y relaciones y se recalcula la columna generada', async () => {
      // Origen: estado E4.1 con datos habituales, migrado a E4.2 y con datos académicos ficticios.
      const source = await databaseAtE41();
      let db = await connectTo(source);
      try {
        await db.query("INSERT INTO admin_users (nombre, email, password, rol, createdAt, updatedAt) VALUES ('Gerente Ficticia', 'gerente@horus-e42.test', 'hash-ficticio', 'GERENTE_GENERAL', NOW(), NOW()), ('Coordinadora Ficticia', 'coordinadora@horus-e42.test', 'hash-ficticio', 'COORDINADORA_INSTITUCIONAL', NOW(), NOW())");
        await db.query("INSERT INTO cursos (titulo, slug, descripcion, tipo, modalidad, duracion, fecha_inicio, estado, createdAt, updatedAt) VALUES ('Curso Ficticio', 'curso-ficticio-e42', 'Descripción ficticia', 'curso', 'virtual', '40 horas', '2026-11-03 09:30:00', 'publicado', NOW(), NOW())");
        await db.query("INSERT INTO servicios (titulo, slug, descripcion, categoria, estado, createdAt, updatedAt) VALUES ('Servicio Ficticio', 'servicio-ficticio-e42', 'Descripción ficticia', 'soporte', 'publicado', NOW(), NOW())");
        await db.query("INSERT INTO contactos (nombre, email, telefono, asunto, mensaje, createdAt, updatedAt) VALUES ('Contacto Ficticio', 'contacto@horus-e42.test', '000000000', 'Asunto', 'Mensaje ficticio', NOW(), NOW())");
      } finally { await db.end(); }
      await migrateAndCheck(source);
      db = await connectTo(source);
      const certs = {};
      try {
        const [[{ gerente }]] = await db.query("SELECT id AS gerente FROM admin_users WHERE rol = 'GERENTE_GENERAL'");
        const [[{ coord }]] = await db.query("SELECT id AS coord FROM admin_users WHERE rol = 'COORDINADORA_INSTITUCIONAL'");
        const [[{ curso }]] = await db.query('SELECT id AS curso FROM cursos');
        const [e1] = await db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero, email, telefono) VALUES ('Rosa Ficticia', 'Prueba', 'PE', 'DNI', '00012345', 'compartido@horus-e42.test', '+51 999 000 111')");
        const [e2] = await db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero, email) VALUES ('Marie Ficticia', 'Ensayo', 'PE', 'DNI', '00000007', 'compartido@horus-e42.test')");
        await db.query("INSERT INTO estudiantes (nombres, apellidos) VALUES ('Sin Documento', 'Ficticio')");
        const [cv] = await db.query("INSERT INTO convocatorias (curso_id, nombre, fecha_inicio, fecha_fin, estado) VALUES (?, 'Noviembre 2026', '2026-11-16', '2026-12-11', 'cerrada')", [curso]);
        const [m1] = await db.query("INSERT INTO matriculas (estudiante_id, convocatoria_id, cumplimiento, confirmado_por, confirmado_rol, confirmado_at, revision) VALUES (?, ?, 'cumplido', ?, 'COORDINADORA_INSTITUCIONAL', '2026-12-12 10:00:00.123', 2)", [e1.insertId, cv.insertId, coord]);
        const [m2] = await db.query("INSERT INTO matriculas (estudiante_id, convocatoria_id, cumplimiento, confirmado_por, confirmado_rol, confirmado_at, revision) VALUES (?, ?, 'cumplido', ?, 'GERENTE_GENERAL', '2026-12-12 11:00:00.456', 2)", [e2.insertId, cv.insertId, gerente]);
        const insert = (matricula, codigo, doc, sustituye) => db.query("INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, curso_duracion, convocatoria_nombre, convocatoria_fecha_inicio, convocatoria_fecha_fin, emitido_por, emitido_at, sustituye_a_id) VALUES (?, ?, ?, 'Prueba', ?, ?, ?, 'Curso Ficticio', 'curso', '40 horas', 'Noviembre 2026', '2026-11-16', '2026-12-11', ?, '2026-12-13 09:00:00.789', ?)", [matricula, codigo, ...doc, coord, sustituye]).then(([r]) => r.insertId);
        // m1: A emitido, anulado y sustituido por B (vigente). m2: C vigente.
        certs.a = await insert(m1.insertId, 'E42ANULADO000000000001', ['Rosa Ficticia', 'PE', 'DNI', '00012345'], null);
        await db.query("UPDATE certificados SET estado = 'anulado', anulado_por = ?, anulado_at = '2026-12-14 08:00:00.000', anulacion_motivo = 'Error tipográfico (ficticio)' WHERE id = ?", [gerente, certs.a]);
        certs.b = await insert(m1.insertId, 'E42VIGENTE000000000002', ['Rosa Ficticia', 'PE', 'DNI', '00012345'], certs.a);
        certs.c = await insert(m2.insertId, 'E42VIGENTE000000000003', ['Marie Ficticia', 'PE', 'DNI', '00000007'], null);
        certs.m1 = m1.insertId; certs.m2 = m2.insertId;
        await db.query("INSERT INTO academico_historial (entidad, entidad_id, operacion, origen, actor_id, actor_rol, estado_anterior, estado_nuevo, campos, revision, motivo) VALUES ('certificado', ?, 'anulacion', 'panel', ?, 'GERENTE_GENERAL', 'vigente', 'anulado', JSON_ARRAY('estado'), 1, 'Error tipográfico (ficticio)')", [certs.a, gerente]);
      } finally { await db.end(); }
      const before = await snapshot(source, []);
      assert.equal(JSON.parse(before.certificados.rows).length, 3);

      // Respaldo con el script real.
      const dir = join(cwd, 'backups-' + randomBytes(4).toString('hex'));
      const backup = await runScript('backup.cjs', source, ['--dir=' + dir]);
      assert.equal(backup.code, 0, backup.output);
      const file = join(dir, readdirSync(dir).find(f => f.endsWith('.sql.gz')));
      const lines = gunzipSync(readFileSync(file)).toString('utf8').split('\n');
      const createCert = lines.find(line => line.startsWith('CREATE TABLE `certificados`'));
      assert.match(createCert, /`vigente_matricula_id` int GENERATED ALWAYS AS \(.*\) STORED/, 'la definición de la columna generada se conserva');
      const insertCert = lines.filter(line => line.startsWith('INSERT INTO `certificados`'));
      assert.equal(insertCert.length, 1);
      assert.ok(!insertCert[0].includes('`vigente_matricula_id`'), 'el INSERT no incluye la columna generada');
      for (const column of ['id', 'matricula_id', 'codigo_verificacion', 'estado', 'estudiante_doc_numero', 'emitido_at', 'anulado_por', 'anulacion_motivo', 'sustituye_a_id']) assert.ok(insertCert[0].includes('`' + column + '`'), 'el INSERT incluye ' + column);
      assert.ok(lines.some(line => line.startsWith('INSERT INTO `estudiantes`') && line.includes('`createdAt`')), 'las columnas DEFAULT_GENERATED (createdAt) sí se copian');
      const manifest = JSON.parse(readFileSync(file + '.manifest.json', 'utf8'));
      assert.deepEqual(manifest.tables.filter(table => table.generatedColumns).map(table => [table.name, table.generatedColumns]), [['certificados', ['vigente_matricula_id']], ['docente_asignaciones', ['principal_activo_convocatoria_id']], ['preinscripciones', ['vigente_email']]], 'el respaldo no vuelca las columnas generadas (certificados y, desde 20261020, docente_asignaciones y preinscripciones): se recalculan al restaurar');

      // Restauración con el script real en una base aislada horus_restore_*.
      const verify = await runScript('restore.cjs', source, ['--file=' + file, '--verify-only']);
      assert.equal(verify.code, 0, verify.output);
      const target = 'horus_restore_e42_' + randomBytes(12).toString('hex');
      created.push(target);
      const restore = await runScript('restore.cjs', source, ['--file=' + file, '--target=' + target, '--yes']);
      assert.equal(restore.code, 0, restore.output);
      assert.match(restore.output, /Recuentos verificados en \d+ tablas/);
      // Integridad referencial explícita: TODAS las claves foráneas declaradas en el origen (anteriores y académicas, la compuesta y las de actores).
      const declaredKeys = await connectTo(source).then(async c => { try { return (await c.query('SELECT CONSTRAINT_NAME AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME'))[0].map(r => r.n); } finally { await c.end(); } });
      const verified = restore.output.match(/Integridad referencial verificada: (\d+) claves foráneas \((\d+) compuestas\), sin filas huérfanas: (.*)\./);
      assert.ok(verified, restore.output);
      assert.deepEqual([Number(verified[1]), Number(verified[2])], [declaredKeys.length, 3], 'tres claves compuestas: sustitución de certificados, sustitución de asignaciones docentes (20261020) y matrícula de una preinscripción convertida (20261020-preinscripciones); la de sesiones ya no se crea (migración retirada)');
      assert.deepEqual(verified[3].split(', ').sort(), [...declaredKeys].sort(), 'se comprueba cada clave foránea declarada');
      for (const key of ['convocatorias_curso_fk', 'matriculas_confirmado_por_fk', 'certificados_anulado_por_fk', 'certificados_emitido_por_fk', 'certificados_sustituye_fk', 'docente_asignaciones_docente_fk', 'docente_asignaciones_convocatoria_fk', 'docente_asignaciones_sustituye_fk', 'convocatoria_horarios_convocatoria_fk', 'preinscripciones_convocatoria_fk', 'preinscripciones_matricula_fk', 'preinscripciones_convertida_por_fk', 'preinscripciones_historial_fk', 'attention_contact_fk', 'cotizaciones_contacto_fk', 'convenio_fotos_convenio_id_fkey']) assert.ok(declaredKeys.includes(key), key);
      t.diagnostic('restauración válida: ' + verified[0]);

      // Todas las tablas (anteriores y académicas): misma definición y mismas filas, incluida la columna generada recalculada.
      // SHOW CREATE TABLE de la copia escribe «CHARACTER SET utf8mb4 COLLATE x» donde el origen pone «COLLATE x» (equivalente: la colación
      // determina el juego); por eso se normaliza solo esa forma y, además, se comparan los metadatos de cada columna en information_schema.
      const sameCharset = ddl => ddl.replace(/ CHARACTER SET \w+ COLLATE /g, ' COLLATE ');
      const columnsOf = async name => { const c = await connectTo(name); try { return JSON.stringify((await c.query('SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION'))[0]); } finally { await c.end(); } };
      assert.equal(await columnsOf(target), await columnsOf(source), 'columnas idénticas en information_schema (tipo, juego, colación, nulabilidad, valor por defecto, EXTRA y expresión generada)');
      const after = await snapshot(target, []);
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
      for (const table of Object.keys(before)) {
        assert.equal(sameCharset(after[table].ddl), sameCharset(before[table].ddl), table + ': definición idéntica');
        assert.equal(after[table].rows, before[table].rows, table + ': filas idénticas');
      }
      const check = await runScript('check-database.cjs', target);
      assert.equal(check.code, 0, check.output);
      db = await connectTo(target);
      try {
        const [rows] = await db.query('SELECT id, matricula_id, codigo_verificacion, estado, vigente_matricula_id, estudiante_doc_numero, anulado_por IS NOT NULL AS anulado, sustituye_a_id FROM certificados ORDER BY id');
        assert.deepEqual(rows.map(r => [r.id, r.codigo_verificacion, r.estado, r.vigente_matricula_id, r.estudiante_doc_numero, r.anulado, r.sustituye_a_id]), [
          [certs.a, 'E42ANULADO000000000001', 'anulado', null, '00012345', 1, null],
          [certs.b, 'E42VIGENTE000000000002', 'vigente', certs.m1, '00012345', 0, certs.a],
          [certs.c, 'E42VIGENTE000000000003', 'vigente', certs.m2, '00000007', 0, null],
        ]);
        const [[{ extra }]] = await db.query("SELECT EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificados' AND COLUMN_NAME = 'vigente_matricula_id'");
        assert.equal(extra, 'STORED GENERATED');
        // Relaciones: ninguna referencia huérfana tras restaurar con FOREIGN_KEY_CHECKS=0.
        const orphans = await db.query(`SELECT
          (SELECT COUNT(*) FROM certificados c LEFT JOIN matriculas m ON m.id = c.matricula_id WHERE m.id IS NULL) +
          (SELECT COUNT(*) FROM certificados c LEFT JOIN certificados s ON s.id = c.sustituye_a_id AND s.matricula_id = c.matricula_id WHERE c.sustituye_a_id IS NOT NULL AND s.id IS NULL) +
          (SELECT COUNT(*) FROM certificados c LEFT JOIN admin_users u ON u.id = c.emitido_por WHERE u.id IS NULL) +
          (SELECT COUNT(*) FROM matriculas m LEFT JOIN estudiantes e ON e.id = m.estudiante_id LEFT JOIN convocatorias v ON v.id = m.convocatoria_id WHERE e.id IS NULL OR v.id IS NULL) +
          (SELECT COUNT(*) FROM convocatorias v LEFT JOIN cursos c ON c.id = v.curso_id WHERE c.id IS NULL) AS n`).then(([[row]]) => Number(row.n));
        assert.equal(orphans, 0, 'relaciones íntegras');
        // Las reglas siguen activas en la copia: un segundo vigente, escribir la columna generada o borrar un sustituido se rechazan.
        await rejects(db.query("INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por) SELECT ?, 'E42SEGUNDOVIGENTE0004', 'X', 'Y', 'PE', 'DNI', '00012345', 'C', 'curso', 'N', emitido_por FROM certificados WHERE id = ?", [certs.m1, certs.b]), 'uq:certificados_vigente_uq');
        await rejects(db.query('INSERT INTO certificados (id, matricula_id, codigo_verificacion, estado, vigente_matricula_id, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por) SELECT 999, matricula_id, ?, estado, vigente_matricula_id, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por FROM certificados WHERE id = ?', ['E42CAUSAORIGINAL00005', certs.c]), 3105); // causa del fallo previo
        await rejects(db.query('DELETE FROM certificados WHERE id = ?', [certs.a]), 1451);
        // E4.3b: la copia conserva el ENUM y los CHECK de solo DNI (y los ceros iniciales de los datos restaurados).
        assert.deepEqual((await db.query("SELECT doc_numero AS n FROM estudiantes WHERE doc_numero IS NOT NULL ORDER BY doc_numero"))[0].map(r => r.n), ['00000007', '00012345']);
        await rejects(db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('Ce', 'Copia', 'PE', 'CE', 'AB123')"), 1265);
        await rejects(db.query("INSERT INTO estudiantes (nombres, apellidos, doc_pais, doc_tipo, doc_numero) VALUES ('Dni', 'Copia', 'PE', 'DNI', '12345678\\n')"), 'chk:estudiantes_documento_formato_chk');
        await rejects(db.query("UPDATE certificados SET estudiante_doc_tipo = 'PASAPORTE' WHERE id = ?", [certs.c]), 1265);
      } finally { await db.end(); }
      t.diagnostic('restauración real: ' + Object.keys(before).length + ' tablas idénticas (definición y filas); certificados: 1 anulado + 2 vigentes, columna generada recalculada; db:check aceptado en la copia');
    });

    // Reverificación de Codex: un respaldo con firma y recuentos VÁLIDOS (lo genera el db:backup real) pero con filas huérfanas, creadas en
    // el origen con FOREIGN_KEY_CHECKS=0, no puede restaurarse con éxito. El destino fallido se conserva para revisarlo y el origen no cambia.
    async function backupWithOrphans(corrupt) {
      const source = await installed();
      const db = await connectTo(source);
      try { await corrupt(db); } finally { await db.end(); }
      const before = await snapshot(source, []);
      const dir = join(cwd, 'backups-' + randomBytes(4).toString('hex'));
      const backup = await runScript('backup.cjs', source, ['--dir=' + dir]);
      assert.equal(backup.code, 0, backup.output);
      const file = join(dir, readdirSync(dir).find(f => f.endsWith('.sql.gz')));
      const verify = await runScript('restore.cjs', source, ['--file=' + file, '--verify-only']);
      assert.equal(verify.code, 0, 'la firma SHA-256 y el contenido son válidos: ' + verify.output);
      const target = 'horus_restore_e42_' + randomBytes(12).toString('hex');
      created.push(target);
      const restore = await runScript('restore.cjs', source, ['--file=' + file, '--target=' + target, '--yes']);
      assert.equal(restore.code, 1, 'la restauración con huérfanos debe fallar: ' + restore.output);
      assert.match(restore.output, /Recuentos verificados en \d+ tablas/, 'los recuentos del manifiesto son correctos: el fallo no depende de un archivo dañado');
      assert.match(restore.output, /RESTAURACIÓN FALLIDA: integridad referencial rota/);
      assert.ok(!/Integridad referencial verificada/.test(restore.output), 'nunca se declara verificada');
      assert.ok(restore.output.includes('queda incompleta y NO debe usarse; no se borró nada'));
      const [kept] = await q('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [target]);
      assert.ok(Number(kept.n) > 0, 'el destino fallido se conserva para revisarlo (no se borra automáticamente)');
      const after = await snapshot(source, []);
      assert.deepEqual(after, before, 'el origen no cambia');
      return restore.output;
    }
    const certificate = (db, matricula, codigo, emisor, sustituye = null) => db.query("INSERT INTO certificados (matricula_id, codigo_verificacion, estudiante_nombres, estudiante_apellidos, estudiante_doc_pais, estudiante_doc_tipo, estudiante_doc_numero, curso_titulo, curso_tipo, convocatoria_nombre, emitido_por, sustituye_a_id) VALUES (?, ?, 'Rosa Ficticia', 'Prueba', 'PE', 'DNI', '00012345', 'Curso Ficticio', 'curso', 'Noviembre 2026', ?, ?)", [matricula, codigo, emisor, sustituye]).then(([r]) => r.insertId);

    await t.test('db:restore rechaza un respaldo válido cuya convocatoria apunta a un curso inexistente', async () => {
      const output = await backupWithOrphans(async db => {
        await db.query("INSERT INTO cursos (titulo, slug, descripcion, tipo, estado, createdAt, updatedAt) VALUES ('Curso Ficticio', 'curso-ficticio-e42', 'Ficticio', 'curso', 'publicado', NOW(), NOW())");
        await db.query("INSERT INTO convocatorias (curso_id, nombre) SELECT id, 'Convocatoria válida' FROM cursos");
        await db.query('SET FOREIGN_KEY_CHECKS=0');
        await db.query("INSERT INTO convocatorias (curso_id, nombre) VALUES (999999, 'Convocatoria huérfana (ficticia)')");
      });
      const lines = output.split('\n').filter(line => line.startsWith('  - '));
      assert.deepEqual(lines, ['  - convocatorias(curso_id) → cursos(id) [convocatorias_curso_fk]: 1 fila huérfana'], 'solo la relación afectada');
      t.diagnostic('rechazado: ' + lines.join(' | '));
    });

    await t.test('db:restore rechaza huérfanos en la clave compuesta de sustitución y en las relaciones de actores', async () => {
      const output = await backupWithOrphans(async db => {
        await db.query("INSERT INTO admin_users (nombre, email, password, rol, createdAt, updatedAt) VALUES ('Coordinadora Ficticia', 'coordinadora@horus-e42.test', 'hash-ficticio', 'COORDINADORA_INSTITUCIONAL', NOW(), NOW())");
        const [[{ coord }]] = await db.query('SELECT id AS coord FROM admin_users');
        await db.query("INSERT INTO cursos (titulo, slug, descripcion, tipo, estado, createdAt, updatedAt) VALUES ('Curso Ficticio', 'curso-ficticio-e42', 'Ficticio', 'curso', 'publicado', NOW(), NOW())");
        const [cv] = await db.query("INSERT INTO convocatorias (curso_id, nombre) SELECT id, 'Noviembre 2026' FROM cursos");
        const [e1] = await db.query("INSERT INTO estudiantes (nombres, apellidos) VALUES ('Uno Ficticio', 'Prueba')");
        const [e2] = await db.query("INSERT INTO estudiantes (nombres, apellidos) VALUES ('Dos Ficticio', 'Prueba')");
        const [m1] = await db.query("INSERT INTO matriculas (estudiante_id, convocatoria_id, cumplimiento, confirmado_por, confirmado_rol, confirmado_at) VALUES (?, ?, 'cumplido', ?, 'COORDINADORA_INSTITUCIONAL', NOW(3))", [e1.insertId, cv.insertId, coord]);
        const [m2] = await db.query('INSERT INTO matriculas (estudiante_id, convocatoria_id) VALUES (?, ?)', [e2.insertId, cv.insertId]);
        const a = await certificate(db, m2.insertId, 'E42HUERFANO0000000001', coord); // A pertenece a la matrícula m2
        const b = await certificate(db, m1.insertId, 'E42HUERFANO0000000002', coord);
        await db.query('SET FOREIGN_KEY_CHECKS=0');
        await db.query('UPDATE matriculas SET confirmado_por = 999999 WHERE id = ?', [m1.insertId]);
        await db.query("UPDATE certificados SET estado = 'anulado', anulado_por = 999998, anulado_at = NOW(3), anulacion_motivo = 'Prueba (ficticia)' WHERE id = ?", [b]);
        // C (matrícula m1) dice sustituir a A, que existe pero es de m2: cada columna por separado existe, el par (id, matricula_id) no.
        await certificate(db, m1.insertId, 'E42HUERFANO0000000003', coord, a);
      });
      const lines = output.split('\n').filter(line => line.startsWith('  - ')).sort();
      assert.deepEqual(lines, [
        '  - certificados(anulado_por) → admin_users(id) [certificados_anulado_por_fk]: 1 fila huérfana',
        '  - certificados(sustituye_a_id, matricula_id) → certificados(id, matricula_id) [certificados_sustituye_fk]: 1 fila huérfana',
        '  - matriculas(confirmado_por) → admin_users(id) [matriculas_confirmado_por_fk]: 1 fila huérfana',
      ]);
      t.diagnostic('rechazado: ' + lines.join(' | '));
    });
  } finally {
    await Promise.allSettled(clients.map(client => client.$disconnect()));
    try { for (const name of created) await q('DROP DATABASE IF EXISTS `' + name + '`'); }
    finally { await admin.end(); rmSync(cwd, { recursive: true, force: true }); }
  }
});
