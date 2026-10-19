import { ListQueryDto, pageArgs, pageResult } from '../common/list-query.dto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateGaleriaDto } from './dto/create-galeria.dto';
import { UpdateGaleriaDto } from './dto/update-galeria.dto';

@Injectable()
export class GaleriaService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findPublic(categoria?: string, page?: number, limit = 24) {
    const where: Prisma.GaleriaItemWhereInput = { activo: true };
    if (categoria) {
      where.categoria = categoria;
    }

    const items = await this.prisma.galeriaItem.findMany({
      where,
      ...(page !== undefined ? { take: limit, skip: (page - 1) * limit } : {}),
      orderBy: [{ orden: 'asc' }, { createdAt: 'desc' }],
    });
    const total = page === undefined ? items.length : await this.prisma.galeriaItem.count({ where });
    const categories = await this.prisma.galeriaItem.findMany({ where: { activo: true }, select: { categoria: true }, distinct: ['categoria'] });
    return {
      ok: true, total, items, categorias: categories.map(row => row.categoria).sort(),
      ...(page !== undefined ? { pagination: { page, limit, total, pages: Math.ceil(total / limit) } } : {}),
    };
  }

  async findAllAdmin(categoria?: string, q: ListQueryDto = {}) {
    const where: Prisma.GaleriaItemWhereInput = {};
    if (categoria) {
      where.categoria = categoria;
    }

    if (q.estado) { if(q.estado==='activo') where.activo=true; else where.OR=[{activo:false},{activo:null}]; }
    if (q.search) where.titulo = { contains: q.search };
    const items = await this.prisma.galeriaItem.findMany({
      where, ...pageArgs(q),
      orderBy: [{ orden: 'asc' }, { createdAt: 'desc' }],
    });

    return {
      ok: true,
      ...pageResult(q, q.page===undefined ? items.length : await this.prisma.galeriaItem.count({where})),
      total: items.length,
      items,
    };
  }

  async findOne(id: number, publico = false) {
    let item = await this.prisma.galeriaItem.findFirst({ where: publico ? { id, activo: true } : { id } });
    if (!item) {
      throw new NotFoundException({ ok: false, mensaje: 'Elemento de galería no encontrado.' });
    }
    return { ok: true, item };
  }

  async create(dto: CreateGaleriaDto) {
    let item = await this.prisma.galeriaItem.create({ data: {
      ...dto,
      categoria: dto.categoria.trim().toLowerCase(),
      activo: dto.activo !== undefined ? dto.activo : true,
      orden: dto.orden || 0,
    } });
    return {
      ok: true,
      mensaje: 'Elemento de galería creado exitosamente.',
      item,
    };
  }

  async update(id: number, dto: UpdateGaleriaDto) {
    if (!Object.values(dto).some(value => value !== undefined) || Object.values(dto).some(value => value === null)) {
      throw new BadRequestException({ ok: false, mensaje: 'Envía al menos un campo válido; no se aceptan valores null.' });
    }
    let item = await this.prisma.galeriaItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException({ ok: false, mensaje: 'Elemento de galería no encontrado.' });
    }

    const updates: Prisma.GaleriaItemUpdateInput = {};
    if (dto.titulo !== undefined) updates.titulo = dto.titulo.trim();
    if (dto.descripcion !== undefined) updates.descripcion = dto.descripcion?.trim();
    if (dto.categoria !== undefined) updates.categoria = dto.categoria.trim().toLowerCase();
    if (dto.imagen_url !== undefined) updates.imagen_url = dto.imagen_url.trim();
    if (dto.orden !== undefined) updates.orden = dto.orden;
    if (dto.activo !== undefined) updates.activo = dto.activo;

    item = await this.prisma.galeriaItem.update({ where: { id }, data: updates });
    return {
      ok: true,
      mensaje: 'Elemento de galería actualizado exitosamente.',
      item,
    };
  }

  async remove(id: number) {
    let item = await this.prisma.galeriaItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException({ ok: false, mensaje: 'Elemento de galería no encontrado.' });
    }
    await this.prisma.galeriaItem.delete({ where: { id } });
    return {
      ok: true,
      mensaje: 'Elemento de galería eliminado exitosamente.',
    };
  }
}
