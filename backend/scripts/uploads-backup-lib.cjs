// Respaldo y restauración de los archivos subidos (UPLOAD_DIR). Sin conexión a MySQL ni dependencias nuevas: solo `node:fs`.
// Formato de la instantánea (una carpeta, predecible y verificable archivo por archivo):
//   uploads-AAAAMMDD-HHMMSS/
//     files/<ruta relativa>      copia de cada archivo (ruta idéntica a la de UPLOAD_DIR)
//     manifest.json              formato, fecha, y por archivo: ruta, bytes y SHA-256
//     manifest.json.sha256       firma SHA-256 del manifiesto (formato sha256sum)
// Los archivos subidos son de escritura única (`wx`, nombre UUID) y la aplicación nunca los modifica: copiarlos con la API en marcha es seguro.
// Este módulo NUNCA borra ni sobrescribe: ni en el origen ni en el destino.
const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');
const { pipeline } = require('node:stream/promises');

const FORMAT = 'horus-uploads-backup/1';
const REL_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
// Temporales y archivos de sistema que no son contenido de usuario. Los demás archivos (aunque su nombre no sea el habitual) SE respaldan.
const EXCLUDED_NAME = /^\.|\.(?:tmp|part|partial|crdownload)$|~$|^thumbs\.db$/i;

class UploadsBackupError extends Error {}
const fail = message => { throw new UploadsBackupError(message); };
// ¿`child` es `parent` o está dentro de él? (relative devuelve una ruta absoluta si están en unidades distintas de Windows)
const isInside = (child, parent) => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
const stampOf = date => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// Copia `from` a `to` ('wx': nunca sobrescribe) calculando el SHA-256 y el tamaño de lo leído. Si falla, elimina SOLO el archivo parcial que esta llamada creó.
async function copyHashed(from, to) {
  const hash = createHash('sha256'); let bytes = 0;
  const input = createReadStream(from);
  input.on('data', chunk => { hash.update(chunk); bytes += chunk.length; });
  const out = createWriteStream(to, { flags: 'wx', mode: 0o600 });
  try { await pipeline(input, out); }
  catch (error) { if (error && error.code !== 'EEXIST') rmSync(to, { force: true }); throw error; }
  return { bytes, sha256: hash.digest('hex') };
}
function sha256File(file) {
  return new Promise((done, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => done(hash.digest('hex')));
  });
}

// Recorre el origen. Devuelve los archivos a respaldar y lo omitido (temporales, enlaces simbólicos, nombres no admitidos), sin tocar nada.
function scanSource(source) {
  let stat; try { stat = statSync(source); } catch { fail('La carpeta de archivos subidos no existe o no se puede leer.'); }
  if (!stat.isDirectory()) fail('El origen de los archivos subidos no es una carpeta.');
  const files = [], excluded = [], skipped = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(directory, entry.name), rel = relative(source, full).split(sep).join('/');
      if (EXCLUDED_NAME.test(entry.name)) { excluded.push(rel); continue; }
      if (lstatSync(full).isSymbolicLink()) { skipped.push({ path: rel, motivo: 'enlace simbólico' }); continue; }
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) { skipped.push({ path: rel, motivo: 'no es un archivo regular' }); continue; }
      if (!REL_PATH.test(rel)) { skipped.push({ path: rel, motivo: 'nombre no admitido' }); continue; }
      files.push({ rel, full });
    }
  };
  walk(source);
  return { files, excluded, skipped };
}

// Crea la instantánea en `<dir>/uploads-<fecha>`. Si el archivo desaparece mientras se copia se anota (no se aborta); cualquier otro error elimina solo lo que esta ejecución creó.
async function createBackup({ source, dir, now = new Date(), allowEmpty = false }) {
  const root = resolve(source), parent = resolve(dir);
  const snapshot = join(parent, 'uploads-' + stampOf(now));
  if (isInside(snapshot, root)) fail('La carpeta de respaldos no puede estar dentro de la carpeta de archivos subidos.');
  const { files, excluded, skipped } = scanSource(root);
  // Un origen sin archivos suele ser una ruta mal apuntada (p. ej. un UPLOAD_DIR equivocado): no se crea un respaldo «correcto» vacío salvo petición expresa.
  if (!files.length && !allowEmpty) fail('No hay archivos que respaldar en el origen' + (excluded.length || skipped.length ? ' (solo temporales u omitidos: ' + (excluded.length + skipped.length) + ')' : '') + '. Comprueba la ruta (--source o UPLOAD_DIR). Si el origen está vacío a propósito, repite con --allow-empty.');
  try { mkdirSync(parent, { recursive: true }); mkdirSync(snapshot); } catch (error) { fail(error && error.code === 'EEXIST' ? 'Ya existe un respaldo con esta marca de tiempo; espera un segundo y repite (no se sobrescribe).' : 'No se pudo escribir en la carpeta de respaldos. Comprueba los permisos o indica otra con --dir=<carpeta>.'); }
  const copied = [], vanished = [];
  try {
    for (const { rel, full } of files) {
      const to = join(snapshot, 'files', ...rel.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      try { copied.push({ path: rel, ...(await copyHashed(full, to)) }); }
      catch (error) { if (error && error.code === 'ENOENT') vanished.push(rel); else throw error; }
    }
    const manifest = { format: FORMAT, createdAt: now.toISOString(), files: copied, totalBytes: copied.reduce((sum, file) => sum + file.bytes, 0), excluded, skipped, vanished };
    const text = JSON.stringify(manifest, null, 2) + '\n';
    writeFileSync(join(snapshot, 'manifest.json'), text, { flag: 'wx' });
    writeFileSync(join(snapshot, 'manifest.json.sha256'), createHash('sha256').update(text).digest('hex') + '  manifest.json\n', { flag: 'wx' });
    return { snapshot, manifest };
  } catch (error) {
    rmSync(snapshot, { recursive: true, force: true }); // solo la instantánea parcial creada por esta ejecución
    throw error;
  }
}

// El manifiesto es JSON de un archivo no confiable: sus rutas acaban en operaciones de archivo, así que se validan antes de usarlas.
function parseManifest(text) {
  let manifest; try { manifest = JSON.parse(text); } catch { fail('El manifiesto no es JSON válido.'); }
  if (!manifest || manifest.format !== FORMAT || !Array.isArray(manifest.files)) fail('El manifiesto no tiene el formato esperado.');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !REL_PATH.test(file.path) || file.path.split('/').some(part => part === '.' || part === '..')) fail('El manifiesto contiene una ruta no válida.');
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(String(file.sha256))) fail('El manifiesto contiene un archivo con tamaño o firma no válidos: ' + file.path);
    if (seen.has(file.path.toLowerCase())) fail('El manifiesto repite una ruta.');
    seen.add(file.path.toLowerCase());
  }
  return manifest;
}

// Comprueba la instantánea completa SIN escribir nada: firma del manifiesto, existencia, tamaño y SHA-256 de cada archivo.
async function verifyBackup(snapshot) {
  const root = resolve(snapshot), manifestFile = join(root, 'manifest.json');
  if (!existsSync(manifestFile)) fail('No se encontró manifest.json: la carpeta no es un respaldo de archivos subidos.');
  if (!existsSync(manifestFile + '.sha256')) fail('Falta manifest.json.sha256: no se puede comprobar la integridad del manifiesto.');
  const text = readFileSync(manifestFile, 'utf8');
  if (createHash('sha256').update(text).digest('hex') !== readFileSync(manifestFile + '.sha256', 'utf8').trim().split(/\s+/)[0]) fail('La firma del manifiesto no coincide: está dañado o fue modificado.');
  const manifest = parseManifest(text), problems = [];
  for (const file of manifest.files) {
    const full = join(root, 'files', ...file.path.split('/'));
    let stat; try { stat = lstatSync(full); } catch { problems.push(file.path + ': falta'); continue; }
    if (!stat.isFile()) problems.push(file.path + ': no es un archivo regular');
    else if (stat.size !== file.bytes) problems.push(file.path + ': tamaño distinto');
    else if (await sha256File(full) !== file.sha256) problems.push(file.path + ': el contenido no coincide con la firma');
  }
  if (problems.length) fail('El respaldo está dañado o incompleto (' + problems.length + ' problema(s)): ' + problems.slice(0, 5).join('; ') + (problems.length > 5 ? '…' : ''));
  const listed = new Set(manifest.files.map(file => file.path)), extra = [];
  const walk = (directory) => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full); else { const rel = relative(join(root, 'files'), full).split(sep).join('/'); if (!listed.has(rel)) extra.push(rel); }
  } };
  if (existsSync(join(root, 'files'))) walk(join(root, 'files'));
  return { manifest, extra };
}

// Destino de la restauración: nunca la carpeta de la propia instantánea; la carpeta viva solo con consentimiento expreso.
function validateRestoreTarget({ target, snapshot, live, allowLive, onlyMissing }) {
  const to = resolve(target || ''), from = resolve(snapshot);
  if (!target) return 'Indica el destino con --target=<carpeta>.';
  const real = path => { try { return realpathSync(path); } catch { return resolve(path); } };
  if (isInside(real(to), real(from)) || isInside(real(from), real(to))) return 'El destino no puede estar dentro del respaldo ni contenerlo.';
  if (live && real(to) === real(live) && !allowLive) return 'El destino es la carpeta de archivos subidos en uso (UPLOAD_DIR). Para restaurar sobre ella, repite con --allow-upload-dir (solo copia los archivos que falten y nunca sobrescribe).';
  if (existsSync(to)) {
    if (!statSync(to).isDirectory()) return 'El destino existe y no es una carpeta.';
    if (readdirSync(to).length && !onlyMissing) return 'El destino no está vacío. Usa una carpeta nueva o vacía, o --only-missing para copiar solo lo que falte sin tocar lo existente.';
  }
  return '';
}

// Restaura una instantánea YA verificada. Nunca sobrescribe: con `onlyMissing` los archivos presentes se conservan (idénticos → omitidos; distintos → conflicto, sin tocar).
async function restoreBackup({ snapshot, target, onlyMissing = false }) {
  const { manifest } = await verifyBackup(snapshot);
  const root = resolve(snapshot), out = resolve(target);
  mkdirSync(out, { recursive: true });
  const result = { restored: 0, skipped: 0, conflicts: [] };
  for (const file of manifest.files) {
    const from = join(root, 'files', ...file.path.split('/')), to = join(out, ...file.path.split('/'));
    if (existsSync(to)) {
      if (!onlyMissing) fail('Ya existe ' + file.path + ' en el destino; no se sobrescribe.');
      if (statSync(to).isFile() && statSync(to).size === file.bytes && await sha256File(to) === file.sha256) result.skipped++; else result.conflicts.push(file.path);
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    const copy = await copyHashed(from, to);
    if (copy.sha256 !== file.sha256) { rmSync(to, { force: true }); fail('La copia de ' + file.path + ' no coincide con la firma; se retiró ese archivo.'); }
    result.restored++;
  }
  return result;
}

module.exports = { FORMAT, EXCLUDED_NAME, UploadsBackupError, createBackup, verifyBackup, restoreBackup, validateRestoreTarget, parseManifest, scanSource, stampOf };
