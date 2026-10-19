import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sin MySQL ni bcrypt real: la conexión es una memoria simulada y el hash una función ficticia. Datos ficticios (.test).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../scripts/create-admin-lib.cjs') as { parseArgs: (argv: string[]) => any; run: (args: any) => Promise<number> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const main = require('../scripts/create-admin.cjs') as { dependencies: (database: any, bcrypt: any) => any };

const SECRET = 'clave-ficticia-que-no-debe-aparecer';
const PASSWORD = 'Temporal-ficticia-123';
const HASH = '$2a$12$hashficticioquenodebeaparecerenlasalida000000000000000';
const config = { host: 'db.test', port: 3306, database: 'horus_prueba', user: 'usuario_ficticio', password: SECRET };
const DEST = 'db.test:3306/horus_prueba';
const UUID = '3f2a1c4e-0b7d-11ef-9a3c-0242ac120002';
const OTHER_UUID = '8c9d0e1f-0b7d-11ef-9a3c-0242ac120099';
const ARGS = ['--destino=' + DEST, '--servidor=' + UUID, '--operador=ops-01', '--motivo=Recuperación de acceso autorizada'];
const AUDIT_COLUMNS = ['id', 'createdAt', 'origen', 'actor_id', 'operador', 'cuenta_id', 'operacion', 'rol_anterior', 'rol_nuevo', 'activo_anterior', 'activo_nuevo', 'resultado', 'motivo'];

type User = { id: number; nombre: string; email: string; password: string; activo: number; session_version: number; rol: string | null };
function fakeDb(users: User[] = [], { base = 'horus_prueba', uuid = UUID as string | null, uuidFails = false, hasRol = true, auditColumns = AUDIT_COLUMNS, failAudit = false, duplicateOnInsert = false, roleTrigger = false } = {}) {
  const log: string[] = []; const audits: any[] = []; let snapshot: { users: User[]; audits: any[] } | null = null; let ended = false;
  return {
    log, users, audits, get ended() { return ended; },
    query: async (sql: string, params: any[] = []) => {
      log.push(sql.split(/\s+/).slice(0, 3).join(' '));
      if (/^SELECT DATABASE\(\)/.test(sql)) return [[{ base, hostname: 'contenedor-7a1b', puerto: 3306 }]];
      if (/@@server_uuid/.test(sql)) { if (uuidFails) throw new Error('variable desconocida'); return [[{ uuid }]]; }
      if (/information_schema\.COLUMNS .*'admin_auditoria'/.test(sql)) return [auditColumns.map(COLUMN_NAME => ({ COLUMN_NAME }))];
      if (/information_schema\.COLUMNS/.test(sql)) return [hasRol ? [{ COLUMN_NAME: 'rol' }] : []];
      if (/^SELECT id FROM admin_users WHERE email/.test(sql)) return [users.filter(user => user.email === params[0]).map(({ id }) => ({ id }))];
      if (/^INSERT INTO admin_users/.test(sql)) {
        if (duplicateOnInsert) throw Object.assign(new Error('Duplicate entry'), { errno: 1062, code: 'ER_DUP_ENTRY' });
        assert.match(sql, /VALUES \(\?, \?, \?, 1, 1, NULL, \?, \?\)/, 'la cuenta se crea activa y con rol NULL explícito');
        const [nombre, email, password] = params;
        const id = users.length + 1;
        users.push({ id, nombre, email, password, activo: 1, session_version: 1, rol: roleTrigger ? 'GERENTE_GENERAL' : null });
        return [{ affectedRows: 1, insertId: id }];
      }
      if (/^SELECT rol, activo FROM admin_users/.test(sql)) return [users.filter(user => user.id === params[0]).map(({ rol, activo }) => ({ rol, activo }))];
      if (/^INSERT INTO admin_auditoria/.test(sql)) {
        if (failAudit) throw new Error('fallo simulado de auditoría');
        assert.match(sql, /VALUES \('terminal', NULL, \?, \?, 'cuenta_creada', NULL, NULL, NULL, 1, 'aplicado', \?\)/);
        const [operador, cuenta_id, motivo] = params;
        audits.push({ operador, cuenta_id, motivo });
        return [{ affectedRows: 1, insertId: audits.length }];
      }
      throw new Error('sentencia inesperada: ' + sql);
    },
    beginTransaction: async () => { log.push('BEGIN'); snapshot = { users: users.map(u => ({ ...u })), audits: [...audits] }; },
    commit: async () => { log.push('COMMIT'); snapshot = null; },
    rollback: async () => {
      log.push('ROLLBACK');
      if (snapshot) { users.splice(0, users.length, ...snapshot.users); audits.splice(0, audits.length, ...snapshot.audits); snapshot = null; }
    },
    end: async () => { ended = true; },
  };
}

async function execute(db: ReturnType<typeof fakeDb>, argv: string[], { answers = ['Cuenta Nueva', ' NUEVA@Ejemplo.test '], password = PASSWORD as string | undefined, resolved = config as any } = {}) {
  const lines: string[] = []; const connections: any[] = []; const asked: string[] = []; let passwordReads = 0; let hashed = 0;
  const code = await lib.run({
    argv, out: (line: string) => lines.push(line),
    resolveConfig: () => { if (resolved instanceof Error) throw resolved; return resolved; },
    connect: async (dest: any) => { connections.push(dest); return db; },
    ask: async (question: string) => { asked.push(question); return answers[asked.length - 1] ?? ''; },
    readPassword: () => { passwordReads++; return password; },
    hash: async (value: string) => { hashed++; assert.equal(value, PASSWORD); return HASH; },
  });
  const text = lines.join('\n');
  for (const secret of [SECRET, PASSWORD, HASH, 'usuario_ficticio']) assert.ok(!text.includes(secret), 'la salida no muestra contraseñas, hashes ni credenciales');
  return { code, text, connections, asked, passwordReads, hashed };
}

test('parseArgs: solo --destino, --servidor, --operador y --motivo, completos y sin repetir', () => {
  assert.deepEqual(lib.parseArgs(ARGS), { destino: DEST, servidor: UUID, operador: 'ops-01', motivo: 'Recuperación de acceso autorizada' });
  assert.throws(() => lib.parseArgs(['--servidor']), /Opción no reconocida/);
  assert.throws(() => lib.parseArgs(['--servidor=' + UUID, '--servidor=' + OTHER_UUID]), /Opción repetida/);
  for (const bad of [['--apply'], ['--destino'], ['--rol=GERENTE_GENERAL'], ['--email=a@b.test'], ['x']]) assert.throws(() => lib.parseArgs(bad), /Opción no reconocida/);
  assert.throws(() => lib.parseArgs(['--operador=a1', '--operador=b2']), /Opción repetida/);
});

test('crea la cuenta activa, SIN ROL, con el hash y su auditoría en la misma transacción', async () => {
  const db = fakeDb();
  const { code, text, connections, passwordReads, hashed } = await execute(db, ARGS);
  assert.equal(code, 0, text);
  assert.deepEqual(connections, [{ host: 'db.test', port: 3306, database: 'horus_prueba' }]);
  assert.equal(passwordReads, 1); assert.equal(hashed, 1);
  assert.deepEqual(db.users.map(({ nombre, email, password, activo, rol, session_version }) => ({ nombre, email, password, activo, rol, session_version })),
    [{ nombre: 'Cuenta Nueva', email: 'nueva@ejemplo.test', password: HASH, activo: 1, rol: null, session_version: 1 }]);
  assert.deepEqual(db.audits, [{ operador: 'ops-01', cuenta_id: 1, motivo: 'Recuperación de acceso autorizada' }]);
  assert.deepEqual(db.log.filter(entry => /^(BEGIN|INSERT|COMMIT)/.test(entry)), ['BEGIN', 'INSERT INTO admin_users', 'INSERT INTO admin_auditoria', 'COMMIT']);
  assert.match(text, /Administrador creado: id 1 \(nu\*\*\*@ejemplo\.test\), activo y SIN ROL\. Auditoría registrada \(id 1\)/);
  assert.match(text, new RegExp('Servidor conectado: base=horus_prueba \\| server_uuid=' + UUID));
  assert.ok(!text.includes('nueva@ejemplo.test'), 'el correo se enmascara');
  assert.ok(db.ended);
  assert.ok(db.log.indexOf('SELECT @@server_uuid AS') < db.log.indexOf('BEGIN'), 'la identidad se comprueba antes de escribir');
});

test('--servidor admite mayúsculas y espacios alrededor (se normaliza como en admin:assign-role)', async () => {
  const db = fakeDb();
  const { code, text } = await execute(db, ['--destino=' + DEST, '--servidor= ' + UUID.toUpperCase() + ' ', ...ARGS.slice(2)]);
  assert.equal(code, 0, text);
  assert.equal(db.users.length, 1);
});

test('recuperación sin ningún gerente activo: crea la cuenta sin rol y no toca las existentes', async () => {
  const inactive: User = { id: 1, nombre: 'Gerente Desactivado', email: 'gerente@ejemplo.test', password: HASH, activo: 0, session_version: 3, rol: null };
  const sinRol: User = { id: 2, nombre: 'Otra Cuenta', email: 'otra@ejemplo.test', password: HASH, activo: 1, session_version: 1, rol: null };
  const db = fakeDb([inactive, sinRol]);
  const { code, text } = await execute(db, ARGS, { answers: ['Cuenta Recuperación', 'recuperacion@ejemplo.test'] });
  assert.equal(code, 0, text);
  assert.deepEqual(db.users.slice(0, 2), [inactive, sinRol]);
  assert.deepEqual([db.users[2].email, db.users[2].activo, db.users[2].rol], ['recuperacion@ejemplo.test', 1, null]);
  assert.deepEqual(db.audits, [{ operador: 'ops-01', cuenta_id: 3, motivo: 'Recuperación de acceso autorizada' }]);
  assert.match(text, /usa admin:assign-role/);
});

test('servidor distinto o sin server_uuid: se detiene tras identificarlo, sin calcular el hash ni escribir', async () => {
  const cases: [any, RegExp][] = [
    [{ uuid: OTHER_UUID }, /no coincide con --servidor/],
    [{ uuid: null }, /No se pudo determinar la identidad del servidor/],
    [{ uuid: 'no-es-un-uuid' }, /No se pudo determinar la identidad del servidor/],
    [{ uuidFails: true }, /No se pudo determinar la identidad del servidor/],
  ];
  for (const [options, message] of cases) {
    const db = fakeDb([], options);
    const { code, text, hashed } = await execute(db, ARGS);
    assert.equal(code, 1, JSON.stringify(options));
    assert.match(text, message);
    assert.match(text, /No se creó la cuenta/);
    assert.equal(hashed, 0);
    assert.ok(!db.log.some(entry => /^(BEGIN|INSERT|SELECT id FROM|SELECT COLUMN_NAME)/.test(entry)), 'ni siquiera consulta cuentas o esquema');
    assert.deepEqual([db.users, db.audits], [[], []]);
    assert.ok(db.ended);
  }
  const unavailable = await execute(fakeDb([], { uuid: null }), ARGS);
  assert.match(unavailable.text, /server_uuid=no disponible/);
});

test('no concede rol aunque el sistema no tenga ningún gerente, y lo comprueba tras insertar', async () => {
  const db = fakeDb([], { roleTrigger: true });
  const { code, text } = await execute(db, ARGS);
  assert.equal(code, 1);
  assert.match(text, /no quedó activa y sin rol/);
  assert.deepEqual([db.users, db.audits], [[], []]);
  assert.ok(db.log.includes('ROLLBACK') && !db.log.includes('COMMIT'));
});

test('destino, servidor, operador o motivo ausentes o inválidos se rechazan ANTES de preguntar y de conectarse', async () => {
  const S = '--servidor=' + UUID;
  const cases: [string[], RegExp][] = [
    [[], /--destino=<host>:<puerto>\/<base>/],
    [[S, '--operador=ops-01', '--motivo=Motivo suficiente'], /--destino/],
    [['--destino=db.test:3307/horus_prueba', S, '--operador=ops-01', '--motivo=Motivo suficiente'], /Destino configurado: db\.test:3306\/horus_prueba/],
    [['--destino=db.test/horus_prueba', S, '--operador=ops-01', '--motivo=Motivo suficiente'], /--destino/],
    [['--destino=' + DEST, '--operador=ops-01', '--motivo=Motivo suficiente'], /--servidor=<server_uuid>.*admin:assign-role -- --listar/],
    [['--destino=' + DEST, '--servidor=no-es-un-uuid', '--operador=ops-01', '--motivo=Motivo suficiente'], /server_uuid completo/],
    [['--destino=' + DEST, '--servidor=' + UUID.slice(0, -1), '--operador=ops-01', '--motivo=Motivo suficiente'], /server_uuid completo/],
    [['--destino=' + DEST, '--servidor=' + UUID + 'a', '--operador=ops-01', '--motivo=Motivo suficiente'], /server_uuid completo/],
    [['--destino=' + DEST, S, '--motivo=Motivo suficiente'], /--operador=<identificador>/],
    [['--destino=' + DEST, S, '--operador=persona@ejemplo.test', '--motivo=Motivo suficiente'], /--operador debe tener/],
    [['--destino=' + DEST, S, '--operador=ops-01'], /--motivo=<texto>/],
    [['--destino=' + DEST, S, '--operador=ops-01', '--motivo=avisar a persona@ejemplo.test'], /--motivo debe tener/],
    [['--apply', ...ARGS], /Opción no reconocida/],
  ];
  for (const [argv, message] of cases) {
    const db = fakeDb();
    const result = await execute(db, argv);
    assert.equal(result.code, 2, argv.join(' '));
    assert.match(result.text, message, argv.join(' '));
    assert.deepEqual([result.connections, result.asked, db.log], [[], [], []], argv.join(' '));
  }
  const unresolved = await execute(fakeDb(), ARGS, { resolved: new Error('Falta DB_PASS ' + SECRET) });
  assert.equal(unresolved.code, 2);
  assert.match(unresolved.text, /Configuración de conexión incompleta/);
  // Configuración de destino incorrecta (puerto, host o base inválidos): se rechaza sin conectarse, aunque --destino la repita.
  for (const resolved of [{ ...config, port: 0 }, { ...config, port: '3306' }, { ...config, host: '' }, { ...config, database: undefined }]) {
    const db = fakeDb();
    const label = String(resolved.host) + ':' + String(resolved.port) + '/' + String(resolved.database);
    const result = await execute(db, ['--destino=' + label, ...ARGS.slice(1)], { resolved });
    assert.equal(result.code, 2, label);
    assert.match(result.text, /Configuración de conexión incompleta o inválida/);
    assert.deepEqual([result.connections, result.asked, db.log], [[], [], []]);
  }
});

test('nombre, correo o contraseña inicial inválidos se rechazan sin conectarse; la contraseña se lee una sola vez', async () => {
  const cases: [any, RegExp][] = [
    [{ answers: ['A', 'nueva@ejemplo.test'] }, /nombre/],
    [{ answers: ['Cuenta Nueva', 'sin-arroba'] }, /Correo no válido/],
    [{ password: '' }, /ADMIN_INITIAL_PASSWORD/],
    [{ password: 'corta' }, /ADMIN_INITIAL_PASSWORD/],
    [{ password: 'ñ'.repeat(40) }, /ADMIN_INITIAL_PASSWORD/],
  ];
  for (const [options, message] of cases) {
    const result = await execute(fakeDb(), ARGS, options);
    assert.equal(result.code, 2);
    assert.match(result.text, message);
    assert.deepEqual(result.connections, []);
    assert.equal(result.passwordReads, 1);
    assert.equal(result.hashed, 0);
  }
});

test('correo duplicado (previo o simultáneo) no crea cuenta ni auditoría', async () => {
  const existing: User = { id: 1, nombre: 'Previa', email: 'nueva@ejemplo.test', password: HASH, activo: 1, session_version: 1, rol: null };
  const db = fakeDb([existing]);
  const before = await execute(db, ARGS);
  assert.equal(before.code, 1);
  assert.match(before.text, /Ya existe una cuenta con ese correo/);
  assert.equal(before.hashed, 0);
  assert.deepEqual([db.users.length, db.audits], [1, []]);
  const race = fakeDb([], { duplicateOnInsert: true });
  const raced = await execute(race, ARGS);
  assert.equal(raced.code, 1);
  assert.match(raced.text, /Ya existe una cuenta con ese correo/);
  assert.ok(race.log.includes('ROLLBACK') && !race.log.includes('COMMIT'));
});

test('si falla la auditoría no se crea la cuenta (rollback completo) y la conexión se cierra', async () => {
  const existing: User = { id: 1, nombre: 'Previa', email: 'previa@ejemplo.test', password: HASH, activo: 1, session_version: 1, rol: 'GERENTE_GENERAL' };
  const db = fakeDb([existing], { failAudit: true });
  await assert.rejects(execute(db, ARGS), /fallo simulado de auditoría/);
  assert.deepEqual([db.users, db.audits], [[existing], []], 'ni la cuenta nueva ni cambios en las existentes');
  assert.deepEqual(db.log.filter(entry => /^(BEGIN|INSERT|COMMIT|ROLLBACK)/.test(entry)), ['BEGIN', 'INSERT INTO admin_users', 'INSERT INTO admin_auditoria', 'ROLLBACK']);
  assert.ok(db.ended);
});

test('sin migraciones requeridas o con otra base conectada se detiene antes de escribir', async () => {
  const cases: [any, RegExp][] = [
    [{ auditColumns: [] }, /no tiene la tabla admin_auditoria.*20261014-admin-auditoria/],
    [{ auditColumns: AUDIT_COLUMNS.filter(column => column !== 'motivo') }, /incompleta.*20261014-admin-auditoria/],
    [{ hasRol: false }, /20261014-admin-rol/],
    [{ base: 'otra_base' }, /no coincide con la configurada/],
  ];
  for (const [options, message] of cases) {
    const db = fakeDb([], options);
    const { code, text, hashed } = await execute(db, ARGS);
    assert.equal(code, 1, JSON.stringify(options));
    assert.match(text, message);
    assert.equal(hashed, 0);
    assert.ok(!db.log.some(entry => /^(BEGIN|INSERT)/.test(entry)));
    assert.ok(db.ended);
  }
});

test('dependencies(): conecta con el destino validado y retira la contraseña inicial del entorno tras leerla', async () => {
  const calls: any[] = [];
  const deps = main.dependencies({ options: () => config, connect: (extra: any) => { calls.push(extra); return 'conexion'; } }, { hash: async (value: string, cost: number) => value.length + ':' + cost });
  assert.equal(deps.connect({ host: 'db.test', port: 3306, database: 'horus_prueba' }), 'conexion');
  assert.deepEqual(calls, [{ host: 'db.test', port: 3306, database: 'horus_prueba' }]);
  process.env.ADMIN_INITIAL_PASSWORD = PASSWORD;
  assert.equal(deps.readPassword(), PASSWORD);
  assert.equal(process.env.ADMIN_INITIAL_PASSWORD, undefined);
  assert.equal(await deps.hash('abc'), '3:12', 'bcrypt con coste 12');
});

test('el script no se ejecuta al importarlo y la biblioteca no imprime contraseñas ni contiene sentencias destructivas', () => {
  assert.match(readFileSync(join(__dirname, '..', 'scripts', 'create-admin.cjs'), 'utf8'), /require\.main === module/);
  const library = readFileSync(join(__dirname, '..', 'scripts', 'create-admin-lib.cjs'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\b(DELETE|DROP|ALTER|TRUNCATE|UPDATE)\b/i.test(library));
  assert.ok(!/out\([^)]*(password|passwordHash)/i.test(library), 'la salida no recibe la contraseña ni su hash');
  assert.ok(!/GERENTE_GENERAL|COORDINADORA_INSTITUCIONAL|SECRETARIA/.test(library), 'no asigna ningún rol');
});
