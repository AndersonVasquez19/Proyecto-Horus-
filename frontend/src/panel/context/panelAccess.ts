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
  return { kind, home, canOpen, canOpenResource };
}
