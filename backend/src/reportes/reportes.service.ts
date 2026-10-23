import {
  BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { ConvocatoriaEstado, MatriculaCumplimiento, MatriculaEstado, Prisma } from '@prisma/client';
import { OPEN_EDITIONS_WHERE } from '../admin/stats/stats.service';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated } from '../database/serialization';
import type { Permission } from '../permissions/permissions';
import { FORBIDDEN_MESSAGE } from '../permissions/access.guard';
import { can } from '../permissions/policy';
import { CURRENCY_LABELS, expiredQuotes, inquiriesByState, monthlyActivity, oldOpenInquiries, quoteAmounts, quotesByState } from './reportes.comerciales';
import { REPORT_CATALOG, ReportDefinition, catalogEntries } from './reportes.catalogo';
import { FILTER_KEYS, ReporteConsultaDto, ReporteFiltrosDto } from './reportes.dto';
import { BATCH_SIZE, MAX_EXPORT_ROWS, MAX_REPORT_ROWS, PREVIEW_MAX_LIMIT, REPORT_TRANSACTION_TIMEOUT_MS } from './reportes.limites';
import { LIMA_OFFSET_HOURS, Period, calendarDate, limaDateTime, monthsBetween, resolvePeriod, toCalendar } from './reportes.periodo';
import {
  INSTITUTION_NAME, ReportColumn, ReportDocument, ReportFilterLabel, ReportFormat, ReportRow, ReportSummaryItem, ReportTable, ReportType,
} from './reportes.types';

type Tx = Prisma.TransactionClient;
type Filters = ReporteFiltrosDto;
// window: página de la consulta JSON (null = todas las filas). maxRows: tope de filas de la tabla para este uso.
interface BuildMode { window: { skip: number; take: number } | null; maxRows: number; limitLabel: string }
interface Built { tabla: ReportTable; resumen: ReportSummaryItem[] }

export const STATE_LABELS: Readonly<Record<string, string>> = {
  activos: 'Activos', inactivos: 'Inactivos', todos: 'Todos',
  planificada: 'Planificada', abierta: 'Abierta', cerrada: 'Cerrada', cancelada: 'Cancelada',
  activa: 'Vigente', anulada: 'Anulada', vigente: 'Vigente', anulado: 'Anulado',
  borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', nuevo: 'Nuevo', en_proceso: 'En proceso',
};
export const COMPLIANCE_LABELS: Readonly<Record<string, string>> = { pendiente: 'Pendiente', cumplido: 'Cumplido', no_cumplido: 'No cumplido' };
const ARCHIVE_LABELS: Readonly<Record<string, string>> = { activos: 'Solo no archivadas', archivados: 'Solo archivadas', todos: 'Todas' };
const GROUPING_LABELS: Readonly<Record<string, string>> = { edicion: 'Por edición', curso: 'Por curso' };
const COURSE_TYPE_LABELS: Readonly<Record<string, string>> = { curso: 'Curso', capacitacion: 'Capacitación' };

const n = (value: bigint | number | null | undefined) => Number(value ?? 0);
// Porcentaje con un decimal (75.0 = 75,0 %); null si no hay base.
export const percent = (part: number, whole: number) => whole > 0 ? Math.round((part * 1000) / whole) / 10 : null;
const item = (clave: string, etiqueta: string, valor: number | null, tipo: 'entero' | 'decimal' = 'entero'): ReportSummaryItem => ({ clave, etiqueta, valor, tipo });
const col = (clave: string, titulo: string, tipo: ReportColumn['tipo'], ancho: number): ReportColumn => ({ clave, titulo, tipo, ancho });
const byText = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
const createdRange = (p: Period) => p.fromUtc || p.toUtc ? { createdAt: { ...(p.fromUtc ? { gte: p.fromUtc } : {}), ...(p.toUtc ? { lt: p.toUtc } : {}) } } : {};
const chunks = <T>(values: T[], size: number) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));
const allowed = (rol: unknown, permissions: readonly Permission[]) => permissions.every(permission => can(rol, permission));

interface EditionStat {
  id: number; nombre: string; curso_id: number; curso: string; curso_tipo: string; inicio: string | null; fin: string | null;
  estado: string; archivada: boolean; capacidad: number | null; vigentes: number; anuladas: number;
}

@Injectable()
export class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

  // Catálogo para el panel, con lo que la cuenta actual puede hacer con cada reporte (la autorización real sigue en cada ruta).
  async catalog(actorId: number) {
    const rol = await this.role(actorId);
    const canRead = can(rol, 'reportes_academicos:leer'), canExport = can(rol, 'reportes_academicos:exportar');
    return {
      ok: true,
      formatos: ['csv', 'xlsx', 'pdf'],
      limites: { filas_exportacion: { ...MAX_EXPORT_ROWS }, filas_por_pagina: PREVIEW_MAX_LIMIT },
      // Visibilidad: un reporte COMERCIAL que la cuenta no puede consultar se omite; los académicos se conservan siempre (mejora de
      // visibilidad: las rutas de consulta y exportación siguen autorizando por su cuenta).
      reportes: catalogEntries().map(entry => ({
        ...entry,
        puede_consultar: canRead && allowed(rol, REPORT_CATALOG[entry.tipo].consultaRequiere),
        puede_exportar: canExport && allowed(rol, REPORT_CATALOG[entry.tipo].exportacionRequiere),
      })).filter(entry => entry.ambito !== 'comercial' || entry.puede_consultar),
    };
  }

  async preview(tipo: ReportType, q: ReporteConsultaDto, actorId: number, now = new Date()) {
    const def = REPORT_CATALOG[tipo];
    this.validateFilters(def, q);
    await this.authorize(actorId, 'reportes_academicos:leer', def, def.consultaRequiere, 'consultar');
    const reporte = await this.build(def, q, now, { window: { skip: (q.page - 1) * q.limit, take: q.limit }, maxRows: MAX_REPORT_ROWS, limitLabel: 'la consulta' });
    const total = reporte.tabla.total_filas;
    return { ok: true, reporte, pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } };
  }

  // Documento completo para exportar. No escribe en la base ni registra filtros o datos en los logs.
  async exportDocument(tipo: ReportType, q: Filters, formato: ReportFormat, actorId: number, now = new Date()): Promise<ReportDocument> {
    const def = REPORT_CATALOG[tipo];
    this.validateFilters(def, q);
    await this.authorize(actorId, 'reportes_academicos:exportar', def, def.exportacionRequiere, 'exportar');
    return this.build(def, q, now, { window: null, maxRows: Math.min(MAX_EXPORT_ROWS[formato], MAX_REPORT_ROWS), limitLabel: 'el formato ' + formato.toUpperCase() });
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  private validateFilters(def: ReportDefinition, q: Filters) {
    for (const key of FILTER_KEYS) {
      if (q[key] !== undefined && !def.filtros.includes(key)) throw new BadRequestException('El filtro «' + key + '» no se aplica al reporte «' + def.titulo + '».');
    }
    if (q.estado !== undefined && !def.estados.includes(q.estado)) {
      throw new BadRequestException('Estado no válido para el reporte «' + def.titulo + '». Valores admitidos: ' + def.estados.join(', ') + '.');
    }
  }

  private async role(actorId: number) {
    const account = await this.execute(() => this.prisma.adminUser.findUnique({ where: { id: actorId }, select: { rol: true } }));
    return account?.rol ?? null;
  }

  // Comprobación con el rol VIGENTE (como la reactivación de matrículas): el permiso base repite el de AccessGuard (defensa en
  // profundidad) y los reportes con datos personales exigen además leer o exportar estudiantes.
  private async authorize(actorId: number, base: Permission, def: ReportDefinition, extra: readonly Permission[], action: 'consultar' | 'exportar') {
    const rol = await this.role(actorId);
    if (!can(rol, base)) throw new ForbiddenException(FORBIDDEN_MESSAGE);
    if (!allowed(rol, extra)) {
      throw new ForbiddenException(def.ambito === 'comercial' ? 'Tu rol no puede ' + action + ' este reporte comercial o de atención al cliente.' : 'Tu rol no puede ' + action + ' reportes con datos personales de estudiantes.');
    }
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (isSchemaOutdated(error)) throw new ServiceUnavailableException('Los reportes académicos no están disponibles. Solicita revisar la estructura académica.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2024', 'P2028'].includes(error.code)) {
        throw new ServiceUnavailableException('El reporte tardó demasiado. Acota el período o los filtros e inténtalo de nuevo.');
      }
      throw error;
    }
  }

  private checkRows(total: number, mode: BuildMode) {
    if (total > mode.maxRows) {
      throw new UnprocessableEntityException('El reporte tiene ' + total + ' filas y el máximo para ' + mode.limitLabel + ' es ' + mode.maxRows + '. Acota el período o los filtros.');
    }
  }

  private async build(def: ReportDefinition, q: Filters, now: Date, mode: BuildMode): Promise<ReportDocument> {
    const period = resolvePeriod(q.desde, q.hasta, now, def.tipo === 'resumen' || def.tipo === 'actividad-comercial' ? 12 : undefined);
    return this.execute(() => this.prisma.$transaction(async tx => {
      const filtros = await this.filterLabels(tx, q);
      const built = await this.builder(def.tipo, now)(tx, q, period, mode);
      return {
        tipo: def.tipo, titulo: def.titulo, descripcion: def.descripcion, institucion: INSTITUTION_NAME,
        generado_at: now.toISOString(), generado_local: limaDateTime(now),
        periodo: { desde: period.desde, hasta: period.hasta, etiqueta: period.etiqueta },
        filtros, resumen: built.resumen, tabla: built.tabla, notas: [...def.notas], datos_personales: def.datosPersonales,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: REPORT_TRANSACTION_TIMEOUT_MS, maxWait: 5_000 }));
  }

  private builder(tipo: ReportType, now: Date): (tx: Tx, q: Filters, p: Period, mode: BuildMode) => Promise<Built> {
    switch (tipo) {
      case 'estudiantes': return (tx, q, p, mode) => this.students(tx, q, p, mode);
      case 'ediciones': return (tx, q, p, mode) => this.editionsReport(tx, q, p, mode);
      case 'ocupacion': return (tx, q, p, mode) => this.occupancy(tx, q, p, mode);
      case 'matriculas': return (tx, q, p, mode) => this.enrollments(tx, q, p, mode);
      case 'matriculas-por-edicion': return (tx, q, p, mode) => this.enrollmentsByGroup(tx, q, p, mode);
      case 'resumen': return (tx, _q, p, mode) => this.summary(tx, p, mode);
      // Comerciales y de atención: misma estructura {resumen, tabla}; los renderizadores de CSV, XLSX y PDF son los mismos.
      case 'cotizaciones-por-estado': return (tx, q, p) => quotesByState(tx, q, p);
      case 'cotizaciones-vencidas': return (tx, q, p, mode) => expiredQuotes(tx, q, p, mode, now);
      case 'cotizaciones-importes': return (tx, q, p) => quoteAmounts(tx, q, p);
      case 'consultas-por-estado': return (tx, _q, p) => inquiriesByState(tx, p, now);
      case 'consultas-abiertas-antiguas': return (tx, q, p, mode) => oldOpenInquiries(tx, q, p, mode, now);
      case 'actividad-comercial': return (tx, _q, p, mode) => monthlyActivity(tx, p, mode);
    }
  }

  // Filtros legibles del encabezado. Un curso o una edición inexistentes responden 404 (no un reporte vacío engañoso).
  private async filterLabels(tx: Tx, q: Filters): Promise<ReportFilterLabel[]> {
    const labels: ReportFilterLabel[] = [];
    if (q.curso_id !== undefined) {
      const course = await tx.curso.findUnique({ where: { id: q.curso_id }, select: { titulo: true } });
      if (!course) throw new NotFoundException('El curso no existe.');
      labels.push({ clave: 'curso_id', etiqueta: 'Curso', valor: course.titulo });
    }
    if (q.convocatoria_id !== undefined) {
      const edition = await tx.convocatoria.findUnique({ where: { id: q.convocatoria_id }, select: { nombre: true, curso: { select: { titulo: true } } } });
      if (!edition) throw new NotFoundException('La edición no existe.');
      labels.push({ clave: 'convocatoria_id', etiqueta: 'Edición', valor: edition.nombre + ' — ' + edition.curso.titulo });
    }
    if (q.estado !== undefined) labels.push({ clave: 'estado', etiqueta: 'Estado', valor: STATE_LABELS[q.estado] });
    if (q.cumplimiento !== undefined) labels.push({ clave: 'cumplimiento', etiqueta: 'Cumplimiento', valor: COMPLIANCE_LABELS[q.cumplimiento] });
    if (q.archivo !== undefined) labels.push({ clave: 'archivo', etiqueta: 'Archivo', valor: ARCHIVE_LABELS[q.archivo] });
    if (q.moneda !== undefined) labels.push({ clave: 'moneda', etiqueta: 'Moneda', valor: CURRENCY_LABELS[q.moneda] });
    if (q.agrupar !== undefined) labels.push({ clave: 'agrupar', etiqueta: 'Agrupación', valor: GROUPING_LABELS[q.agrupar] });
    return labels;
  }

  // Lee la página pedida o, para exportar, todas las filas por lotes dentro de la misma transacción (instantánea coherente).
  private async rows<T>(mode: BuildMode, total: number, fetch: (skip: number, take: number) => Promise<T[]>): Promise<T[]> {
    if (mode.window) return fetch(mode.window.skip, mode.window.take);
    const all: T[] = [];
    while (all.length < total) {
      const batch = await fetch(all.length, BATCH_SIZE);
      all.push(...batch);
      if (batch.length < BATCH_SIZE) break;
    }
    return all;
  }

  private page<T>(mode: BuildMode, rows: T[]): T[] {
    return mode.window ? rows.slice(mode.window.skip, mode.window.skip + mode.window.take) : rows;
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Estudiantes registrados (activos e inactivos)
  private async students(tx: Tx, q: Filters, p: Period, mode: BuildMode): Promise<Built> {
    const where: Prisma.EstudianteWhereInput = {
      ...createdRange(p),
      ...(q.estado === 'activos' ? { archivado_at: null } : q.estado === 'inactivos' ? { archivado_at: { not: null } } : {}),
    };
    const total = await tx.estudiante.count({ where });
    this.checkRows(total, mode);
    const activos = await tx.estudiante.count({ where: { AND: [where, { archivado_at: null }] } });
    const conVigente = await tx.estudiante.count({ where: { AND: [where, { matriculas: { some: { estado: 'activa' } } }] } });
    const sinDni = await tx.estudiante.count({ where: { AND: [where, { doc_numero: null }] } });
    const items = await this.rows(mode, total, (skip, take) => tx.estudiante.findMany({
      where, orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }, { id: 'asc' }], skip, take,
      select: { id: true, apellidos: true, nombres: true, doc_numero: true, email: true, telefono: true, archivado_at: true, createdAt: true,
        _count: { select: { matriculas: { where: { estado: 'activa' } } } } },
    }));
    return {
      resumen: [
        item('total', 'Estudiantes en el reporte', total), item('activos', 'Activos', activos), item('inactivos', 'Inactivos (archivados)', total - activos),
        item('con_matricula_vigente', 'Con matrícula vigente', conVigente), item('sin_dni', 'Sin DNI registrado', sinDni),
      ],
      tabla: {
        titulo: 'Estudiantes', total_filas: total, totales: null,
        columnas: [
          col('id', 'ID', 'entero', 7), col('apellidos', 'Apellidos', 'texto', 22), col('nombres', 'Nombres', 'texto', 22), col('dni', 'DNI', 'texto', 11),
          col('correo', 'Correo', 'texto', 28), col('telefono', 'Teléfono', 'texto', 15), col('estado', 'Estado', 'texto', 10),
          col('registrado', 'Fecha de registro', 'fecha_hora', 17), col('matriculas_vigentes', 'Matrículas vigentes', 'entero', 11),
        ],
        filas: items.map(row => ({
          id: row.id, apellidos: row.apellidos, nombres: row.nombres, dni: row.doc_numero, correo: row.email, telefono: row.telefono,
          estado: row.archivado_at ? 'Inactivo' : 'Activo', registrado: limaDateTime(row.createdAt), matriculas_vigentes: row._count.matriculas,
        })),
      },
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Ediciones con sus matrículas vigentes y anuladas (base de «ediciones» y «ocupación»). Se calculan en memoria, acotadas.
  private async editionStats(tx: Tx, q: Filters, p: Period, mode: BuildMode): Promise<EditionStat[]> {
    const dated = p.desde || p.hasta;
    const where: Prisma.ConvocatoriaWhereInput = {
      ...(q.curso_id ? { curso_id: q.curso_id } : {}),
      ...(q.convocatoria_id ? { id: q.convocatoria_id } : {}),
      ...(q.estado ? { estado: q.estado as ConvocatoriaEstado } : {}),
      ...(q.archivo === 'activos' ? { archivado_at: null } : q.archivo === 'archivados' ? { archivado_at: { not: null } } : {}),
      // Superposición del período con [fecha_inicio, fecha_fin]; sin fechas, la edición no se puede situar en el período.
      ...(dated ? {
        fecha_inicio: { not: null, ...(p.hasta ? { lte: calendarDate(p.hasta) } : {}) },
        fecha_fin: { not: null, ...(p.desde ? { gte: calendarDate(p.desde) } : {}) },
      } : {}),
    };
    const total = await tx.convocatoria.count({ where });
    this.checkRows(total, { ...mode, maxRows: Math.min(mode.maxRows, MAX_REPORT_ROWS) });
    const editions = await this.rows({ ...mode, window: null }, total, (skip, take) => tx.convocatoria.findMany({
      where, orderBy: { id: 'asc' }, skip, take,
      select: { id: true, nombre: true, fecha_inicio: true, fecha_fin: true, estado: true, capacidad: true, archivado_at: true, curso: { select: { id: true, titulo: true, tipo: true } } },
    }));
    const counts = new Map<number, { activa: number; anulada: number }>();
    for (const ids of chunks(editions.map(edition => edition.id), BATCH_SIZE)) {
      const groups = await tx.matricula.groupBy({ by: ['convocatoria_id', 'estado'], where: { convocatoria_id: { in: ids } }, _count: { _all: true } });
      for (const group of groups) {
        const entry = counts.get(group.convocatoria_id) ?? { activa: 0, anulada: 0 };
        entry[group.estado] += group._count._all;
        counts.set(group.convocatoria_id, entry);
      }
    }
    return editions.map(edition => ({
      id: edition.id, nombre: edition.nombre, curso_id: edition.curso.id, curso: edition.curso.titulo, curso_tipo: COURSE_TYPE_LABELS[edition.curso.tipo] ?? edition.curso.tipo,
      inicio: toCalendar(edition.fecha_inicio), fin: toCalendar(edition.fecha_fin), estado: edition.estado, archivada: edition.archivado_at !== null,
      capacidad: edition.capacidad, vigentes: counts.get(edition.id)?.activa ?? 0, anuladas: counts.get(edition.id)?.anulada ?? 0,
    })).sort((a, b) => byText(a.curso, b.curso) || (a.inicio ?? '9999').localeCompare(b.inicio ?? '9999') || a.id - b.id);
  }

  private async editionsReport(tx: Tx, q: Filters, p: Period, mode: BuildMode): Promise<Built> {
    const stats = await this.editionStats(tx, q, p, mode);
    const byState = (state: string) => stats.filter(edition => edition.estado === state).length;
    const sum = (pick: (edition: EditionStat) => number | null) => stats.reduce((total, edition) => total + (pick(edition) ?? 0), 0);
    const available = (edition: EditionStat) => edition.capacidad === null ? null : Math.max(0, edition.capacidad - edition.vigentes);
    const vigentes = sum(edition => edition.vigentes), anuladas = sum(edition => edition.anuladas);
    return {
      resumen: [
        item('total', 'Ediciones en el reporte', stats.length), item('planificadas', 'Planificadas', byState('planificada')), item('abiertas', 'Abiertas', byState('abierta')),
        item('cerradas', 'Cerradas', byState('cerrada')), item('canceladas', 'Canceladas', byState('cancelada')),
        item('archivadas', 'Archivadas', stats.filter(edition => edition.archivada).length),
        item('matriculas_vigentes', 'Matrículas vigentes', vigentes), item('matriculas_anuladas', 'Matrículas anuladas', anuladas),
      ],
      tabla: {
        titulo: 'Ediciones', total_filas: stats.length,
        columnas: [
          col('id', 'ID', 'entero', 7), col('curso', 'Curso', 'texto', 28), col('tipo', 'Tipo', 'texto', 13), col('edicion', 'Edición', 'texto', 24),
          col('inicio', 'Inicio', 'fecha', 11), col('fin', 'Fin', 'fecha', 11), col('estado', 'Estado', 'texto', 12), col('archivada', 'Archivada', 'texto', 10),
          col('capacidad', 'Capacidad', 'entero', 10), col('vigentes', 'Vigentes', 'entero', 9), col('anuladas', 'Anuladas', 'entero', 9),
          col('disponibles', 'Disponibles', 'entero', 11),
        ],
        filas: this.page(mode, stats).map(edition => ({
          id: edition.id, curso: edition.curso, tipo: edition.curso_tipo, edicion: edition.nombre, inicio: edition.inicio, fin: edition.fin,
          estado: STATE_LABELS[edition.estado] ?? edition.estado, archivada: edition.archivada ? 'Sí' : 'No', capacidad: edition.capacidad,
          vigentes: edition.vigentes, anuladas: edition.anuladas, disponibles: available(edition),
        })),
        totales: stats.length ? {
          id: 'Total', curso: null, tipo: null, edicion: null, inicio: null, fin: null, estado: null, archivada: null,
          capacidad: sum(edition => edition.capacidad), vigentes, anuladas, disponibles: sum(available),
        } : null,
      },
    };
  }

  private async occupancy(tx: Tx, q: Filters, p: Period, mode: BuildMode): Promise<Built> {
    const stats = await this.editionStats(tx, q, p, mode);
    const withCapacity = stats.filter(edition => edition.capacidad !== null);
    const capacity = withCapacity.reduce((total, edition) => total + (edition.capacidad ?? 0), 0);
    const occupied = withCapacity.reduce((total, edition) => total + edition.vigentes, 0);
    const available = withCapacity.reduce((total, edition) => total + Math.max(0, (edition.capacidad ?? 0) - edition.vigentes), 0);
    const vigentes = stats.reduce((total, edition) => total + edition.vigentes, 0);
    const global = percent(occupied, capacity);
    return {
      resumen: [
        item('total', 'Ediciones en el reporte', stats.length), item('con_capacidad', 'Con capacidad definida', withCapacity.length),
        item('sin_capacidad', 'Sin capacidad definida', stats.length - withCapacity.length), item('capacidad', 'Capacidad total (cupos)', capacity),
        item('ocupados', 'Cupos ocupados (vigentes en ediciones con capacidad)', occupied), item('disponibles', 'Cupos disponibles', available),
        item('ocupacion', 'Ocupación global (%)', global, 'decimal'),
        item('completas', 'Ediciones completas', withCapacity.filter(edition => edition.vigentes >= (edition.capacidad ?? 0)).length),
        item('matriculas_vigentes', 'Matrículas vigentes (todas las ediciones)', vigentes),
      ],
      tabla: {
        titulo: 'Ocupación', total_filas: stats.length,
        columnas: [
          col('id', 'ID', 'entero', 7), col('curso', 'Curso', 'texto', 28), col('edicion', 'Edición', 'texto', 24), col('estado', 'Estado', 'texto', 12),
          col('inicio', 'Inicio', 'fecha', 11), col('capacidad', 'Capacidad', 'entero', 10), col('vigentes', 'Vigentes', 'entero', 9),
          col('disponibles', 'Disponibles', 'entero', 11), col('ocupacion', 'Ocupación (%)', 'decimal', 12),
        ],
        filas: this.page(mode, stats).map(edition => ({
          id: edition.id, curso: edition.curso, edicion: edition.nombre, estado: STATE_LABELS[edition.estado] ?? edition.estado, inicio: edition.inicio,
          capacidad: edition.capacidad, vigentes: edition.vigentes,
          disponibles: edition.capacidad === null ? null : Math.max(0, edition.capacidad - edition.vigentes),
          ocupacion: edition.capacidad === null ? null : percent(edition.vigentes, edition.capacidad),
        })),
        totales: stats.length ? {
          id: 'Total', curso: null, edicion: null, estado: null, inicio: null, capacidad: capacity, vigentes, disponibles: available, ocupacion: global,
        } : null,
      },
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Matrículas vigentes y anuladas (detalle)
  private enrollmentWhere(q: Filters, p: Period): Prisma.MatriculaWhereInput {
    return {
      ...createdRange(p),
      ...(q.estado ? { estado: q.estado as MatriculaEstado } : {}),
      ...(q.cumplimiento ? { cumplimiento: q.cumplimiento as MatriculaCumplimiento } : {}),
      ...(q.convocatoria_id ? { convocatoria_id: q.convocatoria_id } : {}),
      ...(q.curso_id ? { convocatoria: { curso_id: q.curso_id } } : {}),
    };
  }

  private async enrollments(tx: Tx, q: Filters, p: Period, mode: BuildMode): Promise<Built> {
    const where = this.enrollmentWhere(q, p);
    const groups = await tx.matricula.groupBy({ by: ['estado', 'cumplimiento'], where, _count: { _all: true } });
    const count = (predicate: (group: (typeof groups)[number]) => boolean) => groups.filter(predicate).reduce((total, group) => total + group._count._all, 0);
    const total = count(() => true);
    this.checkRows(total, mode);
    const items = await this.rows(mode, total, (skip, take) => tx.matricula.findMany({
      where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip, take,
      select: { id: true, createdAt: true, estado: true, cumplimiento: true, estudiante: { select: { apellidos: true, nombres: true, doc_numero: true } },
        convocatoria: { select: { nombre: true, curso: { select: { titulo: true } } } } },
    }));
    return {
      resumen: [
        item('total', 'Matrículas en el reporte', total), item('vigentes', 'Vigentes', count(group => group.estado === 'activa')),
        item('anuladas', 'Anuladas', count(group => group.estado === 'anulada')),
        item('pendientes', 'Cumplimiento pendiente', count(group => group.cumplimiento === 'pendiente')),
        item('cumplidas', 'Cumplimiento confirmado', count(group => group.cumplimiento === 'cumplido')),
        item('no_cumplidas', 'No cumplido', count(group => group.cumplimiento === 'no_cumplido')),
      ],
      tabla: {
        titulo: 'Matrículas', total_filas: total, totales: null,
        columnas: [
          col('id', 'ID', 'entero', 7), col('fecha', 'Fecha de matrícula', 'fecha_hora', 17), col('apellidos', 'Apellidos', 'texto', 20),
          col('nombres', 'Nombres', 'texto', 20), col('dni', 'DNI', 'texto', 11), col('curso', 'Curso', 'texto', 26), col('edicion', 'Edición', 'texto', 22),
          col('estado', 'Estado', 'texto', 10), col('cumplimiento', 'Cumplimiento', 'texto', 13),
        ],
        filas: items.map(row => ({
          id: row.id, fecha: limaDateTime(row.createdAt), apellidos: row.estudiante.apellidos, nombres: row.estudiante.nombres, dni: row.estudiante.doc_numero,
          curso: row.convocatoria.curso.titulo, edicion: row.convocatoria.nombre, estado: STATE_LABELS[row.estado] ?? row.estado,
          cumplimiento: COMPLIANCE_LABELS[row.cumplimiento] ?? row.cumplimiento,
        })),
      },
    };
  }

  // Matrículas por curso o por edición (agregado)
  private async enrollmentsByGroup(tx: Tx, q: Filters, p: Period, mode: BuildMode): Promise<Built> {
    const groups = await tx.matricula.groupBy({ by: ['convocatoria_id', 'estado'], where: this.enrollmentWhere(q, p), _count: { _all: true } });
    const ids = [...new Set(groups.map(group => group.convocatoria_id))];
    this.checkRows(ids.length, mode);
    const editions = new Map<number, { nombre: string; inicio: string | null; estado: string; curso_id: number; curso: string; tipo: string }>();
    for (const chunk of chunks(ids, BATCH_SIZE)) {
      for (const edition of await tx.convocatoria.findMany({ where: { id: { in: chunk } }, select: { id: true, nombre: true, fecha_inicio: true, estado: true, curso: { select: { id: true, titulo: true, tipo: true } } } })) {
        editions.set(edition.id, { nombre: edition.nombre, inicio: toCalendar(edition.fecha_inicio), estado: edition.estado, curso_id: edition.curso.id, curso: edition.curso.titulo, tipo: COURSE_TYPE_LABELS[edition.curso.tipo] ?? edition.curso.tipo });
      }
    }
    const perEdition = new Map<number, { vigentes: number; anuladas: number }>();
    for (const group of groups) {
      const entry = perEdition.get(group.convocatoria_id) ?? { vigentes: 0, anuladas: 0 };
      if (group.estado === 'activa') entry.vigentes += group._count._all; else entry.anuladas += group._count._all;
      perEdition.set(group.convocatoria_id, entry);
    }
    const editionRows = ids.map(id => ({ id, ...editions.get(id)!, ...perEdition.get(id)! }))
      .sort((a, b) => byText(a.curso, b.curso) || (a.inicio ?? '9999').localeCompare(b.inicio ?? '9999') || a.id - b.id);
    const vigentes = editionRows.reduce((total, row) => total + row.vigentes, 0);
    const anuladas = editionRows.reduce((total, row) => total + row.anuladas, 0);
    const courses = new Map<number, { curso: string; tipo: string; ediciones: number; vigentes: number; anuladas: number }>();
    for (const row of editionRows) {
      const entry = courses.get(row.curso_id) ?? { curso: row.curso, tipo: row.tipo, ediciones: 0, vigentes: 0, anuladas: 0 };
      entry.ediciones += 1; entry.vigentes += row.vigentes; entry.anuladas += row.anuladas;
      courses.set(row.curso_id, entry);
    }
    const resumen = [
      item('total', 'Matrículas en el reporte', vigentes + anuladas), item('vigentes', 'Vigentes', vigentes), item('anuladas', 'Anuladas', anuladas),
      item('cursos', 'Cursos con matrículas', courses.size), item('ediciones', 'Ediciones con matrículas', editionRows.length),
    ];
    if (q.agrupar === 'curso') {
      const rows = [...courses.values()].sort((a, b) => byText(a.curso, b.curso));
      return {
        resumen,
        tabla: {
          titulo: 'Matrículas por curso', total_filas: rows.length,
          columnas: [col('curso', 'Curso', 'texto', 32), col('tipo', 'Tipo', 'texto', 13), col('ediciones', 'Ediciones', 'entero', 10),
            col('vigentes', 'Vigentes', 'entero', 10), col('anuladas', 'Anuladas', 'entero', 10), col('total', 'Total', 'entero', 10)],
          filas: this.page(mode, rows).map(row => ({ curso: row.curso, tipo: row.tipo, ediciones: row.ediciones, vigentes: row.vigentes, anuladas: row.anuladas, total: row.vigentes + row.anuladas })),
          totales: rows.length ? { curso: 'Total', tipo: null, ediciones: editionRows.length, vigentes, anuladas, total: vigentes + anuladas } : null,
        },
      };
    }
    return {
      resumen,
      tabla: {
        titulo: 'Matrículas por edición', total_filas: editionRows.length,
        columnas: [col('curso', 'Curso', 'texto', 28), col('edicion', 'Edición', 'texto', 24), col('inicio', 'Inicio', 'fecha', 11),
          col('estado', 'Estado de la edición', 'texto', 13), col('vigentes', 'Vigentes', 'entero', 10), col('anuladas', 'Anuladas', 'entero', 10), col('total', 'Total', 'entero', 10)],
        filas: this.page(mode, editionRows).map(row => ({ curso: row.curso, edicion: row.nombre, inicio: row.inicio, estado: STATE_LABELS[row.estado] ?? row.estado,
          vigentes: row.vigentes, anuladas: row.anuladas, total: row.vigentes + row.anuladas })),
        totales: editionRows.length ? { curso: 'Total', edicion: null, inicio: null, estado: null, vigentes, anuladas, total: vigentes + anuladas } : null,
      },
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Resumen general por período: indicadores y serie mensual (meses de Lima).
  private async summary(tx: Tx, p: Period, mode: BuildMode): Promise<Built> {
    const from = p.fromUtc!, to = p.toUtc!;
    const month = Prisma.sql`DATE_FORMAT(DATE_SUB(createdAt, INTERVAL ${LIMA_OFFSET_HOURS} HOUR), '%Y-%m')`;
    const students = await tx.$queryRaw<{ mes: string; total: bigint | number }[]>(Prisma.sql`SELECT ${month} AS mes, COUNT(*) AS total
      FROM estudiantes WHERE createdAt >= ${from} AND createdAt < ${to} GROUP BY mes`);
    const enrollments = await tx.$queryRaw<{ mes: string; total: bigint | number; vigentes: bigint | number | null }[]>(Prisma.sql`SELECT ${month} AS mes,
      COUNT(*) AS total, SUM(CASE WHEN estado = ${'activa'} THEN 1 ELSE 0 END) AS vigentes
      FROM matriculas WHERE createdAt >= ${from} AND createdAt < ${to} GROUP BY mes`);
    const studentsByMonth = new Map(students.map(row => [String(row.mes), n(row.total)]));
    const enrollmentsByMonth = new Map(enrollments.map(row => [String(row.mes), { total: n(row.total), vigentes: n(row.vigentes) }]));
    const series = monthsBetween(p.desde!, p.hasta!).map(mes => {
      const enrollment = enrollmentsByMonth.get(mes) ?? { total: 0, vigentes: 0 };
      return { mes, estudiantes: studentsByMonth.get(mes) ?? 0, matriculas: enrollment.total, vigentes: enrollment.vigentes, anuladas: enrollment.total - enrollment.vigentes };
    });
    const sum = (key: 'estudiantes' | 'matriculas' | 'vigentes' | 'anuladas') => series.reduce((total, row) => total + row[key], 0);
    const startingEditions = await tx.convocatoria.count({ where: { fecha_inicio: { gte: calendarDate(p.desde!), lte: calendarDate(p.hasta!) } } });
    const activeStudents = await tx.estudiante.count({ where: { archivado_at: null } });
    const inactiveStudents = await tx.estudiante.count({ where: { archivado_at: { not: null } } });
    const openEditions = await tx.convocatoria.count({ where: OPEN_EDITIONS_WHERE });
    const openCapacity = await tx.convocatoria.aggregate({ where: { AND: [OPEN_EDITIONS_WHERE, { capacidad: { not: null } }] }, _sum: { capacidad: true } });
    const openOccupied = await tx.matricula.count({ where: { estado: 'activa', convocatoria: { AND: [OPEN_EDITIONS_WHERE, { capacidad: { not: null } }] } } });
    return {
      resumen: [
        item('estudiantes_registrados', 'Estudiantes registrados en el período', sum('estudiantes')),
        item('matriculas_registradas', 'Matrículas registradas en el período', sum('matriculas')),
        item('matriculas_vigentes', 'De ellas, vigentes', sum('vigentes')), item('matriculas_anuladas', 'De ellas, anuladas', sum('anuladas')),
        item('ediciones_iniciadas', 'Ediciones que inician en el período', startingEditions),
        item('estudiantes_activos', 'Estudiantes activos (al generar)', activeStudents), item('estudiantes_inactivos', 'Estudiantes inactivos (al generar)', inactiveStudents),
        item('ediciones_abiertas', 'Ediciones abiertas (al generar)', openEditions),
        item('ocupacion_abiertas', 'Ocupación de ediciones abiertas (%) (al generar)', percent(openOccupied, n(openCapacity._sum.capacidad)), 'decimal'),
      ],
      tabla: {
        titulo: 'Serie mensual', total_filas: series.length,
        columnas: [col('mes', 'Mes', 'texto', 10), col('estudiantes', 'Estudiantes registrados', 'entero', 14), col('matriculas', 'Matrículas registradas', 'entero', 14),
          col('vigentes', 'Vigentes', 'entero', 10), col('anuladas', 'Anuladas', 'entero', 10)],
        filas: this.page(mode, series as unknown as ReportRow[]),
        totales: { mes: 'Total', estudiantes: sum('estudiantes'), matriculas: sum('matriculas'), vigentes: sum('vigentes'), anuladas: sum('anuladas') },
      },
    };
  }
}
