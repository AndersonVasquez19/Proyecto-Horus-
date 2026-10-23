import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { createValidationPipe } from '../src/common/validation';
import { PrismaService } from '../src/database/prisma.service';
import { CODE_PATTERN, normalizeCode, publicView } from '../src/certificados/certificados.rules';
import { CertificadosService } from '../src/certificados/certificados.service';
import { ConfirmarCumplimientoDto } from '../src/matriculas/matriculas.dto';
import { MatriculasService } from '../src/matriculas/matriculas.service';

type Dto = new () => object;
const validate = (body: unknown, metatype: Dto, type: 'body' | 'query' = 'body') => createValidationPipe().transform(body, { type, metatype }) as Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------------------------------------------------------------
// Base de datos simulada en memoria: solo lo que usan los servicios. Registra el orden de bloqueos y el historial.
// ---------------------------------------------------------------------------------------------------------------------------------
type Row = Record<string, any>;
function world(overrides: { matricula?: Row; estudiante?: Row; convocatoria?: Row; roles?: Record<number, string | null>; certificados?: Row[] } = {}) {
  const state = {
    estudiante: { nombres: 'Ana', apellidos: 'Quispe', doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '01234567', ...overrides.estudiante },
    convocatoria: { estado: 'cerrada', nombre: 'Edición 1', fecha_inicio: new Date('2026-11-01T00:00:00Z'), fecha_fin: new Date('2026-11-30T00:00:00Z'),
      curso: { titulo: 'Excel', tipo: 'curso', duracion: '20 horas' }, ...overrides.convocatoria },
    matricula: { id: 7, estudiante_id: 3, convocatoria_id: 5, estado: 'activa', cumplimiento: 'cumplido', revision: 4, confirmado_por: 1, confirmado_rol: 'GERENTE_GENERAL', confirmado_at: new Date(), ...overrides.matricula },
    roles: { 1: 'GERENTE_GENERAL', 2: 'COORDINADORA_INSTITUCIONAL', 3: 'SECRETARIA', ...overrides.roles } as Record<number, string | null>,
    certificados: (overrides.certificados ?? []) as Row[],
    history: [] as Row[], locks: [] as string[], matriculaUpdates: [] as Row[],
  };
  const nextId = () => state.certificados.reduce((max, c) => Math.max(max, c.id), 0) + 1;
  const matchesWhere = (c: Row, where: Row = {}) => Object.entries(where).every(([key, value]) => c[key] === value);
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => { state.locks.push(strings.join('?').replace(/\s+/g, ' ').match(/FROM (\w+)/)![1]); return [{ id: 1, archivado_at: null }]; },
    convocatoria: { findUnique: async () => ({ curso_id: 9 }), findUniqueOrThrow: async () => ({ id: 5, ...state.convocatoria }) },
    adminUser: { findUniqueOrThrow: async ({ where }: Row) => ({ rol: state.roles[where.id] }) },
    matricula: {
      findUnique: async ({ where }: Row) => where.id === state.matricula.id ? { estudiante_id: state.matricula.estudiante_id, convocatoria_id: state.matricula.convocatoria_id, convocatoria: { id: 5, curso_id: 9 } } : null,
      findUniqueOrThrow: async () => ({ ...state.matricula, estudiante: state.estudiante, convocatoria: state.convocatoria }),
      update: async ({ data }: Row) => {
        state.matriculaUpdates.push(data);
        const { revision, ...rest } = data;
        Object.assign(state.matricula, rest, { revision: state.matricula.revision + (revision?.increment ?? 0) });
        return { ...state.matricula, estudiante: state.estudiante, convocatoria: { ...state.convocatoria, fecha_inicio: null, fecha_fin: null } };
      },
    },
    certificado: {
      count: async ({ where }: Row) => state.certificados.filter(c => matchesWhere(c, where)).length,
      findUnique: async ({ where }: Row) => state.certificados.find(c => matchesWhere(c, where)) ?? null,
      findUniqueOrThrow: async ({ where }: Row) => state.certificados.find(c => c.id === where.id)!,
      create: async ({ data }: Row) => { const row = { id: nextId(), estado: 'vigente', emitido_at: new Date(), anulado_por: null, anulado_at: null, anulacion_motivo: null, ...data }; state.certificados.push(row); return row; },
      update: async ({ where, data }: Row) => Object.assign(state.certificados.find(c => c.id === where.id)!, data),
    },
    academicoHistorial: { create: async ({ data }: Row) => { state.history.push(data); } },
  };
  const prisma = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx), certificado: { findUnique: async (args: Row) => tx.certificado.findUnique(args) } };
  return { state, prisma: prisma as unknown as PrismaService };
}
const cert = (extra: Row = {}) => ({ id: 1, matricula_id: 7, codigo_verificacion: 'ABCDEFGHJKLMNPQRSTUV', estado: 'vigente', estudiante_nombres: 'Ana', estudiante_apellidos: 'Quispe', estudiante_doc_pais: 'PE', estudiante_doc_tipo: 'DNI', estudiante_doc_numero: '01234567',
  curso_titulo: 'Excel', curso_tipo: 'curso', curso_duracion: null, convocatoria_nombre: 'Edición 1', convocatoria_fecha_inicio: null, convocatoria_fecha_fin: null, emitido_por: 1, emitido_at: new Date(), anulado_por: null, anulado_at: null, anulacion_motivo: null, sustituye_a_id: null, ...extra });

// ---------------------------------------------------------------------------------------------------------------------------------
// Reglas puras
// ---------------------------------------------------------------------------------------------------------------------------------
test('Certificados/código: la entrada pública se normaliza y los formatos imposibles se descartan sin consultar', () => {
  assert.equal(normalizeCode('  abcdefghjklmnpqrstuv '), 'ABCDEFGHJKLMNPQRSTUV'); assert.match(normalizeCode('abcdefghjklmnpqrstuv')!, CODE_PATTERN);
  for (const bad of [undefined, null, 5, {}, [], '', 'ABC', 'ABCDEFGHJKLMNPQRSTUV!', "ABCDEFGHJKLMNPQR' OR 1=1", 'A'.repeat(33), 'A'.repeat(500), 'ÁBCDEFGHJKLMNPQRSTUV']) assert.equal(normalizeCode(bad), null, String(bad));
});
test('Certificados/vista pública: nombre, curso y fechas; nunca el DNI, el motivo ni identificadores', () => {
  const row = { ...cert({ estado: 'anulado', anulacion_motivo: 'secreto', curso_duracion: '20 horas', convocatoria_fecha_inicio: new Date('2026-11-01T00:00:00Z') }), sustituido_por: { id: 2 } };
  const view = publicView(row);
  assert.equal(view.valido, false); assert.equal(view.sustituido, true); assert.equal(view.estudiante, 'Ana Quispe');
  assert.equal(view.convocatoria.fecha_inicio, '2026-11-01');
  const text = JSON.stringify(view);
  for (const leak of ['01234567', 'secreto', 'ABCDEFGHJKLMNPQRSTUV', 'emitido_por', 'matricula_id']) assert.ok(!text.includes(leak), leak);
  assert.equal(publicView({ ...row, estado: 'vigente', sustituido_por: null }).valido, true);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------------------------------------------
test('Matrículas/DTO: la confirmación solo admite los tres estados, revisión entera y motivo normalizado', async () => {
  assert.deepEqual({ ...await validate({ revision: 2, cumplimiento: 'cumplido' }, ConfirmarCumplimientoDto) }, { revision: 2, cumplimiento: 'cumplido' });
  assert.equal((await validate({ revision: 2, cumplimiento: 'pendiente', motivo: '  Error ' }, ConfirmarCumplimientoDto)).motivo, 'Error');
  for (const body of [{ revision: 2 }, { cumplimiento: 'cumplido' }, { revision: 2, cumplimiento: 'aprobado' }, { revision: '2', cumplimiento: 'cumplido' }, { revision: 2, cumplimiento: 'cumplido', motivo: ' ' },
    { revision: 2, cumplimiento: 'cumplido', motivo: 'a'.repeat(301) }, { revision: 2, cumplimiento: 'cumplido', confirmado_por: 1 }, { revision: 2, cumplimiento: 'cumplido', confirmado_rol: 'SECRETARIA' }, { revision: 2, cumplimiento: 'cumplido', nota: 18 }]) {
    await assert.rejects(validate(body, ConfirmarCumplimientoDto), BadRequestException, JSON.stringify(body));
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Servicio de certificados
// ---------------------------------------------------------------------------------------------------------------------------------

test('Certificados/verificar: código inexistente y mal formado dan el mismo 404; el vigente responde sin DNI', async () => {
  const { prisma } = world({ certificados: [{ ...cert(), sustituido_por: null }] });
  const service = new CertificadosService(prisma);
  const messages = new Set<string>();
  for (const code of ['AAAAAAAAAAAAAAAAAAAA', 'corto', "x'; DROP TABLE certificados;--", undefined]) {
    await assert.rejects(service.verify(code), (e: Error) => { messages.add(e.message); return e instanceof NotFoundException; });
  }
  assert.equal(messages.size, 1);
  const found = await service.verify('abcdefghjklmnpqrstuv');
  assert.deepEqual([found.ok, found.valido, found.estudiante], [true, true, 'Ana Quispe']);
  assert.ok(!JSON.stringify(found).includes('01234567'));
});
test('Certificados/verificar: errores de base de datos se traducen sin filtrar detalles', async () => {
  const code = 'ABCDEFGHJKLMNPQRSTUV';
  const failing = (errorCode: string) => new CertificadosService({ certificado: { findUnique: async () => { throw new PrismaClientKnownRequestError('SELECT secreto FROM tabla', { code: errorCode, clientVersion: '6.19.3' }); } } } as unknown as PrismaService);
  await assert.rejects(failing('P2021').verify(code), (e: Error) => e instanceof ServiceUnavailableException && !e.message.includes('SELECT'));
  await assert.rejects(new CertificadosService({ certificado: { findUnique: async () => null } } as unknown as PrismaService).verify(code), NotFoundException);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Matrículas: confirmación de cumplimiento
// ---------------------------------------------------------------------------------------------------------------------------------
const confirmWorld = (patch: Row = {}) => { const w = world({ ...patch, matricula: { cumplimiento: 'pendiente', confirmado_por: null, confirmado_rol: null, confirmado_at: null, ...patch.matricula } }); return { ...w, service: new MatriculasService(w.prisma) }; };
test('Matrículas/confirmar: registra quién, con qué rol y cuándo; sube la revisión y deja historial sin datos personales', async () => {
  const { state, service } = confirmWorld();
  const { item } = await service.confirm(7, { revision: 4, cumplimiento: 'cumplido' }, 2);
  assert.deepEqual([item.cumplimiento, item.confirmado_por, item.confirmado_rol, item.revision], ['cumplido', 2, 'COORDINADORA_INSTITUCIONAL', 5]); assert.ok(item.confirmado_at instanceof Date);
  assert.deepEqual(state.locks, ['cursos', 'convocatorias', 'estudiantes', 'matriculas']);
  assert.deepEqual([state.history[0].operacion, state.history[0].estado_anterior, state.history[0].estado_nuevo, state.history[0].revision], ['confirmacion', 'pendiente', 'cumplido', 5]);
});
test('Matrículas/confirmar: la secretaria y una cuenta sin rol reciben 403 y nada cambia', async () => {
  for (const actor of [3, 4]) {
    const { state, service } = confirmWorld({ roles: { 4: null } });
    await assert.rejects(service.confirm(7, { revision: 4, cumplimiento: 'cumplido' }, actor), ForbiddenException);
    assert.equal(state.matriculaUpdates.length, 0); assert.equal(state.history.length, 0);
  }
});
test('Matrículas/confirmar: revisión vieja, matrícula anulada, mismo valor y certificado vigente dan 409; corregir exige motivo', async () => {
  await assert.rejects(confirmWorld().service.confirm(7, { revision: 3, cumplimiento: 'cumplido' }, 1), ConflictException);
  await assert.rejects(confirmWorld({ matricula: { estado: 'anulada' } }).service.confirm(7, { revision: 4, cumplimiento: 'cumplido' }, 1), ConflictException);
  await assert.rejects(confirmWorld().service.confirm(7, { revision: 4, cumplimiento: 'pendiente' }, 1), ConflictException);
  await assert.rejects(confirmWorld({ matricula: { cumplimiento: 'cumplido' } }).service.confirm(7, { revision: 4, cumplimiento: 'no_cumplido' }, 1), BadRequestException);
  await assert.rejects(confirmWorld({ certificados: [cert()] }).service.confirm(7, { revision: 4, cumplimiento: 'cumplido' }, 1), (e: Error) => e instanceof ConflictException && /certificado vigente/.test(e.message));
  await assert.rejects(confirmWorld().service.confirm(99, { revision: 4, cumplimiento: 'cumplido' }, 1), NotFoundException);
});
test('Matrículas/confirmar: corregir con motivo funciona; volver a pendiente borra al confirmador (lo exige el CHECK de MySQL)', async () => {
  const { state, service } = confirmWorld({ matricula: { cumplimiento: 'cumplido', confirmado_por: 1, confirmado_rol: 'GERENTE_GENERAL', confirmado_at: new Date() } });
  const { item } = await service.confirm(7, { revision: 4, cumplimiento: 'pendiente', motivo: 'Confirmado por error' }, 1);
  assert.deepEqual([item.cumplimiento, item.confirmado_por, item.confirmado_rol, item.confirmado_at], ['pendiente', null, null, null]);
  assert.equal(state.history[0].motivo, 'Confirmado por error');
});
