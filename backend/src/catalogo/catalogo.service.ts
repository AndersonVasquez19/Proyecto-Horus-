import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isUniqueViolation } from '../database/serialization';
import { CatalogoQueryDto } from './catalogo.dto';
import { isDeepStrictEqual } from 'node:util';

export type Recurso = 'cursos' | 'servicios' | 'preguntas-frecuentes';
// Each route validates its own DTO before reaching this shared CRUD service.
interface CatalogDelegate {
  findMany(args: object): Promise<any[]>;
  findFirst(args: object): Promise<any>;
  count(args?: object): Promise<number>;
  create(args: { data: any }): Promise<any>;
  update(args: { where: { id: number }; data: any }): Promise<any>;
  delete(args: { where: { id: number } }): Promise<any>;
}

const SERVICIO_CATEGORIAS = ['cableado', 'camaras', 'soporte', 'asesoramiento'];

@Injectable()
export class CatalogoService {
  constructor(private readonly prisma: PrismaService) {}
  private model(recurso: Recurso): CatalogDelegate {
    return { cursos: this.prisma.curso, servicios: this.prisma.servicio, 'preguntas-frecuentes': this.prisma.preguntaFrecuente }[recurso];
  }

  async list(recurso: Recurso, query: CatalogoQueryDto, publico = false) {
    const where: Record<string, unknown> = {};
    if (publico) where.estado = 'publicado';
    else if (query.estado) where.estado = query.estado;
    if (recurso === 'cursos') {
      if (query.tipo) where.tipo = query.tipo;
      if (query.modalidad) where.modalidad = query.modalidad;
    } else if (query.categoria) {
      if (recurso === 'servicios') {
        // The panel groups services by section; a section may span several categories (comma separated).
        const categories = query.categoria.split(',').map(value => value.trim());
        if (categories.some(value => !SERVICIO_CATEGORIAS.includes(value))) throw new BadRequestException('Categoría de servicio inválida.');
        where.categoria = categories.length === 1 ? categories[0] : { in: categories };
      } else where.categoria = query.categoria;
    }
    if (recurso === 'cursos' && query.periodo) {
      if (!publico && !query.estado) where.estado = { not: 'archivado' };
      const today = new Date(new Date().toLocaleDateString('en-CA',{timeZone:'America/Lima'})+'T00:00:00Z');
      where.fecha_inicio = query.periodo === 'unscheduled' ? null : query.periodo === 'past' ? { lt: today } : { gte: today };
    }
    if (query.search) where[recurso === 'preguntas-frecuentes' ? 'pregunta' : 'titulo'] = { contains: query.search };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const model = this.model(recurso);
    const [rows, count] = await Promise.all([
      model.findMany({ where, take: limit, skip: (page - 1) * limit,
        orderBy: recurso === 'cursos' && query.periodo ? [{fecha_inicio:'asc'},{id:'asc'}] : recurso === 'preguntas-frecuentes' ? [{ orden: 'asc' }, { id: 'desc' }] : [{ orden: 'asc' }, { id: 'desc' }] }),
      model.count({ where }),
    ]);
    let metrics: Record<string,number> | undefined;
    if (recurso==='cursos' && query.periodo && !publico) {
      const today=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'America/Lima'})+'T00:00:00Z');
      const kind=query.tipo?{tipo:query.tipo}:{};
      const [total,upcoming,unscheduled]=await Promise.all([model.count({where:{estado:{not:'archivado'},...kind}}),model.count({where:{estado:{not:'archivado'},fecha_inicio:{gte:today},...kind}}),model.count({where:{estado:{not:'archivado'},fecha_inicio:null,...kind}})]);
      metrics={total,upcoming,unscheduled};
    }
    return { ok: true, ...(metrics?{metrics}:{}), items: rows, pagination: { page, limit, total: count, pages: Math.ceil(count / limit) } };
  }

  async detail(recurso: Recurso, id: number, publico = false) {
    const item = await this.model(recurso).findFirst({ where: publico ? { id, estado: 'publicado' } : { id } });
    if (!item) throw new NotFoundException({ ok: false, mensaje: 'Contenido no encontrado.' });
    return { ok: true, item };
  }

  private payload(dto: object, recurso: Recurso) {
    if (!Object.keys(dto).length || Object.values(dto).some(value => value === null)) {
      throw new BadRequestException({ ok: false, mensaje: 'Envía al menos un campo válido; no se aceptan valores null.' });
    }
    const data = { ...dto } as Record<string, unknown>;
    const limpiar = data.limpiar as string[] | undefined;
    delete data.limpiar;
    if (limpiar?.length) {
      const allowed = recurso === 'cursos' ? ['imagen_url','fecha_inicio','temario','area','certificacion','icono','modalidad','duracion'] : recurso === 'servicios' ? ['imagen_url','alcance','nombre_corto','destacado','dato_principal','dato_secundario','etiquetas','icono'] : [];
      for (const field of limpiar) {
        if (!allowed.includes(field)) throw new BadRequestException('Campo no permitido para limpiar.');
        if (data[field] !== undefined) throw new BadRequestException('No puedes modificar y quitar el mismo campo.');
        data[field] = null;
      }
    }
    if (!Object.keys(data).length) throw new BadRequestException('Envía al menos un cambio.');
    if (data.fecha_inicio !== undefined && data.fecha_inicio !== null) data.fecha_inicio = new Date(String(data.fecha_inicio));
    return data;
  }

  // Names the record that already owns the slug so the administrator knows why the change was refused.
  private async slugConflictMessage(recurso: Recurso, slug: unknown, exceptId?: number) {
    const generic = 'Ese slug ya está en uso.';
    if (typeof slug !== 'string' || recurso === 'preguntas-frecuentes') return generic;
    try {
      const owner = await this.model(recurso).findFirst({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
      if (owner) return `Ya existe «${owner.titulo}» (${owner.estado}) con el slug «${slug}». Usa otro identificador o edita ese registro.`;
    } catch { /* The generic message is still accurate. */ }
    return generic;
  }

  async create(recurso: Recurso, dto: object) {
    const data = this.payload(dto, recurso);
    if(recurso==='cursos'&&data.tipo==='curso'&&(!data.modalidad||!data.duracion))throw new BadRequestException('Un curso necesita modalidad y duración.');
    try {
      const item = await this.model(recurso).create({ data });
      return { ok: true, item };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException({ ok: false, mensaje: await this.slugConflictMessage(recurso, data.slug) });
      throw error;
    }
  }

  async update(recurso: Recurso, id: number, dto: object) {
    const data = this.payload(dto, recurso);
    const {item:previous} = await this.detail(recurso, id);
    if(recurso==='cursos'){
      const next={...previous,...data};
      if(next.tipo==='curso'&&(!next.modalidad||!next.duracion))throw new BadRequestException('Un curso necesita modalidad y duración. Completa ambos campos.');
    }
    try {
      const item = recurso === 'cursos'
        ? await this.prisma.$transaction(async tx => {
          // Mismo primer bloqueo (curso) que Ediciones/Matrículas/Horarios. No se usa updatedAt como revisión:
          // MySQL lo guarda con precisión de segundos y dos escrituras podrían compartirlo.
          await tx.$queryRaw`SELECT id FROM cursos WHERE id = ${id} FOR UPDATE`;
          const current = await tx.curso.findFirst({ where: { id } });
          if (!current) throw new NotFoundException({ ok: false, mensaje: 'Contenido no encontrado.' });
          if (!isDeepStrictEqual(previous, current)) throw new ConflictException({ ok: false, mensaje: 'El contenido cambió durante la actualización. Recarga y revisa los cambios antes de guardar.' });
          // La fila no puede cambiar entre la validación anterior y esta escritura si coincide con su instantánea.
          return tx.curso.update({ where: { id }, data });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
        : await this.model(recurso).update({ where: { id }, data });
      return { ok: true, item };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new ConflictException({ ok: false, mensaje: 'El contenido cambió durante la actualización. Recarga y revisa los cambios antes de guardar.' });
      if (isUniqueViolation(error)) throw new ConflictException({ ok: false, mensaje: await this.slugConflictMessage(recurso, data.slug, id) });
      throw error;
    }
  }

  async archive(recurso: Recurso, id: number) {
    await this.detail(recurso, id);
    const item = await this.model(recurso).update({ where: { id }, data: { estado: 'archivado' } });
    return { ok: true, mensaje: 'Contenido archivado.', item };
  }

  // Only services can be physically removed. Courses keep their identity and are archived through PUT.
  async remove(recurso: Recurso, id: number) {
    if (recurso === 'preguntas-frecuentes') throw new BadRequestException('Este contenido solo se puede archivar.');
    await this.detail(recurso, id);
    if (recurso === 'cursos') throw new ConflictException({ ok: false, mensaje: 'Los cursos y capacitaciones se conservan. Para retirarlos del catálogo público, cambia su estado a «Archivado» desde Editar.' });
    try {
      await this.model(recurso).delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException({ ok: false, mensaje: 'Contenido no encontrado.' });
      throw error;
    }
    return { ok: true, mensaje: 'Servicio eliminado definitivamente.' };
  }

  async stats() {
    const summary = async (model: CatalogDelegate, scope: object = {}) => {
      const [total, publicados, borradores, archivados] = await Promise.all([
        model.count(Object.keys(scope).length ? { where: scope } : undefined), model.count({ where: { ...scope, estado: 'publicado' } }),
        model.count({ where: { ...scope, estado: 'borrador' } }), model.count({ where: { ...scope, estado: 'archivado' } }),
      ]);
      return { total, publicados, borradores, archivados };
    };
    const entries = await Promise.all((['cursos', 'servicios', 'preguntas-frecuentes'] as Recurso[]).map(async key => {
      const model = this.model(key);
      const general = await summary(model);
      if (key !== 'cursos') return [key, general];
      // Courses and capacitaciones are separate sections, so their counts are reported separately as well.
      const [curso, capacitacion] = await Promise.all([summary(model, { tipo: 'curso' }), summary(model, { tipo: 'capacitacion' })]);
      return [key, { ...general, por_tipo: { curso, capacitacion } }];
    }));
    return Object.fromEntries(entries);
  }
}
