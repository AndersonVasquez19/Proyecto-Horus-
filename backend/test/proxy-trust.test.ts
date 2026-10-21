import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { Controller, Get, Module, Post, Req } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import { PublicRateLimitGuard } from '../src/common/public-rate-limit.guard';
import { proxyTrustWarning, trustedProxies } from '../src/common/trusted-proxies';
import { PrismaService } from '../src/database/prisma.service';
import { memoryBuckets } from './fixtures/rate-limit-memory';

// Dos visitantes simulados detrás de un proxy, con el MISMO guard de frecuencia y la MISMA lectura de IP (trust proxy) que main.ts.
// Aislado: sin MySQL (contadores en memoria), sin Caddy ni Railway y sin red externa. El "proxy" es el propio cliente de pruebas,
// que se conecta desde 127.0.0.1 y envía X-Forwarded-For como lo haría Caddy. Esto NO valida la cadena real Railway -> Caddy -> NestJS.

// Memoria que imita lo mínimo de rate_limit_buckets que usa el guard (test/fixtures/rate-limit-memory.ts).
const fakePrisma = () => memoryBuckets().prisma;

@Controller()
class Probe {
  @Post('contacto') send(@Req() request: Request) { return { ok: true, ip: request.ip }; }
  @Get('ip') ip(@Req() request: Request) { return { ip: request.ip }; }
}

async function start(trustedValue: string | undefined) {
  @Module({ controllers: [Probe], providers: [{ provide: APP_GUARD, useClass: PublicRateLimitGuard }, { provide: PrismaService, useValue: fakePrisma() }] })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  app.set('trust proxy', trustedProxies(trustedValue)); // igual que main.ts
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  const call = (method: 'GET' | 'POST', path: string, forwardedFor?: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { 'content-length': 0, ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}) } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end();
  });
  return { call, close: () => app.close() };
}

// El guard cuenta por minuto natural: se fija el reloj para que una prueba no cruce el cambio de minuto y reinicie los contadores.
async function withFixedClock<T>(work: () => Promise<T>): Promise<T> {
  const real = Date.now;
  const fixed = Math.floor(real() / 60_000) * 60_000 + 30_000;
  Date.now = () => fixed;
  try { return await work(); } finally { Date.now = real; }
}

const A = '203.0.113.7', B = '198.51.100.9';

test('con el proxy confiable, dos visitantes tienen límites independientes y una misma IP comparte el suyo', () => withFixedClock(async () => {
  const server = await start('127.0.0.1/32');
  try {
    assert.equal((await server.call('GET', '/api/ip', A)).body.ip, A);
    assert.equal((await server.call('GET', '/api/ip', B)).body.ip, B);
    for (let i = 0; i < 5; i++) assert.equal((await server.call('POST', '/api/contacto', A)).status, 201, 'el visitante A usa su cuota (' + (i + 1) + '/5)');
    assert.equal((await server.call('POST', '/api/contacto', A)).status, 429, 'el visitante A supera su cuota');
    assert.equal((await server.call('POST', '/api/contacto', B)).status, 201, 'el visitante B no hereda el límite de A');
    assert.equal((await server.call('POST', '/api/contacto', A)).status, 429, 'A sigue limitado');
  } finally { await server.close(); }
}));

test('con el proxy confiable, una cabecera X-Forwarded-For falsificada por el cliente no evita el límite', () => withFixedClock(async () => {
  const server = await start('127.0.0.1/32');
  try {
    // Un proxy honesto añade la IP real a la derecha; los valores de la izquierda los inventó el cliente.
    assert.equal((await server.call('GET', '/api/ip', '1.2.3.4, 5.6.7.8, ' + A)).body.ip, A);
    for (let i = 0; i < 5; i++) assert.equal((await server.call('POST', '/api/contacto', 'falso-' + i + '.example, 10.9.8.' + i + ', ' + A)).status, 201);
    assert.equal((await server.call('POST', '/api/contacto', '9.9.9.9, ' + A)).status, 429);
    assert.equal((await server.call('POST', '/api/contacto', B)).status, 201);
  } finally { await server.close(); }
}));

test('si la conexión no viene de un proxy confiable, X-Forwarded-For se ignora por completo', () => withFixedClock(async () => {
  const server = await start('10.0.0.0/8'); // el cliente de pruebas llega desde 127.0.0.1, que no está en la lista
  try {
    assert.equal((await server.call('GET', '/api/ip', A)).body.ip, '127.0.0.1');
    for (let i = 0; i < 5; i++) assert.equal((await server.call('POST', '/api/contacto', '203.0.113.' + (10 + i))).status, 201);
    assert.equal((await server.call('POST', '/api/contacto', '203.0.113.99')).status, 429, 'rotar IPs falsas no evita el límite');
  } finally { await server.close(); }
}));

test('sin TRUSTED_PROXY_CIDRS todos los visitantes comparten la IP del proxy y, por tanto, el límite (comportamiento seguro pero compartido)', () => withFixedClock(async () => {
  const server = await start(undefined);
  try {
    assert.equal((await server.call('GET', '/api/ip', A)).body.ip, '127.0.0.1');
    assert.equal((await server.call('GET', '/api/ip', B)).body.ip, '127.0.0.1');
    for (let i = 0; i < 5; i++) assert.equal((await server.call('POST', '/api/contacto', A)).status, 201);
    assert.equal((await server.call('POST', '/api/contacto', B)).status, 429, 'B queda limitado por el consumo de A: lo que avisa el arranque');
  } finally { await server.close(); }
}));

test('aviso de arranque: solo en despliegues alojados sin proxies de confianza', () => {
  assert.match(proxyTrustWarning({ NODE_ENV: 'production' }) ?? '', /TRUSTED_PROXY_CIDRS/);
  assert.match(proxyTrustWarning({ NODE_ENV: 'production', TRUSTED_PROXY_CIDRS: '' }) ?? '', /límite de frecuencia/);
  assert.match(proxyTrustWarning({ VERCEL: '1' }) ?? '', /TRUSTED_PROXY_CIDRS/);
  assert.equal(proxyTrustWarning({ NODE_ENV: 'production', TRUSTED_PROXY_CIDRS: '10.0.0.0/8' }), null);
  assert.equal(proxyTrustWarning({ NODE_ENV: 'production', TRUSTED_PROXY_CIDRS: '10.0.0.5, fd00::/8' }), null);
  assert.equal(proxyTrustWarning({}), null, 'desarrollo local sin NODE_ENV: sin aviso');
  assert.equal(proxyTrustWarning({ NODE_ENV: 'development' }), null);
  assert.equal(proxyTrustWarning({ NODE_ENV: 'test', TRUSTED_PROXY_CIDRS: '' }), null);
  assert.throws(() => proxyTrustWarning({ NODE_ENV: 'production', TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }), /TRUSTED_PROXY_CIDRS/, 'un valor inválido sigue rechazándose');
});

test('el aviso no incluye valores de configuración ni secretos, y no nombra rangos de ninguna plataforma', () => {
  const secret = 'valor-secreto-que-no-debe-aparecer';
  const message = proxyTrustWarning({ NODE_ENV: 'production', JWT_SECRET: secret, DB_PASS: secret, TRUSTED_PROXY_CIDRS: '' }) ?? '';
  assert.ok(message.length > 0);
  assert.ok(!message.includes(secret));
  assert.ok(!/\d+\.\d+\.\d+\.\d+|\/\d+|fd[0-9a-f]{2}:/i.test(message), 'no propone IPs ni CIDRs concretos');
});

test('main.ts emite el aviso al arrancar sin bloquearlo', () => {
  const source = readFileSync(join(__dirname, '../src/main.ts'), 'utf8');
  assert.match(source, /proxyTrustWarning\(process\.env\)/);
  assert.match(source, /logger\.warn\(proxyWarning\)/);
  assert.ok(!/throw\b[^;]*proxyWarning/.test(source));
});
