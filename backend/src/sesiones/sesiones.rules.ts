import { ConflictException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';
import type { SesionEstadoValue, SesionModalidadValue } from './sesiones.dto';

// Reglas puras de las sesiones académicas. Se prueban sin base de datos (test/sesiones.test.ts).

// Intervalo [inicio, fin): la hora final es posterior a la inicial dentro del mismo día; una sesión que termina justo cuando empieza otra no
// se solapa con ella. Las horas ya llegan como HH:MM de dos dígitos, así que comparar las cadenas equivale a comparar las horas.
// No hay cruce de medianoche: una clase que pasa de las 23:59 se registra como dos sesiones (decisión pendiente en la documentación).
export function assertValidInterval(inicio: string, fin: string) {
  if (fin <= inicio) throw new UnprocessableEntityException('La hora de fin debe ser posterior a la de inicio (el intervalo no puede ser vacío ni cruzar la medianoche).');
}

// El solapamiento de dos intervalos [a, b) y [c, d): empiezan antes de que el otro termine.
export const overlaps = (a: { inicio: string; fin: string }, b: { inicio: string; fin: string }) => a.inicio < b.fin && b.inicio < a.fin;

// Presencial: sin enlace; virtual: sin lugar físico; híbrida admite ambos. No se exige ninguno: el lugar o el enlace pueden definirse después.
export function assertModalityFits(modalidad: SesionModalidadValue, lugar: string | null, enlace: string | null) {
  if (modalidad === 'presencial' && enlace) throw new UnprocessableEntityException('Una sesión presencial no lleva enlace de reunión. Cambia la modalidad a híbrida o quita el enlace.');
  if (modalidad === 'virtual' && lugar) throw new UnprocessableEntityException('Una sesión virtual no lleva lugar físico. Cambia la modalidad a híbrida o quita el lugar.');
}

// La programación de una edición archivada o cancelada no se modifica. Una cerrada sí: sirve para registrar las clases de una edición ya
// terminada y las de una edición completa (cerrada a nuevas matrículas) que sigue dictándose.
export function assertEditionAcceptsSessions(edition: { estado: string; archivado_at: Date | null }) {
  if (edition.archivado_at) throw new ConflictException('La edición está archivada: su programación no se modifica.');
  if (edition.estado === 'cancelada') throw new ConflictException('La edición está cancelada: su programación no se modifica.');
}

export const TEACHER_INACTIVE = 'El docente está inactivo: no se programan sesiones con él. Elige a otro docente o actívalo antes.';
export const TEACHER_NOT_ASSIGNED = 'El docente no está asignado a esta edición. Asígnalo primero en el equipo docente.';
export const ASSIGNMENT_RETIRED = 'La asignación del docente a esta edición está retirada. Reactívala en el equipo docente o elige a otro docente.';
export const STALE = 'La sesión cambió desde que la abriste. Consulta la versión actual antes de guardar.';

// Transiciones permitidas. programada → realizada | cancelada; realizada → programada (reabrir una marca equivocada, con motivo);
// cancelada es final: para volver a programar esa clase se crea una sesión nueva. Una realizada no se cancela directamente.
const TRANSITIONS: Record<SesionEstadoValue, readonly SesionEstadoValue[]> = {
  programada: ['realizada', 'cancelada'],
  realizada: ['programada'],
  cancelada: [],
};

export function assertTransition(from: SesionEstadoValue, to: SesionEstadoValue) {
  if (from === to) throw new ConflictException(`La sesión ya está ${from}.`);
  if (from === 'cancelada') throw new ConflictException('La sesión está cancelada y no admite más cambios de estado. Para programar esa clase, crea una sesión nueva.');
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConflictException(from === 'realizada' && to === 'cancelada'
      ? 'Una sesión realizada no se cancela. Si la marcaste por error, reábrela (estado programada) con su motivo.'
      : `No se puede pasar una sesión de ${from} a ${to}.`);
  }
}

// Motivo obligatorio: cancelar y reabrir; marcar como realizada lo admite pero no lo exige.
export const transitionNeedsReason = (to: SesionEstadoValue) => to === 'cancelada' || to === 'programada';

export function requireReason(motivo: string | undefined, message: string): string {
  if (!motivo) throw new UnprocessableEntityException(message);
  return motivo;
}

// Una sesión realizada es historia: no cambia de día, horas, docente ni modalidad. Solo se corrigen el título y las observaciones, con motivo.
export const FROZEN_FIELDS = ['fecha', 'hora_inicio', 'hora_fin', 'docente_id', 'modalidad', 'lugar', 'enlace_url'] as const;

// Fecha fuera del periodo [fecha_inicio, fecha_fin] de la edición (cuando las tiene). Es un aviso, no un rechazo: las ediciones se amplían,
// se recuperan clases y los periodos se corrigen después.
export function outsidePeriod(fecha: string, edition: { fecha_inicio: string | null; fecha_fin: string | null }) {
  return (!!edition.fecha_inicio && fecha < edition.fecha_inicio) || (!!edition.fecha_fin && fecha > edition.fecha_fin);
}

const MESSAGES = {
  unique: 'Ya existe una sesión con esos datos. Consulta el estado actual.',
  outdated: 'La gestión de sesiones no está disponible. Solicita revisar la estructura académica.',
  concurrent: 'Otra operación modificó la programación. Consulta la versión actual antes de repetir.',
  busy: 'El servicio está ocupado. Intenta de nuevo en unos segundos.',
};

// Traduce los errores conocidos de la base a respuestas seguras (sin SQL, nombres de índices ni valores).
export function translateDatabaseError(error: unknown): never {
  if (isUniqueViolation(error)) throw new ConflictException(MESSAGES.unique);
  if (isSchemaOutdated(error)) throw new ServiceUnavailableException(MESSAGES.outdated);
  // P2034: conflicto de escritura o interbloqueo; P2028: la transacción venció esperando un bloqueo; P2003: una referencia dejó de existir.
  // En los tres casos no se aplicó nada y repetir la operación tras consultar es seguro.
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028', 'P2003'].includes(error.code)) throw new ConflictException(MESSAGES.concurrent);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2024') throw new ServiceUnavailableException(MESSAGES.busy);
  throw error;
}

// Nombres de los campos que cambian en una edición parcial: es lo único que llega al historial (nunca sus valores).
export function changedFieldNames(fields: Record<string, unknown>): string[] {
  return Object.keys(fields).filter(key => fields[key] !== undefined);
}
