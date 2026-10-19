import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isUniqueViolation } from '../database/serialization';
import { ConveniosQueryDto, CreateConvenioDto, UpdateConvenioDto, CreateConvenioFotoDto, UpdateConvenioFotoDto, ReorderConvenioFotosDto } from './convenios.dto';

const orderBy: Prisma.ConvenioOrderByWithRelationInput[] = [{ orden: 'asc' }, { id: 'asc' }];
const summary = { id: true, nombre: true, sigla: true, logo_url: true, descripcion_corta: true, orden: true, visible: true } as const;
const detail = { ...summary, descripcion_completa: true, informacion_adicional: true,
  fotos: { orderBy: [{ orden: 'asc' }, { id: 'asc' }] as Prisma.ConvenioFotoOrderByWithRelationInput[] } } as const;

@Injectable()
export class ConveniosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ConveniosQueryDto, publico = false) {
    const where: Prisma.ConvenioWhereInput = publico ? { visible: true } :
      q.estado ? { visible: q.estado === 'visible' } : {};
    if (q.search) where.OR = [{ nombre: { contains: q.search } }, { sigla: { contains: q.search } }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.convenio.findMany({ where, select: summary, orderBy, take: q.limit, skip: (q.page - 1) * q.limit }),
      this.prisma.convenio.count({ where }),
    ]);
    return { ok: true, items, pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } };
  }

  async detail(id: number, publico = false) {
    const item = await this.prisma.convenio.findFirst({ where: publico ? { id, visible: true } : { id }, select: detail });
    if (!item) throw new NotFoundException({ ok: false, mensaje: 'Convenio no encontrado.' });
    return { ok: true, item };
  }

  private validUpdate(dto: object) {
    const values = Object.values(dto);
    if (!values.some(v => v !== undefined) || values.some(v => v === null))
      throw new BadRequestException('Envía al menos un campo válido; no se aceptan valores null.');
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('El convenio ya existe.');
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new NotFoundException('Convenio o fotografía no encontrado.');
        if (error.code === 'P2003') throw new NotFoundException('Convenio no encontrado.');
      }
      throw error;
    }
  }

  async create(dto: CreateConvenioDto) {
    const item = await this.write(() => this.prisma.convenio.create({ data: { ...dto, visible: dto.visible ?? false }, select: detail }));
    return { ok: true, item };
  }

  async update(id: number, dto: UpdateConvenioDto) {
    this.validUpdate(dto);
    const item = await this.write(() => this.prisma.convenio.update({ where: { id }, data: dto, select: detail }));
    return { ok: true, item };
  }

  async remove(id: number) {
    // La FK elimina solo metadatos de fotos. Los uploads pueden estar compartidos.
    await this.write(() => this.prisma.convenio.delete({ where: { id } }));
    return { ok: true, mensaje: 'Convenio eliminado.' };
  }

  async addFoto(id: number, dto: CreateConvenioFotoDto) {
    const item = await this.write(() => this.prisma.convenioFoto.create({ data: { ...dto, convenio_id: id } }));
    return { ok: true, item };
  }

  async updateFoto(id: number, fotoId: number, dto: UpdateConvenioFotoDto) {
    this.validUpdate(dto);
    const result = await this.prisma.convenioFoto.updateMany({ where: { id: fotoId, convenio_id: id }, data: { orden: dto.orden } });
    if (!result.count) throw new NotFoundException('Fotografía no encontrada en este convenio.');
    return { ok: true };
  }

  async removeFoto(id: number, fotoId: number) {
    const result = await this.prisma.convenioFoto.deleteMany({ where: { id: fotoId, convenio_id: id } });
    if (!result.count) throw new NotFoundException('Fotografía no encontrada en este convenio.');
    return { ok: true };
  }

  async reorderFotos(id: number, dto: ReorderConvenioFotosDto) {
    await this.prisma.$transaction(async tx => {
      for (const foto of dto.fotos) {
        const result = await tx.convenioFoto.updateMany({ where: { id: foto.id, convenio_id: id }, data: { orden: foto.orden } });
        if (!result.count) throw new NotFoundException('Fotografía no encontrada en este convenio.');
      }
    });
    return { ok: true };
  }
}
