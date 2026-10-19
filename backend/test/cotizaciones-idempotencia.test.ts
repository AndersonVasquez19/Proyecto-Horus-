import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import type { PrismaService } from '../src/database/prisma.service';
import { CotizacionesService } from '../src/cotizaciones/cotizaciones.service';
import { parseIdempotencyKey, quoteRequestHash } from '../src/cotizaciones/idempotency';
import type { CotizacionDto } from '../src/cotizaciones/cotizacion.dto';

// Base simulada en memoria con la misma restricción UNIQUE que la migración 20261011-cotizaciones-idempotencia. Sin MySQL, sin correo, sin red.
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fakePrisma() {
  const rows: Record<string, any>[] = []; let nextId = 1;
  const cotizacion = {
    findUnique: async ({ where }: any) => { await tick(); const row = rows.find(r => where.idempotencia_clave !== undefined ? r.idempotencia_clave === where.idempotencia_clave : r.id === where.id); return row ? structuredClone(row) : null; },
    // Comprobar y insertar es atómico (como el índice UNIQUE de MySQL): el segundo INSERT con la misma clave recibe P2002.
    create: async ({ data }: any) => {
      await tick();
      if (data.idempotencia_clave && rows.some(r => r.idempotencia_clave === data.idempotencia_clave)) throw new PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
      const row = { idempotencia_clave: null, idempotencia_huella: null, id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...structuredClone(data) };
      rows.push(row); return structuredClone(row);
    },
  };
  return { prisma: { cotizacion, contacto: { findUnique: async () => ({ id: 1 }) } } as unknown as PrismaService, rows };
}
const dto = (overrides: Partial<CotizacionDto> = {}): CotizacionDto => ({ cliente: 'Cliente Ficticio', email: 'cliente@example.test', telefono: '', documento: '', direccion: '', emisor: 'Horus', datos_emisor: '',
  moneda: 'PEN', validez: '2099-12-31', condiciones: '', conceptos: [{ descripcion: 'Servicio', cantidad: 2, precio: 50 }], descuento: 0, tasa: 18, ...overrides });
const KEY_A = 'a'.repeat(8) + '-0000-4000-8000-' + 'b'.repeat(12), KEY_B = 'c'.repeat(8) + '-0000-4000-8000-' + 'd'.repeat(12);

test('idempotencia: repetir la misma operación devuelve la misma cotización sin crear otra', async () => {
  const { prisma, rows } = fakePrisma(); const service = new CotizacionesService(prisma);
  const first: any = await service.create(dto(), 7, KEY_A);
  const again: any = await service.create(dto(), 7, KEY_A);
  assert.equal(rows.length, 1, 'una sola fila');
  assert.equal(first.reutilizada, undefined); assert.equal(again.reutilizada, true);
  assert.equal(again.item.id, first.item.id); assert.equal(again.item.numero, first.item.numero);
  assert.equal(again.item.total, 118, 'la respuesta repetida conserva los importes calculados');
  for (const result of [first, again]) assert.ok(!('idempotencia_clave' in result.item) && !('idempotencia_huella' in result.item), 'la clave y la huella no salen en la API');
});

test('idempotencia: solicitudes simultáneas con la misma clave crean una sola cotización', async () => {
  const { prisma, rows } = fakePrisma(); const service = new CotizacionesService(prisma);
  const results: any[] = await Promise.all(Array.from({ length: 6 }, () => service.create(dto(), 7, KEY_A)));
  assert.equal(rows.length, 1);
  assert.equal(new Set(results.map(r => r.item.numero)).size, 1, 'todas reciben la misma cotización');
  assert.equal(results.filter(r => r.reutilizada === true).length, 5, 'una crea y las demás reutilizan');
});

test('idempotencia: la misma clave con otro contenido o de otro administrador responde 422 y no escribe', async () => {
  const { prisma, rows } = fakePrisma(); const service = new CotizacionesService(prisma);
  await service.create(dto(), 7, KEY_A);
  for (const attempt of [() => service.create(dto({ cliente: 'Otro cliente' }), 7, KEY_A), () => service.create(dto({ descuento: 10 }), 7, KEY_A),
    () => service.create(dto({ conceptos: [{ descripcion: 'Servicio', cantidad: 3, precio: 50 }] }), 7, KEY_A), () => service.create(dto(), 8, KEY_A)]) {
    await assert.rejects(attempt, (error: any) => { assert.equal(error.getStatus(), 422); assert.ok(!JSON.stringify(error.getResponse()).includes('Cliente Ficticio')); return true; });
  }
  assert.equal(rows.length, 1);
  // También en una carrera: el perdedor con contenido distinto recibe 422, no la cotización del ganador.
  const raced = fakePrisma(); const racer = new CotizacionesService(raced.prisma);
  const settled = await Promise.allSettled([racer.create(dto(), 7, KEY_B), racer.create(dto({ cliente: 'Distinto' }), 7, KEY_B)]);
  assert.equal(settled.filter(r => r.status === 'fulfilled').length, 1); assert.equal(settled.filter(r => r.status === 'rejected').length, 1); assert.equal(raced.rows.length, 1);
});

test('idempotencia: operaciones distintas y legítimas no se bloquean entre sí', async () => {
  const { prisma, rows } = fakePrisma(); const service = new CotizacionesService(prisma);
  await Promise.all([service.create(dto(), 7, KEY_A), service.create(dto(), 7, KEY_B), service.create(dto({ cliente: 'Otro' }), 7, 'e'.repeat(20))]);
  assert.equal(rows.length, 3, 'claves distintas = operaciones distintas, aunque el contenido coincida');
  assert.equal(new Set(rows.map(r => r.numero)).size, 3);
});

test('compatibilidad: sin clave cada solicitud crea su cotización como antes y no guarda clave', async () => {
  const { prisma, rows } = fakePrisma(); const service = new CotizacionesService(prisma);
  const a: any = await service.create(dto(), 7), b: any = await service.create(dto(), 7);
  assert.equal(rows.length, 2); assert.notEqual(a.item.numero, b.item.numero);
  assert.ok(rows.every(row => row.idempotencia_clave === null && row.idempotencia_huella === null));
});

test('idempotencia: formato de la clave y huella estable', () => {
  assert.equal(parseIdempotencyKey(undefined), undefined);
  assert.equal(parseIdempotencyKey(KEY_A), KEY_A);
  for (const bad of ['', 'corta', 'x'.repeat(129), 'con espacios 1234567890', 'ñ'.repeat(20), 'a;b'.repeat(8), ['a'.repeat(20)]]) assert.throws(() => parseIdempotencyKey(bad), (error: any) => error.getStatus() === 400, String(bad));
  assert.equal(quoteRequestHash(dto(), 7), quoteRequestHash(dto(), 7));
  assert.notEqual(quoteRequestHash(dto(), 7), quoteRequestHash(dto(), 8));
  assert.notEqual(quoteRequestHash(dto(), 7), quoteRequestHash(dto({ contacto_id: 3 }), 7));
  assert.notEqual(quoteRequestHash(dto({ conceptos: [{ descripcion: 'A', cantidad: 1, precio: 1 }, { descripcion: 'B', cantidad: 1, precio: 1 }] }), 7),
    quoteRequestHash(dto({ conceptos: [{ descripcion: 'B', cantidad: 1, precio: 1 }, { descripcion: 'A', cantidad: 1, precio: 1 }] }), 7), 'el orden de los conceptos importa');
});

test('CORS: el encabezado Idempotency-Key está permitido y no se abre ningún otro encabezado ni origen comodín', async () => {
  const { configureCors } = await import('../src/common/security');
  let options: any; configureCors({ enableCors: (value: unknown) => { options = value; } } as any, { NODE_ENV: 'production', CORS_ORIGINS: 'https://web.example.com' });
  assert.deepEqual(options.allowedHeaders, ['Content-Type', 'Authorization', 'Idempotency-Key']);
  assert.deepEqual(options.origin, ['https://web.example.com']);
});

test('regresión: repetir la clave tras editar la cotización devuelve la cotización actual completa, sin mezclar importes del contenido original', async () => {
  const { prisma, rows } = fakePrisma(); const service = new CotizacionesService(prisma);
  const first: any = await service.create(dto(), 7, KEY_A);
  assert.equal(first.item.total, 118);
  // Edición posterior (otro administrador): cambia cliente e importes y sube la revisión.
  Object.assign(rows[0], { cliente: 'Cliente Editado', subtotal: '500.00', impuesto: '90.00', total: '590.00', revision: 2 });
  const again: any = await service.create(dto(), 7, KEY_A); // mismo contenido original y misma clave
  assert.equal(rows.length, 1); assert.equal(again.reutilizada, true);
  assert.equal(again.item.cliente, 'Cliente Editado'); assert.equal(again.item.revision, 2);
  assert.equal(again.item.total, 590, 'importes de la fila actual, no los recalculados con el contenido original (118)');
  assert.equal(again.item.subtotal, 500); assert.equal(again.item.impuesto, 90);
  assert.ok(!('idempotencia_clave' in again.item));
});
