import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { StatsController } from '../src/admin/stats/stats.controller';
import { StatsService } from '../src/admin/stats/stats.service';
import { preinscripcionesStats } from '../src/admin/stats/stats.academic';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { can } from '../src/permissions/policy';
import type { CatalogoService } from '../src/catalogo/catalogo.service';
import type { PrismaService } from '../src/database/prisma.service';

// Prisma en memoria que interpreta SOLO los filtros que usa el resumen (igualdad, not, in, none, isNot, relaciones, AND). Así las
// pruebas ejercitan las reglas reales de elegibilidad y no valores fijos. Solo existen count y groupBy: si el resumen intentara leer
// filas (findMany/select) con datos personales, fallaría.
type Row = Record<string, any>;
const OPERATORS = new Set(['not', 'in', 'none', 'isNot']);
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Row[]).every(part => matches(row, part));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (typeof cond === 'object' && !(cond instanceof Date)) {
      const keys = Object.keys(cond);
      if (keys.length && keys.every(k => OPERATORS.has(k))) {
        if ('not' in cond && !(typeof cond.not === 'object' && cond.not !== null ? !matches({ v: value }, { v: cond.not }) : (value ?? null) !== cond.not)) return false;
        if ('in' in cond && !cond.in.includes(value)) return false;
        if ('none' in cond && (value as Row[]).some(related => matches(related, cond.none))) return false;
        if ('isNot' in cond && (cond.isNot === null ? value === null || value === undefined : matches(value, cond.isNot))) return false;
        return true;
      }
      return value !== null && value !== undefined && matches(value, cond);
    }
    return value === cond;
  });
}
const table = (rows: Row[]) => ({
  count: async ({ where }: { where?: Row } = {}) => rows.filter(row => matches(row, where)).length,
  groupBy: async ({ by, where }: { by: string[]; where?: Row }) => {
    const groups = new Map<string, Row>();
    for (const row of rows.filter(r => matches(r, where))) {
      const key = by.map(field => row[field]).join('|');
      const group = groups.get(key) ?? { ...Object.fromEntries(by.map(field => [field, row[field]])), _count: { _all: 0 } };
      group._count._all += 1;
      groups.set(key, group);
    }
    return [...groups.values()];
  },
});
const world = (data: { preinscripciones?: Row[]; certificados?: Row[]; matriculas?: Row[] }) => ({
  preinscripcion: table(data.preinscripciones ?? []), certificado: table(data.certificados ?? []), matricula: table(data.matriculas ?? []),
}) as unknown as PrismaService;

const edition = (estado = 'abierta', archivado_at: Date | null = null) => ({ estado, archivado_at });
const pre = (estado: string, ed = edition()) => ({ estado, convocatoria: ed });
const DNI = { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '12345678' };
const NO_DNI = { doc_pais: null, doc_tipo: null, doc_numero: null };
const enrollment = (over: Row = {}) => ({ estado: 'activa', cumplimiento: 'cumplido', certificados: [], convocatoria: edition(), estudiante: DNI, ...over });

test('preinscripciones: conteos por estado, vigentes y pendientes de revisión con el significado real de cada estado', async () => {
  const stats = await preinscripcionesStats(world({ preinscripciones: [
    pre('recibida'), pre('recibida'), pre('recibida', edition('planificada')),
    pre('recibida', edition('cerrada')), pre('recibida', edition('cancelada')), // no se pueden validar: no son trabajo pendiente
    pre('validada'), pre('validada'),
    pre('matriculada'), pre('descartada'), pre('desistida'), pre('desistida'),
  ] }));
  assert.deepEqual(stats, { total: 11, vigentes: 10 - 2, recibidas: 5, pendientesRevision: 3, validadas: 2, convertidas: 1, descartadas: 1, desistidas: 2 });
  assert.equal(stats!.vigentes, stats!.recibidas + stats!.validadas + stats!.convertidas, 'vigentes = recibida + validada + matriculada');
  assert.equal(stats!.total, stats!.vigentes + stats!.descartadas + stats!.desistidas);
});

test('preinscripciones: las ediciones archivadas quedan fuera de todos los indicadores del bloque (mismo alcance)', async () => {
  const archived = edition('abierta', new Date('2026-01-01T00:00:00Z'));
  const stats = await preinscripcionesStats(world({ preinscripciones: [pre('recibida'), pre('recibida', archived), pre('validada', archived), pre('matriculada', archived)] }));
  assert.deepEqual(stats, { total: 1, vigentes: 1, recibidas: 1, pendientesRevision: 1, validadas: 0, convertidas: 0, descartadas: 0, desistidas: 0 });
});

test('preinscripciones: el mínimo de 10 no abre ninguna edición ni aparece como autorización en el resumen', async () => {
  const stats = await preinscripcionesStats(world({ preinscripciones: Array.from({ length: 12 }, () => pre('validada', edition('planificada'))) }));
  assert.equal(stats!.validadas, 12);
  assert.deepEqual(Object.keys(stats!).sort(), ['convertidas', 'descartadas', 'desistidas', 'pendientesRevision', 'recibidas', 'total', 'validadas', 'vigentes']);
});

test('bloques vacíos devuelven ceros y estructura pendiente (tablas ausentes) devuelve null sin romper el resumen', async () => {
  const empty = world({});
  assert.deepEqual(await preinscripcionesStats(empty), { total: 0, vigentes: 0, recibidas: 0, pendientesRevision: 0, validadas: 0, convertidas: 0, descartadas: 0, desistidas: 0 });
  const outdated = new Prisma.PrismaClientKnownRequestError('tabla inexistente', { code: 'P2021', clientVersion: 'test' });
  const missing = { preinscripcion: { groupBy: async () => { throw outdated; }, count: async () => 0 }, certificado: { groupBy: async () => { throw outdated; }, count: async () => 0 }, matricula: { count: async () => 0 } } as unknown as PrismaService;
  assert.equal(await preinscripcionesStats(missing), null);
  const broken = { preinscripcion: { groupBy: async () => { throw new Error('caída'); }, count: async () => 0 } } as unknown as PrismaService;
  await assert.rejects(preinscripcionesStats(broken), /caída/); // un error real no se disfraza de «sin datos»
});

test('resumen operativo: incluye preinscripciones, conserva academico y mensajes y ya no trae certificados; sin datos personales', async () => {
  const SECRETS = ['Zoila', 'Quispe', 'zoila@example.test', '987654321', '12345678'];
  const prisma = Object.assign(world({
    preinscripciones: [{ ...pre('recibida'), nombres: 'Zoila', apellidos: 'Quispe', email: 'zoila@example.test', telefono: '987654321' }],
    certificados: [{ estado: 'vigente', sustituido_por: null, estudiante_nombres: 'Zoila', estudiante_doc_numero: '12345678' }],
    matriculas: [enrollment({ estudiante: { ...DNI, nombres: 'Zoila', apellidos: 'Quispe' } })],
  }), {
    estudiante: { count: async () => 1 }, convocatoria: { count: async () => 1 },
    $queryRaw: async (q: { sql: string }) => /COUNT\(\*\)/.test(q.sql) ? [{ total: 0, nuevo: 0, en_proceso: 0, atendido: 0, archivado: 0 }] : [],
  }) as unknown as PrismaService;
  // matricula necesita además groupBy (ya lo provee table): reutiliza el mismo.
  const result = await new StatsService({} as CatalogoService, prisma).getOperationalStats();
  assert.deepEqual(Object.keys(result.stats).sort(), ['academico', 'mensajes', 'preinscripciones'], 'el bloque de certificados se retiró del Resumen');
  assert.equal(result.stats.preinscripciones!.pendientesRevision, 1);
  const json = JSON.stringify(result);
  for (const secret of SECRETS) assert.equal(json.includes(secret), false, 'el resumen no debe contener datos personales');
  const numbers = (block: object) => Object.values(block).every(value => Number.isSafeInteger(value) && value >= 0);
  assert.ok(numbers(result.stats.preinscripciones!), 'solo conteos enteros no negativos');
});

test('permisos: la vista exige estadisticas:leer y quien la tiene ya puede leer preinscripciones', () => {
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, StatsController.prototype.getDashboardStats), { kind: 'permiso', permission: 'estadisticas:leer' });
  for (const role of ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL']) {
    for (const permission of ['estadisticas:leer', 'preinscripciones:leer']) assert.equal(can(role, permission), true, role + ' ' + permission);
  }
  // Secretaría y cuentas sin rol no acceden al resumen (no se amplía ningún permiso).
  assert.equal(can('SECRETARIA', 'estadisticas:leer'), false);
  assert.equal(can(null, 'estadisticas:leer'), false);
});
