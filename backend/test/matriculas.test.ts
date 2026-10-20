import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { createValidationPipe } from '../src/common/validation';
import { PrismaService } from '../src/database/prisma.service';
import { AnularMatriculaDto, CreateMatriculaDto, MatriculasQueryDto, ReactivarMatriculaDto } from '../src/matriculas/matriculas.dto';
import { MatriculasService } from '../src/matriculas/matriculas.service';

const validate = (body: unknown, metatype: typeof CreateMatriculaDto | typeof MatriculasQueryDto | typeof AnularMatriculaDto | typeof ReactivarMatriculaDto, type: 'body' | 'query' = 'body') => createValidationPipe().transform(body, { type, metatype });
test('Matrículas: alta solo admite relaciones y revisión enteras; sin estado, responsable ni cumplimiento manipulables', async () => {
  const input = { estudiante_id: 1, convocatoria_id: 2, convocatoria_revision: 3 };
  assert.deepEqual({ ...await validate(input, CreateMatriculaDto) }, input);
  for (const patch of [{ estudiante_id: 0 }, { estudiante_id: '1' }, { convocatoria_id: null }, { convocatoria_revision: null }, { convocatoria_revision: 0 }, { convocatoria_revision: 1.5 }, { convocatoria_id: 2147483648 }, { estado: 'anulada' }, { actor_id: 1 }, { cumplimiento: 'cumplido' }]) await assert.rejects(validate({ ...input, ...patch }, CreateMatriculaDto), BadRequestException);
});
test('Matrículas: motivo normalizado obligatorio y revisión para ambas transiciones', async () => {
  assert.equal((await validate({ revision: 1, motivo: '  Retiro  ' }, AnularMatriculaDto)).motivo, 'Retiro');
  await validate({ revision: 1, convocatoria_revision: 1, motivo: 'A' }, ReactivarMatriculaDto);
  for (const body of [{ revision: 1 }, { revision: 1, motivo: ' ' }, { revision: 1, motivo: null }, { revision: 1, motivo: 'a'.repeat(301) }, { motivo: 'Retiro' }, { revision: '1', motivo: 'Retiro' }, { revision: 1, motivo: 'Retiro', estado: 'activa' }]) await assert.rejects(validate(body, AnularMatriculaDto), BadRequestException);
  await assert.rejects(validate({ revision: 1, motivo: 'Regreso' }, ReactivarMatriculaDto), BadRequestException);
});
test('Matrículas: filtros convertidos explícitamente, siempre paginados y limitados', async () => {
  const result = await validate({ estudiante_id: '2', convocatoria_id: '3', curso_id: '4', limit: '10', estado: 'anulada' }, MatriculasQueryDto, 'query');
  assert.equal(result.estudiante_id, 2); assert.equal(result.limit, 10); assert.equal(result.page, 1);
  for (const input of [{ page: 0 }, { limit: 101 }, { estudiante_id: 'abc' }, { estado: 'retirada' }, { archivo: 'todos' }, { curso_id: 0 }]) await assert.rejects(validate(input, MatriculasQueryDto, 'query'), BadRequestException);
});
test('Matrículas: detalle inexistente y esquema pendiente devuelven errores seguros', async () => {
  const missing = new MatriculasService({ matricula: { findUnique: async () => null } } as unknown as PrismaService);
  await assert.rejects(missing.detail(1), NotFoundException);
  const unavailable = new MatriculasService({ matricula: { findUnique: async () => { throw new PrismaClientKnownRequestError('SQL ficticio privado', { code: 'P2022', clientVersion: '6.19.3' }); } } } as unknown as PrismaService);
  await assert.rejects(unavailable.detail(1), e => e instanceof ServiceUnavailableException && !e.message.includes('SQL'));
});
