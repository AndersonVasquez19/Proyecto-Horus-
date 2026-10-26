const { createInterface } = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { run } = require('./create-admin-lib.cjs');
// Crea una cuenta administrativa SIN ROL y la registra en admin_auditoria. Ver create-admin-lib.cjs y
// docs/procedimientos/roles-administrativos.md. La configuración se resuelve una vez (database.cjs: .env del directorio actual y backend/.env).
function dependencies(database, bcrypt) {
  return {
    resolveConfig: () => database.options(),
    connect: dest => database.connect({ host: dest.host, port: dest.port, database: dest.database }),
    // La contraseña inicial se lee una vez y se retira del entorno del proceso.
    readPassword: () => { const value = process.env.ADMIN_INITIAL_PASSWORD; delete process.env.ADMIN_INITIAL_PASSWORD; return value; },
    hash: password => bcrypt.hash(password, 12),
  };
}

if (require.main === module) {
  let deps;
  try { deps = dependencies(require('./database.cjs'), require('bcryptjs')); } catch {
    console.error('No se pudo cargar la configuración de conexión. No se creó la cuenta.');
    process.exitCode = 2;
  }
  if (deps) {
    // El iterador conserva las líneas que llegan antes de cada pregunta (entrada canalizada); question() las perdería.
    const prompt = createInterface({ input: stdin, output: stdout });
    const lines = prompt[Symbol.asyncIterator]();
    const ask = async question => { stdout.write(question); const line = await lines.next(); return line.done ? '' : line.value; };
    run({ argv: process.argv.slice(2), ...deps, ask, out: message => console.log(message) })
      .then(code => { process.exitCode = code; })
      .catch(() => { console.error('No se creó la cuenta. Revisa conexión, permisos y que las migraciones 20261014-admin-rol y 20261014-admin-auditoria estén aplicadas.'); process.exitCode = 1; })
      .finally(() => prompt.close());
  }
}

module.exports = { dependencies };
