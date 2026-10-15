import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_ROLES } from '../src/permissions/roles';

// Sin MySQL: la conexión es una memoria simulada. Cuentas, correos, hosts y contraseñas son ficticios (dominios .test / .invalid).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../scripts/assign-role-lib.cjs') as {
  ROLES: string[]; parseArgs: (argv: string[]) => any; maskEmail: (email: string) => string; destination: (config: any) => any;
  planAssignment: (accounts: Account[], input: any) => any; run: (args: any) => Promise<number>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const main = require('../scripts/assign-role.cjs') as { dependencies: (database: any) => { resolveConfig: () => any; connect: (dest: any) => any } };

type Account = { id: number; nombre: string; email: string; activo: boolean; rol: string | null; session_version?: number };
const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const SECRET = 'clave-ficticia-que-no-debe-aparecer';
const UUID = '3f2a9c1e-0b7d-11ef-9a4c-0242ac120002';
const OTHER_UUID = '9d8e7f60-1a2b-11ef-8c3d-0242ac120099';
const config = { host: 'db.test', port: 3306, database: 'horus_prueba', user: 'usuario_ficticio', password: SECRET };
const DEST = 'db.test:3306/horus_prueba';
const CONFIRM = ['--destino=' + DEST, '--servidor=' + UUID];
const seed = (): Account[] => [
  { id: 1, nombre: 'Cuenta Uno', email: 'uno@ejemplo.test', activo: true, rol: null, session_version: 1 },
  { id: 2, nombre: 'Cuenta Dos', email: 'dos@ejemplo.test', activo: true, rol: null, session_version: 1 },
  { id: 3, nombre: 'Cuenta Tres', email: 'tres@ejemplo.test', activo: false, rol: null, session_version: 1 },
];

type Server = { base?: string | null; uuid?: string | null; uuidFails?: boolean; hostname?: string; port?: number };
type Audit = { origen: string; actor_id: null; operador: string; cuenta_id: number; operacion: string; rol_anterior: string | null; rol_nuevo: string; motivo: string };
const AUDIT_COLUMNS = ['id', 'createdAt', 'origen', 'actor_id', 'operador', 'cuenta_id', 'operacion', 'rol_anterior', 'rol_nuevo', 'activo_anterior', 'activo_nuevo', 'resultado', 'motivo'];
// Memoria que imita lo mínimo de mysql2 que usa el script y registra cada sentencia.
function fakeDb(accounts: Account[], { hasColumn = true, auditColumns = AUDIT_COLUMNS, failUpdate = false, failAudit = false, raceBeforeUpdate, server = {} }: {
  hasColumn?: boolean; auditColumns?: string[]; failUpdate?: boolean; failAudit?: boolean; raceBeforeUpdate?: (rows: Account[]) => void; server?: Server;
} = {}) {
  const log: string[] = []; const audits: Audit[] = []; let snapshot: { accounts: Account[]; audits: Audit[] } | null = null; let ended = false;
  const identity = { base: 'horus_prueba', uuid: UUID, hostname: 'contenedor-7a1b', port: 3306, ...server };
  const db = {
    log, accounts, audits, get ended() { return ended; },
    query: async (sql: string, params: unknown[] = []) => {
      log.push(sql.split(/\s+/).slice(0, 2).join(' '));
      if (/^SELECT DATABASE\(\)/.test(sql)) return [[{ base: identity.base, hostname: identity.hostname, puerto: identity.port }]];
      if (/@@server_uuid/.test(sql)) { if (identity.uuidFails) throw new Error('variable desconocida'); return [[{ uuid: identity.uuid }]]; }
      if (/information_schema\.COLUMNS .*'admin_auditoria'/.test(sql)) return [auditColumns.map(COLUMN_NAME => ({ COLUMN_NAME }))];
      if (/information_schema\.COLUMNS/.test(sql)) return [hasColumn ? [{ COLUMN_NAME: 'rol' }] : []];
      if (/^INSERT INTO admin_auditoria/.test(sql)) {
        if (failAudit) throw new Error('fallo simulado de auditoría');
        assert.match(sql, /VALUES \('terminal', NULL, \?, \?, 'rol_asignado', \?, \?, 1, 1, 'aplicado', \?\)/);
        const [operador, cuenta_id, rol_anterior, rol_nuevo, motivo] = params as [string, number, string | null, string, string];
        audits.push({ origen: 'terminal', actor_id: null, operador, cuenta_id, operacion: 'rol_asignado', rol_anterior, rol_nuevo, motivo });
        return [{ affectedRows: 1, insertId: audits.length }];
      }
      if (/GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
      if (/^SELECT id, nombre/.test(sql)) return [accounts.map(a => ({ ...a, activo: a.activo ? 1 : 0 }))];
      if (/^UPDATE admin_users/.test(sql)) {
        if (failUpdate) throw new Error('fallo simulado');
        raceBeforeUpdate?.(accounts);
        const [rol, bump, , id, previous] = params as [string, number, Date, number, string | null];
        const row = accounts.find(a => a.id === id && a.activo && (a.rol ?? null) === previous);
        if (!row) return [{ affectedRows: 0 }];
        row.rol = rol; row.session_version = (row.session_version ?? 1) + bump;
        return [{ affectedRows: 1 }];
      }
      throw new Error('sentencia inesperada: ' + sql);
    },
    beginTransaction: async () => { log.push('BEGIN'); snapshot = { accounts: accounts.map(a => ({ ...a })), audits: [...audits] }; },
    commit: async () => { log.push('COMMIT'); snapshot = null; },
    rollback: async () => {
      log.push('ROLLBACK');
      if (snapshot) { accounts.splice(0, accounts.length, ...snapshot.accounts); audits.splice(0, audits.length, ...snapshot.audits); snapshot = null; }
    },
    end: async () => { ended = true; },
  };
  return db;
}

async function execute(db: ReturnType<typeof fakeDb>, argv: string[], resolved: any = config) {
  const lines: string[] = []; const connections: any[] = []; let resolutions = 0;
  const code = await lib.run({
    argv, out: (line: string) => lines.push(line),
    resolveConfig: () => { resolutions++; if (resolved instanceof Error) throw resolved; return resolved; },
    connect: async (dest: any) => { connections.push(dest); return db; },
  });
  return { code, text: lines.join('\n'), connections, resolutions };
}

const writes = (db: ReturnType<typeof fakeDb>) => db.log.filter(entry => /^(UPDATE|INSERT|DELETE|BEGIN|COMMIT)/.test(entry) || /GET_LOCK/.test(entry));
const DECLARED = ['--operador=ops-01', '--motivo=Asignación autorizada en prueba'];
const applyArgs = (email: string, rol: string, extra: string[] = CONFIRM) => ['--email=' + email, '--rol=' + rol, '--apply', '--confirmar=' + email, ...extra, ...DECLARED];
const noSecrets = (text: string) => { assert.ok(!text.includes(SECRET), 'no aparece la contraseña'); assert.ok(!text.includes('usuario_ficticio'), 'no aparece el usuario de la base'); };

// ---------------------------------------------------------------------------------------------------------------
// Coherencia y funciones puras
// ---------------------------------------------------------------------------------------------------------------
test('los roles del script coinciden con ADMIN_ROLES y con el enum de schema.prisma y la migración', () => {
  assert.deepEqual(lib.ROLES, [...ADMIN_ROLES]);
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const block = schema.match(/enum AdminRol \{([^}]*)\}/)?.[1] ?? '';
  assert.deepEqual(block.split(/\s+/).filter(word => word && !word.startsWith('//')), [...ADMIN_ROLES]);
  const sql = readFileSync(join(__dirname, '..', 'migrations', '20261014-admin-rol.sql'), 'utf8');
  assert.deepEqual([...sql.matchAll(/'([A-Z_]+)'/g)].map(match => match[1]), [...ADMIN_ROLES]);
});

test('parseArgs: acepta solo opciones conocidas, completas y no repetidas', () => {
  assert.deepEqual(lib.parseArgs(['--email=a@b.test', '--rol=SECRETARIA']), { listar: false, apply: false, permitirOtroGerente: false, email: 'a@b.test', rol: 'SECRETARIA' });
  assert.equal(lib.parseArgs(['--servidor=' + UUID, '--apply']).servidor, UUID);
  for (const bad of [['--apply=1'], ['--email'], ['--rol'], ['--desconocida'], ['--email=a@b.test', '--sudo'], ['x']]) assert.throws(() => lib.parseArgs(bad), /Opción no reconocida/);
  for (const repeated of [['--rol=GERENTE_GENERAL', '--rol=SECRETARIA'], ['--email=a@b.test', '--email=c@d.test'], ['--apply', '--apply'], ['--destino=a:1/b', '--destino=c:2/d'], ['--servidor=' + UUID, '--servidor=' + OTHER_UUID]]) {
    assert.throws(() => lib.parseArgs(repeated), /Opción repetida/, repeated.join(' '));
  }
});

test('maskEmail oculta casi toda la parte local', () => {
  assert.equal(lib.maskEmail('persona@ejemplo.test'), 'pe***@ejemplo.test');
  assert.ok(!lib.maskEmail('persona@ejemplo.test').includes('persona'));
});

test('destination: exige host, puerto y base válidos y nunca incluye usuario ni contraseña', () => {
  assert.deepEqual(lib.destination(config), { host: 'db.test', port: 3306, database: 'horus_prueba', label: DEST });
  assert.ok(!JSON.stringify(lib.destination(config)).includes(SECRET));
  for (const bad of [null, {}, { ...config, host: '' }, { ...config, port: NaN }, { ...config, port: 0 }, { ...config, port: '3306' }, { ...config, database: '' }]) {
    assert.throws(() => lib.destination(bad), /Configuración de conexión incompleta/);
  }
});

test('planAssignment: el primer rol debe ser GERENTE_GENERAL; ningún otro rol puede dejar al sistema sin gerente', () => {
  const accounts = seed();
  for (const rol of [C, S]) assert.throws(() => lib.planAssignment(accounts, { email: 'uno@ejemplo.test', rol }), /sin ningún GERENTE_GENERAL activo/);
  const plan = lib.planAssignment(accounts, { email: ' UNO@ejemplo.test ', rol: G });
  assert.deepEqual([plan.previous, plan.next, plan.managersBefore, plan.managersAfter, plan.revokeSessions, plan.unchanged], [null, G, 0, 1, true, false]);
});

test('planAssignment: cuenta inexistente, desactivada, rol o correo inválidos', () => {
  const accounts = seed();
  assert.throws(() => lib.planAssignment(accounts, { email: 'nadie@ejemplo.test', rol: G }), /No existe/);
  assert.throws(() => lib.planAssignment(accounts, { email: 'tres@ejemplo.test', rol: G }), /desactivada/);
  for (const rol of ['ADMIN', '', 'gerente_general', undefined, null]) assert.throws(() => lib.planAssignment(accounts, { email: 'uno@ejemplo.test', rol }), /Rol no válido/);
  assert.throws(() => lib.planAssignment(accounts, { email: 'sin-arroba', rol: G }), /Correo no válido/);
});

test('planAssignment: un segundo gerente exige la opción explícita; no se puede degradar al último gerente', () => {
  const accounts = seed(); accounts[0].rol = G;
  assert.throws(() => lib.planAssignment(accounts, { email: 'dos@ejemplo.test', rol: G }), /--permitir-otro-gerente/);
  assert.equal(lib.planAssignment(accounts, { email: 'dos@ejemplo.test', rol: G, permitirOtroGerente: true }).managersAfter, 2);
  assert.throws(() => lib.planAssignment(accounts, { email: 'uno@ejemplo.test', rol: C }), /sin ningún GERENTE_GENERAL activo/);
  assert.equal(lib.planAssignment(accounts, { email: 'dos@ejemplo.test', rol: S }).revokeSessions, true, 'también la primera asignación revoca sesiones');
  accounts[1].rol = S;
  assert.equal(lib.planAssignment(accounts, { email: 'dos@ejemplo.test', rol: C }).revokeSessions, true, 'cambiar un rol ya concedido también revoca sesiones');
  assert.equal(lib.planAssignment(accounts, { email: 'dos@ejemplo.test', rol: S }).unchanged, true);
});

test('un gerente inactivo no cuenta como gerente activo', () => {
  const accounts = seed(); accounts[2].rol = G;
  assert.equal(lib.planAssignment(accounts, { email: 'uno@ejemplo.test', rol: G }).managersBefore, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Destino e identidad del servidor (hallazgo A-1)
// ---------------------------------------------------------------------------------------------------------------
test('la configuración se resuelve UNA vez y la conexión se abre exactamente con ese host, puerto y base', async () => {
  for (const argv of [['--listar'], ['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL'], applyArgs('uno@ejemplo.test', G)]) {
    const result = await execute(fakeDb(seed()), argv);
    assert.equal(result.resolutions, 1, argv.join(' '));
    assert.deepEqual(result.connections, [{ host: 'db.test', port: 3306, database: 'horus_prueba' }], 'conecta con lo validado y sin credenciales en el destino');
  }
});

test('dependencies(): resuelve con options() de database.cjs y fuerza host, puerto y base en connect()', () => {
  const calls: any[] = [];
  const database = { options: () => ({ ...config, port: 3310 }), connect: (extra: any) => { calls.push(extra); return 'conexion'; } };
  const deps = main.dependencies(database);
  const resolved = deps.resolveConfig();
  assert.equal(resolved.port, 3310);
  assert.equal(deps.connect({ host: 'otro.test', port: 3310, database: 'horus_prueba' }), 'conexion');
  assert.deepEqual(calls, [{ host: 'otro.test', port: 3310, database: 'horus_prueba' }]);
});

test('si la configuración no se puede resolver, no se conecta y no se muestra ningún valor', async () => {
  const db = fakeDb(seed());
  const { code, text, connections } = await execute(db, ['--listar'], new Error('Falta configurar DB_PASS ' + SECRET));
  assert.equal(code, 2);
  assert.match(text, /Configuración de conexión incompleta/);
  assert.deepEqual(connections, []);
  noSecrets(text);
});

test('aplicar sin confirmaciones completas se rechaza ANTES de conectarse (correo, destino con puerto, servidor)', async () => {
  const cases: [string[], RegExp][] = [
    [[], /--confirmar/],
    [['--confirmar=dos@ejemplo.test', ...CONFIRM], /--confirmar/],
    [['--confirmar=uno@ejemplo.test', '--servidor=' + UUID], /--destino/],
    [['--confirmar=uno@ejemplo.test', '--destino=db.test/horus_prueba', '--servidor=' + UUID], /--destino/], // formato antiguo, sin puerto
    [['--confirmar=uno@ejemplo.test', '--destino=db.test:3307/horus_prueba', '--servidor=' + UUID], /--destino/], // mismo host y base, otro puerto
    [['--confirmar=uno@ejemplo.test', '--destino=otro.test:3306/horus_prueba', '--servidor=' + UUID], /--destino/],
    [['--confirmar=uno@ejemplo.test', '--destino=db.test:3306/otra_base', '--servidor=' + UUID], /--destino/],
    [['--confirmar=uno@ejemplo.test', '--destino=' + DEST], /--servidor/], // confirmación de servidor ausente
    [['--confirmar=uno@ejemplo.test', '--destino=' + DEST, '--servidor=no-es-un-uuid'], /server_uuid completo/],
  ];
  for (const [extra, message] of cases) {
    const db = fakeDb(seed());
    const result = await execute(db, ['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL', '--apply', ...extra]);
    assert.equal(result.code, 2, extra.join(' '));
    assert.match(result.text, message, extra.join(' '));
    assert.deepEqual(result.connections, [], 'no se conecta: ' + extra.join(' '));
    assert.deepEqual(db.log, []);
    noSecrets(result.text);
  }
});

test('opciones incompatibles: --listar con --apply o --permitir-otro-gerente; confirmaciones sin --apply', async () => {
  for (const argv of [['--listar', '--apply'], ['--listar', '--permitir-otro-gerente'], ['--email=uno@ejemplo.test', '--rol=SECRETARIA', '--confirmar=uno@ejemplo.test'],
    ['--email=uno@ejemplo.test', '--rol=SECRETARIA', '--servidor=' + UUID], ['--email=uno@ejemplo.test', '--rol=SECRETARIA', '--destino=' + DEST], ['--email=uno@ejemplo.test'], [],
    ['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL', '--rol=SECRETARIA']]) {
    const result = await execute(fakeDb(seed()), argv);
    assert.equal(result.code, 2, argv.join(' '));
    assert.deepEqual(result.connections, []);
  }
});

test('la base real (DATABASE()) distinta de la configurada detiene todo, también en lectura, sin escribir', async () => {
  for (const argv of [['--listar'], ['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL'], applyArgs('uno@ejemplo.test', G)]) {
    for (const base of ['otra_base', null, 'HORUS_PRUEBA']) {
      const db = fakeDb(seed(), { server: { base } });
      const { code, text } = await execute(db, argv);
      assert.equal(code, 1, argv.join(' ') + ' / ' + base);
      assert.match(text, /no coincide con la configurada/);
      assert.deepEqual(writes(db), []);
      assert.ok(db.accounts.every(account => account.rol === null));
      assert.ok(db.ended);
    }
  }
});

test('una identidad de servidor distinta de la confirmada impide escribir', async () => {
  const db = fakeDb(seed(), { server: { uuid: OTHER_UUID } });
  const { code, text } = await execute(db, applyArgs('uno@ejemplo.test', G));
  assert.equal(code, 1);
  assert.match(text, /identidad del servidor conectado no coincide/);
  assert.deepEqual(writes(db), []);
  assert.ok(db.accounts.every(account => account.rol === null && account.session_version === 1));
});

test('si la identidad del servidor no se puede determinar, no se escribe (la lectura sí informa que no está disponible)', async () => {
  for (const server of [{ uuidFails: true }, { uuid: null }, { uuid: 'no-uuid' }]) {
    const db = fakeDb(seed(), { server });
    const applied = await execute(db, applyArgs('uno@ejemplo.test', G));
    assert.equal(applied.code, 1, JSON.stringify(server));
    assert.match(applied.text, /No se pudo determinar la identidad del servidor/);
    assert.deepEqual(writes(db), []);
    const listed = await execute(fakeDb(seed(), { server }), ['--listar']);
    assert.equal(listed.code, 0);
    assert.match(listed.text, /server_uuid=no disponible/);
  }
});

test('el hostname y el puerto informados por MySQL pueden diferir (Docker, proxy): no impiden escribir si base y server_uuid coinciden', async () => {
  const db = fakeDb(seed(), { server: { hostname: 'a1b2c3d4e5f6', port: 33060 } });
  const { code, text } = await execute(db, applyArgs('uno@ejemplo.test', G, ['--destino=' + DEST, '--servidor=' + UUID.toUpperCase()]));
  assert.equal(code, 0);
  assert.match(text, /hostname informado=a1b2c3d4e5f6 \| puerto informado=33060/);
  assert.equal(db.accounts[0].rol, G);
});

test('listado y simulación muestran el destino y la identidad para confirmar, enmascaran correos y no escriben ni muestran credenciales', async () => {
  const db = fakeDb(seed());
  const listed = await execute(db, ['--listar']);
  assert.equal(listed.code, 0);
  assert.ok(!listed.text.includes('uno@ejemplo.test') && listed.text.includes('un***@ejemplo.test'));
  assert.match(listed.text, /Gerentes generales activos: 0/);
  assert.ok(listed.text.includes('--destino=' + DEST + ' --servidor=' + UUID));
  const simulated = await execute(db, ['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL']);
  assert.equal(simulated.code, 0);
  assert.match(simulated.text, /SIMULACIÓN: no se escribió nada/);
  assert.ok(simulated.text.includes('--destino=' + DEST + ' --servidor=' + UUID));
  assert.deepEqual(writes(db), []);
  assert.ok(db.accounts.every(account => account.rol === null));
  for (const text of [listed.text, simulated.text]) { noSecrets(text); assert.ok(!/password|hash/i.test(text)); }
});

// ---------------------------------------------------------------------------------------------------------------
// Aplicación, sesiones y reglas del último gerente (se conservan)
// ---------------------------------------------------------------------------------------------------------------
test('aplicar el primer gerente: una sola cuenta cambia, en transacción, y sus sesiones se invalidan', async () => {
  const db = fakeDb(seed());
  const { code, text } = await execute(db, applyArgs('uno@ejemplo.test', G));
  assert.equal(code, 0);
  assert.match(text, /Rol asignado: cuenta id 1 -> GERENTE_GENERAL\. Gerentes generales activos: 1/);
  assert.deepEqual(db.accounts.map(account => account.rol), [G, null, null], 'las demás cuentas no se tocan');
  assert.deepEqual(db.accounts.map(account => account.session_version), [2, 1, 1], 'solo la cuenta asignada sube session_version');
  assert.deepEqual(db.log.filter(entry => /^(UPDATE|BEGIN|COMMIT)/.test(entry)), ['BEGIN', 'UPDATE admin_users', 'COMMIT']);
  assert.ok(db.log.indexOf('SELECT @@server_uuid') < db.log.findIndex(entry => /GET_LOCK/.test(entry)), 'la identidad se comprueba antes de bloquear y escribir');
  assert.ok(db.log.some(entry => entry.startsWith('SELECT RELEASE_LOCK')));
  assert.ok(db.ended);
  noSecrets(text);
});

test('cada cambio de rol sube session_version de esa cuenta y de ninguna otra', async () => {
  const accounts = seed(); accounts[0].rol = G; accounts[1].rol = S;
  const db = fakeDb(accounts);
  const { code } = await execute(db, applyArgs('dos@ejemplo.test', C));
  assert.equal(code, 0);
  assert.deepEqual([db.accounts[1].rol, db.accounts[1].session_version, db.accounts[0].session_version], [C, 2, 1]);
});

test('aplicar sin cambios no escribe ni sube session_version', async () => {
  const accounts = seed(); accounts[0].rol = G;
  const db = fakeDb(accounts);
  const { code, text } = await execute(db, applyArgs('uno@ejemplo.test', G));
  assert.equal(code, 0);
  assert.match(text, /Sin cambios/);
  assert.ok(!/Se cerrarán las sesiones/.test(text), 'no anuncia el cierre de sesiones si no hay cambio');
  assert.ok(!db.log.includes('UPDATE admin_users'));
  assert.equal(db.accounts[0].session_version, 1);
});

test('degradar al último gerente o asignar a una cuenta inactiva se rechaza y revierte sin cambios', async () => {
  const accounts = seed(); accounts[0].rol = G;
  for (const [email, rol, message] of [['uno@ejemplo.test', S, /sin ningún GERENTE_GENERAL activo/], ['tres@ejemplo.test', S, /desactivada/], ['dos@ejemplo.test', G, /--permitir-otro-gerente/]] as const) {
    const db = fakeDb(accounts.map(a => ({ ...a })));
    const { code, text } = await execute(db, applyArgs(email, rol));
    assert.equal(code, 1, email + ' ' + rol);
    assert.match(text, message);
    assert.ok(!db.log.includes('UPDATE admin_users') && db.log.includes('ROLLBACK'));
    assert.deepEqual(db.accounts.map(a => [a.rol, a.session_version]), [[G, 1], [null, 1], [null, 1]]);
  }
  const db = fakeDb(accounts.map(a => ({ ...a })));
  assert.equal((await execute(db, applyArgs('dos@ejemplo.test', G, [...CONFIRM, '--permitir-otro-gerente']))).code, 0, 'con la opción especial sí');
  assert.equal(db.accounts[1].rol, G);
});

test('aplicar una asignación inválida revierte y no cambia nada', async () => {
  const db = fakeDb(seed());
  const { code, text } = await execute(db, applyArgs('uno@ejemplo.test', S));
  assert.equal(code, 1);
  assert.match(text, /sin ningún GERENTE_GENERAL activo/);
  assert.ok(!db.log.includes('UPDATE admin_users') && db.log.includes('ROLLBACK'));
  assert.ok(db.accounts.every(account => account.rol === null));
});

test('si la cuenta cambia entre la validación y la escritura, no se escribe nada', async () => {
  const db = fakeDb(seed(), { raceBeforeUpdate: rows => { rows[0].activo = false; } });
  const { code, text } = await execute(db, applyArgs('uno@ejemplo.test', G));
  assert.equal(code, 1);
  assert.match(text, /cambió mientras se aplicaba/);
  assert.ok(db.log.includes('ROLLBACK') && !db.log.includes('COMMIT'));
});

test('un error inesperado de la base revierte (también session_version), libera el bloqueo y cierra la conexión', async () => {
  const db = fakeDb(seed(), { failUpdate: true });
  await assert.rejects(execute(db, applyArgs('uno@ejemplo.test', G)), /fallo simulado/);
  assert.ok(db.log.includes('ROLLBACK') && !db.log.includes('COMMIT'));
  assert.ok(db.log.some(entry => entry.startsWith('SELECT RELEASE_LOCK')) && db.ended);
  assert.ok(db.accounts.every(account => account.rol === null && account.session_version === 1));
});

test('si falta la columna rol, el script se detiene con la indicación de migrar y no escribe', async () => {
  const db = fakeDb(seed(), { hasColumn: false });
  const { code, text } = await execute(db, ['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL']);
  assert.equal(code, 1);
  assert.match(text, /20261014-admin-rol/);
  assert.deepEqual(writes(db), []);
});

test('la biblioteca no consulta contraseñas ni contiene sentencias destructivas; el script real no se ejecuta al importarlo', () => {
  const source = readFileSync(join(__dirname, '..', 'scripts', 'assign-role.cjs'), 'utf8');
  assert.match(source, /require\.main === module/);
  const library = readFileSync(join(__dirname, '..', 'scripts', 'assign-role-lib.cjs'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bpassword\b/i.test(library));
  assert.ok(!/\bDELETE\b|\bDROP\b|\bALTER\b|\bTRUNCATE\b/i.test(library));
  assert.deepEqual([...library.matchAll(/\bINSERT\s+INTO\s+(\w+)/gi)].map(match => match[1]), ['admin_auditoria'], 'la única inserción es el registro de auditoría');
});

// ---------------------------------------------------------------------------------------------------------------
// Auditoría desde la terminal (H-BACK-01, E3.2): operador declarado, motivo y registro en la misma transacción
// ---------------------------------------------------------------------------------------------------------------
test('aplicar exige --operador y --motivo válidos y los rechaza ANTES de conectarse; sin --apply no se admiten', async () => {
  const base = ['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL', '--apply', '--confirmar=uno@ejemplo.test', ...CONFIRM];
  const cases: [string[], RegExp][] = [
    [[], /--operador=<identificador>/],
    [['--motivo=Motivo suficiente'], /--operador=<identificador>/],
    [['--operador=ops-01'], /--motivo=<texto>/],
    [['--operador=', '--motivo=Motivo suficiente'], /--operador=<identificador>/],
    [['--operador=x', '--motivo=Motivo suficiente'], /--operador debe tener/],
    [['--operador=persona@ejemplo.test', '--motivo=Motivo suficiente'], /--operador debe tener/],
    [['--operador=' + 'a'.repeat(101), '--motivo=Motivo suficiente'], /--operador debe tener/],
    [['--operador=-ops', '--motivo=Motivo suficiente'], /--operador debe tener/],
    [['--operador=ops-01', '--motivo=   '], /--motivo=<texto>/],
    [['--operador=ops-01', '--motivo=abcd'], /--motivo debe tener/],
    [['--operador=ops-01', '--motivo=avisar a persona@ejemplo.test'], /--motivo debe tener/],
    [['--operador=ops-01', '--motivo=línea uno\nlínea dos'], /--motivo debe tener/],
    [['--operador=ops-01', '--motivo=' + 'm'.repeat(201)], /--motivo debe tener/],
  ];
  for (const [extra, message] of cases) {
    const db = fakeDb(seed());
    const result = await execute(db, [...base, ...extra]);
    assert.equal(result.code, 2, extra.join(' '));
    assert.match(result.text, message, extra.join(' '));
    assert.deepEqual(result.connections, [], 'no se conecta: ' + extra.join(' '));
  }
  for (const extra of [['--operador=ops-01'], ['--motivo=Motivo suficiente']]) {
    const result = await execute(fakeDb(seed()), ['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL', ...extra]);
    assert.equal(result.code, 2);
    assert.match(result.text, /solo se usan junto con --apply/);
  }
});

test('un cambio aplicado registra en admin_auditoria origen terminal, cuenta, roles, operador y motivo, dentro de la transacción', async () => {
  const db = fakeDb(seed());
  const { code, text } = await execute(db, ['--email=uno@ejemplo.test', '--rol=' + G, '--apply', '--confirmar=uno@ejemplo.test', ...CONFIRM, '--operador=  ops-01 ', '--motivo= Asignación autorizada en prueba ']);
  assert.equal(code, 0, text);
  assert.deepEqual(db.audits, [{ origen: 'terminal', actor_id: null, operador: 'ops-01', cuenta_id: 1, operacion: 'rol_asignado', rol_anterior: null, rol_nuevo: G, motivo: 'Asignación autorizada en prueba' }]);
  const order = db.log.filter(entry => /^(BEGIN|UPDATE|INSERT|COMMIT)/.test(entry));
  assert.deepEqual(order, ['BEGIN', 'UPDATE admin_users', 'INSERT INTO', 'COMMIT'], 'cambio y auditoría en la misma transacción');
  assert.match(text, /Operador declarado: ops-01 \| Motivo: Asignación autorizada en prueba/);
  assert.match(text, /Auditoría registrada \(id 1\)/);
  // Cambio posterior: se registra el rol anterior real.
  const second = await execute(db, applyArgs('dos@ejemplo.test', S));
  assert.equal(second.code, 0);
  const third = await execute(db, applyArgs('dos@ejemplo.test', C));
  assert.equal(third.code, 0);
  assert.deepEqual(db.audits.map(audit => [audit.cuenta_id, audit.rol_anterior, audit.rol_nuevo]), [[1, null, G], [2, null, S], [2, S, C]]);
  noSecrets(text);
});

test('si falla el registro de auditoría se revierten también el rol y session_version, y se libera el bloqueo', async () => {
  const db = fakeDb(seed(), { failAudit: true });
  await assert.rejects(execute(db, applyArgs('uno@ejemplo.test', G)), /fallo simulado de auditoría/);
  assert.ok(db.log.includes('ROLLBACK') && !db.log.includes('COMMIT'));
  assert.ok(db.accounts.every(account => account.rol === null && account.session_version === 1));
  assert.deepEqual(db.audits, []);
  assert.ok(db.log.some(entry => entry.startsWith('SELECT RELEASE_LOCK')) && db.ended);
});

test('sin cambios o con la operación rechazada no se registra auditoría', async () => {
  const accounts = seed(); accounts[0].rol = G;
  const unchanged = fakeDb(accounts.map(a => ({ ...a })));
  assert.equal((await execute(unchanged, applyArgs('uno@ejemplo.test', G))).code, 0);
  assert.deepEqual(unchanged.audits, []);
  const rejected = fakeDb(accounts.map(a => ({ ...a })));
  assert.equal((await execute(rejected, applyArgs('uno@ejemplo.test', S))).code, 1);
  assert.deepEqual(rejected.audits, []);
});

test('sin la tabla de auditoría (o incompleta) la simulación y la aplicación se detienen sin bloquear ni escribir; el listado avisa', async () => {
  for (const auditColumns of [[], AUDIT_COLUMNS.filter(column => column !== 'operador')]) {
    for (const argv of [['--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL'], applyArgs('uno@ejemplo.test', G)]) {
      const db = fakeDb(seed(), { auditColumns });
      const { code, text } = await execute(db, argv);
      assert.equal(code, 1, argv.join(' '));
      assert.match(text, /20261014-admin-auditoria/);
      assert.match(text, auditColumns.length ? /incompleta/ : /no tiene la tabla admin_auditoria/);
      assert.deepEqual(writes(db), []);
      assert.ok(db.accounts.every(account => account.rol === null && account.session_version === 1));
      assert.ok(db.ended);
    }
    const listed = await execute(fakeDb(seed(), { auditColumns }), ['--listar']);
    assert.equal(listed.code, 0);
    assert.match(listed.text, /AVISO: .*20261014-admin-auditoria/);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Origen real de la configuración: proceso hijo con el script verdadero y un .env ficticio en un directorio temporal.
// Los hosts .invalid no resuelven y el destino confirmado es deliberadamente erróneo, de modo que el script se detiene antes de conectarse
// e informa el destino que resolvió. La precarga isolate-env evita que entren valores del backend/.env real.
// ---------------------------------------------------------------------------------------------------------------
const scriptPath = join(__dirname, '..', 'scripts', 'assign-role.cjs');
const isolatePath = join(__dirname, 'isolate-env.cjs');

function resolvedDestination(dotenv: Record<string, string> | null, processEnv: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'horus-assign-role-'));
  try {
    if (dotenv) writeFileSync(join(dir, '.env'), Object.entries(dotenv).map(([key, value]) => key + '=' + value).join('\n') + '\n');
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...processEnv };
    const result = spawnSync(process.execPath, ['-r', isolatePath, scriptPath, '--email=uno@ejemplo.test', '--rol=GERENTE_GENERAL', '--apply', '--confirmar=uno@ejemplo.test',
      '--destino=confirmado-a-proposito.invalid:1/no_existe', '--servidor=' + UUID], { cwd: dir, env, encoding: 'utf8', timeout: 30_000 });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    return { status: result.status, output, label: output.match(/Destino configurado: (\S+)\./)?.[1] ?? null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const credentials = { DB_USER: 'usuario_ficticio', DB_PASS: SECRET };

test('configuración solo desde variables del proceso', () => {
  const r = resolvedDestination(null, { DB_HOST: 'solo-proceso.invalid', DB_PORT: '3311', DB_NAME: 'base_proceso', ...credentials });
  assert.equal(r.status, 2, r.output);
  assert.equal(r.label, 'solo-proceso.invalid:3311/base_proceso');
  noSecrets(r.output);
});

test('configuración solo desde .env (la validación ya ve el .env, a diferencia del defecto A-1)', () => {
  const r = resolvedDestination({ DB_HOST: 'solo-dotenv.invalid', DB_PORT: '3312', DB_NAME: 'base_dotenv', ...credentials }, {});
  assert.equal(r.status, 2, r.output);
  assert.equal(r.label, 'solo-dotenv.invalid:3312/base_dotenv');
  noSecrets(r.output);
});

test('configuración mixta: lo que falta en el proceso sale del .env y lo validado incluye ambos orígenes', () => {
  const r = resolvedDestination({ DB_HOST: 'host-dotenv.invalid', DB_PASS: SECRET }, { DB_NAME: 'base_proceso', DB_PORT: '3313', DB_USER: 'usuario_ficticio' });
  assert.equal(r.status, 2, r.output);
  assert.equal(r.label, 'host-dotenv.invalid:3313/base_proceso', 'el host del .env ya forma parte del destino validado');
  noSecrets(r.output);
});

test('configuración mixta con conflicto: la variable del proceso prevalece sobre el .env, y eso es lo que se valida', () => {
  const r = resolvedDestination({ DB_HOST: 'host-dotenv.invalid', DB_PORT: '3399', DB_NAME: 'base_dotenv', ...credentials }, { DB_HOST: 'host-proceso.invalid', DB_PORT: '3314' });
  assert.equal(r.status, 2, r.output);
  assert.equal(r.label, 'host-proceso.invalid:3314/base_dotenv');
  noSecrets(r.output);
});

test('sin puerto configurado se usa 3306 y se exige en la confirmación; configuración incompleta se rechaza sin mostrar valores', () => {
  const r = resolvedDestination(null, { DB_HOST: 'sin-puerto.invalid', DB_NAME: 'base_x', ...credentials });
  assert.equal(r.label, 'sin-puerto.invalid:3306/base_x');
  const incomplete = resolvedDestination(null, { DB_HOST: 'incompleta.invalid', DB_NAME: 'base_x', DB_USER: 'usuario_ficticio' });
  assert.equal(incomplete.status, 2, incomplete.output);
  assert.match(incomplete.output, /Configuración de conexión incompleta/);
  noSecrets(incomplete.output);
});
