import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';

// Reglas puras de certificados: sin base de datos ni NestJS, para probarlas sin MySQL.

// «Pendiente de certificación»: matrícula vigente, con cumplimiento confirmado, SIN certificado vigente y en una edición no cancelada.
// Una matrícula cuyo único certificado fue anulado sigue pendiente. Fuente única: la usan el reporte «pendientes-certificacion» y el
// Resumen operativo, para que ambos cuenten lo mismo.
export const PENDING_CERTIFICATION_WHERE = {
  estado: 'activa', cumplimiento: 'cumplido', certificados: { none: { estado: 'vigente' } }, convocatoria: { estado: { not: 'cancelada' } },
} as const satisfies Prisma.MatriculaWhereInput;

// «Lista para emitir» frente a «requiere corrección de datos». Con el CHECK de MySQL (solo DNI de 8 dígitos), documento presente
// equivale a DNI completo; la emisión real vuelve a validar con checkEmission.
export const READY_STUDENT_WHERE = {
  estudiante: { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: { not: null } },
} as const satisfies Prisma.MatriculaWhereInput;

// Código de verificación: aleatorio (crypto), 20 caracteres de un alfabeto de 32 símbolos sin los confusos (0/O, 1/I) = 100 bits.
// 32 símbolos dividen 256 exactamente: tomar el byte módulo 32 no introduce sesgo. Cumple el CHECK de MySQL ^[A-Z0-9]{16,32}$.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 20;
export const CODE_PATTERN = /^[A-Z0-9]{16,32}$/;

export function generateCode(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] & 31];
  return code;
}

// Entrada pública: se normaliza (espacios y mayúsculas) y solo se consulta la base si el formato es el de un código real.
export function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export interface EmissionSource {
  matricula: { estado: string; cumplimiento: string };
  estudiante: { nombres: string; apellidos: string; doc_pais: string | null; doc_tipo: string | null; doc_numero: string | null };
  convocatoria: { estado: string; nombre: string; fecha_inicio: Date | null; fecha_fin: Date | null; curso: { titulo: string; tipo: 'curso' | 'capacitacion' | string; duracion: string | null } };
}

export type EmissionCheck = { ok: true } | { ok: false; kind: 'conflict' | 'unprocessable'; message: string };

// ¿Puede emitirse un certificado ahora? La matrícula debe estar activa y con cumplimiento confirmado como «cumplido». Sin DNI
// completo no hay certificado (la identidad no se verifica: solo se exige el dato). Una edición cancelada no dicta el curso.
export function checkEmission(source: EmissionSource): EmissionCheck {
  if (source.matricula.estado !== 'activa') return { ok: false, kind: 'conflict', message: 'Solo se emite certificado para matrículas activas.' };
  if (source.matricula.cumplimiento !== 'cumplido') return { ok: false, kind: 'conflict', message: 'El cumplimiento de la matrícula debe estar confirmado como «cumplido» antes de emitir el certificado.' };
  if (source.convocatoria.estado === 'cancelada') return { ok: false, kind: 'conflict', message: 'La edición fue cancelada: no se emiten certificados.' };
  const { doc_pais, doc_tipo, doc_numero } = source.estudiante;
  if (doc_pais !== 'PE' || doc_tipo !== 'DNI' || !doc_numero || !/^[0-9]{8}$/.test(doc_numero)) {
    return { ok: false, kind: 'unprocessable', message: 'El estudiante no tiene un DNI completo registrado, necesario para emitir el certificado.' };
  }
  if (!source.estudiante.nombres.trim() || !source.estudiante.apellidos.trim()) return { ok: false, kind: 'unprocessable', message: 'El estudiante debe tener nombres y apellidos para emitir el certificado.' };
  return { ok: true };
}

// Copia de los datos que quedan fijos en el certificado. Solo se llama tras checkEmission (el DNI ya está validado).
export function snapshotOf(source: EmissionSource) {
  const { estudiante, convocatoria } = source;
  return {
    estudiante_nombres: estudiante.nombres.trim(), estudiante_apellidos: estudiante.apellidos.trim(),
    estudiante_doc_pais: 'PE', estudiante_doc_tipo: 'DNI' as const, estudiante_doc_numero: estudiante.doc_numero as string,
    curso_titulo: convocatoria.curso.titulo, curso_tipo: convocatoria.curso.tipo as 'curso' | 'capacitacion', curso_duracion: convocatoria.curso.duracion,
    convocatoria_nombre: convocatoria.nombre, convocatoria_fecha_inicio: convocatoria.fecha_inicio, convocatoria_fecha_fin: convocatoria.fecha_fin,
  };
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
