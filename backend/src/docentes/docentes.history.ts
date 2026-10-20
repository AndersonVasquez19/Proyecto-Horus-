import { Prisma } from '@prisma/client';

type Operacion = 'creacion' | 'edicion' | 'cambio_estado' | 'sustitucion';

// Historial académico de solo inserción, en la MISMA transacción que el cambio: si falla, no se aplica ninguno de los dos.
// Guarda quién (id y rol de ese momento), cuándo, los estados y los NOMBRES de los campos tocados. Nunca valores ni datos personales.
export async function recordHistory(tx: Prisma.TransactionClient, entry: {
  entidad: 'docente' | 'asignacion_docente'; id: number; actor: number; operacion: Operacion; campos: string[]; revision: number;
  anterior?: string; nuevo?: string; motivo?: string;
}) {
  const account = await tx.adminUser.findUnique({ where: { id: entry.actor }, select: { rol: true } });
  await tx.academicoHistorial.create({ data: {
    entidad: entry.entidad, entidad_id: entry.id, origen: 'panel', actor_id: entry.actor, actor_rol: account?.rol, operacion: entry.operacion,
    campos: entry.campos, revision: entry.revision, estado_anterior: entry.anterior, estado_nuevo: entry.nuevo, motivo: entry.motivo,
  } });
}
