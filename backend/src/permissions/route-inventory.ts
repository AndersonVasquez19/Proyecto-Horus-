import type { Permission } from './permissions';
import type { FollowUpOperation, RouteAccess } from './access';

// Inventario escrito a mano de las rutas HTTP actuales y de la clasificación que exige AccessGuard, activa desde E3.6 (ver access.ts).
// No lo consume la guard: la guard lee los decoradores de los controladores. Una prueba compara ambos y falla si alguien añade una
// ruta sin clasificar o si un decorador no coincide con este inventario. Las rutas van sin el prefijo global «api».
export type { RouteAccess } from './access';

export interface RouteEntry { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; access: RouteAccess; note?: string }

const pub = (method: RouteEntry['method'], path: string, note?: string): RouteEntry => ({ method, path, access: { kind: 'publica' }, note });
const auth = (method: RouteEntry['method'], path: string, note?: string): RouteEntry => ({ method, path, access: { kind: 'autenticada' }, note });
const perm = (method: RouteEntry['method'], path: string, permission: Permission, note?: string): RouteEntry => ({ method, path, access: { kind: 'permiso', permission }, note });
const byField = (method: RouteEntry['method'], path: string, field: string, base: Permission, when: Record<string, Permission>, note: string): RouteEntry => ({ method, path, access: { kind: 'segun_campo', field, base, when }, note });
const follow = (method: RouteEntry['method'], path: string, operation: FollowUpOperation): RouteEntry => ({ method, path, access: { kind: 'seguimiento', operation } });

const STATE_NOTE = 'El mismo PUT puede pasar el registro a «archivado»: entonces exige además el permiso de archivar. Reactivar un registro archivado solo exige editar (la guard no consulta el estado guardado).';

export const ROUTE_INVENTORY: readonly RouteEntry[] = [
  // --- Públicas ---
  pub('GET', 'health'),
  pub('GET', 'settings', 'Solo expone las 10 claves institucionales públicas.'),
  pub('GET', 'cursos'), pub('GET', 'cursos/:id'),
  pub('GET', 'servicios'), pub('GET', 'servicios/:id'),
  pub('GET', 'preguntas-frecuentes'), pub('GET', 'preguntas-frecuentes/:id'),
  pub('GET', 'convenios'), pub('GET', 'convenios/:id'),
  pub('GET', 'galeria'), pub('GET', 'galeria/:id'),
  pub('GET', 'uploads/:filename', 'Imágenes del sitio sin autenticación. No apto para documentos de estudiantes.'),
  pub('POST', 'contacto'), pub('POST', 'reclamaciones'),
  pub('POST', 'newsletter'), pub('POST', 'newsletter/unsubscribe'),
  pub('POST', 'chatbot/message'), pub('POST', 'chatbot/contact'),
  pub('GET', 'preinscripciones/convocatorias', 'Ediciones que reciben preinscripciones: código opaco, sin IDs secuenciales, cupos, conteos ni datos personales.'),
  pub('POST', 'preinscripciones', 'Formulario público. El servidor fija el canal; consentimiento obligatorio; respuesta idéntica ante un duplicado; límite compartido en MySQL.'),
  pub('GET', 'certificados/verificar/:codigo', 'Verificación por código aleatorio (100 bits). Respuesta mínima: nombre, curso y fechas; nunca el DNI ni el motivo de anulación. Código inexistente o mal formado: el mismo 404. Límite de frecuencia por IP, subred y global (PublicRateLimitGuard).'),
  pub('POST', 'chatbot/preinscripcion', 'Misma operación que el formulario (un solo servicio), activada por el chatbot tras confirmar el visitante. El modelo de OpenAI no la invoca ni recibe sus datos.'),

  // --- Autenticación y cuentas ---
  pub('POST', 'admin/login'), pub('POST', 'admin/forgot-password'), pub('POST', 'admin/reset-password'),
  pub('POST', 'admin/signup', 'Registro público: la cuenta nace sin rol (sin permisos); rechaza campos ajenos al DTO y tiene límite por minuto y por hora.'),
  auth('GET', 'admin/me'), auth('POST', 'admin/password'),
  perm('POST', 'admin/register', 'cuentas:crear', 'Hoy lo puede usar cualquier administrador. Solo gerente; el rol deberá indicarse de forma explícita.'),
  perm('GET', 'admin/users', 'cuentas:leer'),
  perm('PUT', 'admin/users/:id', 'cuentas:editar', 'Activar o desactivar (deja el rol en NULL). El cambio de rol va en PUT admin/users/:id/rol.'),
  perm('PUT', 'admin/users/:id/rol', 'cuentas:asignar_rol', 'Roles y usuarios: asignar, cambiar o retirar el rol de otra cuenta activa. Nunca el propio; nunca un rol con permisos que la cuenta que actúa no tenga; conserva al último gerente activo; audita y cierra las sesiones de la cuenta.'),

  // --- Configuración y contenido original ---
  perm('GET', 'admin/settings', 'configuracion:leer', 'Las 10 claves (empresa_nombre, ruc, email_contacto, telefono_principal, whatsapp, direccion, horario_atencion, facebook_url, instagram_url, linkedin_url) ya son públicas en GET /settings.'),
  perm('PUT', 'admin/settings', 'configuracion:editar', 'Todas las claves actuales se tratan igual; si se decide distinguir claves críticas, habrá que comprobarlo por clave en el servicio.'),
  perm('GET', 'admin/contenido-original', 'contenido_original:leer'),
  perm('POST', 'admin/contenido-original/:section', 'contenido_original:restaurar', 'Sobrescribe contenido publicado: operación delicada.'),

  // --- Catálogo ---
  perm('GET', 'admin/cursos', 'cursos:leer'), perm('GET', 'admin/cursos/:id', 'cursos:leer'),
  perm('POST', 'admin/cursos', 'cursos:crear'),
  byField('PUT', 'admin/cursos/:id', 'estado', 'cursos:editar', { archivado: 'cursos:archivar' }, STATE_NOTE),
  perm('DELETE', 'admin/cursos/:id', 'cursos:eliminar', 'El servicio responde 409 si existe (404 si no existe), sin modificarlo. El permiso se conserva pero no habilita borrado físico; archivar desde Editar mediante PUT.'),
  perm('GET', 'admin/servicios', 'servicios:leer'), perm('GET', 'admin/servicios/:id', 'servicios:leer'),
  perm('POST', 'admin/servicios', 'servicios:crear'),
  perm('PUT', 'admin/servicios/:id', 'servicios:editar', 'Servicios no tiene permiso de archivar: pasar un servicio a «archivado» exige servicios:editar.'),
  perm('DELETE', 'admin/servicios/:id', 'servicios:eliminar'),
  perm('GET', 'admin/preguntas-frecuentes', 'preguntas_frecuentes:leer'), perm('GET', 'admin/preguntas-frecuentes/:id', 'preguntas_frecuentes:leer'),
  perm('POST', 'admin/preguntas-frecuentes', 'preguntas_frecuentes:crear'),
  byField('PUT', 'admin/preguntas-frecuentes/:id', 'estado', 'preguntas_frecuentes:editar', { archivado: 'preguntas_frecuentes:archivar' }, STATE_NOTE),
  perm('DELETE', 'admin/preguntas-frecuentes/:id', 'preguntas_frecuentes:archivar', 'El DELETE solo archiva.'),
  perm('GET', 'admin/galeria', 'galeria:leer'), perm('POST', 'admin/galeria', 'galeria:crear'),
  perm('PUT', 'admin/galeria/:id', 'galeria:editar'), perm('DELETE', 'admin/galeria/:id', 'galeria:eliminar'),
  perm('GET', 'admin/convenios', 'convenios:leer'), perm('GET', 'admin/convenios/:id', 'convenios:leer'),
  perm('POST', 'admin/convenios', 'convenios:crear'), perm('PUT', 'admin/convenios/:id', 'convenios:editar'),
  perm('DELETE', 'admin/convenios/:id', 'convenios:eliminar'),
  perm('POST', 'admin/convenios/:id/fotos', 'convenios:editar'), perm('PUT', 'admin/convenios/:id/fotos/orden', 'convenios:editar'),
  perm('PUT', 'admin/convenios/:id/fotos/:fotoId', 'convenios:editar'),
  perm('DELETE', 'admin/convenios/:id/fotos/:fotoId', 'convenios:editar', 'Quitar una foto se trata como edición del convenio.'),
  perm('POST', 'admin/uploads', 'archivos:crear', 'Solo imágenes del sitio; documentos de estudiantes requerirán almacenamiento privado.'),

  // --- Gestión académica (sin borrado físico) ---
  perm('GET', 'admin/importaciones/ediciones', 'importaciones:previsualizar'),
  perm('POST', 'admin/importaciones/archivo', 'importaciones:previsualizar'),
  perm('POST', 'admin/importaciones/vista-previa', 'importaciones:previsualizar'),
  perm('POST', 'admin/importaciones/confirmacion', 'importaciones:aplicar'),
  perm('GET', 'admin/importaciones/resultado/:id', 'importaciones:previsualizar'),
  perm('GET', 'admin/matriculas', 'matriculas:leer'), perm('GET', 'admin/matriculas/ediciones', 'matriculas:leer'),
  perm('GET', 'admin/matriculas/:id', 'matriculas:leer'), perm('GET', 'admin/matriculas/:id/historial', 'matriculas:leer'),
  perm('POST', 'admin/matriculas', 'matriculas:crear'), perm('PUT', 'admin/matriculas/:id/anulacion', 'matriculas:anular'),
  perm('PUT', 'admin/matriculas/:id/cumplimiento', 'matriculas:confirmar', 'Confirma cumplido / no cumplido o devuelve a pendiente (con motivo al corregir). Solo Gerencia y Coordinación; no es una calificación. Bloqueado con un certificado vigente.'),
  perm('PUT', 'admin/matriculas/:id/reactivacion', 'matriculas:anular', 'Revertir una anulación exige anular; el servicio exige además editar.'),
  perm('GET', 'admin/estudiantes', 'estudiantes:leer'), perm('GET', 'admin/estudiantes/:id', 'estudiantes:leer'),
  perm('GET', 'admin/convocatorias', 'convocatorias:leer'), perm('GET', 'admin/convocatorias/cursos', 'convocatorias:leer'),
  perm('GET', 'admin/convocatorias/:id', 'convocatorias:leer'), perm('POST', 'admin/convocatorias', 'convocatorias:crear'),
  perm('PUT', 'admin/convocatorias/:id', 'convocatorias:editar'), perm('PUT', 'admin/convocatorias/:id/apertura', 'convocatorias:editar'),
  perm('PUT', 'admin/convocatorias/:id/cierre', 'convocatorias:cerrar'), perm('PUT', 'admin/convocatorias/:id/archivo', 'convocatorias:archivar'),
  perm('PUT', 'admin/convocatorias/:id/preinscripcion', 'convocatorias:editar', 'Habilita o cierra la recepción de preinscripciones (independiente de la apertura académica). Solo Gerencia y Coordinación.'),
  perm('GET', 'admin/preinscripciones', 'preinscripciones:leer', 'Datos personales de visitantes: nunca públicos.'),
  perm('GET', 'admin/preinscripciones/resumen', 'preinscripciones:leer', 'Conteos por edición y estado, mínimo de apertura y cupos. Sin datos personales.'),
  perm('GET', 'admin/preinscripciones/:id', 'preinscripciones:leer'), perm('GET', 'admin/preinscripciones/:id/historial', 'preinscripciones:leer'),
  perm('PATCH', 'admin/preinscripciones/:id', 'preinscripciones:editar', 'Corrección de nombres, correo o teléfono con revisión. Estado y canal no se editan aquí.'),
  perm('PUT', 'admin/preinscripciones/:id/validacion', 'preinscripciones:editar', 'recibida → validada. Es la única que cuenta para el mínimo de apertura (junto con matriculada).'),
  perm('PUT', 'admin/preinscripciones/:id/descarte', 'preinscripciones:editar', 'Con motivo; estado final. No se borra.'),
  perm('PUT', 'admin/preinscripciones/:id/desistimiento', 'preinscripciones:editar', 'El visitante deja de estar interesado; estado final. No se borra.'),
  perm('POST', 'admin/preinscripciones/:id/conversion', 'preinscripciones:convertir', 'Crea la matrícula oficial reutilizando Matrículas (capacidad, edición abierta, estudiante existente o nuevo con DNI) en UNA transacción. La secretaría la puede usar sin recibir matriculas:* nuevos ni convocatorias:editar.'),
  perm('POST', 'admin/estudiantes', 'estudiantes:crear'), perm('PUT', 'admin/estudiantes/:id', 'estudiantes:editar'),
  perm('PUT', 'admin/estudiantes/:id/archivo', 'estudiantes:archivar', 'Archivar y restaurar con revisión; nunca elimina al estudiante.'),
  perm('GET', 'admin/convocatorias/:id/horarios', 'convocatorias:leer', 'Horarios recurrentes de la edición (día ISO 1–7 y horas HH:MM de Lima) con la revisión vigente de la edición; 404 si no existe.'),
  perm('PUT', 'admin/convocatorias/:id/horarios', 'convocatorias:editar', 'Reemplaza el conjunto completo de horarios con la revisión de la edición, en una transacción con bloqueo curso → edición: sin duplicados ni solapamientos (422), revisión obsoleta 409, edición archivada o cancelada 409. Solo Gerencia y Coordinación.'),
  perm('GET', 'admin/reportes', 'reportes_academicos:leer', 'Catálogo de reportes y capacidades de la cuenta. Solo lectura.'),
  perm('GET', 'admin/reportes/:tipo', 'reportes_academicos:leer', 'Consulta JSON paginada. Estudiantes y matrículas (datos personales) exigen además estudiantes:leer (y matriculas:leer en el reporte de matrículas), comprobados en el servicio. Los reportes comerciales y de atención (cotizaciones-*, consultas-*, actividad-comercial) exigen además cotizaciones:leer o mensajes:leer + seguimiento_mensajes:leer, también en el servicio; no tienen permiso propio ni cambian la matriz.'),
  perm('GET', 'admin/reportes/:tipo/exportar', 'reportes_academicos:exportar', 'CSV, XLSX o PDF. Estudiantes y matrículas (datos personales) exigen además estudiantes:exportar, comprobado en el servicio. Los reportes comerciales y de atención exigen además el permiso de lectura de su módulo (cotizaciones o mensajes + seguimiento).'),

  // --- Atención ---
  perm('GET', 'admin/messages', 'mensajes:leer'), perm('GET', 'admin/messages/:id', 'mensajes:leer'),
  perm('GET', 'admin/messages/exportar', 'mensajes:exportar', 'CSV controlado de consultas: mismos filtros de la bandeja, tope de filas, sin el texto del mensaje ni notas, celdas neutralizadas contra fórmulas y registro de la descarga sin datos personales. Declarada antes de :id.'),
  perm('POST', 'admin/messages', 'mensajes:crear'), perm('PUT', 'admin/messages/:id', 'mensajes:editar'),
  perm('POST', 'admin/messages/duplicados', 'mensajes:crear', 'Comprobación de duplicados (lectura): coincidencia exacta de correo, asunto y mensaje en los últimos 7 días; responde solo { hayCoincidencias, cantidad }. Límite de 30 por cuenta cada 15 minutos (rate_limit_buckets).'),
  perm('DELETE', 'admin/messages/:id', 'mensajes:eliminar'),
  follow('GET', 'admin/seguimiento/:recurso/:id', 'leer'), follow('PUT', 'admin/seguimiento/:recurso/:id', 'editar'),
  follow('POST', 'admin/seguimiento/:recurso/:id/constancia', 'enviar'), follow('POST', 'admin/seguimiento/:recurso/:id/correo', 'enviar'),
  perm('GET', 'admin/cotizaciones', 'cotizaciones:leer'), perm('GET', 'admin/cotizaciones/:id', 'cotizaciones:leer'),
  perm('GET', 'admin/cotizaciones/:id/pdf', 'cotizaciones:leer', 'PDF A4 para el cliente; solo lectura. Sin historial, revisiones, correo ni teléfono del cliente. Borrador y anulada se imprimen con su estado visible.'),
  perm('POST', 'admin/cotizaciones', 'cotizaciones:crear'),
  perm('POST', 'admin/cotizaciones/:id/duplicar', 'cotizaciones:crear', 'Crea una cotización NUEVA en borrador a partir de otra; la original no se modifica. Es crear, no editar.'),
  perm('PUT', 'admin/cotizaciones/:id', 'cotizaciones:editar'),
  perm('POST', 'admin/cotizaciones/:id/correo', 'cotizaciones:enviar'),
  byField('POST', 'admin/cotizaciones/:id/estado', 'estado', 'cotizaciones:editar', { anulada: 'cotizaciones:anular', enviada: 'cotizaciones:enviar' }, 'Cambiar el estado es edición; el destino «anulada» exige además cotizaciones:anular y «enviada» (declarar la propuesta como entregada) cotizaciones:enviar.'),
  perm('GET', 'admin/reclamaciones', 'reclamaciones:leer'), perm('GET', 'admin/reclamaciones/:id', 'reclamaciones:leer'),
  perm('DELETE', 'admin/reclamaciones/:id', 'reclamaciones:eliminar', 'Pendiente de criterio legal: podría exigirse conservarlas.'),
  perm('GET', 'admin/newsletter', 'boletin:leer', 'Devuelve la lista completa de correos; no existe endpoint de exportación (la exportación es del navegador).'),
  perm('DELETE', 'admin/newsletter/:id', 'boletin:eliminar'),
  perm('GET', 'admin/chatbot/sin-respuesta', 'chatbot_consultas:leer'),
  perm('GET', 'admin/stats', 'estadisticas:leer'), perm('GET', 'admin/stats/actividad', 'estadisticas:leer'),
  auth('POST', 'admin/asistente/consultar', 'HORUS Assistant v2, solo lectura (POST solo porque envía una pregunta; no escribe nada). Sin permiso propio: el servicio lee el rol VIGENTE de la base y la IA solo puede elegir herramientas del catálogo de ese rol (cada una hereda los permisos de lectura de su área). Sin DNI, correos ni teléfonos en la pregunta ni hacia OpenAI. Límite por IP (PublicRateLimitGuard, MySQL compartido) y por cuenta. Sin IA disponible responde 503.'),
  auth('GET', 'admin/asistente/resumen', 'HORUS Assistant, solo lectura. Sin permiso propio: el servicio lee el rol VIGENTE de la base (nunca del token) y consulta cada área solo si el rol ya tiene su permiso de lectura; una cuenta sin rol recibe 403. Límite de frecuencia por cuenta, compartido entre instancias (MySQL, rate_limit_buckets; sin el almacén responde 503). La explicación opcional con IA se valida con marcadores y, si no se puede comprobar, se entrega el resumen determinista. Sin acciones de escritura.'),

  // --- Andamiaje genérico (sin uso en el panel; sin clasificar → solo gerente) ---
  perm('GET', 'admin/items', 'items:leer', 'Sin clasificar: ninguna pantalla del panel lo usa. Solo gerente hasta decidir si se conserva.'),
  perm('GET', 'admin/items/:id', 'items:leer'), perm('POST', 'admin/items', 'items:crear'),
  perm('PUT', 'admin/items/:id', 'items:editar'), perm('DELETE', 'admin/items/:id', 'items:eliminar'),
];
