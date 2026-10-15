// Navegación del panel según los permisos de la sesión (H-BACK-01, E3.4.3, fase 1). Módulo puro, sin React ni red (lo cargan también
// las pruebas de Node).
//
// IMPORTANTE: ocultar una sección es solo un filtro visual; la autorización efectiva es siempre del backend (AccessGuard, que hoy
// sigue sin activarse). Aquí no hay matriz de permisos por rol: cada sección declara el permiso de LECTURA que exige el endpoint que
// carga al abrirse (ver backend/src/permissions/route-inventory.ts), y la sesión aporta la lista de permisos que informó el backend.
// El nombre del rol no se usa para decidir nada.
import type { SessionAccess } from './sessionAccess';

export type PanelGroup = 'principal' | 'contenido' | 'atencion' | 'cuenta';

export interface PanelSectionRule {
  key: string; // valor de ?section= (mensajes también responde en /admin/messages)
  group: PanelGroup;
  // Basta uno de ellos para abrir la sección. Lista vacía: autoservicio de la propia cuenta, sin permiso.
  anyOf: readonly string[];
  target: string; // destino actual
  // Condiciones especiales (justificadas en `note`).
  requiresRolesMode?: boolean;
  available?: false; // declarada pero sin habilitar en esta etapa: nunca se muestra ni se monta
  note?: string;
}

// Permiso de lectura de cada recurso de ResourceManager (la clave de `resources` en types/workspace.ts).
export const RESOURCE_READ: Readonly<Record<string, string>> = Object.freeze({
  cursos: 'cursos:leer',
  servicios: 'servicios:leer',
  faq: 'preguntas_frecuentes:leer',
  galeria: 'galeria:leer',
  contenido: 'items:leer',
});

// Operaciones de escritura (E3.4.3, fase 2). Igual que la lectura, cada permiso es el que exige la ruta correspondiente en
// route-inventory.ts (test:panel-access los contrasta). Deciden qué botones, formularios y direcciones (?crear=1) se ofrecen, y cada
// operación lo vuelve a comprobar antes de enviar su solicitud (también con Enter). Sigue siendo solo interfaz: no protege nada.
export interface ResourceWrite {
  crear: string;
  editar: string;
  eliminar: string; // permiso del DELETE (en preguntas frecuentes el DELETE solo archiva)
  archivar?: string; // guardar con estado «archivado» lo exige además de editar; sin él, archivar es una edición más
}
// Clave: `endpoint` del recurso de ResourceManager (types/workspace.ts).
export const RESOURCE_WRITE: Readonly<Record<string, ResourceWrite>> = Object.freeze({
  cursos: { crear: 'cursos:crear', editar: 'cursos:editar', eliminar: 'cursos:eliminar', archivar: 'cursos:archivar' },
  servicios: { crear: 'servicios:crear', editar: 'servicios:editar', eliminar: 'servicios:eliminar' },
  'preguntas-frecuentes': { crear: 'preguntas_frecuentes:crear', editar: 'preguntas_frecuentes:editar', eliminar: 'preguntas_frecuentes:archivar', archivar: 'preguntas_frecuentes:archivar' },
  galeria: { crear: 'galeria:crear', editar: 'galeria:editar', eliminar: 'galeria:eliminar' },
  items: { crear: 'items:crear', editar: 'items:editar', eliminar: 'items:eliminar' },
});

// Resto de operaciones del panel, con la ruta que las exige.
export const PANEL_ACTIONS = Object.freeze({
  subirImagen: 'archivos:crear', // POST /admin/uploads
  leerContenidoOriginal: 'contenido_original:leer', // GET /admin/contenido-original (lo carga el diálogo de recuperación)
  restaurarContenidoOriginal: 'contenido_original:restaurar', // POST /admin/contenido-original/:section
  crearConvenio: 'convenios:crear', editarConvenio: 'convenios:editar', eliminarConvenio: 'convenios:eliminar', // también fotos (editar)
  crearCotizacion: 'cotizaciones:crear', editarCotizacion: 'cotizaciones:editar', enviarCotizacion: 'cotizaciones:enviar', anularCotizacion: 'cotizaciones:anular',
  crearMensaje: 'mensajes:crear', eliminarMensaje: 'mensajes:eliminar',
  leerSeguimiento: 'seguimiento_mensajes:leer', editarSeguimiento: 'seguimiento_mensajes:editar', enviarSeguimiento: 'seguimiento_mensajes:enviar',
  editarConfiguracion: 'configuracion:editar', // PUT /admin/settings
} as const);

export const PANEL_SECTIONS: readonly PanelSectionRule[] = Object.freeze([
  { key: 'resumen', group: 'principal', anyOf: ['estadisticas:leer'], target: '/admin/dashboard?section=resumen', note: 'GET /admin/stats y /admin/stats/actividad' },
  { key: 'cursos', group: 'contenido', anyOf: ['cursos:leer', 'servicios:leer'], target: '/admin/dashboard?section=educacion', note: 'Educación: Asesoramiento usa servicios; Capacitaciones y Cursos, cursos. Cada subsección se comprueba con RESOURCE_READ' },
  { key: 'servicios', group: 'contenido', anyOf: ['servicios:leer'], target: '/admin/dashboard?section=servicios' },
  { key: 'galeria', group: 'contenido', anyOf: ['galeria:leer'], target: '/admin/dashboard?section=galeria' },
  { key: 'faq', group: 'contenido', anyOf: ['preguntas_frecuentes:leer'], target: '/admin/dashboard?section=faq' },
  { key: 'contenido', group: 'contenido', anyOf: ['items:leer'], target: '/admin/dashboard?section=contenido', note: 'Biblioteca de contenido (GET /admin/items)' },
  { key: 'convenios', group: 'contenido', anyOf: ['convenios:leer'], target: '/admin/dashboard?section=convenios' },
  { key: 'mensajes', group: 'atencion', anyOf: ['mensajes:leer'], target: '/admin/messages' },
  { key: 'cotizaciones', group: 'atencion', anyOf: ['cotizaciones:leer'], target: '/admin/dashboard?section=cotizaciones' },
  { key: 'chatbot', group: 'atencion', anyOf: ['chatbot_consultas:leer'], target: '/admin/dashboard?section=chatbot' },
  { key: 'ajustes', group: 'atencion', anyOf: ['configuracion:leer'], target: '/admin/dashboard?section=ajustes', note: 'Información de empresa (GET /admin/settings)' },
  { key: 'configuracion', group: 'cuenta', anyOf: [], target: '/admin/dashboard?section=configuracion', note: 'Ajustes de la propia cuenta (cambio de contraseña): toda sesión válida' },
  { key: 'cuentas', group: 'cuenta', anyOf: ['cuentas:leer'], target: '/admin/dashboard?section=cuentas', requiresRolesMode: true, available: false, note: 'Cuentas y acceso: solo con modo por_roles y cuentas:leer; sin habilitar en E3.4.3 (PanelAccounts no se monta)' },
] satisfies PanelSectionRule[]);

const RULES = new Map(PANEL_SECTIONS.map(rule => [rule.key, rule]));

// none: sesión sin validar o sin contrato (no se muestra nada). legacy: backend antiguo, o cuenta sin rol mientras el modo sea
// heredado: el panel sigue completo, como antes de los roles. roles: filtrado por permisos. sin-rol: modo por_roles sin rol asignado.
export type PanelNavigationKind = 'none' | 'legacy' | 'roles' | 'sin-rol';

export interface PanelNavigation {
  kind: PanelNavigationKind;
  // Sección de inicio; null cuando la cuenta no puede abrir ninguna sección de trabajo (se muestra un aviso).
  home: string | null;
  canOpen(section: string): boolean;
  canOpenResource(resource: string): boolean;
  // ¿Se ofrece la operación que exige este permiso? Navegación heredada: sí (como antes de los roles). Con rol: solo si figura en la
  // lista de la sesión. Sin rol en por_roles o sin sesión validada: no.
  can(permission: string): boolean;
}

export function panelNavigation(access: SessionAccess | null | undefined): PanelNavigation {
  const kind: PanelNavigationKind = !access ? 'none'
    : access.contract === 'antiguo' || (access.rol === null && access.mode === 'heredado') ? 'legacy'
      : access.rol === null ? 'sin-rol' : 'roles';
  const granted = new Set(kind === 'roles' ? access!.permisos : []);
  const mode = access?.mode;
  const canOpenResource = (resource: string) => {
    if (kind === 'legacy') return Object.prototype.hasOwnProperty.call(RESOURCE_READ, resource);
    if (kind !== 'roles') return false;
    const permission = Object.prototype.hasOwnProperty.call(RESOURCE_READ, resource) ? RESOURCE_READ[resource] : undefined;
    return permission !== undefined && granted.has(permission);
  };
  const canOpen = (section: string) => {
    const rule = typeof section === 'string' ? RULES.get(section) : undefined;
    if (!rule || rule.available === false || kind === 'none') return false;
    if (rule.requiresRolesMode && mode !== 'por_roles') return false;
    if (rule.anyOf.length === 0) return true; // autoservicio
    if (kind === 'legacy') return true;
    if (kind === 'sin-rol') return false;
    return rule.anyOf.some(permission => granted.has(permission));
  };
  // Inicio: Resumen si se pueden leer estadísticas (evita el 403 de GET /admin/stats); si no, la bandeja de mensajes; si tampoco,
  // la primera sección de trabajo disponible. Los ajustes de la propia cuenta no son una sección de trabajo.
  const home = kind === 'none' ? null
    : canOpen('resumen') ? 'resumen'
      : canOpen('mensajes') ? 'mensajes'
        : PANEL_SECTIONS.find(rule => rule.anyOf.length > 0 && canOpen(rule.key))?.key ?? null;
  const can = (permission: string) => typeof permission === 'string' && permission.length > 0
    && (kind === 'legacy' || (kind === 'roles' && granted.has(permission)));
  return { kind, home, canOpen, canOpenResource, can };
}
