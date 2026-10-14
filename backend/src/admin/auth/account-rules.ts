import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminRole, isAdminRole } from '../../permissions/roles';

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

// Comprobación final con los conteos releídos de la base tras escribir (defensa ante un error de las reglas o una escritura inesperada).
export function assertInvariants(before: { activos: number; gerentes: number }, after: { activos: number; gerentes: number }) {
  if (before.activos > 0 && after.activos === 0) throw new ConflictException(LAST_ACTIVE_MESSAGE);
  if (before.gerentes > 0 && after.gerentes === 0) throw new ConflictException(LAST_GERENTE_MESSAGE);
}
