import { ConflictException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';

// Reglas puras de los horarios recurrentes de una edición. Se prueban sin base de datos (test/horarios.test.ts).
//
// Representación de los días: ISO-8601, 1 = lunes … 7 = domingo. Es la misma en MySQL (TINYINT con CHECK 1–7), en Prisma (Int) y en la
// API (`dia_semana`); `dia` es solo la etiqueta en español que acompaña a la respuesta. Las horas son HH:MM de 24 horas en hora de pared
// de America/Lima, y cada tramo es un intervalo [inicio, fin) dentro del mismo día (sin cruzar la medianoche).

export const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
export const diaNombre = (dia: number) => DIAS_SEMANA[dia - 1];
// Tope por edición: tres tramos por día. Evita cuerpos desmesurados; ninguna edición real se acerca.
export const MAX_HORARIOS = 21;

export interface Tramo { dia_semana: number; hora_inicio: string; hora_fin: string }
export interface TramoGuardado extends Tramo { id: number }

export const STALE = 'La edición cambió desde que la abriste. Conserva tus cambios y consulta la versión actual antes de guardar.';
const MESSAGES = {
  outdated: 'La gestión de horarios no está disponible. Solicita revisar la estructura académica (migración 20261023-convocatoria-horarios).',
  concurrent: 'Otra operación modificó la edición o sus horarios al mismo tiempo. Consulta la versión actual antes de repetir.',
  busy: 'El servicio está ocupado. Intenta de nuevo en unos segundos.',
} as const;

const describe = (t: Tramo) => ({ dia_semana: t.dia_semana, dia: diaNombre(t.dia_semana), hora_inicio: t.hora_inicio, hora_fin: t.hora_fin });
// Intervalos [a, b) y [c, d) del mismo día: se solapan si cada uno empieza antes de que termine el otro. Uno que empieza justo cuando
// termina el anterior no se solapa (las horas son HH:MM de dos dígitos, así que comparar las cadenas equivale a comparar las horas).
export const overlaps = (a: Tramo, b: Tramo) => a.dia_semana === b.dia_semana && a.hora_inicio < b.hora_fin && b.hora_inicio < a.hora_fin;
export const tramoKey = (t: Tramo) => `${t.dia_semana}|${t.hora_inicio}|${t.hora_fin}`;
export const byDayAndTime = (a: Tramo, b: Tramo) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio) || a.hora_fin.localeCompare(b.hora_fin);

// Valida el conjunto COMPLETO propuesto antes de tocar la base y lo devuelve ordenado por día y hora. Todo o nada: con un solo tramo
// inválido, duplicado o solapado se rechaza la operación entera (422) y no se escribe nada.
export function validateTramos(tramos: readonly Tramo[]): Tramo[] {
  const invalid = tramos.map((t, indice) => ({ indice, ...describe(t) })).filter(t => t.hora_fin <= t.hora_inicio);
  if (invalid.length) {
    throw new UnprocessableEntityException({
      statusCode: 422, error: 'Unprocessable Entity', codigo: 'HORARIO_INVALIDO', tramos: invalid,
      message: 'La hora de fin de cada horario debe ser posterior a la de inicio (sin cruzar la medianoche).',
    });
  }
  const conflictos: { tipo: 'duplicado' | 'solapamiento'; primero: ReturnType<typeof describe>; segundo: ReturnType<typeof describe> }[] = [];
  for (let i = 0; i < tramos.length; i++) {
    for (let j = i + 1; j < tramos.length; j++) {
      if (!overlaps(tramos[i], tramos[j])) continue;
      conflictos.push({ tipo: tramoKey(tramos[i]) === tramoKey(tramos[j]) ? 'duplicado' : 'solapamiento', primero: describe(tramos[i]), segundo: describe(tramos[j]) });
    }
  }
  if (conflictos.length) {
    const duplicated = conflictos.some(c => c.tipo === 'duplicado');
    throw new UnprocessableEntityException({
      statusCode: 422, error: 'Unprocessable Entity', codigo: duplicated ? 'HORARIO_DUPLICADO' : 'HORARIO_SOLAPADO', conflictos: conflictos.slice(0, 20),
      message: duplicated ? 'Hay horarios repetidos el mismo día y a la misma hora.' : 'Hay horarios que se solapan el mismo día.',
    });
  }
  return [...tramos].sort(byDayAndTime);
}

// Diferencia entre lo guardado y lo propuesto: los tramos idénticos se conservan (mismo id), los que ya no figuran se retiran y los nuevos
// se insertan. Cambiar solo la hora de fin de un tramo es retirarlo y crear otro.
export function diffTramos(current: readonly TramoGuardado[], next: readonly Tramo[]) {
  const wanted = new Set(next.map(tramoKey));
  const existing = new Set(current.map(tramoKey));
  return {
    remove: current.filter(t => !wanted.has(tramoKey(t))).map(t => t.id),
    add: next.filter(t => !existing.has(tramoKey(t))),
    unchanged: current.length === next.length && next.every(t => existing.has(tramoKey(t))),
  };
}

// Una edición archivada o cancelada no cambia sus horarios. Planificada, abierta y cerrada sí: una edición cerrada a nuevas matrículas
// puede seguir dictándose y necesitar ajustar su horario.
export const isScheduleEditable = (edition: { estado: string; archivado_at: Date | null }) => !edition.archivado_at && edition.estado !== 'cancelada';
export function assertScheduleEditable(edition: { estado: string; archivado_at: Date | null }) {
  if (edition.archivado_at) throw new ConflictException('La edición está archivada: sus horarios no se modifican.');
  if (edition.estado === 'cancelada') throw new ConflictException('La edición está cancelada: sus horarios no se modifican.');
}

// Etiqueta del historial (cabe en estado_anterior / estado_nuevo, VARCHAR(30)): solo el número de tramos, nunca datos personales.
export const countLabel = (n: number) => `${n} ${n === 1 ? 'horario' : 'horarios'}`;

// Errores de la base traducidos a respuestas neutras: nunca se muestra SQL, Prisma ni trazas.
export function translateDatabaseError(error: unknown): never {
  // Un UNIQUE de (edición, día, inicio) solo puede saltar si alguien escribió fuera del servicio a la vez: se trata como concurrencia.
  if (isUniqueViolation(error)) throw new ConflictException(MESSAGES.concurrent);
  if (isSchemaOutdated(error)) throw new ServiceUnavailableException(MESSAGES.outdated);
  // P2034: conflicto de escritura o interbloqueo; P2028: la transacción venció esperando un bloqueo; P2003: una referencia dejó de existir.
  // En los tres casos no se aplicó nada y repetir la operación tras consultar es seguro.
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028', 'P2003'].includes(error.code)) throw new ConflictException(MESSAGES.concurrent);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2024') throw new ServiceUnavailableException(MESSAGES.busy);
  throw error;
}
