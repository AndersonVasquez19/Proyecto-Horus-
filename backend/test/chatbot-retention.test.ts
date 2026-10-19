import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../src/database/prisma.service';
import { ChatbotMetricsService, PURGE_BATCH } from '../src/chatbot/chatbot-metrics.service';
import { RETENTION_DAYS, retentionCutoff } from '../src/chatbot/chatbot-privacy';

// Solo existen los dos modelos del chatbot: cualquier acceso a contactos, cotizaciones, reclamaciones o seguimientos fallaría. Sin MySQL.
const NOW = new Date('2026-10-10T12:00:00.000Z'), DAY = 86_400_000;
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY - extraMs);
type Row = { id: number; updatedAt?: Date | null; createdAt?: Date | null };
function model(rows: Row[], field: 'updatedAt' | 'createdAt', hooks: { beforeDelete?: () => void } = {}) {
  const matches = (row: Row, where: any) => (where.id?.in ? where.id.in.includes(row.id) : true) && (!where[field] || (row[field] instanceof Date && row[field]!.getTime() < where[field].lt.getTime()));
  return {
    findMany: async ({ where, take }: any) => rows.filter(row => matches(row, where)).sort((a, b) => a.id - b.id).slice(0, take).map(row => ({ id: row.id })),
    count: async ({ where }: any) => rows.filter(row => matches(row, where)).length,
    deleteMany: async ({ where }: any) => { hooks.beforeDelete?.(); const hit = rows.filter(row => matches(row, where)); for (const row of hit) rows.splice(rows.indexOf(row), 1); return { count: hit.length }; },
  };
}
function fixture(questions: Row[], interactions: Row[], hooks = {}) {
  const prisma = { chatbotPreguntaSinRespuesta: model(questions, 'updatedAt', hooks), chatbotInteraccion: model(interactions, 'createdAt') } as unknown as PrismaService;
  return new ChatbotMetricsService(prisma);
}

test('retención: el plazo documentado es de 90 días y el límite es exacto', () => {
  assert.equal(RETENTION_DAYS, 90);
  assert.equal(retentionCutoff(NOW).getTime(), ago(90).getTime());
  // El comando programado no puede divergir de la política: el CLI usa el mismo servicio compilado, sin constante propia.
  assert.ok(!/RETENTION|\b90\b/.test(readFileSync(join(__dirname, '../scripts/purge-chatbot.cjs'), 'utf8').replace(/\/\/.*$/gm, '')), 'el script no define su propio plazo');
});

test('retención: elimina lo vencido y conserva lo reciente, el límite exacto y los valores nulos', async () => {
  const questions: Row[] = [{ id: 1, updatedAt: ago(91) }, { id: 2, updatedAt: ago(90, 1) }, { id: 3, updatedAt: ago(90) }, { id: 4, updatedAt: ago(89) }, { id: 5, updatedAt: null }, { id: 6, updatedAt: NOW }];
  const interactions: Row[] = [{ id: 1, createdAt: ago(365) }, { id: 2, createdAt: ago(90) }, { id: 3, createdAt: ago(1) }, { id: 4, createdAt: null }];
  const result = await fixture(questions, interactions).purgeExpiredBatches(NOW);
  assert.deepEqual(result, { preguntas: 2, interacciones: 1, truncado: false, simulacion: false });
  assert.deepEqual(questions.map(row => row.id), [3, 4, 5, 6], 'exactamente 90 días se conserva (comparación estricta); nulos nunca coinciden');
  assert.deepEqual(interactions.map(row => row.id), [2, 3, 4]);
});

test('retención: repetirla no borra nada más (idempotente) y la simulación no escribe', async () => {
  const questions: Row[] = [{ id: 1, updatedAt: ago(200) }, { id: 2, updatedAt: ago(5) }], interactions: Row[] = [{ id: 1, createdAt: ago(200) }];
  const service = fixture(questions, interactions);
  assert.deepEqual(await service.purgeExpiredBatches(NOW, { dryRun: true }), { preguntas: 1, interacciones: 1, truncado: false, simulacion: true });
  assert.equal(questions.length, 2); assert.equal(interactions.length, 1, 'dry-run no borra');
  assert.equal((await service.purgeExpiredBatches(NOW)).preguntas, 1);
  assert.deepEqual(await service.purgeExpiredBatches(NOW), { preguntas: 0, interacciones: 0, truncado: false, simulacion: false });
  assert.deepEqual(questions.map(row => row.id), [2]);
});

test('retención: trabaja por lotes acotados y avisa cuando queda más por limpiar', async () => {
  const total = PURGE_BATCH * 2 + 10;
  const questions: Row[] = Array.from({ length: total }, (_, i) => ({ id: i + 1, updatedAt: ago(120) })); const interactions: Row[] = [];
  const service = fixture(questions, interactions);
  const first = await service.purgeExpiredBatches(NOW, { maxBatches: 2 });
  assert.equal(first.preguntas, PURGE_BATCH * 2); assert.equal(first.truncado, true); assert.equal(questions.length, 10);
  const second = await service.purgeExpiredBatches(NOW, { maxBatches: 2 });
  assert.equal(second.preguntas, 10); assert.equal(second.truncado, false); assert.equal(questions.length, 0);
});

test('retención: una pregunta que reaparece entre la lectura y el borrado se conserva', async () => {
  const questions: Row[] = [{ id: 1, updatedAt: ago(100) }, { id: 2, updatedAt: ago(100) }];
  const service = fixture(questions, [], { beforeDelete: () => { questions[0].updatedAt = NOW; } }); // otra instancia la vuelve a registrar
  const result = await service.purgeExpiredBatches(NOW);
  assert.equal(result.preguntas, 1); assert.deepEqual(questions.map(row => row.id), [1]);
});

test('retención: un fallo de base de datos lo lanza el comando programado pero nunca afecta a la limpieza oportunista', async () => {
  const broken = { chatbotPreguntaSinRespuesta: { findMany: async () => { throw new Error('ER_SECRET db caída'); } }, chatbotInteraccion: {} } as unknown as PrismaService;
  const service = new ChatbotMetricsService(broken);
  await assert.rejects(() => service.purgeExpiredBatches(NOW), /db caída/);
  await assert.doesNotReject(() => service.purgeExpired(NOW));
});
