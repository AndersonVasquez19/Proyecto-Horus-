// Ayudas para las integraciones académicas desechables de OTROS módulos tras 20261020-preinscripciones.
'use strict';

// Desde 20261020-preinscripciones toda edición creada por la API exige 10 preinscripciones VALIDADAS para abrirse. Las suites de otros
// módulos (Ediciones, Docentes, Sesiones…) que solo necesitan una edición abierta cumplen la regla real —sin atajos ni parámetros—
// insertando por SQL esas 10 filas ya validadas en SU base desechable.
async function validatedPreinscripciones(db, convocatoriaId, count = 10, prefix = 'fx') {
  for (let i = 1; i <= count; i++) {
    await db.execute(
      "INSERT INTO preinscripciones (convocatoria_id,nombres,apellidos,email,telefono,canal,estado,consentimiento_at,aviso_version) VALUES (?,?,?,?,?,'formulario','validada',NOW(3),'preinscripcion-v1')",
      [convocatoriaId, 'Ficticia ' + i, 'Prueba', prefix + '-' + convocatoriaId + '-' + i + '@preinscripciones.test', '900000' + String(100 + i)]);
  }
}

// Las suites de Docentes y Sesiones aplican db:migrate COMPLETO sobre una base anterior a su migración, así que también se aplica
// 20261020-preinscripciones. Esta función retira de una instantánea (tablas, DDL y filas) lo que añade esa migración, para que sigan
// comparando únicamente lo que verifican: sus tablas nuevas, el ENUM del historial y que los datos previos no cambien.
const LATER_TABLES = ['preinscripciones', 'preinscripciones_historial'];
const LATER_EDITION_COLUMNS = ['minimo_apertura', 'preinscripcion_estado', 'codigo_publico'];
const dropLines = (ddl, patterns) => ddl.split('\n').filter(line => !patterns.some(pattern => pattern.test(line))).join('\n').replace(/,\n\) ENGINE/, '\n) ENGINE');

function withoutPreinscripciones(snapshot) {
  const result = {};
  for (const [table, entry] of Object.entries(snapshot)) {
    if (LATER_TABLES.includes(table)) continue;
    if (table === 'convocatorias') {
      const rows = JSON.parse(entry.rows).map(row => { for (const column of LATER_EDITION_COLUMNS) delete row[column]; return row; });
      result[table] = { ddl: dropLines(entry.ddl, [/`minimo_apertura`/, /`preinscripcion_estado`/, /`codigo_publico`/, /convocatorias_codigo_publico_uq/, /convocatorias_minimo_chk/, /convocatorias_codigo_chk/]), rows: JSON.stringify(rows) };
    } else if (table === 'matriculas') {
      result[table] = { ddl: dropLines(entry.ddl, [/matriculas_id_relaciones_uq/]), rows: entry.rows };
    } else result[table] = entry;
  }
  return result;
}

module.exports = { validatedPreinscripciones, withoutPreinscripciones };
