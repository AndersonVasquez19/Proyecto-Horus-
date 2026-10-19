import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountsService } from '../src/admin/auth/accounts.service';
import { AccountState, LAST_ACTIVE_MESSAGE, LAST_GERENTE_MESSAGE, assertInvariants, planStatusChange, toAccountState } from '../src/admin/auth/account-rules';
import { ACCOUNTS_BUSY_MESSAGE, isLockConflict, isLockNowait, mysqlErrorCode } from '../src/admin/auth/account-locks';

// H-BACK-01, E3.1: M-1 (último gerente), M-2 (desactivar y reactivar sin conservar privilegios) y M-4 (auditoría en la misma transacción).
// Todo es simulado y en memoria: sin MySQL, sin red y sin datos reales. La regresión contra MySQL real está en test/prisma.integration.cjs.
const G = 'GERENTE_GENERAL', K = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const acc = (id: number, activo: boolean, rol: AccountState['rol']): AccountState => ({ id, activo, rol });
const conflict = (message: string) => (error: unknown) => error instanceof ConflictException && (error.getResponse() as any).message === message;

test('reglas: autodesactivación, cuenta inexistente y peticiones sin cambio', () => {
  const accounts = [acc(1, true, G), acc(2, true, K), acc(3, false, S)];
  assert.throws(() => planStatusChange(accounts, 1, false, 1), conflict('No puedes desactivar tu propia cuenta.'));
  assert.throws(() => planStatusChange(accounts, 99, false, 1), NotFoundException);
  // Pedir el estado actual no cambia nada: en particular, «activar» a una cuenta activa no le quita el rol.
  assert.deepEqual(planStatusChange(accounts, 2, true, 1), { changed: false, mensaje: 'La cuenta ya estaba activa. No se hicieron cambios.' });
  assert.deepEqual(planStatusChange(accounts, 3, false, 1), { changed: false, mensaje: 'La cuenta ya estaba desactivada. No se hicieron cambios.' });
  // Reactivarse a uno mismo no es posible (la cuenta inactiva no tiene sesión), pero la regla no lo confunde con una autodesactivación.
  assert.equal(planStatusChange([acc(1, false, null), acc(2, true, G)], 1, true, 1).changed, true);
});

test('M-1: nunca queda el sistema sin una cuenta activa ni sin un GERENTE_GENERAL activo', () => {
  assert.throws(() => planStatusChange([acc(1, false, G), acc(2, true, K)], 2, false, 1), conflict(LAST_ACTIVE_MESSAGE));
  // Único gerente activo, aunque queden otras cuentas activas: se rechaza.
  assert.throws(() => planStatusChange([acc(1, true, K), acc(2, true, G), acc(3, true, S)], 2, false, 1), conflict(LAST_GERENTE_MESSAGE));
  // Un gerente desactivado no cuenta como gerente disponible.
  assert.throws(() => planStatusChange([acc(1, true, K), acc(2, true, G), acc(3, false, G)], 2, false, 1), conflict(LAST_GERENTE_MESSAGE));
  // Con dos gerentes activos se puede desactivar uno (y pierde el rol).
  const plan = planStatusChange([acc(1, true, G), acc(2, true, G)], 2, false, 1);
  assert.ok(plan.changed);
  assert.deepEqual([plan.before, plan.after, plan.operacion], [acc(2, true, G), acc(2, false, null), 'cuenta_desactivada']);
});

test('M-1 en transición: sin ningún gerente asignado todavía solo rige la regla de la última cuenta activa', () => {
  const plan = planStatusChange([acc(1, true, null), acc(2, true, null), acc(3, true, K)], 3, false, 1);
  assert.ok(plan.changed && plan.after.rol === null);
  assert.equal(planStatusChange([acc(1, true, null), acc(2, true, null)], 2, false, 1).changed, true);
});

test('M-2: desactivar y reactivar dejan el rol en NULL; reactivar nunca restaura privilegios', () => {
  for (const rol of [G, K, S, null] as const) {
    const off = planStatusChange([acc(1, true, G), acc(2, true, G), acc(3, true, rol)], 3, false, 1);
    assert.ok(off.changed); assert.equal(off.after.rol, null); assert.equal(off.before.rol, rol);
    // Una cuenta inactiva que conserva un rol (estado heredado de antes de esta etapa) vuelve sin él.
    const on = planStatusChange([acc(1, true, G), acc(3, false, rol)], 3, true, 1);
    assert.ok(on.changed);
    assert.deepEqual([on.after, on.operacion], [acc(3, true, null), 'cuenta_activada']);
    assert.match(on.mensaje, /sin rol/);
  }
});

test('filas leídas con SQL: TINYINT como número o booleano y ningún valor desconocido se interpreta como rol', () => {
  assert.deepEqual(toAccountState({ id: 5, activo: 1, rol: G }), acc(5, true, G));
  assert.deepEqual(toAccountState({ id: '6', activo: 0, rol: null }), acc(6, false, null));
  assert.deepEqual(toAccountState({ id: 7, activo: true, rol: 'gerente_general' }), acc(7, true, null));
  assert.deepEqual(toAccountState({ id: 8, activo: false, rol: 'ADMIN' }), acc(8, false, null));
});

test('comprobación final: si tras escribir no queda cuenta activa o gerente activo (habiéndolos antes), se revierte', () => {
  assert.doesNotThrow(() => assertInvariants({ activos: 3, gerentes: 2 }, { activos: 2, gerentes: 1 }));
  assert.doesNotThrow(() => assertInvariants({ activos: 2, gerentes: 0 }, { activos: 1, gerentes: 0 }));
  assert.throws(() => assertInvariants({ activos: 2, gerentes: 1 }, { activos: 1, gerentes: 0 }), conflict(LAST_GERENTE_MESSAGE));
  assert.throws(() => assertInvariants({ activos: 1, gerentes: 0 }, { activos: 0, gerentes: 0 }), conflict(LAST_ACTIVE_MESSAGE));
});

// ---- Servicio con base simulada ----
// $transaction emula lo que garantiza en MySQL el SELECT ... FOR UPDATE de todas las filas: las transacciones se ejecutan de una en una y,
// si la función falla, se descartan todos sus cambios (filas y auditoría). $queryRaw cede el turno para que, sin esa serialización,
// dos operaciones se intercalarían. Con `nowait` no hay cola: como FOR UPDATE NOWAIT en MySQL, el SELECT falla con 3572 si otra transacción
// tiene las filas. `queryErrors` y `auditError` inyectan errores con la forma que entrega Prisma 6.19.3 con el adaptador de MariaDB.
type Row = { id: number; activo: boolean; rol: AccountState['rol']; session_version: number };
type Options = { failAudit?: boolean; nowait?: boolean; queryErrors?: unknown[]; auditError?: unknown };
function lockedDatabase(initial: Row[], options: Options = {}) {
  const rows = initial.map(row => ({ ...row })), audit: any[] = [], queries: string[] = [], transactions = { opened: 0, closed: 0 };
  let holder: object | null = null;
  const makeTx = () => {
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        queries.push(strings.join('?'));
        const injected = options.queryErrors?.shift();
        if (injected) throw injected;
        if (options.nowait) { if (holder && holder !== tx) throw mysqlError(3572, 'P2010'); holder = tx; }
        await new Promise(resolve => setImmediate(resolve));
        return rows.map(row => ({ id: row.id, activo: row.activo ? 1 : 0, rol: row.rol }));
      },
      adminUser: {
        updateMany: async ({ where, data }: any) => {
          const found = rows.filter(row => row.id === where.id && row.activo === where.activo);
          for (const row of found) { row.activo = data.activo; row.rol = data.rol; row.session_version += data.session_version.increment; }
          return { count: found.length };
        },
        count: async ({ where }: any) => rows.filter(row => Object.entries(where).every(([key, value]) => (row as any)[key] === value)).length,
      },
      adminAuditoria: { create: async ({ data }: any) => {
        if (options.auditError) throw options.auditError;
        if (options.failAudit) throw new Error('fallo simulado de la auditoría');
        audit.push({ ...data }); return data;
      } },
    };
    return tx;
  };
  let chain: Promise<unknown> = Promise.resolve();
  const client = {
    $transaction: (run: (t: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      const execute = async () => {
        transactions.opened++;
        const tx = makeTx(), saved = rows.map(row => ({ ...row })), entries = audit.length;
        try { return await run(tx); } catch (error) { rows.splice(0, rows.length, ...saved); audit.length = entries; throw error; }
        finally { if (holder === tx) holder = null; transactions.closed++; }
      };
      if (options.nowait) return execute();
      const result = chain.then(execute);
      chain = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const service = new AccountsService(client as any, {} as any, {} as any, {} as any);
  return { rows, audit, queries, transactions, service };
}
// Error de MySQL tal como lo entrega Prisma 6.19.3 con @prisma/adapter-mariadb: DriverAdapterError con el código original en `cause`
// (convertDriverError) y, para $queryRaw, envuelto en P2010 con meta.driverAdapterError (runtime/client.js). Sin `prismaCode`, el
// DriverAdapterError sin convertir que llega de las consultas del cliente cuyo código Prisma no traduce.
function mysqlError(errno: number, prismaCode?: string) {
  const adapter = Object.assign(new Error('simulado'), { name: 'DriverAdapterError', cause: { originalCode: String(errno), originalMessage: 'simulado', kind: 'mysql', code: errno, message: 'simulado', state: 'HY000' } });
  return prismaCode ? new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `' + errno + '`. Message: `simulado`', { code: prismaCode, clientVersion: '6.19.3', meta: { driverAdapterError: adapter } }) : adapter;
}
async function withRetryDelays<T>(delays: number[], run: () => Promise<T>): Promise<T> {
  const original = AccountsService.LOCK_RETRY_DELAYS_MS;
  (AccountsService as any).LOCK_RETRY_DELAYS_MS = delays;
  try { return await run(); } finally { (AccountsService as any).LOCK_RETRY_DELAYS_MS = original; }
}
const row = (id: number, activo: boolean, rol: Row['rol'], session_version = 1): Row => ({ id, activo, rol, session_version });

test('servicio: desactivar bloquea todas las filas en orden, retira el rol, revoca sesiones y audita en la misma transacción', async () => {
  const db = lockedDatabase([row(1, true, G), row(2, true, K, 4), row(3, true, null)]);
  assert.deepEqual(await db.service.status(2, false, 1), { ok: true, mensaje: 'Cuenta desactivada, rol retirado y sesiones revocadas.' });
  assert.match(db.queries[0], /^SELECT id, activo, rol FROM admin_users ORDER BY id FOR UPDATE NOWAIT$/);
  assert.deepEqual(db.rows[1], row(2, false, null, 5));
  assert.deepEqual(db.rows[0], row(1, true, G), 'las demás cuentas no cambian'); assert.deepEqual(db.rows[2], row(3, true, null));
  assert.deepEqual(db.audit, [{ origen: 'panel', actor_id: 1, cuenta_id: 2, operacion: 'cuenta_desactivada', rol_anterior: K, rol_nuevo: null, activo_anterior: true, activo_nuevo: false, resultado: 'aplicado' }]);
  // Reactivar: vuelve sin rol, con las sesiones de nuevo revocadas y otro registro.
  assert.match((await db.service.status(2, true, 1)).mensaje, /sin rol/);
  assert.deepEqual(db.rows[1], row(2, true, null, 6));
  assert.deepEqual(db.audit[1], { origen: 'panel', actor_id: 1, cuenta_id: 2, operacion: 'cuenta_activada', rol_anterior: null, rol_nuevo: null, activo_anterior: false, activo_nuevo: true, resultado: 'aplicado' });
});

test('servicio: una cuenta inactiva con rol heredado se reactiva sin él y la auditoría conserva el rol anterior', async () => {
  const db = lockedDatabase([row(1, true, G), row(2, false, S, 3)]);
  await db.service.status(2, true, 1);
  assert.deepEqual(db.rows[1], row(2, true, null, 4));
  assert.equal(db.audit[0].rol_anterior, S);
});

test('servicio: una petición sin cambio no toca rol, sesiones ni auditoría', async () => {
  const db = lockedDatabase([row(1, true, G, 2), row(2, true, K, 7), row(3, false, S)]);
  assert.match((await db.service.status(2, true, 1)).mensaje, /No se hicieron cambios/);
  assert.match((await db.service.status(3, false, 1)).mensaje, /No se hicieron cambios/);
  assert.deepEqual(db.rows, [row(1, true, G, 2), row(2, true, K, 7), row(3, false, S)]);
  assert.equal(db.audit.length, 0);
});

test('servicio: rechazos del último gerente y de la última cuenta activa sin escribir nada', async () => {
  const db = lockedDatabase([row(1, true, K), row(2, true, G), row(3, false, G)]);
  await assert.rejects(() => db.service.status(2, false, 1), conflict(LAST_GERENTE_MESSAGE));
  const alone = lockedDatabase([row(1, true, null), row(2, false, null)]);
  await assert.rejects(() => alone.service.status(1, false, 2), conflict(LAST_ACTIVE_MESSAGE));
  await assert.rejects(() => db.service.status(1, false, 1), conflict('No puedes desactivar tu propia cuenta.'));
  assert.equal(db.queries.length, 1, 'la autodesactivación se rechaza antes de abrir la transacción');
  assert.deepEqual(db.rows, [row(1, true, K), row(2, true, G), row(3, false, G)]);
  assert.deepEqual([db.audit.length, alone.audit.length], [0, 0]);
});

test('servicio: si falla el registro de auditoría se revierte el cambio completo (sin cambio sin registro)', async () => {
  const db = lockedDatabase([row(1, true, G), row(2, true, K, 3)], { failAudit: true });
  await assert.rejects(() => db.service.status(2, false, 1), /fallo simulado/);
  assert.deepEqual(db.rows[1], row(2, true, K, 3));
});

test('concurrencia: dos desactivaciones simultáneas de los dos únicos gerentes dejan siempre exactamente uno', async () => {
  for (let round = 0; round < 20; round++) {
    const db = lockedDatabase([row(1, true, G), row(2, true, G), row(3, true, S)]);
    // Cada gerente desactiva al otro a la vez (ninguno se desactiva a sí mismo).
    const results = await Promise.allSettled([db.service.status(2, false, 1), db.service.status(1, false, 2)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'ronda ' + round);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(conflict(LAST_GERENTE_MESSAGE)(rejected.reason));
    assert.equal(db.rows.filter(item => item.activo && item.rol === G).length, 1);
    assert.equal(db.audit.length, 1, 'solo la operación aplicada queda registrada');
  }
});

test('concurrencia: desactivaciones simultáneas de todas las demás cuentas dejan al menos una activa y un gerente', async () => {
  const db = lockedDatabase([row(1, true, G), row(2, true, K), row(3, true, S), row(4, true, null)]);
  const results = await Promise.allSettled([db.service.status(1, false, 2), db.service.status(2, false, 3), db.service.status(3, false, 4), db.service.status(4, false, 1)]);
  assert.ok(db.rows.some(item => item.activo && item.rol === G), 'el único gerente sigue activo');
  assert.ok(conflict(LAST_GERENTE_MESSAGE)((results[0] as PromiseRejectedResult).reason));
  assert.equal(db.audit.length, results.filter(result => result.status === 'fulfilled').length);
});

// ---- O-1: espera de bloqueos acotada ----
test('O-1: solo los códigos de bloqueo de MySQL cuentan como conflicto; se leen del código original, nunca del texto', () => {
  assert.equal(mysqlErrorCode(mysqlError(3572, 'P2010')), '3572');
  assert.ok(isLockNowait(mysqlError(3572, 'P2010')) && isLockConflict(mysqlError(3572, 'P2010')));
  for (const error of [mysqlError(1205, 'P2010'), mysqlError(1205), mysqlError(1213, 'P2010'), mysqlError(1213, 'P2034')]) {
    assert.ok(isLockConflict(error)); assert.ok(!isLockNowait(error), 'solo NOWAIT se reintenta');
  }
  const unrelated = [mysqlError(1146, 'P2010'), mysqlError(1062, 'P2002'), mysqlError(1146), new Error('Lock wait timeout exceeded; try restarting transaction'),
    new Prisma.PrismaClientKnownRequestError('Transaction API error: Unable to start a transaction in the given time.', { code: 'P2028', clientVersion: '6.19.3' }),
    new ConflictException(LAST_GERENTE_MESSAGE), Object.assign(new Error('x'), { name: 'DriverAdapterError' }), null, undefined, '3572', { cause: { originalCode: '3572' } }];
  for (const error of unrelated) { assert.equal(isLockConflict(error), false); assert.equal(isLockNowait(error), false); }
  // La espera total por defecto queda muy por debajo del tiempo máximo de una transacción de Prisma (5 s) y de innodb_lock_wait_timeout.
  const total = AccountsService.LOCK_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
  assert.ok(total > 0 && total <= 2000, 'espera total ' + total + ' ms');
});

test('O-1 sin contención: una sola transacción, sin reintentos ni pausas', async () => {
  const db = lockedDatabase([row(1, true, G), row(2, true, K)], { nowait: true });
  await db.service.status(2, false, 1);
  assert.deepEqual([db.queries.length, db.transactions.opened, db.transactions.closed, db.audit.length], [1, 1, 1, 1]);
});

test('O-1 bloqueo breve: NOWAIT falla, se reintenta con una transacción nueva y la operación se aplica una sola vez', async () => {
  const db = lockedDatabase([row(1, true, G), row(2, true, K, 2)], { nowait: true, queryErrors: [mysqlError(3572, 'P2010'), mysqlError(3572, 'P2010')] });
  const result = await withRetryDelays([1, 1, 1], () => db.service.status(2, false, 1));
  assert.equal(result.mensaje, 'Cuenta desactivada, rol retirado y sesiones revocadas.');
  assert.deepEqual([db.queries.length, db.transactions.opened, db.transactions.closed], [3, 3, 3]);
  assert.deepEqual(db.rows[1], row(2, false, null, 3), 'session_version sube una sola vez');
  assert.equal(db.audit.length, 1);
});

test('O-1 bloqueo prolongado: tras agotar los reintentos responde 409 controlado, sin cambios parciales y con todo cerrado', async () => {
  const initial = [row(1, true, G), row(2, true, G), row(3, true, S, 4)];
  const db = lockedDatabase(initial, { nowait: true, queryErrors: Array.from({ length: 10 }, () => mysqlError(3572, 'P2010')) });
  const started = Date.now();
  const error = await withRetryDelays([5, 5, 5], () => db.service.status(3, false, 1).then(() => assert.fail('debía rechazarse'), e => e));
  assert.ok(Date.now() - started < 1000, 'la espera queda acotada por los reintentos, no por innodb_lock_wait_timeout');
  // Respuesta HTTP: Nest serializa la excepción como 409 con un mensaje en español que el panel muestra (panelApi solo oculta los 500).
  assert.ok(error instanceof ConflictException);
  assert.deepEqual([error.getStatus(), error.getResponse()], [409, { statusCode: 409, message: ACCOUNTS_BUSY_MESSAGE, error: 'Conflict' }]);
  assert.deepEqual([db.queries.length, db.transactions.opened, db.transactions.closed], [4, 4, 4], 'un intento más los tres reintentos');
  assert.deepEqual(db.rows, initial); assert.equal(db.audit.length, 0);
});

test('O-1 otros conflictos de bloqueo (1205, 1213) responden 409 sin reintentar y revierten lo ya escrito', async () => {
  for (const failure of [mysqlError(1205), mysqlError(1213, 'P2034')]) {
    // El fallo llega al insertar la auditoría, con la cuenta ya actualizada dentro de la transacción: se revierte todo.
    const db = lockedDatabase([row(1, true, G), row(2, true, K, 2)], { nowait: true, auditError: failure });
    await withRetryDelays([1, 1], () => assert.rejects(() => db.service.status(2, false, 1), conflict(ACCOUNTS_BUSY_MESSAGE)));
    assert.deepEqual([db.transactions.opened, db.transactions.closed], [1, 1]);
    assert.deepEqual(db.rows[1], row(2, true, K, 2)); assert.equal(db.audit.length, 0);
  }
});

test('O-1 errores inesperados de la base no se disfrazan de conflicto ni se reintentan', async () => {
  for (const failure of [mysqlError(1146, 'P2010'), new Prisma.PrismaClientKnownRequestError('Transaction API error: Unable to start a transaction in the given time.', { code: 'P2028', clientVersion: '6.19.3' }), new Error('conexión perdida')]) {
    const db = lockedDatabase([row(1, true, G), row(2, true, K)], { nowait: true, queryErrors: [failure] });
    await withRetryDelays([1, 1], () => assert.rejects(() => db.service.status(2, false, 1), (error: unknown) => error === failure));
    assert.deepEqual([db.queries.length, db.transactions.opened, db.transactions.closed], [1, 1, 1]);
    assert.deepEqual(db.rows[1], row(2, true, K)); assert.equal(db.audit.length, 0);
  }
  // Tampoco un error de auditoría con la cuenta ya escrita: se propaga tal cual y se revierte.
  const db = lockedDatabase([row(1, true, G), row(2, true, K)], { nowait: true, auditError: mysqlError(1406) });
  await assert.rejects(() => db.service.status(2, false, 1), (error: any) => error?.cause?.originalCode === '1406');
  assert.deepEqual(db.rows[1], row(2, true, K));
});

test('O-1 con NOWAIT se conserva M-1: dos gerentes que se desactivan a la vez dejan siempre exactamente uno', async () => {
  await withRetryDelays([1, 2, 4, 8, 16], async () => {
    for (let round = 0; round < 20; round++) {
      const db = lockedDatabase([row(1, true, G), row(2, true, G), row(3, true, S)], { nowait: true });
      const results = await Promise.allSettled([db.service.status(2, false, 1), db.service.status(1, false, 2)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'ronda ' + round);
      // La perdedora choca con el bloqueo, reintenta, relee las filas ya confirmadas y la rechaza M-1 (no el conflicto de bloqueo).
      assert.ok(conflict(LAST_GERENTE_MESSAGE)((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason));
      assert.equal(db.rows.filter(item => item.activo && item.rol === G).length, 1);
      assert.equal(db.audit.length, 1);
      assert.equal(db.transactions.opened, db.transactions.closed, 'ninguna transacción queda abierta');
      assert.ok(db.transactions.opened >= 3, 'hubo al menos un reintento');
    }
  });
});
