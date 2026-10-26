// Runner exclusivo H-03. Sin .env, destinos existentes, volúmenes compartidos ni descargas.
'use strict';
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const name = 'horus-h03-' + randomBytes(12).toString('hex');
const password = randomBytes(32).toString('hex');
const label = 'horus.test=h03';
const hostEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };
function docker(args, secretEnv = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, env: { ...hostEnv, ...secretEnv }, timeout: 30000 });
  if (r.status !== 0) throw new Error('Docker falló: ' + args[0]);
  return r.stdout.trim();
}
(async () => {
  docker(['image', 'inspect', 'mysql:8.4']);
  let id;
  try {
    id = docker(['run', '-d', '--name', name, '--label', label, '-e', 'MYSQL_ROOT_PASSWORD', '-p', '127.0.0.1::3306', 'mysql:8.4'], { MYSQL_ROOT_PASSWORD: password });
    const info = JSON.parse(docker(['inspect', id]))[0];
    assert.equal(info.Name, '/' + name);
    assert.equal(info.Config.Labels['horus.test'], 'h03');
    const bindings = info.NetworkSettings.Ports['3306/tcp'];
    assert.equal(bindings.length, 1); assert.equal(bindings[0].HostIp, '127.0.0.1');
    const port = bindings[0].HostPort;
    let uuid;
    for (let attempt = 0; attempt < 90; attempt++) {
      let db;
      try {
        db = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password, connectTimeout: 1000 });
        const [[row]] = await db.query('SELECT @@server_uuid AS uuid'); uuid = row.uuid; break;
      } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
      finally { if (db) await db.end(); }
    }
    assert.ok(uuid, 'MySQL temporal no inició');
    const internal = docker(['exec', '-e', 'MYSQL_PWD', id, 'mysql', '-uroot', '-N', '-B', '-e', 'SELECT @@server_uuid'], { MYSQL_PWD: password });
    assert.equal(uuid, internal);
    console.log(JSON.stringify({ container: name, id, host: '127.0.0.1', port, uuid, image: info.Image }));
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--test', '-r', './test/isolate-env.cjs', 'test/catalogo-concurrency.integration.cjs'], {
        cwd: join(__dirname, '..'), windowsHide: true, stdio: 'inherit',
        env: { ...hostEnv, DB_HOST: '127.0.0.1', DB_PORT: port, DB_USER: 'root', DB_PASS: password,
          CATALOGO_TEST_DB: 'true', CATALOGO_TEST_SERVER_UUID: uuid },
      });
      child.once('error', reject); child.once('exit', code => resolve(code === 0 ? 0 : 1));
    });
  } finally {
    if (id) {
      const info = JSON.parse(docker(['inspect', id]))[0];
      assert.equal(info.Id, id); assert.equal(info.Name, '/' + name); assert.equal(info.Config.Labels['horus.test'], 'h03');
      assert.ok(info.Mounts.every(m => m.Type === 'volume' && m.Destination === '/var/lib/mysql'), 'No se permite retirar montajes ajenos');
      docker(['rm', '-f', '-v', id]);
      console.log('Retirados exclusivamente contenedor y volumen propios: ' + name);
    }
  }
})().catch(() => { console.error('Falló H-03 aislado; no se muestran credenciales.'); process.exitCode = 1; });
