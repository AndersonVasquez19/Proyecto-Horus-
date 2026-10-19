// Mantenimiento explícito: nunca se invoca durante install, build, arranque o migraciones.
const { resolve } = require('node:path');
const { readFile } = require('node:fs/promises');

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const baseArg = args.find(arg => arg.startsWith('--api-base='));
  if (args.some(arg => arg !== '--apply' && arg !== '--preview' && !arg.startsWith('--api-base=')))
    throw new Error('Usa --preview o --apply --api-base=https://dominio.example/api.');
  const { initialConvenios } = require('../dist/convenios/initial-content');
  if (!apply) {
    console.log(JSON.stringify(initialConvenios.map(row => ({ ...row, fotos: [] })), null, 2));
    console.log('Vista previa: no se abrió MySQL ni se escribieron archivos.');
    return;
  }
  if (!baseArg) throw new Error('Especifica --api-base con la URL pública de la API para los logos.');
  const base = new URL(baseArg.slice('--api-base='.length));
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('La URL pública debe ser HTTP/HTTPS, sin credenciales, query ni fragmento.');
  require('dotenv').config({ quiet: true });
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST || 'localhost'))
    throw new Error('Esta importación inicial solo está habilitada para MySQL local de desarrollo.');
  const { connect, prisma } = require('./database.cjs');
  const { check } = require('./check-database.cjs');
  const { ConfigService } = require('@nestjs/config');
  const { UploadsService, imageExtension } = require('../dist/uploads/uploads.service');
  const { importConvenios } = require('../dist/convenios/convenios.import');
  const sources = new Map();
  for (const row of initialConvenios) {
    if (sources.has(row.logoFile)) continue;
    const buffer = await readFile(resolve(__dirname, '../..', row.logoFile));
    if (buffer.length > 5 * 1024 * 1024 || !imageExtension(buffer)) throw new Error('Logo inválido: ' + row.logoFile);
    sources.set(row.logoFile, buffer);
  }
  const db = await connect();
  let client, locked = false;
  try {
    const [[result]] = await db.query("SELECT GET_LOCK('horus_import_convenios', 10) AS acquired");
    if (Number(result.acquired) !== 1) throw new Error('Hay otra importación en curso.');
    locked = true;
    const problems = await check(db);
    if (problems.length) throw new Error('Aplica primero las migraciones y verifica el esquema.');
    client = prisma();
    const uploads = new UploadsService(new ConfigService(process.env));
    const counts = await importConvenios(client, async file => {
      const { path } = await uploads.save(sources.get(file));
      return base.origin + base.pathname.replace(/\/$/, '') + path;
    });
    console.log(JSON.stringify(counts));
    console.log('Los convenios existentes y sus ediciones se conservaron. No se añadieron fotos.');
  } finally {
    if (client) await client.$disconnect();
    if (locked) await db.query("SELECT RELEASE_LOCK('horus_import_convenios')");
    await db.end();
  }
}
if (require.main === module) main().catch(error => {
  // No mostrar errores de drivers que puedan contener detalles internos.
  console.error(error instanceof Error && !error.code ? error.message : 'No se pudo importar; revisa configuración, esquema y permisos.');
  process.exitCode = 1;
});
