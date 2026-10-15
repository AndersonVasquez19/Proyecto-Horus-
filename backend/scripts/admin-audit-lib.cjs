// Auditoría de los scripts administrativos de terminal (H-BACK-01, E3.2): admin:assign-role y admin:create escriben en admin_auditoria
// (migración 20261014-admin-auditoria) con origen 'terminal', dentro de la misma transacción que el cambio.
//
// --operador identifica a la persona que DECLARA ejecutar el script; no es una autenticación: quien tiene acceso a la terminal y a las
// credenciales de la base puede escribir cualquier valor. Sirve como constancia, no como control de acceso.
// Para no guardar datos personales de más, el operador es un identificador corto (iniciales, código de puesto) y ni el operador ni el
// motivo admiten '@' (correos) ni caracteres de control.

const AUDIT_MIGRATION = '20261014-admin-auditoria';
const AUDIT_COLUMNS = ['origen', 'actor_id', 'operador', 'cuenta_id', 'operacion', 'rol_anterior', 'rol_nuevo', 'activo_anterior', 'activo_nuevo', 'resultado', 'motivo'];
const OPERATOR = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function declaredOperator(value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, message: 'Identifica a la persona que ejecuta la operación con --operador=<identificador> (iniciales o código de puesto).' };
  if (text.length < 2 || text.length > 100 || !OPERATOR.test(text)) {
    return { ok: false, message: '--operador debe tener entre 2 y 100 caracteres: letras, números, espacios, punto, guion o guion bajo (sin correos).' };
  }
  return { ok: true, value: text };
}

function declaredReason(value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, message: 'Indica el motivo de la operación con --motivo=<texto>.' };
  if (text.length < 5 || text.length > 200 || CONTROL.test(text) || text.includes('@')) {
    return { ok: false, message: '--motivo debe tener entre 5 y 200 caracteres, en una sola línea y sin correos. No incluyas contraseñas ni datos personales.' };
  }
  return { ok: true, value: text };
}

// Devuelve null si la tabla de auditoría tiene las columnas que usan los scripts, o el mensaje que indica aplicar la migración.
async function auditMissing(db) {
  const [rows] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_auditoria'");
  const present = new Set(rows.map(row => String(row.COLUMN_NAME)));
  const missing = AUDIT_COLUMNS.filter(column => !present.has(column));
  if (!missing.length) return null;
  return (present.size ? 'La tabla admin_auditoria está incompleta.' : 'La base no tiene la tabla admin_auditoria.') +
    ' Respalda y aplica antes la migración ' + AUDIT_MIGRATION + ' (npm run db:migrate).';
}

module.exports = { AUDIT_MIGRATION, AUDIT_COLUMNS, declaredOperator, declaredReason, auditMissing };
