import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminRole, isAdminRole } from '../../permissions/roles';
import { can, permissionsOf } from '../../permissions/policy';

// Reglas de integridad de las cuentas administrativas (M-1 y M-2 de H-BACK-01). Funciones puras: AccountsService las evalúa dentro de
// una transacción con TODAS las filas de admin_users bloqueadas (FOR UPDATE), así dos operaciones simultáneas se deciden una tras otra
// con el estado ya confirmado de la anterior.
//
//  - Nunca queda el sistema sin una cuenta activa, ni sin un GERENTE_GENERAL activo cuando ya existe al menos uno. Mientras no se haya
//    asignado el primer gerente (transición), solo rige la primera regla.
//  - Desactivar o reactivar una cuenta deja su rol en NULL: una reactivación nunca restaura privilegios; un gerente debe asignarlos de nuevo.
//  - Pedir el estado que la cuenta ya tiene no cambia nada (ni rol, ni sesiones, ni auditoría).

export interface AccountState { id: number; activo: boolean; rol: AdminRole | null }

export const LAST_ACTIVE_MESSAGE = 'Debe quedar al menos un administrador activo.';
export const LAST_GERENTE_MESSAGE = 'No se puede desactivar al único GERENTE_GENERAL activo. Antes debe asignarse ese rol a otra cuenta activa.';

export const activeCount = (accounts: readonly AccountState[]) => accounts.filter(account => account.activo).length;
export const activeGerentes = (accounts: readonly AccountState[]) => accounts.filter(account => account.activo && account.rol === 'GERENTE_GENERAL').length;

// Filas leídas con SQL directo: el controlador de MariaDB puede devolver TINYINT como número o booleano. Un valor de rol desconocido
// nunca se interpreta como privilegio.
export function toAccountState(row: { id: unknown; activo: unknown; rol: unknown }): AccountState {
  return { id: Number(row.id), activo: row.activo === true || Number(row.activo) === 1, rol: isAdminRole(row.rol) ? row.rol : null };
}

export type StatusPlan =
  | { changed: false; mensaje: string }
  | { changed: true; before: AccountState; after: AccountState; operacion: 'cuenta_activada' | 'cuenta_desactivada'; mensaje: string };

export function planStatusChange(accounts: readonly AccountState[], id: number, activo: boolean, actor: number): StatusPlan {
  if (id === actor && !activo) throw new ConflictException('No puedes desactivar tu propia cuenta.');
  const target = accounts.find(account => account.id === id);
  if (!target) throw new NotFoundException('Cuenta no encontrada.');
  if (target.activo === activo) return { changed: false, mensaje: activo ? 'La cuenta ya estaba activa. No se hicieron cambios.' : 'La cuenta ya estaba desactivada. No se hicieron cambios.' };
  if (!activo) {
    if (activeCount(accounts) <= 1) throw new ConflictException(LAST_ACTIVE_MESSAGE);
    if (target.rol === 'GERENTE_GENERAL' && activeGerentes(accounts) <= 1) throw new ConflictException(LAST_GERENTE_MESSAGE);
  }
  return {
    changed: true, before: { ...target }, after: { id, activo, rol: null },
    operacion: activo ? 'cuenta_activada' : 'cuenta_desactivada',
    mensaje: activo ? 'Cuenta activada sin rol: un gerente debe asignarle sus permisos.' : 'Cuenta desactivada, rol retirado y sesiones revocadas.',
  };
}

// ---- Asignación de roles desde el panel («Roles y usuarios», PUT /admin/users/:id/rol) ----
// Mismas garantías que admin:assign-role (nunca deja el sistema sin GERENTE_GENERAL activo cuando ya existe uno; solo cuentas activas;
// cierra las sesiones de la cuenta) y, además:
//  - Nadie cambia su propio rol (ni para subirlo ni para bajarlo): lo hace otra persona con el permiso.
//  - Anti-escalamiento independiente de la matriz: solo se puede dar o quitar un rol cuyos permisos tenga la cuenta que actúa. Hoy solo el
//    gerente tiene cuentas:asignar_rol (y todos los permisos); si algún día otro rol lo recibiera, no podría conceder ni retirar más de lo suyo.
//  - El cliente envía el rol que veía (rol_actual): si la cuenta cambió entretanto se responde 409 y no se escribe nada.
export const SELF_ROLE_MESSAGE = 'No puedes cambiar tu propio rol. Debe hacerlo otra cuenta de la gerencia.';
export const STALE_ROLE_MESSAGE = 'El rol de esta cuenta cambió mientras la consultabas. Actualiza la lista y vuelve a intentarlo.';
export const INACTIVE_ROLE_MESSAGE = 'La cuenta está desactivada: actívala antes de cambiar su rol.';
export const ESCALATION_MESSAGE = 'No puedes asignar ni retirar un rol con permisos que tu cuenta no tiene.';
export const LAST_GERENTE_ROLE_MESSAGE = 'No se puede quitar el rol al único GERENTE_GENERAL activo. Antes debe asignarse ese rol a otra cuenta activa.';

// ¿Tiene la cuenta que actúa todos los permisos del rol? (sin rol = ningún permiso: siempre cubierto).
const covers = (actorRol: AdminRole | null, rol: AdminRole | null) => rol === null || (actorRol !== null && permissionsOf(rol).every(permission => can(actorRol, permission)));

export type RolePlan =
  | { changed: false; mensaje: string }
  | { changed: true; before: AccountState; after: AccountState; operacion: 'rol_asignado' | 'rol_retirado'; mensaje: string };

export function planRoleChange(accounts: readonly AccountState[], id: number, rol: AdminRole | null, expected: AdminRole | null, actorId: number): RolePlan {
  if (id === actorId) throw new ConflictException(SELF_ROLE_MESSAGE);
  const actor = accounts.find(account => account.id === actorId);
  if (!actor || !actor.activo || !actor.rol) throw new ForbiddenException(ESCALATION_MESSAGE);
  const target = accounts.find(account => account.id === id);
  if (!target) throw new NotFoundException('Cuenta no encontrada.');
  if (target.rol !== expected) throw new ConflictException(STALE_ROLE_MESSAGE);
  if (target.rol === rol) return { changed: false, mensaje: 'La cuenta ya tiene ese rol. No se hicieron cambios.' };
  if (!target.activo) throw new ConflictException(INACTIVE_ROLE_MESSAGE);
  if (!covers(actor.rol, target.rol) || !covers(actor.rol, rol)) throw new ForbiddenException(ESCALATION_MESSAGE);
  const after = { ...target, rol };
  if (activeGerentes(accounts) >= 1 && activeGerentes(accounts.map(account => (account.id === id ? after : account))) === 0) throw new ConflictException(LAST_GERENTE_ROLE_MESSAGE);
  return {
    changed: true, before: { ...target }, after,
    operacion: rol === null ? 'rol_retirado' : 'rol_asignado',
    mensaje: rol === null ? 'Rol retirado: la cuenta queda como cuenta básica, sin funciones administrativas, y sus sesiones se cerraron.' : 'Rol actualizado. La cuenta deberá iniciar sesión de nuevo.',
  };
}

// Comprobación final con los conteos releídos de la base tras escribir (defensa ante un error de las reglas o una escritura inesperada).
export function assertInvariants(before: { activos: number; gerentes: number }, after: { activos: number; gerentes: number }) {
  if (before.activos > 0 && after.activos === 0) throw new ConflictException(LAST_ACTIVE_MESSAGE);
  if (before.gerentes > 0 && after.gerentes === 0) throw new ConflictException(LAST_GERENTE_MESSAGE);
}
