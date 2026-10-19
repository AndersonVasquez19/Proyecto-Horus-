import { Prisma } from '@prisma/client';

// Conflictos de bloqueo al administrar cuentas (H-BACK-01, E3.1, observación O-1).
// Sin límite, un SELECT ... FOR UPDATE espera las filas retenidas por otra transacción hasta innodb_lock_wait_timeout (50 s por defecto):
// el tiempo máximo de la transacción interactiva de Prisma (5 s) no interrumpe la consulta en curso, porque el ROLLBACK queda en cola en la
// misma conexión, y la petición terminaba en un 500 ocupando una de las dos conexiones del pool. Con NOWAIT la consulta falla al instante
// (3572) y el servicio reintenta una transacción nueva unas pocas veces antes de responder 409.
// Códigos de MySQL: 3572 ER_LOCK_NOWAIT; 1205 ER_LOCK_WAIT_TIMEOUT (también el de NOWAIT en MariaDB); 1213 ER_LOCK_DEADLOCK.
const LOCK_NOWAIT = '3572';
const LOCK_CONFLICTS = new Set([LOCK_NOWAIT, '1205', '1213']);
export const ACCOUNTS_BUSY_MESSAGE = 'Otra operación está modificando las cuentas en este momento. Vuelve a intentarlo en unos segundos.';

// Código original de MySQL. Con el adaptador de MariaDB, $queryRaw lo entrega como P2010 con meta.driverAdapterError; las consultas del
// cliente que Prisma no traduce (como 1205) llegan como el DriverAdapterError sin convertir. Cualquier otro error devuelve undefined.
export function mysqlErrorCode(error: unknown): string | undefined {
  const adapter = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { driverAdapterError?: unknown } | undefined)?.driverAdapterError : error;
  if (!adapter || typeof adapter !== 'object' || (adapter as { name?: unknown }).name !== 'DriverAdapterError') return undefined;
  const code = (adapter as { cause?: { originalCode?: unknown } }).cause?.originalCode;
  return typeof code === 'string' ? code : undefined;
}
export const isLockNowait = (error: unknown) => mysqlErrorCode(error) === LOCK_NOWAIT;
export const isLockConflict = (error: unknown) => LOCK_CONFLICTS.has(mysqlErrorCode(error) ?? '');
