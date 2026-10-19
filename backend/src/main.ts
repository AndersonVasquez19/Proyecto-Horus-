import { createValidationPipe } from './common/validation';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { proxyTrustWarning, trustedProxies } from './common/trusted-proxies';
import { adminDocsAuthenticator, configureHttpSecurity, setupSwagger } from './common/security';
import { PrismaService } from './database/prisma.service';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', trustedProxies(process.env.TRUSTED_PROXY_CIDRS));
  const proxyWarning = proxyTrustWarning(process.env);
  if (proxyWarning) logger.warn(proxyWarning);
  app.enableShutdownHooks();

  // Prefijo global /api para mantener compatibilidad total con el frontend
  app.setGlobalPrefix('api');

  // Cabeceras de seguridad (Helmet) y CORS con lista exacta de orígenes; antes de cualquier ruta.
  configureHttpSecurity(app, process.env);

  // Validación y transformación automática de DTOs con class-validator
  app.useGlobalPipes(createValidationPipe());

  // Swagger: activo en desarrollo; apagado en producción salvo SWAGGER_ENABLED=true, y entonces exige HTTPS y un administrador.
  const swagger = setupSwagger(app, process.env, adminDocsAuthenticator(app.get(PrismaService)));

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  logger.log(`🚀 Servidor NestJS corriendo en: http://localhost:${port}/api`);
  if (swagger === 'open') logger.log(`📚 Documentación Swagger interactiva en: http://localhost:${port}/api/docs`);
  else if (swagger === 'protected') logger.log('📚 Swagger habilitado: requiere HTTPS y una cuenta de administrador.');
}

bootstrap();
