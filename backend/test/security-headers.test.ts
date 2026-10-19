import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import * as bcrypt from 'bcryptjs';
import { Controller, Get, Header, Module, StreamableFile } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from '../src/admin/auth/auth.controller';
import { AuthService } from '../src/admin/auth/auth.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service';
import { HealthController } from '../src/health.controller';
import { validateDeployment } from '../src/deployment.config';
import { createValidationPipe } from '../src/common/validation';
import { adminDocsAuthenticator, configureHttpSecurity, isLocalRequest, isPrivateAddress, setupSwagger, swaggerMode } from '../src/common/security';

// Aplicación mínima con la MISMA configuración de seguridad que main.ts (configureHttpSecurity + setupSwagger).
// Sin MySQL, sin cuentas reales y sin correo.
const secret = 'isolated-security-headers-secret-32-characters';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQxQAAAAASUVORK5CYII=', 'base64');

@Controller('uploads')
class UploadsStub { @Get(':file') @Header('Content-Type', 'image/png') @Header('X-Content-Type-Options', 'nosniff') read() { return new StreamableFile(PNG, { type: 'image/png' }); } }

const accounts = [
  { id: 1, email: 'admin@example.test', password: bcrypt.hashSync('Password-docs-123', 4), activo: true, session_version: 1, nombre: 'Admin' },
  { id: 2, email: 'inactivo@example.test', password: bcrypt.hashSync('Password-docs-456', 4), activo: false, session_version: 1, nombre: 'Off' },
];
const fakePrisma = { adminUser: {
  findFirst: async ({ where }: any) => accounts.find(account => account.email === where.email) ?? null,
  findUnique: async ({ where }: any) => accounts.find(account => account.id === where.id) ?? null,
} };

const prod = { NODE_ENV: 'production', CORS_ORIGINS: 'https://web.example.test,https://demo.ngrok-free.dev' };
const basic = (email: string, password: string) => 'Basic ' + Buffer.from(email + ':' + password).toString('base64');
const goodBasic = basic('admin@example.test', 'Password-docs-123');

async function boot(env: Record<string, unknown>, options: { trustProxy?: boolean } = {}) {
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [HealthController, AuthController, UploadsStub],
    providers: [JwtStrategy,
      { provide: ConfigService, useValue: { get: (key: string) => key === 'JWT_SECRET' ? secret : undefined } },
      { provide: PrismaService, useValue: fakePrisma },
      { provide: AuthService, useValue: { login: async () => ({ ok: true, token: 'issued-in-test' }), register: async () => ({ ok: true, user: { id: 9 } }) } },
    ],
  })
  class SecurityTestModule {}
  const app = await NestFactory.create<NestExpressApplication>(SecurityTestModule, { logger: false });
  if (options.trustProxy) app.set('trust proxy', true);
  app.setGlobalPrefix('api');
  configureHttpSecurity(app, env);
  app.useGlobalPipes(createValidationPipe());
  const mode = setupSwagger(app, env, adminDocsAuthenticator(fakePrisma));
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as any).port as number;
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; headers: Record<string, any>; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: init.method || 'GET', headers: init.headers }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); if (init.body) req.write(init.body); req.end();
  });
  return { app, mode, call, jwt: new JwtService({ secret, signOptions: { issuer: 'horus-api', audience: 'horus-panel' } }) };
}

const DOCS = ['/api/docs', '/api/docs/', '/api/docs-json', '/api/docs-yaml', '/api/docs/swagger-ui-bundle.js', '/api/docs/swagger-ui.css', '/api/docs/swagger-ui-init.js'];
const secure = { 'X-Forwarded-Proto': 'https' };
// Cada intento desde otra IP (el límite de fallos es por IP): permite probar muchas credenciales en una misma prueba.
let fakeIp = 0;
const fromNewIp = (headers: Record<string, string> = {}) => ({ ...secure, 'X-Forwarded-For': '198.51.100.' + (++fakeIp), ...headers });

test('Swagger mode: on in development, off in production unless explicitly enabled; invalid values are rejected', () => {
  assert.equal(swaggerMode({}), 'open');
  assert.equal(swaggerMode({ NODE_ENV: 'development' }), 'open');
  assert.equal(swaggerMode({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }), 'disabled');
  assert.equal(swaggerMode({ NODE_ENV: 'production' }), 'disabled');
  assert.equal(swaggerMode({ VERCEL: '1' }), 'disabled');
  assert.equal(swaggerMode({ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' }), 'disabled');
  assert.equal(swaggerMode({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }), 'protected');
  assert.equal(swaggerMode({ VERCEL: '1', SWAGGER_ENABLED: 'TRUE' }), 'protected', 'nunca "open" en producción');
  assert.throws(() => swaggerMode({ SWAGGER_ENABLED: 'maybe' }), /SWAGGER_ENABLED/);
  assert.throws(() => validateDeployment({ SWAGGER_ENABLED: '1' }), /SWAGGER_ENABLED/);
  assert.doesNotThrow(() => validateDeployment({ SWAGGER_ENABLED: 'false' }));
});

test('development: Swagger UI and the OpenAPI document are served, with Bearer JWT and a scoped CSP', async () => {
  const { app, call } = await boot({});
  try {
    for (const path of ['/api/docs', '/api/docs-json', '/api/docs-yaml', '/api/docs/swagger-ui-bundle.js']) assert.equal((await call(path)).status, 200, path);
    const ui = await call('/api/docs/');
    assert.match(ui.body, /swagger-ui/i);
    assert.match(String(ui.headers['content-security-policy']), /style-src 'self' 'unsafe-inline'/);
    assert.match(String(ui.headers['content-security-policy']), /script-src 'self'/);
    assert.doesNotMatch(String(ui.headers['content-security-policy']), /https?:\/\//, 'ningún tercero en la CSP de Swagger');
    assert.equal(ui.headers['cache-control'], 'no-store');
    const doc = JSON.parse((await call('/api/docs-json')).body);
    assert.equal(doc.components.securitySchemes.bearer.scheme, 'bearer');
    assert.equal(doc.components.securitySchemes.bearer.bearerFormat, 'JWT');
    assert.ok(doc.paths['/api/admin/me'], 'endpoints existentes documentados');
    assert.ok(!doc.paths['/api/health'], 'el healthcheck no se publica en la documentación');
    assert.deepEqual(doc.paths['/api/admin/me'].get.security, [{ bearer: [] }]);
  } finally { await app.close(); }
});

test('development with SWAGGER_ENABLED=false serves no documentation at all', async () => {
  const { app, call, mode } = await boot({ SWAGGER_ENABLED: 'false' });
  try {
    assert.equal(mode, 'disabled');
    for (const path of DOCS) assert.equal((await call(path)).status, 404, path);
  } finally { await app.close(); }
});

test('production: documentation is off by default and no OpenAPI document leaks, with or without credentials', async () => {
  const { app, call, mode } = await boot(prod, { trustProxy: true });
  try {
    assert.equal(mode, 'disabled');
    for (const path of [...DOCS, '/API/DOCS', '/api/Docs-Json', '/api/%64ocs', '/api/docs?x=1', '/api/docs-json?access_token=abc']) {
      for (const headers of [{}, { ...secure }, { ...secure, Authorization: goodBasic }]) {
        const result = await call(path, { headers });
        assert.equal(result.status, 404, path);
        assert.equal(JSON.parse(result.body).statusCode, 404, 'respuesta 404 genérica de Nest, sin contenido de documentación en ' + path);
        assert.ok(!result.body.includes('openapi'));
      }
    }
    assert.equal((await call('/api/health')).status, 200);
  } finally { await app.close(); }
});

test('production with SWAGGER_ENABLED=true: HTTPS plus an active administrator is required for the UI and the document', async () => {
  const { app, call, mode, jwt } = await boot({ ...prod, SWAGGER_ENABLED: 'true' }, { trustProxy: true });
  try {
    assert.equal(mode, 'protected');
    // Sin HTTPS no se sirve nada, ni siquiera con credenciales correctas (Basic viajaría en claro).
    for (const path of DOCS) assert.equal((await call(path, { headers: { Authorization: goodBasic } })).status, 403, 'HTTP: ' + path);
    // Sin credenciales o con credenciales no válidas.
    for (const path of ['/api/docs', '/api/docs-json', '/api/docs-yaml', '/api/docs/swagger-ui-bundle.js']) {
      const anonymous = await call(path, { headers: fromNewIp() });
      assert.equal(anonymous.status, 401, path);
      assert.match(String(anonymous.headers['www-authenticate']), /^Basic realm=/);
      assert.ok(!anonymous.body.includes('openapi'));
    }
    for (const authorization of [basic('admin@example.test', 'incorrecta-123'), basic('nadie@example.test', 'Password-docs-123'), basic('inactivo@example.test', 'Password-docs-456'), basic('admin@example.test', ''), 'Basic !!!', 'Bearer ' + jwt.sign({ id: 1 }), 'Basic ' + Buffer.from('sin-dos-puntos').toString('base64')]) {
      assert.equal((await call('/api/docs-json', { headers: fromNewIp({ Authorization: authorization }) })).status, 401, authorization.slice(0, 18));
    }
    // El acceso nunca se concede por la URL.
    for (const query of ['?token=' + jwt.sign({ id: 1 }), '?access_token=' + jwt.sign({ id: 1 }), '?user=admin@example.test&password=Password-docs-123']) {
      assert.equal((await call('/api/docs-json' + query, { headers: fromNewIp() })).status, 401);
    }
    // Una cuenta de administrador activa sí accede, a la interfaz, a sus archivos y al documento.
    const headers = fromNewIp({ Authorization: goodBasic });
    for (const path of ['/api/docs/', '/api/docs-json', '/api/docs-yaml', '/api/docs/swagger-ui-bundle.js']) {
      const ok = await call(path, { headers }); assert.equal(ok.status, 200, path); assert.equal(ok.headers['cache-control'], 'no-store');
    }
    assert.equal(JSON.parse((await call('/api/docs-json', { headers })).body).info.title, 'Horus Group API');
    // El resto de la API no se ve afectado por el control de acceso.
    assert.equal((await call('/api/health')).status, 200);
  } finally { await app.close(); }
});

test('production with Swagger enabled: repeated failures are throttled, even for the right password', async () => {
  const { app, call } = await boot({ ...prod, SWAGGER_ENABLED: 'true' }, { trustProxy: true });
  try {
    const wrong = { ...secure, Authorization: basic('admin@example.test', 'incorrecta-123') };
    for (let i = 0; i < 5; i++) assert.equal((await call('/api/docs-json', { headers: wrong })).status, 401);
    const blocked = await call('/api/docs-json', { headers: { ...secure, Authorization: goodBasic } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
  } finally { await app.close(); }
});

test('Helmet headers: strict CSP and framing protection for the API, HSTS only on HTTPS in production', async () => {
  const dev = await boot({}, { trustProxy: true });
  try {
    const response = await dev.call('/api/health', { headers: secure });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
    const h = response.headers;
    assert.equal(h['x-content-type-options'], 'nosniff');
    assert.equal(h['referrer-policy'], 'no-referrer');
    assert.equal(h['x-frame-options'], 'DENY');
    assert.equal(h['content-security-policy'], "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'");
    assert.equal(h['cross-origin-resource-policy'], 'same-origin');
    assert.equal(h['cross-origin-opener-policy'], 'same-origin');
    assert.equal(h['x-powered-by'], undefined);
    assert.equal(h['strict-transport-security'], undefined, 'sin HSTS fuera de producción, aunque llegue por HTTPS');
    assert.ok(!('upgrade-insecure-requests' in h) && !String(h['content-security-policy']).includes('upgrade-insecure-requests'), 'no se fuerza HTTPS en acceso local');
  } finally { await dev.app.close(); }
  const production = await boot(prod, { trustProxy: true });
  try {
    assert.equal((await production.call('/api/health')).headers['strict-transport-security'], undefined, 'sin HSTS por HTTP');
    const secured = await production.call('/api/health', { headers: secure });
    assert.equal(secured.headers['strict-transport-security'], 'max-age=15552000');
    assert.equal(secured.headers['x-content-type-options'], 'nosniff');
  } finally { await production.app.close(); }
});

test('uploads: public images stay embeddable from the frontend origin and keep a locked-down CSP', async () => {
  const { app, call } = await boot(prod);
  try {
    const image = await call('/api/uploads/imagen.png');
    assert.equal(image.status, 200);
    assert.equal(image.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.equal(image.headers['x-content-type-options'], 'nosniff');
    assert.match(String(image.headers['content-security-policy']), /default-src 'none'/);
    assert.match(String(image.headers['content-security-policy']), /style-src 'unsafe-inline'/, 'el visor de imágenes del navegador necesita estilos en línea');
    assert.deepEqual(image.body.length > 0, true);
    assert.equal((await call('/api/health')).headers['cross-origin-resource-policy'], 'same-origin', 'el resto de la API no se relaja');
  } finally { await app.close(); }
});

test('CORS: configured origins are allowed, others are rejected, wildcard is never used', async () => {
  const { app, call } = await boot(prod);
  try {
    for (const origin of ['https://web.example.test', 'https://demo.ngrok-free.dev']) {
      const allowed = await call('/api/health', { headers: { Origin: origin } });
      assert.equal(allowed.headers['access-control-allow-origin'], origin);
      assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
      assert.match(String(allowed.headers['vary']), /Origin/);
      const preflight = await call('/api/admin/me', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers['access-control-allow-origin'], origin);
      assert.match(String(preflight.headers['access-control-allow-headers']), /Authorization/i);
      assert.match(String(preflight.headers['access-control-allow-methods']), /PUT/);
    }
    for (const origin of ['https://evil.example', 'http://web.example.test', 'https://web.example.test.evil.example', 'https://sub.web.example.test', 'null']) {
      const denied = await call('/api/health', { headers: { Origin: origin } });
      assert.equal(denied.headers['access-control-allow-origin'], undefined, origin);
      const preflight = await call('/api/admin/me', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } });
      assert.equal(preflight.headers['access-control-allow-origin'], undefined, origin);
    }
    for (const result of [await call('/api/health', { headers: { Origin: 'https://evil.example' } }), await call('/api/health')]) assert.notEqual(result.headers['access-control-allow-origin'], '*');
  } finally { await app.close(); }
  const dev = await boot({});
  try {
    assert.equal((await dev.call('/api/health', { headers: { Origin: 'http://localhost:5173' } })).headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal((await dev.call('/api/health', { headers: { Origin: 'http://localhost:5999' } })).headers['access-control-allow-origin'], undefined);
    assert.equal((await dev.call('/api/health', { headers: { Origin: 'https://demo.ngrok-free.dev' } })).headers['access-control-allow-origin'], undefined, 'ngrok solo si se autoriza en CORS_ORIGINS');
  } finally { await dev.app.close(); }
});

test('login, JWT and the protected administrator registration keep working behind the new headers and CORS', async () => {
  const { app, call, jwt } = await boot(prod);
  try {
    const origin = { Origin: 'https://web.example.test', 'Content-Type': 'application/json' };
    const login = await call('/api/admin/login', { method: 'POST', headers: origin, body: JSON.stringify({ email: 'admin@example.test', password: 'Password-docs-123' }) });
    assert.equal(login.status, 200);
    assert.equal(login.headers['access-control-allow-origin'], 'https://web.example.test');
    assert.equal(login.headers['x-content-type-options'], 'nosniff');
    assert.equal(JSON.parse(login.body).token, 'issued-in-test');
    const token = jwt.sign({ id: 1, version: 1 });
    assert.equal((await call('/api/admin/me', { headers: { Origin: origin.Origin, Authorization: 'Bearer ' + token } })).status, 200);
    assert.equal((await call('/api/admin/me', { headers: { Origin: origin.Origin } })).status, 401);
    const body = JSON.stringify({ nombre: 'Nueva Persona', email: 'nueva@example.test', password: 'Password-nueva-123' });
    assert.equal((await call('/api/admin/register', { method: 'POST', headers: origin, body })).status, 401, 'el registro sigue cerrado sin sesión');
    assert.equal((await call('/api/admin/register', { method: 'POST', headers: { ...origin, Authorization: 'Bearer ' + token }, body })).status, 201);
  } finally { await app.close(); }
});

test('local addresses: loopback, private networks and link-local are local; public, unknown and malformed are not', () => {
  for (const address of ['127.0.0.1', '127.8.8.8', '::1', '::ffff:127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.20', '169.254.1.1', '::ffff:192.168.0.9', 'fd12:3456::1', 'fc00::1', 'fe80::1']) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', '203.0.113.9', '2001:db8::1', '::ffff:8.8.8.8', 'unknown', '_hidden', '', undefined, '999.1.1.1', 'localhost']) assert.equal(isPrivateAddress(address as any), false, String(address));
  const local = (remoteAddress: string, headers: Record<string, any> = {}) => isLocalRequest({ socket: { remoteAddress }, headers } as any);
  assert.equal(local('127.0.0.1'), true);
  assert.equal(local('192.168.1.50'), true, 'otro equipo de la LAN');
  assert.equal(local('203.0.113.9'), false, 'conexión directa desde una IP pública');
  assert.equal(local('127.0.0.1', { 'x-forwarded-for': '198.51.100.7' }), false, 'túnel o proxy local que reenvía a un cliente público');
  assert.equal(local('127.0.0.1', { 'x-forwarded-for': '192.168.1.8, 10.0.0.2' }), true, 'proxy local con clientes de la LAN');
  assert.equal(local('127.0.0.1', { 'x-forwarded-for': '192.168.1.8, 198.51.100.7' }), false, 'cualquier salto público lo descarta');
  assert.equal(local('127.0.0.1', { 'x-real-ip': '8.8.8.8' }), false);
  assert.equal(local('127.0.0.1', { 'cf-connecting-ip': '8.8.8.8' }), false);
  assert.equal(local('127.0.0.1', { forwarded: 'for=203.0.113.9;proto=https' }), false);
  assert.equal(local('127.0.0.1', { forwarded: 'for="[2001:db8::1]:4711"' }), false);
  assert.equal(local('127.0.0.1', { forwarded: 'for=192.168.1.8;proto=http' }), true);
  assert.equal(local('127.0.0.1', { 'x-forwarded-for': 'unknown' }), false, 'un cliente que no se puede identificar no es local');
  assert.equal(local('127.0.0.1', { 'x-forwarded-for': '[::1]:5555' }), true);
});

test('development Swagger is not exposed to the outside even if NODE_ENV was forgotten on a public server', async () => {
  const { app, call } = await boot({});
  try {
    const docs = ['/api/docs', '/api/docs/', '/api/docs-json', '/api/docs-yaml', '/api/docs/swagger-ui-bundle.js'];
    for (const path of docs) assert.equal((await call(path)).status, 200, 'local: ' + path);
    // Detrás de Caddy, Railway, ngrok... el proxy declara el cliente real: la documentación no existe para él.
    for (const headers of [{ 'X-Forwarded-For': '203.0.113.9' }, { 'X-Real-IP': '8.8.8.8' }, { Forwarded: 'for=203.0.113.9;proto=https' }, { 'X-Forwarded-For': '192.168.1.5, 203.0.113.9' }, { 'X-Forwarded-For': 'unknown' }]) {
      for (const path of docs) {
        const result = await call(path, { headers });
        assert.equal(result.status, 404, path + ' ' + JSON.stringify(headers));
        assert.equal(JSON.parse(result.body).statusCode, 404);
        assert.ok(!result.body.includes('openapi'));
      }
      assert.equal((await call('/api/health', { headers })).status, 200, 'el resto de la API no cambia');
    }
    // Proxy local con clientes de la propia red local: sigue funcionando para desarrollo.
    assert.equal((await call('/api/docs-json', { headers: { 'X-Forwarded-For': '192.168.1.5' } })).status, 200);
  } finally { await app.close(); }
});
