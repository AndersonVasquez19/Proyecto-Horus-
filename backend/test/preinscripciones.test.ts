import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { createValidationPipe } from '../src/common/validation';
import { PublicRateLimitGuard, subnetOf } from '../src/common/public-rate-limit.guard';
import { memoryBuckets } from './fixtures/rate-limit-memory';
import { ChatbotService } from '../src/chatbot/chatbot.service';
import { ChatbotModule } from '../src/chatbot/chatbot.module';
import { ConvocatoriasService } from '../src/convocatorias/convocatorias.service';
import { RecepcionPreinscripcionDto } from '../src/convocatorias/convocatorias.dto';
import { ChatbotPreinscripcionDto, ConvertirPreinscripcionDto, DescartePreinscripcionDto, PreinscripcionesQueryDto, RegistroPreinscripcionDto, UpdatePreinscripcionDto } from '../src/preinscripciones/preinscripciones.dto';
import { PreinscripcionesModule } from '../src/preinscripciones/preinscripciones.module';
import { PreinscripcionesPublicService, REGISTRO_RESPUESTA } from '../src/preinscripciones/preinscripciones-public.service';
import { PreinscripcionesService } from '../src/preinscripciones/preinscripciones.service';
import { ESTADOS_PARA_APERTURA, MINIMO_APERTURA_NUEVAS, receivesPreinscripciones, validateOpeningMinimum, validateTransition } from '../src/preinscripciones/preinscripciones.rules';
import { ALL_PERMISSIONS, RESOURCE_OPERATIONS } from '../src/permissions/permissions';
import { can, permissionsOf } from '../src/permissions/policy';
import { ROUTE_INVENTORY } from '../src/permissions/route-inventory';

const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const CODE = 'a'.repeat(32);
const form = { convocatoria: CODE, nombres: ' Ana ', apellidos: 'Pérez', email: ' ANA@Example.TEST ', telefono: '987 654 321', consentimiento: true };
const pipe = createValidationPipe();
const validate = (body: unknown, metatype: unknown, type: 'body' | 'query' = 'body') => pipe.transform(body, { type, metatype: metatype as never });

// ---- DTO público ----------------------------------------------------------------------------------------------------------------
test('Preinscripciones públicas: datos mínimos normalizados, consentimiento estricto y ningún campo que el servidor deba fijar', async () => {
  const ok = await validate(form, RegistroPreinscripcionDto);
  assert.equal(ok.nombres, 'Ana'); assert.equal(ok.email, 'ana@example.test');
  for (const patch of [{ consentimiento: false }, { consentimiento: 'true' }, { consentimiento: 1 }, { consentimiento: undefined }, { nombres: '  ' }, { apellidos: '' }, { telefono: 'abc' }, { telefono: '' }, { email: 'sin-arroba' },
    { convocatoria: 'A'.repeat(32) }, { convocatoria: '12' }, { nombres: 'a'.repeat(121) }, { email: 'a'.repeat(250) + '@x.pe' }]) {
    await assert.rejects(validate({ ...form, ...patch }, RegistroPreinscripcionDto), BadRequestException, JSON.stringify(patch).slice(0, 60));
  }
  // El cliente NO elige origen administrativo, estado, id ni pide datos que no se recogen (DNI, pagos, comprobantes).
  for (const extra of [{ canal: 'chatbot' }, { origen: 'panel' }, { estado: 'validada' }, { convocatoria_id: 1 }, { id: 5 }, { dni: '12345678' }, { doc_numero: '12345678' }, { pago: 'S/ 10' }, { comprobante: 'x' }, { revision: 3 }, { actor_id: 1 }])
    await assert.rejects(validate({ ...form, ...extra }, RegistroPreinscripcionDto), BadRequestException, JSON.stringify(extra));
  await validate({ ...form, website: '' }, RegistroPreinscripcionDto);
});

test('Preinscripciones por chatbot: exige además que el visitante confirme el resumen de sus datos', async () => {
  await validate({ ...form, confirmacion: true }, ChatbotPreinscripcionDto);
  for (const confirmacion of [false, 'true', undefined, 1]) await assert.rejects(validate({ ...form, confirmacion }, ChatbotPreinscripcionDto), BadRequestException);
  await assert.rejects(validate({ ...form, confirmacion: true, canal: 'formulario' }, ChatbotPreinscripcionDto), BadRequestException);
  await assert.rejects(validate({ ...form, confirmacion: true }, RegistroPreinscripcionDto), BadRequestException, 'el formulario no admite el campo confirmacion');
});

test('Preinscripciones administrativas: revisión, motivo, correcciones, conversión y filtros acotados', async () => {
  await assert.rejects(validate({ motivo: 'x' }, DescartePreinscripcionDto), BadRequestException);
  await assert.rejects(validate({ revision: 1, motivo: ' ' }, DescartePreinscripcionDto), BadRequestException);
  assert.equal((await validate({ revision: 1, motivo: ' Duplicada ' }, DescartePreinscripcionDto)).motivo, 'Duplicada');
  await assert.rejects(validate({ revision: 1, estado: 'validada' }, UpdatePreinscripcionDto), BadRequestException, 'el estado no se edita por correcciones');
  await assert.rejects(validate({ revision: 1, canal: 'chatbot' }, UpdatePreinscripcionDto), BadRequestException);
  await assert.rejects(validate({ revision: 1, email: null }, UpdatePreinscripcionDto), BadRequestException);
  assert.equal((await validate({ revision: 1, email: ' NUEVO@Example.test' }, UpdatePreinscripcionDto)).email, 'nuevo@example.test');
  await validate({ revision: 1, estudiante_id: 4, doc_numero: '00123456' }, ConvertirPreinscripcionDto);
  await validate({ revision: 1, doc_numero: '00123456' }, ConvertirPreinscripcionDto);
  await assert.rejects(validate({ revision: 1, estudiante_id: 4 }, ConvertirPreinscripcionDto), BadRequestException, 'el DNI siempre es obligatorio');
  await assert.rejects(validate({ revision: 1 }, ConvertirPreinscripcionDto), BadRequestException);
  for (const bad of [{ doc_numero: '1234567' }, { doc_numero: '12345678\n' }, { estudiante_id: '4' }, { estudiante_id: 0 }, { estado: 'activa' }, { matricula_id: 1 }, { forzar: true }, { confirmar_discrepancia: true }, { motivo: 'excepción' }])
    await assert.rejects(validate({ revision: 1, doc_numero: '12345678', ...bad }, ConvertirPreinscripcionDto), BadRequestException, JSON.stringify(bad));
  const q = await validate({ convocatoria_id: '2', estado: 'validada', canal: 'chatbot', limit: '10' }, PreinscripcionesQueryDto, 'query');
  assert.equal(q.convocatoria_id, 2); assert.equal(q.limit, 10);
  for (const bad of [{ estado: 'activa' }, { canal: 'panel' }, { limit: 101 }, { page: 0 }, { convocatoria_id: 'x' }]) await assert.rejects(validate(bad, PreinscripcionesQueryDto, 'query'), BadRequestException);
  await assert.rejects(validate({ revision: 1, estado: 'otra' }, RecepcionPreinscripcionDto), BadRequestException);
});

test('Convocatorias: el DTO de alta no admite fijar el mínimo de apertura ni el código público (sin excepciones desde el cliente)', async () => {
  const { CreateConvocatoriaDto } = await import('../src/convocatorias/convocatorias.dto');
  const base = { curso_id: 1, nombre: 'Edición', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 };
  await validate(base, CreateConvocatoriaDto);
  for (const extra of [{ minimo_apertura: 1 }, { minimo_apertura: 0 }, { codigo_publico: CODE }, { preinscripcion_estado: 'abierta' }]) await assert.rejects(validate({ ...base, ...extra }, CreateConvocatoriaDto), BadRequestException, JSON.stringify(extra));
});

// ---- Reglas ---------------------------------------------------------------------------------------------------------------------
test('Reglas: mínimo de 10 validados, solo validada y matriculada cuentan, y las transiciones no se pueden eludir', () => {
  assert.equal(MINIMO_APERTURA_NUEVAS, 10);
  assert.deepEqual([...ESTADOS_PARA_APERTURA], ['validada', 'matriculada']);
  validateOpeningMinimum(null, 0); // edición anterior: sin requisito
  validateOpeningMinimum(10, 10); validateOpeningMinimum(10, 11);
  assert.throws(() => validateOpeningMinimum(10, 9), error => error instanceof ConflictException && /10/.test(error.message) && /9/.test(error.message));
  const allowed = [['recibida', 'validada'], ['recibida', 'descartada'], ['recibida', 'desistida'], ['validada', 'matriculada'], ['validada', 'descartada'], ['validada', 'desistida']] as const;
  for (const [from, to] of allowed) validateTransition(from, to);
  for (const [from, to] of [['recibida', 'matriculada'], ['validada', 'recibida'], ['matriculada', 'validada'], ['matriculada', 'descartada'], ['descartada', 'validada'], ['desistida', 'recibida'], ['validada', 'validada']] as const)
    assert.throws(() => validateTransition(from, to), ConflictException, from + '→' + to);
});

test('Reglas: la recepción es independiente de la apertura; cancelada, cerrada o archivada nunca reciben', () => {
  const edition = (patch: object) => ({ estado: 'planificada', archivado_at: null, preinscripcion_estado: 'abierta', capacidad: 20, ...patch });
  assert.equal(receivesPreinscripciones(edition({})), true, 'planificada');
  assert.equal(receivesPreinscripciones(edition({ estado: 'abierta' })), true, 'ya abierta sigue recibiendo mientras Gerencia/Coordinación lo mantengan');
  for (const patch of [{ estado: 'cerrada' }, { estado: 'cancelada' }, { archivado_at: new Date() }, { preinscripcion_estado: 'cerrada' }]) assert.equal(receivesPreinscripciones(edition(patch)), false, JSON.stringify(patch));
});

// ---- Permisos -------------------------------------------------------------------------------------------------------------------
test('Permisos: gerente completo, coordinación y secretaría leen/editan/convierten, sin rol nada; secretaría no recibe privilegios generales nuevos', () => {
  assert.deepEqual([...RESOURCE_OPERATIONS.preinscripciones], ['leer', 'editar', 'convertir', 'exportar']);
  const ids = ['preinscripciones:leer', 'preinscripciones:editar', 'preinscripciones:convertir'];
  for (const id of ids) for (const role of [G, C, S]) assert.equal(can(role, id), true, role + ' ' + id);
  assert.equal(can(G, 'preinscripciones:exportar'), true, 'reservado al gerente para una etapa futura');
  for (const role of [C, S, null, undefined, '', 'ADMIN']) assert.equal(can(role, 'preinscripciones:exportar'), false, String(role));
  for (const id of ids) for (const role of [null, undefined, '', 'ADMIN']) assert.equal(can(role, id), false);
  for (const id of ['preinscripciones:crear', 'preinscripciones:eliminar', 'preinscripciones:archivar']) assert.equal(ALL_PERMISSIONS.includes(id as never), false, 'sin crear ni borrar: ' + id);
  // La secretaría sigue sin abrir ediciones, habilitar la recepción, anular matrículas ni editar estudiantes: solo se añadieron los 3 permisos.
  for (const id of ['convocatorias:editar', 'convocatorias:cerrar', 'convocatorias:archivar', 'convocatorias:crear', 'matriculas:anular', 'matriculas:confirmar', 'estudiantes:editar', 'estudiantes:archivar', 'docentes:leer', 'sesiones:leer', 'reportes_academicos:leer', 'cuentas:leer']) assert.equal(can(S, id), false, 'secretaria ' + id);
  assert.deepEqual(permissionsOf(S).filter(id => id.startsWith('preinscripciones:')), [...ids].sort());
  assert.deepEqual(permissionsOf(C).filter(id => id.startsWith('preinscripciones:')), [...ids].sort());
});

test('Permisos: cada ruta nueva exige el permiso previsto; la apertura de la edición y la recepción siguen siendo de convocatorias:editar', () => {
  const entry = (method: string, path: string) => ROUTE_INVENTORY.find(route => route.method === method && route.path === path);
  const expected: Record<string, string> = {
    'GET admin/preinscripciones': 'preinscripciones:leer', 'GET admin/preinscripciones/resumen': 'preinscripciones:leer', 'GET admin/preinscripciones/:id': 'preinscripciones:leer', 'GET admin/preinscripciones/:id/historial': 'preinscripciones:leer',
    'PATCH admin/preinscripciones/:id': 'preinscripciones:editar', 'PUT admin/preinscripciones/:id/validacion': 'preinscripciones:editar', 'PUT admin/preinscripciones/:id/descarte': 'preinscripciones:editar', 'PUT admin/preinscripciones/:id/desistimiento': 'preinscripciones:editar',
    'POST admin/preinscripciones/:id/conversion': 'preinscripciones:convertir', 'PUT admin/convocatorias/:id/preinscripcion': 'convocatorias:editar', 'PUT admin/convocatorias/:id/apertura': 'convocatorias:editar',
  };
  for (const [key, permission] of Object.entries(expected)) { const [method, path] = key.split(' '); assert.deepEqual(entry(method, path)?.access, { kind: 'permiso', permission }, key); }
  for (const key of ['GET preinscripciones/convocatorias', 'POST preinscripciones', 'POST chatbot/preinscripcion']) { const [method, path] = key.split(' '); assert.deepEqual(entry(method, path)?.access, { kind: 'publica' }, key); }
  assert.ok(!ROUTE_INVENTORY.some(route => route.method === 'DELETE' && /preinscripciones/.test(route.path)), 'sin borrado físico');
  assert.ok(!ROUTE_INVENTORY.some(route => /preinscripciones/.test(route.path) && route.access.kind === 'permiso' && route.access.permission === 'preinscripciones:exportar'), 'exportar sigue reservado');
});

// ---- Servicio público -----------------------------------------------------------------------------------------------------------
type Row = { id: number; curso_id: number; estado: string; archivado_at: Date | null; preinscripcion_estado: string; capacidad: number | null };
function publicFixture(state: { edition?: Row | null; curso?: string; occupied?: number; vigentes?: number; duplicate?: boolean; createError?: unknown } = {}) {
  const log = { created: [] as Record<string, unknown>[], history: [] as Record<string, unknown>[], transactions: 0, filters: [] as unknown[] };
  const edition = state.edition === undefined ? { id: 7, curso_id: 3, estado: 'planificada', archivado_at: null, preinscripcion_estado: 'abierta', capacidad: 20 } : state.edition;
  const tx = {
    $queryRaw: async () => edition ? [edition] : [],
    curso: { findUnique: async () => ({ estado: state.curso ?? 'publicado' }) },
    matricula: { count: async () => state.occupied ?? 0 },
    preinscripcion: {
      count: async () => state.vigentes ?? 0, findFirst: async () => state.duplicate ? { id: 1 } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => { if (state.createError) throw state.createError; log.created.push(data); return { id: log.created.length }; },
    },
    preinscripcionHistorial: { create: async ({ data }: { data: Record<string, unknown> }) => { log.history.push(data); } },
    adminUser: { findUnique: async () => null },
  };
  const prisma = { $transaction: async (run: (t: unknown) => unknown) => { log.transactions++; return run(tx); },
    convocatoria: { findMany: async (args: unknown) => { log.filters.push(args); return []; } } };
  return { service: new PreinscripcionesPublicService(prisma as never), log };
}
const dto = (patch: object = {}) => Object.assign(new RegistroPreinscripcionDto(), { convocatoria: CODE, nombres: 'Ana', apellidos: 'Pérez', email: 'ana@example.test', telefono: '987654321', consentimiento: true as const }, patch);

test('Servicio público: formulario y chatbot comparten el servicio, el servidor fija el canal y la respuesta es idéntica y sin datos', async () => {
  const f = publicFixture(), c = publicFixture();
  const byForm = await f.service.register(dto(), 'formulario');
  const byChat = await c.service.register(dto(), 'chatbot');
  assert.deepEqual(byForm, byChat); assert.deepEqual(byForm, REGISTRO_RESPUESTA);
  assert.deepEqual(Object.keys(byForm).sort(), ['mensaje', 'ok'], 'ni ids, ni correo, ni estado');
  assert.doesNotMatch(JSON.stringify(byForm), /ana@|Pérez|\b\d{5,}\b/);
  assert.equal(f.log.created[0].canal, 'formulario'); assert.equal(c.log.created[0].canal, 'chatbot');
  for (const log of [f.log, c.log]) {
    const row = log.created[0];
    assert.equal(row.estado, 'recibida'); assert.equal(row.convocatoria_id, 7); assert.ok(row.consentimiento_at instanceof Date); assert.equal(row.aviso_version, 'preinscripcion-v1');
    assert.equal('estudiante_id' in row || 'matricula_id' in row || 'doc_numero' in row, false, 'no se piden DNI ni matrícula');
    const history = log.history[0];
    assert.equal(history.operacion, 'creacion'); assert.equal(history.actor_id, undefined); assert.equal(history.estado_nuevo, 'recibida');
    assert.ok(Array.isArray(history.campos) && !JSON.stringify(history).includes('ana@example.test') && !JSON.stringify(history).includes('Pérez'), 'el historial guarda nombres de campos, nunca valores');
  }
});

test('Servicio público: un duplicado, una carrera perdida y el campo trampa responden igual y no revelan nada', async () => {
  const baseline = await publicFixture().service.register(dto(), 'formulario');
  const dup = publicFixture({ duplicate: true });
  assert.deepEqual(await dup.service.register(dto(), 'formulario'), baseline); assert.equal(dup.log.created.length, 0);
  const unique = new PrismaClientKnownRequestError('Unique constraint failed on preinscripciones_vigente_email_uq', { code: 'P2002', clientVersion: 't' });
  const race = publicFixture({ createError: unique });
  assert.deepEqual(await race.service.register(dto(), 'chatbot'), baseline); assert.equal(race.log.created.length, 0);
  const trap = publicFixture();
  assert.deepEqual(await trap.service.register(dto({ website: 'http://spam.test' }), 'formulario'), baseline);
  assert.equal(trap.log.transactions, 0, 'el robot no llega a la base de datos');
});

test('Servicio público: ediciones inexistentes, cerradas, canceladas, archivadas, sin recepción o de un curso no publicado devuelven el mismo 404', async () => {
  const base: Row = { id: 7, curso_id: 3, estado: 'planificada', archivado_at: null, preinscripcion_estado: 'abierta', capacidad: 20 };
  const cases: Array<Parameters<typeof publicFixture>[0]> = [{ edition: null }, { edition: { ...base, estado: 'cerrada' } }, { edition: { ...base, estado: 'cancelada' } }, { edition: { ...base, archivado_at: new Date() } },
    { edition: { ...base, preinscripcion_estado: 'cerrada' } }, { curso: 'borrador' }, { curso: 'archivado' }];
  const messages = new Set<string>();
  for (const state of cases) {
    const f = publicFixture(state);
    await assert.rejects(f.service.register(dto(), 'formulario'), error => { messages.add((error as Error).message); return error instanceof NotFoundException; });
    assert.equal(f.log.created.length, 0);
  }
  assert.equal(messages.size, 1, 'un solo mensaje: no distingue por qué');
});

test('Servicio público: recepción posterior a la apertura mientras haya cupos, y límites de capacidad y de seguridad', async () => {
  const open: Row = { id: 7, curso_id: 3, estado: 'abierta', archivado_at: null, preinscripcion_estado: 'abierta', capacidad: 5 };
  assert.deepEqual(await publicFixture({ edition: open, occupied: 4 }).service.register(dto(), 'formulario'), REGISTRO_RESPUESTA);
  await assert.rejects(publicFixture({ edition: open, occupied: 5 }).service.register(dto(), 'formulario'), ConflictException);
  await assert.rejects(publicFixture({ edition: { ...open, capacidad: null } }).service.register(dto(), 'formulario'), ConflictException);
  await assert.rejects(publicFixture({ vigentes: 500 }).service.register(dto(), 'formulario'), ConflictException, 'tope técnico de seguridad');
  assert.deepEqual(await publicFixture({ vigentes: 499 }).service.register(dto(), 'formulario'), REGISTRO_RESPUESTA);
});

test('Servicio público: esquema pendiente responde 503 neutro y el listado público filtra por recepción, estado, curso publicado y código', async () => {
  const outdated = new PreinscripcionesPublicService({ $transaction: async () => { throw new PrismaClientKnownRequestError('tabla `horus_db`.`preinscripciones` no existe', { code: 'P2021', clientVersion: 't' }); } } as never);
  await assert.rejects(outdated.register(dto(), 'formulario'), error => error instanceof ServiceUnavailableException && !/horus_db|`|P202|SQL/.test((error as Error).message));
  const f = publicFixture();
  await f.service.editions();
  const where = (f.log.filters[0] as { where: Record<string, unknown> }).where;
  assert.deepEqual(where, { preinscripcion_estado: 'abierta', archivado_at: null, estado: { in: ['planificada', 'abierta'] }, codigo_publico: { not: null }, capacidad: { not: null }, curso: { estado: 'publicado' } });
  const rows = [{ codigo_publico: CODE, nombre: 'Edición', estado: 'planificada', fecha_inicio: new Date('2026-11-01T00:00:00Z'), fecha_fin: null, capacidad: 10, curso: { titulo: 'Curso', tipo: 'curso', modalidad: 'virtual', duracion: '10 h' }, _count: { matriculas: 0 } },
    { codigo_publico: 'b'.repeat(32), nombre: 'Llena', estado: 'abierta', fecha_inicio: null, fecha_fin: null, capacidad: 3, curso: { titulo: 'Curso', tipo: 'curso', modalidad: null, duracion: null }, _count: { matriculas: 3 } }];
  const listing = await new PreinscripcionesPublicService({ convocatoria: { findMany: async () => rows } } as never).editions();
  assert.equal(listing.items.length, 1, 'una edición abierta sin cupos deja de ofrecerse');
  assert.deepEqual(Object.keys(listing.items[0]).sort(), ['apertura_confirmada', 'codigo', 'curso', 'fecha_fin', 'fecha_inicio', 'nombre']);
  assert.equal(listing.items[0].fecha_inicio, '2026-11-01');
  assert.doesNotMatch(JSON.stringify(listing), /"id"|capacidad|matriculas|_count/, 'sin ids secuenciales, cupos ni conteos');
});

// ---- Frecuencia compartida --------------------------------------------------------------------------------------------------------
function limiter(prismaOverride?: unknown) {
  const memory = memoryBuckets();
  const guard = new PublicRateLimitGuard((prismaOverride ?? memory.prisma) as never);
  // El guard no lee el cuerpo: la solicitud simulada no lleva correo ni teléfono y aun así el guard funciona.
  return { ...memory, call: (path: string, ip = '203.0.113.1') => guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method: 'POST', path, ip, socket: { remoteAddress: ip } }) }) } as never) };
}
const tooMany = (error: unknown) => error instanceof HttpException && error.getStatus() === 429;
// Resultado de una llamada: true = admitida, false = 429. Cualquier otro error se propaga.
const attempt = async (l: ReturnType<typeof limiter>, path: string, ip?: string) => { try { return await l.call(path, ip); } catch (error) { if (tooMany(error)) return false; throw error; } };
const withClock = async (at: number, work: (set: (t: number) => void) => Promise<void>) => {
  const clock = { now: at }; const original = Date.now; Date.now = () => clock.now;
  try { await work(t => { clock.now = t; }); } finally { Date.now = original; }
};

test('Frecuencia: 5 por minuto por IP, compartidas entre formulario y chatbot, y almacenadas en MySQL (rate_limit_buckets), no en memoria', async () => {
  const l = limiter();
  for (let i = 0; i < 3; i++) assert.equal(await l.call('/api/preinscripciones'), true);
  for (let i = 0; i < 2; i++) assert.equal(await l.call('/api/chatbot/preinscripcion'), true);
  await assert.rejects(() => l.call('/api/preinscripciones'), tooMany, 'el sexto intento, sea cual sea el canal');
  await assert.rejects(() => l.call('/api/chatbot/preinscripcion'), tooMany, 'alternar de canal no multiplica el límite');
  assert.equal(await l.call('/api/preinscripciones', '203.0.113.9'), true, 'otra IP tiene su cuota');
  assert.equal(await l.call('/api/chatbot/message'), true, 'el chat conversacional conserva su cuota');
  const source = readFileSync(join(__dirname, '..', 'src', 'common', 'public-rate-limit.guard.ts'), 'utf8');
  assert.match(source, /rate_limit_buckets/);
});

test('Frecuencia: 30 por hora por IP (un aula compartiendo conexión cabe, un goteo sostenido no)', () => withClock(Date.UTC(2026, 9, 20, 11, 0, 5), async set => {
  const h = limiter(); let accepted = 0;
  for (let minute = 0; minute < 8; minute++) {
    set(Date.UTC(2026, 9, 20, 11, minute, 5));
    for (let i = 0; i < 5; i++) if (await attempt(h, '/api/preinscripciones', '198.51.100.7')) accepted++;
  }
  assert.equal(accepted, 30, '5 por minuto durante 8 minutos: la hora corta en 30');
  set(Date.UTC(2026, 9, 20, 12, 0, 5));
  assert.equal(await h.call('/api/preinscripciones', '198.51.100.7'), true, 'la hora siguiente vuelve a tener cuota');
}));

test('Frecuencia: una IP abusiva se queda en su propia cuota y NO agota el tope global: otra IP legítima todavía registra', () => withClock(Date.UTC(2026, 9, 20, 13, 0, 5), async () => {
  const l = limiter();
  let admitted = 0;
  for (let i = 0; i < 1000; i++) if (await attempt(l, '/api/preinscripciones', '203.0.113.50')) admitted++;
  assert.equal(admitted, 5, 'la IP abusiva consigue como mucho su cuota por minuto, no más');
  // Solo las solicitudes ADMITIDAS cuentan para el global: las 995 rechazadas no gastaron nada de la cuota de los demás.
  const globalCounts = [...l.buckets.values()];
  assert.equal(l.total(), 5 + 5 + 5 + 5, 'individual + hora + subred + global, una vez por cada solicitud admitida y ninguna por las rechazadas');
  assert.ok(globalCounts.every(count => count <= 5));
  // Visitantes legítimos de otras redes pasan sin problema aunque el abusivo siga insistiendo.
  for (let i = 0; i < 50; i++) {
    await attempt(l, '/api/preinscripciones', '203.0.113.50');
    assert.equal(await l.call('/api/preinscripciones', '198.51.' + i + '.20'), true, 'visitante legítimo ' + i);
  }
  assert.equal(await l.call('/api/contacto', '198.51.200.9'), true, 'ni el cubo de Contacto');
  assert.equal(await attempt(l, '/api/preinscripciones', '203.0.113.50'), false, 'el abusivo sigue limitado');
}));

test('Frecuencia: el tope global propio (60 por minuto) cuenta solo solicitudes admitidas y un rechazo no gasta la cuota individual', () => withClock(Date.UTC(2026, 9, 20, 14, 0, 5), async () => {
  const l = limiter(); let blocked = 0;
  for (let i = 0; i < 70; i++) if (!await attempt(l, '/api/preinscripciones', '192.' + i + '.2.7')) blocked++;
  assert.equal(blocked, 10, 'redes distintas: el global protege el conjunto');
  assert.equal(await l.call('/api/contacto', '192.0.2.250'), true, 'una ráfaga de preinscripciones no agota el cubo de Contacto');
  // Al revertirse la transacción, las 10 rechazadas por el global NO gastaron cuota individual, de hora ni de subred: solo suman las 60 admitidas
  // (60 × 4 cubos) más la de Contacto (individual + global).
  assert.equal(l.total(), 60 * 4 + 2);
}));

test('Frecuencia: tope por subred (/24 y /64): quien rota direcciones vecinas no multiplica su cuota, y otras redes siguen pasando', () => withClock(Date.UTC(2026, 9, 20, 15, 0, 5), async () => {
  const l = limiter(); let passed = 0;
  for (let i = 1; i <= 40; i++) if (await attempt(l, '/api/preinscripciones', '192.0.2.' + i)) passed++;
  assert.equal(passed, 20, '40 direcciones de la misma /24: pasan 20 (4 veces el tope individual)');
  assert.equal(await l.call('/api/preinscripciones', '192.0.3.1'), true, 'otra /24');
  assert.equal(await l.call('/api/preinscripciones', '2001:db8:aaaa:1::1'), true);
  let v6 = 1; for (let i = 2; i <= 40; i++) if (await attempt(l, '/api/preinscripciones', '2001:db8:aaaa:1::' + i.toString(16))) v6++;
  assert.equal(v6, 20, 'IPv6: el prefijo /64 comparte el tope');
  assert.equal(subnetOf('203.0.113.77'), '203.0.113.0/24'); assert.equal(subnetOf('::ffff:203.0.113.77'), '203.0.113.0/24');
  assert.equal(subnetOf('2001:db8:aaaa:1::5'), '2001:db8:aaaa:1::/64'); assert.equal(subnetOf('2001:0DB8:AAAA:0001:0:0:0:9'), '2001:db8:aaaa:1::/64');
  assert.equal(subnetOf('desconocida'), 'desconocida');
}));

test('Frecuencia: solicitudes simultáneas de una misma IP no superan su cuota y las de otras IP no se bloquean entre sí', () => withClock(Date.UTC(2026, 9, 20, 16, 0, 5), async () => {
  const l = limiter();
  const burst = await Promise.all(Array.from({ length: 60 }, () => attempt(l, '/api/preinscripciones', '203.0.113.9')));
  assert.equal(burst.filter(Boolean).length, 5);
  const others = await Promise.all(Array.from({ length: 30 }, (_v, i) => attempt(l, '/api/preinscripciones', '198.' + (51 + i) + '.100.1')));
  assert.equal(others.filter(Boolean).length, 30);
  const mixed = await Promise.all([...Array.from({ length: 40 }, () => attempt(l, '/api/contacto', '203.0.113.9')), ...Array.from({ length: 20 }, (_v, i) => attempt(l, '/api/contacto', '100.' + i + '.0.1'))]);
  assert.equal(mixed.slice(0, 40).filter(Boolean).length, 5); assert.equal(mixed.slice(40).filter(Boolean).length, 20);
}));

test('Frecuencia: los cubos solo guardan hashes (nunca IP, correo ni teléfono) y el guard no lee el cuerpo de la solicitud', async () => {
  const l = limiter();
  await l.call('/api/preinscripciones', '203.0.113.1'); await l.call('/api/chatbot/preinscripcion', '203.0.113.1');
  assert.ok(l.buckets.size >= 4);
  for (const id of l.buckets.keys()) assert.match(id, /^[0-9a-f]{64}$/, 'solo un hash SHA-256 (cabe en VARCHAR(64))');
  const source = readFileSync(join(__dirname, '..', 'src', 'common', 'public-rate-limit.guard.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /request\.body|\.body\b|x-forwarded-for|headers/i, 'no lee el cuerpo ni cabeceras controladas por el cliente: la IP la resuelve Express con trust proxy');
});

test('Frecuencia: un interbloqueo transitorio se reintenta y, si persiste, rechaza con 503 neutro sin admitir ni omitir el límite', async () => {
  const conflict = () => new PrismaClientKnownRequestError('Deadlock con SQL privado', { code: 'P2034', clientVersion: 't' });
  let failures = 1; const memory = memoryBuckets();
  const flaky = { ...memory.prisma, $transaction: async (run: never, options: never) => { if (failures-- > 0) throw conflict(); return memory.prisma.$transaction(run, options); } };
  assert.equal(await limiter(flaky).call('/api/preinscripciones'), true, 'el segundo intento admite');
  const dead = { ...memory.prisma, $transaction: async () => { throw conflict(); } };
  await assert.rejects(() => limiter(dead).call('/api/preinscripciones'), error => error instanceof HttpException && error.getStatus() === 503 && !/SQL|Deadlock|P20/.test(JSON.stringify(error.getResponse())));
  const broken = { ...memory.prisma, $transaction: async () => { throw new Error('MySQL caído'); } };
  await assert.rejects(() => limiter(broken).call('/api/preinscripciones'), /MySQL caído/, 'un fallo real de la base no se disfraza de admisión');
});

// ---- Servicio administrativo (sin base de datos) ----------------------------------------------------------------------------------
test('Servicio administrativo: la conversión exige UN estudiante existente o el DNI, y un esquema pendiente da 503 neutro', async () => {
  const touched: string[] = [];
  const prisma = { $transaction: async () => { touched.push('tx'); throw new PrismaClientKnownRequestError('SQL ficticio privado', { code: 'P2022', clientVersion: 't' }); } };
  const service = new PreinscripcionesService(prisma as never, {} as never, {} as never);
  assert.throws(() => service.convert(1, { revision: 1 } as never, 1), error => error instanceof BadRequestException && /DNI/.test((error as Error).message));
  assert.throws(() => service.convert(1, { revision: 1, estudiante_id: 1 } as never, 1), error => error instanceof BadRequestException && /DNI/.test((error as Error).message), 'un estudiante_id sin DNI no basta: el DNI es el ancla de identidad');
  assert.deepEqual(touched, [], 'las entradas inválidas no abren transacción');
  assert.throws(() => service.update(1, { revision: 1 } as never, 1), BadRequestException);
  await assert.rejects(service.convert(1, { revision: 1, doc_numero: '12345678' } as never, 1), error => error instanceof ServiceUnavailableException && !/SQL|privado/.test((error as Error).message));
  await assert.rejects(service.detail(1), error => !(error instanceof Error) || !/privado/.test(error.message) || error instanceof ServiceUnavailableException);
});

// ---- Ediciones: mínimo de apertura -----------------------------------------------------------------------------------------------
function editionFixture(before: Record<string, unknown>, validated: number) {
  const log = { update: null as Record<string, unknown> | null, history: [] as Record<string, unknown>[], countWhere: null as unknown, created: null as Record<string, unknown> | null, preCount: 0 };
  const base = { id: 1, curso_id: 1, nombre: 'Edición', estado: 'planificada', capacidad: 20, fecha_inicio: new Date('2026-11-01T00:00:00Z'), fecha_fin: new Date('2026-11-30T00:00:00Z'), archivado_at: null,
    revision: 1, minimo_apertura: 10, preinscripcion_estado: 'cerrada', codigo_publico: null, ...before };
  let reads = 0;
  const tx = {
    convocatoria: {
      findUnique: async () => ({ curso_id: 1 }),
      findUniqueOrThrow: async () => (reads++ === 0 ? base : { ...base, ...log.update, revision: 2, curso: { id: 1, titulo: 'C', tipo: 'curso', estado: 'publicado' } }),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { log.update = data; return { count: 1 }; },
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { log.created = data; return { ...base, ...data, curso: { id: 1, titulo: 'C', tipo: 'curso', estado: 'publicado' } }; },
    },
    $queryRaw: async () => [{ id: 1 }],
    matricula: { count: async () => 0 },
    preinscripcion: { count: async ({ where }: { where: unknown }) => { log.preCount++; log.countWhere = where; return validated; } },
    adminUser: { findUnique: async () => ({ rol: 'GERENTE_GENERAL' }) },
    academicoHistorial: { create: async ({ data }: { data: Record<string, unknown> }) => { log.history.push(data); } },
  };
  const service = new ConvocatoriasService({ $transaction: async (run: (t: unknown) => unknown) => run(tx) } as never);
  return { service, log };
}

test('Ediciones: abrir exige el mínimo de validadas (9 no, 10 sí), solo cuenta validada y matriculada y no se abre sola', async () => {
  const nine = editionFixture({}, 9);
  await assert.rejects(nine.service.open(1, 1, 1), error => error instanceof ConflictException && /10/.test((error as Error).message));
  assert.equal(nine.log.update, null, 'no se escribe nada');
  assert.deepEqual(nine.log.countWhere, { convocatoria_id: 1, estado: { in: ['validada', 'matriculada'] } }, 'las simples solicitudes recibidas NO cuentan');
  const ten = editionFixture({}, 10);
  const opened = await ten.service.open(1, 1, 1);
  assert.equal(opened.item.estado, 'abierta'); assert.equal(ten.log.update?.estado, 'abierta');
  assert.equal(ten.log.history.length, 1, 'la apertura queda en el historial');
  // Una edición anterior (minimo NULL) se abre como siempre, sin consultar preinscripciones.
  const legacy = editionFixture({ minimo_apertura: null }, 0);
  assert.equal((await legacy.service.open(1, 1, 1)).item.estado, 'abierta'); assert.equal(legacy.log.preCount, 0);
  // No existe forma de abrir con menos: ni la capacidad ni el mínimo son parámetros de la apertura.
  const tiny = editionFixture({ capacidad: 3 }, 3);
  await assert.rejects(tiny.service.open(1, 1, 1), ConflictException, 'la capacidad no sustituye al mínimo');
});

test('Ediciones: el alta fija mínimo 10 y un código público opaco; la recepción se habilita sin abrir la edición y se cierra siempre', async () => {
  const created = editionFixture({}, 0);
  await created.service.create({ curso_id: 1, nombre: 'Nueva', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 }, 1);
  assert.equal(created.log.created?.minimo_apertura, 10); assert.match(String(created.log.created?.codigo_publico), /^[0-9a-f]{32}$/);
  assert.equal(created.log.created?.preinscripcion_estado, undefined, 'nace con la recepción cerrada (valor por omisión de la base)');
  const enable = editionFixture({ codigo_publico: null }, 0);
  const result = await enable.service.setReception(1, { revision: 1, estado: 'abierta' }, 1);
  assert.equal(enable.log.update?.preinscripcion_estado, 'abierta'); assert.match(String(enable.log.update?.codigo_publico), /^[0-9a-f]{32}$/, 'una edición anterior recibe su código al habilitarse');
  assert.equal(result.item.estado, 'planificada', 'habilitar la recepción no abre la edición');
  const keeps = editionFixture({ codigo_publico: CODE }, 0);
  await keeps.service.setReception(1, { revision: 1, estado: 'abierta' }, 1);
  assert.equal(keeps.log.update?.codigo_publico, undefined, 'el código existente no cambia');
  for (const state of [{ estado: 'cerrada' }, { estado: 'cancelada' }, { archivado_at: new Date() }, { capacidad: null }]) await assert.rejects(editionFixture(state, 0).service.setReception(1, { revision: 1, estado: 'abierta' }, 1), ConflictException, JSON.stringify(state));
  await assert.rejects(editionFixture({ preinscripcion_estado: 'abierta' }, 0).service.setReception(1, { revision: 1, estado: 'abierta' }, 1), ConflictException);
  const closing = editionFixture({ estado: 'cerrada', archivado_at: new Date(), preinscripcion_estado: 'abierta' }, 0);
  await closing.service.setReception(1, { revision: 1, estado: 'cerrada' }, 1);
  assert.equal(closing.log.update?.preinscripcion_estado, 'cerrada', 'cerrar la recepción siempre se permite');
});

// ---- Aislamiento del chatbot ------------------------------------------------------------------------------------------------------
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');
const sources = (dir: string) => readdirSync(join(__dirname, '..', 'src', dir)).filter(name => name.endsWith('.ts')).map(name => ({ name, text: stripComments(readFileSync(join(__dirname, '..', 'src', dir, name), 'utf8')) }));

test('Aislamiento: ChatbotService/ChatbotModule no conocen las preinscripciones y el módulo de preinscripciones no conoce ni llama a OpenAI', () => {
  for (const { name, text } of sources('chatbot')) {
    assert.doesNotMatch(text, /preinscripci/i, 'chatbot/' + name + ' no debe referirse a preinscripciones');
    assert.doesNotMatch(text, /from '\.\.\/(preinscripciones|matriculas|estudiantes|convocatorias)/, 'chatbot/' + name + ' no importa servicios académicos');
    assert.doesNotMatch(text, /\.(preinscripcion|matricula|estudiante|convocatoria|adminUser)\b/, 'chatbot/' + name + ' no consulta tablas académicas ni administrativas');
  }
  for (const { name, text } of sources('preinscripciones')) {
    assert.doesNotMatch(text, /from '\.\.\/chatbot|ChatbotService|ChatbotModule|openai|OPENAI|\bfetch\s*\(|ConfigService/i, 'preinscripciones/' + name + ' no usa el chatbot, OpenAI, red ni configuración');
  }
  const providers = (Reflect.getMetadata('providers', ChatbotModule) ?? []) as { name: string }[];
  assert.ok(providers.every(provider => !/Preinscripci|Matricula|Estudiante/.test(provider.name)));
  const imports = (Reflect.getMetadata('imports', PreinscripcionesModule) ?? []) as { name: string }[];
  assert.ok(imports.every(module => module.name !== 'ChatbotModule'));
});

test('Aislamiento: registrar una preinscripción nunca llama a la red y los datos del visitante no llegan a OpenAI en ninguna consulta del chat', async () => {
  const original = global.fetch; const outgoing: string[] = [];
  global.fetch = (async (_url: unknown, init?: { body?: string }) => { outgoing.push(String(init?.body ?? '')); return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Respuesta de prueba.' }] }] }), { status: 200 }); }) as never;
  try {
    const { service } = publicFixture();
    await service.register(dto({ nombres: 'Zoila', apellidos: 'Quispe', email: 'zoila.quispe@example.test', telefono: '987123456' }), 'chatbot');
    assert.equal(outgoing.length, 0, 'registrar no genera ninguna petición saliente');
    const rows = [{ id: 1, titulo: 'Curso de redes', descripcion: 'Aprende redes locales.', modalidad: 'virtual', duracion: '20 horas', fecha_inicio: null }];
    const model = { findMany: async () => rows }, empty = { findMany: async () => [] };
    const config = { get: (key: string) => ({ CHATBOT_AI_ENABLED: 'true', OPENAI_API_KEY: 'clave-ficticia', CHATBOT_MODEL: 'modelo-ficticio' } as Record<string, string>)[key] } as ConfigService;
    const chat = new ChatbotService({ curso: model, servicio: empty, preguntaFrecuente: empty, setting: empty, convenio: empty } as never, config);
    const reply = await chat.reply({ message: 'cursos', history: [{ role: 'user', content: 'mi correo es zoila.quispe@example.test y mi teléfono 987123456' }] });
    assert.ok(outgoing.length >= 1, 'la consulta llegó al modelo simulado: ' + reply.mode + '/' + reply.kind);
    for (const body of outgoing) assert.doesNotMatch(body, /zoila\.quispe@example\.test|987123456/i, 'correo y teléfono se redactan antes de salir');
    assert.doesNotMatch(outgoing.join(' '), /preinscripci|matr[ií]cula|estudiante/i, 'el modelo no recibe nada de preinscripciones ni de alumnos');
  } finally { global.fetch = original; }
});

test('Aislamiento: el modelo no tiene herramientas ni endpoints administrativos y las instrucciones le prohíben registrar o inscribir', () => {
  const text = readFileSync(join(__dirname, '..', 'src', 'chatbot', 'chatbot.service.ts'), 'utf8');
  assert.doesNotMatch(text, /\btools\s*:|tool_choice|function_call|functions\s*:/, 'la petición a OpenAI no define herramientas que el modelo pueda invocar');
  assert.match(text, /No afirmes haber enviado mensajes, guardado datos, reservado, inscrito ni ejecutado acciones/);
  assert.match(text, /No pidas datos personales en el chat/);
});

test('Aislamiento: el chatbot solo toca modelos públicos y de métricas, sin SQL crudo ni credenciales de base de datos; la clave de OpenAI solo viaja en la cabecera', async () => {
  const allowedModels = new Set(['setting', 'convenio', 'curso', 'servicio', 'preguntaFrecuente', 'contacto', 'chatbotPreguntaSinRespuesta', 'chatbotInteraccion']);
  for (const { name, text } of sources('chatbot')) {
    for (const match of text.matchAll(/\bthis\.prisma\.(\$?\w+)/g)) assert.ok(allowedModels.has(match[1]), 'chatbot/' + name + ' usa prisma.' + match[1]);
    assert.doesNotMatch(text, /\$queryRaw|\$executeRaw|\$transaction|process\.env|DB_PASS|DB_USER|DB_HOST|DATABASE_URL|JWT_SECRET/, 'chatbot/' + name + ' sin SQL crudo ni credenciales');
    for (const match of text.matchAll(/config\.get<string>\('(\w+)'\)/g)) assert.ok(['OPENAI_API_KEY', 'CHATBOT_MODEL', 'CHATBOT_AI_ENABLED'].includes(match[1]), 'configuración leída: ' + match[1]);
  }
  const controller = readFileSync(join(__dirname, '..', 'src', 'chatbot', 'chatbot.controller.ts'), 'utf8');
  assert.deepEqual([...controller.matchAll(/@Post\('(\w+)'\)/g)].map(match => match[1]), ['message', 'contact'], 'el controlador del chat no tiene rutas de preinscripción ni de administración');
  // /chatbot/message no admite campos de formulario: los datos del visitante no tienen por dónde viajar hacia el modelo.
  const { ChatMessageDto } = await import('../src/chatbot/chatbot.dto');
  await validate({ message: 'hola' }, ChatMessageDto);
  for (const extra of [{ email: 'ana@example.test' }, { telefono: '987654321' }, { nombres: 'Ana' }, { convocatoria: CODE }, { consentimiento: true }, { confirmacion: true }, { doc_numero: '12345678' }])
    await assert.rejects(validate({ message: 'hola', ...extra }, ChatMessageDto), BadRequestException, JSON.stringify(extra));
  // Lo que escribe el visitante en el texto (correo, teléfono, DNI) se redacta antes de salir, y la clave no se devuelve ni va en el cuerpo.
  const original = global.fetch; const sent: { body: string; auth: string }[] = [];
  global.fetch = (async (_url: unknown, init?: { body?: string; headers?: Record<string, string> }) => { sent.push({ body: String(init?.body ?? ''), auth: String(init?.headers?.Authorization ?? '') }); return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Respuesta de prueba.' }] }] }), { status: 200 }); }) as never;
  try {
    const rows = [{ id: 1, titulo: 'Curso de redes', descripcion: 'Aprende redes locales.', modalidad: 'virtual', duracion: '20 horas', fecha_inicio: null }];
    const model = { findMany: async () => rows }, empty = { findMany: async () => [] };
    const config = { get: (key: string) => ({ CHATBOT_AI_ENABLED: 'true', OPENAI_API_KEY: 'clave-ficticia-aislamiento', CHATBOT_MODEL: 'modelo-ficticio' } as Record<string, string>)[key] } as ConfigService;
    const chat = new ChatbotService({ curso: model, servicio: empty, preguntaFrecuente: empty, setting: empty, convenio: empty } as never, config);
    const reply = await chat.reply({ message: 'cursos', history: [{ role: 'user', content: 'soy zoila.quispe@example.test, cel 987 123 456, mi DNI es 12345678' }] });
    assert.ok(sent.length >= 1, 'la consulta llegó al modelo simulado: ' + reply.mode + '/' + reply.kind);
    for (const { body, auth } of sent) {
      assert.doesNotMatch(body, /12345678|zoila\.quispe|987 123 456|clave-ficticia-aislamiento/);
      assert.equal(auth, 'Bearer clave-ficticia-aislamiento', 'la clave solo viaja en la cabecera Authorization');
    }
    assert.doesNotMatch(JSON.stringify(reply), /clave-ficticia-aislamiento|OPENAI|Bearer/, 'la respuesta al visitante no incluye la clave');
  } finally { global.fetch = original; }
});
