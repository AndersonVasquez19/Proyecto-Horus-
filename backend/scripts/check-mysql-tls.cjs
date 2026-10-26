// Sonda explícita de solo lectura. No carga dotenv ni crea tablas, cuentas o datos.
const { X509Certificate } = require('node:crypto');
const { createRequire } = require('node:module');

function probeOptions(env) {
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS', 'DB_SSL_CA', 'DB_EXPECTED_SERVER_UUID']) {
    if (typeof env[key] !== 'string' || !env[key].trim()) throw new Error('Falta configurar ' + key);
  }
  if (env.DB_SSL !== 'true' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('La sonda exige TLS verificado.');
  if (!/^\d+$/.test(env.DB_PORT) || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535) throw new Error('DB_PORT inválido.');
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(env.DB_EXPECTED_SERVER_UUID)) throw new Error('DB_EXPECTED_SERVER_UUID inválido.');
  const ca = env.DB_SSL_CA.replace(/\\n/g, '\n');
  if (ca.includes('PRIVATE KEY') || !ca.includes('BEGIN CERTIFICATE')) throw new Error('DB_SSL_CA debe ser un certificado PEM.');
  new X509Certificate(ca); // Falla antes de abrir la red si la CA no es legible.
  return {
    host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASS,
    connectTimeout: 10000, ssl: { ca, rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' },
  };
}

async function probe(env = process.env) {
  const options = probeOptions(env);
  // Resuelve exactamente el conector que consume Prisma 6.19.3, sin cargar Prisma ni .env.
  const mariadb = createRequire(require.resolve('@prisma/adapter-mariadb'))('mariadb');
  const drivers = [['mysql2', require('mysql2/promise')], ['Prisma/MariaDB', mariadb]];
  for (const [label, driver] of drivers) {
    const connection = await driver.createConnection(options);
    try {
      const identity = await connection.query('SELECT @@server_uuid AS uuid, VERSION() AS version, DATABASE() AS db');
      const row = label === 'mysql2' ? identity[0][0] : identity[0];
      if (row.uuid !== env.DB_EXPECTED_SERVER_UUID || row.db !== env.DB_NAME) throw new Error('Destino distinto del esperado.');
      const result = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
      const cipher = label === 'mysql2' ? result[0][0] : result[0];
      if (!cipher?.Value) throw new Error('La sesión no negoció TLS.');
      console.log(label + ': identidad comprobada, TLS activo, MySQL ' + row.version);
    } finally { await connection.end(); }
  }
}

if (require.main === module) probe().catch(() => {
  console.error('No se pudo verificar TLS y el destino MySQL; no se muestran credenciales ni errores internos.');
  process.exitCode = 1;
});
module.exports = { probeOptions, probe };
