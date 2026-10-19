import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdminItem } from '@prisma/client';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

import { ListQueryDto, pageArgs, pageResult } from '../../common/list-query.dto';
@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findAll(q: ListQueryDto = {}) {
    const where={...(q.estado?{estado:q.estado}:{}),...(q.search?{titulo:{contains:q.search}}:{})};
    const items=await this.prisma.adminItem.findMany({where,...pageArgs(q),orderBy:[{createdAt:'desc'},{id:'desc'}]});
    const total=q.page===undefined?items.length:await this.prisma.adminItem.count({where});
    return{ok:true,items,...pageResult(q,total)};
  }

  async findOne(id: number) {
    let item = await this.prisma.adminItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException({ ok: false, mensaje: 'Elemento no encontrado.' });
    }
    return { ok: true, item };
  }

  async create(dto: CreateItemDto) {
    let item = await this.prisma.adminItem.create({ data: {
      titulo: dto.titulo.trim(),
      descripcion: dto.descripcion.trim(),
      categoria: dto.categoria || 'general',
      estado: dto.estado || 'activo',
    } });
    return { ok: true, mensaje: 'Elemento creado correctamente.', item };
  }

  async update(id: number, dto: UpdateItemDto) {
    if (!Object.values(dto).some(value => value !== undefined) || Object.values(dto).some(value => value === null)) {
      throw new BadRequestException({ ok: false, mensaje: 'Envía al menos un campo válido; no se aceptan valores null.' });
    }
    let item = await this.prisma.adminItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException({ ok: false, mensaje: 'Elemento no encontrado.' });
    }

    const updates: Partial<AdminItem> = {};
    if (dto.titulo !== undefined) updates.titulo = dto.titulo.trim();
    if (dto.descripcion !== undefined) updates.descripcion = dto.descripcion.trim();
    if (dto.categoria !== undefined) updates.categoria = dto.categoria;
    if (dto.estado !== undefined) updates.estado = dto.estado;

    item = await this.prisma.adminItem.update({ where: { id }, data: updates });
    return { ok: true, mensaje: 'Elemento actualizado correctamente.', item };
  }

  async remove(id: number) {
    let item = await this.prisma.adminItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException({ ok: false, mensaje: 'Elemento no encontrado.' });
    }
    await this.prisma.adminItem.delete({ where: { id } });
    return { ok: true, mensaje: 'Elemento eliminado correctamente.' };
  }
}
