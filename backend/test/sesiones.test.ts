import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { createValidationPipe } from '../src/common/validation';
import { CreateSesionDto, EdicionSesionesQueryDto, EstadoSesionDto, SESION_ESTADOS, SesionesQueryDto, SesionIdDto, UpdateSesionDto } from '../src/sesiones/sesiones.dto';
import {
  assertEditionAcceptsSessions, assertModalityFits, assertTransition, assertValidInterval, changedFieldNames, outsidePeriod, overlaps, requireReason, transitionNeedsReason, translateDatabaseError,
} from '../src/sesiones/sesiones.rules';
import { SesionesService, viewSesion } from '../src/sesiones/sesiones.service';
import { formatDate, formatTime, hasStarted, isCalendarDate, isClockTime, limaClock, limaToUtc, parseDate, parseTime, slotLabel, ZONA_HORARIA } from '../src/sesiones/sesiones.time';
import { PrismaService } from '../src/database/prisma.service';

type Dto = new () => object;
const validate = (body: unknown, metatype: Dto, type: 'body' | 'query' | 'param' = 'body') => createValidationPipe().transform(body, { type, metatype }) as Promise<Record<string, unknown>>;
const prismaError = (code: string) => new PrismaClientKnownRequestError('Detalle SQL privado de prueba', { code, clientVersion: '6.19.3' });
const valid = { convocatoria_id: 3, titulo: 'Clase 1', fecha: '2026-11-05', hora_inicio: '14:00', hora_fin: '16:00' };

// ---------------------------------------------------------------------------------------------------------------------------------
// Zona horaria
// ---------------------------------------------------------------------------------------------------------------------------------
test('Sesiones/hora: Lima es UTC-5 todo el año y la conversión no depende de la zona del proceso', () => {
  const zones = ['UTC', 'Asia/Tokyo', 'Pacific/Auckland', 'America/Los_Angeles', 'America/Lima', 'Europe/Madrid'];
  const original = process.env.TZ;
  try {
    const results = zones.map(zone => {
      process.env.TZ = zone;
      return JSON.stringify([
        limaToUtc('2026-11-05', '14:00').toISOString(), limaToUtc('2026-07-01', '00:00').toISOString(), limaToUtc('2027-12-31', '23:59').toISOString(), limaToUtc('2028-02-29', '12:30').toISOString(),
        limaClock(new Date('2026-11-05T19:00:00Z')), limaClock(new Date('2026-11-06T04:59:59Z')), limaClock(new Date('2026-11-06T05:00:00Z')), limaClock(new Date('2026-01-01T04:59:00Z')),
      ]);
    });
    assert.equal(new Set(results).size, 1, 'mismo resultado con cualquier TZ del sistema');
    process.env.TZ = 'Pacific/Auckland'; // un TZ extremo
    assert.notEqual(new Date(2026, 0, 1).getTimezoneOffset(), 300, 'el cambio de TZ del proceso está activo');
    assert.equal(limaToUtc('2026-11-05', '14:00').toISOString(), '2026-11-05T19:00:00.000Z');
    assert.equal(limaToUtc('2026-07-01', '00:00').toISOString(), '2026-07-01T05:00:00.000Z', 'sin horario de verano: julio igual que enero');
    assert.equal(limaToUtc('2027-12-31', '23:59').toISOString(), '2028-01-01T04:59:00.000Z', 'la medianoche local cae en el día siguiente en UTC');
    assert.deepEqual(limaClock(new Date('2026-11-06T04:59:59Z')), { fecha: '2026-11-05', hora: '23:59' });
    assert.deepEqual(limaClock(new Date('2026-11-06T05:00:00Z')), { fecha: '2026-11-06', hora: '00:00' }, 'la hora 24 no existe: medianoche = 00:00');
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('Sesiones/hora: «ya empezó» se decide en hora de Lima y en el segundo exacto', () => {
  assert.equal(hasStarted('2026-11-05', '14:00', new Date('2026-11-05T18:59:59.999Z')), false);
  assert.equal(hasStarted('2026-11-05', '14:00', new Date('2026-11-05T19:00:00.000Z')), true);
  assert.equal(hasStarted('2026-11-05', '14:00', new Date('2026-11-05T14:00:00.000Z')), false, 'las 14:00 UTC son las 09:00 en Lima: aún no empezó');
  assert.equal(hasStarted('2026-11-06', '00:00', new Date('2026-11-06T04:59:59.999Z')), false);
  assert.equal(hasStarted('2026-11-06', '00:00', new Date('2026-11-06T05:00:00.000Z')), true);
});

test('Sesiones/hora: fechas de calendario reales, horas HH:MM y conversiones con la base sin desplazar el día', () => {
  for (const good of ['2026-11-05', '2000-01-01', '2100-12-31', '2028-02-29']) assert.equal(isCalendarDate(good), true, good);
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '2026-1-1', '26-11-05', '1999-12-31', '2101-01-01', '2026-11-05 ', '2026-11-05T00:00:00Z', '', null, undefined, 20261105, new Date()]) assert.equal(isCalendarDate(bad), false, String(bad));
  for (const good of ['00:00', '09:05', '23:59']) assert.equal(isClockTime(good), true, good);
  for (const bad of ['24:00', '9:00', '14:60', '14:00:00', '1400', '', ' 14:00', '14:00 ', null, 1400]) assert.equal(isClockTime(bad), false, String(bad));
  const day = parseDate('2026-11-05');
  assert.equal(day.toISOString(), '2026-11-05T00:00:00.000Z'); assert.equal(formatDate(day), '2026-11-05');
  const time = parseTime('14:30');
  assert.equal(time.toISOString(), '1970-01-01T14:30:00.000Z'); assert.equal(formatTime(time), '14:30');
  assert.equal(formatTime(parseTime('00:00')), '00:00'); assert.equal(formatTime(parseTime('23:59')), '23:59');
  assert.ok(slotLabel('2026-11-05', '14:00', '16:00').length <= 30, 'cabe en estado_anterior (VARCHAR(30))');
  assert.equal(ZONA_HORARIA, 'America/Lima');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Reglas puras
// ---------------------------------------------------------------------------------------------------------------------------------
test('Sesiones/reglas: el intervalo es [inicio, fin): sin vacíos, sin invertir y consecutivas sin solapamiento', () => {
  assertValidInterval('14:00', '14:01'); assertValidInterval('00:00', '23:59');
  for (const [a, b] of [['14:00', '14:00'], ['16:00', '14:00'], ['23:59', '00:00'], ['23:59', '23:59']]) assert.throws(() => assertValidInterval(a, b), UnprocessableEntityException, a + '-' + b);
  const slot = (inicio: string, fin: string) => ({ inicio, fin });
  assert.equal(overlaps(slot('14:00', '16:00'), slot('16:00', '18:00')), false, 'termina cuando empieza la siguiente');
  assert.equal(overlaps(slot('16:00', '18:00'), slot('14:00', '16:00')), false);
  assert.equal(overlaps(slot('14:00', '16:00'), slot('15:59', '17:00')), true);
  assert.equal(overlaps(slot('14:00', '16:00'), slot('13:00', '14:01')), true);
  assert.equal(overlaps(slot('14:00', '16:00'), slot('14:30', '15:00')), true, 'contenida');
  assert.equal(overlaps(slot('14:30', '15:00'), slot('14:00', '16:00')), true, 'contenedora');
  assert.equal(overlaps(slot('14:00', '16:00'), slot('14:00', '16:00')), true, 'idéntica');
  assert.equal(overlaps(slot('08:00', '09:00'), slot('10:00', '11:00')), false);
});

test('Sesiones/reglas: modalidad, edición y motivos', () => {
  assertModalityFits('presencial', 'Aula 1', null); assertModalityFits('virtual', null, 'https://x.test/a'); assertModalityFits('hibrida', 'Aula', 'https://x.test/a');
  assertModalityFits('presencial', null, null); assertModalityFits('virtual', null, null); // pueden definirse después
  assert.throws(() => assertModalityFits('presencial', null, 'https://x.test/a'), UnprocessableEntityException);
  assert.throws(() => assertModalityFits('virtual', 'Aula 1', null), UnprocessableEntityException);
  const edition = (estado: string, archivado = false) => ({ estado, archivado_at: archivado ? new Date() : null });
  for (const estado of ['planificada', 'abierta', 'cerrada']) assertEditionAcceptsSessions(edition(estado));
  assert.throws(() => assertEditionAcceptsSessions(edition('cancelada')), ConflictException);
  assert.throws(() => assertEditionAcceptsSessions(edition('cerrada', true)), ConflictException);
  assert.equal(requireReason('Feriado', 'm'), 'Feriado');
  for (const empty of [undefined, '']) assert.throws(() => requireReason(empty, 'Indica el motivo'), UnprocessableEntityException);
  assert.deepEqual(['programada', 'realizada', 'cancelada'].map(to => transitionNeedsReason(to as 'programada')), [true, false, true]);
  assert.deepEqual(changedFieldNames({ titulo: 'A', lugar: undefined, observaciones: '' }), ['titulo', 'observaciones']);
});

test('Sesiones/reglas: máquina de estados completa (3×3) y avisos de periodo', () => {
  const allowed = new Set(['programada>realizada', 'programada>cancelada', 'realizada>programada']);
  for (const from of SESION_ESTADOS) for (const to of SESION_ESTADOS) {
    if (allowed.has(from + '>' + to)) assert.doesNotThrow(() => assertTransition(from, to), from + '>' + to);
    else assert.throws(() => assertTransition(from, to), ConflictException, from + '>' + to);
  }
  assert.throws(() => assertTransition('realizada', 'cancelada'), (error: Error) => error instanceof ConflictException && /reábrela/.test(error.message), 'una realizada no se cancela directamente');
  assert.throws(() => assertTransition('cancelada', 'programada'), (error: Error) => /sesión nueva/.test(error.message), 'cancelada es final');
  const period = { fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30' };
  assert.deepEqual(['2026-11-01', '2026-11-30', '2026-10-31', '2026-12-01'].map(day => outsidePeriod(day, period)), [false, false, true, true]);
  assert.equal(outsidePeriod('2030-01-01', { fecha_inicio: null, fecha_fin: null }), false, 'sin fechas en la edición no hay aviso');
  assert.equal(outsidePeriod('2020-01-01', { fecha_inicio: null, fecha_fin: '2026-11-30' }), false); assert.equal(outsidePeriod('2030-01-01', { fecha_inicio: '2026-11-01', fecha_fin: null }), false);
});

test('Sesiones/errores: traduce unicidad, estructura incompleta y conflictos de escritura sin exponer SQL', () => {
  const expectError = (code: string, expected: new (...args: never[]) => Error) =>
    assert.throws(() => translateDatabaseError(prismaError(code)), (error: Error) => error instanceof expected && !error.message.includes('SQL privado'), code);
  for (const code of ['P2002', 'P2034', 'P2028', 'P2003']) expectError(code, ConflictException);
  for (const code of ['P2021', 'P2022', 'P2024']) expectError(code, ServiceUnavailableException);
  const unknown = new Error('otro'); assert.throws(() => translateDatabaseError(unknown), unknown);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------------------------------------------
test('Sesiones/DTO: alta normaliza textos y solo exige edición, título, fecha y horas', async () => {
  const dto = await validate({ ...valid, titulo: '  Introducción \n  al  curso ', lugar: '  Aula   3 ', observaciones: '  Traer laptop ', enlace_url: ' https://reunion.test/sala ' }, CreateSesionDto);
  assert.equal(dto.titulo, 'Introducción al curso'); assert.equal(dto.lugar, 'Aula 3'); assert.equal(dto.observaciones, 'Traer laptop'); assert.equal(dto.enlace_url, 'https://reunion.test/sala');
  await validate(valid, CreateSesionDto);
  await validate({ ...valid, lugar: '', enlace_url: '', observaciones: '', docente_id: 4, modalidad: 'hibrida' }, CreateSesionDto);
  await validate({ ...valid, titulo: 'A', hora_inicio: '00:00', hora_fin: '23:59', fecha: '2000-01-01' }, CreateSesionDto); // sin longitudes mínimas inventadas
  assert.equal((await validate({ ...valid, fecha: '2028-02-29' }, CreateSesionDto)).fecha, '2028-02-29');
});

test('Sesiones/DTO: alta rechaza valores inválidos y campos ajenos (estado, revisión, asignación, cancelación) sin convertirlos', async () => {
  for (const patch of [
    { titulo: '' }, { titulo: '   ' }, { titulo: null }, { titulo: 'x'.repeat(161) }, { lugar: 'x'.repeat(201) }, { observaciones: 'x'.repeat(501) }, { lugar: null }, { observaciones: null }, { enlace_url: null },
    { fecha: '2026-02-30' }, { fecha: '2026-13-01' }, { fecha: '05/11/2026' }, { fecha: '2026-11-05T10:00:00Z' }, { fecha: 20261105 }, { fecha: '1999-12-31' }, { fecha: '2101-01-01' }, { fecha: '' }, { fecha: null },
    { hora_inicio: '24:00' }, { hora_inicio: '9:00' }, { hora_inicio: '14:60' }, { hora_inicio: '14:00:00' }, { hora_inicio: 1400 }, { hora_fin: '' }, { hora_fin: null },
    { convocatoria_id: '3' }, { convocatoria_id: 0 }, { convocatoria_id: 1.5 }, { convocatoria_id: 2147483648 }, { docente_id: '4' }, { docente_id: 0 }, { docente_id: null }, { docente_id: 2.5 },
    { modalidad: 'remota' }, { modalidad: 'Presencial' }, { modalidad: null }, { enlace_url: 'http://reunion.test' }, { enlace_url: 'ftp://reunion.test' }, { enlace_url: 'javascript:alert(1)' }, { enlace_url: 'https://reunion.test/a b' }, { enlace_url: 'https://' + 'a'.repeat(2050) },
    { estado: 'cancelada' }, { revision: 2 }, { id: 9 }, { asignacion_id: 1 }, { cancelada_at: '2026-01-01' }, { cancelacion_motivo: 'x' }, { motivo: 'x' }, { zona_horaria: 'UTC' }, { inicio_utc: '2026-11-05T19:00:00Z' }, { rol: 'GERENTE_GENERAL' },
  ]) await assert.rejects(validate({ ...valid, ...patch }, CreateSesionDto), BadRequestException, JSON.stringify(patch));
  for (const field of Object.keys(valid)) { const copy: Record<string, unknown> = { ...valid }; delete copy[field]; await assert.rejects(validate(copy, CreateSesionDto), BadRequestException, 'falta ' + field); }
});

test('Sesiones/DTO: edición exige revisión; vacío limpia lo opcional y null quita al docente', async () => {
  await validate({ revision: 1, lugar: '', enlace_url: '', observaciones: '' }, UpdateSesionDto);
  const dto = await validate({ revision: 2, titulo: '  Nuevo   título ', motivo: ' Cambio de agenda ', docente_id: null }, UpdateSesionDto);
  assert.equal(dto.titulo, 'Nuevo título'); assert.equal(dto.motivo, 'Cambio de agenda'); assert.equal(dto.docente_id, null);
  await validate({ revision: 1, fecha: '2026-11-06', hora_inicio: '15:00', hora_fin: '17:00', modalidad: 'virtual', docente_id: 7, motivo: 'x' }, UpdateSesionDto);
  for (const body of [{ titulo: 'Sin revisión' }, { revision: '1' }, { revision: 0 }, { revision: 1.5 }, { revision: 2147483647 }, { revision: 1, titulo: '' }, { revision: 1, titulo: null }, { revision: 1, fecha: null }, { revision: 1, hora_inicio: null },
    { revision: 1, modalidad: null }, { revision: 1, lugar: null }, { revision: 1, motivo: '' }, { revision: 1, motivo: '   ' }, { revision: 1, motivo: null }, { revision: 1, motivo: 'x'.repeat(301) }, { revision: 1, docente_id: '3' }, { revision: 1, docente_id: 0 },
    { revision: 1, estado: 'cancelada' }, { revision: 1, convocatoria_id: 2 }, { revision: 1, asignacion_id: 2 }, { revision: 1, cancelada_at: 'x' }, { revision: 1, enlace_url: 'http://x.test' }])
    await assert.rejects(validate(body, UpdateSesionDto), BadRequestException, JSON.stringify(body));
  const service = new SesionesService({} as PrismaService);
  await assert.rejects(service.update(1, { revision: 1 } as never, 1), BadRequestException, 'una edición vacía no consulta la base');
  await assert.rejects(service.update(1, { revision: 1, motivo: 'Solo motivo' } as never, 1), BadRequestException, 'el motivo solo no es un cambio');
});

test('Sesiones/DTO: estado, identificadores y consultas están acotados y paginados', async () => {
  await validate({ revision: 1, estado: 'cancelada', motivo: ' Feriado ' }, EstadoSesionDto);
  assert.equal((await validate({ revision: 1, estado: 'realizada', motivo: ' Todo bien ' }, EstadoSesionDto)).motivo, 'Todo bien');
  await validate({ revision: 1, estado: 'realizada' }, EstadoSesionDto);
  for (const body of [{ revision: 1 }, { estado: 'realizada' }, { revision: 1, estado: 'borrada' }, { revision: 1, estado: 'Realizada' }, { revision: '1', estado: 'realizada' }, { revision: 1, estado: 'realizada', motivo: '' }, { revision: 1, estado: 'realizada', motivo: '  ' },
    { revision: 1, estado: 'cancelada', motivo: 'x'.repeat(301) }, { revision: 1, estado: 'cancelada', fecha: '2026-11-05' }, { revision: 1, estado: 'cancelada', cancelada_at: 'x' }]) await assert.rejects(validate(body, EstadoSesionDto), BadRequestException, JSON.stringify(body));
  assert.equal((await validate({ id: '12' }, SesionIdDto, 'param')).id, 12);
  for (const id of ['0', 'abc', '-1', '1.5', '2147483648', '']) await assert.rejects(validate({ id }, SesionIdDto, 'param'), BadRequestException, id);
  const q = await validate({}, SesionesQueryDto, 'query');
  assert.deepEqual([q.page, q.limit, q.orden, q.estado, q.desde, q.hasta, q.convocatoria_id, q.docente_id], [1, 20, 'asc', undefined, undefined, undefined, undefined, undefined]);
  const filtered = await validate({ page: '2', limit: '10', convocatoria_id: '3', docente_id: '4', estado: 'cancelada', desde: '2026-11-01', hasta: '2026-11-30', orden: 'desc' }, SesionesQueryDto, 'query');
  assert.deepEqual([filtered.page, filtered.limit, filtered.convocatoria_id, filtered.docente_id, filtered.estado, filtered.desde, filtered.hasta, filtered.orden], [2, 10, 3, 4, 'cancelada', '2026-11-01', '2026-11-30', 'desc']);
  for (const body of [{ page: '0' }, { limit: '101' }, { page: 'x' }, { estado: 'todas' }, { estado: 'otra' }, { desde: '2026-02-30' }, { hasta: 'mañana' }, { orden: 'random' }, { convocatoria_id: '0' }, { docente_id: 'x' }, { q: 'x' }, { sort: 'id' }, { search: 'x' }])
    await assert.rejects(validate(body, SesionesQueryDto, 'query'), BadRequestException, JSON.stringify(body));
  await assert.rejects(validate({ convocatoria_id: '3' }, EdicionSesionesQueryDto, 'query'), BadRequestException, 'por edición, la edición va en la ruta');
  assert.equal((await validate({ docente_id: '2', estado: 'programada' }, EdicionSesionesQueryDto, 'query')).docente_id, 2);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Servicio con transacción simulada: orden de bloqueo, aislamiento, reloj y errores
// ---------------------------------------------------------------------------------------------------------------------------------
const day = new Date('2026-11-05T00:00:00Z');
const baseRow = (patch: Record<string, unknown> = {}) => ({
  id: 7, convocatoria_id: 3, asignacion_id: 11, titulo: 'Clase 1', fecha: day, hora_inicio: parseTime('14:00'), hora_fin: parseTime('16:00'), modalidad: 'presencial', lugar: 'Aula 3', enlace_url: null,
  estado: 'programada', cancelada_at: null, cancelacion_motivo: null, observaciones: null, revision: 1, createdAt: day, updatedAt: day,
  convocatoria: { id: 3, nombre: 'Noviembre', estado: 'abierta', archivado_at: null, fecha_inicio: new Date('2026-11-01T00:00:00Z'), fecha_fin: new Date('2026-11-30T00:00:00Z'), curso: { id: 1, titulo: 'Excel', tipo: 'curso' } },
  asignacion: { id: 11, rol: 'principal', estado: 'activa', docente: { id: 5, nombres: 'Ana', apellidos: 'Pérez', especialidad: null, activo: true } },
  ...patch,
});

function fake(row: ReturnType<typeof baseRow>, options: { edition?: Record<string, unknown>; conflicts?: unknown[]; teacher?: { activo: boolean } | null; assignment?: { id: number; estado: string } | null; created?: ReturnType<typeof baseRow> } = {}) {
  const log = { locks: [] as string[], updates: [] as Record<string, unknown>[], history: [] as Record<string, unknown>[], isolation: [] as unknown[], created: [] as Record<string, unknown>[], conflictQueries: [] as Record<string, unknown>[] };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => { log.locks.push(strings.join('?').trim()); return [{ id: 1 }]; },
    convocatoria: { findUnique: async () => ({ curso_id: 1 }), findUniqueOrThrow: async () => ({ id: 3, estado: 'abierta', archivado_at: null, curso: { modalidad: 'presencial' }, ...options.edition }) },
    sesion: {
      findUnique: async () => ({ convocatoria_id: 3 }), findUniqueOrThrow: async () => row,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { log.updates.push(data); return { count: 1 }; },
      findMany: async (args: Record<string, unknown>) => { log.conflictQueries.push(args); return options.conflicts ?? []; },
      create: async ({ data }: { data: Record<string, unknown> }) => { log.created.push(data); return options.created ?? row; },
    },
    docente: { findUniqueOrThrow: async () => options.teacher === undefined ? { activo: true } : options.teacher },
    docenteAsignacion: { findUnique: async () => options.assignment === undefined ? { id: 11, estado: 'activa' } : options.assignment },
    adminUser: { findUnique: async () => ({ rol: 'COORDINADORA_INSTITUCIONAL' }) },
    academicoHistorial: { create: async ({ data }: { data: Record<string, unknown> }) => { log.history.push(data); } },
  };
  const prisma = { $transaction: async (fn: (client: typeof tx) => Promise<unknown>, opts: unknown) => { log.isolation.push(opts); return fn(tx); } } as unknown as PrismaService;
  return { prisma, log };
}

test('Sesiones/servicio: toda escritura usa READ COMMITTED y el orden de bloqueo curso → edición → docente', async () => {
  const { prisma, log } = fake(baseRow());
  const service = new SesionesService(prisma, () => new Date('2026-11-05T19:00:00Z'));
  await service.create({ ...valid, docente_id: 5 } as CreateSesionDto, 1);
  assert.deepEqual(log.locks, ['SELECT id FROM cursos WHERE id = ? FOR UPDATE', 'SELECT id FROM convocatorias WHERE id = ? FOR UPDATE', 'SELECT id FROM docentes WHERE id = ? FOR UPDATE'], 'mismo orden que Ediciones, Matrículas y Docentes');
  assert.equal((log.isolation[0] as { isolationLevel: string }).isolationLevel, 'ReadCommitted');
  // La consulta de solapamientos usa el intervalo semiabierto: empieza antes de que el otro termine y termina después de que el otro empiece.
  const where = log.conflictQueries[0].where as Record<string, unknown>;
  assert.deepEqual([where.hora_inicio, where.hora_fin], [{ lt: parseTime('16:00') }, { gt: parseTime('14:00') }], 'estrictas: una que termina a las 14:00 no choca con otra que empieza a las 14:00');
  assert.deepEqual(where.estado, { not: 'cancelada' });
  log.locks.length = 0;
  await service.changeState(7, { revision: 1, estado: 'cancelada', motivo: 'Feriado' }, 1);
  assert.deepEqual(log.locks.slice(0, 2), ['SELECT id FROM cursos WHERE id = ? FOR UPDATE', 'SELECT id FROM convocatorias WHERE id = ? FOR UPDATE']);
  log.locks.length = 0;
  await service.update(7, { revision: 1, titulo: 'Otro título' } as UpdateSesionDto, 1);
  assert.deepEqual(log.locks, ['SELECT id FROM cursos WHERE id = ? FOR UPDATE', 'SELECT id FROM convocatorias WHERE id = ? FOR UPDATE'], 'editar un texto no bloquea al docente');
  log.locks.length = 0;
  await service.update(7, { revision: 1, hora_inicio: '15:00', hora_fin: '17:00', motivo: 'Cambio' } as UpdateSesionDto, 1);
  assert.equal(log.locks.at(-1), 'SELECT id FROM docentes WHERE id = ? FOR UPDATE', 'reprogramar sí lo bloquea');
});

test('Sesiones/servicio: marcar como realizada compara con la hora de Lima del reloj inyectado', async () => {
  const start = (iso: string) => { const { prisma, log } = fake(baseRow()); return { service: new SesionesService(prisma, () => new Date(iso)), log }; };
  const before = start('2026-11-05T18:59:59.999Z');
  await assert.rejects(before.service.changeState(7, { revision: 1, estado: 'realizada' }, 1), (error: Error) => error instanceof ConflictException && /no ha comenzado/.test(error.message));
  assert.equal(before.log.updates.length, 0, 'no se escribe nada');
  const exact = start('2026-11-05T19:00:00.000Z');
  const done = await exact.service.changeState(7, { revision: 1, estado: 'realizada' }, 9);
  assert.equal(done.ok, true); assert.deepEqual(exact.log.updates[0], { estado: 'realizada', revision: { increment: 1 } });
  assert.deepEqual([exact.log.history[0].entidad, exact.log.history[0].operacion, exact.log.history[0].estado_anterior, exact.log.history[0].estado_nuevo, exact.log.history[0].actor_id, exact.log.history[0].actor_rol],
    ['sesion', 'cambio_estado', 'programada', 'realizada', 9, 'COORDINADORA_INSTITUCIONAL']);
  // Cancelar registra la fecha del reloj y el motivo; reabrir y cancelar exigen motivo; una cancelada no cambia.
  const cancel = start('2026-11-05T20:00:00.000Z');
  await cancel.service.changeState(7, { revision: 1, estado: 'cancelada', motivo: 'Feriado' }, 1);
  assert.deepEqual(cancel.log.updates[0], { estado: 'cancelada', cancelada_at: new Date('2026-11-05T20:00:00.000Z'), cancelacion_motivo: 'Feriado', revision: { increment: 1 } });
  assert.deepEqual(cancel.log.history[0].campos, ['estado', 'cancelada_at', 'cancelacion_motivo']);
  await assert.rejects(cancel.service.changeState(7, { revision: 1, estado: 'cancelada' }, 1), UnprocessableEntityException);
  await assert.rejects(cancel.service.changeState(7, { revision: 4, estado: 'cancelada', motivo: 'x' }, 1), (error: Error) => error instanceof ConflictException && /cambió/.test(error.message), 'revisión obsoleta');
  const frozen = fake(baseRow({ estado: 'cancelada', cancelada_at: day, cancelacion_motivo: 'x' }));
  await assert.rejects(new SesionesService(frozen.prisma).changeState(7, { revision: 1, estado: 'programada', motivo: 'x' }, 1), ConflictException);
  const realizada = fake(baseRow({ estado: 'realizada' }));
  await assert.rejects(new SesionesService(realizada.prisma).changeState(7, { revision: 1, estado: 'programada' }, 1), UnprocessableEntityException, 'reabrir exige motivo');
  await new SesionesService(realizada.prisma).changeState(7, { revision: 1, estado: 'programada', motivo: 'Error al marcar' }, 1);
  assert.equal(realizada.log.history[0].motivo, 'Error al marcar');
});

test('Sesiones/servicio: una edición archivada o cancelada no admite programar, pero sí cancelar sesiones', async () => {
  for (const edition of [{ archivado_at: new Date() }, { estado: 'cancelada' }]) {
    const { prisma, log } = fake(baseRow(), { edition });
    const service = new SesionesService(prisma, () => new Date('2030-01-01T00:00:00Z'));
    await assert.rejects(service.create(valid as CreateSesionDto, 1), ConflictException);
    await assert.rejects(service.update(7, { revision: 1, titulo: 'X' } as UpdateSesionDto, 1), ConflictException);
    await assert.rejects(service.changeState(7, { revision: 1, estado: 'realizada' }, 1), ConflictException);
    assert.equal(log.updates.length + log.created.length, 0);
    await service.changeState(7, { revision: 1, estado: 'cancelada', motivo: 'Edición cancelada' }, 1);
    assert.equal(log.updates.length, 1, 'cancelar siempre se permite');
  }
});

test('Sesiones/servicio: el docente debe existir, estar activo y tener asignación activa en ESA edición', async () => {
  const run = (options: Parameters<typeof fake>[1]) => new SesionesService(fake(baseRow(), options).prisma).create({ ...valid, docente_id: 5 } as CreateSesionDto, 1);
  await assert.rejects(run({ teacher: { activo: false } }), (error: Error) => error instanceof ConflictException && /inactivo/.test(error.message));
  await assert.rejects(run({ assignment: null }), (error: Error) => error instanceof ConflictException && /no está asignado/.test(error.message));
  await assert.rejects(run({ assignment: { id: 11, estado: 'retirada' } }), (error: Error) => error instanceof ConflictException && /retirada/.test(error.message));
  const noTeacher = { $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: async () => [], convocatoria: { findUnique: async () => ({ curso_id: 1 }), findUniqueOrThrow: async () => ({ id: 3, estado: 'abierta', archivado_at: null, curso: { modalidad: 'presencial' } }) } }) } as unknown as PrismaService;
  await assert.rejects(new SesionesService(noTeacher).create({ ...valid, docente_id: 5 } as CreateSesionDto, 1), NotFoundException);
  const { prisma, log } = fake(baseRow()); await new SesionesService(prisma).create({ ...valid, docente_id: 5 } as CreateSesionDto, 1);
  assert.equal(log.created[0].asignacion_id, 11, 'la sesión se vincula a la asignación, no al docente');
});

test('Sesiones/servicio: un solapamiento responde 409 con el código y las sesiones en conflicto, sin datos personales', async () => {
  const conflicts = [{ id: 9, convocatoria_id: 3, titulo: 'Otra', fecha: day, hora_inicio: parseTime('15:00'), hora_fin: parseTime('17:00'), estado: 'programada', asignacion: { docente_id: 5 } }];
  const { prisma, log } = fake(baseRow(), { conflicts });
  await assert.rejects(new SesionesService(prisma).create({ ...valid, docente_id: 5 } as CreateSesionDto, 1), (error: ConflictException) => {
    const body = error.getResponse() as { codigo: string; conflictos: { id: number; tipo: string[]; hora_inicio: string }[]; message: string };
    assert.equal(error.getStatus(), 409); assert.equal(body.codigo, 'CONFLICTO_HORARIO');
    assert.deepEqual(body.conflictos, [{ id: 9, convocatoria_id: 3, titulo: 'Otra', fecha: '2026-11-05', hora_inicio: '15:00', hora_fin: '17:00', estado: 'programada', tipo: ['edicion', 'docente'] }]);
    assert.ok(!/Ana|Pérez/.test(JSON.stringify(body))); return true;
  });
  assert.equal(log.created.length, 0, 'no se escribe nada ante un conflicto');
  // Sin docente solo se compara la edición; al reprogramar la sesión no choca consigo misma.
  const solo = fake(baseRow({ asignacion_id: null, asignacion: null }));
  await new SesionesService(solo.prisma).update(7, { revision: 1, hora_inicio: '15:00', hora_fin: '17:00', motivo: 'Cambio' } as UpdateSesionDto, 1);
  const query = solo.log.conflictQueries[0].where as { id: unknown; OR: unknown[] };
  assert.deepEqual(query.id, { not: 7 }); assert.deepEqual(query.OR, [{ convocatoria_id: 3 }]);
  assert.deepEqual(solo.log.history[0].operacion, 'reprogramacion'); assert.deepEqual([solo.log.history[0].estado_anterior, solo.log.history[0].estado_nuevo], ['2026-11-05 14:00-16:00', '2026-11-05 15:00-17:00']);
});

test('Sesiones/servicio: validación estática antes de tocar la base y filtros de fecha coherentes', async () => {
  const untouched = { get $transaction(): never { throw new Error('no debería consultarse la base'); } } as unknown as PrismaService;
  const service = new SesionesService(untouched);
  await assert.rejects(service.create({ ...valid, hora_inicio: '16:00', hora_fin: '14:00' } as CreateSesionDto, 1), UnprocessableEntityException);
  await assert.rejects(service.create({ ...valid, hora_inicio: '14:00', hora_fin: '14:00' } as CreateSesionDto, 1), UnprocessableEntityException);
  await assert.rejects(service.list({ page: 1, limit: 20, orden: 'asc', desde: '2026-12-01', hasta: '2026-11-01' } as SesionesQueryDto), BadRequestException);
  await assert.rejects(service.listByEdition(1, { page: 1, limit: 20, orden: 'asc', desde: '2026-12-01', hasta: '2026-11-01' } as EdicionSesionesQueryDto), BadRequestException);
});

test('Sesiones/servicio: traduce errores de la base sin exponer SQL y responde 404 a lo inexistente', async () => {
  for (const [code, expected] of [['P2002', ConflictException], ['P2021', ServiceUnavailableException], ['P2022', ServiceUnavailableException], ['P2034', ConflictException], ['P2028', ConflictException]] as const) {
    const failing = { $transaction: async () => { throw prismaError(code); }, sesion: { findUnique: async () => { throw prismaError(code); } } } as unknown as PrismaService;
    await assert.rejects(new SesionesService(failing).create(valid as CreateSesionDto, 1), (error: Error) => error instanceof expected && !error.message.includes('SQL privado'), code);
    await assert.rejects(new SesionesService(failing).detail(1), (error: Error) => error instanceof expected && !error.message.includes('SQL privado'), code);
  }
  await assert.rejects(new SesionesService({ sesion: { findUnique: async () => null } } as unknown as PrismaService).detail(1), NotFoundException);
  const missing = { $transaction: async (fn: (tx: unknown) => unknown) => fn({ sesion: { findUnique: async () => null } }) } as unknown as PrismaService;
  await assert.rejects(new SesionesService(missing).update(1, { revision: 1, titulo: 'X' } as UpdateSesionDto, 1), NotFoundException);
  await assert.rejects(new SesionesService(missing).changeState(1, { revision: 1, estado: 'cancelada', motivo: 'x' }, 1), NotFoundException);
  const noEdition = { $transaction: async (fn: (tx: unknown) => unknown) => fn({ convocatoria: { findUnique: async () => null } }) } as unknown as PrismaService;
  await assert.rejects(new SesionesService(noEdition).create(valid as CreateSesionDto, 1), NotFoundException);
});

test('Sesiones/vista: contrato para el calendario, instante UTC calculado y docente sin datos personales', () => {
  const view = viewSesion(baseRow() as never);
  assert.deepEqual([view.fecha, view.hora_inicio, view.hora_fin, view.zona_horaria, view.inicio_utc, view.fin_utc], ['2026-11-05', '14:00', '16:00', 'America/Lima', '2026-11-05T19:00:00.000Z', '2026-11-05T21:00:00.000Z']);
  assert.deepEqual(view.docente, { id: 5, nombres: 'Ana', apellidos: 'Pérez', especialidad: null, activo: true, asignacion_id: 11, rol: 'principal', asignacion_estado: 'activa', vigente: true });
  assert.equal(view.docente_id, 5); assert.equal(view.fuera_de_periodo, false);
  assert.equal(view.convocatoria.fecha_inicio, '2026-11-01'); assert.equal(view.convocatoria.fecha_fin, '2026-11-30');
  for (const forbidden of ['doc_numero', 'email', 'telefono', 'profesion', 'doc_tipo', 'doc_pais']) assert.ok(!JSON.stringify(view).includes(forbidden), forbidden);
  const inactive = viewSesion(baseRow({ asignacion: { id: 11, rol: 'participante', estado: 'retirada', docente: { id: 5, nombres: 'Ana', apellidos: 'Pérez', especialidad: null, activo: true } } }) as never);
  assert.equal(inactive.docente?.vigente, false, 'asignación retirada → no vigente');
  assert.equal(viewSesion(baseRow({ asignacion: { id: 11, rol: 'participante', estado: 'activa', docente: { id: 5, nombres: 'Ana', apellidos: 'Pérez', especialidad: null, activo: false } } }) as never).docente?.vigente, false, 'docente inactivo → no vigente');
  const none = viewSesion(baseRow({ asignacion_id: null, asignacion: null, fecha: new Date('2026-12-15T00:00:00Z') }) as never);
  assert.deepEqual([none.docente, none.docente_id, none.fuera_de_periodo], [null, null, true]);
  const late = viewSesion(baseRow({ hora_inicio: parseTime('23:00'), hora_fin: parseTime('23:59') }) as never);
  assert.equal(late.fin_utc, '2026-11-06T04:59:00.000Z', 'el día siguiente en UTC');
});
