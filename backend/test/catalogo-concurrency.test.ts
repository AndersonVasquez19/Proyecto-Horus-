import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CatalogoService } from '../src/catalogo/catalogo.service';

// Persistencia simulada: instantáneas independientes y exclusión por fila hasta finalizar la transacción.
// No sustituye la comprobación posterior de FOR UPDATE en MySQL desechable.
function fixture() {
  let row: Record<string, unknown> | null = { id: 1, tipo: 'capacitacion', modalidad: 'virtual', duracion: '10 h', titulo: 'Curso', updatedAt: new Date('2026-10-23T00:00:00Z') };
  let tail = Promise.resolve(), writes = 0;
  const model = {
    findFirst: async () => structuredClone(row),
    update: async ({ data }: { data: object }) => { writes++; row = { ...row, ...data }; return structuredClone(row); },
  };
  const prisma = { curso: model, $transaction: async (run: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
    assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.ReadCommitted);
    let release!: () => void;
    const previous = tail; tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await run({ curso: model, $queryRaw: async (parts: TemplateStringsArray, id: number) => {
      assert.match(parts.join('?'), /SELECT id FROM cursos WHERE id = \? FOR UPDATE/);
      assert.equal(id, 1); return row ? [{ id: 1 }] : [];
    } }); } finally { release(); }
  } };
  return { api: new CatalogoService(prisma as never), row: () => row, writes: () => writes, remove: () => { row = null; } };
}

test('Catálogo: cambiar tipo y limpiar modalidad simultáneamente no crea un curso inválido', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.api.update('cursos', 1, { tipo: 'curso' }), f.api.update('cursos', 1, { limpiar: ['modalidad', 'duracion'] })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ConflictException);
  assert.equal(f.writes(), 1);
  assert.ok(f.row()?.tipo !== 'curso' || (f.row()?.modalidad && f.row()?.duracion));
});

test('Catálogo: dos cambios simultáneos del mismo campo devuelven un 409 en vez de sobrescribirse', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.api.update('cursos', 1, { titulo: 'Primero' }), f.api.update('cursos', 1, { titulo: 'Segundo' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.some(result => result.status === 'rejected' && result.reason instanceof ConflictException));
  assert.equal(f.writes(), 1);
});

test('Catálogo: valida estados coherentes, conserva cambios secuenciales y rechaza cursos incompletos', async () => {
  const f = fixture();
  await f.api.update('cursos', 1, { limpiar: ['modalidad'] });
  await assert.rejects(f.api.update('cursos', 1, { tipo: 'curso' }), BadRequestException);
  await f.api.update('cursos', 1, { tipo: 'curso', modalidad: 'presencial' });
  assert.equal(f.row()?.tipo, 'curso');
  assert.equal(f.row()?.modalidad, 'presencial');
  assert.equal(f.row()?.duracion, '10 h');
  assert.equal(f.writes(), 2);
  f.remove(); await assert.rejects(f.api.update('cursos', 1, { titulo: 'Ausente' }), NotFoundException);
});
