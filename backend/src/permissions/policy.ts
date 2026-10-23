import { ADMIN_ROLES, AdminRole, isAdminRole } from './roles';
import { ALL_PERMISSIONS, Permission, isPermission } from './permissions';

// Matriz de permisos por rol. La consulta AccessGuard (E3.3), registrada como guard global desde E3.6 (app.module.ts).
// Regla de diseño: denegación por defecto. Lo que no figura aquí, está denegado; las operaciones sin clasificar
// no se conceden a la coordinadora ni a la secretaria.
//
// Decisiones pendientes (por eso NO se conceden, salvo al gerente):
//  - configuracion:editar (la coordinadora no administra configuración crítica; falta decidir si las 10 claves actuales,
//    todas de contacto/redes públicas, cuentan como tal).
//  - importaciones:aplicar, calificaciones:corregir_cerradas, estudiantes:exportar, reportes_academicos:exportar.
//  - Secretaria NO tiene (no se le conceden): estudiantes:editar, matriculas:anular, asistencia:*, estadisticas:leer, cotizaciones:* (ni siquiera leer) ni servicios/FAQ/convenios. El módulo de Docentes se retiró del alcance (quienes dictan los cursos son integrantes de la empresa): ya no existen permisos docentes:*.
//  - items:* (andamiaje genérico sin uso en el panel): solo gerente hasta decidir si se conserva.

const GERENTE_GENERAL: readonly Permission[] = ALL_PERMISSIONS; // acceso completo; los controles de integridad viven en servicios y base de datos

const COORDINADORA_INSTITUCIONAL: readonly Permission[] = [
  'configuracion:leer',
  'cursos:leer', 'cursos:crear', 'cursos:editar', 'cursos:archivar',
  'servicios:leer', 'servicios:crear', 'servicios:editar',
  'preguntas_frecuentes:leer', 'preguntas_frecuentes:crear', 'preguntas_frecuentes:editar', 'preguntas_frecuentes:archivar',
  'galeria:leer', 'galeria:crear', 'galeria:editar', 'galeria:eliminar',
  'convenios:leer', 'convenios:crear', 'convenios:editar', 'convenios:eliminar',
  'archivos:crear',
  'mensajes:leer', 'mensajes:crear', 'mensajes:editar', // crear = registrar una consulta manual (atención al público, E3.4.1)
  'seguimiento_mensajes:leer', 'seguimiento_mensajes:editar', 'seguimiento_mensajes:enviar',
  'seguimiento_reclamaciones:leer', 'seguimiento_reclamaciones:editar', 'seguimiento_reclamaciones:enviar',
  'cotizaciones:leer', 'cotizaciones:crear', 'cotizaciones:editar', 'cotizaciones:enviar', 'cotizaciones:anular',
  'reclamaciones:leer',
  'boletin:leer',
  'chatbot_consultas:leer',
  'estadisticas:leer',
  // Académico (módulos futuros)
  'estudiantes:leer', 'estudiantes:crear', 'estudiantes:editar', 'estudiantes:archivar',
  'convocatorias:leer', 'convocatorias:crear', 'convocatorias:editar', 'convocatorias:cerrar', 'convocatorias:archivar',
  'matriculas:leer', 'matriculas:crear', 'matriculas:editar', 'matriculas:anular', 'matriculas:confirmar',
  'preinscripciones:leer', 'preinscripciones:editar', 'preinscripciones:convertir', // Autorizado por el responsable (2026-10-20). preinscripciones:exportar queda reservado al gerente (etapa futura).
  'asistencia:leer', 'asistencia:registrar',
  'calificaciones:leer', 'calificaciones:registrar',
  'importaciones:previsualizar',
  'reportes_academicos:leer',
];

const SECRETARIA: readonly Permission[] = [
  'configuracion:leer',
  'cursos:leer',
  'mensajes:leer', 'mensajes:crear', 'mensajes:editar', // crear = registrar una consulta manual (atención al público, E3.4.1)
  'seguimiento_mensajes:leer', 'seguimiento_mensajes:editar', 'seguimiento_mensajes:enviar',
  'chatbot_consultas:leer',
  // Académico (módulos futuros)
  'estudiantes:leer', 'estudiantes:crear',
  'convocatorias:leer',
  'matriculas:leer', 'matriculas:crear', 'matriculas:editar',
  // Preinscripciones (autorizado 2026-10-20): puede convertir una preinscripción validada en matrícula SIN recibir por ello permisos
  // generales nuevos: la apertura de la edición (convocatorias:editar), la recepción de preinscripciones, el cierre y el archivo
  // siguen siendo de Gerencia y Coordinación; tampoco obtiene estudiantes:editar ni matriculas:anular.
  'preinscripciones:leer', 'preinscripciones:editar', 'preinscripciones:convertir',
];

const MATRIX: Readonly<Record<AdminRole, ReadonlySet<Permission>>> = Object.freeze({
  GERENTE_GENERAL: new Set(GERENTE_GENERAL),
  COORDINADORA_INSTITUCIONAL: new Set(COORDINADORA_INSTITUCIONAL),
  SECRETARIA: new Set(SECRETARIA),
});

// Denegación por defecto: un rol o un permiso desconocido (o de otro tipo) siempre devuelve false.
export function can(role: unknown, permission: unknown): boolean {
  if (!isAdminRole(role) || !isPermission(permission)) return false;
  return MATRIX[role].has(permission);
}

export function canAll(role: unknown, permissions: readonly unknown[]): boolean {
  return Array.isArray(permissions) && permissions.length > 0 && permissions.every(permission => can(role, permission));
}

export function canAny(role: unknown, permissions: readonly unknown[]): boolean {
  return Array.isArray(permissions) && permissions.some(permission => can(role, permission));
}

// Copia ordenada de los permisos de un rol (vacía si el rol es desconocido).
export function permissionsOf(role: unknown): Permission[] {
  return isAdminRole(role) ? [...MATRIX[role]].sort() : [];
}

export { ADMIN_ROLES };
