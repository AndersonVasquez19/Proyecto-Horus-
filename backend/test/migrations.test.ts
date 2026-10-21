import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Comprobaciones sin base de datos: el orden, el registro y la seguridad de las migraciones SQL. La aplicación real se prueba en test:integration (MySQL aislado).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { versions } = require('../scripts/migrate.cjs') as { versions: string[] };
const dir = join(__dirname, '..', 'migrations');
const read = (name: string) => readFileSync(join(dir, name + '.sql'), 'utf8');
const statements = (sql: string) => sql.split(';').map(s => s.trim()).filter(Boolean); // mismo criterio que scripts/migrate.cjs
// UPDATE existentes y justificados: 1) deja en NULL referencias huérfanas antes de crear la clave foránea; 2) deriva `origen` de los contactos del chatbot ya guardados.
// Migraciones obligatorias y su orden relativo de ejecución. Si una desaparece de `versions` o se reordena, la prueba falla; las migraciones NUEVAS se añaden
// al final de `versions` sin tocar esta lista (no hay que mantener ninguna como «la última»). Añade aquí una migración solo si pasa a ser obligatoria.
const REQUIRED_ORDER = ['20260909-create-catalogo', '20260921-create-cotizaciones', '20261002-complete-institutional', '20261002-original-design', '20261002-create-convenios',
  '20261003-remove-otros-category', '20261009-chatbot-metrics', '20261010-newsletter-default-novedades', '20261011-cotizaciones-idempotencia'];
// Las que el código desplegado necesita ya aplicadas (RAILWAY.md debe decirlo): el cliente Prisma selecciona sus columnas.
// 20261014-admin-auditoria: el alta de cuentas y su activación o desactivación escriben en admin_auditoria dentro de su transacción.
const REQUIRED_BEFORE_DEPLOY = ['20261009-chatbot-metrics', '20261011-cotizaciones-idempotencia', '20261014-admin-rol', '20261014-admin-auditoria'];
const ALLOWED_UPDATES = new Set(['20261002-complete-institutional', '20261009-chatbot-metrics']);

test('migraciones: cada archivo SQL está registrado en migrate.cjs y viceversa, sin duplicados', () => {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => f.slice(0, -4)).filter(f => f !== '00000000-initial'); // la inicial la aplica db:init
  assert.deepEqual([...files].sort(), [...versions].sort());
  assert.equal(new Set(versions).size, versions.length);
});

test('migraciones: el orden de ejecución es el de migrate.cjs y sus fechas nunca retroceden', () => {
  const dates = versions.map(v => v.slice(0, 8));
  assert.ok(versions.every(v => /^\d{8}-[a-z0-9-]+$/.test(v)));
  assert.deepEqual([...dates].sort(), dates, 'una migración nueva va siempre al final');
});

test('migraciones: todas las obligatorias siguen registradas y en su orden relativo (aunque se añadan migraciones posteriores)', () => {
  const positions = REQUIRED_ORDER.map(name => versions.indexOf(name));
  REQUIRED_ORDER.forEach((name, i) => assert.notEqual(positions[i], -1, name + ' ya no está registrada en migrate.cjs'));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'las migraciones obligatorias cambiaron de orden: ' + REQUIRED_ORDER.join(' < '));
  assert.ok(new Set(positions).size === positions.length);
  for (const name of REQUIRED_ORDER) assert.ok(read(name).trim().length > 0, name + ' está vacía o no existe');
});

test('migraciones: no borran estructura ni datos y los UPDATE están autorizados', () => {
  for (const name of versions) {
    for (const statement of statements(read(name))) {
      assert.ok(!/^(DROP|TRUNCATE|DELETE|RENAME)\b/i.test(statement) && !/\bDROP\s+(TABLE|DATABASE|COLUMN|INDEX)\b/i.test(statement), name + ': sentencia destructiva');
      if (/^UPDATE\b/i.test(statement)) assert.ok(ALLOWED_UPDATES.has(name), name + ': UPDATE no autorizado');
      if (/^INSERT\b/i.test(statement)) assert.fail(name + ': las migraciones no insertan datos de ejemplo');
      assert.ok(/^(ALTER TABLE|CREATE TABLE|CREATE INDEX|UPDATE|SET)\b/i.test(statement), name + ': sentencia no reconocida: ' + statement.slice(0, 40));
    }
    assert.ok(statements(read(name)).length > 0, name + ' está vacía');
  }
});

test('migraciones: la 20261009 y la 20261011 están reflejadas en schema.prisma y en db:check; la documentación de despliegue nombra todas y declara las obligatorias', () => {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8'), check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  for (const column of ['idempotencia_clave', 'idempotencia_huella']) {
    assert.ok(read('20261011-cotizaciones-idempotencia').includes(column) && schema.includes(column) && check.includes(column), column);
  }
  for (const table of ['chatbot_interacciones', 'chatbot_preguntas_sin_respuesta']) assert.ok(read('20261009-chatbot-metrics').includes(table) && schema.includes(table) && check.includes(table), table);
  const railway = readFileSync(join(__dirname, '..', '..', 'RAILWAY.md'), 'utf8');
  for (const name of versions) assert.ok(railway.includes(name), 'RAILWAY.md debe nombrar ' + name);
  // El requisito «antes de desplegar» debe constar junto a esas migraciones, sin importar cuál sea la última de la lista.
  const statement = railway.split(/\r?\n/).find(line => /requeridas? antes de desplegar/i.test(line)) ?? '';
  for (const name of REQUIRED_BEFORE_DEPLOY) assert.ok(statement.includes(name), 'RAILWAY.md debe declarar ' + name + ' como requerida antes de desplegar');
});

test('migraciones: la 20261014 añade solo la columna rol (nula, sin valor predeterminado) y está reflejada en schema.prisma y db:check', () => {
  const sql = statements(read('20261014-admin-rol'));
  assert.equal(sql.length, 1);
  assert.match(sql[0], /^ALTER TABLE admin_users ADD COLUMN rol ENUM\('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA'\) NULL$/);
  assert.ok(!/DEFAULT/i.test(sql[0]), 'ningún rol se concede de forma implícita');
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8'), check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  assert.match(schema, /\r?\n  rol AdminRol\?\r?\n/);
  assert.ok(!/rol AdminRol[^\n]*@default/.test(schema));
  assert.ok(check.includes("['admin_users','rol',") && check.includes('GERENTE_GENERAL'));
  assert.ok(versions.indexOf('20261014-admin-rol') > versions.indexOf('20261011-cotizaciones-idempotencia'));
});

test('migraciones: la 20261014-admin-auditoria crea solo la tabla de auditoría, sin datos personales ni claves foráneas, reflejada en schema.prisma y db:check', () => {
  const sql = statements(read('20261014-admin-auditoria'));
  assert.equal(sql.length, 1);
  assert.match(sql[0], /^CREATE TABLE IF NOT EXISTS `admin_auditoria` \(/);
  assert.ok(!/FOREIGN KEY|REFERENCES/i.test(sql[0]), 'el historial no depende de que la cuenta exista');
  assert.ok(!/`(email|correo|nombre|password|token|ip)`/i.test(sql[0]), 'no guarda correos, nombres, contraseñas, tokens ni IP');
  const columns = [...sql[0].matchAll(/^\s*`([a-z_A-Z]+)` /gm)].map(match => match[1]);
  assert.deepEqual(columns, ['id', 'createdAt', 'origen', 'actor_id', 'operador', 'cuenta_id', 'operacion', 'rol_anterior', 'rol_nuevo', 'activo_anterior', 'activo_nuevo', 'resultado', 'motivo']);
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8'), check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  assert.match(schema, /model AdminAuditoria \{[\s\S]*?@@map\("admin_auditoria"\)/);
  for (const column of columns) assert.ok(check.includes("['" + column + "',"), 'db:check debe esperar admin_auditoria.' + column);
  for (const index of ['admin_auditoria_cuenta_idx', 'admin_auditoria_actor_idx']) assert.ok(sql[0].includes(index) && schema.includes(index) && check.includes(index), index);
  assert.ok(versions.indexOf('20261014-admin-auditoria') > versions.indexOf('20261014-admin-rol'), 'usa el tipo de rol de la migración anterior');
});

test('migraciones: la 20261011 es aditiva y admite filas existentes (columnas nulas, índice único que tolera varios NULL)', () => {
  const sql = statements(read('20261011-cotizaciones-idempotencia'));
  assert.equal(sql.length, 3);
  assert.ok(sql.slice(0, 2).every(s => /^ALTER TABLE cotizaciones ADD COLUMN idempotencia_\w+ \w+\(\d+\) NULL$/.test(s)));
  assert.match(sql[2], /^ALTER TABLE cotizaciones ADD UNIQUE KEY cotizaciones_idempotencia_clave \(idempotencia_clave\)$/);
});

test('migraciones: la 20261015-academico-estructura (E4.2) solo crea las cinco tablas académicas, restrictivas y sin datos, reflejadas en schema.prisma y db:check', () => {
  const sql = statements(read('20261015-academico-estructura'));
  const tables = ['estudiantes', 'convocatorias', 'matriculas', 'certificados', 'academico_historial']; // orden de dependencias: cada CREATE es atómico
  assert.deepEqual(sql.map(s => (s.match(/^CREATE TABLE IF NOT EXISTS `(\w+)` \(/) ?? [])[1]), tables);
  assert.ok(versions.indexOf('20261015-academico-estructura') > versions.indexOf('20261014-admin-auditoria'), 'referencia a admin_users y cursos ya existentes');
  const all = sql.join('\n');
  assert.ok(!/ON (DELETE|UPDATE) (CASCADE|SET NULL|SET DEFAULT)/i.test(all), 'ninguna relación borra ni modifica en cascada');
  assert.equal((all.match(/FOREIGN KEY/g) ?? []).length, (all.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length);
  assert.ok(!/reniec|verificad|validad|consulta_/i.test(all), 'sin campos que afirmen una verificación externa del documento');
  assert.match(all, /`doc_tipo` ENUM\('DNI','CE','PASAPORTE'\) NULL/);
  assert.match(all, /`doc_numero` VARCHAR\(20\) NULL/, 'VARCHAR conserva los ceros iniciales');
  assert.match(all, /`email` VARCHAR\(254\) NULL,\s+`telefono` VARCHAR\(30\) NULL,/, 'contacto opcional del estudiante');
  assert.ok(!/(UNIQUE )?(KEY|INDEX)[^\n]*`(email|telefono)`/i.test(all), 'email y telefono no tienen índice ni UNIQUE: se pueden compartir');
  assert.match(all, /UNIQUE KEY `estudiantes_documento_uq` \(`doc_pais`, `doc_tipo`, `doc_numero`\)/);
  assert.match(all, /UNIQUE KEY `matriculas_estudiante_convocatoria_uq` \(`estudiante_id`, `convocatoria_id`\)/);
  assert.match(all, /`confirmado_rol` ENUM\('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL'\) NULL/, 'la secretaria no confirma el cumplimiento');
  assert.match(all, /`vigente_matricula_id` INT GENERATED ALWAYS AS \(CASE WHEN `estado` = 'vigente' THEN `matricula_id` ELSE NULL END\) STORED/);
  assert.match(all, /UNIQUE KEY `certificados_vigente_uq` \(`vigente_matricula_id`\)/, 'un solo certificado vigente por matrícula');
  assert.match(all, /FOREIGN KEY \(`sustituye_a_id`, `matricula_id`\) REFERENCES `certificados` \(`id`, `matricula_id`\)/, 'la sustitución es de la misma matrícula');
  for (const column of ['estudiante_doc_pais', 'estudiante_doc_tipo', 'estudiante_doc_numero']) assert.match(all, new RegExp('`' + column + '` [A-Z]+(\\([^)]*\\))? NOT NULL'), 'sin documento no hay certificado: ' + column);
  // Un CHECK que evalúa a NULL se da por cumplido: las reglas con columnas nulas exigen IS NOT NULL antes de comparar.
  assert.match(all, /CONSTRAINT `estudiantes_documento_completo_chk` CHECK \(\(`doc_pais` IS NULL AND `doc_tipo` IS NULL AND `doc_numero` IS NULL\) OR \(`doc_pais` IS NOT NULL AND `doc_tipo` IS NOT NULL AND `doc_numero` IS NOT NULL\)\)/);
  assert.match(all, /`confirmado_rol` IS NOT NULL AND `confirmado_rol` IN/);
  const historial = sql[4];
  assert.ok(!/FOREIGN KEY|REFERENCES/i.test(historial), 'el historial es independiente');
  assert.ok(!/`(nombres|apellidos|email|correo|telefono|doc_\w+|password|token|ip)`/i.test(historial), 'el historial no guarda datos personales');
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8'), check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  for (const [model, table] of [['Estudiante', 'estudiantes'], ['Convocatoria', 'convocatorias'], ['Matricula', 'matriculas'], ['Certificado', 'certificados'], ['AcademicoHistorial', 'academico_historial']]) {
    assert.match(schema, new RegExp('model ' + model + ' \\{[\\s\\S]*?@@map\\("' + table + '"\\)'), model);
    assert.ok(check.includes(table + ': ['), 'db:check debe comprobar las columnas de ' + table);
  }
  const certificado = schema.match(/model Certificado \{([\s\S]*?)\n\}/)![1];
  assert.ok(!/^\s+vigente_matricula_id\b/m.test(certificado), 'Prisma no declara (ni escribe) la columna generada');
  assert.ok(!/onDelete: (Cascade|SetNull)|onUpdate: (Cascade|SetNull)/.test(schema.slice(schema.indexOf('model Estudiante'))), 'relaciones académicas restrictivas también en Prisma');
  for (const name of [...all.matchAll(/(?:KEY|CONSTRAINT) `(\w+)`/g)].map(match => match[1])) assert.ok(check.includes("'" + name + "'"), 'db:check debe verificar ' + name);
});

test('migraciones: la 20261016-academico-solo-dni (E4.3b) solo restringe el documento a DNI peruano, sin tocar datos ni otras reglas', () => {
  const sql = statements(read('20261016-academico-solo-dni'));
  assert.equal(versions.indexOf('20261016-academico-solo-dni'), versions.indexOf('20261015-academico-estructura') + 1, 'va justo después de E4.2');
  assert.equal(sql.length, 2, 'un ALTER TABLE por tabla con documento');
  const clauses = (statement: string) => statement.split(/,\r?\n\s+/).map(c => c.trim());
  const [est, cert] = sql.map(clauses);
  assert.match(est[0], /^ALTER TABLE `estudiantes`\s+DROP CHECK `estudiantes_documento_formato_chk`$/);
  assert.match(est[1], /^ADD CONSTRAINT `estudiantes_documento_formato_chk` CHECK \(`doc_tipo` IS NULL OR \(`doc_pais` IS NOT NULL AND `doc_numero` IS NOT NULL AND `doc_tipo` = 'DNI' AND REGEXP_LIKE\(`doc_pais`, '\^PE\$', 'c'\) AND REGEXP_LIKE\(`doc_numero`, '\^\[0-9\]\{8\}\$', 'c'\) AND CHAR_LENGTH\(`doc_numero`\) = 8\)\)$/);
  assert.equal(est[2], "MODIFY `doc_tipo` ENUM('DNI') NULL", 'documento opcional: el tipo admite NULL');
  assert.match(cert[0], /^ALTER TABLE `certificados`\s+DROP CHECK `certificados_documento_chk`$/);
  assert.match(cert[1], /^ADD CONSTRAINT `certificados_documento_chk` CHECK \(`estudiante_doc_tipo` = 'DNI' AND REGEXP_LIKE\(`estudiante_doc_pais`, '\^PE\$', 'c'\) AND REGEXP_LIKE\(`estudiante_doc_numero`, '\^\[0-9\]\{8\}\$', 'c'\) AND CHAR_LENGTH\(`estudiante_doc_numero`\) = 8\)$/);
  assert.equal(cert[2], "MODIFY `estudiante_doc_tipo` ENUM('DNI') NOT NULL", 'certificado: DNI obligatorio');
  assert.deepEqual([est.length, cert.length], [3, 3], 'ninguna otra cláusula');
  const all = sql.join('\n');
  assert.ok(!/CE|PASAPORTE|completo_chk|COLUMN|INDEX|KEY|FOREIGN|RENAME|UPDATE|DELETE|TRUNCATE|\\/.test(all), 'no toca columnas, índices, relaciones, la regla de todo o nada ni datos');
  assert.ok(!/reniec|verificad/i.test(all), 'sin campos ni reglas que afirmen una verificación externa');
});

test('migraciones: la 20261016-academico-solo-dni se detiene antes de cualquier sentencia si hay documentos que no son DNI válidos', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { preconditions, MigracionDetenida } = require('../scripts/migrate.cjs') as { preconditions: Record<string, (db: unknown) => Promise<void>>; MigracionDetenida: new (m: string) => Error };
  const precondition = preconditions['20261016-academico-solo-dni'];
  assert.equal(typeof precondition, 'function');
  const queries: string[] = [];
  const fakeDb = (rows: unknown[]) => ({ query: async (sql: string) => { queries.push(sql); return [rows]; } });
  await precondition(fakeDb([])); // sin filas incompatibles: continúa
  const query = queries[0];
  for (const fragment of ['FROM estudiantes', 'FROM certificados', "'^PE$'", "'^[0-9]{8}$'", 'CHAR_LENGTH(doc_numero) = 8', 'CHAR_LENGTH(estudiante_doc_numero) = 8', 'COALESCE(']) assert.ok(query.includes(fragment), fragment);
  assert.ok(/^SELECT /.test(query) && !/\b(UPDATE|DELETE|ALTER|INSERT|DROP)\b/i.test(query), 'solo lee');
  let error: Error | null = null;
  try {
    await precondition(fakeDb([{ tabla: 'estudiantes', tipo: 'CE', n: 2 }, { tabla: 'certificados', tipo: 'PASAPORTE', n: 1 }, { tabla: 'estudiantes', tipo: 'DNI', n: 1 }, { tabla: 'certificados', tipo: '', n: 3 }]));
  } catch (e) { error = e as Error; }
  assert.ok(error instanceof MigracionDetenida);
  assert.match(error!.message, /detenida antes de modificar datos o estructura/);
  assert.match(error!.message, /estudiantes: CE 2; certificados: PASAPORTE 1; estudiantes: DNI con formato no admitido 1; certificados: tipo vacío 3/);
  assert.match(error!.message, /No se convierten, borran ni anonimizan/);
});

test('migraciones: DocumentoTipo de Prisma y db:check reflejan el esquema efectivo de solo DNI', () => {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  assert.match(schema, /enum DocumentoTipo \{\r?\n  DNI\r?\n\}/, 'DocumentoTipo: solo DNI');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { academicDefinitions, ACADEMIC_MIGRATIONS } = require('../scripts/check-database.cjs') as { academicDefinitions: () => { checks: Record<string, string> }; ACADEMIC_MIGRATIONS: string[] };
  assert.deepEqual(ACADEMIC_MIGRATIONS, versions.slice(versions.indexOf('20261015-academico-estructura')), 'db:check recorre todas las migraciones académicas, en orden');
  const { checks } = academicDefinitions();
  assert.match(checks.estudiantes_documento_formato_chk, /CHAR_LENGTH\(`doc_numero`\) = 8/, 'regla efectiva de la migración posterior');
  assert.ok(!/CE|PASAPORTE/.test(checks.estudiantes_documento_formato_chk + checks.certificados_documento_chk));
  assert.match(checks.estudiantes_documento_completo_chk, /`doc_pais` IS NULL AND `doc_tipo` IS NULL AND `doc_numero` IS NULL/, 'la regla de todo o nada de E4.2 se conserva');
  const check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  assert.ok(check.includes(`DOC = "ENUM('DNI')"`));
});

test('migraciones: la 20261020-docentes crea dos tablas restrictivas y solo amplía el ENUM del historial, sin cuentas ni datos, reflejada en schema.prisma y db:check', () => {
  const sql = statements(read('20261020-docentes'));
  assert.deepEqual(sql.map(s => (s.match(/^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) `(\w+)`/) ?? [])[1]), ['docentes', 'docente_asignaciones', 'academico_historial'], 'cada sentencia es idempotente y atómica');
  assert.ok(versions.indexOf('20261020-docentes') > versions.indexOf('20261019-importaciones-academicas'), 'va después de la estructura académica y de Ediciones (capacidad)');
  const [teachers, assignments, history] = sql;
  const all = sql.join('\n');
  assert.ok(!/ON (DELETE|UPDATE) (CASCADE|SET NULL|SET DEFAULT)/i.test(all), 'ninguna relación borra ni modifica en cascada');
  assert.equal((all.match(/FOREIGN KEY/g) ?? []).length, 3); assert.equal((all.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length, 3);
  assert.ok(!/admin_users|`(password|rol|token|cuenta_id|admin_user_id)`/i.test(teachers), 'un docente no es una cuenta: sin contraseña, rol ni vínculo con admin_users');
  assert.match(teachers, /`doc_tipo` ENUM\('DNI'\) NULL/, 'documento opcional y solo DNI');
  assert.match(teachers, /UNIQUE KEY `docentes_documento_uq` \(`doc_pais`, `doc_tipo`, `doc_numero`\)/);
  assert.match(teachers, /UNIQUE KEY `docentes_email_uq` \(`email`\)/);
  assert.ok(!/telefono`\)/.test(teachers.replace(/CONSTRAINT[^\n]*\n/g, '')), 'el teléfono se puede compartir: sin índice ni UNIQUE');
  assert.match(assignments, /UNIQUE KEY `docente_asignaciones_docente_edicion_uq` \(`docente_id`, `convocatoria_id`\)/, 'sin asignaciones duplicadas');
  assert.match(assignments, /`principal_activo_convocatoria_id` INT GENERATED ALWAYS AS \(CASE WHEN `rol` = 'principal' AND `estado` = 'activa' THEN `convocatoria_id` ELSE NULL END\) STORED/);
  assert.match(assignments, /UNIQUE KEY `docente_asignaciones_principal_uq` \(`principal_activo_convocatoria_id`\)/, 'un solo principal activo por edición');
  assert.match(assignments, /FOREIGN KEY \(`sustituye_a_id`, `convocatoria_id`\) REFERENCES `docente_asignaciones` \(`id`, `convocatoria_id`\)/, 'la sustitución es de la misma edición');
  assert.match(history, /^ALTER TABLE `academico_historial` MODIFY `entidad` ENUM\('estudiante','convocatoria','matricula','certificado','docente','asignacion_docente'\) NOT NULL$/, 'solo se AÑADEN valores al final del ENUM');
  assert.ok(!/DROP|DELETE|TRUNCATE|RENAME|UPDATE |INSERT /i.test(all.replace(/ON (UPDATE|DELETE) (RESTRICT|CURRENT_TIMESTAMP\(3\))/g, '')), 'sin sentencias destructivas ni de datos');
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8'), check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  for (const [model, table] of [['Docente', 'docentes'], ['DocenteAsignacion', 'docente_asignaciones']]) {
    assert.match(schema, new RegExp('model ' + model + ' \\{[\\s\\S]*?@@map\\("' + table + '"\\)'), model);
    assert.ok(check.includes(table + ': ['), 'db:check debe comprobar las columnas de ' + table);
  }
  assert.match(schema, /enum AcademicoEntidad \{[^}]*docente[^}]*asignacion_docente[^}]*\}/);
  assert.ok(!/^\s+principal_activo_convocatoria_id\b/m.test(schema.match(/model DocenteAsignacion \{([\s\S]*?)\n\}/)![1]), 'Prisma no declara (ni escribe) la columna generada');
  assert.ok(!/onDelete: (Cascade|SetNull)|onUpdate: (Cascade|SetNull)/.test(schema.slice(schema.indexOf('model Docente '))), 'relaciones restrictivas también en Prisma');
  for (const name of [...all.matchAll(/(?:KEY|CONSTRAINT) `(\w+)`/g)].map(match => match[1])) assert.ok(check.includes("'" + name + "'"), 'db:check debe verificar ' + name);
  assert.ok(check.includes("'20261020-docentes'"), 'db:check recorre la migración');
});

test('migraciones: la 20261020-sesiones-academicas crea una tabla restrictiva y solo amplía dos ENUM del historial, sin datos, reflejada en schema.prisma y db:check', () => {
  const sql = statements(read('20261020-sesiones-academicas'));
  assert.deepEqual(sql.map(s => (s.match(/^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) `(\w+)`/) ?? [])[1]), ['sesiones', 'academico_historial', 'academico_historial'], 'cada sentencia es idempotente y atómica');
  // Contrato actualizado: dejó de ser la última migración (20261020-preinscripciones va después). Sigue justo detrás de docentes, de la que depende.
  assert.equal(versions.indexOf('20261020-sesiones-academicas'), versions.indexOf('20261020-docentes') + 1, 'va justo después de docentes (referencia docente_asignaciones)');
  const [table, entidad, operacion] = sql;
  assert.ok(!/ON (DELETE|UPDATE) (CASCADE|SET NULL|SET DEFAULT)/i.test(table), 'ninguna relación borra ni modifica en cascada');
  assert.equal((table.match(/FOREIGN KEY/g) ?? []).length, 2); assert.equal((table.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length, 2);
  assert.match(table, /FOREIGN KEY \(`asignacion_id`, `convocatoria_id`\) REFERENCES `docente_asignaciones` \(`id`, `convocatoria_id`\)/, 'el docente de la sesión pertenece al equipo de ESA edición');
  assert.match(table, /`fecha` DATE NOT NULL/); assert.match(table, /`hora_inicio` TIME NOT NULL/); assert.match(table, /`hora_fin` TIME NOT NULL/);
  assert.ok(!/TIMESTAMP|DATETIME\(3\) NOT NULL,\s*\n\s*`hora/i.test(table.replace(/`(createdAt|updatedAt|cancelada_at)`[^\n]*/g, '')), 'la hora local de Lima no se guarda en tipos que dependan de la zona');
  assert.match(table, /CONSTRAINT `sesiones_horas_chk` CHECK \(`hora_inicio` >= '00:00:00' AND `hora_inicio` < `hora_fin` AND `hora_fin` <= '23:59:00'/, 'intervalo [inicio, fin) dentro del día');
  assert.match(table, /`estado` ENUM\('programada','realizada','cancelada'\) NOT NULL DEFAULT 'programada'/);
  assert.ok(!/UNIQUE KEY `[^`]*` \(`(fecha|hora_inicio|asignacion_id)`/.test(table), 'ningún UNIQUE sobre fecha, hora o docente: MySQL no expresa solapamientos; lo impide el servicio con bloqueos');
  assert.ok(!/`(password|rol|email|telefono|doc_numero|docente_id|estudiante_id)`/.test(table), 'sin datos personales ni vínculo con estudiantes');
  assert.equal(entidad, "ALTER TABLE `academico_historial` MODIFY `entidad` ENUM('estudiante','convocatoria','matricula','certificado','docente','asignacion_docente','sesion') NOT NULL", 'solo se AÑADE un valor al final del ENUM');
  assert.equal(operacion, "ALTER TABLE `academico_historial` MODIFY `operacion` ENUM('creacion','edicion','archivado','restauracion','cambio_estado','anulacion','confirmacion','emision','sustitucion','reprogramacion') NOT NULL");
  assert.ok(!/DROP|DELETE|TRUNCATE|RENAME|UPDATE |INSERT /i.test(sql.join('\n').replace(/ON (UPDATE|DELETE) (RESTRICT|CURRENT_TIMESTAMP\(3\))/g, '')), 'sin sentencias destructivas ni de datos');
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8'), check = readFileSync(join(__dirname, '..', 'scripts', 'check-database.cjs'), 'utf8');
  assert.match(schema, /model Sesion \{[\s\S]*?@@map\("sesiones"\)/); assert.ok(check.includes('sesiones: ['), 'db:check debe comprobar las columnas de sesiones');
  assert.match(schema, /enum AcademicoEntidad \{[^}]*asignacion_docente[^}]*sesion[^}]*\}/); assert.match(schema, /enum AcademicoOperacion \{[^}]*sustitucion[^}]*reprogramacion[^}]*\}/);
  assert.match(schema, /hora_inicio DateTime @db\.Time\(0\)/); assert.match(schema, /fecha DateTime @db\.Date/);
  const model = schema.match(/model Sesion \{([\s\S]*?)\n\}/)![1];
  assert.ok(!/onDelete: (Cascade|SetNull)|onUpdate: (Cascade|SetNull)/.test(model), 'relaciones restrictivas también en Prisma');
  for (const name of [...table.matchAll(/(?:KEY|CONSTRAINT) `(\w+)`/g)].map(match => match[1])) assert.ok(check.includes("'" + name + "'"), 'db:check debe verificar ' + name);
  assert.ok(check.includes("'20261020-sesiones-academicas'"), 'db:check recorre la migración');
  assert.ok(check.includes("'asignacion_docente','sesion')") && check.includes("'sustitucion','reprogramacion')"), 'db:check espera los ENUM ampliados del historial');
});
