import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { cleanQuestion, questionFingerprint, retentionCutoff } from './chatbot-privacy';

const PURGE_EVERY_MS = 3_600_000; // la limpieza se intenta como máximo una vez por hora y por instancia

export const PURGE_BATCH = 500;
export const PURGE_MAX_BATCHES = 200; // comando programado: hasta 100 000 filas por tabla y ejecución
const OPPORTUNISTIC_MAX_BATCHES = 4; // limpieza al registrar una interacción: acotada para no recargar la base en una petición pública
export type PurgeResult = { preguntas: number; interacciones: number; truncado: boolean; simulacion: boolean };

async function purgeInBatches(maxBatches: number, find: (take: number) => Promise<{ id: number }[]>, remove: (ids: number[]) => Promise<{ count: number }>) {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await find(PURGE_BATCH);
    if (!rows.length) return { deleted, truncated: false };
    deleted += (await remove(rows.map(row => row.id))).count;
    if (rows.length < PURGE_BATCH) return { deleted, truncated: false };
  }
  return { deleted, truncated: true };
}

export type ChatInteraction = { modo: 'ia' | 'catalogo'; resuelta: boolean; fuentes: number; pregunta?: string };

// Métricas del chatbot. Registrar NUNCA debe afectar la respuesta al visitante: todo error se traga y se deja una advertencia sin datos.
// Solo se guarda texto de las preguntas sin respuesta, siempre redactado (correos, teléfonos y enlaces) y deduplicado por huella.
@Injectable()
export class ChatbotMetricsService {
  private readonly logger = new Logger(ChatbotMetricsService.name);
  private lastPurge = 0;
  constructor(private readonly prisma: PrismaService) {}

  // Limpieza oportunista al registrar una interacción: nunca lanza ni retrasa la respuesta al visitante.
  async purgeExpired(now = new Date()): Promise<void> {
    try { await this.purgeExpiredBatches(now, { maxBatches: OPPORTUNISTIC_MAX_BATCHES }); }
    catch { this.logger.warn('Chatbot: no se pudo completar la limpieza por retención.'); }
  }

  // Elimina lo anterior a RETENTION_DAYS (90 días) SOLO de estas dos tablas: preguntas sin respuesta (desde su última aparición, `updatedAt`) y métricas (`createdAt`).
  // - Acotada: lotes de PURGE_BATCH filas y a lo sumo `maxBatches` lotes por tabla; si queda más, `truncado` es true y la siguiente ejecución continúa.
  // - Idempotente y segura de repetir/concurrente: cada lote borra por id y vuelve a comprobar la fecha, así que una pregunta que reapareció (su `updatedAt` se renovó) se conserva.
  // - Lanza ante un fallo de base de datos (el comando programado lo necesita para devolver un código de error). Con `dryRun` solo cuenta.
  async purgeExpiredBatches(now = new Date(), options: { dryRun?: boolean; maxBatches?: number } = {}): Promise<PurgeResult> {
    const cutoff = retentionCutoff(now), maxBatches = options.maxBatches ?? PURGE_MAX_BATCHES;
    if (options.dryRun) return {
      preguntas: await this.prisma.chatbotPreguntaSinRespuesta.count({ where: { updatedAt: { lt: cutoff } } }),
      interacciones: await this.prisma.chatbotInteraccion.count({ where: { createdAt: { lt: cutoff } } }),
      truncado: false, simulacion: true,
    };
    const preguntas = await purgeInBatches(maxBatches,
      take => this.prisma.chatbotPreguntaSinRespuesta.findMany({ where: { updatedAt: { lt: cutoff } }, select: { id: true }, orderBy: { id: 'asc' }, take }),
      ids => this.prisma.chatbotPreguntaSinRespuesta.deleteMany({ where: { id: { in: ids }, updatedAt: { lt: cutoff } } }));
    const interacciones = await purgeInBatches(maxBatches,
      take => this.prisma.chatbotInteraccion.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: { id: 'asc' }, take }),
      ids => this.prisma.chatbotInteraccion.deleteMany({ where: { id: { in: ids }, createdAt: { lt: cutoff } } }));
    return { preguntas: preguntas.deleted, interacciones: interacciones.deleted, truncado: preguntas.truncated || interacciones.truncated, simulacion: false };
  }

  async record(input: ChatInteraction): Promise<void> {
    try {
      await this.prisma.chatbotInteraccion.create({ data: { modo: input.modo, resuelta: input.resuelta, fuentes: input.fuentes } });
      if (!input.resuelta && input.pregunta) {
        const pregunta = cleanQuestion(input.pregunta);
        if (pregunta) {
          const huella = questionFingerprint(pregunta);
          await this.prisma.chatbotPreguntaSinRespuesta.upsert({ where: { huella }, create: { huella, pregunta }, update: { veces: { increment: 1 } } });
        }
      }
    } catch { this.logger.warn('Chatbot: no se pudieron registrar las métricas de interacción.'); }
    const now = Date.now();
    if (now - this.lastPurge >= PURGE_EVERY_MS) { this.lastPurge = now; await this.purgeExpired(new Date(now)); }
  }
}
