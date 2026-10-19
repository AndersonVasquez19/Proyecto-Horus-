// Respaldo explícito de los archivos subidos: `npm run uploads:backup [-- --source=<UPLOAD_DIR> --dir=<carpeta> --allow-empty]`.
// SOLO LEE el origen y crea `<dir>/uploads-AAAAMMDD-HHMMSS/` (por defecto backend/.backups, ignorada por Git). No usa MySQL ni credenciales.
// Un origen sin archivos se rechaza (suele ser una ruta equivocada); --allow-empty permite un respaldo vacío a propósito.
// El origen es --source, o la variable UPLOAD_DIR, o `uploads` (igual que la API). Nunca borra, mueve ni modifica archivos del origen.
const { join, resolve } = require('node:path');
const { createBackup, verifyBackup, UploadsBackupError } = require('./uploads-backup-lib.cjs');
const { parseArgs } = require('./backup-lib.cjs');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of Object.keys(args)) if (!['source', 'dir', 'allow-empty'].includes(key)) throw new UploadsBackupError('Argumento no reconocido: --' + key);
  const text = value => (typeof value === 'string' && value ? value : undefined);
  const source = resolve(text(args.source) || process.env.UPLOAD_DIR || 'uploads');
  const dir = resolve(text(args.dir) || join(__dirname, '..', '.backups'));
  const { snapshot, manifest } = await createBackup({ source, dir, allowEmpty: args['allow-empty'] === true });
  await verifyBackup(snapshot); // relee lo escrito: el respaldo solo se anuncia si pasa su propia comprobación
  console.log('Respaldo de archivos creado y verificado: ' + snapshot);
  console.log('Archivos: ' + manifest.files.length + ' · bytes: ' + manifest.totalBytes + ' · omitidos: ' + (manifest.excluded.length + manifest.skipped.length) + ' · desaparecidos durante la copia: ' + manifest.vanished.length);
  if (manifest.skipped.length) console.log('Revisa lo omitido en manifest.json (campo «skipped»): no se respaldó.');
  console.log('Guárdalo junto al respaldo de la base de la misma fecha, cifrado y fuera del repositorio (ver docs/procedimientos/backup-restauracion.md).');
}

main().catch(error => {
  // Sin trazas ni rutas internas del sistema operativo.
  console.error(error instanceof UploadsBackupError || /^Argumento/.test(error && error.message) ? error.message : 'No se pudo crear el respaldo de archivos. Revisa permisos y espacio en disco; no se modificó el origen.');
  process.exitCode = 1;
});
