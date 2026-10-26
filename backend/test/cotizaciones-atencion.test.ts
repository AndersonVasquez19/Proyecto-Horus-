import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { CotizacionesController } from '../src/cotizaciones/cotizaciones.module';
import { CONCURRENCY_MESSAGE, CotizacionesService } from '../src/cotizaciones/cotizaciones.service';
import { CotizacionDto } from '../src/cotizaciones/cotizacion.dto';
import { duplicateRequestHash, parseIdempotencyKey } from '../src/cotizaciones/idempotency';
import { limaToday } from '../src/cotizaciones/quote-rules';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { can } from '../src/permissions/policy';

// Etapa 2: Atención ↔ Cotizaciones y duplicación, con una base simulada en memoria (sin MySQL, sin correo, sin red).
// La simulación respeta lo que importa: la transacción se revierte entera si algo lanza, updateMany es compare-and-swap sobre `revision`
// y el índice UNIQUE de idempotencia_clave.
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const statusCode = (error: any) => error.getStatus();
function fakeDb(contactos: Array<{ id: number; estado: string }> = [], records: any[] = []) {
  const state = { rows: [] as any[], contactos: structuredClone(contactos), records: structuredClone(records), nextId: 1, nextRecord: 100 };
  const failOn = { attentionCreate: false, contactoUpdate: false, contactoThrow: undefined as unknown };
  const calls: string[] = [];
  const cotizacion = {
    findUnique: async ({ where }: any) => { await tick(); const row = state.rows.find(r => where.id !== undefined ? r.id === where.id : r.idempotencia_clave === where.idempotencia_clave); return row ? structuredClone(row) : null; },
    create: async ({ data }: any) => {
      await tick();
      if (data.idempotencia_clave && state.rows.some(r => r.idempotencia_clave === data.idempotencia_clave)) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
      const row = { id: state.nextId++, createdAt: new Date(), updatedAt: new Date(), idempotencia_clave: null, idempotencia_huella: null, ...structuredClone(data) };
      state.rows.push(row); return structuredClone(row);
    },
    update: async ({ where, data }: any) => { const row = state.rows.find(r => r.id === where.id); Object.assign(row, structuredClone(data)); return structuredClone(row); },
  };
  const contacto = {
    findUnique: async ({ where }: any) => { const row = state.contactos.find(c => c.id === where.id); return row ? { ...row } : null; },
    findUniqueOrThrow: async ({ where }: any) => { const row = state.contactos.find(c => c.id === where.id); if (!row) throw new Error('no existe'); return { ...row }; },
    update: async ({ where, data }: any) => { calls.push('contacto.update'); if (failOn.contactoThrow) throw failOn.contactoThrow; if (failOn.contactoUpdate) throw new Error('fallo simulado'); Object.assign(state.contactos.find(c => c.id === where.id)!, data); return {}; },
  };
  const attentionRecord = {
    findUnique: async ({ where }: any) => { const key = where.recurso_registro_id; const row = state.records.find(r => r.recurso === key.recurso && r.registro_id === key.registro_id); return row ? structuredClone(row) : null; },
    create: async ({ data }: any) => { calls.push('attention.create'); if (failOn.attentionCreate) throw new Error('fallo simulado'); state.records.push({ id: state.nextRecord++, ...structuredClone(data) }); return {}; },
    updateMany: async ({ where, data }: any) => {
      calls.push('attention.updateMany');
      const row = state.records.find(r => r.id === where.id && r.revision === where.revision); if (!row) return { count: 0 };
      const { revision, ...rest } = data; Object.assign(row, structuredClone(rest)); row.revision = revision; return { count: 1 };
    },
  };
  const tx = { cotizacion, contacto, attentionRecord, $queryRaw: async () => { calls.push('lock'); return state.contactos.length ? [{ id: 1 }] : []; } };
  const prisma = {
    cotizacion, contacto,
    $transaction: async (fn: (t: unknown) => unknown) => {
      const snapshot = structuredClone({ rows: state.rows, contactos: state.contactos, records: state.records, nextId: state.nextId });
      try { return await fn({ ...tx, $queryRaw: async () => { calls.push('lock'); return [{ id: 1 }]; } }); }
      catch (error) { Object.assign(state, structuredClone(snapshot)); throw error; }
    },
  };
  return { prisma: prisma as unknown as PrismaService, state, failOn, calls };
}
const dto = (overrides: Partial<CotizacionDto> = {}): CotizacionDto => ({ cliente: 'Cliente Ficticio', email: 'cliente@example.test', telefono: '999', documento: '', direccion: '', emisor: 'Horus', datos_emisor: '',
  moneda: 'PEN', validez: '2099-12-31', condiciones: 'Pago a 30 días', conceptos: [{ descripcion: 'Servicio', cantidad: 2, precio: 50 }], descuento: 10, tasa: 18, ...overrides });
const record = (overrides: any = {}) => ({ id: 7, recurso: 'messages', registro_id: 1, contacto_id: 1, estado: 'nuevo', responsable: 'Ana', notas: 'n', respuesta: '', revision: 3, historial: [{ accion: 'previo' }], ...overrides });

// ---------- A. Atención ----------
test('A: crear con una consulta «nuevo» la pasa a «en_proceso» en la misma transacción, con seguimiento e historial', async () => {
  const db = fakeDb([{ id: 1, estado: 'nuevo' }]); const service = new CotizacionesService(db.prisma);
  const result: any = await service.create(dto({ contacto_id: 1 }), 5);
  assert.deepEqual(result.consulta, { id: 1, estado: 'en_proceso', actualizada: true });
  assert.equal(db.state.contactos[0].estado, 'en_proceso');
  const [seguimiento] = db.state.records;
  assert.equal(seguimiento.estado, 'en_proceso'); assert.equal(seguimiento.revision, 2); assert.equal(seguimiento.contacto_id, 1);
  assert.equal(seguimiento.historial[0].estado_anterior, 'nuevo'); assert.equal(seguimiento.historial[0].estado_nuevo, 'en_proceso'); assert.equal(seguimiento.historial[0].usuario, 5);
  assert.ok(seguimiento.historial[0].accion.includes(result.item.numero));
  assert.ok(db.calls.indexOf('lock') >= 0 && db.calls.indexOf('lock') < db.calls.indexOf('contacto.update'), 'la fila de origen se bloquea antes de leer/escribir');
});
test('A: con seguimiento existente en «nuevo» conserva responsable y notas, sube la revisión y añade al historial', async () => {
  const db = fakeDb([{ id: 1, estado: 'nuevo' }], [record()]); const service = new CotizacionesService(db.prisma);
  await service.create(dto({ contacto_id: 1 }), 5);
  const [seguimiento] = db.state.records;
  assert.equal(db.state.records.length, 1); assert.equal(seguimiento.estado, 'en_proceso'); assert.equal(seguimiento.revision, 4);
  assert.equal(seguimiento.responsable, 'Ana'); assert.equal(seguimiento.notas, 'n');
  assert.equal(seguimiento.historial.length, 2); assert.equal(seguimiento.historial[0].accion, 'previo');
});
test('A: el estado efectivo es el del seguimiento (no el de la consulta): en_proceso, atendido o archivado no cambian', async () => {
  for (const estado of ['en_proceso', 'atendido', 'archivado']) {
    const db = fakeDb([{ id: 1, estado: 'nuevo' }], [record({ estado })]); const service = new CotizacionesService(db.prisma);
    const result: any = await service.create(dto({ contacto_id: 1 }), 5);
    assert.deepEqual(result.consulta, { id: 1, estado, actualizada: false });
    assert.equal(db.state.records[0].revision, 3, estado + ': sin escritura en el seguimiento'); assert.equal(db.state.contactos[0].estado, 'nuevo');
  }
  const sinSeguimiento = fakeDb([{ id: 1, estado: 'atendido' }]); const result: any = await new CotizacionesService(sinSeguimiento.prisma).create(dto({ contacto_id: 1 }), 5);
  assert.equal(result.consulta.actualizada, false); assert.equal(sinSeguimiento.state.records.length, 0);
});
test('A: sin consulta de origen no se toca Atención ni se devuelve `consulta`', async () => {
  const db = fakeDb([{ id: 1, estado: 'nuevo' }]); const result: any = await new CotizacionesService(db.prisma).create(dto(), 5);
  assert.equal('consulta' in result, false); assert.deepEqual(db.calls, []); assert.equal(db.state.contactos[0].estado, 'nuevo');
});
test('A: atomicidad: si falla el cambio de estado no queda cotización ni seguimiento (y viceversa)', async () => {
  for (const failing of ['attentionCreate', 'contactoUpdate'] as const) {
    const db = fakeDb([{ id: 1, estado: 'nuevo' }]); db.failOn[failing] = true; const service = new CotizacionesService(db.prisma);
    await assert.rejects(() => service.create(dto({ contacto_id: 1 }), 5), /fallo simulado/);
    assert.equal(db.state.rows.length, 0, failing + ': ninguna cotización'); assert.equal(db.state.records.length, 0, failing + ': ningún seguimiento'); assert.equal(db.state.contactos[0].estado, 'nuevo');
    db.failOn[failing] = false;
    const retry: any = await service.create(dto({ contacto_id: 1 }), 5);
    assert.equal(retry.item.estado, 'borrador'); assert.equal(db.state.contactos[0].estado, 'en_proceso');
  }
});
test('A: conflicto de revisión en el seguimiento → 409 y nada queda a medias', async () => {
  const db = fakeDb([{ id: 1, estado: 'nuevo' }], [record()]);
  const original = db.prisma as any; const wrapped = { ...original, $transaction: async (fn: any) => original.$transaction(async (tx: any) => fn({ ...tx, attentionRecord: { ...tx.attentionRecord, updateMany: async () => ({ count: 0 }) } })) };
  await assert.rejects(() => new CotizacionesService(wrapped).create(dto({ contacto_id: 1 }), 5), (error: any) => statusCode(error) === 409);
  assert.equal(db.state.rows.length, 0); assert.equal(db.state.records[0].estado, 'nuevo'); assert.equal(db.state.records[0].revision, 3);
});
test('A: idempotencia: repetir la misma clave no crea otra cotización ni vuelve a cambiar la consulta; la carrera perdedora revierte todo', async () => {
  const db = fakeDb([{ id: 1, estado: 'nuevo' }]); const service = new CotizacionesService(db.prisma); const key = 'clave-de-idempotencia-0001';
  const first: any = await service.create(dto({ contacto_id: 1 }), 5, key);
  const second: any = await service.create(dto({ contacto_id: 1 }), 5, key);
  assert.equal(second.reutilizada, true); assert.equal(second.item.id, first.item.id); assert.equal(db.state.rows.length, 1); assert.equal(db.state.records[0].historial.length, 1);
  // Carrera: otra solicitud con la misma clave inserta entre la lectura y la inserción → UNIQUE; la transacción perdedora no deja cambios.
  const race = fakeDb([{ id: 1, estado: 'nuevo' }]); const raceService = new CotizacionesService(race.prisma);
  const win = race.prisma.cotizacion.findUnique;
  let lookups = 0; (race.prisma.cotizacion as any).findUnique = async (args: any) => (args.where.idempotencia_clave && lookups++ === 0 ? null : win(args));
  await race.prisma.cotizacion.create({ data: { ...dto({ contacto_id: 1 }), numero: 'COT-X', estado: 'borrador', revision: 1, historial: [], idempotencia_clave: key, idempotencia_huella: 'otra' } } as any);
  await assert.rejects(() => raceService.create(dto({ contacto_id: 1 }), 5, key), (error: any) => statusCode(error) === 422);
  assert.equal(race.state.rows.length, 1); assert.equal(race.state.contactos[0].estado, 'nuevo'); assert.equal(race.state.records.length, 0);
});

// ---------- B. Duplicar ----------
const key = (n: number) => 'duplicar-clave-prueba-' + String(n).padStart(4, '0');
async function withOriginal(overrides: Partial<CotizacionDto> = {}, patch: any = {}, contactos: any[] = []) {
  const db = fakeDb(contactos); const service = new CotizacionesService(db.prisma);
  const original: any = await service.create(dto(overrides), 5);
  Object.assign(db.state.rows[0], { estado: 'aceptada', revision: 9, historial: [...db.state.rows[0].historial, { accion: 'Estado: aceptada' }, { correo: { tipo: 'cotizacion', intento: 'x', estado: 'aceptado' } }], ...patch });
  return { db, service, original };
}
test('B: la copia es nueva, en borrador, con su propio id/número, revisión 1 e historial propio sin heredar estados ni correos', async () => {
  const { db, service, original } = await withOriginal();
  const before = structuredClone(db.state.rows[0]);
  const copy: any = await service.duplicate(original.item.id, 8);
  assert.equal(copy.ok, true); assert.notEqual(copy.item.id, original.item.id); assert.notEqual(copy.item.numero, original.item.numero);
  assert.match(copy.item.numero, /^COT-\d{4}-000002$/);
  assert.equal(copy.item.estado, 'borrador'); assert.equal(copy.item.revision, 1); assert.equal(copy.item.vencida, false);
  assert.equal(copy.item.historial.length, 1); assert.equal(copy.item.historial[0].usuario, 8); assert.deepEqual(copy.item.historial[0].duplicada_de, { id: original.item.id, numero: original.item.numero });
  assert.equal(JSON.stringify(copy.item.historial).includes('aceptado'), false);
  for (const field of ['cliente', 'email', 'telefono', 'documento', 'direccion', 'emisor', 'datos_emisor', 'moneda', 'validez', 'condiciones'] as const) assert.equal(copy.item[field], original.item[field], field);
  assert.deepEqual(copy.item.conceptos, original.item.conceptos);
  for (const field of ['subtotal', 'descuento', 'tasa', 'impuesto', 'total'] as const) assert.equal(copy.item[field], original.item[field], field);
  assert.equal('idempotencia_clave' in copy.item, false);
  assert.deepEqual(db.state.rows[0], before, 'la original queda exactamente igual (estado, revisión, historial)');
});
test('B: se puede duplicar en cualquier estado (borrador, enviada, aceptada, rechazada, anulada); inexistente → 404', async () => {
  for (const estado of ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada']) {
    const { db, service, original } = await withOriginal({}, { estado }); const copy: any = await service.duplicate(original.item.id, 1);
    assert.equal(copy.item.estado, 'borrador'); assert.equal(db.state.rows[0].estado, estado); assert.equal(db.state.rows.length, 2);
  }
  await assert.rejects(() => new CotizacionesService(fakeDb().prisma).duplicate(999, 1), (error: any) => statusCode(error) === 404);
});
test('B: la vigencia se conserva SIEMPRE (sin inventar plazo): vigente → sin aviso; vencida → misma fecha pasada y requiere_nueva_vigencia', async () => {
  const vigente = await withOriginal();
  const ok: any = await vigente.service.duplicate(vigente.original.item.id, 1);
  assert.equal(ok.item.validez, '2099-12-31'); assert.equal(ok.requiere_nueva_vigencia, false); assert.equal(ok.item.historial[0].vigencia_pendiente, undefined);
  const { db, service, original } = await withOriginal({}, { validez: new Date('2020-01-01T00:00:00Z') });
  const copy: any = await service.duplicate(original.item.id, 1);
  assert.equal(copy.item.validez, '2020-01-01'); assert.notEqual(copy.item.validez, limaToday());
  assert.equal(copy.requiere_nueva_vigencia, true); assert.equal(copy.item.estado, 'borrador'); assert.equal(copy.item.vencida, false, 'un borrador no se llama vencido');
  assert.equal(copy.item.historial[0].vigencia_pendiente, true);
  assert.equal(db.state.rows[0].validez.toISOString().slice(0, 10), '2020-01-01', 'la original no se toca');
  // La copia no puede enviarse ni pasar a «enviada» hasta fijar una vigencia nueva; editar con la fecha pasada se rechaza (la vigencia nueva es obligatoria; el guardado exitoso lo cubre cotizaciones-flujo).
  await assert.rejects(() => service.status(copy.item.id, { estado: 'enviada', revision: copy.item.revision } as any, 1), (error: any) => statusCode(error) === 409);
  await assert.rejects(() => service.email(copy.item.id, copy.item.revision, 1), (error: any) => statusCode(error) === 409);
  await assert.rejects(() => service.edit(copy.item.id, { ...dto(), validez: '2020-01-01', revision: copy.item.revision } as any, 1), (error: any) => statusCode(error) === 400);
  // La réplica idempotente de una copia con vigencia pasada conserva el aviso.
  const again1: any = await service.duplicate(original.item.id, 1, key(7)); const again2: any = await service.duplicate(original.item.id, 1, key(7));
  assert.equal(again1.requiere_nueva_vigencia, true); assert.equal(again2.reutilizada, true); assert.equal(again2.requiere_nueva_vigencia, true);
});
test('B: conserva la consulta de origen y aplica la misma regla de Atención (solo si estaba «nuevo»)', async () => {
  const { db, service, original } = await withOriginal({ contacto_id: 1 }, {}, [{ id: 1, estado: 'nuevo' }]);
  assert.equal(db.state.contactos[0].estado, 'en_proceso');
  const copy: any = await service.duplicate(original.item.id, 1);
  assert.equal(copy.item.contacto_id, 1); assert.deepEqual(copy.consulta, { id: 1, estado: 'en_proceso', actualizada: false });
  assert.equal(db.state.records[0].historial.length, 1, 'no se duplica el cambio de estado');
});
test('B: conceptos ilegibles → 409 sin crear nada; importes corruptos no pasan', async () => {
  const { db, service, original } = await withOriginal({}, { conceptos: 'no es una lista' });
  await assert.rejects(() => service.duplicate(original.item.id, 1), (error: any) => statusCode(error) === 409); assert.equal(db.state.rows.length, 1);
});
test('B: idempotencia: la misma clave devuelve la misma copia; otra original o usuario con esa clave → 422; una creación y un duplicado no comparten clave', async () => {
  const { db, service, original } = await withOriginal();
  const a: any = await service.duplicate(original.item.id, 8, key(1)); const b: any = await service.duplicate(original.item.id, 8, key(1));
  assert.equal(b.reutilizada, true); assert.equal(b.item.id, a.item.id); assert.equal(db.state.rows.length, 2);
  await assert.rejects(() => service.duplicate(original.item.id, 9, key(1)), (error: any) => statusCode(error) === 422);
  await assert.rejects(() => service.duplicate(a.item.id, 8, key(1)), (error: any) => statusCode(error) === 422);
  await assert.rejects(() => service.create(dto(), 8, key(1)), (error: any) => statusCode(error) === 422);
  assert.equal(db.state.rows.length, 2);
  const sinClave: any = await service.duplicate(original.item.id, 8); const otra: any = await service.duplicate(original.item.id, 8);
  assert.notEqual(sinClave.item.id, otra.item.id, 'sin clave cada solicitud crea una copia (comportamiento de crear)');
  assert.notEqual(duplicateRequestHash(1, 1), duplicateRequestHash(2, 1)); assert.notEqual(duplicateRequestHash(1, 1), duplicateRequestHash(1, 2));
  assert.throws(() => parseIdempotencyKey('corta'), (error: any) => statusCode(error) === 400);
});
test('B: atomicidad: si falla el cambio de estado de la consulta no queda la copia', async () => {
  const { db, service, original } = await withOriginal({ contacto_id: 1 }, {}, [{ id: 1, estado: 'nuevo' }]);
  db.state.contactos[0].estado = 'nuevo'; db.state.records.length = 0; db.failOn.contactoUpdate = true;
  await assert.rejects(() => service.duplicate(original.item.id, 1), /fallo simulado/);
  assert.equal(db.state.rows.length, 1);
});

// ---------- Permisos ----------
// ---------- C. Conflictos de concurrencia → 409 ----------
const p2034 = () => new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock. Please retry your transaction', { code: 'P2034', clientVersion: 'test' });
const mysqlCode = (code: string, prismaCode = 'P2010') => new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `' + code + '`. Message: `interno secreto`', { code: prismaCode, clientVersion: 'test', meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: code } } } });
async function conflictoSinHuella(error: unknown) {
  const db = fakeDb([{ id: 1, estado: 'nuevo' }]); const service = new CotizacionesService(db.prisma); db.failOn.contactoThrow = error;
  const key = 'conflicto-clave-prueba-0001';
  let capturado: any; try { await service.create(dto({ contacto_id: 1 }), 5, key); } catch (e) { capturado = e; }
  assert.ok(capturado, 'debía fallar');
  assert.equal(statusCode(capturado), 409); assert.equal(capturado.message, CONCURRENCY_MESSAGE); assert.doesNotMatch(JSON.stringify(capturado.getResponse()), /P2034|P2010|Prisma|interno|1213|deadlock|MySQL/i);
  // Rollback completo: ni cotización, ni seguimiento, ni cambio de estado, ni clave consumida.
  assert.equal(db.state.rows.length, 0); assert.equal(db.state.records.length, 0); assert.equal(db.state.contactos[0].estado, 'nuevo');
  db.failOn.contactoThrow = undefined;
  return { db, service, key };
}
test('C: P2034 de Prisma → 409 seguro, con rollback completo', async () => { await conflictoSinHuella(p2034()); });
test('C: MySQL 1213 identificado por código estructurado (P2010 + driverAdapterError) → 409 seguro', async () => { await conflictoSinHuella(mysqlCode('1213')); });
test('C: MySQL 1213 como DriverAdapterError sin convertir → 409', async () => { await conflictoSinHuella({ name: 'DriverAdapterError', cause: { originalCode: '1213' } }); });
test('C: errores desconocidos NO se convierten en 409 (ni por texto parecido, ni otros códigos)', async () => {
  for (const error of [new Error('fallo simulado'), new Error('Deadlock found when trying to get lock 1213 P2034'), mysqlCode('1205'), mysqlCode('1062'), new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'test' }), { name: 'DriverAdapterError', cause: { originalCode: 1213 } }]) {
    const db = fakeDb([{ id: 1, estado: 'nuevo' }]); const service = new CotizacionesService(db.prisma); db.failOn.contactoThrow = error;
    await assert.rejects(() => service.create(dto({ contacto_id: 1 }), 5), (e: any) => !(typeof e?.getStatus === 'function' && e.getStatus() === 409) && e === error);
    assert.equal(db.state.rows.length, 0); assert.equal(db.state.records.length, 0); assert.equal(db.state.contactos[0].estado, 'nuevo');
  }
});
test('C: tras un 409 la misma Idempotency-Key sigue funcionando: sin duplicar cotizaciones, seguimientos ni cambios de estado', async () => {
  const { db, service, key } = await conflictoSinHuella(p2034());
  const a: any = await service.create(dto({ contacto_id: 1 }), 5, key); const b: any = await service.create(dto({ contacto_id: 1 }), 5, key);
  assert.equal(a.consulta.actualizada, true); assert.equal(b.reutilizada, true); assert.equal(b.item.id, a.item.id);
  assert.equal(db.state.rows.length, 1); assert.equal(db.state.records.length, 1); assert.equal(db.state.records[0].historial.length, 1); assert.equal(db.state.contactos.length, 1); assert.equal(db.state.contactos[0].estado, 'en_proceso');
});
test('C: duplicar también traduce el conflicto a 409 y se puede repetir con la misma clave sin duplicar', async () => {
  const { db, service, original } = await withOriginal({ contacto_id: 1 }, {}, [{ id: 1, estado: 'nuevo' }]);
  const antes = db.state.rows.length; db.state.contactos[0].estado = 'nuevo'; db.state.records.length = 0; db.failOn.contactoThrow = mysqlCode('1213');
  await assert.rejects(() => service.duplicate(original.item.id, 5, key(30)), (e: any) => statusCode(e) === 409);
  assert.equal(db.state.rows.length, antes); db.failOn.contactoThrow = undefined;
  const a: any = await service.duplicate(original.item.id, 5, key(30)); const b: any = await service.duplicate(original.item.id, 5, key(30));
  assert.equal(db.state.rows.length, antes + 1); assert.equal(b.reutilizada, true); assert.equal(b.item.id, a.item.id); assert.equal(db.state.records.length, 1);
});
test('permisos: POST :id/duplicar exige cotizaciones:crear (como crear), está en el inventario y el controlador lo declara', () => {
  const handler = (CotizacionesController.prototype as any).duplicate;
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, handler), { kind: 'permiso', permission: 'cotizaciones:crear' });
  assert.equal(can('GERENTE_GENERAL', 'cotizaciones:crear'), true); assert.equal(can('COORDINADORA_INSTITUCIONAL', 'cotizaciones:crear'), true);
  assert.equal(can('SECRETARIA', 'cotizaciones:crear'), false);
  const inventory = fs.readFileSync(path.join(__dirname, '..', 'src', 'permissions', 'route-inventory.ts'), 'utf8');
  assert.match(inventory, /perm\('POST', 'admin\/cotizaciones\/:id\/duplicar', 'cotizaciones:crear'/);
});
test('regresión: las demás rutas de cotizaciones conservan su permiso', () => {
  const proto = CotizacionesController.prototype as any;
  const expected: Record<string, string> = { list: 'leer', detail: 'leer', pdf: 'leer', create: 'crear', duplicate: 'crear', edit: 'editar', email: 'enviar' };
  for (const [method, operation] of Object.entries(expected)) assert.equal(Reflect.getMetadata(ACCESS_METADATA, proto[method]).permission, 'cotizaciones:' + operation, method);
});
