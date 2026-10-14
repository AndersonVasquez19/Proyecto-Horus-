import type { Permission } from './permissions';

// Inventario documental de las rutas HTTP actuales y del permiso que exigirán cuando se active el control de acceso.
// Etapa 1: NO lo consume ningún guard. Existe para (1) fijar la clasificación en un solo lugar y (2) que una prueba falle
// si alguien añade una ruta sin clasificarla. Las rutas van sin el prefijo global «api».
//
//  publica        Sin sesión (formularios públicos, contenido público, login y recuperación de contraseña).
//  autenticada    Cualquier sesión válida, incluso una cuenta sin rol: autoservicio (/admin/me, cambio de la propia contraseña).
//  permiso        Un único permiso.
//  mixta          La misma ruta mezcla operaciones con permisos distintos: necesita separación o comprobación específica.
//  seguimiento    El permiso depende del parámetro :recurso (ver seguimientoPermission).
export type RouteAccess =
  | { kind: 'publica' }
  | { kind: 'autenticada' }
  | { kind: 'permiso'; permission: Permission }
  | { kind: 'mixta'; permissions: readonly Permission[]; note: string }
  | { kind: 'seguimiento'; operation: 'leer' | 'editar' | 'enviar' };

export interface RouteEntry { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; access: RouteAccess; note?: string }

const pub = (method: RouteEntry['method'], path: string, note?: string): RouteEntry => ({ method, path, access: { kind: 'publica' }, note });
const auth = (method: RouteEntry['method'], path: string, note?: string): RouteEntry => ({ method, path, access: { kind: 'autenticada' }, note });
const perm = (method: RouteEntry['method'], path: string, permission: Permission, note?: string): RouteEntry => ({ method, path, access: { kind: 'permiso', permission }, note });
const mixed = (method: RouteEntry['method'], path: string, permissions: readonly Permission[], note: string): RouteEntry => ({ method, path, access: { kind: 'mixta', permissions, note } });
const follow = (method: RouteEntry['method'], path: string, operation: 'leer' | 'editar' | 'enviar'): RouteEntry => ({ method, path, access: { kind: 'seguimiento', operation } });

const STATE_NOTE = 'El mismo PUT puede cambiar el estado a «archivado»: archivar y editar son permisos distintos. Separar o comprobar el estado en el servicio antes de activar.';

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
  auth('GET', 'admin/me'), auth('POST', 'admin/password'),
  perm('POST', 'admin/register', 'cuentas:crear', 'Hoy lo puede usar cualquier administrador. Solo gerente; el rol deberá indicarse de forma explícita.'),
  perm('GET', 'admin/users', 'cuentas:leer'),
  perm('PUT', 'admin/users/:id', 'cuentas:editar', 'Activar o desactivar. El cambio de rol irá en una ruta propia con cuentas:asignar_rol (no existe aún).'),

  // --- Configuración y contenido original ---
  perm('GET', 'admin/settings', 'configuracion:leer', 'Las 10 claves (empresa_nombre, ruc, email_contacto, telefono_principal, whatsapp, direccion, horario_atencion, facebook_url, instagram_url, linkedin_url) ya son públicas en GET /settings.'),
  perm('PUT', 'admin/settings', 'configuracion:editar', 'Todas las claves actuales se tratan igual; si se decide distinguir claves críticas, habrá que comprobarlo por clave en el servicio.'),
  perm('GET', 'admin/contenido-original', 'contenido_original:leer'),
  perm('POST', 'admin/contenido-original/:section', 'contenido_original:restaurar', 'Sobrescribe contenido publicado: operación delicada.'),

  // --- Catálogo ---
  perm('GET', 'admin/cursos', 'cursos:leer'), perm('GET', 'admin/cursos/:id', 'cursos:leer'),
  perm('POST', 'admin/cursos', 'cursos:crear'),
  mixed('PUT', 'admin/cursos/:id', ['cursos:editar', 'cursos:archivar'], STATE_NOTE),
  perm('DELETE', 'admin/cursos/:id', 'cursos:eliminar', 'Borrado físico hoy. Debe impedirse cuando existan convocatorias o matrículas (control en servicio y claves foráneas).'),
  perm('GET', 'admin/servicios', 'servicios:leer'), perm('GET', 'admin/servicios/:id', 'servicios:leer'),
  perm('POST', 'admin/servicios', 'servicios:crear'),
  mixed('PUT', 'admin/servicios/:id', ['servicios:editar'], STATE_NOTE + ' (servicios no tiene permiso de archivar: hoy archivar un servicio exige servicios:editar).'),
  perm('DELETE', 'admin/servicios/:id', 'servicios:eliminar'),
  perm('GET', 'admin/preguntas-frecuentes', 'preguntas_frecuentes:leer'), perm('GET', 'admin/preguntas-frecuentes/:id', 'preguntas_frecuentes:leer'),
  perm('POST', 'admin/preguntas-frecuentes', 'preguntas_frecuentes:crear'),
  mixed('PUT', 'admin/preguntas-frecuentes/:id', ['preguntas_frecuentes:editar', 'preguntas_frecuentes:archivar'], STATE_NOTE),
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

  // --- Atención ---
  perm('GET', 'admin/messages', 'mensajes:leer'), perm('GET', 'admin/messages/:id', 'mensajes:leer'),
  perm('POST', 'admin/messages', 'mensajes:crear'), perm('PUT', 'admin/messages/:id', 'mensajes:editar'),
  perm('DELETE', 'admin/messages/:id', 'mensajes:eliminar'),
  follow('GET', 'admin/seguimiento/:recurso/:id', 'leer'), follow('PUT', 'admin/seguimiento/:recurso/:id', 'editar'),
  follow('POST', 'admin/seguimiento/:recurso/:id/constancia', 'enviar'), follow('POST', 'admin/seguimiento/:recurso/:id/correo', 'enviar'),
  perm('GET', 'admin/cotizaciones', 'cotizaciones:leer'), perm('GET', 'admin/cotizaciones/:id', 'cotizaciones:leer'),
  perm('POST', 'admin/cotizaciones', 'cotizaciones:crear'), perm('PUT', 'admin/cotizaciones/:id', 'cotizaciones:editar'),
  perm('POST', 'admin/cotizaciones/:id/correo', 'cotizaciones:enviar'),
  mixed('POST', 'admin/cotizaciones/:id/estado', ['cotizaciones:editar', 'cotizaciones:anular'], 'El destino «anulada» es una anulación; «aceptada»/«rechazada»/«enviada» son edición. Comprobar el estado destino en el servicio.'),
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
