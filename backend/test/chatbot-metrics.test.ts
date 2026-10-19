import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { PrismaService } from '../src/database/prisma.service';
import { ChatbotService } from '../src/chatbot/chatbot.service';
import { ChatbotMetricsService } from '../src/chatbot/chatbot-metrics.service';
import { ChatContactDto } from '../src/chatbot/chatbot.dto';
import { cleanQuestion, questionFingerprint, MAX_STORED_QUESTION, RETENTION_DAYS, retentionCutoff } from '../src/chatbot/chatbot-privacy';
import { AdminChatbotService } from '../src/admin/chatbot/admin-chatbot.service';

// Modelos simulados: ningún acceso a MySQL, ningún correo, ninguna llamada externa.
function metricsPrisma(options: { failInteractions?: boolean } = {}) {
  const interactions: Record<string, unknown>[] = [], questions = new Map<string, { huella: string; pregunta: string; veces: number }>();
  const prisma = {
    chatbotInteraccion: { create: async ({ data }: { data: Record<string, unknown> }) => { if (options.failInteractions) throw new Error('db caída ER_SECRET'); interactions.push(data); } },
    chatbotPreguntaSinRespuesta: { upsert: async ({ where, create, update }: { where: { huella: string }; create: { huella: string; pregunta: string }; update: { veces: { increment: number } } }) => {
      const row = questions.get(where.huella); if (row) row.veces += update.veces.increment; else questions.set(where.huella, { ...create, veces: 1 }); } },
  };
  return { prisma: prisma as unknown as PrismaService, interactions, questions };
}
const empty = { findMany: async () => [] };
const chatbotWith = (fixture: ReturnType<typeof metricsPrisma>, extra: Record<string, unknown> = {}) => {
  const prisma = { curso: empty, servicio: empty, preguntaFrecuente: empty, setting: empty, ...extra } as unknown as PrismaService;
  return new ChatbotService(prisma, new ConfigService(), new ChatbotMetricsService(fixture.prisma));
};
const settle = () => new Promise(resolve => setImmediate(resolve));

test('redacción: correos, teléfonos y enlaces se ocultan, el texto se acota y la huella ignora mayúsculas y tildes', () => {
  const cleaned = cleanQuestion('Escribe a ana.perez@example.com o al +51 987 654 321, mira https://sitio.test/x?token=abc\n\n  gracias');
  assert.equal(cleaned, 'Escribe a [correo oculto] o al [número oculto], mira [enlace oculto] gracias');
  assert.ok(!/@|987|https/.test(cleaned));
  assert.equal(cleanQuestion('x'.repeat(2000)).length, MAX_STORED_QUESTION);
  assert.equal(questionFingerprint('¿Cuánto   CUESTA?'), questionFingerprint('¿cuanto cuesta?'));
  assert.notEqual(questionFingerprint('a'), questionFingerprint('b'));
});

test('una pregunta sin fuentes se registra redactada y deduplicada; el visitante recibe la misma respuesta', async () => {
  const fixture = metricsPrisma(); const chat = chatbotWith(fixture);
  const first = await chat.reply({ message: 'Mi correo es ana@example.com ¿hacen drones?' });
  await settle();
  assert.equal(first.mode, 'catalogo'); assert.deepEqual(first.sources, []);
  assert.deepEqual(fixture.interactions, [{ modo: 'catalogo', resuelta: false, fuentes: 0 }]);
  assert.equal(fixture.questions.size, 1);
  const [stored] = [...fixture.questions.values()];
  assert.ok(!stored.pregunta.includes('ana@example.com') && stored.pregunta.includes('[correo oculto]'), 'sin datos personales');
  await chat.reply({ message: 'Mi correo es ana@example.com ¿hacen drones?' }); await settle();
  assert.equal(fixture.questions.size, 1, 'la misma pregunta no se duplica'); assert.equal([...fixture.questions.values()][0].veces, 2);
  assert.equal(fixture.interactions.length, 2);
});

test('una respuesta con fuentes cuenta como resuelta y no guarda texto; los saludos no se registran', async () => {
  const fixture = metricsPrisma();
  const chat = chatbotWith(fixture, { curso: { findMany: async () => [{ id: 1, titulo: 'Curso de redes', descripcion: 'Aprende redes', tipo: 'curso', modalidad: 'virtual', duracion: '10 h', fecha_inicio: null, temario: null }] } });
  const answer = await chat.reply({ message: 'curso de redes' }); await settle();
  assert.ok(answer.sources.length > 0);
  assert.deepEqual(fixture.interactions, [{ modo: 'catalogo', resuelta: true, fuentes: answer.sources.length }]);
  assert.equal(fixture.questions.size, 0, 'solo las preguntas sin respuesta guardan texto');
  await chat.reply({ message: 'hola' }); await settle();
  assert.equal(fixture.interactions.length, 1, 'un saludo no es una interacción medible');
});

test('si el registro de métricas falla, la respuesta al visitante no cambia ni se filtra el error', async () => {
  const fixture = metricsPrisma({ failInteractions: true }); const chat = chatbotWith(fixture);
  const answer = await chat.reply({ message: 'algo que no existe' }); await settle();
  assert.equal(answer.ok, true); assert.ok(!JSON.stringify(answer).includes('ER_SECRET'));
  const without = new ChatbotService({ curso: empty, servicio: empty, preguntaFrecuente: empty, setting: empty } as unknown as PrismaService, new ConfigService());
  assert.equal((await without.reply({ message: 'algo que no existe' })).ok, true, 'sin servicio de métricas (pruebas, otras instancias) también funciona');
});

test('solicitar cotización: se registra como Contacto con origen chatbot y marca de cotización; el contacto normal también', async () => {
  const created: Record<string, unknown>[] = [];
  const contacto = { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: created.length }; } };
  const chat = chatbotWith(metricsPrisma(), { contacto });
  const base = { nombre: 'Ana', email: 'ana@example.test', telefono: '987654321', asunto: 'Cámaras', mensaje: 'Necesito cotizar', consentimiento: true };
  await chat.contact(plainToInstance(ChatContactDto, { ...base, tipo: 'cotizacion' }));
  await chat.contact(plainToInstance(ChatContactDto, base));
  assert.equal(created[0].origen, 'chatbot'); assert.equal(created[0].asunto, '[Chatbot] [Cotización] Cámaras'); assert.equal(created[0].estado, 'nuevo');
  assert.equal(created[1].origen, 'chatbot'); assert.equal(created[1].asunto, '[Chatbot] Cámaras');
  assert.deepEqual(validateSync(plainToInstance(ChatContactDto, { ...base, tipo: 'otro' })).map(e => e.property), ['tipo'], 'el tipo solo admite contacto o cotizacion');
  assert.deepEqual(validateSync(plainToInstance(ChatContactDto, { ...base, consentimiento: false })).map(e => e.property), ['consentimiento'], 'el consentimiento sigue siendo obligatorio');
});

test('vista administrativa: solo lectura, paginada, con filtro y métricas de 30 días', async () => {
  const calls: string[] = [];
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, pregunta: i % 2 ? 'precio de drones' : 'otra cosa ' + i, veces: i + 1, createdAt: new Date(), updatedAt: new Date() }));
  const prisma = {
    chatbotPreguntaSinRespuesta: {
      findMany: async (args: { where: { pregunta?: { contains: string } }; skip: number; take: number }) => { calls.push('findMany'); return rows.filter(r => !args.where.pregunta || r.pregunta.includes(args.where.pregunta.contains)).slice(args.skip, args.skip + args.take); },
      count: async (args: { where: { pregunta?: { contains: string } } }) => { calls.push('count'); return rows.filter(r => !args.where.pregunta || r.pregunta.includes(args.where.pregunta.contains)).length; },
    },
    chatbotInteraccion: { groupBy: async (args: { where: { createdAt: { gte: Date } } }) => { calls.push('groupBy'); assert.ok(args.where.createdAt.gte instanceof Date);
      return [{ modo: 'ia', resuelta: true, _count: { _all: 3 } }, { modo: 'catalogo', resuelta: true, _count: { _all: 4 } }, { modo: 'catalogo', resuelta: false, _count: { _all: 2 } }]; } },
  };
  const service = new AdminChatbotService(prisma as unknown as PrismaService);
  const page = await service.unanswered({ page: 2, limit: 2 });
  assert.deepEqual(page.items.map(r => r.id), [3, 4]); assert.deepEqual(page.pagination, { total: 5, page: 2, limit: 2, pages: 3 });
  assert.deepEqual(page.metrics, { dias: 30, interacciones: 9, resueltas: 7, sinRespuesta: 2, conIa: 3, conCatalogo: 6 });
  assert.deepEqual((await service.unanswered({ search: 'drones' })).items.map(r => r.id), [2, 4]);
  assert.ok(calls.every(call => ['findMany', 'count', 'groupBy'].includes(call)), 'ninguna escritura');
  assert.equal(Object.keys(prisma.chatbotPreguntaSinRespuesta).some(key => /create|update|delete|upsert/.test(key)), false);
});

test('redacción ampliada: teléfonos con punto o barra, fechas y direcciones web sin esquema; el nombre propio NO se detecta (limitación conocida)', () => {
  assert.equal(cleanQuestion('llámame al 987.654.321 o al 987/654/321'), 'llámame al [número oculto] o al [número oculto]');
  assert.equal(cleanQuestion('nacida el 12/03/1990'), 'nacida el [número oculto]');
  assert.equal(cleanQuestion('mira www.miweb.com/privado y https://x.test/a'), 'mira [enlace oculto] y [enlace oculto]');
  // Límites reales de la redacción automática: no puede saber qué es un nombre o una dirección. Por eso el texto guardado puede contener datos personales.
  assert.equal(cleanQuestion('Soy Juan Pérez Quispe, vivo en Jr. Amazonas 345'), 'Soy Juan Pérez Quispe, vivo en Jr. Amazonas 345');
  assert.equal(cleanQuestion('ana arroba gmail punto com'), 'ana arroba gmail punto com');
});

test('retención de 90 días: la limpieza elimina lo anterior al plazo, se intenta como máximo una vez por hora y nunca rompe el registro', async () => {
  const deletes: { tabla: string; where: Record<string, { lt: Date }> }[] = [];
  const prisma = {
    chatbotInteraccion: { create: async () => ({}), findMany: async () => [{ id: 1 }], deleteMany: async ({ where }: { where: Record<string, { lt: Date }> }) => { deletes.push({ tabla: 'interacciones', where }); return { count: 1 }; } },
    chatbotPreguntaSinRespuesta: { upsert: async () => ({}), findMany: async () => [{ id: 1 }], deleteMany: async ({ where }: { where: Record<string, { lt: Date }> }) => { deletes.push({ tabla: 'preguntas', where }); return { count: 1 }; } },
  } as unknown as PrismaService;
  const metrics = new ChatbotMetricsService(prisma);
  const now = new Date('2026-10-09T12:00:00.000Z');
  await metrics.purgeExpired(now);
  const cutoff = new Date('2026-07-11T12:00:00.000Z'); // 90 días antes
  assert.equal(RETENTION_DAYS, 90); assert.equal(retentionCutoff(now).getTime(), cutoff.getTime());
  assert.deepEqual(deletes.map(d => { const field = Object.keys(d.where).find(key => key !== 'id')!; return [d.tabla, field, d.where[field].lt.getTime()]; }), [['preguntas', 'updatedAt', cutoff.getTime()], ['interacciones', 'createdAt', cutoff.getTime()]]);
  deletes.length = 0;
  await metrics.record({ modo: 'catalogo', resuelta: true, fuentes: 1 }); await metrics.record({ modo: 'catalogo', resuelta: true, fuentes: 1 });
  assert.equal(deletes.length, 2, 'dos registros seguidos disparan una sola limpieza (una por tabla)');
  // Si la limpieza falla, el registro y la respuesta siguen funcionando.
  const failing = new ChatbotMetricsService({ chatbotInteraccion: { create: async () => ({}), findMany: async () => { throw new Error('ER_SECRET'); } }, chatbotPreguntaSinRespuesta: { upsert: async () => ({}), findMany: async () => { throw new Error('ER_SECRET'); } } } as unknown as PrismaService);
  await assert.doesNotReject(() => failing.record({ modo: 'ia', resuelta: true, fuentes: 2 }));
});

test('vista administrativa: no muestra preguntas anteriores al plazo de retención aunque la limpieza aún no las haya eliminado', async () => {
  const wheres: { updatedAt: { gte: Date } }[] = [];
  const prisma = {
    chatbotPreguntaSinRespuesta: { findMany: async ({ where }: { where: { updatedAt: { gte: Date } } }) => { wheres.push(where); return []; }, count: async () => 0 },
    chatbotInteraccion: { groupBy: async () => [] },
  };
  const now = new Date('2026-10-09T12:00:00.000Z');
  await new AdminChatbotService(prisma as unknown as PrismaService).unanswered({ page: 1, limit: 20, search: 'x' }, now);
  assert.equal(wheres[0].updatedAt.gte.getTime(), retentionCutoff(now).getTime());
});
