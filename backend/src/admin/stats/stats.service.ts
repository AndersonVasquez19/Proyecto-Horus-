import { CatalogoService } from '../../catalogo/catalogo.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { messageTotals, recentMessages } from '../../attention/message-state';

const LIMA_OFFSET_HOURS = 5;

@Injectable()
export class StatsService {
  constructor(
    private readonly catalogoService: CatalogoService,
    private readonly prisma: PrismaService,
  ) {}

  async getDashboardStats() {
    const [
      mensajes,
      totalReclamaciones,
      totalReclamos,
      totalQuejas,
      totalItems,
      itemsActivos,
      itemsInactivos,
      totalAdmins,
      ultimosMensajes,
      ultimasReclamaciones,
    ] = await Promise.all([
      messageTotals(this.prisma),
      this.prisma.reclamacion.count(),
      this.prisma.reclamacion.count({ where: { tipo_registro: 'reclamo' } }),
      this.prisma.reclamacion.count({ where: { tipo_registro: 'queja' } }),
      this.prisma.adminItem.count(),
      this.prisma.adminItem.count({ where: { estado: 'activo' } }),
      this.prisma.adminItem.count({ where: { estado: 'inactivo' } }),
      this.prisma.adminUser.count(),
      recentMessages(this.prisma),
      this.prisma.reclamacion.findMany({
        take: 5,
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true, numero_reclamo: true, nombres: true, apellidos: true, tipo_registro: true, area: true, createdAt: true },
      }),
    ]);

    return {
      ok: true,
      stats: {
        catalogo: await this.catalogoService.stats(),
        mensajes: {
          total: mensajes.total,
          nuevos: mensajes.nuevo,
          enProceso: mensajes.en_proceso,
          atendidos: mensajes.atendido,
          archivados: mensajes.archivado,
        },
        reclamaciones: {
          total: totalReclamaciones,
          reclamos: totalReclamos,
          quejas: totalQuejas,
        },
        contenido: {
          total: totalItems,
          activos: itemsActivos,
          inactivos: itemsInactivos,
        },
        administradores: {
          total: totalAdmins,
        },
      },
      actividadReciente: {
        mensajes: ultimosMensajes,
        reclamaciones: ultimasReclamaciones,
      },
    };
  }

  // Solo lectura. Los días son días de Perú (America/Lima, UTC-5 fijo: Perú no aplica horario de verano) sobre createdAt,
  // que se guarda en UTC; los días sin mensajes se devuelven en cero. El canal sale de contactos.origen.
  async getActivity(dias = 30, now = new Date()) {
    const todayLima = new Date(now.toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) + 'T00:00:00Z').getTime();
    const firstDay = new Date(todayLima - (dias - 1) * 86400000);
    const from = new Date(firstDay.getTime() + LIMA_OFFSET_HOURS * 3600000);
    const [rows, quotes] = await Promise.all([
      this.prisma.$queryRaw<{ dia: string; total: bigint | number; chatbot: bigint | number | null }[]>(Prisma.sql`SELECT
        DATE_FORMAT(DATE_SUB(createdAt, INTERVAL ${LIMA_OFFSET_HOURS} HOUR), '%Y-%m-%d') AS dia, COUNT(*) AS total,
        SUM(CASE WHEN origen = ${'chatbot'} THEN 1 ELSE 0 END) AS chatbot
        FROM contactos WHERE createdAt >= ${from} GROUP BY dia`),
      this.prisma.cotizacion.groupBy({ by: ['estado'], _count: { _all: true } }),
    ]);
    const byDay = new Map(rows.map(row => [String(row.dia), { total: Number(row.total), chatbot: Number(row.chatbot || 0) }]));
    const mensajes = Array.from({ length: dias }, (_, index) => {
      const fecha = new Date(firstDay.getTime() + index * 86400000).toISOString().slice(0, 10);
      const day = byDay.get(fecha);
      return { fecha, total: day?.total ?? 0, chatbot: day?.chatbot ?? 0 };
    });
    const porEstado: Record<string, number> = { borrador: 0, enviada: 0, aceptada: 0, rechazada: 0, anulada: 0 };
    for (const row of quotes) porEstado[row.estado] = (porEstado[row.estado] ?? 0) + row._count._all;
    return {
      ok: true,
      dias,
      desde: mensajes[0].fecha,
      hasta: mensajes[mensajes.length - 1].fecha,
      mensajes,
      cotizaciones: { total: Object.values(porEstado).reduce((sum, value) => sum + value, 0), porEstado },
    };
  }
}
