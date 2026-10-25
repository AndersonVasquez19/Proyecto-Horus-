'use strict';
// Arranque del contenedor en la imagen distroless (sin shell ni setpriv).
// Reproduce el CMD anterior: si el contenedor arranca como root (volumen de Railway montado como root), corrige solo el
// propietario de UPLOAD_DIR cuando cuelga de /data/ y abandona root de forma irreversible antes de cargar la API.
// Si ya arranca sin privilegios (USER de la imagen o "user:" de Compose), no cambia nada.
const fs = require('node:fs');
const path = require('node:path');

const APP_UID = 1000;
const APP_GID = 1000;
const DEFAULT_UPLOAD_DIR = '/data/uploads';

// Devuelve la ruta normalizada solo si queda estrictamente dentro de /data/; "/data/../etc" se rechaza.
function uploadDirToFix(env) {
  const raw = env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
  if (!path.posix.isAbsolute(raw)) return null;
  const dir = path.posix.resolve(raw);
  return dir.startsWith('/data/') ? dir : null;
}

// Cambia el propietario del árbol sin seguir enlaces simbólicos (lchown): un enlace dentro del volumen no puede
// redirigir el cambio a archivos del sistema. Tampoco atraviesa directorios enlazados.
function chownTree(dir, uid, gid, fsImpl = fs) {
  fsImpl.lchownSync(dir, uid, gid);
  for (const entry of fsImpl.readdirSync(dir, { withFileTypes: true })) {
    const child = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) chownTree(child, uid, gid, fsImpl);
    else fsImpl.lchownSync(child, uid, gid);
  }
}

// Orden obligatorio: grupos suplementarios, GID y por último UID. Como root, setuid() fija UID real, efectivo y
// guardado, y el núcleo retira todas las capacidades: no hay forma de recuperar root después.
function dropPrivileges(proc = process) {
  proc.setgroups([APP_GID]);
  proc.setgid(APP_GID);
  proc.setuid(APP_UID);
  const groups = proc.getgroups();
  if (proc.getuid() !== APP_UID || proc.geteuid() !== APP_UID || proc.getgid() !== APP_GID || proc.getegid() !== APP_GID
    || groups.some((g) => g !== APP_GID)) {
    throw new Error('No se pudieron retirar los privilegios de root');
  }
}

function prepare(proc = process, fsImpl = fs) {
  if (typeof proc.getuid !== 'function' || proc.getuid() !== 0) return;
  const dir = uploadDirToFix(proc.env);
  if (dir) {
    fsImpl.mkdirSync(dir, { recursive: true });
    chownTree(dir, APP_UID, APP_GID, fsImpl);
  }
  dropPrivileges(proc);
}

module.exports = { uploadDirToFix, chownTree, dropPrivileges, prepare, APP_UID, APP_GID };

if (require.main === module) {
  try {
    prepare();
  } catch (error) {
    // Sin detalles del sistema de archivos ni de la configuración: solo el motivo general.
    console.error(`[arranque] ${error && error.message ? error.message : 'Error de arranque'}`);
    process.exit(1);
  }
  require(path.join(__dirname, '..', 'dist', 'main.js'));
}
