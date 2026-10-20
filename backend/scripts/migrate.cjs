const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { connect } = require('./database.cjs');
const versions = ['20260909-create-catalogo', '20260921-create-cotizaciones', '20261002-complete-institutional', '20261002-original-design', '20261002-create-convenios', '20261003-remove-otros-category', '20261009-chatbot-metrics', '20261010-newsletter-default-novedades', '20261011-cotizaciones-idempotencia', '20261014-admin-rol', '20261014-admin-auditoria', '20261015-academico-estructura', '20261016-academico-solo-dni', '20261018-convocatorias-capacidad', '20261019-importaciones-academicas'];
// Una migración que no puede aplicarse sin decidir antes qué hacer con datos existentes se detiene con este error. Su mensaje
// se muestra tal cual: solo contiene recuentos, nunca valores de las filas.
class MigracionDetenida extends Error {}
// 20261016-academico-solo-dni (E4.3b): el módulo académico admite solo DNI peruano (PE + exactamente 8 dígitos ASCII). Sus dos
// ALTER TABLE son DDL (cada uno atómico, con commit implícito, pero no juntos), así que ANTES de la primera sentencia se comprueba
// que todas las filas cumplen ya la regla nueva (las mismas condiciones que los CHECK de la migración). Si alguna no la cumple
// (CE, PASAPORTE o un DNI que la regla nueva rechaza, como uno con un salto de línea final), la migración se detiene sin modificar
// datos ni estructura: nada se convierte, borra ni anonimiza. Como cada ALTER es idempotente (quita y vuelve a crear el CHECK con
// el mismo nombre y redefine el ENUM), una ejecución interrumpida entre ambos se completa al repetir db:migrate, que vuelve a
// hacer esta comprobación. Si una fila no DNI llegara entre la comprobación y el ALTER, MySQL rechaza el ALTER sin cambiar nada
// (1265 en modo estricto, 3819 en modo no estricto; comprobado en test/academico-schema.integration.cjs).
const DNI_VALIDO = (pais, tipo, numero) => `COALESCE(${tipo} = 'DNI' AND REGEXP_LIKE(${pais}, '^PE$', 'c') AND REGEXP_LIKE(${numero}, '^[0-9]{8}$', 'c') AND CHAR_LENGTH(${numero}) = 8, FALSE)`;
async function documentosNoDni(db) {
  const [rows] = await db.query(
    "SELECT 'estudiantes' AS tabla, CAST(doc_tipo AS CHAR) AS tipo, COUNT(*) AS n FROM estudiantes WHERE doc_tipo IS NOT NULL AND NOT " + DNI_VALIDO('doc_pais', 'doc_tipo', 'doc_numero') + ' GROUP BY 1, 2'
    + " UNION ALL SELECT 'certificados', CAST(estudiante_doc_tipo AS CHAR), COUNT(*) FROM certificados WHERE NOT " + DNI_VALIDO('estudiante_doc_pais', 'estudiante_doc_tipo', 'estudiante_doc_numero') + ' GROUP BY 1, 2');
  if (!rows.length) return;
  const detalle = rows.map(row => row.tabla + ': ' + (row.tipo === 'DNI' ? 'DNI con formato no admitido' : row.tipo ? row.tipo : 'tipo vacío') + ' ' + Number(row.n)).join('; ');
  throw new MigracionDetenida('Migración 20261016-academico-solo-dni detenida antes de modificar datos o estructura: hay documentos que no son un DNI peruano válido (' + detalle + '). '
    + 'No se convierten, borran ni anonimizan; hay que decidir qué hacer con esos registros antes de volver a ejecutar db:migrate.');
}
const preconditions = { '20261016-academico-solo-dni': documentosNoDni };
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
        if (preconditions[name]) await preconditions[name](db);
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
if (require.main === module) migrate().catch(error => {
  console.error(error instanceof MigracionDetenida ? error.message : 'No se pudo aplicar la migración. Revisa conexión, permisos y esquema de MySQL.');
  process.exitCode = 1;
});
module.exports = { applySql, migrate, versions, preconditions, MigracionDetenida };
