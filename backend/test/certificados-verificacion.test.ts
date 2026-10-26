import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { HttpException, Module, NotFoundException } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { PublicRateLimitGuard } from '../src/common/public-rate-limit.guard';
import { trustedProxies } from '../src/common/trusted-proxies';
import { PrismaService } from '../src/database/prisma.service';
import { CertificadosPublicController } from '../src/certificados/certificados.controller';
import { CertificadosModule } from '../src/certificados/certificados.module';
import { CertificadosService } from '../src/certificados/certificados.service';
import { ROUTE_INVENTORY } from '../src/permissions/route-inventory';
import { memoryBuckets } from './fixtures/rate-limit-memory';

// Aislado: sin MySQL, sin correo, sin red externa y sin datos reales. Ninguna prueba abre .env ni lee secretos: la configuración se pasa explícita.

const CODE = 'ABCDEFGHJKLMNPQRSTUV';
const DNI = '01234567';

// ---------------------------------------------------------------------------------------------------------------------------------
// Alcance: solo queda la verificación pública (los certificados se emiten y entregan fuera de la plataforma)
// ---------------------------------------------------------------------------------------------------------------------------------
test('Alcance: el módulo expone solo la verificación pública por código; no hay rutas administrativas, PDF ni QR', () => {
  const controllers: Function[] = Reflect.getMetadata('controllers', CertificadosModule);
  assert.deepEqual(controllers, [CertificadosPublicController]);
  assert.deepEqual(Reflect.getMetadata(ACCESS_METADATA, CertificadosPublicController.prototype.verify), { kind: 'publica' });
  assert.equal(Reflect.getMetadata('path', CertificadosPublicController.prototype.verify), 'verificar/:codigo');
  const service = Object.getOwnPropertyNames(CertificadosService.prototype).filter(name => name !== 'constructor');
  assert.deepEqual(service, ['verify']);
  const routes = ROUTE_INVENTORY.map(route => route.path).filter(path => path.includes('certificados'));
  assert.deepEqual(routes, ['certificados/verificar/:codigo']);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Verificación pública: límite de frecuencia
// ---------------------------------------------------------------------------------------------------------------------------------
function limiter() {
  const memory = memoryBuckets();
  const guard = new PublicRateLimitGuard(memory.prisma as never);
  const call = (method: string, path: string, ip = '203.0.113.1') => guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method, path, ip, socket: { remoteAddress: ip } }) }) } as never);
  const outcome = async (method: string, path: string, ip?: string) => { try { await call(method, path, ip); return 200; } catch (error) { if (error instanceof HttpException) return error.getStatus(); throw error; } };
  return { ...memory, outcome };
}
// El guard cuenta por minuto/hora natural: se fija el reloj para que una prueba no cruce el cambio de ventana.
async function withClock<T>(work: () => Promise<T>): Promise<T> {
  const real = Date.now, fixed = Math.floor(real() / 3_600_000) * 3_600_000 + 1_800_000;
  Date.now = () => fixed;
  try { return await work(); } finally { Date.now = real; }
}
const verify = (code: string) => '/api/certificados/verificar/' + code;

test('Frecuencia/verificación: 30 consultas por minuto por IP; la 31 recibe 429; otra IP conserva su cuota', () => withClock(async () => {
  const l = limiter();
  for (let i = 0; i < 30; i++) assert.equal(await l.outcome('GET', verify(CODE)), 200, 'consulta ' + (i + 1));
  assert.equal(await l.outcome('GET', verify(CODE)), 429);
  assert.equal(await l.outcome('GET', verify('OTROCODIGOCUALQUIERA')), 429, 'cambiar de código no evita el límite');
  assert.equal(await l.outcome('GET', verify(CODE), '198.51.100.77'), 200, 'otra IP (otra subred) tiene su cuota');
}));
test('Frecuencia/verificación: códigos válidos, inexistentes y mal formados gastan la misma cuota (el 429 no revela si el código existe)', () => withClock(async () => {
  const l = limiter();
  const codes = [CODE, 'ZZZZZZZZZZZZZZZZZZZZ', 'x', 'ABC%20DEF', "'%20OR%201=1", 'a'.repeat(300), CODE.toLowerCase()];
  for (let i = 0; i < 30; i++) assert.equal(await l.outcome('GET', verify(codes[i % codes.length])), 200);
  for (const code of codes) assert.equal(await l.outcome('GET', verify(code)), 429, code);
  assert.equal(l.total() > 0, true);
}));
test('Frecuencia/verificación: aplica con barra final, mayúsculas y sin el prefijo /api; las demás rutas GET y el resto de POST no cambian', () => withClock(async () => {
  const l = limiter();
  for (let i = 0; i < 10; i++) await l.outcome('GET', '/api/certificados/verificar/' + CODE + '/');
  for (let i = 0; i < 10; i++) await l.outcome('GET', '/API/CERTIFICADOS/VERIFICAR/' + CODE);
  for (let i = 0; i < 10; i++) await l.outcome('GET', '/certificados/verificar/' + CODE);
  assert.equal(await l.outcome('GET', verify(CODE)), 429, 'las tres formas comparten una sola cuota');
  const free = limiter();
  for (let i = 0; i < 100; i++) {
    assert.equal(await free.outcome('GET', '/api/admin/certificados/1/pdf'), 200);
    assert.equal(await free.outcome('GET', '/api/certificados/verificar'), 200, 'sin código no es esa ruta');
    assert.equal(await free.outcome('GET', '/api/certificados/verificar/a/b'), 200);
    assert.equal(await free.outcome('GET', '/api/cursos'), 200);
  }
  assert.equal(free.total(), 0, 'no se cuenta nada fuera de la verificación');
  const post = limiter();
  for (let i = 0; i < 5; i++) assert.equal(await post.outcome('POST', '/api/contacto'), 200);
  assert.equal(await post.outcome('POST', '/api/contacto'), 429, 'los formularios siguen con su límite de 5');
  assert.equal(await post.outcome('GET', verify(CODE)), 200, 'la verificación tiene su propio contador por ruta');
}));
test('Frecuencia/verificación: tope por subred (90/min), por hora (200) y global (600/min); una IP bloqueada no agota el global', () => withClock(async () => {
  // Subred /24: 90 por minuto en total aunque cada IP gaste menos de 30.
  const subnet = limiter();
  let admitted = 0;
  for (let host = 1; host <= 5; host++) for (let i = 0; i < 25; i++) if (await subnet.outcome('GET', verify(CODE), '203.0.113.' + host) === 200) admitted++;
  assert.equal(admitted, 90);
  // Por hora: una IP que respeta los 30/min igualmente se detiene a las 200 consultas de la hora.
  const fixed = Date.now, base = fixed();
  const hourly = limiter();
  let perHour = 0;
  try {
    for (let minute = 0; minute < 8; minute++) {
      Date.now = () => base + minute * 60_000;
      for (let i = 0; i < 30; i++) if (await hourly.outcome('GET', verify(CODE), '192.0.2.50') === 200) perHour++;
    }
  } finally { Date.now = fixed; }
  assert.equal(perHour, 200);
  // Global: 20 subredes distintas llenan 600/min; la 21 recibe 429.
  const global = limiter();
  let globalAdmitted = 0;
  for (let net = 1; net <= 21; net++) for (let i = 0; i < 30; i++) if (await global.outcome('GET', verify(CODE), '198.51.' + net + '.10') === 200) globalAdmitted++;
  assert.equal(globalAdmitted, 600);
  // Una IP que insiste tras bloquearse solo gasta su propio tope: no consume ni el global ni las cuotas ajenas.
  const own = limiter();
  for (let i = 0; i < 200; i++) await own.outcome('GET', verify(CODE), '192.0.2.1');
  assert.equal(own.total(), 4 * 30, 'IP, hora, subred y global: 30 admitidas en cada uno; los rechazos no suman');
  assert.equal(await own.outcome('GET', verify(CODE), '198.51.100.5'), 200);
}));
test('Frecuencia/verificación: la ventana por minuto se reinicia', async () => {
  const real = Date.now, start = Math.floor(real() / 3_600_000) * 3_600_000 + 600_000;
  try {
    Date.now = () => start;
    const l = limiter();
    for (let i = 0; i < 30; i++) await l.outcome('GET', verify(CODE));
    assert.equal(await l.outcome('GET', verify(CODE)), 429);
    Date.now = () => start + 61_000;
    assert.equal(await l.outcome('GET', verify(CODE)), 200);
  } finally { Date.now = real; }
});

// HTTP real: mismo 404 para códigos mal formados e inexistentes, y límite por visitante detrás de un proxy de confianza (como main.ts).
async function startPublic(trusted: string | undefined, rows: Record<string, any> = {}) {
  const calls: unknown[] = [];
  const prisma = { certificado: { findUnique: async ({ where }: any) => { calls.push(where.codigo_verificacion); return rows[where.codigo_verificacion] ?? null; } } };
  const service = new CertificadosService(prisma as unknown as PrismaService);
  @Module({ controllers: [CertificadosPublicController], providers: [{ provide: CertificadosService, useValue: service }, { provide: APP_GUARD, useClass: PublicRateLimitGuard }, { provide: PrismaService, useValue: memoryBuckets().prisma }] })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  app.set('trust proxy', trustedProxies(trusted));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  const get = (path: string, forwardedFor?: string) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path, headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {} }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
  return { get, calls, close: () => app.close() };
}
const stored = { estado: 'vigente', estudiante_nombres: 'Ana', estudiante_apellidos: 'Quispe', curso_titulo: 'Excel', curso_tipo: 'curso', curso_duracion: null, convocatoria_nombre: 'Ed 1', convocatoria_fecha_inicio: null, convocatoria_fecha_fin: null, emitido_at: new Date('2026-12-02T00:00:00Z'), sustituido_por: null };

test('Verificación HTTP: contrato intacto (200 con la vista pública) y el mismo 404 exacto para mal formado e inexistente', () => withClock(async () => {
  const server = await startPublic(undefined, { [CODE]: stored });
  try {
    const ok = await server.get('/api/certificados/verificar/' + CODE);
    assert.equal(ok.status, 200); assert.equal(ok.headers['cache-control'], 'no-store');
    const body = JSON.parse(ok.body);
    assert.deepEqual(Object.keys(body).sort(), ['convocatoria', 'curso', 'emitido', 'estado', 'estudiante', 'ok', 'sustituido', 'valido']);
    assert.ok(!ok.body.includes(DNI));
    const unknown = await server.get('/api/certificados/verificar/ZZZZZZZZZZZZZZZZZZZZ');
    const malformed = await server.get('/api/certificados/verificar/no-es-un-codigo');
    const injection = await server.get("/api/certificados/verificar/'%20OR%201=1--");
    const tooLong = await server.get('/api/certificados/verificar/' + 'A'.repeat(500));
    for (const miss of [unknown, malformed, injection, tooLong]) { assert.equal(miss.status, 404); assert.equal(miss.body, unknown.body); assert.equal(miss.headers['cache-control'], 'no-store'); }
    assert.match(unknown.body, /No se encontr/);
    assert.deepEqual(server.calls, [CODE, 'ZZZZZZZZZZZZZZZZZZZZ'], 'los formatos imposibles ni siquiera consultan la base');
  } finally { await server.close(); }
}));
test('Verificación HTTP: detrás de un proxy confiable cada visitante tiene su cuota y una X-Forwarded-For falsificada no evita el límite', () => withClock(async () => {
  const server = await startPublic('127.0.0.1/32');
  const A = '203.0.113.7', B = '198.51.100.9';
  try {
    for (let i = 0; i < 30; i++) assert.equal((await server.get('/api/certificados/verificar/ZZZZZZZZZZZZZZZZZZZ' + (i % 10), A)).status, 404);
    const blocked = await server.get('/api/certificados/verificar/' + CODE, A);
    assert.equal(blocked.status, 429);
    assert.ok(!blocked.body.includes(CODE) && !/existe|encontr/i.test(blocked.body), 'el 429 no dice nada del código');
    assert.equal((await server.get('/api/certificados/verificar/' + CODE, '9.9.9.9, 8.8.8.8, ' + A)).status, 429, 'los valores inventados a la izquierda no cambian la IP');
    assert.equal((await server.get('/api/certificados/verificar/' + CODE, B)).status, 404, 'otro visitante no hereda el bloqueo');
  } finally { await server.close(); }
}));
