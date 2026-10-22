import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PrismaService } from '../src/database/prisma.service';
import type { MailService } from '../src/mail/mail.service';
import { createValidationPipe } from '../src/common/validation';
import { CotizacionesController } from '../src/cotizaciones/cotizaciones.module';
import { CotizacionesService } from '../src/cotizaciones/cotizaciones.service';
import { CotizacionDto, CotizacionQueryDto, EstadoCotizacionDto } from '../src/cotizaciones/cotizacion.dto';
import { isExpired, limaToday, mailSummary, quoteNumber, transitions } from '../src/cotizaciones/quote-rules';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { requirementFor } from '../src/permissions/access';
import { can } from '../src/permissions/policy';

// Flujo comercial de Cotizaciones con una base simulada en memoria: sin MySQL, sin correo real, sin red.
// La simulación respeta lo que importa del motor real: updateMany con `where.revision` es atómico (compare-and-swap) y el índice UNIQUE de `numero`.
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const PAST = new Date('2020-01-01T00:00:00Z');
function fakeDb() {
  const rows: any[] = []; let nextId = 1; const calls: { findMany: any[] } = { findMany: [] };
  const cotizacion = {
    findUnique: async ({ where }: any) => { await tick(); const row = rows.find(r => r.id === where.id); return row ? structuredClone(row) : null; },
    findUniqueOrThrow: async ({ where }: any) => { const row = rows.find(r => r.id === where.id); if (!row) throw new Error('no existe'); return structuredClone(row); },
    findMany: async (args: any) => { calls.findMany.push(args); return structuredClone(rows); },
    count: async () => rows.length,
    create: async ({ data }: any) => {
      await tick();
      const row = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), idempotencia_clave: null, idempotencia_huella: null, ...structuredClone(data) };
      rows.push(row); return structuredClone(row);
    },
    update: async ({ where, data }: any) => { const row = rows.find(r => r.id === where.id); Object.assign(row, structuredClone(data)); return structuredClone(row); },
    updateMany: async ({ where, data }: any) => {
      await tick();
      const row = rows.find(r => r.id === where.id && r.revision === where.revision); if (!row) return { count: 0 };
      const { revision, ...rest } = data; Object.assign(row, structuredClone(rest)); row.revision += revision.increment; return { count: 1 };
    },
  };
  const prisma = { cotizacion, contacto: { findUnique: async ({ where }: any) => (where.id === 404 ? null : { id: where.id }) }, $transaction: async (fn: (tx: unknown) => unknown) => fn({ cotizacion }) };
  return { prisma: prisma as unknown as PrismaService, rows, calls };
}
const mailOf = (status: 'accepted' | 'failed' | 'uncertain' = 'accepted') => {
  const sent: any[] = [];
  return { sent, mail: { deliver: async (message: any) => { sent.push(message); return status === 'accepted' ? { status, providerId: 'prov-' + sent.length } : { status, reason: 'simulado' }; } } as unknown as MailService };
};
const dto = (overrides: Partial<CotizacionDto> = {}): CotizacionDto => ({ cliente: 'Cliente Ficticio', email: 'cliente@example.test', telefono: '', documento: '', direccion: '', emisor: 'Horus', datos_emisor: '',
  moneda: 'PEN', validez: '2099-12-31', condiciones: '', conceptos: [{ descripcion: 'Servicio', cantidad: 2, precio: 50 }], descuento: 0, tasa: 18, ...overrides });
const config = { get: () => 'interno@example.test' } as any;
const statusCode = (error: any) => error.getStatus();

test('número: es legible, único y se deriva del id (no un UUID)', async () => {
  const { prisma, rows } = fakeDb(); const service = new CotizacionesService(prisma);
  const a: any = await service.create(dto(), 1); const b: any = await service.create(dto(), 1);
  const year = limaToday().slice(0, 4);
  assert.equal(a.item.numero, `COT-${year}-000001`); assert.equal(b.item.numero, `COT-${year}-000002`);
  assert.equal(rows[0].numero, a.item.numero, 'el número definitivo también quedó guardado');
  assert.equal(quoteNumber(2026, 123), 'COT-2026-000123');
  assert.equal(a.item.estado, 'borrador'); assert.equal(a.item.vencida, false);
});

test('vigencia: no se crea ni se edita una propuesta con vigencia anterior a hoy', async () => {
  const { prisma, rows } = fakeDb(); const service = new CotizacionesService(prisma);
  await assert.rejects(() => service.create(dto({ validez: '2020-01-01' }), 1), (error: any) => statusCode(error) === 400);
  assert.equal(rows.length, 0, 'no se escribió nada');
  const created: any = await service.create(dto({ validez: limaToday() }), 1); // hoy es válido
  await assert.rejects(() => service.edit(created.item.id, { ...dto({ validez: '2020-01-01' }), revision: 1 }, 1), (error: any) => statusCode(error) === 400);
  assert.equal(rows[0].revision, 1, 'la edición rechazada no tocó la revisión');
  await assert.rejects(() => service.create(dto({ validez: '2099-02-31' }), 1), (error: any) => statusCode(error) === 400, 'fecha imposible');
  await assert.rejects(() => service.create(dto({ email: 'no-es-correo' }), 1), (error: any) => statusCode(error) === 400);
  await assert.rejects(() => service.create(dto({ contacto_id: 404 }), 1), (error: any) => statusCode(error) === 400, 'consulta de origen inexistente');
  await assert.rejects(() => service.create(dto({ descuento: 1000 }), 1), (error: any) => statusCode(error) === 400, 'descuento mayor al subtotal');
});

test('flujo completo: borrador → correo → enviada → aceptada, con historial trazable', async () => {
  const { prisma } = fakeDb(); const { mail, sent } = mailOf(); const service = new CotizacionesService(prisma, mail, config);
  const created: any = await service.create(dto(), 5);
  const id = created.item.id;
  // Enviar el correo NO cambia el estado: el proveedor aceptó el mensaje, no prueba que el cliente lo recibió.
  const mailed: any = await service.email(id, 1, 5);
  assert.equal(mailed.envio, 'aceptado'); assert.match(mailed.mensaje, /no confirma/i); assert.equal(sent.length, 1);
  const afterMail: any = await service.detail(id);
  assert.equal(afterMail.item.estado, 'borrador', 'enviar correo no marca la propuesta como enviada ni aceptada');
  assert.equal(afterMail.item.revision, 3, 'iniciado + resultado = dos revisiones');
  assert.deepEqual({ intentos: afterMail.item.correo.intentos, aceptados: afterMail.item.correo.aceptados, ultimo: afterMail.item.correo.ultimo.estado }, { intentos: 1, aceptados: 1, ultimo: 'aceptado' });
  // Estado: decisión administrativa, con revisión y nota.
  const sentState: any = await service.status(id, { estado: 'enviada', revision: 3 }, 5);
  assert.equal(sentState.item.estado, 'enviada');
  const accepted: any = await service.status(id, { estado: 'aceptada', revision: 4, nota: '  Aceptó por correo el 12/10  ' }, 6);
  assert.equal(accepted.item.estado, 'aceptada'); assert.equal(accepted.item.revision, 5);
  const last = accepted.item.historial[accepted.item.historial.length - 1];
  assert.deepEqual({ usuario: last.usuario, de: last.estado_anterior, a: last.estado_nuevo, nota: last.nota }, { usuario: 6, de: 'enviada', a: 'aceptada', nota: 'Aceptó por correo el 12/10' });
  assert.match(last.accion, /^Estado: aceptada — Aceptó por correo el 12\/10$/, 'la nota se ve en el historial que ya muestra el panel');
  // El estado final no se reabre ni se vuelve a enviar.
  await assert.rejects(() => service.status(id, { estado: 'anulada', revision: 5 }, 6), (error: any) => statusCode(error) === 409);
  await assert.rejects(() => service.email(id, 5, 6), (error: any) => statusCode(error) === 400);
  assert.equal(sent.length, 1, 'no hubo otro correo');
});

test('transiciones: solo las del negocio; los estados finales no admiten ninguna', async () => {
  assert.deepEqual(transitions, { borrador: ['enviada', 'anulada'], enviada: ['aceptada', 'rechazada', 'anulada'], aceptada: [], rechazada: [], anulada: [] });
  for (const [from, forbidden] of [['borrador', ['aceptada', 'rechazada']], ['enviada', []], ['aceptada', ['enviada', 'rechazada', 'anulada', 'aceptada']], ['rechazada', ['enviada', 'aceptada', 'anulada']], ['anulada', ['enviada', 'aceptada', 'rechazada']]] as const) {
    for (const to of forbidden) {
      const { prisma, rows } = fakeDb(); const service = new CotizacionesService(prisma);
      const created: any = await service.create(dto(), 1); rows[0].estado = from;
      await assert.rejects(() => service.status(created.item.id, { estado: to, revision: 1 }, 1), (error: any) => statusCode(error) === 409, `${from} → ${to}`);
      assert.equal(rows[0].estado, from); assert.equal(rows[0].revision, 1, 'el rechazo no escribe');
    }
  }
});

test('vigencia vencida: no se declara enviada ni aceptada, y se marca como vencida', async () => {
  const { prisma, rows } = fakeDb(); const service = new CotizacionesService(prisma);
  const created: any = await service.create(dto(), 1); rows[0].validez = PAST;
  await assert.rejects(() => service.status(created.item.id, { estado: 'enviada', revision: 1 }, 1), (error: any) => statusCode(error) === 409);
  rows[0].estado = 'enviada';
  await assert.rejects(() => service.status(created.item.id, { estado: 'aceptada', revision: 1 }, 1), (error: any) => statusCode(error) === 409);
  const detail: any = await service.detail(created.item.id);
  assert.equal(detail.item.vencida, true);
  // Se puede cerrar una propuesta vencida (rechazada/anulada): la vigencia solo impide avanzar.
  assert.equal((await service.status(created.item.id, { estado: 'rechazada', revision: 1 }, 1) as any).item.estado, 'rechazada');
  assert.equal(isExpired('enviada', '2020-01-01'), true); assert.equal(isExpired('borrador', '2020-01-01'), false, 'un borrador no es «vencida»');
  assert.equal(isExpired('aceptada', '2020-01-01'), false); assert.equal(isExpired('enviada', '2099-01-01'), false);
});

test('concurrencia: dos cambios de estado con la misma revisión → uno gana y el otro recibe 409', async () => {
  const { prisma, rows } = fakeDb(); const service = new CotizacionesService(prisma);
  const created: any = await service.create(dto(), 1);
  const settled = await Promise.allSettled([service.status(created.item.id, { estado: 'enviada', revision: 1 }, 1), service.status(created.item.id, { estado: 'anulada', revision: 1 }, 2), service.status(created.item.id, { estado: 'enviada', revision: 1 }, 3)]);
  assert.equal(settled.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(settled.filter(r => r.status === 'rejected').every(r => statusCode((r as PromiseRejectedResult).reason) === 409));
  assert.equal(rows[0].revision, 2); assert.equal(rows[0].historial.length, 2, 'un solo cambio quedó en el historial');
  // Edición contra estado: una edición con revisión vieja no pisa el cambio.
  await assert.rejects(() => service.edit(created.item.id, { ...dto({ cliente: 'Otro' }), revision: 1 }, 1), (error: any) => statusCode(error) === 409);
  assert.equal(rows[0].cliente, 'Cliente Ficticio');
});

test('concurrencia: dos envíos simultáneos del mismo correo envían una sola vez', async () => {
  const { prisma } = fakeDb(); const { mail, sent } = mailOf(); const service = new CotizacionesService(prisma, mail, config);
  const created: any = await service.create(dto(), 1);
  const settled = await Promise.allSettled([service.email(created.item.id, 1, 1), service.email(created.item.id, 1, 2)]);
  assert.equal(sent.length, 1, 'el proveedor recibió una sola solicitud');
  assert.equal(settled.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(settled.filter(r => r.status === 'rejected').length, 1);
});

test('solo se edita un borrador; las propuestas enviadas no cambian de contenido', async () => {
  const { prisma, rows } = fakeDb(); const service = new CotizacionesService(prisma);
  const created: any = await service.create(dto(), 1);
  const edited: any = await service.edit(created.item.id, { ...dto({ cliente: 'Cliente Corregido' }), revision: 1 }, 1);
  assert.equal(edited.item.cliente, 'Cliente Corregido'); assert.equal(edited.item.revision, 2);
  await service.status(created.item.id, { estado: 'enviada', revision: 2 }, 1);
  await assert.rejects(() => service.edit(created.item.id, { ...dto({ cliente: 'Cambio tardío' }), revision: 3 }, 1), (error: any) => statusCode(error) === 409);
  assert.equal(rows[0].cliente, 'Cliente Corregido');
  await assert.rejects(() => service.detail(999), (error: any) => statusCode(error) === 404);
});

test('listado: orden estable por id, filtros por consulta de origen y por vencidas', async () => {
  const { prisma, calls } = fakeDb(); const service = new CotizacionesService(prisma);
  await service.create(dto(), 1);
  await service.list(Object.assign(new CotizacionQueryDto(), { contacto_id: 7, search: 'abc', estado: 'enviada', vencida: 'si' }));
  const args = calls.findMany[0];
  assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }], 'createdAt tiene precisión de segundos: el id desempata');
  assert.equal(args.where.contacto_id, 7); assert.equal(args.where.estado, 'enviada');
  assert.deepEqual(args.where.AND[0], { estado: 'enviada' }); assert.ok(args.where.AND[1].validez.lt instanceof Date);
  assert.equal(args.where.AND[1].validez.lt.toISOString().slice(0, 10), limaToday());
  await service.list(new CotizacionQueryDto());
  assert.deepEqual(calls.findMany[1].where, {}, 'sin filtros, sin condiciones');
  assert.deepEqual(args.omit, { historial: true, conceptos: true, condiciones: true, datos_emisor: true, email: true, telefono: true, documento: true, direccion: true }, 'el listado no trae historial, detalles ni datos personales del cliente');
  assert.deepEqual(args.where.OR.map((clause: any) => Object.keys(clause)[0]), ['numero', 'cliente', 'email'], 'la búsqueda por correo sigue funcionando aunque el listado no lo devuelva');
  for (const field of ['id', 'numero', 'cliente', 'estado', 'moneda', 'total', 'contacto_id', 'createdAt', 'revision', 'validez']) assert.equal(field in args.omit, false, 'campo que el panel usa: ' + field);
  const detail: any = await service.detail(1);
  for (const field of ['email', 'telefono', 'documento', 'direccion', 'historial', 'conceptos']) assert.ok(field in detail.item, 'el detalle conserva ' + field);
});

test('resumen de correo: aceptado no es entregado; cuenta intentos por separado', () => {
  const entry = (intento: string, estado: string, fecha: string) => ({ accion: 'x', usuario: 1, fecha, correo: { intento, tipo: 'cotizacion', estado, huella: 'h' } });
  const summary = mailSummary([{ accion: 'Creada como borrador' }, entry('a', 'iniciado', '1'), entry('a', 'fallido', '2'), entry('b', 'iniciado', '3'), entry('b', 'aceptado', '4'), entry('c', 'iniciado', '5'),
    { accion: 'otro', correo: { tipo: 'respuesta', intento: 'z', estado: 'aceptado' } }, null, 'basura']);
  assert.deepEqual(summary, { intentos: 3, aceptados: 1, fallidos: 1, inciertos: 0, en_curso: 1, ultimo: { intento: 'c', estado: 'iniciado', fecha: '5' } });
  assert.deepEqual(mailSummary(undefined), { intentos: 0, aceptados: 0, fallidos: 0, inciertos: 0, en_curso: 0, ultimo: null });
  assert.deepEqual(mailSummary('no es un arreglo'), mailSummary([]));
});

test('validación de entrada: campos desconocidos, nota larga, filtros y estados inválidos', async () => {
  const pipe = createValidationPipe();
  const body = (metatype: any, value: unknown) => pipe.transform(value, { type: 'body', metatype });
  const query = (value: unknown) => pipe.transform(value, { type: 'query', metatype: CotizacionQueryDto });
  const ok = await body(EstadoCotizacionDto, { estado: 'rechazada', revision: 3, nota: '  Eligió otra oferta ' }) as EstadoCotizacionDto;
  assert.equal(ok.nota, 'Eligió otra oferta');
  for (const bad of [{ estado: 'borrador', revision: 1 }, { estado: 'aceptada' }, { estado: 'aceptada', revision: 0 }, { estado: 'aceptada', revision: 1, nota: 'x'.repeat(501) },
    { estado: 'aceptada', revision: 1, total: 0 }, { estado: 'aceptada', revision: 1, nota: 5 }]) await assert.rejects(() => body(EstadoCotizacionDto, bad), JSON.stringify(bad).slice(0, 60));
  // El cliente no puede fijar campos calculados ni internos al crear.
  for (const extra of [{ total: 1 }, { subtotal: 1 }, { estado: 'aceptada' }, { numero: 'COT-1' }, { revision: 9 }, { historial: [] }, { idempotencia_clave: 'x'.repeat(20) }]) await assert.rejects(() => body(CotizacionDto, { ...dto(), ...extra }), JSON.stringify(extra));
  assert.equal(((await query({ contacto_id: '7', vencida: 'si' })) as CotizacionQueryDto).contacto_id, 7);
  for (const bad of [{ contacto_id: '0' }, { contacto_id: 'abc' }, { vencida: 'sí' }, { vencida: 'true' }, { page: '100001' }, { estado: 'cualquiera' }, { search: 'x'.repeat(101) }]) await assert.rejects(() => query(bad), JSON.stringify(bad));
});

test('roles: marcar «enviada» exige cotizaciones:enviar, «anulada» cotizaciones:anular; la secretaria no ve cotizaciones', () => {
  const route = Reflect.getMetadata(ACCESS_METADATA, CotizacionesController.prototype.status);
  assert.deepEqual(requirementFor(route, { body: { estado: 'enviada' } }), { kind: 'permisos', permissions: ['cotizaciones:editar', 'cotizaciones:enviar'] });
  assert.deepEqual(requirementFor(route, { body: { estado: 'anulada' } }), { kind: 'permisos', permissions: ['cotizaciones:editar', 'cotizaciones:anular'] });
  assert.deepEqual(requirementFor(route, { body: { estado: 'aceptada' } }), { kind: 'permisos', permissions: ['cotizaciones:editar'] });
  assert.deepEqual(requirementFor(route, { body: { estado: 'rechazada' } }), { kind: 'permisos', permissions: ['cotizaciones:editar'] });
  for (const permission of ['leer', 'crear', 'editar', 'enviar', 'anular']) {
    assert.equal(can('GERENTE_GENERAL', 'cotizaciones:' + permission), true); assert.equal(can('COORDINADORA_INSTITUCIONAL', 'cotizaciones:' + permission), true);
    assert.equal(can('SECRETARIA', 'cotizaciones:' + permission), false, 'la secretaria no tiene cotizaciones:' + permission);
  }
  assert.equal(can('CUENTA_BASICA', 'cotizaciones:leer'), false); assert.equal(can(undefined, 'cotizaciones:leer'), false);
});

test('HORUS Assistant es de solo lectura sobre cotizaciones: ninguna escritura en su código', () => {
  const dir = path.join(__dirname, '..', 'src', 'asistente');
  // Escritura por Prisma sobre `cotizacion` o SQL con INSERT/UPDATE/DELETE sobre la tabla `cotizaciones` (el SQL de límites de uso solo toca rate_limit_buckets).
  const writes = /cotizacion\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?cotizaciones\b/i;
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.ts'));
  assert.ok(files.length > 0);
  for (const name of files) assert.doesNotMatch(fs.readFileSync(path.join(dir, name), 'utf8'), writes, name);
  // Y el Asistente usa el mismo criterio de «vencida» que la API de cotizaciones.
  assert.match(fs.readFileSync(path.join(dir, 'asistente.data.ts'), 'utf8'), /estado: 'enviada', validez: \{ lt: window\.fechaDb \}/);
});
