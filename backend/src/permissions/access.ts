import { Permission, isPermission, seguimientoPermission } from './permissions';

// Cómo se protege cada ruta HTTP. Lo declaran los decoradores de access.decorators.ts sobre los controladores y lo exige AccessGuard,
// registrada como guard global en app.module.ts desde E3.6.
//
//  publica       Sin sesión (formularios y contenido públicos, login y recuperación de contraseña).
//  autenticada   Cualquier sesión válida, incluso de una cuenta sin rol: autoservicio (/admin/me, cambio de la propia contraseña).
//  permiso       Un único permiso.
//  seguimiento   El permiso depende del parámetro :recurso de la ruta (ver seguimientoPermission).
//  segun_campo   Siempre exige `base`; si el cuerpo trae `field` con un valor de `when`, exige además ese permiso
//                (p. ej. pasar un curso a «archivado» exige cursos:editar y cursos:archivar).
export type FollowUpOperation = 'leer' | 'editar' | 'enviar';

export type RouteAccess =
  | { kind: 'publica' }
  | { kind: 'autenticada' }
  | { kind: 'permiso'; permission: Permission }
  | { kind: 'seguimiento'; operation: FollowUpOperation }
  | { kind: 'segun_campo'; field: string; base: Permission; when: Readonly<Record<string, Permission>> };

export type AccessRequirement =
  | { kind: 'publica' }
  | { kind: 'autenticada' }
  | { kind: 'permisos'; permissions: Permission[] }
  | { kind: 'denegada' };

const DENIED: AccessRequirement = { kind: 'denegada' };
const FOLLOW_UP_OPERATIONS: readonly unknown[] = ['leer', 'editar', 'enviar'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

// Comprueba la forma completa de la declaración: cualquier dato inesperado (decorador ausente, tipo desconocido, permiso inexistente)
// se trata como una ruta sin clasificar.
export function isRouteAccess(access: unknown): access is RouteAccess {
  if (!isRecord(access)) return false;
  switch (access.kind) {
    case 'publica': case 'autenticada': return true;
    case 'permiso': return isPermission(access.permission);
    case 'seguimiento': return FOLLOW_UP_OPERATIONS.includes(access.operation);
    case 'segun_campo':
      return typeof access.field === 'string' && access.field.length > 0 && isPermission(access.base) && isRecord(access.when)
        && Object.keys(access.when).length > 0 && Object.values(access.when).every(isPermission);
    default: return false;
  }
}

// Requisito concreto de una solicitud. Denegación por defecto: sin declaración válida o con un recurso de seguimiento desconocido,
// la ruta queda denegada (también para el gerente). Los datos de la solicitud solo pueden AÑADIR exigencias, nunca quitarlas.
export function requirementFor(access: unknown, request: { params?: unknown; body?: unknown }): AccessRequirement {
  if (!isRouteAccess(access)) return DENIED;
  switch (access.kind) {
    case 'publica': return { kind: 'publica' };
    case 'autenticada': return { kind: 'autenticada' };
    case 'permiso': return { kind: 'permisos', permissions: [access.permission] };
    case 'seguimiento': {
      const recurso = isRecord(request.params) ? request.params.recurso : undefined;
      const permission = seguimientoPermission(recurso, access.operation);
      return permission ? { kind: 'permisos', permissions: [permission] } : DENIED;
    }
    case 'segun_campo': {
      // Los guards se ejecutan antes de la validación del DTO: el cuerpo aún no está validado ni recortado. Se normaliza aquí solo
      // para decidir si se exige el permiso adicional; un valor raro que no coincida lo rechazará después la validación.
      const body = request.body;
      const raw = isRecord(body) && own(body, access.field) ? body[access.field] : undefined;
      const value = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
      const extra = value !== undefined && own(access.when, value) ? access.when[value] : undefined;
      return { kind: 'permisos', permissions: extra && extra !== access.base ? [access.base, extra] : [access.base] };
    }
  }
}
