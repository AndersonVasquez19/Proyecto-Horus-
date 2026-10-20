// Crea y elimina únicamente contenedores propios. No utiliza configuración de .env ni contenedores del proyecto.
require('./isolate-env.cjs');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const mysql = require('mysql2/promise');
const root = join(__dirname, '..');
const versions = JSON.parse(readFileSync(join(root, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const applySql = async (db, version) => { for (const sql of readFileSync(join(root, 'migrations', version + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean)) await db.query(sql); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const docker = (args, env) => { const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, env: env || process.env }); if (r.status !== 0) throw new Error('Falló Docker: ' + args[0]); return r.stdout.trim(); };
async function run(file, extra = {}) {
  const container = 'horus-import-test-' + randomBytes(6).toString('hex');
  const password = randomBytes(24).toString('hex'); let db, owned = false;
  const dockerEnv = { ...process.env, MYSQL_ROOT_PASSWORD: password, MYSQL_PWD: password };
  docker(['image', 'inspect', 'mysql:8.4']); // Solo imagen existente; no descargar dependencias.
  try {
    docker(['run', '--detach', '--name', container, '--label', 'horus.test=importaciones', '-e', 'MYSQL_ROOT_PASSWORD', '-p', '127.0.0.1::3306', 'mysql:8.4'], dockerEnv);
    owned = true;
    const port = Number(docker(['port', container, '3306/tcp']).split(':').pop());
    for (let i = 0; i < 90 && !db; i++) { try { db = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password }); } catch { await sleep(500); } }
    if (!db) throw new Error('MySQL desechable no inició.');
    const [[r]] = await db.query('SELECT @@server_uuid AS uuid, VERSION() AS version'); assertVersion(r.version);
    const expectedUuid = docker(['exec', '-e', 'MYSQL_PWD', container, 'mysql', '-uroot', '-N', '-B', '-e', 'SELECT @@server_uuid'], dockerEnv);
    if (r.uuid !== expectedUuid) throw new Error('El UUID conectado no coincide con el del contenedor propio.');
    const [[rsa]] = await db.query("SHOW STATUS LIKE 'Caching_sha2_password_rsa_public_key'");
    const publicKey = rsa?.Value;
    if (typeof publicKey !== 'string' || !publicKey.includes('BEGIN PUBLIC KEY')) throw new Error('No se pudo identificar la clave pública del MySQL propio.');
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'root', DB_PASS: password, DB_RSA_PUBLIC_KEY: publicKey, ...extra };
    if (file === 'prisma.integration.cjs') Object.assign(env, { DB_NAME: 'mysql', DB_SSL: 'false', NODE_ENV: 'development', JWT_SECRET: randomBytes(32).toString('hex'), MAIL_PROVIDER: 'gmail', MAIL_USER: '', MAIL_PASS: '', RESEND_API_KEY: '' });
    for (const prefix of ['IMPORTACIONES', 'MATRICULAS', 'EDITIONS', 'STUDENTS']) { env[prefix + '_TEST_DB'] = 'true'; env[prefix + '_TEST_SERVER_UUID'] = r.uuid; }
    env.ACCESS_GUARD_HTTP_TEST_DB = 'true'; env.ACCESS_GUARD_HTTP_TEST_SERVER_UUID = r.uuid;
    env.ACADEMICO_SCHEMA_TEST_DB = 'true'; env.ACADEMICO_SCHEMA_TEST_SERVER_UUID = r.uuid;
    if (file === 'estudiantes.integration.cjs') {
      const template = 'horus_students_template_' + randomBytes(12).toString('hex'); env.STUDENTS_TEST_TEMPLATE = template;
      await db.query('CREATE DATABASE `' + template + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await db.changeUser({ database: template });
      for (const v of ['00000000-initial', ...versions]) await applySql(db, v);
    }
    await db.end(); db = null;
    console.log('Ejecutando ' + file + ' en MySQL 8.4 propio (' + container + ').');
    const child = spawn(process.execPath, ['--test', '-r', './test/isolate-env.cjs', 'test/' + file], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    if (code !== 0) throw new Error(file + ' falló con código ' + code);
  } finally {
    if (db) await db.end();
    if (owned) {
      const info = JSON.parse(docker(['inspect', container]))[0];
      if (info.Name !== '/' + container || info.Config.Image !== 'mysql:8.4' || info.Config.Labels['horus.test'] !== 'importaciones') throw new Error('Identidad de contenedor propio inesperada.');
      docker(['rm', '--force', '--volumes', container]); console.log('Contenedor propio retirado: ' + container);
    }
  }
}
function assertVersion(version) { if (!/^8\.4\./.test(version)) throw new Error('Versión MySQL inesperada.'); }
(async () => {
  const files = process.argv.slice(2);
  for (const file of files.length ? files : ['importaciones.integration.cjs', 'matriculas.integration.cjs', 'convocatorias.integration.cjs', 'estudiantes.integration.cjs', 'access-guard-http.integration.cjs']) {
    if (!['importaciones.integration.cjs', 'matriculas.integration.cjs', 'convocatorias.integration.cjs', 'estudiantes.integration.cjs', 'access-guard-http.integration.cjs', 'academico-schema.integration.cjs', 'prisma.integration.cjs'].includes(file)) throw new Error('Prueba no permitida.');
    await run(file, file === 'importaciones.integration.cjs' && process.env.IMPORTACIONES_BROWSER === 'true' ? { IMPORTACIONES_BROWSER: 'true' } : {});
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
