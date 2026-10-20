import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { createValidationPipe } from '../src/common/validation';
import { AsignacionesQueryDto, CreateAsignacionDto, CreateDocenteDto, DocenteAsignacionesQueryDto, DocentesQueryDto, EstadoDocenteDto, ReactivacionAsignacionDto, RetiroAsignacionDto, RolAsignacionDto, SustitucionAsignacionDto, UpdateDocenteDto } from '../src/docentes/docentes.dto';
import { AsignacionesService, viewAsignacion } from '../src/docentes/asignaciones.service';
import { DocentesService, viewDocente } from '../src/docentes/docentes.service';
import { assertEditionAcceptsTeachers, assertTeacherActive, changedFieldNames } from '../src/docentes/docentes.rules';
import { PrismaService } from '../src/database/prisma.service';

type Dto = new () => object;
const validate = (body: unknown, metatype: Dto, type: 'body' | 'query' = 'body') => createValidationPipe().transform(body, { type, metatype }) as Promise<Record<string, unknown>>;
const valid = { nombres: 'Ana', apellidos: 'Pérez' };
const prismaError = (code: string) => new PrismaClientKnownRequestError('Detalle SQL privado de prueba', { code, clientVersion: '6.19.3' });

test('Docentes: alta normaliza nombres y contacto y solo exige nombres y apellidos', async () => {
  const dto = await validate({ nombres: '  Ana \n  María ', apellidos: ' Pérez   Soto ', email: ' ANA@Example.TEST ', especialidad: '  Excel   avanzado ', telefono: ' 976 543 210 ' }, CreateDocenteDto);
  assert.equal(dto.nombres, 'Ana María'); assert.equal(dto.apellidos, 'Pérez Soto'); assert.equal(dto.email, 'ana@example.test');
  assert.equal(dto.especialidad, 'Excel avanzado'); assert.equal(dto.telefono, '976 543 210');
  await validate(valid, CreateDocenteDto);
  await validate({ ...valid, doc_numero: '00123456', email: '', telefono: '', especialidad: '', profesion: '', confirmar_homonimo: true }, CreateDocenteDto);
  await validate({ nombres: 'A', apellidos: 'B' }, CreateDocenteDto); // sin longitudes mínimas inventadas
});

test('Docentes: alta rechaza campos inválidos y ajenos (cuenta, rol, estado, revisión) sin convertirlos', async () => {
  for (const patch of [
    { nombres: '' }, { nombres: '   ' }, { apellidos: null }, { nombres: 'x'.repeat(121) }, { especialidad: 'x'.repeat(121) }, { profesion: 'x'.repeat(121) },
    { doc_numero: 12345678 }, { doc_numero: '1234567' }, { doc_numero: '12345678\n' }, { doc_numero: ' 12345678' }, { doc_numero: '１２３４５６７８' }, { doc_numero: 'ABCDEFGH' },
    { email: 'no-es-correo' }, { email: null }, { telefono: 'abc' }, { telefono: null }, { especialidad: null }, { confirmar_homonimo: 'si' }, { confirmar_homonimo: null },
    { activo: false }, { revision: 3 }, { password: 'Clave-ficticia-1' }, { rol: 'GERENTE_GENERAL' }, { usuario_id: 1 }, { doc_pais: 'PE' }, { doc_tipo: 'DNI' }, { id: 9 },
  ]) await assert.rejects(validate({ ...valid, ...patch }, CreateDocenteDto), BadRequestException, JSON.stringify(patch));
});

test('Docentes: edición exige revisión y un campo; vacío limpia lo opcional y no los obligatorios', async () => {
  await validate({ revision: 1, email: '', telefono: '', especialidad: '', profesion: '', doc_numero: '' }, UpdateDocenteDto);
  const dto = await validate({ revision: 2, apellidos: '  Pérez   Gómez ' }, UpdateDocenteDto);
  assert.equal(dto.apellidos, 'Pérez Gómez');
  for (const body of [{ nombres: 'Otro' }, { revision: '1' }, { revision: 0 }, { revision: 1, nombres: '' }, { revision: 1, apellidos: null }, { revision: 1, email: null }, { revision: 1, activo: false }, { revision: 1, doc_numero: '123' }, { revision: 1, confirmar_homonimo: true }, { revision: 1, doc_pais: 'PE' }])
    await assert.rejects(validate(body, UpdateDocenteDto), BadRequestException, JSON.stringify(body));
  const service = new DocentesService({} as PrismaService);
  assert.throws(() => service.update(1, { revision: 1 }, 1), BadRequestException, 'una edición vacía no consulta la base');
});

test('Docentes: estado, listados y filtros están acotados y paginados', async () => {
  await validate({ revision: 1, activo: false }, EstadoDocenteDto);
  for (const body of [{ revision: 1 }, { revision: 1, activo: 'false' }, { revision: 1, activo: 0 }, { activo: true }, { revision: 1, activo: true, motivo: 'x' }]) await assert.rejects(validate(body, EstadoDocenteDto), BadRequestException, JSON.stringify(body));
  const q = await validate({}, DocentesQueryDto, 'query');
  assert.deepEqual([q.page, q.limit, q.estado], [1, 20, 'activos']);
  const filtered = await validate({ page: '2', limit: '10', search: ' ana ', especialidad: ' Excel ', estado: 'inactivos' }, DocentesQueryDto, 'query');
  assert.deepEqual([filtered.page, filtered.limit, filtered.search, filtered.especialidad, filtered.estado], [2, 10, 'ana', 'Excel', 'inactivos']);
  for (const body of [{ page: '0' }, { limit: '101' }, { estado: 'archivados' }, { search: 'a'.repeat(101) }, { especialidad: 'a'.repeat(121) }, { q: 'x' }, { orden: 'id' }]) await assert.rejects(validate(body, DocentesQueryDto, 'query'), BadRequestException, JSON.stringify(body));
  assert.equal((await validate({}, DocenteAsignacionesQueryDto, 'query')).estado, 'todas');
  const a = await validate({ convocatoria_id: '3', docente_id: '4', rol: 'principal' }, AsignacionesQueryDto, 'query');
  assert.deepEqual([a.convocatoria_id, a.docente_id, a.rol, a.estado], [3, 4, 'principal', 'activas']);
  for (const body of [{ convocatoria_id: 'x' }, { convocatoria_id: '0' }, { rol: 'otro' }, { estado: 'archivadas' }]) await assert.rejects(validate(body, AsignacionesQueryDto, 'query'), BadRequestException, JSON.stringify(body));
});

test('Asignaciones: cuerpos estrictos, motivo obligatorio y rol limitado', async () => {
  assert.equal((await validate({ docente_id: 1, convocatoria_id: 2 }, CreateAsignacionDto)).rol, undefined);
  await validate({ docente_id: 1, convocatoria_id: 2, rol: 'principal' }, CreateAsignacionDto);
  for (const body of [{ docente_id: 1 }, { convocatoria_id: 2 }, { docente_id: '1', convocatoria_id: 2 }, { docente_id: 0, convocatoria_id: 2 }, { docente_id: 1, convocatoria_id: 2.5 }, { docente_id: 1, convocatoria_id: 2, rol: 'jefe' }, { docente_id: 1, convocatoria_id: 2, estado: 'retirada' }, { docente_id: 1, convocatoria_id: 2, revision: 4 }])
    await assert.rejects(validate(body, CreateAsignacionDto), BadRequestException, JSON.stringify(body));
  await validate({ revision: 1, rol: 'participante' }, RolAsignacionDto);
  for (const body of [{ rol: 'principal' }, { revision: 1 }, { revision: 1, rol: 'x' }]) await assert.rejects(validate(body, RolAsignacionDto), BadRequestException);
  assert.equal((await validate({ revision: 1, motivo: '  Cambio de agenda ' }, RetiroAsignacionDto)).motivo, 'Cambio de agenda');
  for (const body of [{ revision: 1 }, { revision: 1, motivo: '   ' }, { revision: 1, motivo: 'x'.repeat(301) }, { motivo: 'Cambio' }, { revision: 1, motivo: null }]) await assert.rejects(validate(body, RetiroAsignacionDto), BadRequestException, JSON.stringify(body));
  await validate({ revision: 1, motivo: 'Vuelve', rol: 'principal' }, ReactivacionAsignacionDto);
  await validate({ revision: 1, motivo: 'Renuncia', docente_id: 9 }, SustitucionAsignacionDto);
  for (const body of [{ revision: 1, motivo: 'Renuncia' }, { revision: 1, motivo: 'Renuncia', docente_id: '9' }, { revision: 1, docente_id: 9 }]) await assert.rejects(validate(body, SustitucionAsignacionDto), BadRequestException, JSON.stringify(body));
});

test('Docentes: reglas del equipo docente de una edición', () => {
  const edition = (estado: string, archivado = false) => ({ estado, archivado_at: archivado ? new Date() : null });
  for (const estado of ['planificada', 'abierta', 'cerrada']) assertEditionAcceptsTeachers(edition(estado));
  assert.throws(() => assertEditionAcceptsTeachers(edition('cancelada')), ConflictException);
  assert.throws(() => assertEditionAcceptsTeachers(edition('cerrada', true)), ConflictException);
  assert.throws(() => assertEditionAcceptsTeachers(edition('abierta', true)), ConflictException);
  assertTeacherActive({ activo: true });
  assert.throws(() => assertTeacherActive({ activo: false }), ConflictException);
  assert.deepEqual(changedFieldNames({ nombres: 'Ana', email: undefined, telefono: '' }), ['nombres', 'telefono']);
});

test('Docentes: el docente no es una cuenta y la vista expone el conteo sin campos internos', () => {
  const row = { id: 1, nombres: 'Ana', apellidos: 'Pérez', doc_pais: null, doc_tipo: null, doc_numero: null, especialidad: null, profesion: null, email: null, telefono: null, activo: true, revision: 1, createdAt: new Date(), updatedAt: new Date() };
  assert.equal(viewDocente({ ...row, _count: { asignaciones: 2 } }).asignaciones_activas, 2);
  assert.ok(!('_count' in viewDocente({ ...row, _count: { asignaciones: 2 } })));
  assert.ok(!('asignaciones_activas' in viewDocente(row)));
  for (const forbidden of ['password', 'rol', 'admin_user_id', 'cuenta_id', 'token']) assert.ok(!(forbidden in row), forbidden);
});

test('Docentes: traduce unicidad, estructura incompleta y conflictos de escritura sin exponer SQL', async () => {
  for (const [code, expected] of [['P2002', ConflictException], ['P2021', ServiceUnavailableException], ['P2022', ServiceUnavailableException], ['P2034', ConflictException]] as const) {
    const failing = { $transaction: async () => { throw prismaError(code); }, docente: { findUnique: async () => { throw prismaError(code); } } } as unknown as PrismaService;
    await assert.rejects(new DocentesService(failing).create({ ...valid } as CreateDocenteDto, 1), err => err instanceof expected && !(err as Error).message.includes('SQL privado'), code);
    await assert.rejects(new DocentesService(failing).detail(1), err => err instanceof expected && !(err as Error).message.includes('SQL privado'), code);
    await assert.rejects(new AsignacionesService(failing).create({ docente_id: 1, convocatoria_id: 1 }, 1), err => err instanceof expected && !(err as Error).message.includes('SQL privado'), code);
  }
  await assert.rejects(new DocentesService({ docente: { findUnique: async () => null } } as unknown as PrismaService).detail(1), NotFoundException);
  await assert.rejects(new AsignacionesService({ docenteAsignacion: { findUnique: async () => null } } as unknown as PrismaService).detail(1), NotFoundException);
});

test('Docentes: las asignaciones solo incluyen un resumen del docente, sin documento, correo ni teléfono', async () => {
  let requested: { include?: { docente?: { select: Record<string, boolean> } } } | undefined;
  const prisma = {
    $transaction: async (queries: unknown[]) => Promise.all(queries),
    docenteAsignacion: { findMany: async (args: typeof requested) => { requested = args; return []; }, count: async () => 0 },
  } as unknown as PrismaService;
  const result = await new AsignacionesService(prisma).list({ page: 1, limit: 20, estado: 'activas' });
  assert.deepEqual(result.items, []);
  assert.deepEqual(Object.keys(requested!.include!.docente!.select).sort(), ['activo', 'apellidos', 'especialidad', 'id', 'nombres']);
  const day = new Date('2026-11-01T00:00:00Z');
  const item = viewAsignacion({ id: 1, docente_id: 1, convocatoria_id: 1, rol: 'principal', estado: 'activa', sustituye_a_id: null, retirado_at: null, retiro_motivo: null, revision: 1, createdAt: day, updatedAt: day,
    docente: { id: 1, nombres: 'Ana', apellidos: 'Pérez', especialidad: null, activo: true },
    convocatoria: { id: 1, nombre: 'Noviembre', estado: 'abierta', archivado_at: null, fecha_inicio: day, fecha_fin: null, curso: { id: 1, titulo: 'Excel', tipo: 'curso' } } });
  assert.equal(item.convocatoria.fecha_inicio, '2026-11-01'); assert.equal(item.convocatoria.fecha_fin, null);
});
