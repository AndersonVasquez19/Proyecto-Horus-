import type { Edition, EditionList } from './editions';
export type EnrollmentState = 'activa' | 'anulada';
export interface EnrollmentStudent { id: number; nombres: string; apellidos: string; doc_numero: string | null; archivado_at: string | null }
export interface SeatEdition extends Omit<Edition, 'createdAt' | 'updatedAt' | 'curso'> { curso: { id: number; titulo: string; tipo: string }; ocupados: number; disponibles: number | null }
export interface Enrollment {
  id: number; estudiante_id: number; convocatoria_id: number; estado: EnrollmentState; cumplimiento: 'pendiente' | 'cumplido' | 'no_cumplido';
  revision: number; createdAt: string; updatedAt: string; estudiante: EnrollmentStudent; convocatoria: Omit<SeatEdition, 'ocupados' | 'disponibles'>;
}
export interface AcademicHistory { id: number; createdAt: string; operacion: string; actor_id: number | null; actor_rol: string | null; operador: string | null; estado_anterior: string | null; estado_nuevo: string | null; motivo: string | null; revision: number | null }
export type EnrollmentList<T = Enrollment> = EditionList<T>;
export type EnrollmentAction = 'annul' | 'reactivate';
export const ENROLLMENT_STATES = { activa: 'Activa', anulada: 'Anulada' };
export const ENROLLMENT_ACTIONS = { annul: 'Anular matrícula', reactivate: 'Reactivar matrícula' };
export const studentLabel = (s: EnrollmentStudent) => `${s.apellidos}, ${s.nombres} · DNI ${s.doc_numero || 'sin registrar'}`;
export const seatLabel = (e: SeatEdition) => `${e.curso.titulo} · ${e.nombre} · ${e.disponibles === null ? 'Capacidad sin definir' : e.disponibles + ' cupos disponibles'} · ${e.estado}${e.archivado_at ? ' · Archivada' : ''}`;
export function canEnroll(e: Pick<SeatEdition, 'estado' | 'archivado_at' | 'capacidad' | 'disponibles'>) { return e.estado === 'abierta' && !e.archivado_at && e.capacidad !== null && e.disponibles !== null && e.disponibles > 0; }
export const unavailableEdition = (e: SeatEdition) => !canEnroll(e);
export const enrollmentPayload = (s: Pick<EnrollmentStudent, 'id'>, e: Pick<SeatEdition, 'id' | 'revision'>) => ({ estudiante_id: s.id, convocatoria_id: e.id, convocatoria_revision: e.revision });
export function enrollmentActions(item: Pick<Enrollment, 'estado'>, can: (permission: string) => boolean): EnrollmentAction[] {
  if (!can('matriculas:anular')) return [];
  return item.estado === 'activa' ? ['annul'] : can('matriculas:editar') ? ['reactivate'] : [];
}
