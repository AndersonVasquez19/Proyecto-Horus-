import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, Preinscripcion, PreinscripcionEstado } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';
import { CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';
import { EstudiantesService } from '../estudiantes/estudiantes.service';
import { MatriculasService } from '../matriculas/matriculas.service';
import { ConvertirPreinscripcionDto, DescartePreinscripcionDto, DesistimientoPreinscripcionDto, PreinscripcionesQueryDto, ResumenPreinscripcionesQueryDto, UpdatePreinscripcionDto } from './preinscripciones.dto';
import { HistoryEntry, recordHistory } from './preinscripciones.history';
import { verifyExistingStudent, verifyNewStudent } from './preinscripciones.identity';
import { ESTADOS_PARA_APERTURA, validateTransition } from './preinscripciones.rules';

const calendar = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const pagination = (q: CursosConvocatoriaQueryDto, total: number) => ({ page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });
const EDITION = { id: true, nombre: true, estado: true, fecha_inicio: true, fecha_fin: true, archivado_at: true, preinscripcion_estado: true, minimo_apertura: true, capacidad: true, revision: true, curso: { select: { id: true, titulo: true, tipo: true } } } as const;
const STATES: readonly PreinscripcionEstado[] = ['recibida', 'validada', 'matriculada', 'desistida', 'descartada'];
const RC = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
const RR = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead };

type StudentRow = { id: number; nombres: string; apellidos: string; email: string | null; telefono: string | null };
// Mensajes ESTÁTICOS de los bloqueos de identidad: no repiten nombres, correos, teléfonos ni documentos.
const IDENTITY_BLOCKS = {
  DNI_NO_COINCIDE: 'El DNI indicado no corresponde al estudiante seleccionado. No se vincula un estudiante distinto al del documento.',
  IDENTIDAD_DISCREPANTE: 'Los datos de la preinscripción no coinciden con los del estudiante registrado con ese DNI. Revisa el documento de la persona y corrige la preinscripción o el estudiante por sus vías auditadas antes de repetir la conversión.',
  POSIBLE_DUPLICADO: 'Ya existe un estudiante con el mismo nombre y los mismos datos de contacto bajo otro DNI. Revisa el DNI indicado o vincula al estudiante existente antes de crear uno nuevo.',
} as const;

type Prepared = { data: Prisma.PreinscripcionUncheckedUpdateManyInput; history: Pick<HistoryEntry, 'campos' | 'motivo'> };
type Edition = Prisma.ConvocatoriaGetPayload<object>;

// SERVICIO ADMINISTRATIVO. Solo lo alcanzan controladores protegidos por JWT + AccessGuard con permisos preinscripciones:*. Los datos
// personales viven en la fila de la preinscripción; ni los registros ni los errores los repiten en el historial ni en los mensajes.
// Orden de bloqueos (el mismo que Ediciones y Matrículas): curso → edición → preinscripción (→ estudiante → matrícula en la conversión).
@Injectable()
export class PreinscripcionesService {
  private readonly logger = new Logger(PreinscripcionesService.name);
  constructor(private readonly prisma: PrismaService, private readonly matriculas: MatriculasService, private readonly students: EstudiantesService) {}

  private async execute<T>(operation: () => Promise<T>, uniqueMessage = 'Ya existe otra preinscripción vigente con ese correo en la edición.'): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(uniqueMessage);
      if (isSchemaOutdated(error)) throw new ServiceUnavailableException('La gestión de preinscripciones no está disponible. Solicita revisar la estructura académica y la migración de preinscripciones.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code)) throw new ConflictException('Otra operación modificó los datos. Consulta la versión actual antes de repetir.');
      throw error;
    }
  }

  // Fechas de calendario (DATE) como AAAA-MM-DD, sin desplazarse por la zona horaria.
  private presentEdition<T extends { fecha_inicio: Date | null; fecha_fin: Date | null }>(item: T) {
    return { ...item, fecha_inicio: calendar(item.fecha_inicio), fecha_fin: calendar(item.fecha_fin) };
  }

  list(q: PreinscripcionesQueryDto) {
    const terms = (q.search || '').split(/\s+/).filter(Boolean);
    const where: Prisma.PreinscripcionWhereInput = {
      ...(q.convocatoria_id ? { convocatoria_id: q.convocatoria_id } : {}), ...(q.curso_id ? { convocatoria: { curso_id: q.curso_id } } : {}),
      ...(q.estado ? { estado: q.estado } : {}), ...(q.canal ? { canal: q.canal } : {}),
      ...(terms.length ? { AND: terms.map(term => ({ OR: [{ nombres: { contains: term } }, { apellidos: { contains: term } }, { email: { contains: term } }, { telefono: { contains: term } }] })) } : {}),
    };
    return this.execute(async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.preinscripcion.findMany({ where, include: { convocatoria: { select: EDITION } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
        this.prisma.preinscripcion.count({ where }),
      ], RR);
      return { ok: true, items: items.map(item => ({ ...item, convocatoria: this.presentEdition(item.convocatoria) })), pagination: pagination(q, total) };
    });
  }

  // Resumen por edición: conteos por estado, avance hacia el mínimo de apertura y cupos. No contiene datos personales.
  summary(q: ResumenPreinscripcionesQueryDto) {
    const where: Prisma.ConvocatoriaWhereInput = {
      ...(q.archivo === 'activos' ? { archivado_at: null } : q.archivo === 'archivados' ? { archivado_at: { not: null } } : {}),
      ...(q.convocatoria_id ? { id: q.convocatoria_id } : { OR: [{ preinscripcion_estado: 'abierta' }, { preinscripciones: { some: {} } }] }),
      ...(q.search ? { AND: [{ OR: [{ nombre: { contains: q.search } }, { curso: { titulo: { contains: q.search } } }] }] } : {}),
    };
    return this.execute(() => this.prisma.$transaction(async tx => {
      const [rows, total] = await Promise.all([
        tx.convocatoria.findMany({ where, select: { ...EDITION, codigo_publico: true, _count: { select: { matriculas: { where: { estado: 'activa' } } } } },
          orderBy: [{ fecha_inicio: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
        tx.convocatoria.count({ where }),
      ]);
      const groups = rows.length ? await tx.preinscripcion.groupBy({ by: ['convocatoria_id', 'estado'], where: { convocatoria_id: { in: rows.map(row => row.id) } }, _count: { _all: true } }) : [];
      const items = rows.map(({ _count, ...edition }) => {
        const conteo = Object.fromEntries(STATES.map(state => [state, 0])) as Record<PreinscripcionEstado, number>;
        for (const group of groups) if (group.convocatoria_id === edition.id) conteo[group.estado] = group._count._all;
        const total = STATES.reduce((sum, state) => sum + conteo[state], 0);
        const contadas = ESTADOS_PARA_APERTURA.reduce((sum, state) => sum + conteo[state], 0);
        return { convocatoria: this.presentEdition(edition), conteo: { ...conteo, total },
          apertura: { minimo: edition.minimo_apertura, contadas, faltan: edition.minimo_apertura === null ? null : Math.max(0, edition.minimo_apertura - contadas), cumple_minimo: edition.minimo_apertura === null ? null : contadas >= edition.minimo_apertura },
          cupos: { capacidad: edition.capacidad, ocupados: _count.matriculas, disponibles: edition.capacidad === null ? null : Math.max(0, edition.capacidad - _count.matriculas) } };
      });
      return { ok: true, items, pagination: pagination(q, total) };
    }, RR));
  }

  detail(id: number) {
    return this.execute(async () => {
      const item = await this.prisma.preinscripcion.findUnique({ where: { id }, include: { convocatoria: { select: EDITION } } });
      if (!item) throw new NotFoundException('La preinscripción no existe.');
      const [matricula, estudiante, coincidencias] = await Promise.all([
        item.matricula_id ? this.prisma.matricula.findUnique({ where: { id: item.matricula_id }, select: { id: true, estado: true } }) : null,
        item.estudiante_id ? this.prisma.estudiante.findUnique({ where: { id: item.estudiante_id }, select: { id: true, nombres: true, apellidos: true } }) : null,
        // Posibles duplicados dentro de la MISMA edición: igual correo o igual teléfono (comparación exacta). Solo ids y estados.
        this.prisma.preinscripcion.findMany({ where: { convocatoria_id: item.convocatoria_id, id: { not: id }, OR: [{ email: item.email }, { telefono: item.telefono }] },
          select: { id: true, estado: true, canal: true, email: true, telefono: true, createdAt: true }, orderBy: { id: 'desc' }, take: 10 }),
      ]);
      return { ok: true, item: { ...item, convocatoria: this.presentEdition(item.convocatoria) }, matricula, estudiante,
        coincidencias: coincidencias.map(({ email, telefono, ...other }) => ({ ...other, coincide: [...(email.toLowerCase() === item.email.toLowerCase() ? ['email'] : []), ...(telefono === item.telefono ? ['telefono'] : [])] })) };
    });
  }

  history(id: number, q: CursosConvocatoriaQueryDto) {
    return this.execute(async () => {
      if (!await this.prisma.preinscripcion.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('La preinscripción no existe.');
      const where = { preinscripcion_id: id };
      const [items, total] = await this.prisma.$transaction([
        this.prisma.preinscripcionHistorial.findMany({ where, orderBy: { id: 'desc' }, take: q.limit, skip: (q.page - 1) * q.limit }), this.prisma.preinscripcionHistorial.count({ where }),
      ], RR);
      return { ok: true, items, pagination: pagination(q, total) };
    });
  }

  // Transición común. withEdition: bloquea curso → edición ANTES de la fila, porque el cambio puede alterar lo que cuenta para el
  // mínimo de apertura o la capacidad (la apertura de la edición toma el mismo bloqueo y ve entonces un recuento firme).
  private change(id: number, revision: number, actor: number, operacion: HistoryEntry['operacion'], withEdition: boolean,
    prepare: (tx: Prisma.TransactionClient, before: Preinscripcion, edition: Edition | null) => Promise<Prepared>) {
    return this.execute(() => this.prisma.$transaction(async tx => {
      const initial = await tx.preinscripcion.findUnique({ where: { id }, select: { convocatoria_id: true } });
      if (!initial) throw new NotFoundException('La preinscripción no existe.');
      const edition = withEdition ? await this.matriculas.lockEdition(tx, initial.convocatoria_id) : null;
      await tx.$queryRaw`SELECT id FROM preinscripciones WHERE id = ${id} FOR UPDATE`;
      const before = await tx.preinscripcion.findUniqueOrThrow({ where: { id } });
      if (before.revision !== revision) throw new ConflictException('La preinscripción cambió desde que la abriste. Consulta su versión actual antes de continuar.');
      const { data, history } = await prepare(tx, before, edition);
      const result = await tx.preinscripcion.updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } });
      if (!result.count) throw new ConflictException('Otra operación modificó la preinscripción. Consulta la versión actual.');
      const item = await tx.preinscripcion.findUniqueOrThrow({ where: { id }, include: { convocatoria: { select: EDITION } } });
      await recordHistory(tx, id, { operacion, revision: item.revision, actor_id: actor, ...(item.estado !== before.estado ? { estado_anterior: before.estado, estado_nuevo: item.estado } : {}), ...history });
      return { item, before };
    }, RC)).then(({ item }) => ({ ok: true, item: { ...item, convocatoria: this.presentEdition(item.convocatoria) } }));
  }

  validate(id: number, revision: number, actor: number) {
    return this.change(id, revision, actor, 'validacion', true, async (tx, before, edition) => {
      validateTransition(before.estado, 'validada');
      if (!edition || edition.archivado_at || !['planificada', 'abierta'].includes(edition.estado)) throw new ConflictException('Solo se validan preinscripciones de ediciones planificadas o abiertas sin archivar.');
      if (edition.capacidad !== null) {
        // Plazas ya comprometidas = preinscripciones validadas pendientes de convertir + matrículas activas. Validar más sería prometer plazas que no existen.
        const [validated, occupied] = await Promise.all([tx.preinscripcion.count({ where: { convocatoria_id: edition.id, estado: 'validada' } }), tx.matricula.count({ where: { convocatoria_id: edition.id, estado: 'activa' } })]);
        if (validated + occupied >= edition.capacidad) throw new ConflictException('La edición ya tiene comprometidas todas sus plazas (matrículas activas más preinscripciones validadas pendientes).');
      }
      return { data: { estado: 'validada' }, history: { campos: ['estado'] } };
    });
  }

  discard(id: number, dto: DescartePreinscripcionDto, actor: number) {
    return this.change(id, dto.revision, actor, 'descarte', true, async (_tx, before) => {
      validateTransition(before.estado, 'descartada');
      return { data: { estado: 'descartada' }, history: { campos: ['estado'], motivo: dto.motivo } };
    });
  }

  withdraw(id: number, dto: DesistimientoPreinscripcionDto, actor: number) {
    return this.change(id, dto.revision, actor, 'desistimiento', true, async (_tx, before) => {
      validateTransition(before.estado, 'desistida');
      return { data: { estado: 'desistida' }, history: { campos: ['estado'], motivo: dto.motivo } };
    });
  }

  // Corrección de datos de contacto (errores de digitación). No cambia el estado, el canal ni la edición. Una preinscripción ya
  // convertida, descartada o desistida es un registro cerrado y no se edita.
  update(id: number, dto: UpdatePreinscripcionDto, actor: number) {
    const { revision, ...fields } = dto;
    const changed = (['nombres', 'apellidos', 'email', 'telefono'] as const).filter(field => fields[field] !== undefined);
    if (!changed.length) throw new BadRequestException('Indica al menos un campo para corregir.');
    return this.change(id, revision, actor, 'correccion', false, async (_tx, before) => {
      if (!['recibida', 'validada'].includes(before.estado)) throw new ConflictException('Solo se corrigen preinscripciones recibidas o validadas.');
      const data: Prisma.PreinscripcionUncheckedUpdateManyInput = {
        ...(fields.nombres !== undefined ? { nombres: fields.nombres } : {}), ...(fields.apellidos !== undefined ? { apellidos: fields.apellidos } : {}),
        ...(fields.email !== undefined ? { email: fields.email } : {}), ...(fields.telefono !== undefined ? { telefono: fields.telefono } : {}),
      };
      return { data, history: { campos: [...changed] } };
    });
  }

  // Bloqueo de identidad: 409 con un código y los CAMPOS en discrepancia (nunca sus valores), sin datos personales. Se anota en el registro
  // técnico solo con identificadores internos. Lanzarlo dentro de la transacción la revierte: no se crea estudiante ni matrícula.
  private blockIdentity(id: number, actor: number, codigo: keyof typeof IDENTITY_BLOCKS, discrepancias: string[]): never {
    this.logger.warn(`Conversión bloqueada por identidad: preinscripción ${id}, administrador ${actor}, ${codigo} [${discrepancias.join(',')}]`);
    throw new ConflictException({ statusCode: 409, error: 'Conflict', message: IDENTITY_BLOCKS[codigo], codigo, discrepancias });
  }

  // CONVERSIÓN A MATRÍCULA. Una sola transacción: estudiante (existente o nuevo) + matrícula oficial + vínculo + historial. Reutiliza
  // MatriculasService.createInTransaction y EstudiantesService.createInTransaction, de modo que valen exactamente las mismas reglas que
  // en el módulo de Matrículas (edición abierta sin archivar, capacidad y cupos, estudiante no archivado, una matrícula por estudiante
  // y edición —también si está anulada—). Cualquier fallo revierte TODO, incluido el estudiante recién creado.
  //
  // IDENTIDAD (preinscripciones.identity.ts). El DNI es obligatorio y es el ancla: se busca por él al estudiante registrado. Si se indicó
  // `estudiante_id`, debe ser ese mismo estudiante. Con un estudiante registrado se contrastan nombres y contacto; sin él, se descarta un
  // posible duplicado bajo otro DNI. Cualquier discrepancia BLOQUEA la conversión (409): la persona que revisa corrige el dato por su vía
  // auditada —corrección de la preinscripción o edición del estudiante— y repite la conversión. No existe una excepción por parámetro.
  convert(id: number, dto: ConvertirPreinscripcionDto, actor: number) {
    const { revision, estudiante_id, doc_numero } = dto;
    if (!doc_numero) throw new BadRequestException('El DNI es obligatorio para verificar la identidad del estudiante.');
    return this.execute(() => this.prisma.$transaction(async tx => {
      const initial = await tx.preinscripcion.findUnique({ where: { id }, select: { convocatoria_id: true } });
      if (!initial) throw new NotFoundException('La preinscripción no existe.');
      const edition = await this.matriculas.lockEdition(tx, initial.convocatoria_id);
      await tx.$queryRaw`SELECT id FROM preinscripciones WHERE id = ${id} FOR UPDATE`;
      const before = await tx.preinscripcion.findUniqueOrThrow({ where: { id } });
      if (before.revision !== revision) throw new ConflictException('La preinscripción cambió desde que la abriste. Consulta su versión actual antes de continuar.');
      if (before.estado === 'matriculada') throw new ConflictException('La preinscripción ya fue convertida en matrícula.');
      if (before.estado !== 'validada') throw new ConflictException('Solo se convierte una preinscripción validada.');
      if (edition.archivado_at || edition.estado !== 'abierta') throw new ConflictException('La edición debe estar académicamente abierta para convertir la preinscripción en matrícula.');
      if (estudiante_id !== undefined && !await tx.estudiante.findUnique({ where: { id: estudiante_id }, select: { id: true } })) throw new NotFoundException('El estudiante no existe.');
      // Bloqueo del estudiante por DNI: dos conversiones simultáneas del mismo DNI se serializan aquí y la segunda ve al estudiante ya creado.
      const [known] = await tx.$queryRaw<StudentRow[]>`SELECT id, nombres, apellidos, email, telefono FROM estudiantes WHERE doc_pais = 'PE' AND doc_tipo = 'DNI' AND doc_numero = ${doc_numero} FOR UPDATE`;
      if (estudiante_id !== undefined && known?.id !== estudiante_id) this.blockIdentity(id, actor, 'DNI_NO_COINCIDE', ['dni']);
      let studentId: number, created = false, controls: string[];
      if (known) {
        const verdict = verifyExistingStudent(before, known);
        if (!verdict.ok) this.blockIdentity(id, actor, 'IDENTIDAD_DISCREPANTE', verdict.discrepancias);
        studentId = known.id; controls = verdict.controles;
      } else {
        const shared = await tx.$queryRaw<StudentRow[]>`SELECT id, nombres, apellidos, email, telefono FROM estudiantes WHERE email = ${before.email} OR telefono = ${before.telefono} LIMIT 20`;
        const verdict = verifyNewStudent(before, shared);
        if (!verdict.ok) this.blockIdentity(id, actor, 'POSIBLE_DUPLICADO', verdict.discrepancias);
        studentId = (await this.students.createInTransaction(tx, { nombres: before.nombres, apellidos: before.apellidos, doc_numero, email: before.email, telefono: before.telefono })).id;
        created = true; controls = verdict.controles;
      }
      // Valida estado y archivo de la edición, capacidad, estudiante (404 si no existe, 409 si está archivado) y la unicidad
      // estudiante/edición: una matrícula anulada existente NO se duplica, se reactiva desde Matrículas.
      const enrolled = await this.matriculas.createInTransaction(tx, { estudiante_id: studentId, convocatoria_id: edition.id, convocatoria_revision: edition.revision }, actor, 'Conversión de una preinscripción validada');
      const result = await tx.preinscripcion.updateMany({ where: { id, revision }, data: { estado: 'matriculada', estudiante_id: studentId, matricula_id: enrolled.item.id, convertida_por: actor, convertida_at: new Date(), revision: { increment: 1 } } });
      if (!result.count) throw new ConflictException('Otra operación modificó la preinscripción. Consulta la versión actual.');
      const item = await tx.preinscripcion.findUniqueOrThrow({ where: { id }, include: { convocatoria: { select: EDITION } } });
      await recordHistory(tx, id, { operacion: 'conversion', revision: item.revision, actor_id: actor, estado_anterior: 'validada', estado_nuevo: 'matriculada', campos: ['estado', 'estudiante_id', 'matricula_id', created ? 'estudiante_nuevo' : 'estudiante_existente', ...controls] });
      return { ok: true, item: { ...item, convocatoria: this.presentEdition(item.convocatoria) }, matricula: enrolled.item, estudiante_creado: created };
    }, RC), 'Otra operación creó el mismo estudiante o la misma matrícula. Consulta los datos vigentes y vuelve a intentarlo.');
  }
}
