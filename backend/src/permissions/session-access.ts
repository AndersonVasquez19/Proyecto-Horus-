import type { Permission } from './permissions';
import { permissionsOf } from './policy';
import { AdminRole, isAdminRole } from './roles';

// E3.4.1 — Información de acceso que el login y GET /admin/me entregan al panel para adaptar su interfaz (menú, botones).
// Es solo informativa: mostrar u ocultar algo en el panel no protege nada. La autorización efectiva la decide AccessGuard en el
// servidor, registrada como guard global en app.module.ts desde E3.6.
//
// Modo de acceso:
//  heredado   La guard de autorización por roles NO está registrada: cualquier sesión válida usa todo el panel, tenga o no rol.
//             Es el contrato de los backends anteriores a E3.6; el panel lo sigue admitiendo por compatibilidad.
//  por_roles  La guard está registrada como guard global y el backend aplica los permisos de cada rol (valor actual).
// El valor debe coincidir con el registro real de la guard en app.module.ts; una prueba lo comprueba en ambos sentidos, de modo que
// declarar «por_roles» sin registrar la guard (o registrarla sin declararlo) hace fallar la suite. No depende de variables de entorno:
// activar o revertir E3.6 es cambiar ambos a la vez.
export type AccessMode = 'heredado' | 'por_roles';
export const ACCESS_MODE: AccessMode = 'por_roles';

export interface SessionAccess { rol: AdminRole | null; permisos: Permission[] }

// El rol recibido debe venir de la base (fila leída en esta misma solicitud), nunca del JWT, de cabeceras ni del cuerpo.
// Un valor desconocido equivale a no tener rol: sin permisos.
export function sessionAccess(rol: unknown): SessionAccess {
  const known = isAdminRole(rol) ? rol : null;
  return { rol: known, permisos: known ? permissionsOf(known) : [] };
}
