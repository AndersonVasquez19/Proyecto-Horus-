'use strict';
// FASE C.4 - Cliente Node 22 que conecta como avnadmin y delega en aiven-grants-horus-app-lib.cjs.
// Lo lanza aplicar-grants-horus-app-aiven.ps1. La contrasena llega SOLO por stdin (JSON UTF-8 sin BOM):
// nunca por argumentos, variables de entorno ni archivos. Argumentos no secretos:
//   --modo=prechequeo|verificar|aplicar   --host-app=<host>   --confirmado
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const { createRequire } = require('node:module');
const lib = require('./aiven-grants-horus-app-lib.cjs');

const CA_FILE = 'C:/Horus-Secure/Aiven/ca.pem';
let connection;
let input;
let config;
let phase = 'preparacion';
let code = '';
let detail = '';

function arg(name) {
  const prefix = '--' + name + '=';
  const found = process.argv.slice(2).find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function fail() {
  // Solo fase, codigo tecnico y un texto propio y fijo; nunca mensajes del servidor, SQL ni credenciales.
  process.stderr.write('Fallo (' + phase + ')' + (code ? ' [' + code + ']' : '') + (detail ? ': ' + detail : '') + '\n');
  process.exitCode = 1;
}

const timer = setTimeout(() => { fail(); process.exit(1); }, 120000);
process.on('uncaughtException', () => { fail(); process.exit(1); });
process.on('unhandledRejection', () => { fail(); process.exit(1); });

(async () => {
  try {
    if (process.versions.node.split('.')[0] !== '22') { phase = 'version-node'; throw new Error(); }
    phase = 'lectura-stdin';
    input = fs.readFileSync(0);
    config = JSON.parse(input.toString('utf8'));
    input.fill(0);
    input = null;
    if (typeof config.password !== 'string' || config.password.length === 0) { phase = 'contrasena-vacia'; throw new Error(); }

    phase = 'dependencias';
    const mariadb = createRequire(path.join(process.cwd(), 'package.json'))('mariadb');
    const host = lib.SERVICE.host;
    let hostnameVerified = false;
    phase = 'conexion-tls';
    // Sin base seleccionada. TLS con CA de Aiven y comprobacion del nombre del servidor.
    connection = await mariadb.createConnection({
      host, port: lib.SERVICE.port, user: lib.SERVICE.admin,
      password: config.password,
      ssl: {
        ca: fs.readFileSync(CA_FILE, 'utf8'),
        rejectUnauthorized: true,
        servername: host,
        minVersion: 'TLSv1.2',
        checkServerIdentity: (_name, cert) => {
          const error = tls.checkServerIdentity(host, cert);
          if (!error) hostnameVerified = true;
          return error;
        }
      },
      connectTimeout: 15000, socketTimeout: 30000,
      multipleStatements: false, permitLocalInfile: false,
      debug: false, debugCompress: false, trace: false, logger: { warning: () => {} }
    });
    config.password = null;
    config = null;
    if (!hostnameVerified) { phase = 'verificacion-tls'; throw new Error(); }
    const status = await connection.query("SHOW SESSION STATUS WHERE Variable_name = 'Ssl_version'");
    if (!status[0] || !/^TLSv1\.[23]$/.test(String(status[0].Value))) { phase = 'verificacion-tls'; throw new Error(); }
    process.stdout.write('TLS verificado: ' + status[0].Value + ', CA y nombre de servidor comprobados.\n');

    phase = 'ejecucion';
    await lib.run({
      conn: connection,
      modo: arg('modo') || 'prechequeo',
      hostApp: arg('host-app'),
      confirmado: process.argv.includes('--confirmado'),
      log: line => process.stdout.write(line + '\n')
    });
    await connection.end();
    connection = null;
  } catch (error) {
    if (error instanceof lib.StopError) { phase = error.phase; detail = error.safeMessage; }
    code = lib.safeCode(error) || code;
    fail();
  } finally {
    if (input) input.fill(0);
    if (config) config.password = null;
    if (connection) connection.destroy();
    clearTimeout(timer);
  }
})();
