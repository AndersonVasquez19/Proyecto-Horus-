import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createValidationPipe } from '../src/common/validation';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { AdminConveniosController } from '../src/convenios/convenios.controllers';
import { ConveniosService } from '../src/convenios/convenios.service';
import { CreateConvenioDto, UpdateConvenioDto, CreateConvenioFotoDto, ReorderConvenioFotosDto, ConveniosQueryDto } from '../src/convenios/convenios.dto';
import { PrismaService } from '../src/database/prisma.service';
import { initialConvenios } from '../src/convenios/initial-content';
const validate = (value: unknown, metatype: new () => object, type: 'body' | 'query' = 'body') =>
  createValidationPipe().transform(value, { type, metatype });

test('convenios validate required text, optional clearing, booleans, image URLs and nested order', async () => {
  const base = { nombre: 'Entidad de prueba', descripcion_corta: 'Descripción de prueba' };
  await validate(base, CreateConvenioDto);
  await validate({ sigla: '', logo_url: '', descripcion_completa: '', informacion_adicional: '', visible: false, orden: 0 }, UpdateConvenioDto);
  for (const value of [{ nombre: '' }, { descripcion_corta: null }, { sigla: null }, { visible: 'false' }, { orden: -1 }, { logo_url: 'javascript:alert(1)' }, { logo_url: 'ftp://example.com/a.png' }, { origen_local: 'fake' }])
    await assert.rejects(() => validate({ ...base, ...value }, CreateConvenioDto), BadRequestException);
  for (const field of ['nombre', 'sigla', 'logo_url', 'descripcion_corta', 'descripcion_completa', 'informacion_adicional', 'orden', 'visible'])
    await assert.rejects(() => validate({ [field]: null }, UpdateConvenioDto), BadRequestException);
  await validate({ imagen_url: 'https://example.com/photo.png', orden: 0 }, CreateConvenioFotoDto);
  await validate({ imagen_url: 'http://localhost:5173/api/uploads/test.png' }, CreateConvenioFotoDto);
  await assert.rejects(() => validate({ imagen_url: '' }, CreateConvenioFotoDto), BadRequestException);
  for (const fotos of [[], [{ id: 1, orden: -1 }], [{ id: '1', orden: 0 }], [{ id: 1, orden: 0 }, { id: 1, orden: 2 }], [null]])
    await assert.rejects(() => validate({ fotos }, ReorderConvenioFotosDto), BadRequestException);
  await validate({ fotos: [{ id: 1, orden: 2 }, { id: 2, orden: 1 }] }, ReorderConvenioFotosDto);
  assert.equal((await validate({ page: '2', limit: '6', estado: 'oculto' }, ConveniosQueryDto, 'query')).page, 2);
  await assert.rejects(() => validate({ limit: '101' }, ConveniosQueryDto, 'query'), BadRequestException);
});

test('all administrative convenio and photo operations retain JWT protection', () => {
  assert.ok(Reflect.getMetadata(GUARDS_METADATA, AdminConveniosController).includes(JwtAuthGuard));
});

test('empty and null updates are rejected before any database operation', async () => {
  const service = new ConveniosService({} as PrismaService);
  await assert.rejects(() => service.update(1, {}), BadRequestException);
  await assert.rejects(() => service.update(1, { sigla: null } as unknown as UpdateConvenioDto), BadRequestException);
  await assert.rejects(() => service.updateFoto(1, 1, {} as never), BadRequestException);
});

test('initial preview has exactly five existing entries, four logos and no invented detail or photos', async () => {
  assert.deepEqual(initialConvenios.map(row => row.sigla), ['CORLAD', 'CEC', 'CEP/CR XIII', 'CEP/CR II', 'ISAM']);
  assert.equal(new Set(initialConvenios.map(row => row.origen_local)).size, 5);
  assert.equal(new Set(initialConvenios.map(row => row.logoFile)).size, 4);
  assert.equal(initialConvenios[2].logoFile, initialConvenios[3].logoFile);
  for (const row of initialConvenios) {
    const { origen_local, logoFile, ...dto } = row;
    assert.ok(origen_local); assert.ok(logoFile);
    assert.equal(row.descripcion_completa, ''); assert.equal(row.informacion_adicional, '');
    await validate(dto, CreateConvenioDto);
  }
});
