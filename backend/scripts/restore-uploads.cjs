// Restauración explícita de archivos subidos desde una instantánea de `uploads:backup`:
//   npm run uploads:restore -- --from=<uploads-AAAAMMDD-HHMMSS> --verify-only
//   npm run uploads:restore -- --from=<uploads-AAAAMMDD-HHMMSS> --target=<carpeta nueva o vacía> --yes
// Primero verifica TODA la instantánea (firma del manifiesto y SHA-256 de cada archivo); si algo falla no escribe nada.
// Nunca sobrescribe ni borra: el destino debe estar vacío o no existir (con --only-missing se copian solo los archivos que falten).
// La carpeta en uso (UPLOAD_DIR) exige además --allow-upload-dir. No usa MySQL.
const { resolve } = require('node:path');
const { restoreBackup, validateRestoreTarget, verifyBackup, UploadsBackupError } = require('./uploads-backup-lib.cjs');
const { parseArgs } = require('./backup-lib.cjs');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of Object.keys(args)) if (!['from', 'target', 'yes', 'verify-only', 'only-missing', 'allow-upload-dir'].includes(key)) throw new UploadsBackupError('Argumento no reconocido: --' + key);
  if (typeof args.from !== 'string' || !args.from) throw new UploadsBackupError('Indica la instantánea con --from=<carpeta uploads-AAAAMMDD-HHMMSS>.');
  const snapshot = resolve(args.from);
  const { manifest, extra } = await verifyBackup(snapshot);
  console.log('Respaldo íntegro: ' + manifest.files.length + ' archivos (' + manifest.totalBytes + ' bytes), creado el ' + manifest.createdAt + '.');
  if (extra.length) console.log('Aviso: hay ' + extra.length + ' archivo(s) en files/ que no figuran en el manifiesto; no se restaurarán.');
  if (args['verify-only']) return;
  const target = typeof args.target === 'string' ? args.target : '';
  const problem = validateRestoreTarget({ target, snapshot, live: process.env.UPLOAD_DIR ? resolve(process.env.UPLOAD_DIR) : undefined, allowLive: args['allow-upload-dir'] === true, onlyMissing: args['only-missing'] === true });
  if (problem) throw new UploadsBackupError(problem);
  if (args.yes !== true) throw new UploadsBackupError('Se copiarán archivos a «' + resolve(target) + '». Repite el comando con --yes para confirmar.');
  const result = await restoreBackup({ snapshot, target, onlyMissing: args['only-missing'] === true });
  console.log('Restaurados: ' + result.restored + ' · ya presentes e idénticos: ' + result.skipped + ' · en conflicto (distintos, sin tocar): ' + result.conflicts.length);
  if (result.conflicts.length) { console.log('Conflictos: ' + result.conflicts.slice(0, 10).join(', ') + (result.conflicts.length > 10 ? '…' : '')); process.exitCode = 1; }
}

main().catch(error => {
  console.error(error instanceof UploadsBackupError || /^Argumento/.test(error && error.message) ? error.message : 'No se pudo restaurar. Revisa permisos y espacio; los archivos existentes en el destino no se modifican (puede haber quedado una restauración parcial: repite con --only-missing).');
  process.exitCode = 1;
});
