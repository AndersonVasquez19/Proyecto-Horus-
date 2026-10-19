import 'reflect-metadata';
import { createValidationPipe } from '../src/common/validation';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { CatalogoService } from '../src/catalogo/catalogo.service';
import { CatalogoQueryDto, CreateCursoDto, UpdateCursoDto, CreatePreguntaFrecuenteDto, CreateServicioDto, UpdateServicioDto } from '../src/catalogo/catalogo.dto';
import { AdminCursoController, AdminServicioController, AdminPreguntaFrecuenteController } from '../src/catalogo/catalogo.controllers';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { AuthController } from '../src/admin/auth/auth.controller';
import { GaleriaService } from '../src/galeria/galeria.service';

const pipe = createValidationPipe();
const validate = (value: unknown, metatype: any) => pipe.transform(value, { type: 'body', metatype });
function service(model: object) { return new CatalogoService({ curso: model, servicio: model, preguntaFrecuente: model } as any); }

test('public list cannot reveal drafts through the estado query', async () => {
  let options: any;
  const api = service({ findMany: async (input: any) => { options = input; return []; }, count: async () => 0 });
  const result = await api.list('cursos', { page: 2, limit: 10, estado: 'borrador' }, true);
  assert.equal(options.where.estado, 'publicado');
  assert.equal(options.skip, 10);
  assert.equal(result.pagination.total, 0);
  assert.deepEqual(result.items, []);
});

test('public detail filters publication and responds 404 for missing content', async () => {
  const api = service({ findFirst: async ({ where }: any) => {
    assert.deepEqual(where, { id: 7, estado: 'publicado' });
    return null;
  } });
  await assert.rejects(() => api.detail('servicios', 7, true), NotFoundException);
});

test('admin detail can access drafts', async () => {
  const api = service({ findFirst: async ({ where }: any) => {
    assert.deepEqual(where, { id: 7 });
    return { id: 7, estado: 'borrador' };
  } });
  assert.equal((await api.detail('cursos', 7)).item.estado, 'borrador');
});

test('pagination rejects zero, negative, non-integer and excessive limits', async () => {
  for (const value of [0, -1, 1.5, 101, 'abc', null]) {
    await assert.rejects(() => validate({ limit: value }, CatalogoQueryDto));
  }
  const dto = await validate({ page: '2', limit: '10' }, CatalogoQueryDto);
  assert.equal(dto.page, 2);
  assert.equal(dto.limit, 10);
});

test('course validation rejects whitespace, unknown fields, invalid dates and null updates', async () => {
  const valid = { titulo: 'Curso de redes', slug: 'curso-redes', descripcion: 'Descripción del curso', tipo: 'curso', modalidad: 'virtual', duracion: '20 horas' };
  await validate(valid, CreateCursoDto);
  for (const extra of [{ titulo: '   ' }, { fecha_inicio: '2026-02-30' }, { role: 'admin' }, { imagen_url: 'javascript:alert(1)' }]) {
    await assert.rejects(() => validate({ ...valid, ...extra }, CreateCursoDto));
  }
  await assert.rejects(() => validate({ titulo: null }, UpdateCursoDto));
  await assert.rejects(() => validate({ estado: 'activo' }, UpdateCursoDto));
});

test('FAQ requires a real question and answer', async () => {
  await assert.rejects(() => validate({ pregunta: 'Dónde', respuesta: ' ', categoria: 'general' }, CreatePreguntaFrecuenteDto));
});

test('archive preserves record and changes state', async () => {
  let updates: any;
  const item = { id: 4 };
  await service({ findFirst: async () => item, update: async ({ data }: any) => { updates = data; return { ...item, ...data }; } }).archive('cursos', 4);
  assert.deepEqual(updates, { estado: 'archivado' });
});

test('duplicate slugs become HTTP 409 and empty updates are rejected', async () => {
  const api = service({ create: async () => { throw new PrismaClientKnownRequestError('Duplicate', { code: 'P2002', clientVersion: '6.19.0' }); } });
  await assert.rejects(() => api.create('cursos', { slug: 'duplicado' }), ConflictException);
  await assert.rejects(() => api.update('cursos', 1, {}), BadRequestException);
});

test('administrative content and current account require JWT', () => {
  for (const controller of [AdminCursoController, AdminServicioController, AdminPreguntaFrecuenteController]) {
    assert.ok(Reflect.getMetadata(GUARDS_METADATA, controller).includes(JwtAuthGuard));
  }
  assert.ok(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.me).includes(JwtAuthGuard));
});

test('gallery public detail excludes inactive entries', async () => {
  const gallery = new GaleriaService({ galeriaItem: { findFirst: async ({ where }: any) => {
    assert.deepEqual(where, { id: 2, activo: true });
    return null;
  } } } as any);
  await assert.rejects(() => gallery.findOne(2, true), NotFoundException);
});

test('catalog stats return database counts, including zero', async () => {
  const api = service({ count: async (options: any) => options?.where?.estado === 'publicado' ? 2 : options ? 0 : 2 });
  const stats = await api.stats();
  const { por_tipo, ...general } = stats.cursos as any;
  assert.deepEqual(general, { total: 2, publicados: 2, borradores: 0, archivados: 0 });
  assert.deepEqual(Object.keys(por_tipo), ['curso', 'capacitacion']);
  assert.deepEqual(Object.keys(por_tipo.capacitacion), ['total', 'publicados', 'borradores', 'archivados']);
});
test('only services are deleted for real while FAQs can only be archived', async () => {
  let deleted: any;
  const item = { id: 9 };
  const api = service({ findFirst: async () => item, delete: async (args: any) => { deleted = args; return item; } });
  const result = await api.remove('servicios', 9);
  assert.deepEqual(deleted, { where: { id: 9 } });
  assert.equal(result.ok, true);
  await assert.rejects(() => api.remove('preguntas-frecuentes', 9), BadRequestException);
  await assert.rejects(() => service({ findFirst: async () => null }).remove('servicios', 1), NotFoundException);
});

test('a service removed by another request while deleting answers 404', async () => {
  const api = service({
    findFirst: async () => ({ id: 3 }),
    delete: async () => { throw new PrismaClientKnownRequestError('Missing', { code: 'P2025', clientVersion: '6.19.0' }); },
  });
  await assert.rejects(() => api.remove('servicios', 3), NotFoundException);
});

test('course conservation blocks direct service and controller deletion in every state without writes', async () => {
  for (const tipo of ['curso', 'capacitacion']) for (const estado of ['borrador', 'publicado', 'archivado']) {
    const item = { id: 7, tipo, estado, slug: 'conservar-' + tipo, titulo: 'Conservar', imagen_url: '/api/uploads/conservar.png', temario: 'Contenido histórico' };
    const before = structuredClone(item);
    const api = service({
      findFirst: async () => item,
      delete: async () => assert.fail('DELETE must not reach persistence'),
      update: async () => assert.fail('Blocked DELETE must not archive or change content'),
    });
    for (const remove of [() => api.remove('cursos', item.id), () => new AdminCursoController(api).remove(item.id)]) {
      await assert.rejects(remove, (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.getStatus(), 409);
        assert.match(JSON.stringify(error.getResponse()), /Editar/);
        return true;
      });
      assert.deepEqual(item, before);
    }
  }
  await assert.rejects(() => service({ findFirst: async () => null }).remove('cursos', 2147483647), NotFoundException);
});

test('administrative DELETE of a service removes it instead of archiving it', async () => {
  const calls: string[] = [];
  const controller = new AdminServicioController({ remove: async (resource: string, id: number) => { calls.push('remove:' + resource + ':' + id); return { ok: true }; },
    archive: async () => { calls.push('archive'); return { ok: true }; } } as any);
  await controller.remove(5);
  assert.deepEqual(calls, ['remove:servicios:5']);
});

test('administrative DELETE of a FAQ still archives without physical deletion', async () => {
  const item = { id: 5, pregunta: 'Pregunta conservada', respuesta: 'Respuesta', estado: 'publicado' };
  const api = service({
    findFirst: async () => item,
    update: async ({ data }: { data: object }) => ({ ...item, ...data }),
    delete: async () => assert.fail('FAQ must never reach physical deletion'),
  });
  const result = await new AdminPreguntaFrecuenteController(api).archive(5);
  assert.deepEqual(result.item, { ...item, estado: 'archivado' });
});

test('a slug conflict tells which record already uses it', async () => {
  const duplicate = () => new PrismaClientKnownRequestError('Duplicate', { code: 'P2002', clientVersion: '6.19.0' });
  let lookup: any;
  const api = service({
    create: async () => { throw duplicate(); },
    update: async () => { throw duplicate(); },
    findFirst: async (args: any) => { lookup = args; return args.where.NOT ? { id: 8, titulo: 'Categoria 3', estado: 'publicado' } : args.where.id ? { id: 2 } : { id: 8, titulo: 'Categoria 3', estado: 'publicado' }; },
  });
  await assert.rejects(() => api.create('servicios', { slug: 'categoria-3', titulo: 'Otra' }), (error: any) => {
    assert.ok(error instanceof ConflictException);
    assert.match((error.getResponse() as any).mensaje, /«Categoria 3» \(publicado\).*«categoria-3»/);
    return true;
  });
  assert.deepEqual(lookup.where, { slug: 'categoria-3' });
  await assert.rejects(() => api.update('servicios', 2, { slug: 'categoria-3' }), (error: any) => {
    assert.match((error.getResponse() as any).mensaje, /«Categoria 3»/);
    return true;
  });
  assert.deepEqual(lookup.where, { slug: 'categoria-3', NOT: { id: 2 } });
});

test('service sections can filter by one or several categories and reject unknown ones', async () => {
  const wheres: any[] = [];
  const api = service({ findMany: async (input: any) => { wheres.push(input.where); return []; }, count: async () => 0 });
  await api.list('servicios', { page: 1, limit: 8, categoria: 'cableado' });
  await api.list('servicios', { page: 1, limit: 8, categoria: 'cableado,camaras' });
  assert.equal(wheres[0].categoria, 'cableado');
  assert.deepEqual(wheres[1].categoria, { in: ['cableado', 'camaras'] });
  await assert.rejects(() => api.list('servicios', { page: 1, limit: 8, categoria: 'cableado,inventada' }), BadRequestException);
});

test('course agenda metrics follow the selected type', async () => {
  const wheres: any[] = [];
  const api = service({ findMany: async () => [], count: async (input: any) => { wheres.push(input.where); return 0; } });
  await api.list('cursos', { page: 1, limit: 20, periodo: 'upcoming', tipo: 'capacitacion' });
  assert.ok(wheres.length >= 4);
  assert.ok(wheres.every(where => where.tipo === 'capacitacion'));
});

test('service categories no longer include "otros"', async () => {
  const valid = { titulo: 'Servicio', slug: 'servicio', descripcion: 'Descripción del servicio', categoria: 'cableado' };
  for (const categoria of ['cableado', 'camaras', 'soporte', 'asesoramiento']) await validate({ ...valid, categoria }, CreateServicioDto);
  await assert.rejects(() => validate({ ...valid, categoria: 'otros' }, CreateServicioDto));
  await assert.rejects(() => validate({ categoria: 'otros' }, UpdateServicioDto));
  const api = service({ findMany: async () => [], count: async () => 0 });
  await assert.rejects(() => api.list('servicios', { page: 1, limit: 8, categoria: 'otros' }), BadRequestException);
  await assert.rejects(() => api.list('servicios', { page: 1, limit: 8, categoria: 'cableado,otros' }), BadRequestException);
});
