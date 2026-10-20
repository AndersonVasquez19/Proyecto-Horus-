import { Prisma } from '@prisma/client';

type Operacion = 'creacion' | 'edicion' | 'cambio_estado' | 'reprogramacion';

// Historial académico de solo inserción, en la MISMA transacción que el cambio: si falla, no se aplica ninguno de los dos. Guarda quién
// (id y rol de ese momento), cuándo, los estados y los NOMBRES de los campos tocados, nunca sus valores. Excepción justificada: en una
// reprogramación, estado_anterior y estado_nuevo llevan la programación («2026-11-05 14:00-16:00», hora de Lima): es información del
// calendario, no un dato personal, y es lo que permite saber de qué día y hora se movió la clase.
export async function recordSessionHistory(tx: Prisma.TransactionClient, entry: {
  id: number; actor: number; operacion: Operacion; campos: string[]; revision: number; anterior?: string; nuevo?: string; motivo?: string;
}) {
  const account = await tx.adminUser.findUnique({ where: { id: entry.actor }, select: { rol: true } });
  await tx.academicoHistorial.create({ data: {
    entidad: 'sesion', entidad_id: entry.id, origen: 'panel', actor_id: entry.actor, actor_rol: account?.rol, operacion: entry.operacion,
    campos: entry.campos, revision: entry.revision, estado_anterior: entry.anterior, estado_nuevo: entry.nuevo, motivo: entry.motivo,
  } });
}
