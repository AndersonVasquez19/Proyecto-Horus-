import { BadRequestException } from '@nestjs/common';
import type { PreinscripcionCanal, PreinscripcionEstado, PreinscripcionOperacion, Prisma } from '@prisma/client';
import { findPersonalData, PERSONAL_DATA_MESSAGE, SAFE_FIELD } from './preinscripciones.privacy';

// Historial propio de las preinscripciones (no usa academico_historial, cuyo ENUM pertenece a otros módulos). Se escribe en la MISMA
// transacción que el cambio: si falla, no se aplica ninguno de los dos. Guarda NOMBRES de campos, códigos de control («control:…») y estados,
// que son etiquetas del sistema; nunca valores personales. El único texto libre es `motivo`, que no admite correos, teléfonos, documentos
// ni credenciales (DTO + esta segunda barrera por si otro llamador omite la validación).
export interface HistoryEntry {
  operacion: PreinscripcionOperacion;
  revision: number;
  canal?: PreinscripcionCanal; // solo en la creación (la hace el visitante, sin actor)
  actor_id?: number; // todas las demás operaciones
  estado_anterior?: PreinscripcionEstado;
  estado_nuevo?: PreinscripcionEstado;
  campos?: string[];
  motivo?: string;
}

export async function recordHistory(tx: Prisma.TransactionClient, preinscripcionId: number, entry: HistoryEntry) {
  // Se revierte TODA la operación antes que guardar un dato personal en el historial; el mensaje no repite el dato.
  if (entry.campos?.some(field => !SAFE_FIELD.test(field))) throw new Error('El historial solo admite nombres de campo y códigos de control.');
  if (entry.motivo !== undefined && findPersonalData(entry.motivo)) throw new BadRequestException(PERSONAL_DATA_MESSAGE);
  const account = entry.actor_id === undefined ? null : await tx.adminUser.findUnique({ where: { id: entry.actor_id }, select: { rol: true } });
  await tx.preinscripcionHistorial.create({ data: {
    preinscripcion_id: preinscripcionId, operacion: entry.operacion, revision: entry.revision, canal: entry.canal,
    actor_id: entry.actor_id, actor_rol: account?.rol ?? undefined,
    estado_anterior: entry.estado_anterior, estado_nuevo: entry.estado_nuevo, campos: entry.campos, motivo: entry.motivo,
  } });
}
