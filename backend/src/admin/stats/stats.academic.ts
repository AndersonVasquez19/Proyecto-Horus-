import type { PreinscripcionEstado } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import { isSchemaOutdated } from '../../database/serialization';
import { ESTADOS_VIGENTES } from '../../preinscripciones/preinscripciones.rules';

// Indicadores de Preinscripciones del Resumen operativo. Solo CONTEOS: ninguna consulta selecciona nombres, correos,
// teléfonos ni DNI, así que la respuesta no puede filtrarlos. Cada bloque usa agregados (groupBy / count) en paralelo: no hay N+1.
// Cada recuento significa lo mismo que en su módulo (reglas importadas, no copiadas).

export interface PreinscripcionesStats {
  total: number;
  vigentes: number;            // recibida + validada + matriculada (ESTADOS_VIGENTES: las que siguen contando para la edición)
  recibidas: number;           // solicitudes sin revisar
  pendientesRevision: number;  // recibidas cuya edición todavía admite validar (planificada o abierta, sin archivar)
  validadas: number;           // aprobadas, aún sin matrícula
  convertidas: number;         // estado «matriculada»
  descartadas: number;         // rechazadas por la administración
  desistidas: number;          // el solicitante desistió
}

const ZERO_PRE: Record<PreinscripcionEstado, number> = { recibida: 0, validada: 0, matriculada: 0, desistida: 0, descartada: 0 };

// Alcance de Preinscripciones: ediciones sin archivar (una edición archivada ya no gestiona solicitudes). Todo el bloque usa el mismo.
export const PREINSCRIPCIONES_SCOPE = { convocatoria: { archivado_at: null } } as const;

type Db = Pick<PrismaService, 'preinscripcion'>;

// Si la base aún no tiene las tablas (migraciones pendientes) el bloque queda en null —«no disponible», nunca ceros inventados— y el
// resto del resumen sigue funcionando. Cualquier otro error se propaga.
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); }
  catch (error) { if (isSchemaOutdated(error)) return null; throw error; }
}

export function preinscripcionesStats(prisma: Db): Promise<PreinscripcionesStats | null> {
  return optional(async () => {
    const [groups, actionable] = await Promise.all([
      prisma.preinscripcion.groupBy({ by: ['estado'], where: PREINSCRIPCIONES_SCOPE, _count: { _all: true } }),
      prisma.preinscripcion.count({ where: { estado: 'recibida', convocatoria: { archivado_at: null, estado: { in: ['planificada', 'abierta'] } } } }),
    ]);
    const by = { ...ZERO_PRE };
    for (const group of groups) by[group.estado] += group._count._all;
    return {
      total: Object.values(by).reduce((sum, value) => sum + value, 0),
      vigentes: ESTADOS_VIGENTES.reduce((sum, state) => sum + by[state], 0),
      recibidas: by.recibida, pendientesRevision: actionable, validadas: by.validada,
      convertidas: by.matriculada, descartadas: by.descartada, desistidas: by.desistida,
    };
  });
}
