// H-BACK-01, E3.6: arranque de PRUEBA del NestJS compilado (backend/dist) con el AppModule REAL, que desde E3.6 registra él mismo
// PublicRateLimitGuard → AccessGuard como guards globales. Solo lo lanza test/access-guard-http.integration.cjs como proceso hijo (canal IPC).
// No está en src/, no se compila a dist/ ni se despliega, y no lee ninguna variable que active o desactive la guard.
//
// Este módulo NO registra guards ni proveedores propios (ni APP_GUARD, ni AccessGuard, ni sus dependencias): toda la autorización
// procede de AppModule. Solo añade un controlador de sondeo de prueba (sin clasificar y mal declarado) para comprobar la denegación
// por defecto con la guard global real, que también se aplica a él.
// El resto replica dist/main.js (prefijo api, proxy de confianza, cabeceras/CORS, ValidationPipe), salvo Swagger y que escucha solo en 127.0.0.1.
//
// Ciclo de vida: el proceso no sobrevive a la prueba que lo lanzó. Si se pierde el canal IPC (la prueba termina, falla o la matan),
// deja de aceptar conexiones, cierra la aplicación (Prisma incluido) y sale con 0; si ocurre durante el arranque, sale con 3 sin
// esperar. Si el cierre no termina en 10 s, sale con 4. SIGINT/SIGTERM los atiende enableShutdownHooks (como main.ts). Este proceso
// solo se termina a sí mismo: la terminación forzada (taskkill /T o SIGKILL del PID propio) queda como último recurso de la prueba.
'use strict';
const { join } = require('node:path');

if (typeof process.send !== 'function' || process.env.HORUS_ACCESS_GUARD_FIXTURE !== 'e36') {
  console.error('Arranque exclusivo de la prueba E3.6 (requiere el canal IPC de la prueba).');
  process.exit(2);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST ?? '')) {
  console.error('Arranque de prueba: DB_HOST debe ser de bucle local.');
  process.exit(2);
}

let app = null, closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  if (!app) process.exit(3);
  setTimeout(() => process.exit(4), 10_000).unref();
  const server = app.getHttpServer();
  server.close();
  server.closeAllConnections();
  app.close().then(() => process.exit(0), () => process.exit(1));
}
process.on('disconnect', shutdown);

require('reflect-metadata');
const dist = join(__dirname, '..', '..', 'dist');
const { Controller, Get, Module, SetMetadata } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(join(dist, 'app.module.js'));
const { JwtAuthGuard } = require(join(dist, 'common/guards/jwt-auth.guard.js'));
const { JwtStrategy } = require(join(dist, 'admin/auth/jwt.strategy.js'));
const { PublicRateLimitGuard } = require(join(dist, 'common/public-rate-limit.guard.js'));
const { AccessGuard, AccountAccessService } = require(join(dist, 'permissions/access.guard.js'));
const { ACCESS_METADATA } = require(join(dist, 'permissions/access.decorators.js'));
const { trustedProxies } = require(join(dist, 'common/trusted-proxies.js'));
const { configureHttpSecurity } = require(join(dist, 'common/security.js'));
const { createValidationPipe } = require(join(dist, 'common/validation.js'));

// Sondeo de denegación por defecto: una ruta sin decorador de acceso y otra con un permiso inexistente.
class ProbeController {
  sinClasificar() { return { ok: true, alcanzada: 'sin-clasificar' }; }
  malDeclarada() { return { ok: true, alcanzada: 'mal-declarada' }; }
}
const decorateMethod = (name, decorators) => Object.defineProperty(ProbeController.prototype, name,
  Reflect.decorate(decorators, ProbeController.prototype, name, Object.getOwnPropertyDescriptor(ProbeController.prototype, name)));
decorateMethod('sinClasificar', [Get()]);
decorateMethod('malDeclarada', [Get('mal-declarada'), SetMetadata(ACCESS_METADATA, { kind: 'permiso', permission: 'cuentas:todo' })]);
Reflect.decorate([Controller('admin/e36-sondeo')], ProbeController);

class AccessGuardTestModule {}
Reflect.decorate([Module({
  imports: [AppModule],
  controllers: [ProbeController],
})], AccessGuardTestModule);

async function bootstrap() {
  const created = await NestFactory.create(AccessGuardTestModule, { logger: ['error', 'warn'] });
  created.set('trust proxy', trustedProxies(process.env.TRUSTED_PROXY_CIDRS));
  created.enableShutdownHooks();
  created.setGlobalPrefix('api');
  configureHttpSecurity(created, process.env);
  created.useGlobalPipes(createValidationPipe());
  await created.listen(Number(process.env.PORT), '127.0.0.1');
  if (closing || !process.connected) process.exit(3);
  app = created;

  // Evidencia del ensamblado: guards globales en el orden en que Nest los ejecuta, resolución de dependencias y rutas Express registradas.
  const config = app.config; // ApplicationConfig (privado en TypeScript; lectura solo de prueba)
  const globalGuards = (config?.getGlobalGuards?.() ?? []).map(guard => guard?.constructor?.name ?? '?');
  const resolved = {
    JwtAuthGuard: app.get(JwtAuthGuard, { strict: false }) instanceof JwtAuthGuard,
    AccountAccessService: app.get(AccountAccessService, { strict: false }) instanceof AccountAccessService,
    JwtStrategy: app.get(JwtStrategy, { strict: false }) instanceof JwtStrategy,
    PublicRateLimitGuard: globalGuards.includes(PublicRateLimitGuard.name),
    AccessGuard: globalGuards.includes(AccessGuard.name),
  };
  // Qué módulo declara cada APP_GUARD (Nest los guarda con un token «APP_GUARD (UUID: …)» en el módulo que los registra).
  const guardProviders = [];
  for (const moduleRef of app.container.getModules().values()) {
    for (const [token, wrapper] of moduleRef.providers) {
      if (typeof token === 'string' && token.startsWith('APP_GUARD')) guardProviders.push({ module: moduleRef.metatype?.name ?? '?', guard: wrapper.metatype?.name ?? '?' });
    }
  }
  const routes = app.getHttpAdapter().getInstance()._router.stack
    .filter(layer => layer.route)
    .flatMap(layer => Object.keys(layer.route.methods).map(method => ({ method: method.toUpperCase(), path: layer.route.path })));
  process.send({ ready: true, port: app.getHttpServer().address().port, globalGuards, guardProviders, resolved, routes });
}

bootstrap().catch(error => {
  console.error('Fallo del ensamblado de prueba: ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
