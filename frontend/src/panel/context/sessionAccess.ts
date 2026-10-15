// Contrato de sesión que el backend entrega en POST /admin/login y GET /admin/me (H-BACK-01, E3.4.1), interpretado por el panel.
// Módulo puro, sin React ni red (lo cargan también las pruebas de Node).
//
// IMPORTANTE: esta información es solo para adaptar la interfaz. NO autoriza nada: la autorización efectiva es siempre del backend
// (AccessGuard, activa desde E3.6: `acceso.modo` vale «por_roles»; «heredado» solo llega de un backend anterior). Por eso:
//  - `permisos` se copia tal como llega del backend; el panel no tiene su propia matriz de permisos.
//  - El rol y los permisos viven solo en la memoria de la sesión: nunca se guardan en localStorage/sessionStorage ni se leen de ahí.
//  - Una respuesta incompleta o incoherente no concede nada: se trata como inválida.
import type { AdminUser } from '../types/admin.types';

export const ADMIN_ROLES = ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL', 'SECRETARIA'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

// heredado: el backend NO aplica permisos por rol (cualquier sesión válida usa todo el panel). por_roles: sí los aplica.
export const ACCESS_MODES = ['heredado', 'por_roles'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export interface SessionAccess {
  // roles: el backend informó rol, permisos y modo. antiguo: el backend no conoce el contrato (rol y permisos NO se conocen, lo que es
  // distinto de «cuenta sin rol»); el panel sigue en modo heredado y no debe presentar ninguna restricción.
  contract: 'roles' | 'antiguo';
  mode: AccessMode;
  rol: AdminRole | null;
  permisos: readonly string[];
}

export type ParsedSession =
  | { kind: 'roles' | 'antiguo'; user: AdminUser; access: SessionAccess }
  | { kind: 'invalid' };

const INVALID: ParsedSession = { kind: 'invalid' };
const MAX_PERMISSIONS = 500; // el catálogo real tiene unas decenas; un valor desmesurado indica una respuesta que no es del backend
const MAX_PERMISSION_LENGTH = 100;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

// Solo se conserva la identidad conocida (id, nombre, correo): cualquier otro campo de la respuesta se descarta.
function identity(raw: Record<string, unknown>): AdminUser | null {
  const { id, nombre, email } = raw;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || typeof nombre !== 'string' || typeof email !== 'string') return null;
  return { id, nombre, email };
}

// Clasifica una respuesta de login o de /admin/me:
//  - «roles»: contrato nuevo completo y coherente (user.rol, user.permisos y acceso.modo).
//  - «antiguo»: ninguno de los tres campos (backend anterior a E3.4.1). Sin rol ni permisos conocidos, modo heredado.
//  - «invalid»: identidad ausente o mal formada, contrato a medias o incoherente (rol desconocido, permisos que no son una lista de
//    textos, modo desconocido, o permisos con rol null). No concede nada.
export function parseSession(response: unknown): ParsedSession {
  if (!isRecord(response) || !isRecord(response.user)) return INVALID;
  const raw = response.user;
  const user = identity(raw);
  if (!user) return INVALID;

  const present = [has(raw, 'rol'), has(raw, 'permisos'), has(response, 'acceso')];
  if (!present.some(Boolean)) {
    return { kind: 'antiguo', user, access: Object.freeze({ contract: 'antiguo', mode: 'heredado', rol: null, permisos: Object.freeze([]) as readonly string[] }) };
  }
  if (!present.every(Boolean)) return INVALID; // contrato a medias: no se adivina lo que falta

  const rol = raw.rol === null ? null : (ADMIN_ROLES as readonly unknown[]).includes(raw.rol) ? (raw.rol as AdminRole) : undefined;
  if (rol === undefined) return INVALID;
  const list = raw.permisos;
  if (!Array.isArray(list) || list.length > MAX_PERMISSIONS
    || !list.every(item => typeof item === 'string' && item.length > 0 && item.length <= MAX_PERMISSION_LENGTH)) return INVALID;
  const permisos = [...new Set(list as string[])];
  if (rol === null && permisos.length > 0) return INVALID; // sin rol no puede haber permisos
  const acceso = response.acceso;
  if (!isRecord(acceso) || !(ACCESS_MODES as readonly unknown[]).includes(acceso.modo)) return INVALID;

  return { kind: 'roles', user, access: Object.freeze({ contract: 'roles', mode: acceso.modo as AccessMode, rol, permisos: Object.freeze(permisos) }) };
}

// ¿Incluye la lista de permisos recibida del backend este permiso? Función pura, todavía sin conectar al menú ni a las acciones (E3.4.3).
// Solo informa a la interfaz: ocultar o mostrar algo con ella no protege nada. Una lista ausente o con otra forma no incluye nada.
export function hasPermission(permisos: readonly string[] | null | undefined, permiso: string): boolean {
  return Array.isArray(permisos) && typeof permiso === 'string' && permiso.length > 0 && permisos.includes(permiso);
}
