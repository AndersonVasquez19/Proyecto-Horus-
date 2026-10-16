const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { connect } = require('./database.cjs');
const versions = ['20260909-create-catalogo', '20260921-create-cotizaciones', '20261002-complete-institutional', '20261002-original-design', '20261002-create-convenios', '20261003-remove-otros-category', '20261009-chatbot-metrics', '20261010-newsletter-default-novedades', '20261011-cotizaciones-idempotencia', '20261014-admin-rol', '20261014-admin-auditoria', '20261015-academico-estructura'];
async function applySql(db, name) {
  const sql = readFileSync(join(__dirname, '../migrations', name + '.sql'), 'utf8');
  for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
}
async function migrate() {
  const db = await connect();
  let locked = false;
  try {
    const [[result]] = await db.query("SELECT GET_LOCK('horus_catalogo_migrations', 10) AS acquired");
    if (Number(result.acquired) !== 1) throw new Error('Otra migración está en ejecución.');
    locked = true;
    await db.query('CREATE TABLE IF NOT EXISTS horus_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)');
    for (const name of versions) {
      const [existing] = await db.execute('SELECT name FROM horus_migrations WHERE name = ?', [name]);
      if (!existing.length) {
        await applySql(db, name);
        await db.execute('INSERT INTO horus_migrations (name, applied_at) VALUES (?, ?)', [name, new Date()]);
      }
    }
    console.log('Migraciones aplicadas. Se conservó el historial y no se insertaron datos de ejemplo.');
  } finally {
    try { if (locked) await db.query("SELECT RELEASE_LOCK('horus_catalogo_migrations')"); }
    finally { await db.end(); }
  }
}
if (require.main === module) migrate().catch(() => {
  console.error('No se pudo aplicar la migración. Revisa conexión, permisos y esquema de MySQL.');
  process.exitCode = 1;
});
module.exports = { applySql, migrate, versions };
