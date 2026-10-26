// Lógica de `admin:create` (H-BACK-01, E3.2). Sin acceso directo a MySQL, a la terminal ni a variables de entorno: la configuración
// resuelta, la conexión, las preguntas, la contraseña inicial y el hash se inyectan, de modo que las pruebas los simulan.
//
// Principios: la cuenta nueva queda SIN ROL (rol = NULL), nunca GERENTE_GENERAL ni ningún otro; el alta y su registro en admin_auditoria
// (origen 'terminal', operador declarado y motivo) se confirman juntos o no se confirma nada; nunca se imprime la contraseña, su hash
// ni credenciales de conexión. Para escribir hay que confirmar el destino configurado (--destino=<host>:<puerto>/<base>), que se
// resuelve una sola vez y es el que se usa para conectar, y la identidad del servidor (--servidor=<server_uuid>, la que muestra
// `admin:assign-role -- --listar`); tras conectar, DATABASE() debe ser esa base y @@server_uuid ese valor, con las mismas comprobaciones
// que admin:assign-role (assign-role-lib.cjs), todas antes de escribir.
// Es también la vía de recuperación de acceso (docs/procedimientos/roles-administrativos.md): crea una cuenta sin rol a la que después
// se asigna GERENTE_GENERAL con admin:assign-role. No exige que exista otra cuenta ni un gerente, para no bloquear esa recuperación.
const { AssignRoleError, destination, identify, describeServer, confirmedServer, serverProblem, SERVER_FORMAT } = require('./assign-role-lib.cjs');
const { declaredOperator, declaredReason, auditMissing } = require('./admin-audit-lib.cjs');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USAGE = [
  'Uso: ADMIN_INITIAL_PASSWORD=<temporal> npm run admin:create -- --destino=<host>:<puerto>/<base> --servidor=<server_uuid> --operador=<identificador> --motivo=<texto>',
  'Pide nombre y correo. La cuenta se crea activa y SIN ROL; el rol se asigna después con admin:assign-role.',
  'El destino y el server_uuid se muestran con: npm run admin:assign-role -- --listar (solo lectura).',
  '--operador es una identificación DECLARADA, no una autenticación; operador y motivo quedan en admin_auditoria.',
].join('\n');

class CreateAdminError extends Error {}
const fail = message => { throw new CreateAdminError(message); };
const maskEmail = email => { const [local = '', domain = ''] = String(email).split('@'); return local.slice(0, 2) + '***@' + domain; };

function parseArgs(argv) {
  const valued = { '--destino': 'destino', '--servidor': 'servidor', '--operador': 'operador', '--motivo': 'motivo' };
  const options = {}, seen = new Set();
  for (const arg of argv) {
    const [flag, ...rest] = String(arg).split('=');
    if (seen.has(flag)) fail('Opción repetida: ' + flag + '. Indica cada opción una sola vez.');
    if (!Object.hasOwn(valued, flag) || !rest.length) fail('Opción no reconocida o incompleta: ' + flag + '.\n' + USAGE);
    options[valued[flag]] = rest.join('=');
    seen.add(flag);
  }
  return options;
}

function validateAccount({ nombre, email, password }) {
  const name = String(nombre ?? '').trim(), mail = String(email ?? '').trim().toLowerCase();
  if (name.length < 2 || name.length > 100) fail('El nombre debe tener entre 2 y 100 caracteres. No se creó la cuenta.');
  if (!EMAIL.test(mail) || mail.length > 254) fail('Correo no válido. No se creó la cuenta.');
  if (!password || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) fail('ADMIN_INITIAL_PASSWORD falta o no es válida (8 caracteres o más, hasta 72 bytes). No se creó la cuenta.');
  return { nombre: name, email: mail };
}

const isDuplicate = error => error?.errno === 1062 || error?.code === 'ER_DUP_ENTRY';

// Devuelve el código de salida: 2 = datos u opciones rechazados antes de conectar; 1 = rechazado tras conectar, sin cambios; 0 = creada.
// readPassword() entrega la contraseña inicial UNA vez (el script real la retira del entorno); ask(pregunta) devuelve la respuesta.
async function run({ argv, resolveConfig, connect, ask, readPassword, hash, out }) {
  let options, dest, account, password;
  try {
    password = readPassword();
    options = parseArgs(argv);
    let config;
    try { config = resolveConfig(); } catch { fail('Configuración de conexión incompleta (revisa DB_HOST, DB_PORT, DB_NAME, DB_USER y DB_PASS).'); }
    try { dest = destination(config); } catch (error) { if (error instanceof AssignRoleError) fail(error.message); throw error; }
    if (options.destino !== dest.label) fail('Confirma el destino exacto con --destino=<host>:<puerto>/<base>. Destino configurado: ' + dest.label + '.\n' + USAGE);
    if (!options.servidor) fail('Confirma la identidad del servidor con --servidor=<server_uuid> (se muestra con npm run admin:assign-role -- --listar).\n' + USAGE);
    options.servidor = confirmedServer(options.servidor) ?? fail(SERVER_FORMAT);
    const operador = declaredOperator(options.operador), motivo = declaredReason(options.motivo);
    if (!operador.ok) fail(operador.message);
    if (!motivo.ok) fail(motivo.message);
    options.operador = operador.value; options.motivo = motivo.value;
    out('Destino configurado: ' + dest.label);
    account = validateAccount({ nombre: await ask('Nombre del administrador: '), email: await ask('Correo del administrador: '), password });
  } catch (error) {
    if (!(error instanceof CreateAdminError)) throw error;
    out(error.message);
    return 2;
  }

  const db = await connect({ host: dest.host, port: dest.port, database: dest.database });
  try {
    const server = await identify(db);
    out(describeServer(server));
    const problem = serverProblem(server, dest, options.servidor);
    if (problem) fail(problem + ' No se creó la cuenta.');
    const [columns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'rol'");
    if (!columns.length) fail('La base no tiene la columna admin_users.rol. Respalda y aplica antes la migración 20261014-admin-rol (npm run db:migrate). No se creó la cuenta.');
    const auditProblem = await auditMissing(db);
    if (auditProblem) fail(auditProblem + ' No se creó la cuenta.');
    const [existing] = await db.query('SELECT id FROM admin_users WHERE email = ?', [account.email]);
    if (existing.length) fail('Ya existe una cuenta con ese correo. No se creó la cuenta.');

    const passwordHash = await hash(password);
    password = undefined;
    await db.beginTransaction();
    try {
      const now = new Date();
      const [created] = await db.query(
        'INSERT INTO admin_users (nombre, email, password, activo, session_version, rol, createdAt, updatedAt) VALUES (?, ?, ?, 1, 1, NULL, ?, ?)',
        [account.nombre, account.email, passwordHash, now, now],
      );
      const id = Number(created.insertId);
      // Defensa: la cuenta nueva no puede tener rol (ni por un valor predeterminado ni por un trigger).
      const [[row]] = await db.query('SELECT rol, activo FROM admin_users WHERE id = ?', [id]);
      if (!row || row.rol !== null || Number(row.activo) !== 1) fail('Comprobación final fallida: la cuenta nueva no quedó activa y sin rol. No se creó la cuenta.');
      const [audit] = await db.query(
        "INSERT INTO admin_auditoria (origen, actor_id, operador, cuenta_id, operacion, rol_anterior, rol_nuevo, activo_anterior, activo_nuevo, resultado, motivo) VALUES ('terminal', NULL, ?, ?, 'cuenta_creada', NULL, NULL, NULL, 1, 'aplicado', ?)",
        [options.operador, id, options.motivo],
      );
      if (Number(audit.affectedRows) !== 1) fail('No se pudo registrar la auditoría. No se creó la cuenta.');
      await db.commit();
      out('Administrador creado: id ' + id + ' (' + maskEmail(account.email) + '), activo y SIN ROL. Auditoría registrada (id ' + audit.insertId + ').');
      out('Para concederle permisos, usa admin:assign-role (simulación primero).');
      return 0;
    } catch (error) {
      try { await db.rollback(); } catch { /* la conexión se cierra a continuación */ }
      if (isDuplicate(error)) fail('Ya existe una cuenta con ese correo. No se creó la cuenta.');
      throw error;
    }
  } catch (error) {
    if (!(error instanceof CreateAdminError)) throw error;
    out(error.message);
    return 1;
  } finally {
    await db.end();
  }
}

module.exports = { CreateAdminError, parseArgs, validateAccount, run, USAGE };
