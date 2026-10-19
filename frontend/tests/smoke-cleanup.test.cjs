const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { fork, spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const register = require('../scripts/smoke-cleanup.cjs');
const fixture = path.join(__dirname, 'fixtures/smoke-lifecycle.cjs');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };

async function smoke(t, mode, env = process.env) {
  const runner = fork(fixture, [mode], { silent: true, windowsHide: true, env });
  let stderr = ''; runner.stderr.on('data', b => { stderr += b; });
  const exited = once(runner, 'exit');
  const [owned] = await once(runner, 'message');
  t.after(async () => {
    if (runner.exitCode === null) { runner.send('SIGTERM'); await exited; }
    assert.deepEqual(owned.pids.filter(alive), [], 'No quedan procesos de la propia prueba');
  });
  const blocked = mode === 'ambiguous' ? once(runner, 'message') : null;
  runner.send(mode);
  if (blocked) {
    const [result] = await blocked;
    try {
      assert.match(result.error, /confirmar la propiedad/);
      assert.equal(result.retained, true);
      assert.deepEqual(result.survivors, [true, true]);
    } finally { runner.send('release'); }
  }
  const [code] = await exited;
  assert.equal(code, ['failure', 'throw', 'ambiguous'].includes(mode) ? 1 : mode === 'SIGINT' ? 130 : mode === 'SIGTERM' ? 143 : 0, stderr);
  assert.equal(fs.existsSync(owned.profile), false, stderr);
  assert.deepEqual(owned.pids.filter(alive), [], 'Raíz, hijo y nieto deben terminar antes de borrar el perfil');
  return owned;
}

// Integración nativa sin Edge: procesos Node reales con un árbol como el de Chromium.
test('ciclo de vida en Windows', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  for (const mode of ['success', 'failure', 'throw', 'already-exited', 'late-observation', 'ambiguous', 'SIGINT', 'SIGTERM', 'success']) {
    await t.test(mode, async t => { await smoke(t, mode); });
  }
});

test('rechaza carpetas ajenas aunque se llamen horus-*', () => {
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'horus-foreign-test-'));
  fs.writeFileSync(path.join(foreign, 'keep'), 'ajeno');
  try {
    assert.throws(() => register({}, foreign), /no pertenece/);
    assert.throws(() => register({}, os.tmpdir()), /no pertenece/);
    assert.equal(fs.readFileSync(path.join(foreign, 'keep'), 'utf8'), 'ajeno');
  } finally { fs.rmSync(foreign, { recursive: true, force: true }); }
});

test('preserva navegador y perfil de otra sesión, incluso con prefijo compartido', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const foreignProfile = register.createProfile('horus-cleanup-foreign-');
  // Perfil con espacios; también se prueba que un sufijo del perfil propio no coincida.
  const foreign = spawn(process.execPath, ['-e', 'setTimeout(()=>{},45000)', '--', '--user-data-dir=' + foreignProfile], { windowsHide: true, stdio: 'ignore' });
  const foreignCleanup = register(foreign, foreignProfile);
  t.after(foreignCleanup);
  await once(foreign, 'spawn');
  const runner = fork(fixture, [], { silent: true, windowsHide: true });
  const exited = once(runner, 'exit');
  const [owned] = await once(runner, 'message');
  const sibling = owned.profile + '-other session';
  fs.mkdirSync(sibling); fs.writeFileSync(path.join(sibling, 'keep'), 'ajeno');
  const other = spawn(process.execPath, ['-e', 'setTimeout(()=>{},45000)', '--', '--user-data-dir=' + sibling], { windowsHide: true, stdio: 'ignore' });
  await once(other, 'spawn');
  // La opción aparece dentro de OTRO argumento, no como un argumento de perfil.
  const misleading = spawn(process.execPath, ['-e', 'setTimeout(()=>{},45000)', '--', '--label=contains --user-data-dir=' + owned.profile + ' text'], { windowsHide: true, stdio: 'ignore' });
  await once(misleading, 'spawn');
  t.after(async () => { const exited = once(misleading, 'exit'); misleading.kill(); await exited; });
  t.after(async () => { const exited = once(other, 'exit'); other.kill(); await exited; fs.rmSync(sibling, { recursive: true, force: true }); });
  runner.send('success');
  const [code] = await exited;
  assert.equal(code, 0);
  assert.equal(alive(foreign.pid), true);
  assert.equal(alive(other.pid), true);
  assert.equal(alive(misleading.pid), true);
  assert.equal(fs.existsSync(foreignProfile), true);
  assert.equal(fs.readFileSync(path.join(sibling, 'keep'), 'utf8'), 'ajeno');
  assert.deepEqual(owned.pids.filter(alive), []);
});

test('sin PID (fallo de lanzamiento) y limpieza repetida', { skip: process.platform !== 'win32' }, () => {
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  const profile = register.createProfile('horus-cleanup-no-pid-');
  const cleanup = register(child, profile);
  cleanup(); cleanup();
  assert.equal(fs.existsSync(profile), false);
});

test('perfil propio en una ruta temporal con espacios', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "horus-cleanup-spaces & [é] ' $;-"));
  try { await smoke(t, 'success', { ...process.env, TEMP: temporary, TMP: temporary }); }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('un PID ajeno no se usa como prueba de pertenencia', { skip: process.platform !== 'win32' }, () => {
  const { EventEmitter } = require('node:events');
  const profile = register.createProfile('horus-cleanup-pid-');
  const child = new EventEmitter(); child.pid = process.pid;
  const cleanup = register(child, profile);
  cleanup();
  assert.equal(alive(process.pid), true);
  assert.equal(fs.existsSync(profile), false);
});

test('Edge real: inicio y cierre aislado', { skip: process.platform !== 'win32' || process.env.SMOKE_CLEANUP_EDGE !== '1', timeout: 30000 }, async t => {
  const browser = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const profile = register.createProfile('horus-cleanup-edge-');
  const child = spawn(browser, ['--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore', detached: process.platform !== 'win32' });
  const cleanup = register(child, profile);
  t.after(cleanup);
  for (let i = 0; !fs.existsSync(path.join(profile, 'DevToolsActivePort')); i++) {
    if (i > 200) throw new Error('Edge no inició DevTools.');
    await new Promise(r => setTimeout(r, 25));
  }
  const snapshot = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'], { windowsHide: true, encoding: 'utf8' });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const processes = JSON.parse(snapshot.stdout);
  const pids = new Set([child.pid]);
  let previous;
  do { previous = pids.size; for (const p of processes) if (pids.has(p.ParentProcessId)) pids.add(p.ProcessId); } while (pids.size > previous);
  assert.ok(pids.size > 1, 'Edge creó procesos secundarios');
  cleanup(); cleanup();
  assert.deepEqual([...pids].filter(alive), [], 'Ningún proceso de este Edge queda huérfano');
  assert.equal(fs.existsSync(profile), false);
});

test('no elimina un perfil sustituido en disco', { skip: process.platform !== 'win32' }, () => {
  const { EventEmitter } = require('node:events');
  const profile = register.createProfile('horus-cleanup-replaced-');
  const saved = profile + '-original';
  const cleanup = register(new EventEmitter(), profile);
  fs.renameSync(profile, saved);
  fs.mkdirSync(profile); fs.writeFileSync(path.join(profile, 'keep'), 'ajeno');
  try {
    assert.throws(cleanup, /sustituido/);
    assert.equal(fs.readFileSync(path.join(profile, 'keep'), 'utf8'), 'ajeno');
  } finally {
    fs.rmSync(profile, { recursive: true, force: true }); fs.renameSync(saved, profile); cleanup();
  }
});

test('Linux y macOS no llaman PowerShell y rechazan grupos sin propiedad confirmada', async t => {
  const { EventEmitter } = require('node:events');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../scripts/smoke-cleanup.cjs'), 'utf8');
  for (const mode of ['linux', 'darwin', 'exited', 'no-proof', 'unsupported', 'ps-failure', 'ps-invalid']) {
    await t.test(mode, () => {
      const fakeProcess = new EventEmitter();
      fakeProcess.platform = mode === 'unsupported' ? 'freebsd' : mode === 'darwin' ? 'darwin' : 'linux';
      const signals = [], commands = [];
      fakeProcess.kill = (...args) => { signals.push(args); };
      const sandbox = { module: { exports: {} }, process: fakeProcess, __dirname: path.join(__dirname, '../scripts'), console,
        require: name => name === 'node:child_process' ? { spawnSync: (cmd, args) => {
          commands.push([cmd, args]);
          assert.equal(cmd, 'ps', 'Nunca ejecutar PowerShell fuera de Windows');
          return { status: mode === 'ps-failure' ? 1 : 0, stdout: mode === 'ps-invalid' ? 'invalid output' : '12345 Z\n999 S\n' };
        } } : require(name) };
      vm.runInNewContext(source, sandbox);
      const register = sandbox.module.exports;
      const profile = register.createProfile('horus-cleanup-portability-');
      const child = new EventEmitter();
      Object.assign(child, { pid: 12345, exitCode: mode === 'exited' ? 0 : null, signalCode: null,
        spawnargs: mode === 'no-proof' ? [] : ['--user-data-dir=' + profile] });
      const cleanup = register(child, profile);
      try {
        if (['linux', 'darwin'].includes(mode)) {
          cleanup(); cleanup();
          assert.deepEqual(signals, [[-12345, 'SIGKILL']]);
          assert.equal(commands.length, 1);
          assert.equal(fs.existsSync(profile), false);
        } else {
          assert.throws(cleanup, /no soportada|confirmar la propiedad|verificar el grupo/);
          assert.equal(fs.existsSync(profile), true);
          if (!['ps-failure', 'ps-invalid'].includes(mode)) assert.deepEqual(signals, []);
          const attempts = signals.length;
          assert.throws(cleanup, /no soportada|confirmar la propiedad|verificar el grupo/);
          assert.equal(signals.length, attempts, 'Un cierre fallido no vuelve a señalar procesos');
        }
      } finally { fs.rmSync(profile, { recursive: true, force: true }); }
    });
  }
});

test('Windows verifica la fecha usando el mismo handle que terminaría el proceso', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const foreign = spawn(process.execPath, ['-e', 'setTimeout(()=>{},45000)'], { windowsHide: true, stdio: 'ignore' });
  const exited = once(foreign, 'exit');
  t.after(async () => { foreign.kill(); await exited; });
  await once(foreign, 'spawn');
  // Compilar exactamente el adaptador nativo revisado; solo abre handles, no termina el proceso.
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$source = Get-Content -Raw -Encoding utf8 -LiteralPath $env:SMOKE_TEST_SCRIPT",
    "$code = [regex]::Match($source, '(?s)Add-Type -TypeDefinition @\"\\r?\\n(.*?)\\r?\\n\"@').Groups[1].Value",
    'Add-Type -TypeDefinition $code',
    '$id = [int]$env:SMOKE_TEST_PID',
    '$item = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $id)',
    '$stamp = $item.CreationDate.ToUniversalTime().Ticks',
    '$wrong = [SmokeBrowserProcess]::Open($id, $stamp + 10)',
    'if ($null -ne $wrong) { $wrong.Dispose(); throw "Aceptó una fecha diferente" }',
    '$correct = [SmokeBrowserProcess]::Open($id, $stamp)',
    'if ($null -eq $correct) { throw "Rechazó la fecha correcta" }',
    '$correct.Dispose()'
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, SMOKE_TEST_PID: String(foreign.pid), SMOKE_TEST_SCRIPT: path.join(__dirname, '../scripts/smoke-stop-browser.ps1') }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(alive(foreign.pid), true);
});

test('Windows confirma procesos terminados aunque CIM conserve su instantánea', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const profile = register.createProfile('horus-cleanup-stale-');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},45000)', '--', '--user-data-dir=' + profile], { windowsHide: true, stdio: 'ignore' });
  const cleanup = register(child, profile);
  t.after(cleanup);
  await once(child, 'spawn');
  // CIM puede seguir mostrando una fila cuyo handle ya confirma que terminó.
  // Conservar esa fila reproduce la espera fallida sin falsear el estado del proceso real.
  const command = [
    "$ErrorActionPreference = 'Stop'",
    '$script:held = $null',
    'function Get-CimInstance { param([string]$ClassName) $all = @(CimCmdlets\\Get-CimInstance -ClassName $ClassName); if ($null -eq $script:held) { $script:held = $all | Where-Object { $_.ProcessId -eq [int]$env:SMOKE_TEST_ROOT } }; if ($script:held -and !($all | Where-Object { $_.ProcessId -eq [int]$env:SMOKE_TEST_ROOT })) { $all += $script:held }; $all }',
    '& $env:SMOKE_TEST_SCRIPT -RootPid $env:SMOKE_TEST_ROOT -Profile $env:SMOKE_TEST_PROFILE -CreatedMilliseconds $env:SMOKE_TEST_CREATED'
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, encoding: 'utf8', timeout: 25000,
    env: { ...process.env, SMOKE_TEST_SCRIPT: path.join(__dirname, '../scripts/smoke-stop-browser.ps1'),
      SMOKE_TEST_ROOT: String(child.pid), SMOKE_TEST_PROFILE: profile,
      SMOKE_TEST_CREATED: String(Math.floor(fs.statSync(profile).birthtimeMs)) }
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(alive(child.pid), false);
  cleanup();
  assert.equal(fs.existsSync(profile), false);
});
