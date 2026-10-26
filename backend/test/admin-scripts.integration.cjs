// Regresión M-3 (H-BACK-01, E3.2): admin:create y admin:assign-role contra un MySQL REAL y DESECHABLE. No forma parte de `npm test`.
// Ejecución explícita (CI, trabajo «Integración (MySQL efímero)»):
//   ADMIN_SCRIPTS_TEST_DB=true ADMIN_SCRIPTS_TEST_SERVER_UUID=<@@server_uuid obtenido por docker exec> node --test test/admin-scripts.integration.cjs
// Los dos scripts reciben --servidor con ese mismo valor: escriben solo si coincide con el @@server_uuid de su propia conexión.
//
// Barreras (todas deben cumplirse antes de crear nada):
//  1. ADMIN_SCRIPTS_TEST_DB=true explícito.
//  2. DB_HOST de bucle local (o ALLOW_INTEGRATION_DB=true, como test:integration, para un contenedor en una red interna).
//  3. Identidad del servidor: @@server_uuid de la conexión debe ser ADMIN_SCRIPTS_TEST_SERVER_UUID, obtenido por otra vía (docker exec en el
//     contenedor que creó el propio trabajo). Un nombre de base «temporal» no basta: esto prueba que es ESE servidor.
//  4. Servidor recién creado (Uptime < 1 h) y sin datos: ninguna base ajena a las del sistema contiene tablas.
// Solo crea y elimina una base horus_scripts_test_<hex>. Los scripts se ejecutan como procesos reales, cada uno con su propia conexión,
// desde un directorio vacío (sin .env), con la precarga isolate-env y un entorno mínimo explícito con credenciales ficticias de CI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, realpathSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const { check } = require('../scripts/check-database.cjs');

const backend = join(__dirname, '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];
const NAME = /^horus_scripts_test_[0-9a-f]{24}$/;
const PASSWORD = 'Temporal-ficticia-E32-' + randomBytes(4).toString('hex');
const OPERATOR = ['--operador=ci-e32', '--motivo=Regresión M-3 en base desechable'];
const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('admin:create y admin:assign-role auditan y protegen las cuentas en un MySQL desechable (H-BACK-01 E3.2, M-3)', async t => {
  if (process.env.ADMIN_SCRIPTS_TEST_DB !== 'true') return t.skip('Requiere ADMIN_SCRIPTS_TEST_DB=true y un MySQL desechable identificado.');
  const host = process.env.DB_HOST || 'localhost', port = Number(process.env.DB_PORT || 3306);
  const expectedUuid = String(process.env.ADMIN_SCRIPTS_TEST_SERVER_UUID ?? '').trim().toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host) || process.env.ALLOW_INTEGRATION_DB === 'true', 'solo servidores locales o un destino de pruebas autorizado');
  assert.match(expectedUuid, UUID, 'ADMIN_SCRIPTS_TEST_SERVER_UUID debe ser el server_uuid del servidor desechable');
  const credentials = { host, port, user: process.env.DB_USER, password: process.env.DB_PASS };
  const admin = await mysql.createConnection(credentials);
  const q = async (sql, params) => (await admin.query(sql, params))[0];

  // --- Barreras de identidad del entorno, antes de crear nada (si una falla, se cierra la conexión y el proceso termina) ---
  try {
    const [{ uuid, uptime }] = await q("SELECT @@server_uuid AS uuid, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime') AS uptime");
    assert.equal(String(uuid).toLowerCase(), expectedUuid, 'el servidor conectado no es el servidor desechable identificado');
    assert.ok(Number(uptime) < 3600, 'el servidor debe ser recién creado (Uptime < 1 h); hay ' + uptime + ' s');
    const populated = await q('SELECT TABLE_SCHEMA AS s, COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN (?) GROUP BY TABLE_SCHEMA', [SYSTEM]);
    assert.deepEqual(populated.map(row => row.s), [], 'el servidor no debe contener datos de ninguna base');
  } catch (error) {
    await admin.end();
    throw error;
  }
  const name = 'horus_scripts_test_' + randomBytes(12).toString('hex');
  assert.match(name, NAME);
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'horus-e32-'));
  let created = false, holder = null;

  const dest = host + ':' + port + '/' + name;
  const env = extra => ({
    PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    DB_HOST: host, DB_PORT: String(port), DB_NAME: name, DB_USER: credentials.user, DB_PASS: credentials.password, DB_SSL: 'false', ...extra,
  });
  const outputs = [];
  // Proceso real del script; se puede lanzar en paralelo. Se termina a los 60 s como máximo.
  function runScript(file, args, { input, extraEnv = {} } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-r', join(__dirname, 'isolate-env.cjs'), join(backend, 'scripts', file), ...args], { cwd, env: env(extraEnv), stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); outputs.push(output); resolve({ code, output }); });
      child.stdin.end(input ?? '');
    });
  }
  const createAdmin = (nombre, email, args = ['--destino=' + dest, '--servidor=' + expectedUuid, ...OPERATOR]) =>
    runScript('create-admin.cjs', args, { input: nombre + '\n' + email + '\n', extraEnv: { ADMIN_INITIAL_PASSWORD: PASSWORD } });
  const assignRole = (email, rol, extra = [], confirm = ['--destino=' + dest, '--servidor=' + expectedUuid, ...OPERATOR]) =>
    runScript('assign-role.cjs', ['--email=' + email, '--rol=' + rol, '--apply', '--confirmar=' + email, ...confirm, ...extra]);
  // Nunca se lee el hash: un fallo de aserción lo imprimiría en el registro. Basta su resumen para detectar cambios.
  const accounts = () => q('SELECT id, email, activo, rol, session_version, updatedAt, SHA2(password, 256) AS password_sha FROM admin_users ORDER BY id');
  const account = async email => (await q('SELECT id, activo, rol, session_version FROM admin_users WHERE email = ?', [email]))[0];
  const audits = () => q('SELECT * FROM admin_auditoria ORDER BY id');
  const snapshot = async () => JSON.stringify([await accounts(), await audits()]);
  const managers = async () => Number((await q("SELECT COUNT(*) AS n FROM admin_users WHERE activo = 1 AND rol = 'GERENTE_GENERAL'"))[0].n);
  const lockFree = async () => Number((await q("SELECT IS_FREE_LOCK('horus_admin_roles') AS free"))[0].free) === 1;
  const openTransactions = async () => Number((await q('SELECT COUNT(*) AS n FROM information_schema.innodb_trx'))[0].n);
  // El plazo cubre el arranque de los procesos (en un host con poca memoria supera los 10 s) y queda por debajo de su corte de 60 s.
  // Se consulta cada 200 ms: InnoDB solo refresca la caché de information_schema.innodb_trx si nadie la leyó en los últimos 100 ms,
  // de modo que un sondeo más frecuente la deja congelada y nunca muestra la espera.
  async function waitFor(probe, label, timeout = 45_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await probe()) return; await sleep(200); }
    assert.fail('no se observó: ' + label);
  }
  async function withAuditFailure(fn) {
    await q("CREATE TRIGGER e32_falla_auditoria BEFORE INSERT ON admin_auditoria FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fallo de auditoria forzado por la prueba'");
    try { return await fn(); } finally { await q('DROP TRIGGER IF EXISTS e32_falla_auditoria'); }
  }
  async function withoutAuditTable(fn) {
    await q('RENAME TABLE admin_auditoria TO admin_auditoria_e32_off');
    try { return await fn(); } finally { await q('RENAME TABLE admin_auditoria_e32_off TO admin_auditoria'); }
  }

  try {
    await q('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    created = true;
    await q('USE `' + name + '`');
    assert.equal((await runScript('init-database.cjs', [])).code, 0, 'init-database.cjs');

    await t.test('sin las migraciones 20261014: --listar sigue identificando el servidor y admin:create no escribe', async () => {
      // Recuperación con el esquema atrasado: la identidad (base y server_uuid) se obtiene en solo lectura antes de reparar el esquema.
      const before = await q('SELECT COUNT(*) AS n FROM admin_users');
      const listed = await runScript('assign-role.cjs', ['--listar']);
      assert.equal(listed.code, 1);
      assert.ok(listed.output.includes('Servidor conectado: base=' + name + ' | server_uuid=' + expectedUuid), 'identifica el servidor antes de comprobar el esquema');
      assert.match(listed.output, /20261014-admin-rol/);
      const created = await createAdmin('Cuenta Previa', 'previa@ejemplo.test');
      assert.equal(created.code, 1);
      assert.match(created.output, /20261014-admin-rol.*No se creó la cuenta/);
      assert.deepEqual(await q('SELECT COUNT(*) AS n FROM admin_users'), before);
    });

    assert.equal((await runScript('migrate.cjs', [])).code, 0, 'migrate.cjs');
    assert.deepEqual(await check(admin), [], 'db:check reconoce el esquema, incluida admin_auditoria');

    await t.test('admin:create rechaza destino, servidor, operador y motivo incorrectos sin escribir nada', async () => {
      const before = await snapshot();
      const S = '--servidor=' + expectedUuid;
      for (const [args, code, message] of [
        [['--destino=' + host + ':' + (port + 1) + '/' + name, S, ...OPERATOR], 2, /Destino configurado/],
        [['--destino=' + host + ':' + port + '/horus_ci', S, ...OPERATOR], 2, /Destino configurado/],
        [['--destino=' + dest, ...OPERATOR], 2, /--servidor=<server_uuid>/], // sin --servidor
        [['--destino=' + dest, '--servidor=' + expectedUuid.slice(0, -1), ...OPERATOR], 2, /server_uuid completo/], // mal formado
        [['--destino=' + dest, '--servidor=' + randomUUID(), ...OPERATOR], 1, /no coincide con --servidor/], // otro servidor
        [['--destino=' + dest, S, '--motivo=Regresión M-3 en base desechable'], 2, /--operador/],
        [['--destino=' + dest, S, '--operador=ci-e32', '--motivo=avisar a persona@ejemplo.test'], 2, /--motivo/],
      ]) {
        const result = await createAdmin('Cuenta Uno', 'uno@ejemplo.test', args);
        assert.equal(result.code, code, args.join(' '));
        assert.match(result.output, message, args.join(' '));
      }
      // Configuración de destino incorrecta: DB_NAME apunta a otra base. --destino lo detecta antes de conectar.
      const otherBase = await runScript('create-admin.cjs', ['--destino=' + dest, S, ...OPERATOR],
        { input: 'Cuenta Uno\nuno@ejemplo.test\n', extraEnv: { ADMIN_INITIAL_PASSWORD: PASSWORD, DB_NAME: 'horus_ci' } });
      assert.equal(otherBase.code, 2);
      assert.match(otherBase.output, new RegExp('Destino configurado: ' + host + ':' + port + '/horus_ci'));
      assert.equal(await snapshot(), before);
    });

    await t.test('admin:create crea cuentas activas SIN ROL (aunque no haya gerente) y audita cada alta en la misma transacción', async () => {
      for (const [nombre, email] of [['Cuenta Uno', 'uno@ejemplo.test'], ['Cuenta Dos', 'dos@ejemplo.test'], ['Cuenta Tres', 'tres@ejemplo.test']]) {
        const result = await createAdmin(nombre, email);
        assert.equal(result.code, 0, result.output);
        assert.match(result.output, /activo y SIN ROL/);
      }
      const rows = await accounts();
      assert.deepEqual(rows.map(row => [row.email, Number(row.activo), row.rol, row.session_version]),
        [['uno@ejemplo.test', 1, null, 1], ['dos@ejemplo.test', 1, null, 1], ['tres@ejemplo.test', 1, null, 1]]);
      const hashes = await q("SELECT password REGEXP '^[$]2[aby][$]12[$]' AS bcrypt12, password = ? AS plain FROM admin_users ORDER BY id", [PASSWORD]);
      assert.deepEqual(hashes.map(row => [Number(row.bcrypt12), Number(row.plain)]), rows.map(() => [1, 0]), 'bcrypt de coste 12, nunca la contraseña en claro');
      const registered = await audits();
      assert.deepEqual(registered.map(row => [row.origen, row.actor_id, row.operador, row.cuenta_id, row.operacion, row.rol_anterior, row.rol_nuevo, row.activo_anterior, Number(row.activo_nuevo), row.resultado, row.motivo]),
        rows.map(row => ['terminal', null, 'ci-e32', row.id, 'cuenta_creada', null, null, null, 1, 'aplicado', 'Regresión M-3 en base desechable']));
      const [{ recent }] = await q('SELECT COUNT(*) AS recent FROM admin_auditoria WHERE createdAt >= NOW(3) - INTERVAL 5 MINUTE');
      assert.equal(Number(recent), 3, 'la fecha la pone el servidor');
    });

    await t.test('admin:create: duplicado previo o simultáneo, fallo de auditoría y migración ausente no dejan cambios parciales', async () => {
      let before = await snapshot();
      assert.equal((await createAdmin('Otra', 'uno@ejemplo.test')).code, 1);
      assert.equal(await snapshot(), before);
      const race = await Promise.all([createAdmin('Cuatro A', 'cuatro@ejemplo.test'), createAdmin('Cuatro B', 'cuatro@ejemplo.test')]);
      assert.deepEqual(race.map(result => result.code).sort(), [0, 1], 'una sola alta gana');
      const cuatro = await account('cuatro@ejemplo.test');
      assert.equal((await q('SELECT COUNT(*) AS n FROM admin_auditoria WHERE cuenta_id = ?', [cuatro.id]))[0].n, 1);
      before = await snapshot();
      const failed = await withAuditFailure(() => createAdmin('Cuenta Cinco', 'cinco@ejemplo.test'));
      assert.equal(failed.code, 1);
      assert.equal(await snapshot(), before, 'sin auditoría no hay cuenta');
      const missing = await withoutAuditTable(() => createAdmin('Cuenta Seis', 'seis@ejemplo.test'));
      assert.equal(missing.code, 1);
      assert.match(missing.output, /20261014-admin-auditoria/);
      assert.equal(await snapshot(), before);
      assert.equal(await openTransactions(), 0);
    });

    await t.test('admin:assign-role: listado y simulación no escriben; confirmaciones incorrectas se rechazan', async () => {
      const before = await snapshot();
      const listed = await runScript('assign-role.cjs', ['--listar']);
      assert.equal(listed.code, 0);
      assert.ok(listed.output.includes('--destino=' + dest + ' --servidor=' + expectedUuid), 'muestra la identidad real del servidor');
      assert.ok(listed.output.includes('un***@ejemplo.test') && !listed.output.includes('uno@ejemplo.test'));
      const simulated = await runScript('assign-role.cjs', ['--email=uno@ejemplo.test', '--rol=' + G]);
      assert.equal(simulated.code, 0);
      assert.match(simulated.output, /SIMULACIÓN: no se escribió nada/);
      const wrong = [
        [assignRole('uno@ejemplo.test', G, [], ['--confirmar=dos@ejemplo.test', '--destino=' + dest, '--servidor=' + expectedUuid, ...OPERATOR]), 2],
        [assignRole('uno@ejemplo.test', G, [], ['--destino=' + host + ':' + port + '/horus_ci', '--servidor=' + expectedUuid, ...OPERATOR]), 2],
        [assignRole('uno@ejemplo.test', G, [], ['--destino=' + dest, '--servidor=' + randomUUID(), ...OPERATOR]), 1],
        [assignRole('uno@ejemplo.test', G, [], ['--destino=' + dest, '--servidor=' + expectedUuid, '--operador=ci-e32']), 2],
        [assignRole('uno@ejemplo.test', G, [], ['--destino=' + dest, '--servidor=' + expectedUuid, OPERATOR[1]]), 2], // sin --operador
        [assignRole('uno@ejemplo.test', G, [], ['--destino=' + dest, ...OPERATOR]), 2], // sin --servidor
        [runScript('assign-role.cjs', ['--email=uno@ejemplo.test', '--rol=' + G, '--apply', '--destino=' + dest, '--servidor=' + expectedUuid, ...OPERATOR]), 2], // sin --confirmar
        [assignRole('uno@ejemplo.test', S), 1], // el primer rol debe ser GERENTE_GENERAL
      ];
      for (const [pending, code] of wrong) assert.equal((await pending).code, code);
      assert.equal(await snapshot(), before);
    });

    await t.test('admin:assign-role: asignación, cambio, segundo gerente y retirada; nunca se degrada al último gerente', async () => {
      const auditCount = async () => (await audits()).length;
      let count = await auditCount();
      const r1 = await assignRole('uno@ejemplo.test', G);
      assert.equal(r1.code, 0, r1.output);
      const uno = await account('uno@ejemplo.test');
      assert.deepEqual([uno.rol, uno.session_version], [G, 2]);
      const [last] = (await audits()).slice(-1);
      assert.deepEqual([last.origen, last.actor_id, last.operador, last.cuenta_id, last.operacion, last.rol_anterior, last.rol_nuevo, Number(last.activo_anterior), Number(last.activo_nuevo), last.resultado, last.motivo],
        ['terminal', null, 'ci-e32', uno.id, 'rol_asignado', null, G, 1, 1, 'aplicado', 'Regresión M-3 en base desechable']);
      assert.equal(await auditCount(), ++count);
      assert.equal((await account('dos@ejemplo.test')).session_version, 1, 'las demás cuentas no se tocan');

      assert.equal((await assignRole('dos@ejemplo.test', S)).code, 0);
      assert.equal((await assignRole('dos@ejemplo.test', C)).code, 0);
      assert.deepEqual(Object.values(await account('dos@ejemplo.test')).slice(2), [C, 3]);
      assert.deepEqual((await audits()).slice(-1).map(row => [row.rol_anterior, row.rol_nuevo]), [[S, C]]);
      count += 2;

      let before = await snapshot();
      assert.equal((await assignRole('dos@ejemplo.test', G)).code, 1, 'un segundo gerente exige --permitir-otro-gerente');
      assert.equal(await snapshot(), before);
      assert.equal((await assignRole('dos@ejemplo.test', G, ['--permitir-otro-gerente'])).code, 0);
      assert.equal((await assignRole('uno@ejemplo.test', S)).code, 0, 'con otro gerente activo se retira el rol de gerente a uno');
      count += 2;
      before = await snapshot();
      const lastManager = await assignRole('dos@ejemplo.test', S);
      assert.equal(lastManager.code, 1);
      assert.match(lastManager.output, /sin ningún GERENTE_GENERAL activo/);
      assert.equal(await snapshot(), before);
      assert.equal(await auditCount(), count, 'los rechazos no se registran todavía');
      assert.equal(Number((await q("SELECT COUNT(*) AS n FROM admin_users WHERE activo = 1 AND rol = 'GERENTE_GENERAL'"))[0].n), 1);
    });

    await t.test('admin:assign-role: si falla la auditoría se revierten rol y session_version; sin la tabla no se simula ni aplica', async () => {
      const before = await snapshot();
      const failed = await withAuditFailure(() => assignRole('tres@ejemplo.test', S));
      assert.equal(failed.code, 1);
      assert.equal(await snapshot(), before);
      assert.ok(await lockFree(), 'el bloqueo con nombre se liberó');
      for (const argv of [['--email=tres@ejemplo.test', '--rol=' + S]]) {
        const simulated = await withoutAuditTable(() => runScript('assign-role.cjs', argv));
        assert.equal(simulated.code, 1);
        assert.match(simulated.output, /20261014-admin-auditoria/);
      }
      const applied = await withoutAuditTable(() => assignRole('tres@ejemplo.test', S));
      assert.equal(applied.code, 1);
      assert.match(applied.output, /20261014-admin-auditoria/);
      // --listar sigue funcionando sin la tabla (solo lectura): muestra cuentas, la identidad del servidor y el aviso de la migración.
      const listed = await withoutAuditTable(() => runScript('assign-role.cjs', ['--listar']));
      assert.equal(listed.code, 0);
      assert.match(listed.output, /AVISO: La base no tiene la tabla admin_auditoria\. .*20261014-admin-auditoria/);
      assert.ok(listed.output.includes('--destino=' + dest + ' --servidor=' + expectedUuid));
      assert.equal(await snapshot(), before);
      assert.equal(await openTransactions(), 0);
    });

    await t.test('concurrencia real: el script espera las filas retenidas por otra conexión y revalida con ellas', async () => {
      holder = await mysql.createConnection({ ...credentials, database: name });
      await holder.beginTransaction();
      await holder.query('SELECT id FROM admin_users ORDER BY id FOR UPDATE');
      const pending = assignRole('tres@ejemplo.test', S);
      const tres = await account('tres@ejemplo.test');
      try {
        // Evidencia en el servidor: la transacción del script está en LOCK WAIT detrás de la conexión retenedora.
        await waitFor(async () => Number((await q("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT'"))[0].n) === 1, 'el script en LOCK WAIT');
        await holder.query('UPDATE admin_users SET activo = 0, session_version = session_version + 1 WHERE id = ?', [tres.id]);
        await holder.commit();
      } finally {
        // También si falla la observación: cerrar la conexión revierte su transacción y libera las filas, y se espera al proceso para
        // que no siga retenido en la subprueba siguiente.
        await holder.end(); holder = null;
        await pending;
      }
      const result = await pending;
      assert.equal(result.code, 1);
      assert.match(result.output, /desactivada/, 'decide con el estado confirmado por la otra transacción');
      assert.deepEqual(Object.values(await account('tres@ejemplo.test')).slice(1), [0, null, 2]);
      assert.ok(!(await audits()).some(row => row.cuenta_id === tres.id && row.operacion === 'rol_asignado'));
    });

    await t.test('concurrencia real: dos degradaciones simultáneas que juntas dejarían sin gerente; solo una se aplica', async () => {
      assert.equal((await assignRole('uno@ejemplo.test', G, ['--permitir-otro-gerente'])).code, 0);
      assert.equal(await managers(), 2);
      const auditsBefore = (await audits()).length;
      holder = await mysql.createConnection({ ...credentials, database: name });
      assert.equal(Number((await holder.query("SELECT GET_LOCK('horus_admin_roles', 5) AS acquired"))[0][0].acquired), 1);
      const pending = [assignRole('uno@ejemplo.test', S), assignRole('dos@ejemplo.test', C)];
      try {
        // Evidencia: los dos procesos esperan el bloqueo a la vez (estado «User lock») antes de liberarlo.
        await waitFor(async () => Number((await q("SELECT COUNT(*) AS n FROM information_schema.processlist WHERE DB = ? AND STATE = 'User lock'", [name]))[0].n) === 2, 'dos scripts esperando el bloqueo');
        await holder.query("SELECT RELEASE_LOCK('horus_admin_roles')");
      } finally {
        await holder.end(); holder = null; // cerrar la conexión también libera el bloqueo con nombre
        await Promise.all(pending);
      }
      const results = await Promise.all(pending);
      assert.deepEqual(results.map(result => result.code).sort(), [0, 1], 'exactamente una degradación gana');
      assert.match(results.find(result => result.code === 1).output, /sin ningún GERENTE_GENERAL activo/);
      assert.equal(await managers(), 1);
      assert.equal((await audits()).length, auditsBefore + 1);
    });

    await t.test('recuperación de acceso sin ningún gerente activo: admin:create y después GERENTE_GENERAL, sin --permitir-otro-gerente', async () => {
      // Pérdida de acceso simulada: el único gerente activo queda desactivado (intervención directa en la base, fuera de los scripts).
      await q('UPDATE admin_users SET activo = 0, session_version = session_version + 1 WHERE activo = 1 AND rol = ?', [G]);
      assert.equal(await managers(), 0);
      const listed = await runScript('assign-role.cjs', ['--listar']);
      assert.match(listed.output, /Gerentes generales activos: 0\./);
      const before = await snapshot();
      assert.equal((await assignRole('cuatro@ejemplo.test', S)).code, 1, 'sin gerente, el primer rol debe ser GERENTE_GENERAL');
      assert.equal(await snapshot(), before);
      // Paso 1-2 del procedimiento: identificar el servidor en solo lectura y usar esos valores para confirmar.
      const confirmation = listed.output.match(/--destino=(\S+) --servidor=(\S+)/);
      assert.deepEqual(confirmation.slice(1), [dest, expectedUuid]);
      assert.equal((await createAdmin('Otra Cuenta', 'otra@ejemplo.test', ['--destino=' + dest, '--servidor=' + randomUUID(), ...OPERATOR])).code, 1, 'otro servidor: no se crea');
      assert.equal(await snapshot(), before);
      const created = await createAdmin('Cuenta Recuperación', 'recuperacion@ejemplo.test', ['--destino=' + confirmation[1], '--servidor=' + confirmation[2], ...OPERATOR]);
      assert.equal(created.code, 0, created.output);
      assert.equal(await managers(), 0, 'admin:create no concede ningún rol');
      const restored = await assignRole('recuperacion@ejemplo.test', G);
      assert.equal(restored.code, 0, restored.output);
      const cuenta = await account('recuperacion@ejemplo.test');
      assert.deepEqual([Number(cuenta.activo), cuenta.rol, cuenta.session_version], [1, G, 2]);
      assert.equal(await managers(), 1);
      assert.deepEqual((await audits()).slice(-2).map(row => [row.cuenta_id, row.operacion, row.rol_anterior, row.rol_nuevo, row.operador]),
        [[cuenta.id, 'cuenta_creada', null, null, 'ci-e32'], [cuenta.id, 'rol_asignado', null, G, 'ci-e32']]);
    });

    await t.test('al terminar no quedan bloqueos, transacciones ni conexiones de los scripts, y ninguna salida muestra secretos', async () => {
      assert.ok(await lockFree());
      assert.equal(await openTransactions(), 0);
      await waitFor(async () => Number((await q('SELECT COUNT(*) AS n FROM information_schema.processlist WHERE DB = ? AND ID <> CONNECTION_ID()', [name]))[0].n) === 0, 'conexiones cerradas', 5_000);
      for (const output of outputs) {
        for (const secret of [PASSWORD, credentials.password]) assert.ok(!output.includes(secret), 'la salida no muestra contraseñas');
        assert.ok(!/\$2[aby]\$/.test(output), 'la salida no muestra hashes');
      }
      assert.deepEqual(await check(admin), [], 'el esquema sigue completo (tabla de auditoría restaurada)');
    });
  } finally {
    try { if (holder) await holder.end(); } catch { /* ya cerrada */ }
    try {
      if (created) {
        assert.match(name, NAME);
        await q('DROP DATABASE IF EXISTS `' + name + '`');
      }
    } finally {
      await admin.end();
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});
