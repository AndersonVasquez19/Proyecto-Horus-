'use strict';
// Pruebas de la Fase C.4 con una conexion SIMULADA y datos ficticios. No hay red, ni Aiven, ni MySQL, ni secretos.
// Ejecutar: node --test docs/procedimientos/aiven-grants-horus-app.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = require('./aiven-grants-horus-app-lib.cjs');

const HOST = '10.0.0.%'; // Host ficticio.
const DOC = path.join(__dirname, 'aiven-mysql-preparacion-segura.md');
const ADMIN_GRANTS = ['GRANT ALL PRIVILEGES ON *.* TO `avnadmin`@`%` WITH GRANT OPTION'];
const USAGE = ['GRANT USAGE ON *.* TO `horus_app`@`' + HOST + '`'];

function appGrantRows(matrix) {
  return USAGE.concat(matrix.map(e => 'GRANT ' + e.privilegios.join(', ') + ' ON `horus_db`.`' + e.tabla + '` TO `horus_app`@`' + HOST + '`'));
}

// Conexion falsa: responde por patron y registra cada sentencia recibida.
function fakeConn(over = {}) {
  const o = {
    user: 'avnadmin@%', tables: lib.EXPECTED_TABLES, schemas: [{ n: 'horus_db' }],
    appHosts: [{ host: HOST }], adminGrants: ADMIN_GRANTS, appGrants: USAGE,
    failOnGrant: 0, afterGrants: null, mysqlUserError: null, ...over
  };
  const log = { all: [], grants: [], applied: false };
  return {
    log,
    async query(sql) {
      log.all.push(sql);
      if (/^GRANT /.test(sql)) {
        log.grants.push(sql);
        if (o.failOnGrant && log.grants.length === o.failOnGrant) { const e = new Error('detalle sensible'); e.code = 'ER_TABLEACCESS_DENIED_ERROR'; throw e; }
        log.applied = true;
        return { affectedRows: 0 };
      }
      if (/CURRENT_USER\(\)/.test(sql)) return [{ identidad: o.user }];
      if (/information_schema\.schemata/.test(sql)) return o.schemas;
      if (/information_schema\.tables/.test(sql)) return o.tables.map(n => ({ n }));
      if (/`mysql`\.`user`/.test(sql)) { if (o.mysqlUserError) throw o.mysqlUserError; return o.appHosts; }
      if (/^SHOW GRANTS FOR/.test(sql)) {
        const rows = log.applied && o.afterGrants ? o.afterGrants : o.appGrants;
        return rows.map(g => ({ ['Grants for horus_app@' + HOST]: g }));
      }
      if (/^SHOW GRANTS$/.test(sql)) return o.adminGrants.map(g => ({ 'Grants for avnadmin@%': g }));
      throw new Error('consulta inesperada en la prueba');
    }
  };
}

const run = (conn, extra = {}) => {
  const lines = [];
  const promise = lib.run({ conn, modo: 'prechequeo', log: l => lines.push(l), ...extra });
  return promise.then(r => ({ r, lines }), e => { e.lines = lines; throw e; });
};

test('la matriz tiene exactamente 27 tablas unicas y excluye las 3 tablas prohibidas', () => {
  assert.equal(lib.GRANT_MATRIX.length, 27);
  assert.equal(new Set(lib.GRANT_MATRIX.map(g => g.tabla)).size, 27);
  for (const t of lib.EXCLUDED_TABLES) assert.ok(!lib.GRANT_MATRIX.some(g => g.tabla === t));
  assert.equal(lib.EXPECTED_TABLES.length, 30);
});

test('las 27 sentencias coinciden linea por linea con el documento aprobado', () => {
  const doc = fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
  const documented = doc.split('\n').filter(l => l.startsWith('GRANT ') && l.includes('`horus_db`.`'))
    .map(l => l.replace(/;$/, '').replace('<HOST_SQL_APP>', HOST));
  assert.equal(documented.length, 27);
  assert.deepEqual(lib.buildStatements(HOST), documented);
});

test('ninguna sentencia es global, DDL, GRANT OPTION ni toca tablas excluidas', () => {
  for (const [i, s] of lib.buildStatements(HOST).entries()) {
    assert.doesNotThrow(() => lib.assertSafeStatement(s, i, HOST));
    assert.ok(!/\*\.\*|CREATE|ALTER|DROP|INDEX|REFERENCES|GRANT OPTION|ALL|WITH|\bFILE\b|\bSUPER\b/.test(s.replace(/^GRANT/, '')), s);
    assert.ok(/ ON `horus_db`\.`[a-z_]+` TO 'horus_app'@/.test(s));
    for (const t of lib.EXCLUDED_TABLES) assert.ok(!s.includes('`' + t + '`'));
  }
});

test('assertSafeStatement rechaza sentencias fuera de la matriz', () => {
  const bad = [
    "GRANT ALL PRIVILEGES ON *.* TO 'horus_app'@'%'",
    "GRANT SELECT ON `horus_db`.`docentes` TO 'horus_app'@'%'",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`certificados` TO 'horus_app'@'%'",
    "GRANT SELECT ON `horus_db`.`admin_items` TO 'horus_app'@'%' WITH GRANT OPTION",
    "GRANT DROP ON `horus_db`.`admin_items` TO 'horus_app'@'%'"
  ];
  for (const s of bad) assert.throws(() => lib.assertSafeStatement(s, 0, '%'), { phase: 'validacion-sentencia' });
});

test('el host rechaza marcador sin sustituir, comillas e inyeccion', () => {
  for (const h of ['<HOST_SQL_APP>', "%'; DROP TABLE x;--", '', undefined, 'a b', "x'"]) {
    assert.throws(() => lib.validateHostSql(h), { phase: 'host-app' });
  }
  assert.equal(lib.validateHostSql('%'), '%');
  assert.equal(lib.validateHostSql('10.1.2.3'), '10.1.2.3');
});

test('prechequeo correcto: muestra los 27 GRANT y no ejecuta ninguno', async () => {
  const conn = fakeConn();
  const { r, lines } = await run(conn);
  assert.equal(r.prechequeoOk, true);
  assert.equal(conn.log.grants.length, 0);
  assert.equal(lines.filter(l => /^\s+\[\d\d\/27\] GRANT /.test(l)).length, 27);
  assert.ok(lines.some(l => l.includes('avnadmin@%')));
  assert.ok(lines.some(l => l.includes('host comprobado: ' + HOST)));
});

test('aplicar: ejecuta exactamente los 27 GRANT en orden y verifica SHOW GRANTS', async () => {
  const conn = fakeConn({ afterGrants: appGrantRows(lib.GRANT_MATRIX) });
  const { r } = await run(conn, { modo: 'aplicar', confirmado: true, hostApp: HOST });
  assert.equal(r.ejecutados, 27);
  assert.deepEqual(conn.log.grants, lib.buildStatements(HOST));
  // Solo GRANT escritura; nunca otras sentencias de modificacion.
  assert.ok(conn.log.all.every(s => /^(GRANT |SELECT |SHOW )/.test(s)));
});

test('aplicar exige confirmacion explicita y -HostApp', async () => {
  await assert.rejects(run(fakeConn(), { modo: 'aplicar', hostApp: HOST }), { phase: 'confirmacion' });
  await assert.rejects(run(fakeConn(), { modo: 'aplicar', confirmado: true }), { phase: 'host-app' });
  const conn = fakeConn();
  await assert.rejects(run(conn, { modo: 'aplicar', hostApp: HOST }));
  assert.equal(conn.log.all.length, 0);
});

test('se detiene sin ejecutar nada ante cada diferencia inesperada', async () => {
  const casos = [
    ['identidad no avnadmin', { user: 'horus_migrator@%' }, 'identidad-admin'],
    ['base inexistente', { schemas: [] }, 'destino'],
    ['falta una tabla', { tables: lib.EXPECTED_TABLES.slice(1) }, 'destino'],
    ['tabla extra', { tables: lib.EXPECTED_TABLES.concat('otra') }, 'destino'],
    ['horus_app inexistente', { appHosts: [] }, 'cuenta-app'],
    ['horus_app duplicada', { appHosts: [{ host: '%' }, { host: 'x' }] }, 'cuenta-app'],
    ['sin GRANT OPTION', { adminGrants: ['GRANT ALL PRIVILEGES ON *.* TO `avnadmin`@`%`'] }, 'autoridad-admin'],
    ['privilegios insuficientes', { adminGrants: ['GRANT SELECT ON *.* TO `avnadmin`@`%` WITH GRANT OPTION'] }, 'autoridad-admin'],
    ['horus_app ya tiene permisos', { appGrants: appGrantRows(lib.GRANT_MATRIX.slice(0, 1)) }, 'estado-app'],
    ['horus_app con GRANT OPTION', { appGrants: ['GRANT USAGE ON *.* TO `horus_app`@`' + HOST + '` WITH GRANT OPTION'] }, 'estado-app'],
    ['horus_app con permiso global', { appGrants: ['GRANT SELECT ON *.* TO `horus_app`@`' + HOST + '`'] }, 'estado-app']
  ];
  for (const [nombre, over, fase] of casos) {
    const conn = fakeConn(over);
    await assert.rejects(run(conn, { modo: 'aplicar', confirmado: true, hostApp: HOST }), { phase: fase }, nombre);
    assert.equal(conn.log.grants.length, 0, nombre);
  }
});

test('el host indicado debe coincidir con el real de horus_app', async () => {
  const conn = fakeConn();
  await assert.rejects(run(conn, { modo: 'aplicar', confirmado: true, hostApp: '%' }), { phase: 'cuenta-app' });
  assert.equal(conn.log.grants.length, 0);
});

test('sin lectura de mysql.user solo se acepta un host indicado que exista', async () => {
  const denied = Object.assign(new Error('x'), { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR' });
  await assert.rejects(run(fakeConn({ mysqlUserError: denied })), { phase: 'cuenta-app' });
  const { r } = await run(fakeConn({ mysqlUserError: denied }), { hostApp: HOST });
  assert.equal(r.prechequeoOk, true);
});

test('un fallo en un GRANT detiene todo, sin reintentos, y no filtra el mensaje del servidor', async () => {
  const conn = fakeConn({ failOnGrant: 5 });
  let error;
  try { await run(conn, { modo: 'aplicar', confirmado: true, hostApp: HOST }); } catch (e) { error = e; }
  assert.ok(error);
  assert.equal(error.phase, 'grant-5-de-27');
  assert.equal(error.code, 'ER_TABLEACCESS_DENIED_ERROR');
  assert.equal(conn.log.grants.length, 5); // 4 correctos + el fallido, ni uno mas ni reintento.
  assert.ok(!error.safeMessage.includes('detalle sensible'));
  assert.ok(!/GRANT SELECT/.test(error.safeMessage));
});

test('verificar detecta faltantes, diferencias y extras; y acepta el estado conforme', async () => {
  const completo = appGrantRows(lib.GRANT_MATRIX);
  const { r } = await run(fakeConn({ appGrants: completo }), { modo: 'verificar' });
  assert.equal(r.conforme, true);
  const falta = completo.slice(0, -1);
  await assert.rejects(run(fakeConn({ appGrants: falta }), { modo: 'verificar' }), { phase: 'verificacion' });
  const diferente = completo.map(g => g.replace('ON `horus_db`.`certificados`', 'ON `horus_db`.`certificados`').replace('GRANT SELECT ON `horus_db`.`certificados`', 'GRANT SELECT, INSERT ON `horus_db`.`certificados`'));
  await assert.rejects(run(fakeConn({ appGrants: diferente }), { modo: 'verificar' }), { phase: 'verificacion' });
  const extra = completo.concat('GRANT SELECT ON `horus_db`.`docentes` TO `horus_app`@`' + HOST + '`');
  await assert.rejects(run(fakeConn({ appGrants: extra }), { modo: 'verificar' }), { phase: 'verificacion' });
  const conOpcion = completo.map((g, i) => (i === 3 ? g + ' WITH GRANT OPTION' : g));
  await assert.rejects(run(fakeConn({ appGrants: conOpcion }), { modo: 'verificar' }), { phase: 'verificacion' });
});

test('el parser acepta el esquema con guion bajo escapado y no devuelve filas crudas', () => {
  const g = lib.parseGrantRow({ x: 'GRANT SELECT, INSERT ON `horus\\_db`.* TO `avnadmin`@`%` WITH GRANT OPTION' });
  assert.deepEqual(g, { tipo: 'grant', privilegios: ['SELECT', 'INSERT'], tipoObjeto: 'TABLE', esquema: 'horus_db', objeto: '*', grantOption: true });
  assert.throws(() => lib.parseGrantRow({ x: 'basura' }), { phase: 'analisis-grants' });
  const base = { tipo: 'grant', tipoObjeto: 'TABLE', objeto: '*', grantOption: true };
  assert.equal(lib.adminCanGrant([{ ...base, privilegios: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], esquema: 'horus_db' }]), true);
  assert.equal(lib.adminCanGrant([{ ...base, privilegios: ['ALL PRIVILEGES'], esquema: 'otra' }]), false);
});

const parse = text => lib.parseGrantRow({ 'Grants for x@%': text });
const DYN = 'SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, RELOAD, PROCESS, REFERENCES, INDEX, ALTER, SHOW DATABASES, ' +
  'CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, REPLICATION SLAVE, REPLICATION CLIENT, CREATE VIEW, SHOW VIEW, ' +
  'CREATE ROUTINE, ALTER ROUTINE, CREATE USER, EVENT, TRIGGER, CREATE ROLE, DROP ROLE';

test('analizador: revocaciones parciales de MySQL 8.4 (REVOKE ... FROM) se reconocen como tipo revoke', () => {
  const r = parse('REVOKE INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER, CREATE TEMPORARY TABLES, LOCK TABLES, ' +
    'EXECUTE, CREATE VIEW, SHOW VIEW, CREATE ROUTINE, ALTER ROUTINE, EVENT, TRIGGER ON `mysql`.* FROM `avnadmin`@`%`');
  assert.equal(r.tipo, 'revoke');
  assert.equal(r.esquema, 'mysql');
  assert.equal(r.objeto, '*');
  assert.ok(r.privilegios.includes('CREATE TEMPORARY TABLES'));
});

test('analizador: GRANT global con privilegios dinamicos y WITH GRANT OPTION', () => {
  const g = parse('GRANT ' + DYN + ', APPLICATION_PASSWORD_ADMIN, CONNECTION_ADMIN, ROLE_ADMIN ON *.* TO `avnadmin`@`%` WITH GRANT OPTION');
  assert.equal(g.tipo, 'grant');
  assert.equal(g.esquema, '*');
  assert.equal(g.grantOption, true);
  assert.ok(g.privilegios.includes('ROLE_ADMIN') && g.privilegios.includes('SHOW DATABASES'));
});

test('analizador: ANSI_QUOTES (comillas dobles), cuentas con comillas simples y nombres calificados', () => {
  const a = parse('GRANT SELECT, INSERT ON "horus_db"."admin_items" TO "horus_app"@"10.0.0.%"');
  assert.deepEqual([a.esquema, a.objeto, a.grantOption], ['horus_db', 'admin_items', false]);
  const b = parse('GRANT SELECT ON "horus\\_db".* TO \'avnadmin\'@\'%\' WITH GRANT OPTION');
  assert.deepEqual([b.esquema, b.objeto, b.grantOption], ['horus_db', '*', true]);
  const c = parse('GRANT SELECT ON `ho``rus`.`t""x` TO `u`@`h`');
  assert.deepEqual([c.esquema, c.objeto], ['ho`rus', 't""x']);
  const d = parse('GRANT SELECT ON "a""b"."c" TO "u"@"h"');
  assert.deepEqual([d.esquema, d.objeto], ['a"b', 'c']);
});

test('analizador: roles, PROXY, objetos de rutina y privilegios por columna', () => {
  assert.equal(parse('GRANT `rol_lectura`@`%` TO `horus_app`@`10.0.0.%`').tipo, 'rol');
  assert.equal(parse('GRANT `r1`@`%`, `r2`@`%` TO `u`@`%` WITH ADMIN OPTION').tipo, 'rol');
  assert.equal(parse("GRANT PROXY ON ''@'' TO `avnadmin`@`%` WITH GRANT OPTION").tipo, 'proxy');
  const f = parse('GRANT EXECUTE ON FUNCTION `horus_db`.`f` TO `u`@`%`');
  assert.equal(f.tipoObjeto, 'FUNCTION');
  const col = parse('GRANT SELECT (`a`, `b`), INSERT (`c`) ON `horus_db`.`certificados` TO `u`@`%`');
  assert.deepEqual(col.privilegios, ['SELECT(columnas)', 'INSERT(columnas)']);
});

test('regresion C.4: privilegios separados por coma con o sin espacios son equivalentes', () => {
  const esperado = ['SELECT', 'INSERT', 'UPDATE'];
  for (const lista of ['SELECT,INSERT,UPDATE', 'SELECT, INSERT, UPDATE', 'SELECT,  INSERT,  UPDATE', 'SELECT,INSERT, UPDATE']) {
    const g = parse('GRANT ' + lista + ' ON `horus_db`.`t` TO `u`@`%`');
    assert.deepEqual(g.privilegios, esperado, lista);
    assert.deepEqual([g.esquema, g.objeto], ['horus_db', 't']);
  }
  const col = parse('GRANT SELECT (`a`,`b`),INSERT (`c`) ON `horus_db`.`t` TO `u`@`%`');
  assert.deepEqual(col.privilegios, ['SELECT(columnas)', 'INSERT(columnas)']);
  const multi = parse('GRANT CREATE TEMPORARY TABLES,SHOW DATABASES,LOCK TABLES ON *.* TO `u`@`%`');
  assert.deepEqual(multi.privilegios, ['CREATE TEMPORARY TABLES', 'SHOW DATABASES', 'LOCK TABLES']);
});

test('regresion C.4: fila administrativa global sin espacios tras la coma (datos ficticios) se reconoce y no se rechaza', () => {
  const fila = 'GRANT ' + DYN.replace(/, /g, ',') + ',APPLICATION_PASSWORD_ADMIN,CONNECTION_ADMIN,ROLE_ADMIN ON *.* TO `avnadmin`@`%` WITH GRANT OPTION';
  assert.ok(!/, /.test(fila));
  const g = parse(fila);
  assert.equal(g.tipo, 'grant');
  assert.equal(g.esquema, '*');
  assert.equal(g.objeto, '*');
  assert.equal(g.grantOption, true);
  assert.ok(g.privilegios.includes('SHOW DATABASES') && g.privilegios.includes('ROLE_ADMIN') && g.privilegios.includes('CREATE TEMPORARY TABLES'));
  assert.equal(g.privilegios.length, DYN.split(', ').length + 3);
  assert.equal(lib.adminCanGrant([g]), true);
  // Equivalente a la forma con espacios.
  const con = parse('GRANT ' + DYN + ', APPLICATION_PASSWORD_ADMIN, CONNECTION_ADMIN, ROLE_ADMIN ON *.* TO `avnadmin`@`%` WITH GRANT OPTION');
  assert.deepEqual(g, con);
});

test('regresion C.4: la coma flexible no abre la puerta a privilegios o estructuras no validas', () => {
  for (const mala of [
    'GRANT SELECT,select ON *.* TO `u`@`%`', 'GRANT SELECT, ON *.* TO `u`@`%`', 'GRANT ,SELECT ON *.* TO `u`@`%`',
    'GRANT SELECT,,INSERT ON *.* TO `u`@`%`', 'GRANT SELECT,\tINSERT ON *.* TO `u`@`%`', 'GRANT SELECT,\nINSERT ON *.* TO `u`@`%`',
    'GRANT SELECT,INSERT;DROP ON *.* TO `u`@`%`', 'GRANT SELECT,INSERT ON horus_db.t TO `u`@`%`', 'GRANT SELECT,INSERT ON *.* TO `u`@`%`,PEGADO'
  ]) {
    assert.throws(() => parse(mala), { phase: 'analisis-grants' }, JSON.stringify(mala));
  }
  // Un privilegio desconocido bien formado sigue sin confundirse con un permiso CRUD de la matriz.
  const desconocido = parse('GRANT SELECT,PRIVILEGIO_INVENTADO ON `horus_db`.`certificados` TO `horus_app`@`%`');
  assert.ok(desconocido.privilegios.includes('PRIVILEGIO_INVENTADO'));
  assert.equal(lib.compareAppGrants([desconocido]).diferentes.includes('certificados'), true);
});

test('analizador: formatos desconocidos siguen fallando cerrado, nunca como permiso seguro', () => {
  for (const mala of [
    '', 'basura', 'GRANT', 'GRANT SELECT ON horus_db.t TO u', 'GRANT SELECT ON `horus_db` TO `u`@`%`',
    'GRANT select ON `horus_db`.* TO `u`@`%`', 'GRANT SELECT ON `horus_db`.* TO `u`@`%` WITH GRANT OPTION; DROP TABLE x',
    'GRANT SELECT ON `horus_db`.* FROM `u`@`%`', 'REVOKE SELECT ON `horus_db`.* TO `u`@`%`',
    'GRANT SELECT ON `horus_db`.* TO `u`@`%` PEGADO', 'SELECT 1'
  ]) {
    assert.throws(() => parse(mala), { phase: 'analisis-grants' }, JSON.stringify(mala));
  }
});

test('adminCanGrant: una revocacion parcial sobre mysql no afecta; sobre horus_db si', () => {
  const global = parse('GRANT ' + DYN + ' ON *.* TO `avnadmin`@`%` WITH GRANT OPTION');
  const revMysql = parse('REVOKE INSERT, UPDATE, DELETE ON `mysql`.* FROM `avnadmin`@`%`');
  const revHorus = parse('REVOKE DELETE ON `horus_db`.* FROM `avnadmin`@`%`');
  assert.equal(lib.adminCanGrant([global, revMysql]), true);
  assert.equal(lib.adminCanGrant([global, revHorus]), false);
  const todo = parse('GRANT ALL PRIVILEGES ON *.* TO `avnadmin`@`%` WITH GRANT OPTION');
  assert.equal(lib.adminCanGrant([todo, revMysql]), true);
  assert.equal(lib.adminCanGrant([todo, revHorus]), false);
  assert.equal(lib.adminCanGrant([parse('GRANT ' + DYN + ' ON *.* TO `avnadmin`@`%`')]), false);
});

test('prechequeo con SHOW GRANTS real de avnadmin (REVOKE parcial + roles + PROXY) se completa', async () => {
  const adminReal = [
    'GRANT ' + DYN + ', ROLE_ADMIN ON *.* TO `avnadmin`@`%` WITH GRANT OPTION',
    'REVOKE INSERT, UPDATE, DELETE, CREATE, DROP ON `mysql`.* FROM `avnadmin`@`%`',
    'GRANT `rol_x`@`%` TO `avnadmin`@`%`',
    "GRANT PROXY ON ''@'' TO `avnadmin`@`%` WITH GRANT OPTION"
  ];
  const { r } = await run(fakeConn({ adminGrants: adminReal }));
  assert.equal(r.prechequeoOk, true);
  assert.equal(r.ejecutados, 0);
});

test('un REVOKE, rol o rutina en horus_app nunca cuenta como conforme ni como estado inicial', async () => {
  const completo = appGrantRows(lib.GRANT_MATRIX);
  for (const extra of [
    'REVOKE SELECT ON `mysql`.* FROM `horus_app`@`' + HOST + '`',
    'GRANT `rol_x`@`%` TO `horus_app`@`' + HOST + '`',
    'GRANT EXECUTE ON FUNCTION `horus_db`.`f` TO `horus_app`@`' + HOST + '`'
  ]) {
    await assert.rejects(run(fakeConn({ appGrants: completo.concat(extra) }), { modo: 'verificar' }), { phase: 'verificacion' });
    const conn = fakeConn({ appGrants: USAGE.concat(extra) });
    await assert.rejects(run(conn, { modo: 'aplicar', confirmado: true, hostApp: HOST }), { phase: 'estado-app' });
    assert.equal(conn.log.grants.length, 0);
  }
});

// --- Diagnostico de filas no reconocidas (Fase C.4) ---
const SENSIBLE = /horus_app|avnadmin|horus_db|mysql|secreto|[`'"@%*]|WITH GRANT OPTION/; // Nombres, comillas, comodines y SQL.

test('diagnostico: clasifica tipo, ambito y motivo con vocabulario cerrado, sin fragmentos de la fila', () => {
  const casos = [
    ['GRANT PROXY ON ``@`` TO `avnadmin`@`%` WITH GRANT OPTION', 'PROXY', 'desconocido', /cuenta con nombre o host vacio/],
    ['GRANT SELECT,,INSERT ON *.* TO `avnadmin`@`%`', 'GRANT', 'global', /coma sobrante o elemento vacio/],
    ['GRANT SELECT ON `horus_db`.* TO `avnadmin`@`%` IDENTIFIED BY X', 'GRANT', 'esquema', /clausula final conocida con estructura no cubierta/],
    ['REVOKE INSERT ON `mysql`.`user` FROM `avnadmin`@`%` PEGADO', 'REVOKE', 'tabla', /clausula final desconocida/],
    ['GRANT EXECUTE ON FUNCTION `a`.`f` TO `u`@`%` PEGADO', 'GRANT', 'rutina', /clausula final desconocida/],
    ['GRANT SELECT ON ``.* TO `u`@`%`', 'GRANT', 'desconocido', /identificador vacio/],
    ['GRANT select ON *.* TO `u`@`%`', 'GRANT', 'global', /minusculas/],
    ['GRANT `r`@`%` TO ``@`%`', 'ROLE', 'desconocido', /roles: cuenta con nombre o host vacio/],
    ['SELECT 1', 'OTRO', 'desconocido', /no comienza por GRANT/]
  ];
  for (const [fila, tipo, ambito, motivo] of casos) {
    const d = lib.diagnoseGrantRow(fila);
    assert.equal(d.tipo, tipo, fila);
    assert.equal(d.ambito, ambito, fila);
    assert.match(d.motivo, motivo, fila);
    assert.deepEqual(Object.keys(d), ['tipo', 'ambito', 'motivo']);
    assert.ok(!SENSIBLE.test(Object.values(d).join(' ')), 'el diagnostico no debe contener fragmentos de la fila');
  }
});

test('diagnostico: el prechequeo con una fila no reconocida falla cerrado y explica cuenta, tipo, ambito y motivo', async () => {
  const adminRaro = ADMIN_GRANTS.concat('GRANT PROXY ON ``@`` TO `avnadmin`@`%` WITH GRANT OPTION');
  const conn = fakeConn({ adminGrants: adminRaro });
  let error;
  try { await run(conn); } catch (e) { error = e; }
  assert.ok(error);
  assert.equal(error.phase, 'analisis-grants');
  assert.match(error.safeMessage, /^Cuenta administrativa: 1 de 2 filas no reconocidas; fila 2 PROXY\/desconocido: /);
  assert.ok(error.safeMessage.length <= 400 && !/[\r\n]/.test(error.safeMessage));
  assert.ok(!SENSIBLE.test(error.safeMessage.replace(/^Cuenta administrativa/, '')));
  assert.ok(error.lines.some(l => /filas examinadas=2, reconocidas=1, no reconocidas=1/.test(l)));
  assert.ok(error.lines.every(l => !/[`@]|avnadmin|horus_app|WITH GRANT OPTION/.test(l.replace(/^Destino:.*|^CURRENT_USER.*|^horus_app existe.*/, ''))));
  assert.equal(conn.log.grants.length, 0);
});

test('diagnostico: la cuenta de aplicacion se distingue de la administrativa y bloquea Aplicar sin ejecutar GRANT', async () => {
  const conn = fakeConn({ appGrants: USAGE.concat('GRANT SELECT,,INSERT ON `horus_db`.`certificados` TO `horus_app`@`' + HOST + '`') });
  await assert.rejects(run(conn, { modo: 'aplicar', confirmado: true, hostApp: HOST }),
    e => e.phase === 'analisis-grants' && /^Cuenta aplicacion: 1 de 2 filas/.test(e.safeMessage));
  assert.equal(conn.log.grants.length, 0);
});

test('diagnostico: modo de solo lectura que examina ambas cuentas, informa y no ejecuta GRANT', async () => {
  const ok = fakeConn();
  const { r, lines } = await run(ok, { modo: 'diagnostico' });
  assert.equal(r.diagnosticoOk, true);
  assert.equal(ok.log.grants.length, 0);
  assert.ok(ok.log.all.every(s => /^(SELECT |SHOW )/.test(s)));
  assert.ok(lines.some(l => /cuenta administrativa: filas examinadas=1, reconocidas=1, no reconocidas=0/.test(l)));
  assert.ok(lines.some(l => /cuenta aplicacion: filas examinadas=1, reconocidas=1, no reconocidas=0/.test(l)));

  const raro = fakeConn({ adminGrants: ADMIN_GRANTS.concat('algo raro'), appGrants: USAGE.concat('GRANT SELECT,,INSERT ON *.* TO `horus_app`@`' + HOST + '`') });
  let error;
  try { await run(raro, { modo: 'diagnostico' }); } catch (e) { error = e; }
  assert.equal(error.phase, 'analisis-grants');
  assert.ok(error.lines.some(l => /cuenta administrativa: .*no reconocidas=1/.test(l)));
  assert.ok(error.lines.some(l => /cuenta aplicacion: .*no reconocidas=1/.test(l)), 'examina las dos cuentas antes de fallar');
  assert.equal(raro.log.grants.length, 0);
});

test('diagnostico: ningun formato desconocido pasa a ser aceptado por haber sido diagnosticado', () => {
  for (const mala of ['GRANT PROXY ON ``@`` TO `u`@`%`', 'GRANT SELECT,,INSERT ON *.* TO `u`@`%`', 'GRANT SELECT ON *.* TO `u`@`%` PEGADO']) {
    assert.throws(() => parse(mala), { phase: 'analisis-grants' }, mala);
    assert.doesNotThrow(() => lib.diagnoseGrantRow(mala));
  }
});

test('ningun log de una ejecucion completa contiene la contrasena ficticia', async () => {
  const secreto = 'Contrasena-Ficticia-No-Real-123';
  const conn = fakeConn({ afterGrants: appGrantRows(lib.GRANT_MATRIX) });
  const lines = [];
  await lib.run({ conn, modo: 'aplicar', confirmado: true, hostApp: HOST, log: l => lines.push(l) });
  assert.ok(![...lines, ...conn.log.all].some(l => l.includes(secreto)));
});

test('el cliente CLI falla de forma controlada ANTES de abrir ningun socket (sin red)', () => {
  // Solo rutas que terminan antes de createConnection: JSON invalido y contrasena vacia.
  // Nunca se envia una contrasena no vacia, para no provocar un intento real contra Aiven.
  const cli = path.join(__dirname, 'aiven-grants-horus-app-cli.cjs');
  for (const input of ['{"password":""}', 'no-es-json']) {
    const res = spawnSync(process.execPath, [cli], { input, encoding: 'utf8', timeout: 20000 });
    assert.equal(res.status, 1);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /^Fallo \((version-node|lectura-stdin|contrasena-vacia)\)\r?\n$/);
  }
});
