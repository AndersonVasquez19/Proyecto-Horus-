'use strict';
// FASE C.4 - Logica pura (sin red, sin secretos) para conceder los 27 GRANT por tabla a horus_app.
// La conexion se inyecta: en produccion la aporta aiven-grants-horus-app-cli.cjs; en las pruebas, un doble.
// Fuente de la matriz: docs/procedimientos/aiven-mysql-preparacion-segura.md (27 GRANT por tabla).

const SERVICE = Object.freeze({
  host: 'mysql-1b22a7e2-horus-group-dev.d.aivencloud.com',
  port: 28816,
  serviceId: 'mysql-1b22a7e2',
  schema: 'horus_db',
  admin: 'avnadmin',
  app: 'horus_app'
});

const CRUD = Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
const SIU = Object.freeze(['SELECT', 'INSERT', 'UPDATE']);
const SI = Object.freeze(['SELECT', 'INSERT']);
const SID = Object.freeze(['SELECT', 'INSERT', 'DELETE']);
const S = Object.freeze(['SELECT']);

// Orden identico al documento. Exactamente 27 entradas.
const GRANT_MATRIX = Object.freeze([
  ['admin_items', CRUD], ['servicios', CRUD], ['contactos', CRUD], ['galeria_items', CRUD],
  ['rate_limit_buckets', CRUD], ['convenios', CRUD], ['convenio_fotos', CRUD],
  ['chatbot_preguntas_sin_respuesta', CRUD],
  ['admin_users', SIU], ['cursos', SIU], ['preguntas_frecuentes', SIU], ['cotizaciones', SIU],
  ['newsletter_subscribers', SIU], ['empresa_settings', SIU], ['attention_records', SIU],
  ['estudiantes', SIU], ['convocatorias', SIU], ['matriculas', SIU], ['preinscripciones', SIU],
  ['admin_auditoria', SI], ['reclamaciones', SI], ['importaciones_academicas', SI],
  ['academico_historial', SI], ['preinscripciones_historial', SI],
  ['convocatoria_horarios', SID], ['chatbot_interacciones', SID],
  ['certificados', S]
].map(([tabla, privilegios]) => Object.freeze({ tabla, privilegios })));

// Tablas del esquema sin ningun acceso para la API.
const EXCLUDED_TABLES = Object.freeze(['horus_migrations', 'docentes', 'docente_asignaciones']);
const EXPECTED_TABLES = Object.freeze([...GRANT_MATRIX.map(g => g.tabla), ...EXCLUDED_TABLES]);
const DENIED_ERRNOS = Object.freeze([1044, 1045, 1142, 1143, 1227]);

class StopError extends Error {
  constructor(phase, message, code) {
    super(message);
    this.name = 'StopError';
    this.phase = phase;
    this.safeMessage = message; // Texto propio y fijo: nunca contiene SQL, secretos ni mensajes del servidor.
    this.code = code || '';
  }
}

// Solo un identificador tecnico (ER_*, ECONNREFUSED...); jamas texto libre del servidor.
function safeCode(error) {
  const value = error && typeof error.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{1,60}$/.test(value) ? value : '';
}

function validateHostSql(host) {
  if (typeof host !== 'string' || !/^[A-Za-z0-9._%-]{1,255}$/.test(host)) {
    throw new StopError('host-app', 'El host de horus_app no es valido o falta (marcador sin sustituir).');
  }
  return host;
}

function grantStatement(entry, host) {
  return 'GRANT ' + entry.privilegios.join(', ') + ' ON `' + SERVICE.schema + '`.`' + entry.tabla + '` TO \'' +
    SERVICE.app + '\'@\'' + validateHostSql(host) + '\'';
}

function buildStatements(host) {
  return GRANT_MATRIX.map(entry => grantStatement(entry, host));
}

const SAFE_STATEMENT = new RegExp(
  '^GRANT (SELECT|SELECT, INSERT|SELECT, INSERT, UPDATE|SELECT, INSERT, DELETE|SELECT, INSERT, UPDATE, DELETE) ' +
  'ON `horus_db`\\.`([a-z_]+)` TO \'horus_app\'@\'[A-Za-z0-9._%-]{1,255}\'$');

// Defensa en profundidad: cada sentencia se vuelve a validar justo antes de ejecutarse.
function assertSafeStatement(statement, index, host) {
  const match = SAFE_STATEMENT.exec(statement);
  const entry = GRANT_MATRIX[index];
  if (!match || !entry || match[2] !== entry.tabla || statement !== grantStatement(entry, host) ||
      EXCLUDED_TABLES.includes(match[2])) {
    throw new StopError('validacion-sentencia', 'Una sentencia no coincide con la matriz aprobada; no se ejecuta.');
  }
}

// --- Analizador de SHOW GRANTS (MySQL 8.4) ---------------------------------------------------------
// Reconoce SOLO formatos legitimos conocidos y falla cerrado ante cualquier otro (nunca "permiso seguro"):
//   1. GRANT <privs> ON [TABLE|FUNCTION|PROCEDURE] <ambito>.<objeto> TO <cuentas> [WITH GRANT OPTION] [AS ...]
//   2. REVOKE <privs> ON <ambito>.<objeto> FROM <cuentas>   (revocaciones parciales, p. ej. avnadmin sobre `mysql`)
//   3. GRANT <roles> TO <cuentas> [WITH ADMIN OPTION]       (concesion de roles)
//   4. GRANT PROXY ON <cuenta> TO <cuentas> [WITH GRANT OPTION]
// Identificadores entre backticks o, con ANSI_QUOTES, entre comillas dobles; cuentas tambien con comillas simples.
const Q_BT = '`(?:[^`]|``)+`';
const Q_DQ = '"(?:[^"]|"")+"';
const Q_SQ = '\'(?:[^\']|\'\')*\'';
const IDENT_RE = '(?:\\*|' + Q_BT + '|' + Q_DQ + ')';
const NAME_RE = '(?:' + Q_BT + '|' + Q_DQ + '|' + Q_SQ + ')';
const ACCOUNT_RE = NAME_RE + '(?:@' + NAME_RE + ')?';
const ACCOUNT_LIST_RE = ACCOUNT_RE + '(?:, ' + ACCOUNT_RE + ')*';
const COLUMN_RE = '(?:' + Q_BT + '|' + Q_DQ + ')';
// Separador estricto: una coma con espacios opcionales (solo ' ', nunca tabuladores ni saltos de linea).
// MySQL 8.4 puede emitir "SELECT,INSERT" (sin espacio) ademas de "SELECT, INSERT".
const COMMA_RE = ', *';
const PRIV_RE = '[A-Z][A-Z_]*(?: [A-Z_]+)*(?: \\(' + COLUMN_RE + '(?:' + COMMA_RE + COLUMN_RE + ')*\\))?';
const PRIV_LIST_RE = PRIV_RE + '(?:' + COMMA_RE + PRIV_RE + ')*';

const GRANT_ROW = new RegExp(
  '^GRANT (' + PRIV_LIST_RE + ') ON (?:(TABLE|FUNCTION|PROCEDURE) )?(' + IDENT_RE + ')\\.(' + IDENT_RE + ') TO ' +
  ACCOUNT_LIST_RE + '( WITH GRANT OPTION)?(?: AS ' + ACCOUNT_RE + '(?: WITH ROLE .+)?)?$', 's');
const REVOKE_ROW = new RegExp(
  '^REVOKE (' + PRIV_LIST_RE + ') ON (?:(TABLE|FUNCTION|PROCEDURE) )?(' + IDENT_RE + ')\\.(' + IDENT_RE + ') FROM ' +
  ACCOUNT_LIST_RE + '$', 's');
const ROLE_ROW = new RegExp(
  '^GRANT ' + ACCOUNT_LIST_RE + ' TO ' + ACCOUNT_LIST_RE + '( WITH ADMIN OPTION)?$', 's');
const PROXY_ROW = new RegExp(
  '^GRANT PROXY ON ' + ACCOUNT_RE + ' TO ' + ACCOUNT_LIST_RE + '( WITH GRANT OPTION)?$', 's');

// Quita las comillas (backtick o dobles, con su escape duplicado) y los escapes \_ y \% de los comodines.
function unquote(part) {
  if (part === '*') return '*';
  const quote = part[0];
  return part.slice(1, -1).split(quote + quote).join(quote).replace(/\\_/g, '_').replace(/\\%/g, '%');
}

// Normaliza "SELECT (`a`, `b`)" a "SELECT(columnas)": nunca expone nombres de columna y no equivale a un permiso de tabla.
function splitPrivileges(list) {
  const items = [];
  const re = new RegExp('(' + PRIV_RE + ')(?:' + COMMA_RE + '|$)', 'gy');
  let m;
  while ((m = re.exec(list)) !== null) {
    items.push(m[1].replace(/ \(.*\)$/s, '(columnas)'));
    if (re.lastIndex >= list.length) break;
  }
  return items;
}

// Devuelve solo tipo, privilegios y ambito; nunca la fila cruda (podria contener clausulas de autenticacion).
// tipo: 'grant' | 'revoke' | 'rol' | 'proxy'. Los tres ultimos no pueden confundirse con un permiso de tabla.
function parseGrantRow(row) {
  const text = String(Object.values(row)[0]);
  let m = PROXY_ROW.exec(text);
  if (m) return { tipo: 'proxy', privilegios: ['PROXY'], esquema: null, objeto: null, grantOption: Boolean(m[1]) };
  m = GRANT_ROW.exec(text);
  if (m) {
    return {
      tipo: 'grant', privilegios: splitPrivileges(m[1]), tipoObjeto: m[2] || 'TABLE',
      esquema: unquote(m[3]), objeto: unquote(m[4]), grantOption: Boolean(m[5])
    };
  }
  m = REVOKE_ROW.exec(text);
  if (m) {
    return {
      tipo: 'revoke', privilegios: splitPrivileges(m[1]), tipoObjeto: m[2] || 'TABLE',
      esquema: unquote(m[3]), objeto: unquote(m[4]), grantOption: false
    };
  }
  m = ROLE_ROW.exec(text);
  if (m) return { tipo: 'rol', privilegios: [], esquema: null, objeto: null, grantOption: false };
  throw new StopError('analisis-grants', 'Una concesion tiene un formato no reconocido.');
}

function adminCanGrant(adminRows) {
  const union = new Set();
  let todos = false;
  for (const grant of adminRows) {
    if (grant.tipo !== 'grant' || grant.tipoObjeto !== 'TABLE') continue;
    const cubre = (grant.esquema === '*' && grant.objeto === '*') ||
      (grant.esquema === SERVICE.schema && grant.objeto === '*');
    if (!grant.grantOption || !cubre) continue;
    grant.privilegios.forEach(p => union.add(p));
    if (grant.privilegios.includes('ALL PRIVILEGES')) todos = true;
  }
  // Una revocacion parcial que alcance horus_db (o *.*) resta privilegios; las de otros esquemas (mysql, sys) no importan.
  // Conservador: si alcanza cualquier objeto de horus_db, se descuenta, y ALL PRIVILEGES deja de bastar por si solo.
  for (const grant of adminRows) {
    if (grant.tipo !== 'revoke') continue;
    if (grant.esquema !== '*' && grant.esquema !== SERVICE.schema) continue;
    if (todos) { CRUD.forEach(p => union.add(p)); todos = false; }
    if (grant.privilegios.includes('ALL PRIVILEGES')) union.clear();
    grant.privilegios.forEach(p => union.delete(p));
  }
  return todos || CRUD.every(p => union.has(p));
}

function sameSet(a, b) {
  return a.length === b.length && a.every(item => b.includes(item));
}

function compareAppGrants(rows) {
  const resultado = { usageGlobal: false, correctos: 0, faltantes: [], diferentes: [], extra: [], grantOption: false };
  const vistos = new Map();
  for (const grant of rows) {
    if (grant.grantOption) resultado.grantOption = true;
    if (grant.tipo && grant.tipo !== 'grant') {
      resultado.extra.push(grant.tipo === 'revoke' ? 'REVOKE ' + grant.esquema + '.' + grant.objeto : grant.tipo);
    } else if (grant.tipoObjeto && grant.tipoObjeto !== 'TABLE') {
      resultado.extra.push(grant.tipoObjeto + ' ' + grant.esquema + '.' + grant.objeto);
    } else if (grant.esquema === '*' && grant.objeto === '*') {
      if (sameSet(grant.privilegios, ['USAGE'])) resultado.usageGlobal = true;
      else resultado.extra.push('*.* (' + grant.privilegios.length + ' privilegios globales)');
    } else if (grant.esquema === SERVICE.schema && grant.objeto !== '*' &&
               GRANT_MATRIX.some(g => g.tabla === grant.objeto)) {
      vistos.set(grant.objeto, grant.privilegios);
    } else {
      resultado.extra.push(grant.esquema + '.' + grant.objeto);
    }
  }
  for (const entry of GRANT_MATRIX) {
    const actuales = vistos.get(entry.tabla);
    if (!actuales) resultado.faltantes.push(entry.tabla);
    else if (!sameSet(actuales, entry.privilegios)) resultado.diferentes.push(entry.tabla);
    else resultado.correctos += 1;
  }
  resultado.conforme = resultado.usageGlobal && !resultado.grantOption && resultado.correctos === GRANT_MATRIX.length &&
    resultado.faltantes.length === 0 && resultado.diferentes.length === 0 && resultado.extra.length === 0;
  return resultado;
}

// --- Diagnostico de filas no reconocidas -------------------------------------------------------------
// Devuelve SOLO vocabulario cerrado (tipo, ambito, motivo): jamas fragmentos de la fila, cuentas ni identificadores.
// No acepta nada: solo explica por que parseGrantRow rechazo la fila.
const NAME_NE = '(?:' + Q_BT + '|' + Q_DQ + ')';
const SCOPE_GLOBAL_RE = /^\*\.\*$/;
const SCOPE_SCHEMA_RE = new RegExp('^' + NAME_NE + '\\.\\*$');
const SCOPE_TABLE_RE = new RegExp('^' + NAME_NE + '\\.' + NAME_NE + '$');
const TAIL_KEYWORDS = Object.freeze(['WITH GRANT OPTION', 'WITH ADMIN OPTION', 'AS', 'IDENTIFIED', 'REQUIRE', 'WITH']);

function rowType(text) {
  if (/^REVOKE /.test(text)) return 'REVOKE';
  if (/^GRANT PROXY ON /.test(text)) return 'PROXY';
  if (/^GRANT /.test(text)) return / ON /.test(text) ? 'GRANT' : (/ TO /.test(text) ? 'ROLE' : 'OTRO');
  return 'OTRO';
}

function rowScope(text, tipo) {
  if (tipo !== 'GRANT' && tipo !== 'REVOKE') return 'desconocido';
  const after = text.slice(text.indexOf(' ON ') + 4);
  const m = /^(?:(TABLE|FUNCTION|PROCEDURE) )?(.*?) (?:TO|FROM) /s.exec(after);
  if (!m) return 'desconocido';
  if (m[1] === 'FUNCTION' || m[1] === 'PROCEDURE') return 'rutina';
  if (SCOPE_GLOBAL_RE.test(m[2])) return 'global';
  if (SCOPE_SCHEMA_RE.test(m[2])) return 'esquema';
  if (SCOPE_TABLE_RE.test(m[2])) return 'tabla';
  return 'desconocido';
}

function whyPrivileges(seg) {
  if (seg === '') return 'lista de privilegios vacia';
  if (/[\r\n\t]|^\s|\s$/.test(seg)) return 'privilegios con espacios o saltos de linea no previstos';
  if (/^,|,\s*,|,\s*$/.test(seg.replace(/\([^)]*\)/g, '()'))) return 'lista de privilegios con coma sobrante o elemento vacio';
  if (/[a-z]/.test(seg.replace(/`[^`]*`|"[^"]*"/g, ''))) return 'privilegio con minusculas';
  if (/\d/.test(seg.replace(/`[^`]*`|"[^"]*"/g, ''))) return 'privilegio con digitos';
  if (/[^A-Z_ ,()`"]/.test(seg)) return 'privilegio con caracteres no previstos';
  return 'estructura de privilegios no cubierta';
}

function whyScope(scope) {
  if (/(^|\.)(``|"")(\.|$)/.test(scope)) return 'ambito con identificador vacio';
  if (!/\./.test(scope)) return 'ambito sin separador esquema.objeto';
  if (/[\r\n\t]/.test(scope)) return 'ambito con saltos de linea o tabuladores';
  return 'ambito con estructura no cubierta';
}

function whyAccounts(rest) {
  if (rest === '') return 'sin cuentas tras TO/FROM';
  if (/^\s|[\r\n\t]/.test(rest)) return 'cuentas con espacios o saltos de linea no previstos';
  if (/(^|[ ,@])(``|'')(?=[ ,@]|$)/.test(rest)) return 'cuenta con nombre o host vacio';
  const m = new RegExp('^' + ACCOUNT_LIST_RE + '(.*)$', 's').exec(rest);
  if (m) {
    const tail = m[m.length - 1].trim();
    if (/\s$/.test(m[m.length - 1]) && tail === '') return 'espacio final sobrante';
    const known = TAIL_KEYWORDS.some(k => tail === k || tail.startsWith(k + ' '));
    return known ? 'clausula final conocida con estructura no cubierta' : 'clausula final desconocida tras las cuentas';
  }
  return 'lista de cuentas con estructura no cubierta';
}

function diagnoseGrantRow(rowOrText) {
  const text = typeof rowOrText === 'string' ? rowOrText : String(Object.values(rowOrText)[0]);
  const tipo = rowType(text);
  const ambito = rowScope(text, tipo);
  let motivo;
  if (tipo === 'OTRO') motivo = 'no comienza por GRANT ni REVOKE o no tiene la forma de una concesion';
  else if (tipo === 'ROLE') motivo = 'concesion de roles: ' + whyAccounts(text.slice(text.indexOf(' ') + 1));
  else if (tipo === 'PROXY') motivo = 'GRANT PROXY: ' + whyAccounts(text.slice('GRANT PROXY ON '.length));
  else {
    const kw = tipo === 'REVOKE' ? 'REVOKE ' : 'GRANT ';
    const onAt = text.indexOf(' ON ');
    const privSeg = text.slice(kw.length, onAt);
    if (!new RegExp('^' + PRIV_LIST_RE + '$').test(privSeg)) motivo = whyPrivileges(privSeg);
    else {
      const m = /^(?:(?:TABLE|FUNCTION|PROCEDURE) )?(.*?) (TO|FROM) (.*)$/s.exec(text.slice(onAt + 4));
      if (!m) motivo = 'sin TO/FROM tras el ambito';
      else if (!(SCOPE_GLOBAL_RE.test(m[1]) || SCOPE_SCHEMA_RE.test(m[1]) || SCOPE_TABLE_RE.test(m[1]))) motivo = whyScope(m[1]);
      else if ((tipo === 'GRANT') !== (m[2] === 'TO')) motivo = 'palabra TO/FROM incoherente con GRANT/REVOKE';
      else motivo = whyAccounts(m[3]);
    }
  }
  return { tipo, ambito, motivo };
}

const clip = (value, max) => (value.length > max ? value.slice(0, max - 3) + '...' : value);

// Analiza todas las filas (no se detiene en la primera) y cuenta cuales no se reconocen. No acepta ninguna rechazada.
function analyzeRows(rows, cuenta, log) {
  const list = Array.from(rows);
  const grants = [];
  const fallos = [];
  list.forEach((row, i) => {
    try { grants.push(parseGrantRow(row)); } catch (e) {
      if (!(e instanceof StopError)) throw e;
      fallos.push({ fila: i + 1, ...diagnoseGrantRow(row) });
    }
  });
  if (log) {
    log('SHOW GRANTS de la cuenta ' + cuenta + ': filas examinadas=' + list.length + ', reconocidas=' + grants.length +
      ', no reconocidas=' + fallos.length + '.');
    fallos.forEach(f => log('  Fila ' + f.fila + ': tipo=' + f.tipo + ', ambito=' + f.ambito + ', motivo=' + f.motivo + '.'));
  }
  return { grants, fallos, examinadas: list.length };
}

function failUnrecognized(cuenta, resultado) {
  const detalle = resultado.fallos.slice(0, 2)
    .map(f => 'fila ' + f.fila + ' ' + f.tipo + '/' + f.ambito + ': ' + f.motivo).join('; ');
  const mas = resultado.fallos.length > 2 ? ' (+' + (resultado.fallos.length - 2) + ' mas)' : '';
  throw new StopError('analisis-grants', clip('Cuenta ' + cuenta + ': ' + resultado.fallos.length + ' de ' +
    resultado.examinadas + ' filas no reconocidas; ' + detalle + mas, 380));
}

async function showGrants(conn, forAccount, log) {
  const cuenta = forAccount ? 'aplicacion' : 'administrativa';
  const sql = forAccount ? 'SHOW GRANTS FOR \'' + SERVICE.app + '\'@\'' + validateHostSql(forAccount) + '\'' : 'SHOW GRANTS';
  const resultado = analyzeRows(await conn.query(sql), cuenta, log);
  if (resultado.fallos.length > 0) failUnrecognized(cuenta, resultado);
  return resultado.grants;
}

async function resolveAppHost(conn, hostHint) {
  if (hostHint) validateHostSql(hostHint);
  let hosts;
  try {
    const rows = await conn.query('SELECT `Host` AS host FROM `mysql`.`user` WHERE `User` = \'' + SERVICE.app + '\'');
    hosts = Array.from(rows).map(r => String(r.host));
  } catch (error) {
    // Sin lectura de mysql.user: solo se acepta un host indicado, y se comprueba que la cuenta exista.
    if (!hostHint || !DENIED_ERRNOS.includes(error && error.errno)) {
      throw new StopError('cuenta-app', 'No se pudo comprobar que horus_app exista' +
        (hostHint ? '.' : ' y no se indico -HostApp.'), safeCode(error));
    }
    try { await showGrants(conn, hostHint); } catch (e) {
      throw new StopError('cuenta-app', 'horus_app@host indicado no existe o no es verificable.', safeCode(e));
    }
    return hostHint;
  }
  if (hosts.length !== 1) {
    throw new StopError('cuenta-app', 'horus_app debe existir exactamente una vez (encontradas: ' + hosts.length + ').');
  }
  if (hostHint && hostHint !== hosts[0]) {
    throw new StopError('cuenta-app', 'El host indicado no coincide con el host real de horus_app.');
  }
  return validateHostSql(hosts[0]);
}

// modo: 'prechequeo' (solo lectura) | 'verificar' (solo lectura) | 'aplicar' (27 GRANT, requiere confirmado).
async function run({ conn, modo, hostApp, confirmado, log }) {
  if (!['prechequeo', 'verificar', 'aplicar', 'diagnostico'].includes(modo)) throw new StopError('parametros', 'Modo desconocido.');
  if (modo === 'aplicar' && confirmado !== true) throw new StopError('confirmacion', 'Falta la confirmacion explicita.');
  if (modo === 'aplicar' && !hostApp) throw new StopError('host-app', 'Aplicar exige -HostApp (host comprobado de horus_app).');

  log('Destino: Aiven ' + SERVICE.serviceId + ', base ' + SERVICE.schema + '.');

  const identity = await conn.query('SELECT CURRENT_USER() AS identidad');
  const actual = String(identity[0] && identity[0].identidad);
  if (!actual.startsWith(SERVICE.admin + '@')) {
    throw new StopError('identidad-admin', 'CURRENT_USER() no corresponde a avnadmin.');
  }
  log('CURRENT_USER() administrativo: ' + actual);

  const schemas = await conn.query('SELECT SCHEMA_NAME AS n FROM information_schema.schemata WHERE SCHEMA_NAME = \'' + SERVICE.schema + '\'');
  if (schemas.length !== 1) throw new StopError('destino', 'La base horus_db no existe en el servicio.');
  const tablesRows = await conn.query(
    'SELECT TABLE_NAME AS n FROM information_schema.tables WHERE TABLE_SCHEMA = \'' + SERVICE.schema + '\' AND TABLE_TYPE = \'BASE TABLE\'');
  const tablas = Array.from(tablesRows).map(r => String(r.n));
  const faltan = EXPECTED_TABLES.filter(t => !tablas.includes(t));
  const sobran = tablas.filter(t => !EXPECTED_TABLES.includes(t));
  if (faltan.length || sobran.length) {
    throw new StopError('destino', 'Las tablas de horus_db difieren de las 30 esperadas (faltan ' + faltan.length +
      ': ' + faltan.join(', ') + '; sobran ' + sobran.length + ': ' + sobran.join(', ') + ').');
  }
  log('Esquema: 30 tablas esperadas presentes (27 con GRANT + ' + EXCLUDED_TABLES.length + ' excluidas).');

  const host = await resolveAppHost(conn, hostApp);
  log('horus_app existe; host comprobado: ' + host);

  if (modo === 'diagnostico') {
    // Solo lectura: examina ambas cuentas, informa por separado y falla si alguna fila no se reconoce.
    const admin = analyzeRows(await conn.query('SHOW GRANTS'), 'administrativa', log);
    const app = analyzeRows(await conn.query('SHOW GRANTS FOR \'' + SERVICE.app + '\'@\'' + validateHostSql(host) + '\''), 'aplicacion', log);
    for (const [cuenta, resultado] of [['administrativa', admin], ['aplicacion', app]]) {
      if (resultado.fallos.length > 0) failUnrecognized(cuenta, resultado);
    }
    log('DIAGNOSTICO terminado: todas las filas de ambas cuentas son de un formato reconocido.');
    return { conforme: false, ejecutados: 0, diagnosticoOk: true };
  }

  const adminGrants = await showGrants(conn, null, log);
  if (!adminCanGrant(adminGrants)) {
    throw new StopError('autoridad-admin', 'avnadmin no muestra GRANT OPTION con SELECT/INSERT/UPDATE/DELETE sobre horus_db.');
  }
  log('avnadmin puede conceder SELECT/INSERT/UPDATE/DELETE sobre horus_db (GRANT OPTION confirmado).');

  const appGrants = await showGrants(conn, host, log);
  const estado = compareAppGrants(appGrants);

  if (modo === 'verificar') {
    log(informe(estado));
    if (!estado.conforme) throw new StopError('verificacion', 'SHOW GRANTS de horus_app no coincide con la matriz.');
    return { conforme: true, ejecutados: 0 };
  }

  const inicial = appGrants.length > 0 && appGrants.every(g => g.esquema === '*' && g.objeto === '*' &&
    sameSet(g.privilegios, ['USAGE']) && !g.grantOption);
  if (!inicial) {
    throw new StopError('estado-app', 'horus_app no esta en el estado inicial (solo USAGE ON *.*); no se aplica nada.');
  }
  log('horus_app esta en estado inicial: solo USAGE ON *.*, sin GRANT OPTION.');

  const statements = buildStatements(host);
  statements.forEach((s, i) => assertSafeStatement(s, i, host));
  log('Matriz validada: ' + statements.length + ' GRANT por tabla, sin permisos globales, DDL ni GRANT OPTION.');

  if (modo === 'prechequeo') {
    statements.forEach((s, i) => log('  [' + String(i + 1).padStart(2, '0') + '/27] ' + s));
    log('PRECHEQUEO terminado: no se ejecuto ningun GRANT.');
    return { conforme: false, ejecutados: 0, prechequeoOk: true };
  }

  let ejecutados = 0;
  for (let i = 0; i < statements.length; i += 1) {
    assertSafeStatement(statements[i], i, host);
    try {
      await conn.query(statements[i]);
    } catch (error) {
      // Sin reintentos: el estado parcial se inspecciona con -Modo Verificar.
      throw new StopError('grant-' + (i + 1) + '-de-27',
        'Fallo el GRANT ' + (i + 1) + '/27 (' + GRANT_MATRIX[i].tabla + '). Ejecutados antes: ' + ejecutados +
        '. No se reintenta; ejecute -Modo Verificar para ver el estado parcial.', safeCode(error));
    }
    ejecutados += 1;
    log('  GRANT ' + String(ejecutados).padStart(2, '0') + '/27 aplicado: ' + GRANT_MATRIX[i].tabla);
  }
  const despues = compareAppGrants(await showGrants(conn, host, log));
  log(informe(despues));
  if (!despues.conforme) throw new StopError('verificacion', 'Tras aplicar, SHOW GRANTS no coincide con la matriz.');
  return { conforme: true, ejecutados };
}

function informe(e) {
  return 'SHOW GRANTS horus_app: USAGE global=' + e.usageGlobal + ', correctos=' + e.correctos + '/27, faltantes=' +
    e.faltantes.length + ', diferentes=' + e.diferentes.length + ', extra=' + e.extra.length +
    ', grant_option=' + e.grantOption + ', conforme=' + e.conforme;
}

module.exports = {
  SERVICE, GRANT_MATRIX, EXCLUDED_TABLES, EXPECTED_TABLES, StopError,
  buildStatements, assertSafeStatement, parseGrantRow, diagnoseGrantRow, adminCanGrant, compareAppGrants,
  validateHostSql, safeCode, run
};
