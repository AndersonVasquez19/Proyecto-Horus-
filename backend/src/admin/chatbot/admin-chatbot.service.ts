import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { ListQueryDto } from '../../common/list-query.dto';
import { retentionCutoff } from '../../chatbot/chatbot-privacy';

const WINDOW_DAYS = 30;

// Solo lectura: preguntas que el chatbot no pudo responder y métricas de uso de los últimos 30 días.
@Injectable()
export class AdminChatbotService {
  constructor(private readonly prisma: PrismaService) {}

  async unanswered(query: ListQueryDto, now = new Date()) {
    const page = query.page ?? 1, limit = query.limit || 20;
    // Lo anterior al plazo de retención (90 días) no se muestra aunque la limpieza todavía no lo haya eliminado.
    const where = { updatedAt: { gte: retentionCutoff(now) }, ...(query.search ? { pregunta: { contains: query.search } } : {}) };
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const [items, total, groups] = await Promise.all([
      this.prisma.chatbotPreguntaSinRespuesta.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit,
        select: { id: true, pregunta: true, veces: true, createdAt: true, updatedAt: true } }),
      this.prisma.chatbotPreguntaSinRespuesta.count({ where }),
      this.prisma.chatbotInteraccion.groupBy({ by: ['modo', 'resuelta'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    ]);
    const sum = (filter: (group: { modo: string; resuelta: boolean }) => boolean) => groups.filter(filter).reduce((acc, group) => acc + group._count._all, 0);
    return {
      ok: true, items,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      metrics: { dias: WINDOW_DAYS, interacciones: sum(() => true), resueltas: sum(group => group.resuelta), sinRespuesta: sum(group => !group.resuelta),
        conIa: sum(group => group.modo === 'ia'), conCatalogo: sum(group => group.modo === 'catalogo') },
    };
  }
}
