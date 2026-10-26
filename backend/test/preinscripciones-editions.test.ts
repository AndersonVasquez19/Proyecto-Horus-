import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PreinscripcionesPublicService } from '../src/preinscripciones/preinscripciones-public.service';

function edition(id: number, full: boolean, planned = false) {
  return { id, codigo_publico: id.toString(16).padStart(32, '0'), nombre: 'Edición ' + id, estado: planned ? 'planificada' : 'abierta',
    fecha_inicio: new Date('2026-11-01T00:00:00Z'), fecha_fin: null, capacidad: 10,
    curso: { titulo: 'Curso', tipo: 'curso', modalidad: 'virtual', duracion: '10 h' }, _count: { matriculas: full ? 10 : 9 } };
}

async function listing(rows: ReturnType<typeof edition>[]) {
  let queries = 0;
  const api = new PreinscripcionesPublicService({ convocatoria: { findMany: async (args: { take: number; skip?: number; cursor?: { id: number }; where: unknown; orderBy: unknown }) => {
    queries++;
    assert.ok(queries <= rows.length + 2, 'la paginación debe avanzar');
    assert.ok(args.take > 0 && args.take <= 50, 'cada lectura está acotada');
    assert.deepEqual(args.where, { preinscripcion_estado: 'abierta', archivado_at: null, estado: { in: ['planificada', 'abierta'] }, codigo_publico: { not: null }, capacidad: { not: null }, curso: { estado: 'publicado' } });
    assert.deepEqual(args.orderBy, [{ fecha_inicio: 'asc' }, { id: 'asc' }]);
    const offset = args.cursor ? rows.findIndex(row => row.id === args.cursor!.id) + (args.skip ?? 0) : (args.skip ?? 0);
    return rows.slice(offset, offset + args.take);
  } } } as never);
  return { result: await api.editions(), queries };
}

test('Preinscripciones: 60 ediciones llenas no ocultan la disponible posterior', async () => {
  const { result } = await listing([...Array.from({ length: 60 }, (_, i) => edition(i + 1, true)), edition(61, false)]);
  assert.deepEqual(result.items.map(item => item.nombre), ['Edición 61']);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['apertura_confirmada', 'codigo', 'curso', 'fecha_fin', 'fecha_inicio', 'nombre']);
});

test('Preinscripciones: intercaladas mantienen el orden y el tope de 50 disponibles', async () => {
  const { result, queries } = await listing(Array.from({ length: 140 }, (_, i) => edition(i + 1, i % 2 === 0)));
  assert.equal(result.items.length, 50);
  assert.equal(result.items[0].nombre, 'Edición 2');
  assert.equal(result.items[49].nombre, 'Edición 100');
  assert.ok(queries <= 3, 'no hace una consulta por edición ni carga el resto tras llenar el resultado');
});

test('Preinscripciones: vacías, todas llenas y planificadas conservan la disponibilidad anterior', async () => {
  assert.deepEqual((await listing([])).result, { ok: true, items: [] });
  assert.deepEqual((await listing(Array.from({ length: 100 }, (_, i) => edition(i + 1, true)))).result.items, []);
  const { result } = await listing([edition(1, true), edition(2, true, true), edition(3, false)]);
  assert.deepEqual(result.items.map(item => item.nombre), ['Edición 2', 'Edición 3']);
  assert.equal(result.items[0].apertura_confirmada, false);
});
