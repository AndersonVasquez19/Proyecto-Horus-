// Lógica de `admin:assign-role`. Sin acceso directo a MySQL ni a variables de entorno: la configuración ya resuelta y la conexión se inyectan,
// de modo que las pruebas las simulan y el script real le pasa las de database.cjs.
//
// Principios: simulación por defecto; solo cambia datos con --apply y confirmaciones explícitas; nunca lee ni imprime contraseñas;
// siempre deja al menos un GERENTE_GENERAL activo; no toca el comportamiento de autenticación (el rol aún no lo consulta nada).
//
// Destino (hallazgo A-1): la configuración se resuelve UNA vez, antes de validar, y la conexión se abre con esos mismos host, puerto y base.
// Tras conectar se comprueba la base real (DATABASE()) y la identidad del servidor (@@server_uuid). Para escribir hay que confirmar
// el destino configurado (--destino=<host>:<puerto>/<base>) y la identidad del servidor conectado (--servidor=<server_uuid>).
// El hostname y el puerto que informa MySQL pueden diferir legítimamente de los configurados (Docker, proxy, DNS): se muestran, pero no
// se usan como prueba de identidad.

// Debe coincidir con ADMIN_ROLES de src/permissions/roles.ts y con el enum AdminRol de schema.prisma (lo comprueba una prueba).
const ROLES = ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL', 'SECRETARIA'];
const GERENTE = 'GERENTE_GENERAL';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCK = 'horus_admin_roles';
const { declaredOperator, declaredReason, auditMissing, AUDIT_MIGRATION } = require('./admin-audit-lib.cjs');

const USAGE = [
  'Uso (por defecto SOLO simula; no escribe nada):',
  '  npm run admin:assign-role -- --listar',
  '  npm run admin:assign-role -- --email=<correo> --rol=<ROL>',
  '  npm run admin:assign-role -- --email=<correo> --rol=<ROL> --apply --confirmar=<correo> --destino=<host>:<puerto>/<base> --servidor=<server_uuid> --operador=<identificador> --motivo=<texto>',
  'Opciones: --permitir-otro-gerente (necesaria para dar GERENTE_GENERAL cuando ya existe otro gerente activo).',
  '--operador y --motivo quedan en la auditoría (admin_auditoria). --operador es una identificación DECLARADA, no una autenticación.',
  'Roles: ' + ROLES.join(', ') + '.',
].join('\n');

class AssignRoleError extends Error {}
const fail = message => { throw new AssignRoleError(message); };

function parseArgs(argv) {
  const options = { listar: false, apply: false, permitirOtroGerente: false };
  const known = { '--listar': 'listar', '--apply': 'apply', '--permitir-otro-gerente': 'permitirOtroGerente' };
  const valued = { '--email': 'email', '--rol': 'rol', '--confirmar': 'confirmar', '--destino': 'destino', '--servidor': 'servidor', '--operador': 'operador', '--motivo': 'motivo' };
  const seen = new Set();
  for (const arg of argv) {
    const [flag, ...rest] = String(arg).split('=');
    if (seen.has(flag)) fail('Opción repetida: ' + flag + '. Indica cada opción una sola vez.');
    if (Object.hasOwn(known, flag) && !rest.length) options[known[flag]] = true;
    else if (Object.hasOwn(valued, flag) && rest.length) options[valued[flag]] = rest.join('=');
    else fail('Opción no reconocida o incompleta: ' + flag + '.\n' + USAGE);
    seen.add(flag);
  }
  return options;
}

// Correo enmascarado para listados: nunca se imprimen direcciones completas de otras personas.
function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@');
  return local.slice(0, 2) + '***@' + domain;
}

const normalizeEmail = value => String(value ?? '').trim().toLowerCase();
const activeManagers = accounts => accounts.filter(account => account.activo && account.rol === GERENTE);

// Función pura: decide si la asignación es válida con el estado actual de las cuentas.
function planAssignment(accounts, { email, rol, permitirOtroGerente = false }) {
  const wanted = normalizeEmail(email);
  if (!ROLES.includes(rol)) fail('Rol no válido. Usa uno de: ' + ROLES.join(', ') + '.');
  if (!EMAIL.test(wanted) || wanted.length > 254) fail('Correo no válido.');
  const target = accounts.find(account => normalizeEmail(account.email) === wanted);
  if (!target) fail('No existe una cuenta con ese correo.');
  if (!target.activo) fail('La cuenta está desactivada: actívala antes de asignarle un rol.');
  const before = activeManagers(accounts).length;
  const after = activeManagers(accounts.map(account => account.id === target.id ? { ...account, rol } : account)).length;
  const plan = {
    target: { id: target.id, nombre: target.nombre, email: wanted },
    previous: target.rol ?? null, next: rol, managersBefore: before, managersAfter: after,
    unchanged: (target.rol ?? null) === rol,
    // Toda asignación o cambio de rol (también la primera) cierra las sesiones abiertas de esa cuenta: debe volver a iniciar sesión.
    revokeSessions: true,
  };
  if (plan.unchanged) return plan;
  if (after < 1) fail('La operación dejaría al sistema sin ningún GERENTE_GENERAL activo. Asigna primero ese rol a una cuenta activa.');
  if (rol === GERENTE && before >= 1 && !permitirOtroGerente) {
    fail('Ya existe un GERENTE_GENERAL activo. Para dar ese rol a otra cuenta añade --permitir-otro-gerente de forma deliberada.');
  }
  return plan;
}

const describe = plan => [
  'Cuenta: id ' + plan.target.id + ' (' + plan.target.nombre + ', ' + maskEmail(plan.target.email) + ')',
  'Rol actual: ' + (plan.previous ?? 'sin rol') + '  ->  rol nuevo: ' + plan.next,
  'Gerentes generales activos: ' + plan.managersBefore + ' -> ' + plan.managersAfter,
  plan.unchanged ? 'No hay cambios que aplicar.' : 'Se cerrarán las sesiones abiertas de esa cuenta: tendrá que iniciar sesión de nuevo.',
].join('\n');

// Solo host, puerto y base de la configuración ya resuelta: nunca usuario ni contraseña.
function destination(config) {
  if (!config || typeof config.host !== 'string' || !config.host || !Number.isSafeInteger(config.port) || config.port <= 0 || typeof config.database !== 'string' || !config.database) {
    fail('Configuración de conexión incompleta o inválida (DB_HOST, DB_PORT, DB_NAME).');
  }
  return { host: config.host, port: config.port, database: config.database, label: config.host + ':' + config.port + '/' + config.database };
}

// Identidad informada por el servidor de ESTA conexión. Si no se puede obtener @@server_uuid, la identidad queda indeterminada.
async function identify(db) {
  const [[row]] = await db.query('SELECT DATABASE() AS base, @@hostname AS hostname, @@port AS puerto');
  let uuid = null;
  try {
    const [[server]] = await db.query('SELECT @@server_uuid AS uuid');
    uuid = typeof server?.uuid === 'string' && UUID.test(server.uuid.toLowerCase()) ? server.uuid.toLowerCase() : null;
  } catch { uuid = null; }
  return { base: row?.base ?? null, hostname: row?.hostname ?? null, port: row?.puerto ?? null, uuid };
}

// Comprobaciones de identidad compartidas con admin:create. --servidor confirmado, normalizado; null si falta o no tiene el formato.
const SERVER_FORMAT = '--servidor debe ser el server_uuid completo del servidor (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).';
const confirmedServer = value => { const uuid = String(value ?? '').trim().toLowerCase(); return UUID.test(uuid) ? uuid : null; };
const describeServer = server => 'Servidor conectado: base=' + server.base + ' | server_uuid=' + (server.uuid ?? 'no disponible') +
  ' | hostname informado=' + server.hostname + ' | puerto informado=' + server.port;
// Devuelve null si la conexión es la confirmada, o el motivo para no seguir. Sin `expectedUuid` solo comprueba la base (lectura).
function serverProblem(server, dest, expectedUuid) {
  if (server.base !== dest.database) return 'La base conectada (' + server.base + ') no coincide con la configurada (' + dest.database + '). No se hizo nada.';
  if (expectedUuid === undefined) return null;
  if (!server.uuid) return 'No se pudo determinar la identidad del servidor (server_uuid). Por seguridad no se escribe nada.';
  if (server.uuid !== expectedUuid) return 'La identidad del servidor conectado no coincide con --servidor. No se escribió nada.';
  return null;
}

async function loadAccounts(db, forUpdate = false) {
  const [rows] = await db.query('SELECT id, nombre, email, activo, rol FROM admin_users ORDER BY id' + (forUpdate ? ' FOR UPDATE' : ''));
  return rows.map(row => ({ id: Number(row.id), nombre: String(row.nombre), email: String(row.email), activo: Boolean(row.activo), rol: row.rol ?? null }));
}

// Devuelve el código de salida. `out` recibe solo texto operativo (sin contraseñas, hashes, tokens ni credenciales de conexión).
// resolveConfig(): configuración de conexión ya resuelta (incluidos los .env). connect(dest): conexión dedicada a ESE host, puerto y base.
async function run({ argv, resolveConfig, connect, out }) {
  let options, dest;
  try {
    options = parseArgs(argv);
    if (options.listar === !!(options.email || options.rol)) fail('Indica --listar, o bien --email y --rol.\n' + USAGE);
    if (options.listar && (options.apply || options.permitirOtroGerente)) fail('--listar es solo de lectura y no admite --apply ni --permitir-otro-gerente.');
    if (!options.listar && (!options.email || !options.rol)) fail('Faltan --email o --rol.\n' + USAGE);
    if (!options.apply && (options.confirmar || options.destino || options.servidor || options.operador || options.motivo)) fail('--confirmar, --destino, --servidor, --operador y --motivo solo se usan junto con --apply.');
    // Una sola resolución, antes de cualquier validación: lo que se confirma es lo que se usa para conectar.
    let config;
    try { config = resolveConfig(); } catch { fail('Configuración de conexión incompleta (revisa DB_HOST, DB_PORT, DB_NAME, DB_USER y DB_PASS).'); }
    dest = destination(config);
    if (options.apply) {
      if (!options.confirmar || normalizeEmail(options.confirmar) !== normalizeEmail(options.email)) fail('Para aplicar, repite el correo exacto con --confirmar=<correo>.');
      if (options.destino !== dest.label) fail('Para aplicar, confirma el destino exacto con --destino=<host>:<puerto>/<base>. Destino configurado: ' + dest.label + '.');
      if (!options.servidor) fail('Para aplicar, confirma la identidad del servidor con --servidor=<server_uuid> (se muestra con --listar o en la simulación).');
      options.servidor = confirmedServer(options.servidor) ?? fail(SERVER_FORMAT);
      const operador = declaredOperator(options.operador), motivo = declaredReason(options.motivo);
      if (!operador.ok) fail(operador.message);
      if (!motivo.ok) fail(motivo.message);
      options.operador = operador.value; options.motivo = motivo.value;
    }
  } catch (error) {
    if (!(error instanceof AssignRoleError)) throw error;
    out(error.message);
    return 2;
  }

  const db = await connect({ host: dest.host, port: dest.port, database: dest.database });
  let locked = false;
  try {
    out('Destino configurado: ' + dest.label + (options.apply ? '  (MODO APLICAR)' : '  (solo lectura)'));
    const server = await identify(db);
    out(describeServer(server));
    out('(El hostname y el puerto informados pueden diferir de los configurados por Docker, proxies o DNS; la identidad se confirma con server_uuid.)');
    const problem = serverProblem(server, dest, options.apply ? options.servidor : undefined);
    if (problem) fail(problem);

    const [columns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'rol'");
    if (!columns.length) fail('La base no tiene la columna admin_users.rol. Respalda y aplica antes la migración 20261014-admin-rol (npm run db:migrate).');
    // Sin la tabla de auditoría (M-4) no se puede registrar el cambio: la simulación y la aplicación se detienen antes de bloquear nada.
    const auditProblem = await auditMissing(db);

    const confirmation = ' --destino=' + dest.label + ' --servidor=' + (server.uuid ?? '<no disponible>');
    if (options.listar) {
      const accounts = await loadAccounts(db);
      for (const account of accounts) out('id ' + account.id + ' | ' + maskEmail(account.email) + ' | ' + (account.activo ? 'activa' : 'inactiva') + ' | ' + (account.rol ?? 'sin rol'));
      out('Cuentas: ' + accounts.length + '. Gerentes generales activos: ' + activeManagers(accounts).length + '.');
      if (auditProblem) out('AVISO: ' + auditProblem + ' Hasta entonces no se puede asignar ningún rol.');
      out('Confirmación de destino para --apply (compruébela con la identidad conocida del servidor):' + confirmation);
      return 0;
    }

    if (auditProblem) fail(auditProblem + ' No se hizo nada.');

    const input = { email: options.email, rol: options.rol, permitirOtroGerente: options.permitirOtroGerente };
    if (!options.apply) {
      const plan = planAssignment(await loadAccounts(db), input);
      out(describe(plan));
      out(plan.unchanged ? 'Sin cambios: la cuenta ya tiene ese rol.' : 'SIMULACIÓN: no se escribió nada. Para aplicar añade --apply --confirmar=<correo>' + confirmation + ' --operador=<identificador> --motivo=<texto>');
      return 0;
    }
    out('Operador declarado: ' + options.operador + ' | Motivo: ' + options.motivo + '  (quedan en admin_auditoria; el operador no está autenticado)');

    const [[lock]] = await db.query("SELECT GET_LOCK('" + LOCK + "', 10) AS acquired");
    if (Number(lock.acquired) !== 1) fail('Otra asignación de roles está en curso.');
    locked = true;
    await db.beginTransaction();
    try {
      // Se recalcula con las filas bloqueadas: lo que se aplica es lo que se validó, aunque la base haya cambiado desde la simulación.
      const accounts = await loadAccounts(db, true);
      const plan = planAssignment(accounts, input);
      out(describe(plan));
      if (plan.unchanged) { await db.rollback(); out('Sin cambios: la cuenta ya tiene ese rol.'); return 0; }
      const [result] = await db.query(
        'UPDATE admin_users SET rol = ?, session_version = session_version + ?, updatedAt = ? WHERE id = ? AND activo = 1 AND rol <=> ?',
        [plan.next, 1, new Date(), plan.target.id, plan.previous],
      );
      if (Number(result.affectedRows) !== 1) fail('La cuenta cambió mientras se aplicaba. No se escribió nada; vuelve a simular.');
      const finalManagers = activeManagers(await loadAccounts(db)).length;
      if (finalManagers < 1) fail('Comprobación final fallida: no quedaría ningún GERENTE_GENERAL activo. No se escribió nada.');
      // Auditoría (M-4) en la MISMA transacción: si el registro falla, también se revierten el rol y session_version.
      const [audit] = await db.query(
        "INSERT INTO admin_auditoria (origen, actor_id, operador, cuenta_id, operacion, rol_anterior, rol_nuevo, activo_anterior, activo_nuevo, resultado, motivo) VALUES ('terminal', NULL, ?, ?, 'rol_asignado', ?, ?, 1, 1, 'aplicado', ?)",
        [options.operador, plan.target.id, plan.previous, plan.next, options.motivo],
      );
      if (Number(audit.affectedRows) !== 1) fail('No se pudo registrar la auditoría. No se escribió nada.');
      await db.commit();
      out('Rol asignado: cuenta id ' + plan.target.id + ' -> ' + plan.next + '. Gerentes generales activos: ' + finalManagers + '. Auditoría registrada (id ' + audit.insertId + ').');
      return 0;
    } catch (error) {
      try { await db.rollback(); } catch { /* la conexión se cierra a continuación */ }
      throw error;
    }
  } catch (error) {
    if (!(error instanceof AssignRoleError)) throw error;
    out(error.message);
    return 1;
  } finally {
    try { if (locked) await db.query("SELECT RELEASE_LOCK('" + LOCK + "')"); }
    finally { await db.end(); }
  }
}

module.exports = { ROLES, AssignRoleError, parseArgs, maskEmail, planAssignment, destination, identify, describeServer, confirmedServer, serverProblem, SERVER_FORMAT, run, USAGE };
