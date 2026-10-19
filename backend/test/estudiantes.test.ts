import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { createValidationPipe } from '../src/common/validation';
import { ArchivoEstudianteDto, CreateEstudianteDto, EstudiantesQueryDto, UpdateEstudianteDto } from '../src/estudiantes/estudiantes.dto';
import { EstudiantesService } from '../src/estudiantes/estudiantes.service';
import { PrismaService } from '../src/database/prisma.service';

const validate = (body: unknown, metatype: typeof CreateEstudianteDto | typeof UpdateEstudianteDto | typeof ArchivoEstudianteDto | typeof EstudiantesQueryDto, type: 'body' | 'query' = 'body') => createValidationPipe().transform(body, { type, metatype });
const valid = { nombres: 'Ana', apellidos: 'Pérez', doc_numero: '00123456' };

test('Estudiantes: validación HTTP normaliza contacto, exige nombres y DNI y rechaza campos ajenos', async () => {
  const dto = await validate({ ...valid, nombres: ' Ana ', email: ' ANA@example.test ' }, CreateEstudianteDto);
  assert.equal(dto.nombres, 'Ana'); assert.equal(dto.email, 'ana@example.test'); assert.equal(dto.doc_numero, '00123456');
  for (const patch of [ { nombres: '' }, { apellidos: null }, { doc_numero: 12345678 }, { doc_numero: '12345678\n' }, { doc_numero: '１２３４５６７８' }, { email: null }, { telefono: null }, { telefono: 'abc' }, { archivado_at: '2026-01-01' } ]) await assert.rejects(validate({ ...valid, ...patch }, CreateEstudianteDto), BadRequestException);
  await validate({ ...valid, email: '', telefono: '' }, CreateEstudianteDto);
  await validate({ ...valid, nombres: 'A', apellidos: 'B', telefono: '1' }, CreateEstudianteDto);
});

test('Estudiantes: revisión obligatoria, campos opcionales no aceptan null y archivo exige booleano real', async () => {
  await validate({ revision: 1, email: '', telefono: '' }, UpdateEstudianteDto);
  for (const body of [{ nombres: 'Otro' }, { revision: '1' }, { revision: 0 }, { revision: 1, email: null }, { revision: 1, apellidos: '' }, { revision: 1, doc_pais: 'PE' }]) await assert.rejects(validate(body, UpdateEstudianteDto), BadRequestException);
  for (const archivado of ['true', 1, null]) await assert.rejects(validate({ revision: 1, archivado }, ArchivoEstudianteDto), BadRequestException);
  await validate({ revision: 1, archivado: false }, ArchivoEstudianteDto);
});

test('Estudiantes: siempre pagina y limita consultas inválidas', async () => {
  const q = await validate({}, EstudiantesQueryDto, 'query');
  assert.equal(q.page, 1); assert.equal(q.limit, 20); assert.equal(q.estado, 'activos');
  for (const body of [{ page: '0' }, { limit: '101' }, { estado: 'publicado' }, { search: 'a'.repeat(101) }, { q: 'x' }]) await assert.rejects(validate(body, EstudiantesQueryDto, 'query'), BadRequestException);
});

test('Estudiantes: no permite PUT solo con revisión', () => {
  const service = new EstudiantesService({} as PrismaService);
  assert.throws(() => service.update(1, { revision: 1 }), BadRequestException);
});

test('Estudiantes: traduce unicidad y estructura incompleta sin exponer SQL', async () => {
  for (const [code, expected] of [['P2002', ConflictException], ['P2021', ServiceUnavailableException], ['P2022', ServiceUnavailableException]] as const) {
    const error = new PrismaClientKnownRequestError('Detalle SQL privado de prueba', { code, clientVersion: '6.19.3' });
    const prisma = { estudiante: { create: async () => { throw error; } } } as unknown as PrismaService;
    await assert.rejects(new EstudiantesService(prisma).create(valid), err => err instanceof expected && !err.message.includes('SQL privado'));
  }
});
