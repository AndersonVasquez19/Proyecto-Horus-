import { ADMIN_ROLES, AdminRole, isAdminRole } from './roles';
import { ALL_PERMISSIONS, Permission, isPermission } from './permissions';

// Matriz de permisos por rol. La consulta AccessGuard (E3.3), que todavía no está activada en ninguna ruta.
// Regla de diseño: denegación por defecto. Lo que no figura aquí, está denegado; las operaciones sin clasificar
// no se conceden a la coordinadora ni a la secretaria.
//
// Decisiones pendientes (por eso NO se conceden, salvo al gerente):
//  - configuracion:editar (la coordinadora no administra configuración crítica; falta decidir si las 10 claves actuales,
//    todas de contacto/redes públicas, cuentan como tal).
//  - importaciones:aplicar, certificados:anular, calificaciones:corregir_cerradas, estudiantes:exportar, reportes_academicos:exportar.
//  - Secretaria: estudiantes:editar, matriculas:anular, asistencia:*, estadisticas:leer, cotizaciones:*, servicios/FAQ/convenios.
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
  'mensajes:leer', 'mensajes:editar',
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
  'matriculas:leer', 'matriculas:crear', 'matriculas:editar', 'matriculas:anular',
  'sesiones:leer', 'sesiones:crear', 'sesiones:editar',
  'asistencia:leer', 'asistencia:registrar',
  'calificaciones:leer', 'calificaciones:registrar',
  'certificados:leer', 'certificados:emitir',
  'importaciones:previsualizar',
  'reportes_academicos:leer',
];

const SECRETARIA: readonly Permission[] = [
  'configuracion:leer',
  'cursos:leer',
  'mensajes:leer', 'mensajes:editar',
  'seguimiento_mensajes:leer', 'seguimiento_mensajes:editar', 'seguimiento_mensajes:enviar',
  'chatbot_consultas:leer',
  // Académico (módulos futuros)
  'estudiantes:leer', 'estudiantes:crear',
  'convocatorias:leer',
  'matriculas:leer', 'matriculas:crear', 'matriculas:editar',
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
