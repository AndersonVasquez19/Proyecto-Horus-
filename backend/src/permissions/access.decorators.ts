import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';
import type { FollowUpOperation, RouteAccess } from './access';

// Decoradores de clasificación de rutas. Solo añaden metadatos: mientras AccessGuard no esté activo (E3.3), no cambian el
// comportamiento de ninguna ruta. Cada ruta debe llevar exactamente uno; una ruta sin él quedará denegada al activar la guard.
export const ACCESS_METADATA = 'horus:route-access';

const declare = (access: RouteAccess) => SetMetadata(ACCESS_METADATA, Object.freeze(access));

export const PublicRoute = () => declare({ kind: 'publica' });
export const AuthenticatedRoute = () => declare({ kind: 'autenticada' });
export const RequirePermission = (permission: Permission) => declare({ kind: 'permiso', permission });
export const RequireFollowUp = (operation: FollowUpOperation) => declare({ kind: 'seguimiento', operation });
export const RequireByField = (field: string, base: Permission, when: Record<string, Permission>) =>
  declare({ kind: 'segun_campo', field, base, when: Object.freeze({ ...when }) });
