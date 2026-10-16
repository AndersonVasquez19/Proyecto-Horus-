// H-BACK-01 E4.2: estructura de datos académicos (20261015-academico-estructura) contra un MySQL 8.4 REAL y DESECHABLE, con
// Prisma 6.19.3 y su adaptador MariaDB. No forma parte de `npm test` ni de test:integration; la CI la ejecuta en su MySQL efímero.
//
//   ACADEMICO_SCHEMA_TEST_DB=true ACADEMICO_SCHEMA_TEST_SERVER_UUID=<@@server_uuid leído por docker exec> DB_HOST=127.0.0.1 DB_PORT=<puerto>
//   DB_USER=root DB_PASS=<clave de un solo uso>  node --test -r ./test/isolate-env.cjs test/academico-schema.integration.cjs
//
// Barreras (las mismas que E3.5 y E3.6; todas antes de crear nada):
//  1. ACADEMICO_SCHEMA_TEST_DB=true explícito.  2. DB_HOST de bucle local y DB_PORT explícito.
//  3. @@server_uuid de la conexión = ACADEMICO_SCHEMA_TEST_SERVER_UUID, obtenido por otra vía (docker exec en el contenedor propio).
//  4. Servidor recién creado (Uptime < 1 h) y sin tablas en ninguna base ajena a las del sistema.
// Solo crea y elimina bases horus_e42_<hex>. Datos ficticios (ningún documento ni nombre real). Este proceso no importa database.cjs
// (no carga ningún .env): los scripts reales se lanzan como procesos hijos con un directorio de trabajo temporal y un entorno mínimo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, realpathSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const { PrismaClient, Prisma } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

const backend = join(__dirname, '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NAME = /^horus_e42_[0-9a-f]{24}$/;
const MIGRATION = '20261015-academico-estructura';
const ACADEMIC_TABLES = ['estudiantes', 'convocatorias', 'matriculas', 'certificados', 'academico_historial'];
// La lista `versions` se lee como texto: importar migrate.cjs cargaría database.cjs y, con él, un posible backend/.env.
const VERSIONS = JSON.parse(readFileSync(join(backend, 'scripts', 'migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const statementsOf = name => readFileSync(join(backend, 'migrations', name + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean); // criterio de migrate.cjs

test('E4.2: estructura académica en MySQL 8.4 desechable (instalación, actualización, recuperación, restricciones y Prisma)', async t => {
  if (process.env.ACADEMICO_SCHEMA_TEST_DB !== 'true') return t.skip('Requiere ACADEMICO_SCHEMA_TEST_DB=true y un MySQL desechable identificado.');
  assert.equal(VERSIONS.at(-1), MIGRATION, 'la migración E4.2 es la última registrada');
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
  function runScript(file, name) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-r', join(__dirname, 'isolate-env.cjs'), join(backend, 'scripts', file)], { cwd, env: env(name), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
  // Estado E4.1: init + todas las migraciones anteriores a la E4.2, registradas como lo haría migrate.cjs.
  async function databaseAtE41() {
    const name = await createDb();
    const init = await runScript('init-database.cjs', name);
    assert.equal(init.code, 0, init.output);
    const db = await connectTo(name);
    try {
      await db.query('CREATE TABLE IF NOT EXISTS horus_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)');
      for (const version of VERSIONS.slice(0, -1)) {
        for (const statement of statementsOf(version)) await db.query(statement);
        await db.execute('INSERT INTO horus_migrations (name, applied_at) VALUES (?, ?)', [version, new Date()]);
      }
    } finally { await db.end(); }
    return name;
  }
  async function migrateAndCheck(name) {
    const migrate = await runScript('migrate.cjs', name);
    assert.equal(migrate.code, 0, migrate.output);
    const schema = await runScript('check-database.cjs', name);
    assert.equal(schema.code, 0, schema.output);
    assert.match(schema.output, /Esquema compatible/);
    const db = await connectTo(name);
    try {
      const [rows] = await db.query('SELECT name FROM horus_migrations ORDER BY name');
      assert.deepEqual(rows.map(row => row.name), [...VERSIONS].sort(), 'cada migración registrada una sola vez');
      for (const table of ACADEMIC_TABLES) assert.equal((await db.query('SELECT COUNT(*) AS n FROM `' + table + '`'))[0][0].n, 0, table + ' vacía: la migración no inserta datos');
    } finally { await db.end(); }
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
        'convocatorias.convocatorias_fechas_chk=YES', 'convocatorias.convocatorias_nombre_chk=YES', 'convocatorias.convocatorias_revision_chk=YES',
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
        'estudiantes.estudiantes_documento_uq(doc_pais,doc_tipo,doc_numero)', 'matriculas.matriculas_estudiante_convocatoria_uq(estudiante_id,convocatoria_id)',
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
      const after = await snapshot(name, ['horus_migrations', ...ACADEMIC_TABLES]);
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

    await t.test('una tabla preexistente con otra forma no se corrige en silencio: migrate termina y db:check la rechaza', async () => {
      const name = await databaseAtE41();
      const db = await connectTo(name);
      try { await db.query('CREATE TABLE `estudiantes` (`id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY, `nombres` VARCHAR(120) NOT NULL, `apellidos` VARCHAR(120) NOT NULL, `doc_tipo` VARCHAR(20) NULL, `doc_numero` BIGINT NULL) ENGINE=InnoDB'); }
      finally { await db.end(); }
      const migrate = await runScript('migrate.cjs', name);
      assert.equal(migrate.code, 0, 'CREATE TABLE IF NOT EXISTS omite la tabla existente');
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
        await prisma.estudiante.create({ data: { nombres: 'Carlos Ficticio', apellidos: 'Prueba Cuatro', doc_pais: 'PE', doc_tipo: 'CE', doc_numero: '000123456' } });
        await prisma.estudiante.create({ data: { nombres: 'Marie Fictive', apellidos: 'Essai', doc_pais: 'FR', doc_tipo: 'PASAPORTE', doc_numero: '24AB12345' } });
        await prisma.estudiante.create({ data: { nombres: 'Mononimo', apellidos: '', doc_pais: 'CL', doc_tipo: 'PASAPORTE', doc_numero: '24AB12345' } }); // mismo número, otro país
        await prisma.estudiante.create({ data: { nombres: 'Doble Ficticio', apellidos: 'Prueba', doc_pais: 'PE', doc_tipo: 'CE', doc_numero: '00012345' } }); // mismo número, otro tipo
        const estudiantes = await prisma.estudiante.count();
        note('estudiante duplicado', await rejects(prisma.estudiante.create({ data: { nombres: 'Dup', apellidos: 'Dup', doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00012345' } }), 'uq:estudiantes_documento_uq'));
        // [caso, documento, rechazo esperado]. Un documento parcial viola la regla de completitud (y a veces también la de formato: MySQL informa una).
        const FORMATO = 'chk:estudiantes_documento_formato_chk', PARCIAL = 'chk:estudiantes_documento_';
        const invalid = [
          ['documento parcial (solo tipo)', { doc_tipo: 'DNI' }, PARCIAL], ['documento parcial (sin país)', { doc_tipo: 'PASAPORTE', doc_numero: 'X1234567' }, PARCIAL],
          ['documento parcial (sin número)', { doc_pais: 'PE', doc_tipo: 'DNI' }, PARCIAL], ['documento parcial (sin tipo)', { doc_pais: 'PE', doc_numero: '12345678' }, 'chk:estudiantes_documento_completo_chk'],
          ['DNI de 7 dígitos', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1234567' }, FORMATO], ['DNI de 9 dígitos', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '123456789' }, FORMATO],
          ['DNI con letras', { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '1234567A' }, FORMATO], ['DNI de otro país', { doc_pais: 'AR', doc_tipo: 'DNI', doc_numero: '12345678' }, FORMATO],
          ['DNI con país en minúsculas', { doc_pais: 'pe', doc_tipo: 'DNI', doc_numero: '12345678' }, FORMATO], ['CE de otro país', { doc_pais: 'CO', doc_tipo: 'CE', doc_numero: '123456789' }, FORMATO],
          ['CE de 13 caracteres', { doc_pais: 'PE', doc_tipo: 'CE', doc_numero: '1234567890123' }, FORMATO], ['pasaporte en minúsculas', { doc_pais: 'FR', doc_tipo: 'PASAPORTE', doc_numero: '24ab12345' }, FORMATO],
          ['pasaporte con guion', { doc_pais: 'FR', doc_tipo: 'PASAPORTE', doc_numero: '24-AB12345' }, FORMATO], ['pasaporte con espacio', { doc_pais: 'FR', doc_tipo: 'PASAPORTE', doc_numero: '24AB 1234' }, FORMATO],
          ['pasaporte de 21 caracteres', { doc_pais: 'FR', doc_tipo: 'PASAPORTE', doc_numero: 'A'.repeat(21) }, 'P2000'], ['país de 1 letra', { doc_pais: 'F', doc_tipo: 'PASAPORTE', doc_numero: 'A1' }, FORMATO],
          ['país en minúsculas', { doc_pais: 'fr', doc_tipo: 'PASAPORTE', doc_numero: 'A1' }, FORMATO], ['país numérico', { doc_pais: '12', doc_tipo: 'PASAPORTE', doc_numero: 'A1' }, FORMATO],
          ['número vacío', { doc_pais: 'FR', doc_tipo: 'PASAPORTE', doc_numero: '' }, FORMATO],
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
  } finally {
    await Promise.allSettled(clients.map(client => client.$disconnect()));
    try { for (const name of created) await q('DROP DATABASE IF EXISTS `' + name + '`'); }
    finally { await admin.end(); rmSync(cwd, { recursive: true, force: true }); }
  }
});
