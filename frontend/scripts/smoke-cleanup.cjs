const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');

// Solo perfiles creados por esta instancia, nunca un horus-* encontrado en disco.
const profiles = new Map();
function createProfile(prefix) {
  if (!/^horus-[a-z0-9-]+-$/.test(prefix)) throw new Error('Prefijo de perfil inválido.');
  const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  const stat = fs.lstatSync(profile);
  profiles.set(profile, { ino: stat.ino, dev: stat.dev, created: Date.now() });
  return profile;
}
function verifyProfile(profile, identity) {
  if (path.dirname(profile) !== fs.realpathSync(os.tmpdir())) throw new Error('Perfil fuera del directorio temporal.');
  if (!fs.existsSync(profile)) return;
  const stat = fs.lstatSync(profile);
  if (stat.isSymbolicLink() || stat.ino !== identity.ino || stat.dev !== identity.dev) throw new Error('El perfil temporal fue sustituido.');
}

// Windows deja el directorio «pendiente de eliminar» unos segundos tras cerrar Edge y responde
// EPERM/EACCES; el rmSync nativo de Node 23+ no reintenta ese caso (Node 22 sí). Reintento
// síncrono y acotado, solo sobre el perfil propio y verificando su identidad en cada intento.
const RETRYABLE_REMOVE = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
// Solo diagnóstico: si el borrado sigue fallando, añade al error qué procesos mantienen archivos del perfil abiertos según el
// Restart Manager de Windows. No cierra nada ni cambia el resultado: el error se sigue lanzando y el smoke sigue fallando.
function withLockReport(profile, error) {
  if (process.platform !== 'win32' || !RETRYABLE_REMOVE.has(error.code)) return error;
  const report = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'smoke-profile-locks.ps1'), '-Profile', profile], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
  const detail = report.error ? 'diagnóstico no disponible (' + report.error.message + ')' : (report.stdout || report.stderr || '').trim().replace(/\s+/g, ' ');
  error.message += ' [bloqueo del perfil: ' + detail + ']';
  return error;
}
function removeProfile(profile, identity, deadline = Date.now() + 15000) {
  for (;;) {
    verifyProfile(profile, identity);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      return;
    } catch (error) {
      if (!RETRYABLE_REMOVE.has(error.code) || Date.now() >= deadline) throw withLockReport(profile, error);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}

// Síncrono deliberadamente: los smokes llaman process.exit(), también al fallar.
// Un callback async de exit no podría esperar a procesos ni bloqueos de archivos.
function registerSmokeCleanup(child, profile, server) {
  profile = path.resolve(profile);
  const identity = profiles.get(profile);
  if (!identity) throw new Error('El perfil no pertenece a este smoke.');
  // Capturar el PID una sola vez y solo si el lanzamiento llevaba nuestro perfil exacto.
  const rootPid = child.spawnargs?.includes('--user-data-dir=' + profile) ? child.pid : 0;
  let disposed = false;
  let browserFailure;
  let browserStopped = false;
  const cleanup = () => {
    if (disposed) return;
    // Tras un cierre parcial se ha perdido la instantánea de propiedad: nunca fingir éxito al reintentar.
    if (browserFailure) throw browserFailure;
    verifyProfile(profile, identity);
    if (!browserStopped) {
      try {
        if (process.platform === 'win32') {
          const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', path.join(__dirname, 'smoke-stop-browser.ps1'), '-RootPid', String(rootPid || 0),
            '-Profile', profile, '-CreatedMilliseconds', String(identity.created)],
          { windowsHide: true, encoding: 'utf8', timeout: 30000 });
          if (result.error || result.status !== 0) throw new Error('No se pudo cerrar el navegador del smoke; se conserva el perfil. ' + (result.error?.message || result.stderr.trim()));
        } else if (child.pid) {
          if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Limpieza de navegador no soportada en esta plataforma; se conserva el perfil.');
          // Node mantiene el PID sin reutilizar hasta recoger al hijo. Tras exit ya no es prueba de propiedad.
          if (!rootPid || child.exitCode !== null || child.signalCode !== null) throw new Error('No se puede confirmar la propiedad del grupo del navegador; se conserva el perfil.');
          // Los lanzadores crean un grupo propio en POSIX.
          try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
          const end = Date.now() + 5000;
          let running = true;
          while (Date.now() < end) {
            // Un hijo zombi ya liberó sus archivos, pero Node solo podrá recogerlo al volver al event loop.
            const snapshot = spawnSync('ps', ['-eo', 'pgid=,stat='], { encoding: 'utf8', timeout: 2000 });
            if (snapshot.error || snapshot.status !== 0) throw new Error('No se pudo verificar el grupo del navegador.');
            const rows = snapshot.stdout.trim().split(/\r?\n/);
            if (rows.some(line => !/^\s*\d+\s+[a-z][^\s]*\s*$/i.test(line))) throw new Error('No se pudo verificar el grupo del navegador: respuesta de ps inválida.');
            running = rows.some(line => {
              const [group, state] = line.trim().split(/\s+/);
              return Number(group) === child.pid && !/^[ZX]/.test(state);
            });
            if (!running) break;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
          }
          if (running) throw new Error('El grupo del navegador no terminó; se conserva el perfil.');
        }
        browserStopped = true;
      } catch (error) { browserFailure = error; throw error; }
    }
    server?.close();
    removeProfile(profile, identity);
    disposed = true;
    profiles.delete(profile);
    process.removeListener('exit', onExit);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    child.removeListener('error', onError);
  };
  const onExit = () => { try { cleanup(); } catch (error) { console.error(error.message); process.exitCode = 1; } };
  const onInterrupt = () => process.exit(130);
  const onTerminate = () => process.exit(143);
  const onError = error => { console.error('No se pudo iniciar el navegador: ' + error.message); process.exit(1); };
  process.once('exit', onExit);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  child.once('error', onError);
  return cleanup;
}
module.exports = registerSmokeCleanup;
module.exports.createProfile = createProfile;
