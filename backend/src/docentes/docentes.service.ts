import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Docente, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateDocenteDto, DocentesQueryDto, EstadoDocenteDto, UpdateDocenteDto } from './docentes.dto';
import { recordHistory } from './docentes.history';
import { changedFieldNames, translateDatabaseError } from './docentes.rules';

const MESSAGES = {
  unique: 'Ya existe un docente con ese DNI o ese correo. Revisa también los inactivos.',
  outdated: 'La gestión de docentes no está disponible. Solicita revisar la estructura académica.',
  concurrent: 'Otra operación modificó al docente. Consulta la versión actual antes de repetir.',
};
const withActiveCount = { _count: { select: { asignaciones: { where: { estado: 'activa' as const } } } } };
type DocenteRow = Docente & { _count?: { asignaciones: number } };

// El docente se expone completo a quien tiene docentes:leer (nunca en rutas públicas). El conteo de asignaciones activas permite
// avisar, antes de desactivar, que seguirán figurando en sus ediciones: desactivar nunca las retira.
export const viewDocente = ({ _count, ...docente }: DocenteRow) => ({ ...docente, ...(_count ? { asignaciones_activas: _count.asignaciones } : {}) });

const blank = (value: string | undefined) => value === undefined ? undefined : value || null;

@Injectable()
export class DocentesService {
  constructor(private readonly prisma: PrismaService) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) { return translateDatabaseError(error, MESSAGES); }
  }

  list(q: DocentesQueryDto) {
    const terms = (q.search || '').split(/\s+/).filter(Boolean);
    const where: Prisma.DocenteWhereInput = {
      ...(q.estado === 'activos' ? { activo: true } : q.estado === 'inactivos' ? { activo: false } : {}),
      ...(q.especialidad ? { especialidad: { contains: q.especialidad } } : {}),
      ...(terms.length ? { AND: terms.map(term => ({ OR: [{ nombres: { contains: term } }, { apellidos: { contains: term } }, { doc_numero: { contains: term } }] })) } : {}),
    };
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.docente.findMany({ where, include: withActiveCount, orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }, { id: 'asc' }], take: q.limit, skip: (q.page - 1) * q.limit }),
        this.prisma.docente.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { ok: true, items: items.map(viewDocente), pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } };
    });
  }

  detail(id: number) {
    return this.execute(async () => {
      const item = await this.prisma.docente.findUnique({ where: { id }, include: withActiveCount });
      if (!item) throw new NotFoundException('El docente no existe.');
      return { ok: true, item: viewDocente(item) };
    });
  }

  // Duplicados: el DNI y el correo son únicos (409 con motivo claro; el índice UNIQUE de MySQL sigue siendo la barrera ante dos altas
  // simultáneas). El nombre no lo es: un homónimo solo se registra si quien da el alta confirma que es otra persona.
  private async assertNoDuplicate(tx: Prisma.TransactionClient, fields: { doc_numero?: string; email?: string }, exceptId?: number) {
    const other = exceptId ? { id: { not: exceptId } } : {};
    if (fields.doc_numero && await tx.docente.findFirst({ where: { doc_numero: fields.doc_numero, ...other }, select: { id: true } })) throw new ConflictException('Ya existe un docente con ese DNI. Revisa también los inactivos.');
    if (fields.email && await tx.docente.findFirst({ where: { email: fields.email, ...other }, select: { id: true } })) throw new ConflictException('Ya existe un docente con ese correo. Revisa también los inactivos.');
  }

  create(dto: CreateDocenteDto, actor: number) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      await this.assertNoDuplicate(tx, dto);
      if (!dto.confirmar_homonimo) {
        const same = await tx.docente.findMany({ where: { nombres: dto.nombres, apellidos: dto.apellidos }, select: { id: true }, orderBy: { id: 'asc' }, take: 5 });
        if (same.length) throw new ConflictException({ statusCode: 409, error: 'Conflict', codigo: 'POSIBLE_HOMONIMO', coincidencias: same.map(row => row.id),
          message: 'Ya existe un docente con esos nombres y apellidos. Si es otra persona, repite el registro confirmando que es un homónimo.' });
      }
      const item = await tx.docente.create({ data: {
        nombres: dto.nombres, apellidos: dto.apellidos,
        ...(dto.doc_numero ? { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: dto.doc_numero } : {}),
        especialidad: dto.especialidad || null, profesion: dto.profesion || null, email: dto.email || null, telefono: dto.telefono || null,
      } });
      await recordHistory(tx, { entidad: 'docente', id: item.id, actor, operacion: 'creacion', revision: item.revision, nuevo: 'activo',
        campos: ['nombres', 'apellidos', ...changedFieldNames({ doc_numero: dto.doc_numero || undefined, especialidad: dto.especialidad || undefined, profesion: dto.profesion || undefined, email: dto.email || undefined, telefono: dto.telefono || undefined })] });
      return { ok: true, item: viewDocente({ ...item, _count: { asignaciones: 0 } }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }

  update(id: number, dto: UpdateDocenteDto, actor: number) {
    const { revision, ...fields } = dto;
    if (!Object.values(fields).some(value => value !== undefined)) throw new BadRequestException('Indica al menos un campo para editar.');
    return this.change(id, revision, actor, 'edicion', async (tx) => {
      await this.assertNoDuplicate(tx, fields, id);
      return {
        ...(fields.nombres !== undefined ? { nombres: fields.nombres } : {}),
        ...(fields.apellidos !== undefined ? { apellidos: fields.apellidos } : {}),
        ...(fields.doc_numero === undefined ? {} : fields.doc_numero ? { doc_pais: 'PE', doc_tipo: 'DNI' as const, doc_numero: fields.doc_numero } : { doc_pais: null, doc_tipo: null, doc_numero: null }),
        ...(fields.especialidad !== undefined ? { especialidad: blank(fields.especialidad) } : {}),
        ...(fields.profesion !== undefined ? { profesion: blank(fields.profesion) } : {}),
        ...(fields.email !== undefined ? { email: blank(fields.email) } : {}),
        ...(fields.telefono !== undefined ? { telefono: blank(fields.telefono) } : {}),
      };
    }, changedFieldNames(fields));
  }

  // Activar o desactivar. Nunca toca las asignaciones: las históricas se conservan y las activas siguen figurando hasta que alguien
  // con docentes:asignar las retire o las sustituya (decisión de negocio, no automática). La respuesta informa cuántas siguen activas.
  setActive(id: number, dto: EstadoDocenteDto, actor: number) {
    return this.change(id, dto.revision, actor, 'cambio_estado', async (_tx, before) => {
      if (before.activo === dto.activo) throw new ConflictException(dto.activo ? 'El docente ya está activo.' : 'El docente ya está inactivo.');
      return { activo: dto.activo };
    }, ['activo'], before => ({ anterior: before.activo ? 'activo' : 'inactivo', nuevo: dto.activo ? 'activo' : 'inactivo' }));
  }

  private change(id: number, revision: number, actor: number, operacion: 'edicion' | 'cambio_estado', prepare: (tx: Prisma.TransactionClient, before: Docente) => Promise<Prisma.DocenteUpdateManyMutationInput>,
    campos: string[], states?: (before: Docente) => { anterior: string; nuevo: string }) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM docentes WHERE id = ${id} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('El docente no existe.');
      const before = await tx.docente.findUniqueOrThrow({ where: { id } });
      if (before.revision !== revision) throw new ConflictException('El docente cambió desde que lo abriste. Conserva tus cambios y consulta la versión actual antes de guardar.');
      const data = await prepare(tx, before);
      const result = await tx.docente.updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } });
      if (!result.count) throw new ConflictException('Otra operación modificó al docente. Consulta la versión actual.');
      const item = await tx.docente.findUniqueOrThrow({ where: { id }, include: withActiveCount });
      await recordHistory(tx, { entidad: 'docente', id, actor, operacion, campos, revision: item.revision, ...(states ? states(before) : {}) });
      return { ok: true, item: viewDocente(item) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
}
