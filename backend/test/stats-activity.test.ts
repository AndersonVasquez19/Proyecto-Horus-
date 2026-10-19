import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import type { CatalogoService } from '../src/catalogo/catalogo.service';
import { StatsService } from '../src/admin/stats/stats.service';
import { ActivityQueryDto } from '../src/admin/stats/activity-query.dto';

function service(rows: unknown[], groups: { estado: string; _count: { _all: number } }[] = []) {
  const queries: Prisma.Sql[] = [];
  const prisma = {
    $queryRaw: async (query: Prisma.Sql) => { queries.push(query); return rows; },
    cotizacion: { groupBy: async () => groups },
  } as unknown as PrismaService;
  return { queries, stats: new StatsService({} as CatalogoService, prisma) };
}

test('Actividad: serie diaria completa, con ceros en los días sin mensajes', async () => {
  const f = service([{ dia: '2026-10-08', total: 3n, chatbot: 1n }, { dia: '2026-10-09', total: 2, chatbot: null }]);
  const result = await f.stats.getActivity(7, new Date('2026-10-09T15:00:00Z'));
  assert.equal(result.mensajes.length, 7);
  assert.equal(result.desde, '2026-10-03');
  assert.equal(result.hasta, '2026-10-09');
  assert.deepEqual(result.mensajes.slice(-3), [{ fecha: '2026-10-07', total: 0, chatbot: 0 }, { fecha: '2026-10-08', total: 3, chatbot: 1 }, { fecha: '2026-10-09', total: 2, chatbot: 0 }]);
  assert.match(f.queries[0].sql, /^\s*SELECT/i, 'solo lectura');
});

test('Actividad: los días son de Perú, el canal sale de origen y el filtro empieza a medianoche de Lima', async () => {
  const f = service([]);
  const result = await f.stats.getActivity(7, new Date('2026-10-09T03:00:00Z')); // 22:00 del 8 de octubre en Lima
  assert.equal(result.hasta, '2026-10-08');
  assert.equal(result.desde, '2026-10-02');
  const { sql, values } = f.queries[0];
  assert.match(sql, /origen\s*=\s*\?/);
  assert.doesNotMatch(sql, /asunto/i);
  assert.ok(values.some(value => value instanceof Date && value.toISOString() === '2026-10-02T05:00:00.000Z'), 'desde = 00:00 de Lima en UTC');
});

test('Actividad: cotizaciones por estado conservan todos los estados y el total', async () => {
  const f = service([], [{ estado: 'enviada', _count: { _all: 2 } }, { estado: 'aceptada', _count: { _all: 1 } }]);
  const result = await f.stats.getActivity(30, new Date('2026-10-09T00:00:00Z'));
  assert.deepEqual(result.cotizaciones, { total: 3, porEstado: { borrador: 0, enviada: 2, aceptada: 1, rechazada: 0, anulada: 0 } });
  assert.equal(result.mensajes.every(day => day.total === 0), true, 'sin datos no se inventan mensajes');
});

test('Actividad: el parámetro dias solo admite 7, 30 o 90', async () => {
  const check = (dias?: string) => validate(plainToInstance(ActivityQueryDto, dias === undefined ? {} : { dias }), { whitelist: true, forbidNonWhitelisted: true });
  for (const ok of [undefined, '7', '30', '90']) assert.equal((await check(ok)).length, 0, String(ok));
  for (const bad of ['0', '-1', '15', '9999', 'abc', '30.5', '']) assert.ok((await check(bad)).length > 0, bad);
});
