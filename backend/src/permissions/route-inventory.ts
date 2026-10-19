import type { Permission } from './permissions';
import type { FollowUpOperation, RouteAccess } from './access';

// Inventario escrito a mano de las rutas HTTP actuales y de la clasificación que exige AccessGuard, activa desde E3.6 (ver access.ts).
// No lo consume la guard: la guard lee los decoradores de los controladores. Una prueba compara ambos y falla si alguien añade una
// ruta sin clasificar o si un decorador no coincide con este inventario. Las rutas van sin el prefijo global «api».
export type { RouteAccess } from './access';

export interface RouteEntry { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; access: RouteAccess; note?: string }

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

  // --- Gestión académica: estudiantes (sin borrado físico) ---
  perm('GET', 'admin/estudiantes', 'estudiantes:leer'), perm('GET', 'admin/estudiantes/:id', 'estudiantes:leer'),
  perm('GET', 'admin/convocatorias', 'convocatorias:leer'), perm('GET', 'admin/convocatorias/cursos', 'convocatorias:leer'),
  perm('GET', 'admin/convocatorias/:id', 'convocatorias:leer'), perm('POST', 'admin/convocatorias', 'convocatorias:crear'),
  perm('PUT', 'admin/convocatorias/:id', 'convocatorias:editar'), perm('PUT', 'admin/convocatorias/:id/apertura', 'convocatorias:editar'),
  perm('PUT', 'admin/convocatorias/:id/cierre', 'convocatorias:cerrar'), perm('PUT', 'admin/convocatorias/:id/archivo', 'convocatorias:archivar'),
  perm('POST', 'admin/estudiantes', 'estudiantes:crear'), perm('PUT', 'admin/estudiantes/:id', 'estudiantes:editar'),
  perm('PUT', 'admin/estudiantes/:id/archivo', 'estudiantes:archivar', 'Archivar y restaurar con revisión; nunca elimina al estudiante.'),

  // --- Atención ---
  perm('GET', 'admin/messages', 'mensajes:leer'), perm('GET', 'admin/messages/:id', 'mensajes:leer'),
  perm('POST', 'admin/messages', 'mensajes:crear'), perm('PUT', 'admin/messages/:id', 'mensajes:editar'),
  perm('DELETE', 'admin/messages/:id', 'mensajes:eliminar'),
  follow('GET', 'admin/seguimiento/:recurso/:id', 'leer'), follow('PUT', 'admin/seguimiento/:recurso/:id', 'editar'),
  follow('POST', 'admin/seguimiento/:recurso/:id/constancia', 'enviar'), follow('POST', 'admin/seguimiento/:recurso/:id/correo', 'enviar'),
  perm('GET', 'admin/cotizaciones', 'cotizaciones:leer'), perm('GET', 'admin/cotizaciones/:id', 'cotizaciones:leer'),
  perm('POST', 'admin/cotizaciones', 'cotizaciones:crear'), perm('PUT', 'admin/cotizaciones/:id', 'cotizaciones:editar'),
  perm('POST', 'admin/cotizaciones/:id/correo', 'cotizaciones:enviar'),
  byField('POST', 'admin/cotizaciones/:id/estado', 'estado', 'cotizaciones:editar', { anulada: 'cotizaciones:anular' }, 'Cambiar el estado es edición; el destino «anulada» exige además cotizaciones:anular.'),
  perm('GET', 'admin/reclamaciones', 'reclamaciones:leer'), perm('GET', 'admin/reclamaciones/:id', 'reclamaciones:leer'),
  perm('DELETE', 'admin/reclamaciones/:id', 'reclamaciones:eliminar', 'Pendiente de criterio legal: podría exigirse conservarlas.'),
  perm('GET', 'admin/newsletter', 'boletin:leer', 'Devuelve la lista completa de correos; no existe endpoint de exportación (la exportación es del navegador).'),
  perm('DELETE', 'admin/newsletter/:id', 'boletin:eliminar'),
  perm('GET', 'admin/chatbot/sin-respuesta', 'chatbot_consultas:leer'),
  perm('GET', 'admin/stats', 'estadisticas:leer'), perm('GET', 'admin/stats/actividad', 'estadisticas:leer'),

  // --- Andamiaje genérico (sin uso en el panel; sin clasificar → solo gerente) ---
  perm('GET', 'admin/items', 'items:leer', 'Sin clasificar: ninguna pantalla del panel lo usa. Solo gerente hasta decidir si se conserva.'),
  perm('GET', 'admin/items/:id', 'items:leer'), perm('POST', 'admin/items', 'items:crear'),
  perm('PUT', 'admin/items/:id', 'items:editar'), perm('DELETE', 'admin/items/:id', 'items:eliminar'),
];
