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
    verifyProfile(profile, identity);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
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
