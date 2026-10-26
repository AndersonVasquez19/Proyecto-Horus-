import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';
import { ArchivoEstudianteDto, CreateEstudianteDto, EstudiantesQueryDto, UpdateEstudianteDto } from './estudiantes.dto';

@Injectable()
export class EstudiantesService {
  constructor(private readonly prisma: PrismaService) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Ya existe un estudiante con ese DNI. Revisa también los archivados.');
      if (isSchemaOutdated(error)) throw new ServiceUnavailableException('La gestión de estudiantes no está disponible. Solicita revisar la estructura académica.');
      throw error;
    }
  }

  list(q: EstudiantesQueryDto) {
    const terms = (q.search || '').split(/\s+/).filter(Boolean);
    const where: Prisma.EstudianteWhereInput = {
      ...(q.estado === 'activos' ? { archivado_at: null } : q.estado === 'archivados' ? { archivado_at: { not: null } } : {}),
      ...(terms.length ? { AND: terms.map(term => ({ OR: [{ nombres: { contains: term } }, { apellidos: { contains: term } }, { doc_numero: { contains: term } }] })) } : {}),
    };
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.estudiante.findMany({ where, orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }, { id: 'asc' }], take: q.limit, skip: (q.page - 1) * q.limit }),
        this.prisma.estudiante.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items, pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } };
    });
  }

  detail(id: number) {
    return this.execute(async () => {
      const item = await this.prisma.estudiante.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('El estudiante no existe.');
      return { ok: true, item };
    });
  }

  create(dto: CreateEstudianteDto) {
    return this.execute(async () => ({ ok: true, item: await this.createInTransaction(this.prisma, dto) }));
  }

  createInTransaction(tx: Pick<Prisma.TransactionClient, 'estudiante'>, dto: CreateEstudianteDto) {
    return tx.estudiante.create({ data: {
      nombres: dto.nombres, apellidos: dto.apellidos, doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: dto.doc_numero,
      email: dto.email || null, telefono: dto.telefono || null,
    } });
  }

  update(id: number, dto: UpdateEstudianteDto) {
    const { revision, ...fields } = dto;
    if (!Object.values(fields).some(value => value !== undefined)) throw new BadRequestException('Indica al menos un campo para editar.');
    const data: Prisma.EstudianteUpdateManyMutationInput = {
      ...(fields.nombres !== undefined ? { nombres: fields.nombres } : {}),
      ...(fields.apellidos !== undefined ? { apellidos: fields.apellidos } : {}),
      ...(fields.doc_numero !== undefined ? { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: fields.doc_numero } : {}),
      ...(fields.email !== undefined ? { email: fields.email || null } : {}),
      ...(fields.telefono !== undefined ? { telefono: fields.telefono || null } : {}),
    };
    return this.change(id, revision, data);
  }

  archive(id: number, dto: ArchivoEstudianteDto) {
    return this.change(id, dto.revision, { archivado_at: dto.archivado ? new Date() : null });
  }

  private change(id: number, revision: number, data: Prisma.EstudianteUpdateManyMutationInput) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const result = await tx.estudiante.updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } });
      const item = await tx.estudiante.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('El estudiante no existe.');
      if (!result.count) throw new ConflictException('El estudiante cambió desde que lo abriste. Conserva tus cambios y consulta la versión actual antes de volver a guardar.');
      return { ok: true, item };
    }));
  }
}
