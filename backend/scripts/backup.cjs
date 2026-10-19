// Respaldo explícito de MySQL: `npm run db:backup [-- --dir=<carpeta>] [--include-rate-limits]`.
// Solo LEE la base (transacción de solo lectura con instantánea REPEATABLE READ, sin bloquear tablas) y escribe en backend/.backups/ (ignorada por Git).
// Usa las credenciales de database.cjs (variables DB_*): nunca las recibe por argumentos ni las escribe en el archivo.
const { createWriteStream, mkdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { once } = require('node:events');
const { createGzip } = require('node:zlib');
const { basename, join, resolve } = require('node:path');
const { connect } = require('./database.cjs');
const { dumpDatabase, sha256File, parseArgs } = require('./backup-lib.cjs');

const stamp = date => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir && args.dir !== true ? args.dir : join(__dirname, '..', '.backups'));
  try { mkdirSync(dir, { recursive: true }); } catch { throw new Error('No se pudo escribir en la carpeta de respaldos. Comprueba los permisos o indica otra con --dir=<carpeta> (en un contenedor, un volumen persistente).'); }
  const now = new Date();
  const file = join(dir, 'horus-' + String(process.env.DB_NAME).toLowerCase().replace(/[^a-z0-9_]/g, '_') + '-' + stamp(now) + '.sql.gz');
  const db = await connect({ dateStrings: true, jsonStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const gzip = createGzip({ level: 9 });
  // 'wx': nunca sobrescribe un respaldo existente. Permisos 0600 (en Windows se heredan de la carpeta).
  const out = createWriteStream(file, { flags: 'wx', mode: 0o600 });
  gzip.pipe(out);
  const write = async line => { if (!gzip.write(line + '\n')) await once(gzip, 'drain'); };
  let manifest;
  try {
    manifest = await dumpDatabase({ db, write, includeEphemeral: args['include-rate-limits'] === true, now });
    gzip.end();
    await once(out, 'finish');
  } catch (error) {
    gzip.destroy(); out.destroy();
    try { rmSync(file, { force: true }); } catch { /* el archivo parcial puede seguir abierto en Windows: se puede borrar a mano */ }
    throw error;
  } finally { await db.end().catch(() => {}); }
  const hash = await sha256File(file);
  writeFileSync(file + '.sha256', hash + '  ' + basename(file) + '\n', { flag: 'wx' });
  writeFileSync(file + '.manifest.json', JSON.stringify({ ...manifest, file: basename(file), bytes: statSync(file).size, sha256: hash }, null, 2) + '\n', { flag: 'wx' });
  const rows = manifest.tables.reduce((sum, table) => sum + table.dumped, 0);
  console.log('Respaldo creado: ' + file);
  console.log('Tablas: ' + manifest.tables.length + ' · filas: ' + rows + ' · SHA-256: ' + hash);
  console.log('Contiene datos personales y hashes de contraseñas: cífralo y guárdalo fuera del repositorio.');
}

main().catch(error => {
  // Sin trazas ni mensajes del servidor: podrían incluir rutas o datos de conexión.
  console.error(error && error.message && /^(Argumento|El recuento|Falta configurar|Nombre de|No se pudo escribir|No se pudo leer el juego)/.test(error.message) ? error.message : 'No se pudo crear el respaldo. Revisa la conexión, TLS, permisos y el espacio en disco.');
  process.exitCode = 1;
});
