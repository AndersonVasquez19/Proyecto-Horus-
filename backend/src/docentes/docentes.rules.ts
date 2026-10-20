import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';

// Reglas puras del equipo docente de una edición. Se prueban sin base de datos (test/docentes.test.ts).

// El equipo docente se modifica mientras la edición no esté archivada ni cancelada. Una edición cerrada admite cambios: sirve para
// registrar quién dictó una edición ya terminada. Retirar a un docente se permite siempre (ver AsignacionesService.retire).
export function assertEditionAcceptsTeachers(edition: { estado: string; archivado_at: Date | null }) {
  if (edition.archivado_at) throw new ConflictException('La edición está archivada: su equipo docente no se modifica.');
  if (edition.estado === 'cancelada') throw new ConflictException('La edición está cancelada: su equipo docente no se modifica.');
}

// Un docente inactivo conserva sus asignaciones históricas, pero no recibe asignaciones nuevas ni se reactivan las retiradas.
export function assertTeacherActive(teacher: { activo: boolean }) {
  if (!teacher.activo) throw new ConflictException('El docente está inactivo. Actívalo antes de asignarlo a una edición.');
}

export const PRINCIPAL_EXISTS = 'La edición ya tiene un docente principal activo. Cambia su rol, retíralo o sustitúyelo antes.';

// Traduce los errores conocidos de la base a respuestas seguras (sin SQL, nombres de índices ni valores).
export function translateDatabaseError(error: unknown, messages: { unique: string; outdated: string; concurrent: string }): never {
  if (isUniqueViolation(error)) throw new ConflictException(messages.unique);
  if (isSchemaOutdated(error)) throw new ServiceUnavailableException(messages.outdated);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new ConflictException(messages.concurrent);
  throw error;
}

// Nombres de los campos que cambian en una edición parcial: es lo único que llega al historial (nunca sus valores).
export function changedFieldNames(fields: Record<string, unknown>): string[] {
  return Object.keys(fields).filter(key => fields[key] !== undefined);
}
