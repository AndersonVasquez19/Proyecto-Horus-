import { serializeComplaint } from '../../database/serialization';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { QueryReclamacionesDto } from './dto/query-reclamaciones.dto';

import { pageArgs, pageResult } from '../../common/list-query.dto';
@Injectable()
export class AdminReclamacionesService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findAll(query: QueryReclamacionesDto) {
    const where: any = {};

    if (query.tipo_registro) {
      where.tipo_registro = query.tipo_registro;
    }

    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { numero_reclamo: { contains: term } },
        { nombres: { contains: term } },
        { apellidos: { contains: term } },
        { email: { contains: term } },
        { num_doc: { contains: term } },
      ];
    }

    const reclamaciones = await this.prisma.reclamacion.findMany({
      where, ...pageArgs(query),
      orderBy: [{ createdAt: 'desc' }],
    });

    const total = query.page===undefined ? reclamaciones.length : await this.prisma.reclamacion.count({where});
    const metrics = query.page===undefined ? {} : { metrics: { total: await this.prisma.reclamacion.count(), reclamo: await this.prisma.reclamacion.count({where:{tipo_registro:'reclamo'}}), queja: await this.prisma.reclamacion.count({where:{tipo_registro:'queja'}}) } };
    return {
      ok: true, ...pageResult(query,total), ...metrics,
      total,
      reclamaciones: reclamaciones.map(serializeComplaint),
    };
  }

  async findOne(id: number) {
    const reclamacion = await this.prisma.reclamacion.findUnique({ where: { id } });
    if (!reclamacion) {
      throw new NotFoundException({ ok: false, mensaje: 'Reclamación no encontrada.' });
    }
    return { ok: true, reclamacion: serializeComplaint(reclamacion) };
  }

  async remove(id: number) {
    const reclamacion = await this.prisma.reclamacion.findUnique({ where: { id } });
    if (!reclamacion) {
      throw new NotFoundException({ ok: false, mensaje: 'Reclamación no encontrada.' });
    }
    throw new ConflictException('Conserva la reclamación y su constancia. Puedes archivarla desde el seguimiento.');
  }
}
