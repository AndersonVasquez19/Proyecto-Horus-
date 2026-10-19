const { run } = require('./assign-role-lib.cjs');
// Asigna un rol administrativo a una cuenta existente. Simula por defecto; ver docs/procedimientos/roles-administrativos.md.
//
// La configuración se carga ANTES de validar nada: database.cjs ejecuta dotenv (archivo .env del directorio actual) y, al importar
// @prisma/client, Prisma carga además backend/.env para las variables que falten. Se resuelve una sola vez con options() y la conexión se
// abre forzando ese mismo host, puerto y base, de modo que lo confirmado con --destino es exactamente lo que se usa.
function dependencies(database) {
  return {
    resolveConfig: () => database.options(),
    connect: dest => database.connect({ host: dest.host, port: dest.port, database: dest.database }),
  };
}

if (require.main === module) {
  let deps;
  try { deps = dependencies(require('./database.cjs')); } catch {
    console.error('No se pudo cargar la configuración de conexión. No se hizo nada.');
    process.exitCode = 2;
  }
  if (deps) {
    run({ argv: process.argv.slice(2), ...deps, out: message => console.log(message) })
      .then(code => { process.exitCode = code; })
      .catch(() => { console.error('No se pudo completar la operación. Revisa conexión, permisos y que las migraciones 20261014-admin-rol y 20261014-admin-auditoria estén aplicadas. Comprueba el estado real con --listar. No se mostraron datos de la cuenta.'); process.exitCode = 1; });
  }
}

module.exports = { dependencies };
