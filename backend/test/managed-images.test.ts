import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../src/common/validation';
import { CreateConvenioDto, CreateConvenioFotoDto, UpdateConvenioDto } from '../src/convenios/convenios.dto';
import { CreateCursoDto, CreateServicioDto } from '../src/catalogo/catalogo.dto';

test('las imágenes subidas aceptan rutas portables sin ampliar las rutas locales admitidas', async () => {
  const validate = (body: object, metatype: new () => object) => createValidationPipe().transform(body, { type: 'body', metatype });
  const prefix = '/api/uploads/00000000-0000-4000-8000-000000000000';
  for (const extension of ['png', 'jpg', 'webp']) {
    const url = prefix + '.' + extension;
    await validate({ nombre: 'Convenio global', descripcion_corta: 'Descripción global', logo_url: url }, CreateConvenioDto);
    await validate({ logo_url: url }, UpdateConvenioDto);
    await validate({ imagen_url: url }, CreateConvenioFotoDto);
    await validate({ titulo: 'Curso global', slug: 'curso-global', descripcion: 'Descripción global', tipo: 'curso', modalidad: 'virtual', duracion: '20 horas', imagen_url: url }, CreateCursoDto);
    await validate({ titulo: 'Servicio global', slug: 'servicio-global', descripcion: 'Descripción global', categoria: 'cableado', imagen_url: url }, CreateServicioDto);
  }
  for (const url of ['//example.com/image.png', '/api/uploads/../secret.png', '/api/uploads/%2e%2e.png', '/api/uploads/fake.png', prefix + '.svg', prefix + '.png?x=1', 'javascript:alert(1)', 'ftp://example.com/image.png']) {
    await assert.rejects(() => validate({ imagen_url: url }, CreateConvenioFotoDto), BadRequestException);
    await assert.rejects(() => validate({ titulo: 'Curso global', slug: 'curso-global', descripcion: 'Descripción global', tipo: 'curso', modalidad: 'virtual', duracion: '20 horas', imagen_url: url }, CreateCursoDto), BadRequestException);
  }
});
