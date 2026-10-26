// Catálogo de permisos: un identificador único «recurso:operacion» por cada operación protegible.
// Etapa 1: solo definición. Ninguna ruta lo consulta todavía.
//
// Operaciones transversales: leer, crear, editar, archivar, eliminar, exportar, anular.
// Operaciones específicas de un recurso: enviar (correo), restaurar, asignar_rol, cerrar, registrar,
// corregir_cerradas, emitir, previsualizar, aplicar.
//
// No existen permisos de eliminación física para estudiantes, matrículas ni calificaciones:
// el historial académico se archiva, se desactiva o se anula, nunca se borra.
export const RESOURCE_OPERATIONS = {
  // --- Recursos que ya existen en el backend ---
  cuentas: ['leer', 'crear', 'editar', 'asignar_rol'],
  configuracion: ['leer', 'editar'],
  contenido_original: ['leer', 'restaurar'],
  cursos: ['leer', 'crear', 'editar', 'archivar', 'eliminar'],
  servicios: ['leer', 'crear', 'editar', 'eliminar'],
  preguntas_frecuentes: ['leer', 'crear', 'editar', 'archivar'],
  galeria: ['leer', 'crear', 'editar', 'eliminar'],
  convenios: ['leer', 'crear', 'editar', 'eliminar'],
  archivos: ['crear'],
  mensajes: ['leer', 'crear', 'editar', 'eliminar', 'exportar'], // exportar = descargar en CSV correos y teléfonos de muchos clientes; distinto de leer y reservado al gerente hasta decidir la matriz (Etapa 4A)
  seguimiento_mensajes: ['leer', 'editar', 'enviar'],
  seguimiento_reclamaciones: ['leer', 'editar', 'enviar'],
  cotizaciones: ['leer', 'crear', 'editar', 'enviar', 'anular'],
  reclamaciones: ['leer', 'exportar', 'eliminar'],
  boletin: ['leer', 'exportar', 'eliminar'],
  chatbot_consultas: ['leer'],
  estadisticas: ['leer'],
  items: ['leer', 'crear', 'editar', 'eliminar'],
  // --- Gestión académica ---
  estudiantes: ['leer', 'crear', 'editar', 'archivar', 'exportar'],
  convocatorias: ['leer', 'crear', 'editar', 'cerrar', 'archivar'],
  preinscripciones: ['leer', 'editar', 'convertir', 'exportar'], // editar = validar, corregir, descartar y registrar desistimientos; convertir = pasar una preinscripción validada a matrícula (operación controlada que reutiliza Matrículas); exportar queda RESERVADO para una etapa futura: ninguna ruta lo exige todavía. Sin crear (la crea el visitante) ni eliminar.
  matriculas: ['leer', 'crear', 'editar', 'anular', 'confirmar'], // confirmar = declarar administrativamente que se completó o no la capacitación (no es una calificación)
  asistencia: ['leer', 'registrar'],
  calificaciones: ['leer', 'registrar', 'corregir_cerradas'],
  importaciones: ['previsualizar', 'aplicar'],
  reportes_academicos: ['leer', 'exportar'],
  auditoria: ['leer'],
} as const;

export type Resource = keyof typeof RESOURCE_OPERATIONS;
export type Permission = { [R in Resource]: `${R}:${(typeof RESOURCE_OPERATIONS)[R][number]}` }[Resource];

// Recursos cuyos módulos todavía no existen: sus permisos están definidos pero ninguna ruta actual los exige.
export const FUTURE_RESOURCES = [
  'asistencia', 'calificaciones',
  'auditoria',
] as const satisfies readonly Resource[];

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  (Object.keys(RESOURCE_OPERATIONS) as Resource[]).flatMap(resource =>
    (RESOURCE_OPERATIONS[resource] as readonly string[]).map(operation => `${resource}:${operation}` as Permission),
  ),
);

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value);
}

// Seguimiento (Centro de Atención): la ruta es común, pero el permiso depende del recurso del registro.
// Un recurso desconocido no produce permiso (null) y por tanto se deniega.
export function seguimientoPermission(recurso: unknown, operation: 'leer' | 'editar' | 'enviar'): Permission | null {
  if (recurso === 'messages') return `seguimiento_mensajes:${operation}`;
  if (recurso === 'reclamaciones') return `seguimiento_reclamaciones:${operation}`;
  return null;
}
