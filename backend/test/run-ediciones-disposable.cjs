// Crea exclusivamente un contenedor efímero propio desde la imagen mysql:8.4 ya instalada. No modifica Compose ni .env.
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const name = 'horus-ediciones-test-' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const cwd = join(__dirname, '..');
const docker = (args, env = process.env) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, env });
  if (r.status !== 0) throw new Error('Falló Docker al preparar el servidor desechable.');
  return r.stdout.trim();
};
let created = false;
async function main() {
  docker(['image', 'inspect', 'mysql:8.4']); // No descarga ni instala imágenes.
  docker(['run', '--detach', '--rm', '--name', name, '--label', 'horus.test=ediciones', '--publish', '127.0.0.1::3306', '--env', 'MYSQL_ROOT_PASSWORD', '--env', 'MYSQL_ROOT_HOST=%', 'mysql:8.4', '--mysql-native-password=ON'], { ...process.env, MYSQL_ROOT_PASSWORD: password }); created = true;
  const port = docker(['port', name, '3306/tcp']).match(/:(\d+)$/)[1];
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    try { const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password }); await db.query('SELECT 1'); await db.end(); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error('El MySQL desechable no inició.');
  const uuid = docker(['exec', '--env', 'MYSQL_PWD=' + password, name, 'mysql', '-uroot', '-Nse', 'SELECT @@server_uuid']);
  console.log('Destino verificado: contenedor propio ' + name + ', mysql:8.4, 127.0.0.1:' + port + ', UUID ' + uuid);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    DB_HOST: '127.0.0.1', DB_PORT: port, DB_USER: 'root', DB_PASS: password, DB_NAME: 'horus_test_unused',
    ACCESS_GUARD_HTTP_TEST_DB: 'true', ACCESS_GUARD_HTTP_TEST_SERVER_UUID: uuid,
    ACADEMICO_SCHEMA_TEST_DB: 'true', ACADEMICO_SCHEMA_TEST_SERVER_UUID: uuid,
    EDITIONS_TEST_DB: 'true', EDITIONS_TEST_SERVER_UUID: uuid, EDITIONS_BROWSER: process.env.EDITIONS_BROWSER, EDITIONS_SCREENSHOTS_DIR: process.env.EDITIONS_SCREENSHOTS_DIR };
  const suites = process.argv.slice(2);
  for (const suite of suites.length ? suites : ['access-guard-http.integration.cjs', 'academico-schema.integration.cjs', 'convocatorias.integration.cjs']) {
    if (!['access-guard-http.integration.cjs', 'academico-schema.integration.cjs', 'convocatorias.integration.cjs'].includes(suite)) throw new Error('Suite no autorizada.');
    const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--test', '-r', './test/isolate-env.cjs', 'test/' + suite], { cwd, env, stdio: 'inherit', windowsHide: true }); child.once('exit', resolve); child.once('error', reject); });
    if (code !== 0) throw new Error('Falló la suite ' + suite);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => { if (created) { docker(['stop', '--time', '10', name]); console.log('Contenedor efímero propio retirado.'); } });
