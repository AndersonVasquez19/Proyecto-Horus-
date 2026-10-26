// Restauración explícita en una base AISLADA: `npm run db:restore -- --file=<respaldo.sql.gz> --target=horus_restore_<nombre> --yes`.
// Nunca restaura sobre la base configurada ni sobre datos existentes: el destino debe llamarse horus_restore_*, no existir o estar vacío.
// `--verify-only` comprueba la firma SHA-256 y el contenido del archivo sin conectarse a MySQL. El script no ejecuta DROP.
// Tras cargar, comprueba recuentos (manifiesto) e integridad referencial; si algo falla termina con código 1 y «RESTAURACIÓN FALLIDA».
const { createReadStream, existsSync, readFileSync } = require('node:fs');
const { createGunzip } = require('node:zlib');
const { resolve } = require('node:path');
const { BACKUP_MAGIC, restoreDatabaseDefaults, isAllowedStatement, validateManifest, validateRestoreTarget, referentialIntegrity, sha256File, parseArgs } = require('./backup-lib.cjs');

class UserError extends Error {}
const fail = message => { throw new UserError(message); };

// Lectura línea a línea del .gz. El iterador asíncrono propaga los errores del gunzip (archivo truncado o corrupto) como excepción normal.
async function* linesOf(file) {
  const input = createReadStream(file); const gunzip = createGunzip();
  input.on('error', error => gunzip.destroy(error));
  let rest = '';
  for await (const chunk of input.pipe(gunzip).setEncoding('utf8')) {
    const parts = (rest + chunk).split('\n'); rest = parts.pop();
    for (const part of parts) yield part;
  }
  if (rest) yield rest;
}

async function* statementsOf(file) {
  let first = true;
  try {
    for await (const raw of linesOf(file)) {
      const line = raw.trim();
      if (first) { if (line !== BACKUP_MAGIC) fail('El archivo no es un respaldo de Horus (cabecera no reconocida).'); first = false; continue; }
      if (!line || line.startsWith('--')) continue;
      if (!isAllowedStatement(line)) fail('El respaldo contiene una sentencia no permitida; no se ejecutó nada.');
      yield line;
    }
  } catch (error) { if (error instanceof UserError) throw error; fail('El archivo no se pudo leer como respaldo comprimido (¿truncado o dañado?).'); }
  if (first) fail('El respaldo está vacío.');
}

async function verify(file) {
  if (!existsSync(file)) fail('No se encontró el archivo de respaldo.');
  if (!existsSync(file + '.sha256')) fail('Falta el archivo .sha256 junto al respaldo: no se puede comprobar su integridad.');
  const expected = readFileSync(file + '.sha256', 'utf8').trim().split(/\s+/)[0];
  const hash = await sha256File(file);
  if (hash !== expected) fail('La firma SHA-256 no coincide: el respaldo está dañado o fue modificado.');
  let count = 0;
  for await (const statement of statementsOf(file)) { void statement; count++; }
  return { count, hash };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || args.file === true) fail('Indica el respaldo con --file=<ruta>.');
  const file = resolve(args.file);
  const { count: total, hash } = await verify(file);
  console.log('Respaldo íntegro: firma SHA-256 correcta y ' + total + ' sentencias permitidas.');
  if (args['verify-only']) return;
  const target = typeof args.target === 'string' ? args.target : '';
  const problem = validateRestoreTarget({ target, live: process.env.DB_NAME, host: process.env.DB_HOST, allowRemote: process.env.ALLOW_RESTORE_DB });
  if (problem) fail(problem);
  if (args.yes !== true) fail('Se creará/llenará la base «' + target + '». Repite el comando con --yes para confirmar.');
  const manifestFile = file + '.manifest.json';
  let manifest = null;
  if (existsSync(manifestFile)) {
    try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); } catch { fail('El manifiesto no es JSON válido.'); }
    const invalid = validateManifest(manifest, hash);
    if (invalid) fail(invalid);
  }
  const { connect } = require('./database.cjs'); // carga perezosa: --verify-only y las validaciones no cargan Prisma ni .env
  const db = await connect({ database: undefined });
  try {
    // Solo se quita NO_BACKSLASH_ESCAPES (el respaldo escapa con barra invertida); el resto de modos estrictos se conserva.
    await db.query("SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', '')");
    // Charset y colación de la base original (manifiesto validado: solo [a-z0-9_]); una copia anterior usa el valor histórico. Nunca se sustituyen en silencio.
    const defaults = restoreDatabaseDefaults(manifest);
    const [[supported]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ? AND CHARACTER_SET_NAME = ?', [defaults.collation, defaults.charset]);
    if (!Number(supported.n)) fail('El servidor de destino no admite la colación «' + defaults.collation + '» (juego «' + defaults.charset + '») registrada en el respaldo. No se creó ni se escribió nada; usa un servidor compatible.');
    console.log(defaults.recorded ? 'Colación de la base original: ' + defaults.collation + ' (' + defaults.charset + ').' : 'Aviso: el respaldo no registra la colación de la base (copia anterior); se usa ' + defaults.collation + ' (' + defaults.charset + ').');
    const [[exists]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [target]);
    if (Number(exists.n)) {
      const [[tables]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [target]);
      if (Number(tables.n)) fail('La base «' + target + '» ya tiene tablas. Usa un destino nuevo o vacío; este script no borra datos.');
      const [[current]] = await db.query('SELECT DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [target]);
      if (current.collation !== defaults.collation) console.log('Aviso: la base vacía «' + target + '» ya existe con la colación ' + current.collation + ' y no se modifica; las tablas del respaldo conservan la suya.');
    } else await db.query('CREATE DATABASE `' + target + '` CHARACTER SET ' + defaults.charset + ' COLLATE ' + defaults.collation);
    await db.query('USE `' + target + '`');
    let done = 0;
    for await (const statement of statementsOf(file)) { await db.query(statement.replace(/;$/, '')); done++; }
    console.log('Restauradas ' + done + ' sentencias en «' + target + '».');
    if (manifest) {
      for (const table of manifest.tables) {
        const [[row]] = await db.query('SELECT COUNT(*) AS n FROM `' + table.name + '`');
        if (Number(row.n) !== table.dumped) fail('El recuento de ' + table.name + ' no coincide (' + row.n + ' de ' + table.dumped + '). Revisa «' + target + '».');
      }
      console.log('Recuentos verificados en ' + manifest.tables.length + ' tablas.');
    }
    // Recuentos correctos no implican relaciones correctas, y SET FOREIGN_KEY_CHECKS=1 no revisa lo ya insertado: se comprueba cada clave
    // foránea declarada (con o sin manifiesto). Si falla, el destino se deja tal cual para revisarlo (no se borra) y el origen no se toca.
    const integrity = await referentialIntegrity(db, target);
    if (integrity.problems.length) {
      fail('RESTAURACIÓN FALLIDA: integridad referencial rota en «' + target + '».\n' + integrity.problems.map(problem => '  - ' + problem.relation + ': ' + problem.reason).join('\n') +
        '\nLa base «' + target + '» queda incompleta y NO debe usarse; no se borró nada. Revísala y elimínala manualmente (DROP DATABASE `' + target + '`).');
    }
    const composite = integrity.checked.filter(key => key.columns.length > 1).length;
    console.log('Integridad referencial verificada: ' + integrity.checked.length + ' claves foráneas (' + composite + ' compuestas), sin filas huérfanas: ' + integrity.checked.map(key => key.name).join(', ') + '.');
    console.log('La base «' + target + '» queda aparte de la configurada. Elimínala manualmente cuando termines de revisarla.');
  } finally { await db.end().catch(() => {}); }
}

main().catch(error => {
  console.error(error instanceof UserError || /^(Argumento|Falta configurar)/.test(error && error.message) ? error.message : 'No se pudo restaurar. Revisa permisos, el destino y el respaldo; la base destino puede haber quedado incompleta (no se borra nada automáticamente).');
  process.exitCode = 1;
});
