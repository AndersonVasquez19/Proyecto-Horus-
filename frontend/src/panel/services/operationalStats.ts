export type OperationalStats = {
  ok: true;
  stats: {
    academico: { estudiantes: number; edicionesActivas: number; matriculasRegistradas: number; matriculasVigentes: number };
    mensajes: { total: number; nuevos: number; enProceso: number; atendidos: number; archivados: number; pendientes: number };
  };
  actividadReciente: { mensajes: { id: number; nombre: string; asunto: string; estado: string; createdAt: string }[] };
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function isOperationalStats(value: unknown): value is OperationalStats {
  if (!object(value) || value.ok !== true || !object(value.stats) || !object(value.actividadReciente)) return false;
  const { academico, mensajes } = value.stats;
  return object(academico) && ['estudiantes', 'edicionesActivas', 'matriculasRegistradas', 'matriculasVigentes'].every(key => count(academico[key]))
    && object(mensajes) && ['total', 'nuevos', 'enProceso', 'atendidos', 'archivados', 'pendientes'].every(key => count(mensajes[key]))
    && Array.isArray(value.actividadReciente.mensajes) && value.actividadReciente.mensajes.every(row => object(row) && count(row.id)
      && typeof row.nombre === 'string' && typeof row.asunto === 'string' && typeof row.estado === 'string'
      && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)));
}
