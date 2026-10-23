// Un contenedor propio por suite; nunca usa .env, Compose ni contenedores existentes.
const { spawnSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const mysql = require('mysql2/promise');
const suites = {
  matriculas: ['MATRICULAS', 'matriculas.integration.cjs'],
  ediciones: ['EDITIONS', 'convocatorias.integration.cjs'],
  estudiantes: ['STUDENTS', 'estudiantes.integration.cjs'],
  access: ['ACCESS_GUARD_HTTP', 'access-guard-http.integration.cjs'],
  reportes: ['REPORTES', 'reportes.integration.cjs'],
  docentes: ['DOCENTES', 'docentes.integration.cjs'],
  horarios: ['HORARIOS', 'horarios.integration.cjs'],
  // Alias por compatibilidad: la CI manual (.github/workflows/ci.yml) sigue invocando el destino `sesiones`. El módulo de Sesiones se retiró;
  // la suite de Horarios verifica además esa retirada (migración no aplicada, rutas inexistentes, bases históricas compatibles).
  sesiones: ['HORARIOS', 'horarios.integration.cjs'],
  preinscripciones: ['PREINSCRIPCIONES', 'preinscripciones.integration.cjs'],
  // Suites que la CI ejecuta con su propio MySQL de servicio; aquí se pueden lanzar también en un contenedor propio y desechable.
  academico: ['ACADEMICO_SCHEMA', 'academico-schema.integration.cjs'],
  preparacion: ['ACCESS_READINESS', 'admin-access-readiness.integration.cjs'],
};
const suite = suites[process.argv[2]];
if (!suite) throw new Error('Selecciona matriculas, ediciones, estudiantes, access, reportes, docentes, horarios (alias: sesiones), preinscripciones, academico o preparacion.');
// Imagen de MySQL: 8.4 por defecto. HORUS_IT_MYSQL_IMAGE solo admite valores de esta lista cerrada (8.0.46 = la versión mayor de horus_db);
// la imagen debe existir ya en local: el ejecutor no descarga nada.
const IMAGES = ['mysql:8.4', 'mysql:8.0.46'];
const image = process.env.HORUS_IT_MYSQL_IMAGE || 'mysql:8.4';
if (!IMAGES.includes(image)) throw new Error('Imagen de MySQL no admitida para las pruebas aisladas.');
const name = 'horus-fase3-' + randomBytes(8).toString('hex');
const password = randomBytes(32).toString('hex');
const docker = args => {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, env: { ...process.env, MYSQL_PWD: password } });
  if (r.status !== 0) throw new Error('Docker no pudo completar ' + args[0]);
  return r.stdout.trim();
};
(async () => {
  docker(['image', 'inspect', image]); // sin descargas ni instalaciones
  let owned = false;
  try {
    const env = { ...process.env, MYSQL_ROOT_PASSWORD: password };
    const run = spawnSync('docker', ['run', '-d', '--name', name, '--label', 'horus.test=fase3', '-e', 'MYSQL_ROOT_PASSWORD', '-p', '127.0.0.1::3306', image], { env, encoding: 'utf8', windowsHide: true });
    if (run.status !== 0) throw new Error('No se pudo crear el contenedor desechable.');
    owned = true;
    const port = JSON.parse(docker(['inspect', name]))[0].NetworkSettings.Ports['3306/tcp'][0].HostPort;
    let uuid;
    for (let i = 0; i < 90; i++) {
      let db;
      try {
        db = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password, connectTimeout: 1000 });
        const [[row]] = await db.query('SELECT @@server_uuid AS uuid'); uuid = row.uuid; break;
      } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
      finally { if (db) await db.end(); }
    }
    if (!uuid) throw new Error('MySQL desechable no inició a tiempo.');
    const expectedUuid = docker(['exec', '-e', 'MYSQL_PWD', name, 'mysql', '-uroot', '-N', '-B', '-e', 'SELECT @@server_uuid']);
    if (uuid !== expectedUuid) throw new Error('UUID de conexión distinto al del contenedor propio.');
    console.log('Destino aislado: ' + name + ' · ' + image + ' · UUID verificado');
    let template;
    if (process.argv[2] === 'estudiantes') {
      template = 'horus_students_template_' + randomBytes(12).toString('hex');
      const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password });
      try {
        const [tables] = await db.query("SELECT TABLE_SCHEMA FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')");
        if (tables.length) throw new Error('La plantilla requiere un servidor propio vacío.');
        await db.query('CREATE DATABASE `' + template + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await db.changeUser({ database: template });
        const versions = JSON.parse(readFileSync(join(__dirname, '../scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
        for (const version of ['00000000-initial', ...versions]) for (const sql of readFileSync(join(__dirname, '../migrations', version + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean)) await db.query(sql);
      } finally { await db.end(); }
    }
    const testEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      DB_HOST: '127.0.0.1', DB_PORT: port, DB_USER: 'root', DB_PASS: password,
      [suite[0] + '_TEST_DB']: 'true', [suite[0] + '_TEST_SERVER_UUID']: uuid,
      MATRICULAS_BROWSER: process.env.MATRICULAS_BROWSER, MATRICULAS_SCREENSHOTS_DIR: process.env.MATRICULAS_SCREENSHOTS_DIR,
      REPORTES_MUESTRAS_DIR: process.env.REPORTES_MUESTRAS_DIR, HORUS_IT_MYSQL_IMAGE: image,
      EDITIONS_BROWSER: process.env.EDITIONS_BROWSER, EDITIONS_SCREENSHOTS_DIR: process.env.EDITIONS_SCREENSHOTS_DIR,
      STUDENTS_BROWSER: process.env.STUDENTS_BROWSER, STUDENTS_SCREENSHOTS_DIR: process.env.STUDENTS_SCREENSHOTS_DIR };
    if (template) testEnv.STUDENTS_TEST_TEMPLATE = template;
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--test', '-r', './test/isolate-env.cjs', join('test', suite[1])], { cwd: join(__dirname, '..'), env: testEnv, windowsHide: true, stdio: 'inherit' });
      child.once('error', reject); child.once('exit', resolve);
    });
    process.exitCode = code === 0 ? 0 : 1;
  } finally {
    if (owned) {
      const info = JSON.parse(docker(['inspect', name]))[0];
      if (info.Name !== '/' + name || info.Config.Labels['horus.test'] !== 'fase3') throw new Error('Identidad de contenedor propio inesperada.');
      // -v retira también el volumen anónimo de /var/lib/mysql que crea la imagen; sin él quedaba huérfano en cada ejecución.
      docker(['rm', '-f', '-v', name]);
      console.log('Contenedor propio retirado: ' + name);
    }
  }
})().catch(() => { console.error('Falló la ejecución aislada; no se muestran credenciales.'); process.exitCode = 1; });
