// Bloque `stats.preinscripciones` (backend/src/admin/stats/stats.academic.ts). Solo recuentos. Las cinco primeras categorías de estado
// son EXCLUYENTES (cada preinscripción cuenta una vez, según su estado actual) y `total` es su suma; `vigentes` = recibidas + validadas +
// convertidas; `pendientesRevision` es un subconjunto de `recibidas` (las de una edición que todavía admite validar). «Convertidas» es el
// estado `matriculada` del backend.
export type PreregistrationStats = {
  total: number; vigentes: number; recibidas: number; pendientesRevision: number;
  validadas: number; convertidas: number; descartadas: number; desistidas: number;
};

export type OperationalStats = {
  ok: true;
  stats: {
    academico: { estudiantes: number; edicionesActivas: number; matriculasRegistradas: number; matriculasVigentes: number };
    mensajes: { total: number; nuevos: number; enProceso: number; atendidos: number; archivados: number; pendientes: number };
    // Aditivo. Ausente (backend anterior) o `null` (módulo no disponible) = «No disponible», nunca ceros. Se interpreta con
    // `readPreregistrations`, que no deja que un bloque defectuoso invalide los demás indicadores.
    preinscripciones?: unknown;
  };
  actividadReciente: { mensajes: { id: number; nombre: string; asunto: string; estado: string; createdAt: string }[] };
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const PREREGISTRATION_KEYS = ['total', 'vigentes', 'recibidas', 'pendientesRevision', 'validadas', 'convertidas', 'descartadas', 'desistidas'] as const;

// Interpreta el bloque de preinscripciones. Devuelve null («No disponible») si falta, es null o no es coherente: nunca inventa ceros.
// `total` y `vigentes` salen de la misma consulta del servidor, así que deben coincidir con la suma de sus estados; si no, el bloque
// no es de fiar y no se muestra. `pendientesRevision` se calcula con otra consulta y se limita a `recibidas`, de la que es parte.
export function readPreregistrations(data: unknown): PreregistrationStats | null {
  if (!object(data) || !object(data.stats)) return null;
  const block = data.stats.preinscripciones;
  if (!object(block) || !PREREGISTRATION_KEYS.every(key => count(block[key]))) return null;
  const n = block as Record<(typeof PREREGISTRATION_KEYS)[number], number>;
  if (n.total !== n.recibidas + n.validadas + n.convertidas + n.descartadas + n.desistidas) return null;
  if (n.vigentes !== n.recibidas + n.validadas + n.convertidas) return null;
  return { total: n.total, vigentes: n.vigentes, recibidas: n.recibidas, pendientesRevision: Math.min(n.pendientesRevision, n.recibidas),
    validadas: n.validadas, convertidas: n.convertidas, descartadas: n.descartadas, desistidas: n.desistidas };
}

export function isOperationalStats(value: unknown): value is OperationalStats {
  if (!object(value) || value.ok !== true || !object(value.stats) || !object(value.actividadReciente)) return false;
  const { academico, mensajes } = value.stats;
  return object(academico) && ['estudiantes', 'edicionesActivas', 'matriculasRegistradas', 'matriculasVigentes'].every(key => count(academico[key]))
    && object(mensajes) && ['total', 'nuevos', 'enProceso', 'atendidos', 'archivados', 'pendientes'].every(key => count(mensajes[key]))
    && Array.isArray(value.actividadReciente.mensajes) && value.actividadReciente.mensajes.every(row => object(row) && count(row.id)
      && typeof row.nombre === 'string' && typeof row.asunto === 'string' && typeof row.estado === 'string'
      && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)));
}
