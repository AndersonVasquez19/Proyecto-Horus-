import 'reflect-metadata';
import { test, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { HttpException, Logger, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { PublicRateLimitGuard } from '../src/common/public-rate-limit.guard';
import { PrismaService } from '../src/database/prisma.service';
import { AsistenteController } from '../src/asistente/asistente.controller';
import { AsistenteConsultaService } from '../src/asistente/asistente.consulta.service';
import type { AsistenteDataSource } from '../src/asistente/asistente.data';
import { AsistenteExplainer, type Fetcher } from '../src/asistente/asistente.explainer';
import { AsistenteLimites, LIMITE_NO_DISPONIBLE_MESSAGE, LIMITE_RESUMEN_IA_POR_VENTANA, LIMITE_RESUMEN_POR_VENTANA, type LimitesResumen } from '../src/asistente/asistente.limites';
import type { SectionData, SectionKey } from '../src/asistente/asistente.rules';
import { AsistenteService, RATE_MESSAGE } from '../src/asistente/asistente.service';
import { AccessGuard, AccountAccessService } from '../src/permissions/access.guard';
import type { AdminRole } from '../src/permissions/roles';
import { memoryBuckets } from './fixtures/rate-limit-memory';

// Cierre técnico de HORUS Assistant: el resumen v1 (GET resumen) usa el límite COMPARTIDO de la v2.1 y su explicación con IA usa marcadores.
// Todo es SIMULADO: cuentas, datos, MySQL (rate_limit_buckets en memoria) y OpenAI. Ninguna prueba abre MySQL ni contacta con OpenAI.
const G = 'GERENTE_GENERAL', S = 'SECRETARIA';
const NOW = new Date('2026-10-22T14:00:00Z'); // 09:00 en Lima; coincide con el inicio de una ventana de 10 minutos
const AI_ON = { ASISTENTE_AI_ENABLED: 'true', OPENAI_API_KEY: 'clave-ficticia-de-prueba', CHATBOT_MODEL: 'modelo-ficticio' };

const FULL: SectionData = {
  atencion: { total: 40, nuevos: 3, enProceso: 2, antiguos: 1, personasPendientes: 4, recibidosHoy: 5, personasUnicasHoy: 4, recibidosHoyChatbot: 1 },
  chatbot: { interaccionesHoy: 12, resueltasHoy: 9, sinResolverHoy: 3, conIaHoy: 7, preguntasSinRespuestaVigentes: 6 },
  cotizaciones: { porEstado: { borrador: 2, enviada: 4, aceptada: 1 }, vencidas: 2 },
  preinscripciones: { total: 30, vigentes: 25, recibidas: 8, pendientesRevision: 7, validadas: 6, convertidas: 11, descartadas: 3, desistidas: 2 },
  aperturas: { listasParaApertura: 1 },
  ediciones: { abiertas: 3, planificadasConInicioVencido: 2 },
  matriculas: { porConfirmarCumplimiento: 9 },
};

const configOf = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;
const okResponse = (text: string) => ({ ok: true, status: 200, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }) });
const status = (error: unknown) => error instanceof HttpException ? error.getStatus() : -1;
const bodyOf = (error: unknown) => (error as HttpException).getResponse() as Record<string, any>;

function fakeData(role: string | null = G) {
  const reads: SectionKey[] = [];
  const source: AsistenteDataSource = {
    account: async id => id === 99 ? null : { activo: true, rol: id === 3 ? S as AdminRole : id === 4 ? null : role as AdminRole | null },
    read: async section => { reads.push(section); return FULL[section] as never; },
  };
  return { source, reads };
}

// Una «instancia» del servidor: servicio + explicador propios, pero el MISMO almacén de límites (varios procesos con un único MySQL).
function instance(options: { buckets?: ReturnType<typeof memoryBuckets>; fetcher?: Fetcher; limites?: LimitesResumen; role?: string | null; config?: Record<string, string> } = {}) {
  const buckets = options.buckets ?? memoryBuckets();
  const data = fakeData(options.role === undefined ? G : options.role);
  const explainer = new AsistenteExplainer(configOf(options.config ?? AI_ON));
  const calls: string[] = [];
  explainer.fetcher = async (url, init) => { calls.push(init.body); return (options.fetcher ?? (async () => okResponse('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender.')))(url, init); };
  const service = new AsistenteService(data.source, explainer, options.limites ?? new AsistenteLimites(buckets.prisma as PrismaService));
  return { service, data, explainer, calls, buckets };
}

// ---------------------------------------------------------------------------------------------------------------------------
// 1. Límites compartidos entre instancias (se conservan los topes de la v1: 30 por 10 min; 6 con IA)
// ---------------------------------------------------------------------------------------------------------------------------
test('los topes de la v1 se conservan: 30 solicitudes por ventana y 6 con IA', () => {
  assert.equal(LIMITE_RESUMEN_POR_VENTANA, 30);
  assert.equal(LIMITE_RESUMEN_IA_POR_VENTANA, 6);
});

test('dos instancias comparten el tope del resumen por cuenta: 15 + 15 atendidas, la 31.ª es 429 en cualquiera, y otra cuenta no se ve afectada', async () => {
  const shared = memoryBuckets();
  const a = instance({ buckets: shared }), b = instance({ buckets: shared });
  for (let i = 0; i < 30; i++) await (i % 2 ? a : b).service.resumen(1, {}, new Date(NOW.getTime() + i));
  for (const node of [a, b]) {
    const before = node.data.reads.length;
    await assert.rejects(() => node.service.resumen(1, {}, new Date(NOW.getTime() + 100)), (error: unknown) => {
      const body = bodyOf(error);
      return status(error) === 429 && body.ok === false && body.mensaje === RATE_MESSAGE && body.reintentar_en_segundos >= 1 && body.reintentar_en_segundos <= 600;
    });
    assert.equal(node.data.reads.length, before, 'una solicitud limitada no toca la base');
  }
  assert.equal((await b.service.resumen(3, {}, new Date(NOW.getTime() + 100))).ok, true, 'la cuota es de la cuenta');
  // Pasada la ventana vuelve a haber cupo.
  assert.equal((await a.service.resumen(1, {}, new Date(NOW.getTime() + 10 * 60_000 + 1000))).ok, true);
});

test('el tope de IA (6) se reparte entre instancias; una solicitud con IA rechazada no gasta la cuota del resumen y las consultas sin IA siguen', async () => {
  const shared = memoryBuckets();
  const a = instance({ buckets: shared }), b = instance({ buckets: shared });
  for (let i = 0; i < 6; i++) await (i % 2 ? a : b).service.resumen(1, { explicar: true }, new Date(NOW.getTime() + i));
  assert.deepEqual([...shared.buckets.values()].sort(), [6, 6]);
  for (const node of [a, b]) await assert.rejects(() => node.service.resumen(1, { explicar: true }, new Date(NOW.getTime() + 50)), (error: unknown) => status(error) === 429);
  assert.deepEqual([...shared.buckets.values()].sort(), [6, 6], 'las rechazadas por IA se revirtieron: el cupo del resumen sigue en 6');
  assert.equal(a.calls.length + b.calls.length, 6, 'las rechazadas no llegan a OpenAI');
  assert.equal((await a.service.resumen(1, {}, new Date(NOW.getTime() + 60))).explicacion.estado, 'no_solicitada');
});

test('los identificadores de los cubos son hashes: no quedan ni el id de cuenta ni nombres legibles', async () => {
  const shared = memoryBuckets();
  await instance({ buckets: shared }).service.resumen(1, { explicar: true }, NOW);
  const keys = [...shared.buckets.keys()];
  assert.equal(keys.length, 2);
  assert.ok(keys.every(key => /^[0-9a-f]{64}$/.test(key)), keys.join());
});

test('el resumen y las consultas conversacionales tienen cubos propios: gastar uno no agota el otro', async () => {
  const shared = memoryBuckets();
  const limites = new AsistenteLimites(shared.prisma as PrismaService);
  for (let i = 0; i < 10; i++) await limites.admitir(1, new Date(NOW.getTime() + i));
  await assert.rejects(() => limites.admitir(1, new Date(NOW.getTime() + 20)), (error: unknown) => status(error) === 429);
  assert.equal((await instance({ buckets: shared }).service.resumen(1, {}, new Date(NOW.getTime() + 30))).ok, true);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2. Solicitudes concurrentes
// ---------------------------------------------------------------------------------------------------------------------------
test('40 solicitudes simultáneas de una cuenta desde dos instancias: exactamente 30 atendidas y 10 rechazadas con 429, sin superar el tope', async () => {
  const shared = memoryBuckets();
  const nodes = [instance({ buckets: shared }), instance({ buckets: shared })];
  const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => nodes[i % 2].service.resumen(1, {}, new Date(NOW.getTime() + 5))));
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 30);
  assert.equal(rejected.length, 10);
  assert.ok(rejected.every(r => status(r.reason) === 429));
  assert.deepEqual([...shared.buckets.values()], [30], 'las rechazadas no incrementan el cubo');
  assert.equal(nodes[0].data.reads.length + nodes[1].data.reads.length, 30 * 7, 'solo las atendidas consultan datos (7 secciones del gerente; la de sesiones se retiró)');
});

test('12 solicitudes simultáneas con IA desde dos instancias: 6 admitidas, 6 con 429, y a OpenAI nunca llegan más de 6', async () => {
  const shared = memoryBuckets();
  const nodes = [instance({ buckets: shared }), instance({ buckets: shared })];
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => nodes[i % 2].service.resumen(1, { explicar: true }, new Date(NOW.getTime() + 5))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 6);
  assert.equal(results.filter(r => r.status === 'rejected' && status(r.reason) === 429).length, 6);
  assert.ok(nodes[0].calls.length + nodes[1].calls.length <= 6);
  assert.deepEqual([...shared.buckets.values()].sort(), [6, 6]);
});

test('cuentas distintas en paralelo no se estorban', async () => {
  const shared = memoryBuckets();
  const node = instance({ buckets: shared });
  const results = await Promise.allSettled([1, 2, 3, 4].map(id => node.service.resumen(id, {}, NOW)));
  // El 4 no tiene rol (403): consume su propia cuota pero no impide a los demás.
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 3. Caída de MySQL en el almacén de límites (falla CERRADA)
// ---------------------------------------------------------------------------------------------------------------------------
test('si el almacén compartido cae: 503 limite_no_disponible, sin leer datos, sin llamar a OpenAI y sin filtrar el error', async () => {
  const secret = 'mysql://usuario:clave-interna@host-interno';
  const down: any = { $transaction: async () => { throw new Error('connect ECONNREFUSED ' + secret); } };
  const lines: string[] = [];
  const warn = mock.method(Logger.prototype, 'warn', (message: unknown) => { lines.push(String(message)); });
  try {
    for (const explicar of [false, true]) {
      const node = instance({ limites: new AsistenteLimites(down as PrismaService) });
      let thrown: unknown;
      try { await node.service.resumen(1, { explicar }, NOW); } catch (error) { thrown = error; }
      assert.equal(status(thrown), 503);
      assert.deepEqual(bodyOf(thrown), { ok: false, codigo: 'limite_no_disponible', mensaje: LIMITE_NO_DISPONIBLE_MESSAGE });
      assert.deepEqual(node.data.reads, []);
      assert.equal(node.calls.length, 0);
      assert.ok(!JSON.stringify(bodyOf(thrown)).includes('ECONNREFUSED') && !JSON.stringify(bodyOf(thrown)).includes(secret));
    }
  } finally { warn.mock.restore(); }
  assert.ok(lines.some(line => /límite de uso no disponible \(Error\)/.test(line)));
  assert.ok(!lines.join('\n').includes(secret), 'el registro solo lleva el tipo del error');
});

test('conflictos de escritura (interbloqueo): se reintenta; si persisten, 503 sin admitir (nunca se omite el límite)', async () => {
  const conflict = () => new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2034', clientVersion: 'test' });
  const shared = memoryBuckets();
  let failures = 2;
  const flaky: any = { ...shared.prisma, $transaction: async (run: any, options: any) => { if (failures-- > 0) throw conflict(); return shared.prisma.$transaction(run, options); } };
  assert.equal((await instance({ limites: new AsistenteLimites(flaky as PrismaService) }).service.resumen(1, {}, NOW)).ok, true);
  const warn = mock.method(Logger.prototype, 'warn', () => undefined);
  try {
    const stuck: any = { ...shared.prisma, $transaction: async () => { throw conflict(); } };
    const node = instance({ limites: new AsistenteLimites(stuck as PrismaService) });
    await assert.rejects(() => node.service.resumen(1, {}, NOW), (error: unknown) => status(error) === 503 && bodyOf(error).codigo === 'limite_no_disponible');
    assert.deepEqual(node.data.reads, []);
  } finally { warn.mock.restore(); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// 4. Cifras intercambiadas en la explicación con IA
// ---------------------------------------------------------------------------------------------------------------------------
const explain = async (text: string, role: string | null = G) => (await instance({ role, fetcher: async () => okResponse(text) }).service.resumen(role === S ? 3 : 1, { explicar: true }, NOW)).explicacion as { estado: string; texto?: string; validacion?: string };

test('la redacción fiel pasa y las cifras las pone el servidor (3 mensajes nuevos, 9 matrículas por confirmar)', async () => {
  const result = await explain('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender y {{pendientes.matriculas_por_confirmar}} matrículas activas de ediciones cerradas sin confirmar cumplimiento.');
  assert.equal(result.estado, 'generada');
  assert.equal(result.validacion, 'cifras_verificadas');
  assert.equal(result.texto, '3 mensajes nuevos sin atender y 9 matrículas activas de ediciones cerradas sin confirmar cumplimiento.');
});

test('cifras intercambiadas entre dos pendientes se descartan (antes bastaba con que cada número existiera en las cifras)', async () => {
  const warn = mock.method(Logger.prototype, 'warn', () => undefined);
  try {
    // El marcador de las matrículas junto al concepto de los mensajes, y al revés: «9 mensajes nuevos y 3 matrículas» sería el error.
    assert.equal((await explain('{{pendientes.matriculas_por_confirmar}} mensajes nuevos sin atender y {{pendientes.mensajes_nuevos}} matrículas activas de ediciones cerradas sin confirmar cumplimiento.')).estado, 'no_disponible');
    assert.equal((await explain('{{pendientes.matriculas_por_confirmar}} mensajes nuevos sin atender.')).estado, 'no_disponible');
    // Dígitos escritos por el modelo, aunque cada uno exista entre las cifras (el caso que el validador anterior aceptaba).
    assert.equal((await explain('9 mensajes nuevos sin atender y 3 matrículas activas de ediciones cerradas sin confirmar cumplimiento.')).estado, 'no_disponible');
    assert.equal((await explain('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender y 9 matrículas activas.')).estado, 'no_disponible');
  } finally { warn.mock.restore(); }
});

test('cantidades iguales con conceptos distintos (2 y 2): el marcador, no el número, identifica el pendiente', async () => {
  const warn = mock.method(Logger.prototype, 'warn', () => undefined);
  try {
    assert.equal(FULL.cotizaciones.vencidas, FULL.cotizaciones.porEstado.borrador);
    assert.equal((await explain('{{pendientes.cotizaciones_borrador}} borradores de cotización sin enviar.')).texto, '2 borradores de cotización sin enviar.');
    assert.equal((await explain('{{pendientes.cotizaciones_vencidas}} borradores de cotización sin enviar.')).estado, 'no_disponible');
    assert.equal((await explain('{{pendientes.cotizaciones_borrador}} cotizaciones enviadas con validez vencida.')).estado, 'no_disponible');
  } finally { warn.mock.restore(); }
});

test('calcular, comparar o citar un marcador que no existe (o de un área que el rol no ve) descarta la redacción', async () => {
  const warn = mock.method(Logger.prototype, 'warn', () => undefined);
  try {
    assert.equal((await explain('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender, más que las matrículas.')).estado, 'no_disponible');
    assert.equal((await explain('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender, el doble de ayer.')).estado, 'no_disponible');
    assert.equal((await explain('{{pendientes.inventado}} mensajes nuevos sin atender.')).estado, 'no_disponible');
    // La secretaria no ve cotizaciones: el pendiente no existe para ella, ni siquiera con su marcador.
    assert.equal((await explain('{{pendientes.cotizaciones_vencidas}} cotizaciones enviadas con validez vencida.', S)).estado, 'no_disponible');
    // Las sesiones se retiraron: su antiguo marcador tampoco existe para nadie.
    assert.equal((await explain('{{pendientes.sesiones_atrasadas}} sesiones pasadas sin marcar como realizada o cancelada.')).estado, 'no_disponible');
    assert.equal((await explain('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender.', S)).texto, '3 mensajes nuevos sin atender.');
  } finally { warn.mock.restore(); }
});

test('a la IA no viaja ninguna cantidad ni valor, y la explicación nunca cambia los pendientes ni el texto determinista', async () => {
  const node = instance({ fetcher: async () => okResponse('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender.') });
  const withAi = await node.service.resumen(1, { explicar: true }, NOW);
  const base = await instance().service.resumen(1, {}, new Date(NOW.getTime() + 1));
  const sent = JSON.parse(node.calls[0]);
  assert.ok(!/"(cantidad|valor)"/.test(sent.input[0].content));
  assert.equal(withAi.explicacion.estado, 'generada');
  assert.deepEqual(withAi.pendientes, base.pendientes);
  assert.equal(withAi.resumen.texto, base.resumen.texto);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 5. Respuesta segura ante fallos de OpenAI: el resumen determinista se entrega siempre
// ---------------------------------------------------------------------------------------------------------------------------
test('ante cualquier fallo de OpenAI el resumen determinista es idéntico al de una solicitud sin IA y no se filtra el error ni la clave', async () => {
  const warn = mock.method(Logger.prototype, 'warn', () => undefined);
  const failures: [string, Fetcher][] = [
    ['red', async () => { throw new Error('connect ECONNREFUSED clave-ficticia-de-prueba'); }],
    ['500', async () => ({ ok: false, status: 500, json: async () => ({}) })],
    ['429', async () => ({ ok: false, status: 429, json: async () => ({}) })],
    ['json ilegible', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < en <html>'); } })],
    ['incompleta', async () => ({ ok: true, status: 200, json: async () => ({ status: 'incomplete', output: [] }) })],
    ['vacía', async () => okResponse('   ')],
    ['tiempo agotado', async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }],
    ['sin marcadores', async () => okResponse('Tienes varios pendientes importantes hoy.')],
  ];
  try {
    const base = await instance().service.resumen(1, {}, NOW);
    for (const [name, fetcher] of failures) {
      const result = await instance({ fetcher }).service.resumen(1, { explicar: true }, NOW);
      assert.equal(result.ok, true, name);
      assert.equal(result.explicacion.estado, 'no_disponible', name);
      assert.equal(result.resumen.texto, base.resumen.texto, name);
      assert.deepEqual(result.pendientes, base.pendientes, name);
      assert.ok(!JSON.stringify(result).includes('ECONNREFUSED') && !JSON.stringify(result).includes('clave-ficticia') && !JSON.stringify(result).includes('<html>'), name);
    }
    assert.ok(!JSON.stringify(warn.mock.calls.map(call => call.arguments)).includes('clave-ficticia'), 'el registro no contiene la clave');
  } finally { warn.mock.restore(); }
});

test('si el explicador fallara de forma inesperada (lanza), el resumen se entrega igual', async () => {
  const warn = mock.method(Logger.prototype, 'warn', () => undefined);
  try {
    const node = instance();
    node.explainer.explain = async () => { throw new TypeError('fallo interno con datos sensibles 12345678'); };
    const result = await node.service.resumen(1, { explicar: true }, NOW);
    assert.equal(result.ok, true);
    assert.equal(result.explicacion.estado, 'no_disponible');
    assert.ok(result.resumen.texto.length > 0 && result.pendientes.length > 0);
    assert.ok(!JSON.stringify(result).includes('12345678'));
  } finally { warn.mock.restore(); }
});

test('IA apagada o sin clave: no se llama a OpenAI y el resumen se entrega con el estado «no_configurada»', async () => {
  const node = instance({ config: { ...AI_ON, ASISTENTE_AI_ENABLED: 'false' } });
  const result = await node.service.resumen(1, { explicar: true }, NOW);
  assert.equal(result.explicacion.estado, 'no_configurada');
  assert.equal(node.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 6. Compatibilidad con el endpoint actual (HTTP con controlador, guardas y JWT reales)
// ---------------------------------------------------------------------------------------------------------------------------
const SECRET = 'isolated-asistente-resumen-secret-32-characters!';
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } });
const rows: Record<number, { id: number; nombre: string; email: string; activo: boolean; session_version: number; rol: string | null }> = {
  1: { id: 1, nombre: 'Gerente', email: 'g@example.test', activo: true, session_version: 3, rol: G },
  3: { id: 3, nombre: 'Secretaria', email: 's@example.test', activo: true, session_version: 3, rol: S },
  4: { id: 4, nombre: 'Sin rol', email: 'n@example.test', activo: true, session_version: 3, rol: null },
  5: { id: 5, nombre: 'Inactiva', email: 'i@example.test', activo: false, session_version: 3, rol: G },
};
const token = (id: number) => jwt.sign({ id, email: rows[id].email, version: 3 });

async function startHttp(options: { buckets?: ReturnType<typeof memoryBuckets>; fetcher?: Fetcher; limitesPrisma?: unknown } = {}) {
  const buckets = options.buckets ?? memoryBuckets();
  const data: AsistenteDataSource & { reads: SectionKey[] } = {
    reads: [],
    async account(id) { const row = rows[id]; return row ? { activo: row.activo, rol: row.rol as AdminRole | null } : null; },
    async read(section) { this.reads.push(section); return FULL[section] as never; },
  };
  const explainer = new AsistenteExplainer(configOf(AI_ON));
  const calls: string[] = [];
  explainer.fetcher = async (url, init) => { calls.push(init.body); return (options.fetcher ?? (async () => okResponse('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender.')))(url, init); };
  const limites = new AsistenteLimites((options.limitesPrisma ?? buckets.prisma) as PrismaService);
  const resumen = new AsistenteService(data, explainer, limites);
  const consultas = new AsistenteConsultaService(data as never, explainer, limites);
  const prisma: any = { ...buckets.prisma, adminUser: { findUnique: async ({ where, select }: any) => { const row = rows[where.id]; return !row ? null : select ? Object.fromEntries(Object.keys(select).map(key => [key, (row as any)[key]])) : { ...row }; } } };
  const settings = { get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined) };
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [AsistenteController],
    providers: [JwtStrategy, JwtAuthGuard, AccountAccessService,
      { provide: APP_GUARD, useClass: PublicRateLimitGuard }, { provide: APP_GUARD, useClass: AccessGuard },
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: settings }, { provide: PrismaService, useValue: prisma },
      { provide: AsistenteService, useValue: resumen }, { provide: AsistenteConsultaService, useValue: consultas }],
  })
  class ResumenHttpModule {}
  const app = await NestFactory.create(ResumenHttpModule, { logger: false });
  const { createValidationPipe } = await import('../src/common/validation');
  app.useGlobalPipes(createValidationPipe());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const get = async (query: string, auth?: string) => {
    const response = await fetch(url + '/api/admin/asistente/resumen' + query, { headers: auth ? { Authorization: 'Bearer ' + auth } : {} });
    const text = await response.text();
    return { status: response.status, text, data: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
  };
  return { app, get, calls, data };
}

test('HTTP: el contrato de GET resumen no cambia (mismos campos de siempre; la explicación solo añade «validacion»)', async () => {
  const { app, get, calls } = await startHttp();
  try {
    const plain = await get('', token(1));
    assert.equal(plain.status, 200);
    assert.deepEqual(Object.keys(plain.data).sort(), ['acceso', 'alcance', 'explicacion', 'fuentes', 'generado_en', 'indicadores_atencion', 'no_registrado', 'ok', 'pendientes', 'resumen', 'secciones', 'ventana_hoy', 'zona_horaria', 'fecha_operativa'].sort());
    assert.deepEqual(Object.keys(plain.data.resumen).sort(), ['pendientes_total', 'pendientes_truncados', 'texto', 'vacio']);
    assert.deepEqual(Object.keys(plain.data.pendientes[0]).sort(), ['area', 'cantidad', 'detalle', 'id', 'permiso', 'puedeActuar', 'severidad', 'titulo']);
    assert.deepEqual(Object.keys(plain.data.fuentes[0]).sort(), ['consultado_en', 'estado', 'seccion', 'tablas', 'ventana']);
    assert.deepEqual(plain.data.explicacion, { estado: 'no_solicitada' });
    assert.equal(plain.data.alcance, 'solo_lectura');
    assert.equal(calls.length, 0);

    const withAi = await get('?explicar=true', token(1));
    assert.equal(withAi.status, 200);
    assert.deepEqual(Object.keys(withAi.data.explicacion).sort(), ['estado', 'modelo', 'texto', 'validacion'], 'estado, texto y modelo conservan su forma; solo se añade validacion');
    assert.equal(withAi.data.explicacion.estado, 'generada');
    assert.equal(withAi.data.explicacion.texto, '3 mensajes nuevos sin atender.');
    assert.equal(withAi.data.resumen.texto, plain.data.resumen.texto);
    assert.deepEqual(withAi.data.pendientes, plain.data.pendientes);
    assert.ok(!/clave-ficticia|SELECT|prisma|stack/i.test(withAi.text));
  } finally { await app.close(); }
});

test('HTTP: 401, 403 y 400 se conservan; la secretaria sigue sin ver áreas ajenas', async () => {
  const { app, get, calls } = await startHttp();
  try {
    assert.equal((await get('')).status, 401);
    assert.equal((await get('', 'no-es-un-token')).status, 401);
    assert.equal((await get('', token(5))).status, 401, 'cuenta inactiva');
    assert.equal((await get('', token(4))).status, 403, 'cuenta sin rol');
    assert.equal((await get('?explicar=1', token(1))).status, 400);
    assert.equal(calls.length, 0);
    const secretaria = await get('', token(3));
    assert.equal(secretaria.status, 200);
    assert.equal(secretaria.data.acceso.rol, S);
    assert.ok(!/cotizaci|certificado|sesi[oó]n/i.test(secretaria.text));
  } finally { await app.close(); }
});

test('HTTP con dos instancias: el 429 del resumen es compartido y conserva ok:false, mensaje y reintentar_en_segundos', async () => {
  const shared = memoryBuckets();
  const first = await startHttp({ buckets: shared }), second = await startHttp({ buckets: shared });
  try {
    for (let i = 0; i < 30; i++) assert.equal((await (i % 2 ? first : second).get('', token(1))).status, 200, 'solicitud ' + (i + 1));
    for (const node of [first, second]) {
      const limited = await node.get('', token(1));
      assert.equal(limited.status, 429);
      assert.equal(limited.data.ok, false);
      assert.equal(limited.data.mensaje, RATE_MESSAGE);
      assert.ok(limited.data.reintentar_en_segundos >= 1);
    }
    assert.equal((await second.get('', token(3))).status, 200, 'otra cuenta no se ve afectada');
  } finally { await first.app.close(); await second.app.close(); }
});

test('HTTP: sin el almacén compartido el resumen responde 503 controlado, sin datos, sin OpenAI y sin detalles internos', async () => {
  const down: any = { $transaction: async () => { throw new Error('connect ECONNREFUSED mysql://usuario:clave-interna@host'); } };
  const warn = mock.method(Logger.prototype, 'warn', () => undefined);
  const { app, get, calls, data } = await startHttp({ limitesPrisma: down });
  try {
    const res = await get('?explicar=true', token(1));
    assert.equal(res.status, 503);
    assert.deepEqual(res.data, { ok: false, codigo: 'limite_no_disponible', mensaje: LIMITE_NO_DISPONIBLE_MESSAGE });
    assert.ok(!/ECONNREFUSED|clave-interna/.test(res.text));
    assert.equal(calls.length, 0);
    assert.deepEqual(data.reads, []);
  } finally { warn.mock.restore(); await app.close(); }
});
