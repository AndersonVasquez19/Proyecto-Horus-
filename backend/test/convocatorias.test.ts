import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { PrismaService } from '../src/database/prisma.service';
import { ConvocatoriasService } from '../src/convocatorias/convocatorias.service';
import { createValidationPipe } from '../src/common/validation';
import { CreateConvocatoriaDto, UpdateConvocatoriaDto, ConvocatoriasQueryDto, CierreConvocatoriaDto } from '../src/convocatorias/convocatorias.dto';
import { validateEdition, validateTransition } from '../src/convocatorias/convocatorias.rules';

const input = { curso_id: 1, nombre: ' Noviembre 2026 ', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 };
const validate = (body: unknown, metatype: typeof CreateConvocatoriaDto | typeof UpdateConvocatoriaDto | typeof ConvocatoriasQueryDto | typeof CierreConvocatoriaDto, type: 'body' | 'query' = 'body') => createValidationPipe().transform(body, { type, metatype });

test('Ediciones: alta normalizada, capacidad entera y fechas de calendario estrictas', async () => {
  assert.equal((await validate(input, CreateConvocatoriaDto)).nombre, 'Noviembre 2026');
  for (const patch of [{ capacidad: 0 }, { capacidad: -1 }, { capacidad: 1.2 }, { capacidad: '20' }, { capacidad: null }, { capacidad: 2147483648 }, { nombre: '' }, { curso_id: 0 }, { fecha_inicio: '2026-02-30' }, { fecha_inicio: '2026-1-01' }, { fecha_fin: '2026-11-01T00:00:00Z' }, { estado: 'abierta' }, { fecha_inicio: null }]) {
    await assert.rejects(validate({ ...input, ...patch }, CreateConvocatoriaDto), BadRequestException);
  }
  await validate({ ...input, fecha_inicio: '2028-02-29', fecha_fin: '2028-03-01', capacidad: 1 }, CreateConvocatoriaDto);
});
test('Ediciones: revisión obligatoria, sin cambio de curso/estado y filtros limitados', async () => {
  for (const body of [{ nombre: 'Otro' }, { revision: 0 }, { revision: 1, nombre: null }, { revision: 1, curso_id: 2 }, { revision: 1, estado: 'cerrada' }]) await assert.rejects(validate(body, UpdateConvocatoriaDto), BadRequestException);
  for (const body of [{ estado: 'abierta', revision: 1 }, { estado: 'cancelada' }]) await assert.rejects(validate(body, CierreConvocatoriaDto), BadRequestException);
  const q = await validate({ curso_id: '2', limit: '10', estado: 'abierta' }, ConvocatoriasQueryDto, 'query');
  assert.equal(q.curso_id, 2); assert.equal(q.limit, 10);
  for (const q of [{ page: 0 }, { limit: 101 }, { estado: 'publicado' }, { archivo: 'otro' }, { curso_id: 'abc' }, { unknown: '1' }]) await assert.rejects(validate(q, ConvocatoriasQueryDto, 'query'), BadRequestException);
});
test('Ediciones: fechas combinadas y capacidad frente a matrículas existentes', () => {
  assert.throws(() => validateEdition({ fecha_inicio: '2026-11-30', fecha_fin: '2026-11-01', capacidad: 20 }, 0, false), BadRequestException);
  assert.throws(() => validateEdition({ fecha_inicio: null, fecha_fin: null, capacidad: null }, 0, true), ConflictException);
  assert.throws(() => validateEdition({ fecha_inicio: null, fecha_fin: null, capacidad: 2 }, 3, false), ConflictException);
  validateEdition({ fecha_inicio: '2026-11-01', fecha_fin: '2026-11-01', capacidad: 3 }, 3, true);
  validateEdition({ fecha_inicio: null, fecha_fin: null, capacidad: null }, 0, false);
});
test('Ediciones: transiciones terminales y archivo no se pueden eludir', () => {
  validateTransition('planificada', 'abierta', false);
  validateTransition('abierta', 'cerrada', false);
  validateTransition('planificada', 'cancelada', false);
  for (const [from, to, archived] of [['cerrada', 'abierta', false], ['cancelada', 'planificada', false], ['planificada', 'cerrada', false], ['abierta', 'abierta', false], ['planificada', 'abierta', true]] as const) assert.throws(() => validateTransition(from, to, archived), ConflictException);
});
test('Ediciones: servicio devuelve 404 y 503 seguros; edición vacía no consulta la base', async () => {
  const missing = new ConvocatoriasService({ convocatoria: { findUnique: async () => null } } as unknown as PrismaService);
  await assert.rejects(missing.detail(1), NotFoundException);
  assert.throws(() => missing.update(1, { revision: 1 }, 1), BadRequestException);
  const outdated = new ConvocatoriasService({ convocatoria: { findUnique: async () => { throw new PrismaClientKnownRequestError('detalle SQL ficticio', { code: 'P2022', clientVersion: '6.19.3' }); } } } as unknown as PrismaService);
  await assert.rejects(outdated.detail(1), error => error instanceof ServiceUnavailableException && !error.message.includes('SQL'));
});
