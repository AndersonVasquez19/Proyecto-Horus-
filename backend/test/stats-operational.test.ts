import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { StatsService } from '../src/admin/stats/stats.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { CatalogoService } from '../src/catalogo/catalogo.service';

test('resumen operativo: cuenta datos académicos y estado efectivo de atención sin leer contenido editorial', async () => {
  const calls: unknown[] = [];
  const prisma = {
    estudiante: { count: async () => 12 },
    convocatoria: { count: async (q: unknown) => { calls.push(q); return 2; } },
    matricula: {
      count: async () => 7,
      groupBy: async (q: unknown) => { calls.push(q); return [{ estado: 'activa', _count: { _all: 5 } }, { estado: 'anulada', _count: { _all: 2 } }]; },
    },
    preinscripcion: { groupBy: async () => [], count: async () => 0 },
    certificado: { groupBy: async () => [], count: async () => 0 },
    $queryRaw: async (q: { sql: string }) => /COUNT\(\*\)/.test(q.sql)
      ? [{ total: 6, nuevo: 2, en_proceso: 1, atendido: 2, archivado: 1 }]
      : [{ id: 1, nombre: 'Prueba', asunto: 'Consulta', estado: 'en_proceso', createdAt: new Date('2026-10-19T12:00:00Z') }],
  } as unknown as PrismaService;
  const service = new StatsService({ stats: () => { throw new Error('No leer catálogo'); } } as unknown as CatalogoService, prisma);
  assert.equal(typeof service.getOperationalStats, 'function', 'falta la vista operativa');
  const result = await service.getOperationalStats();
  assert.deepEqual(result.stats.academico, { estudiantes: 12, edicionesActivas: 2, matriculasRegistradas: 7, matriculasVigentes: 5 });
  assert.deepEqual(result.stats.mensajes, { total: 6, nuevos: 2, enProceso: 1, atendidos: 2, archivados: 1, pendientes: 3 });
  assert.equal(result.actividadReciente.mensajes[0].estado, 'en_proceso');
  assert.equal('catalogo' in result.stats, false);
  assert.deepEqual(calls, [{ where: { estado: 'abierta', archivado_at: null } }, { by: ['estado'], _count: { _all: true } }]);
});

test('resumen operativo: una base vacía devuelve ceros confirmados y una lista vacía', async () => {
  const prisma = {
    estudiante: { count: async () => 0 }, convocatoria: { count: async () => 0 }, matricula: { groupBy: async () => [], count: async () => 0 },
    preinscripcion: { groupBy: async () => [], count: async () => 0 }, certificado: { groupBy: async () => [], count: async () => 0 },
    $queryRaw: async (q: { sql: string }) => /COUNT\(\*\)/.test(q.sql) ? [{ total: 0, nuevo: null, en_proceso: null, atendido: null, archivado: null }] : [],
  } as unknown as PrismaService;
  const service = new StatsService({} as CatalogoService, prisma);
  assert.equal(typeof service.getOperationalStats, 'function', 'falta la vista operativa');
  const result = await service.getOperationalStats();
  assert.deepEqual(result.stats.academico, { estudiantes: 0, edicionesActivas: 0, matriculasRegistradas: 0, matriculasVigentes: 0 });
  assert.equal(result.stats.mensajes.pendientes, 0);
  assert.deepEqual(result.actividadReciente.mensajes, []);
});
