// Reglas puras de la verificación pública de certificados: sin base de datos ni NestJS, para probarlas sin MySQL.
//
// Alcance (simplificación académica): los certificados ya no se emiten, anulan ni imprimen desde la plataforma (se preparan y entregan
// de forma presencial). Se conserva ÚNICAMENTE la consulta pública por código, porque los documentos ya entregados pueden llevar
// impreso un QR que apunta a ella. El código es aleatorio de 100 bits (alfabeto de 32 símbolos sin los confusos 0/O y 1/I) y cumple
// el CHECK de MySQL ^[A-Z0-9]{16,32}$.
export const CODE_PATTERN = /^[A-Z0-9]{16,32}$/;

// Entrada pública: se normaliza (espacios y mayúsculas) y solo se consulta la base si el formato es el de un código real.
export function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

const day = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;

// Vista PÚBLICA de verificación. Mínima a propósito: nombre completo (para cotejar con el documento impreso), curso y fechas. Nunca
// el DNI, el motivo de una anulación, quién emitió ni identificadores internos.
export function publicView(row: {
  estado: string; estudiante_nombres: string; estudiante_apellidos: string; curso_titulo: string; curso_tipo: string; curso_duracion: string | null;
  convocatoria_nombre: string; convocatoria_fecha_inicio: Date | null; convocatoria_fecha_fin: Date | null; emitido_at: Date; sustituido_por: { id: number } | null;
}) {
  return {
    ok: true, valido: row.estado === 'vigente', estado: row.estado, sustituido: row.sustituido_por !== null,
    estudiante: `${row.estudiante_nombres} ${row.estudiante_apellidos}`.trim(),
    curso: { titulo: row.curso_titulo, tipo: row.curso_tipo, duracion: row.curso_duracion },
    convocatoria: { nombre: row.convocatoria_nombre, fecha_inicio: day(row.convocatoria_fecha_inicio), fecha_fin: day(row.convocatoria_fecha_fin) },
    emitido: day(row.emitido_at),
  };
}

export const CERTIFICATE_NOT_FOUND = 'No se encontró un certificado con ese código.';
