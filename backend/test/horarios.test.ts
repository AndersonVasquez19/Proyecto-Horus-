import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, HttpException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { createValidationPipe } from '../src/common/validation';
import { HorariosEdicionIdDto, ReemplazoHorariosDto } from '../src/horarios/horarios.dto';
import { HorariosController } from '../src/horarios/horarios.controller';
import { assertScheduleEditable, diffTramos, MAX_HORARIOS, overlaps, translateDatabaseError, validateTramos, type Tramo } from '../src/horarios/horarios.rules';
import { HorariosService } from '../src/horarios/horarios.service';
import { PrismaService } from '../src/database/prisma.service';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';

// Todo SIMULADO: DTO, reglas puras y servicio con un Prisma de prueba en memoria. Ninguna prueba abre MySQL ni lee .env. La base real
// (CHECK, UNIQUE, clave foránea, migración y concurrencia con bloqueos reales) se prueba en test/horarios.integration.cjs.

type Dto = new () => object;
const validate = (body: unknown, metatype: Dto, type: 'body' | 'query' | 'param' = 'body') => createValidationPipe().transform(body, { type, metatype }) as Promise<Record<string, unknown>>;
const rejects400 = async (body: unknown, metatype: Dto = ReemplazoHorariosDto, type: 'body' | 'param' = 'body') => {
  await assert.rejects(validate(body, metatype, type), (error: unknown) => error instanceof HttpException && error.getStatus() === 400, JSON.stringify(body));
};
const prismaError = (code: string) => new PrismaClientKnownRequestError('Detalle SQL privado de prueba', { code, clientVersion: '6.19.3' });
const t = (dia_semana: number, hora_inicio: string, hora_fin: string): Tramo => ({ dia_semana, hora_inicio, hora_fin });
const bodyOf = (error: unknown) => (error as HttpException).getResponse() as Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------------------------
// DTO: validación estricta
// ---------------------------------------------------------------------------------------------------------------------------------
test('Horarios/DTO: acepta el reemplazo completo (también vacío) y rechaza tipos, formatos y campos ajenos con 400', async () => {
  const ok = await validate({ revision: 3, horarios: [{ dia_semana: 1, hora_inicio: '19:00', hora_fin: '22:00' }, { dia_semana: 6, hora_inicio: '09:00', hora_fin: '13:00' }] }, ReemplazoHorariosDto);
  assert.equal((ok.horarios as unknown[]).length, 2);
  assert.deepEqual({ ...await validate({ revision: 1, horarios: [] }, ReemplazoHorariosDto) }, { revision: 1, horarios: [] }, 'una lista vacía deja la edición sin horarios');
  const tramo = { dia_semana: 1, hora_inicio: '19:00', hora_fin: '22:00' };
  for (const body of [
    {}, { horarios: [tramo] }, { revision: 1 }, { revision: 0, horarios: [] }, { revision: '1', horarios: [] }, { revision: 1.5, horarios: [] },
    { revision: 1, horarios: 'lunes' }, { revision: 1, horarios: {} }, { revision: 1, horarios: [null] }, { revision: 1, horarios: [1] },
    ...[0, 8, -1, 1.5, '1', null, 'lunes'].map(dia_semana => ({ revision: 1, horarios: [{ ...tramo, dia_semana }] })),
    ...['9:00', '24:00', '19:60', '19:00:00', '1900', '', ' 19:00', null, 1900].map(hora_inicio => ({ revision: 1, horarios: [{ ...tramo, hora_inicio }] })),
    { revision: 1, horarios: [{ dia_semana: 1, hora_inicio: '19:00' }] },
    { revision: 1, horarios: [{ ...tramo, id: 4 }] }, { revision: 1, horarios: [{ ...tramo, convocatoria_id: 9 }] }, { revision: 1, horarios: [{ ...tramo, fecha: '2026-11-05' }] },
    { revision: 1, horarios: [], convocatoria_id: 2 }, { revision: 1, horarios: [], estado: 'abierta' },
    { revision: 1, horarios: Array.from({ length: MAX_HORARIOS + 1 }, (_, i) => ({ dia_semana: (i % 7) + 1, hora_inicio: '0' + Math.floor(i / 7) + ':00', hora_fin: '0' + Math.floor(i / 7) + ':30' })) },
  ]) await rejects400(body);
  await rejects400({ id: 'abc' }, HorariosEdicionIdDto, 'param'); await rejects400({ id: '0' }, HorariosEdicionIdDto, 'param');
  assert.deepEqual({ ...await validate({ id: '12' }, HorariosEdicionIdDto, 'param') }, { id: 12 });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Reglas puras
// ---------------------------------------------------------------------------------------------------------------------------------
test('Horarios/reglas: [inicio, fin) dentro del día; hora final igual o anterior → 422 sin escribir nada', () => {
  for (const [inicio, fin] of [['19:00', '19:00'], ['22:00', '19:00'], ['23:59', '00:00']]) {
    assert.throws(() => validateTramos([t(1, '08:00', '09:00'), t(2, inicio, fin)]), (error: unknown) => error instanceof UnprocessableEntityException && bodyOf(error).codigo === 'HORARIO_INVALIDO'
      && JSON.stringify(bodyOf(error).tramos) === JSON.stringify([{ indice: 1, dia_semana: 2, dia: 'martes', hora_inicio: inicio, hora_fin: fin }]), inicio + '-' + fin);
  }
  assert.deepEqual(validateTramos([t(7, '00:00', '23:59')]), [t(7, '00:00', '23:59')], 'el día completo de Lima cabe');
});

test('Horarios/reglas: duplicados y solapamientos del mismo día se rechazan; consecutivos y otros días se admiten; se devuelve ordenado', () => {
  const dup = () => validateTramos([t(1, '19:00', '22:00'), t(3, '19:00', '22:00'), t(1, '19:00', '22:00')]);
  assert.throws(dup, (error: unknown) => error instanceof UnprocessableEntityException && bodyOf(error).codigo === 'HORARIO_DUPLICADO');
  for (const [a, b] of [[t(1, '19:00', '22:00'), t(1, '21:00', '23:00')], [t(1, '19:00', '22:00'), t(1, '19:00', '20:00')], [t(6, '09:00', '13:00'), t(6, '10:00', '11:00')], [t(6, '10:00', '11:00'), t(6, '09:00', '13:00')]]) {
    assert.ok(overlaps(a, b) && overlaps(b, a));
    assert.throws(() => validateTramos([a, b]), (error: unknown) => {
      const body = bodyOf(error);
      return error instanceof UnprocessableEntityException && body.codigo === 'HORARIO_SOLAPADO' && (body.conflictos as { tipo: string }[])[0].tipo === 'solapamiento';
    }, JSON.stringify([a, b]));
  }
  assert.equal(overlaps(t(1, '09:00', '12:00'), t(1, '12:00', '14:00')), false, 'uno empieza cuando termina el otro');
  assert.equal(overlaps(t(1, '19:00', '22:00'), t(3, '19:00', '22:00')), false, 'otro día');
  const sorted = validateTramos([t(6, '09:00', '13:00'), t(3, '19:00', '22:00'), t(1, '19:00', '22:00'), t(6, '14:00', '17:00'), t(6, '13:00', '14:00')]);
  assert.deepEqual(sorted, [t(1, '19:00', '22:00'), t(3, '19:00', '22:00'), t(6, '09:00', '13:00'), t(6, '13:00', '14:00'), t(6, '14:00', '17:00')], 'horarios distintos por día y varios tramos el mismo día');
  assert.deepEqual(validateTramos([]), []);
});

test('Horarios/reglas: la diferencia conserva los tramos idénticos (mismo id), retira los que ya no figuran e inserta los nuevos', () => {
  const current = [{ id: 1, ...t(1, '19:00', '22:00') }, { id: 2, ...t(3, '19:00', '22:00') }];
  assert.deepEqual(diffTramos(current, [t(1, '19:00', '22:00'), t(3, '19:00', '22:00')]), { remove: [], add: [], unchanged: true });
  assert.deepEqual(diffTramos(current, [t(1, '19:00', '22:00'), t(3, '19:00', '21:30')]), { remove: [2], add: [t(3, '19:00', '21:30')], unchanged: false }, 'cambiar el fin es retirar y crear');
  assert.deepEqual(diffTramos(current, []), { remove: [1, 2], add: [], unchanged: false });
  assert.deepEqual(diffTramos([], [t(6, '09:00', '13:00')]), { remove: [], add: [t(6, '09:00', '13:00')], unchanged: false });
});

test('Horarios/reglas: una edición archivada o cancelada no cambia sus horarios; planificada, abierta y cerrada sí', () => {
  for (const estado of ['planificada', 'abierta', 'cerrada']) assert.doesNotThrow(() => assertScheduleEditable({ estado, archivado_at: null }), estado);
  assert.throws(() => assertScheduleEditable({ estado: 'cancelada', archivado_at: null }), ConflictException);
  assert.throws(() => assertScheduleEditable({ estado: 'cerrada', archivado_at: new Date() }), ConflictException);
});

test('Horarios/reglas: errores de la base traducidos sin detalles internos', () => {
  const message = (fn: () => never) => { try { fn(); } catch (error) { return { type: (error as object).constructor.name, text: JSON.stringify((error as HttpException).getResponse?.() ?? String(error)) }; } return null; };
  for (const code of ['P2002', 'P2034', 'P2028', 'P2003']) { const r = message(() => translateDatabaseError(prismaError(code)))!; assert.equal(r.type, ConflictException.name, code); assert.ok(!r.text.includes('SQL privado'), code); }
  for (const code of ['P2021', 'P2022', 'P2024']) assert.equal(message(() => translateDatabaseError(prismaError(code)))!.type, ServiceUnavailableException.name, code);
  const other = new Error('otro');
  assert.throws(() => translateDatabaseError(other), (error: unknown) => error === other, 'lo desconocido se propaga (500 genérico del filtro global)');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Servicio con Prisma simulado
// ---------------------------------------------------------------------------------------------------------------------------------
type Row = { id: number; convocatoria_id: number; dia_semana: number; hora_inicio: Date; hora_fin: Date };
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
function fakePrisma(options: { edition?: { id: number; curso_id: number; nombre: string; estado: string; archivado_at: Date | null; revision: number } | null; rows?: [number, string, string][]; failOn?: string; error?: unknown } = {}) {
  const log: string[] = [];
  let edition = options.edition === undefined ? { id: 7, curso_id: 2, nombre: 'Edición ficticia', estado: 'abierta', archivado_at: null, revision: 4 } : options.edition;
  let nextId = 100;
  let rows: Row[] = (options.rows ?? []).map(([dia, inicio, fin], i) => ({ id: i + 1, convocatoria_id: 7, dia_semana: dia, hora_inicio: time(inicio), hora_fin: time(fin) }));
  const history: Record<string, unknown>[] = [];
  const step = (name: string) => { log.push(name); if (options.failOn === name) throw options.error ?? prismaError('P2034'); };
  const pick = (row: Row) => ({ id: row.id, dia_semana: row.dia_semana, hora_inicio: row.hora_inicio, hora_fin: row.hora_fin });
  const pickEdition = () => edition && { id: edition.id, nombre: edition.nombre, estado: edition.estado, archivado_at: edition.archivado_at, revision: edition.revision };
  const client: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { step('lock:' + strings.join('?').replace(/\s+/g, ' ').trim() + ':' + values.join(',')); return [{ id: values[0] }]; },
    convocatoria: {
      findUnique: async ({ select }: any) => { step('convocatoria.findUnique'); return edition && (select.curso_id ? { curso_id: edition.curso_id } : pickEdition()); },
      findUniqueOrThrow: async () => { step('convocatoria.findUniqueOrThrow'); return pickEdition(); },
      updateMany: async ({ where, data }: any) => { step('convocatoria.updateMany'); if (!edition || edition.revision !== where.revision) return { count: 0 }; edition = { ...edition, revision: edition.revision + data.revision.increment }; return { count: 1 }; },
    },
    convocatoriaHorario: {
      findMany: async () => { step('horario.findMany'); return rows.map(pick); },
      deleteMany: async ({ where }: any) => { step('horario.deleteMany:' + where.id.in.join(',')); rows = rows.filter(row => !(row.convocatoria_id === where.convocatoria_id && where.id.in.includes(row.id))); return { count: 1 }; },
      createMany: async ({ data }: any) => {
        step('horario.createMany:' + data.length);
        for (const row of data) {
          if (rows.some(r => r.dia_semana === row.dia_semana && r.hora_inicio.getTime() === row.hora_inicio.getTime())) throw prismaError('P2002'); // el UNIQUE real
          rows.push({ id: nextId++, ...row });
        }
        return { count: data.length };
      },
    },
    adminUser: { findUnique: async () => { step('adminUser.findUnique'); return { rol: 'COORDINADORA_INSTITUCIONAL' }; } },
    academicoHistorial: { create: async ({ data }: any) => { step('historial.create'); history.push(data); return data; } },
  };
  // Transacción simulada: si el callback falla, se restaura el estado anterior (como el ROLLBACK real).
  client.$transaction = async (arg: any, txOptions: any) => {
    log.push('tx:' + (txOptions?.isolationLevel ?? ''));
    if (Array.isArray(arg)) return Promise.all(arg);
    const snapshot = { edition, rows: [...rows], history: history.length };
    try { return await arg(client); } catch (error) { edition = snapshot.edition; rows = snapshot.rows; history.length = snapshot.history; throw error; }
  };
  return { prisma: client as PrismaService, log, history, state: () => ({ edition, rows }) };
}
const service = (fake: ReturnType<typeof fakePrisma>) => new HorariosService(fake.prisma);
const replace = (fake: ReturnType<typeof fakePrisma>, horarios: Tramo[], revision = 4) => service(fake).replace(7, { revision, horarios }, 11);
const status = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error instanceof HttpException ? error.getStatus() : 500; } return 200; };

test('Horarios/servicio: GET devuelve la edición con su revisión y los tramos ordenados en hora de Lima; 404 si no existe', async () => {
  const fake = fakePrisma({ rows: [[6, '09:00', '13:00'], [1, '19:00', '22:00'], [3, '19:00', '22:00']] });
  const result = await service(fake).list(7);
  assert.deepEqual(result, {
    ok: true, convocatoria: { id: 7, nombre: 'Edición ficticia', estado: 'abierta', archivada: false, revision: 4, modificable: true }, zona_horaria: 'America/Lima',
    items: [{ id: 2, dia_semana: 1, dia: 'lunes', hora_inicio: '19:00', hora_fin: '22:00' }, { id: 3, dia_semana: 3, dia: 'miércoles', hora_inicio: '19:00', hora_fin: '22:00' }, { id: 1, dia_semana: 6, dia: 'sábado', hora_inicio: '09:00', hora_fin: '13:00' }],
  });
  assert.ok(fake.log.includes('tx:RepeatableRead'), 'lectura en una sola instantánea');
  await assert.rejects(service(fakePrisma({ edition: null })).list(99), NotFoundException);
  const archived = await service(fakePrisma({ edition: { id: 7, curso_id: 2, nombre: 'x', estado: 'cerrada', archivado_at: new Date(), revision: 9 } })).list(7);
  assert.equal(archived.convocatoria.modificable, false); assert.equal(archived.convocatoria.archivada, true);
});

test('Horarios/servicio: reemplazar bloquea curso → edición, aplica solo la diferencia, sube la revisión de la edición y deja historial sin datos personales', async () => {
  const fake = fakePrisma({ rows: [[1, '19:00', '22:00'], [3, '19:00', '22:00']] });
  const result = await replace(fake, [t(1, '19:00', '22:00'), t(3, '19:00', '21:30'), t(6, '09:00', '13:00')]);
  assert.equal(result.cambios, true);
  assert.equal(result.convocatoria.revision, 5, 'la revisión de la edición avanza');
  assert.deepEqual(result.items.map(item => [item.id, item.dia, item.hora_inicio, item.hora_fin]), [[1, 'lunes', '19:00', '22:00'], [100, 'miércoles', '19:00', '21:30'], [101, 'sábado', '09:00', '13:00']], 'el tramo sin cambios conserva su id');
  const order = fake.log.filter(entry => entry.startsWith('lock:') || entry.startsWith('horario.') || entry.startsWith('convocatoria.updateMany') || entry.startsWith('historial'));
  assert.match(order[0], /^lock:SELECT id FROM cursos WHERE id = \? FOR UPDATE:2$/); assert.match(order[1], /^lock:SELECT id FROM convocatorias WHERE id = \? FOR UPDATE:7$/);
  assert.deepEqual(order.slice(2), ['horario.findMany', 'horario.deleteMany:2', 'horario.createMany:2', 'convocatoria.updateMany', 'horario.findMany', 'historial.create'], 'primero se retira, luego se inserta');
  assert.ok(fake.log.includes('tx:ReadCommitted'));
  assert.deepEqual(fake.history, [{ entidad: 'convocatoria', entidad_id: 7, origen: 'panel', actor_id: 11, actor_rol: 'COORDINADORA_INSTITUCIONAL', operacion: 'edicion', campos: ['horarios'], revision: 5, estado_anterior: '2 horarios', estado_nuevo: '3 horarios' }]);
});

test('Horarios/servicio: reenviar el mismo conjunto no escribe, no sube la revisión ni deja historial', async () => {
  const fake = fakePrisma({ rows: [[1, '19:00', '22:00']] });
  const result = await replace(fake, [t(1, '19:00', '22:00')]);
  assert.equal(result.cambios, false); assert.equal(result.convocatoria.revision, 4);
  assert.ok(!fake.log.some(entry => /deleteMany|createMany|updateMany|historial/.test(entry))); assert.deepEqual(fake.history, []);
});

test('Horarios/servicio: lista vacía retira todos los tramos de la edición (operación explícita, con historial)', async () => {
  const fake = fakePrisma({ rows: [[1, '19:00', '22:00'], [6, '09:00', '13:00']] });
  const result = await replace(fake, []);
  assert.deepEqual(result.items, []); assert.equal(fake.history[0].estado_nuevo, '0 horarios');
});

test('Horarios/servicio: revisión obsoleta, edición archivada o cancelada → 409; edición inexistente → 404; nada se escribe', async () => {
  const stale = fakePrisma({ rows: [[1, '19:00', '22:00']] });
  assert.equal(await status(replace(stale, [t(2, '10:00', '12:00')], 3)), 409);
  assert.deepEqual(stale.state().rows.map(row => row.dia_semana), [1]); assert.equal(stale.state().edition!.revision, 4);
  for (const edition of [{ estado: 'cancelada', archivado_at: null }, { estado: 'cerrada', archivado_at: new Date() }]) {
    const fake = fakePrisma({ edition: { id: 7, curso_id: 2, nombre: 'x', revision: 4, ...edition } });
    assert.equal(await status(replace(fake, [t(2, '10:00', '12:00')])), 409, JSON.stringify(edition));
    assert.ok(!fake.log.some(entry => /deleteMany|createMany|updateMany|historial/.test(entry)));
  }
  const closed = fakePrisma({ edition: { id: 7, curso_id: 2, nombre: 'x', estado: 'cerrada', archivado_at: null, revision: 4 } });
  assert.equal(await status(replace(closed, [t(2, '10:00', '12:00')])), 200, 'una edición cerrada (que sigue dictándose) sí ajusta su horario');
  assert.equal(await status(service(fakePrisma({ edition: null })).replace(99, { revision: 1, horarios: [] }, 11)), 404);
});

test('Horarios/servicio: un conjunto inválido se rechaza ANTES de abrir la transacción', async () => {
  for (const horarios of [[t(1, '22:00', '19:00')], [t(1, '19:00', '22:00'), t(1, '21:00', '23:00')], [t(1, '19:00', '22:00'), t(1, '19:00', '22:00')]]) {
    const fake = fakePrisma();
    assert.equal(await status(replace(fake, horarios)), 422, JSON.stringify(horarios));
    assert.deepEqual(fake.log, [], 'ni siquiera se consulta la base');
  }
});

test('Horarios/servicio: un fallo a mitad de la transacción no deja cambios parciales (ni tramos, ni revisión, ni historial)', async () => {
  for (const failOn of ['horario.createMany:1', 'convocatoria.updateMany', 'historial.create']) {
    const fake = fakePrisma({ rows: [[1, '19:00', '22:00']], failOn });
    assert.equal(await status(replace(fake, [t(2, '10:00', '12:00')])), 409, failOn);
    assert.deepEqual(fake.state().rows.map(row => [row.id, row.dia_semana]), [[1, 1]], failOn + ': los tramos anteriores se conservan');
    assert.equal(fake.state().edition!.revision, 4, failOn); assert.deepEqual(fake.history, [], failOn);
  }
  const outdated = fakePrisma({ failOn: 'horario.findMany', error: prismaError('P2021') });
  assert.equal(await status(service(outdated).list(7)), 503, 'tabla inexistente (migración pendiente): 503 neutro');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Controlador: permisos reales de las rutas
// ---------------------------------------------------------------------------------------------------------------------------------
test('Horarios/controlador: GET exige convocatorias:leer y PUT convocatorias:editar (decoradores reales)', () => {
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, HorariosController.prototype.list), { kind: 'permiso', permission: 'convocatorias:leer' });
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, HorariosController.prototype.replace), { kind: 'permiso', permission: 'convocatorias:editar' });
  assert.equal(Reflect.getMetadata('path', HorariosController), 'admin/convocatorias');
  assert.equal(Reflect.getMetadata('path', HorariosController.prototype.list), ':id/horarios');
  assert.equal(Reflect.getMetadata('path', HorariosController.prototype.replace), ':id/horarios');
});
