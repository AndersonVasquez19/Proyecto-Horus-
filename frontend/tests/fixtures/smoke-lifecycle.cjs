const fs = require('node:fs'), path = require('node:path'), { spawn, spawnSync } = require('node:child_process');
const register = require('../../scripts/smoke-cleanup.cjs');
const profile = register.createProfile('horus-cleanup-test-');
const args = [path.join(__dirname, 'smoke-browser.cjs'), '--pids-dir=' + profile, '--user-data-dir=' + profile];
if (process.argv.includes('already-exited')) args.push('--mark-child');
const child = spawn(process.execPath, args, { windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore' });
const cleanup = register(child, profile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; !fs.existsSync(path.join(profile, 'grandchild.json')); i++) {
    if (i > 200) throw new Error('El navegador simulado no inició.');
    await sleep(25);
  }
  const pids = ['root', 'child', 'grandchild'].map(role => JSON.parse(fs.readFileSync(path.join(profile, role + '.json'))).pid);
  process.send({ profile, pids });
  process.once('message', async mode => {
    if (mode === 'already-exited' || mode === 'ambiguous') {
      child.kill(); await new Promise(r => child.once('exit', r));
      // Reproducción del fallo original: child.kill() deja vivos a hijo y nieto.
      for (const pid of pids.slice(1)) process.kill(pid, 0);
    }
    if (mode === 'ambiguous') {
      let error;
      try { cleanup(); } catch (caught) { error = caught.message; }
      const release = new Promise(r => process.once('message', r));
      process.send({ error, retained: fs.existsSync(profile), survivors: pids.slice(1).map(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }) });
      await release;
      // Los fixtures salen por sí mismos; no se señala un PID cuya propiedad es ambigua para el helper.
      try { cleanup(); throw new Error('Una limpieza fallida no puede convertirse en éxito sin nueva prueba de propiedad.'); } catch (again) { if (again.message !== error) throw again; }
      fs.writeFileSync(path.join(profile, 'stop-fixture'), 'stop');
      for (let i = 0; i < 100; i++) {
        const live = pids.slice(1).some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
        if (!live) break;
        await sleep(25);
      }
      // Solo el fixture retira su propia carpeta después de confirmar la salida de sus procesos.
      for (const pid of pids.slice(1)) { try { process.kill(pid, 0); throw new Error('El fixture sigue vivo.'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
      fs.rmSync(profile, { recursive: true, force: true });
      process.exit(1);
    }
    if (mode === 'late-observation') {
      // Primera instantánea sin hijos: aparecerán cuando el padre ya haya terminado.
      const command = [
        "$ErrorActionPreference = 'Stop'",
        '$script:hidden = @(ConvertFrom-Json $env:SMOKE_TEST_HIDDEN)',
        '$script:observed = $false',
        'function Get-CimInstance { param([string]$ClassName) $all = @(CimCmdlets\\Get-CimInstance -ClassName $ClassName); if (!$script:observed) { $script:observed = $true; $all | Where-Object { $_.ProcessId -notin $script:hidden } } else { $all } }',
        '& $env:SMOKE_TEST_SCRIPT -RootPid $env:SMOKE_TEST_ROOT -Profile $env:SMOKE_TEST_PROFILE -CreatedMilliseconds $env:SMOKE_TEST_CREATED'
      ].join('; ');
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true, encoding: 'utf8', timeout: 25000,
        env: { ...process.env, SMOKE_TEST_SCRIPT: path.join(__dirname, '../../scripts/smoke-stop-browser.ps1'),
          SMOKE_TEST_ROOT: String(child.pid), SMOKE_TEST_PROFILE: profile,
          SMOKE_TEST_CREATED: String(Math.floor(fs.statSync(profile).birthtimeMs)), SMOKE_TEST_HIDDEN: JSON.stringify(pids.slice(1)) }
      });
      if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
      for (const pid of pids) { try { process.kill(pid, 0); throw new Error('El proceso observado tarde no terminó.'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    }
    if (mode === 'throw') throw new Error('Excepción simulada');
    if (mode === 'failure') { console.error('Fallo simulado'); process.exit(1); }
    if (mode === 'SIGINT' || mode === 'SIGTERM') { process.emit(mode); return; }
    cleanup(); cleanup();
    process.exit(0);
  });
})().catch(error => { console.error(error); process.exit(1); });
