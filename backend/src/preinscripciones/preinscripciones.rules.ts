import { ConflictException } from '@nestjs/common';
import type { PreinscripcionEstado } from '@prisma/client';

// Regla general para una edición NUEVA: 10 preinscritos validados. No es la capacidad máxima (son cosas distintas) y no admite
// excepciones: no existe ningún parámetro, permiso ni rol que permita abrir con menos. Las ediciones anteriores a la migración
// conservan minimo_apertura = NULL (sin requisito) y siguen abriéndose como antes.
export const MINIMO_APERTURA_NUEVAS = 10;

// Versión del aviso de privacidad que el visitante acepta al preinscribirse. Se guarda con cada solicitud para poder demostrar a qué
// texto se dio el consentimiento. Si cambia el texto, cambia la versión.
export const AVISO_VERSION = 'preinscripcion-v1';

// Límite TÉCNICO de seguridad (no una regla de negocio): preinscripciones vigentes (recibida + validada + matriculada) que una edición
// admite antes de dejar de recibir más. Frena el relleno masivo de la tabla; la política real (lista de espera, tope por cupo) es una
// decisión pendiente del responsable (ver docs/procedimientos/gestion-preinscripciones.md).
export const TOPE_VIGENTES_POR_EDICION = 500;

export const ESTADOS_VIGENTES: readonly PreinscripcionEstado[] = ['recibida', 'validada', 'matriculada'];
// Únicos estados que cuentan para el mínimo de apertura. Una simple solicitud recibida NO cuenta.
export const ESTADOS_PARA_APERTURA: readonly PreinscripcionEstado[] = ['validada', 'matriculada'];

const TRANSITIONS: Record<PreinscripcionEstado, readonly PreinscripcionEstado[]> = {
  recibida: ['validada', 'descartada', 'desistida'],
  validada: ['matriculada', 'descartada', 'desistida'],
  matriculada: [], desistida: [], descartada: [],
};

export function validateTransition(from: PreinscripcionEstado, to: PreinscripcionEstado) {
  if (!TRANSITIONS[from].includes(to)) throw new ConflictException('El estado actual de la preinscripción no permite esa operación. Consulta su versión vigente.');
}

type Reception = { estado: string; archivado_at: Date | null; preinscripcion_estado: string; capacidad: number | null };

// ¿Puede la edición recibir preinscripciones ahora? La recepción es una decisión de Gerencia o Coordinación (preinscripcion_estado) y
// es INDEPENDIENTE de la apertura académica: una edición planificada o ya abierta puede recibir. Cancelada, cerrada o archivada, nunca.
export function receivesPreinscripciones(edition: Reception): boolean {
  return edition.preinscripcion_estado === 'abierta' && !edition.archivado_at && ['planificada', 'abierta'].includes(edition.estado);
}

// Mínimo de apertura frente a las preinscripciones validadas. minimo = null (edición anterior) no exige nada.
export function validateOpeningMinimum(minimo: number | null, counted: number) {
  if (minimo === null) return;
  if (counted < minimo) throw new ConflictException(`La edición necesita al menos ${minimo} preinscripciones validadas para confirmar su apertura y tiene ${counted}. Valida más preinscripciones antes de abrirla.`);
}
