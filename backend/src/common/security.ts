import { isIP } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { corsOrigins } from '../deployment.config';

// Seguridad HTTP del backend: cabeceras (Helmet), CORS y acceso a Swagger. La usan main.ts y las pruebas,
// de modo que lo que se prueba es exactamente lo que se despliega.

type Env = Record<string, unknown>;
export type SwaggerMode = 'disabled' | 'open' | 'protected';
export type DocsAuthenticator = (email: string, password: string) => Promise<boolean>;

// Misma convención que deployment.config.ts: "alojado" = NODE_ENV=production o Vercel.
export const isHosted = (env: Env) => env.VERCEL === '1' || env.NODE_ENV === 'production';

// Swagger: en desarrollo está activo salvo SWAGGER_ENABLED=false, y solo para clientes locales (ver isLocalRequest). En producción está apagado salvo SWAGGER_ENABLED=true,
// y entonces nunca es público: exige HTTPS y una cuenta de administrador activa (ver docsAccess).
export function swaggerMode(env: Env): SwaggerMode {
  const flag = env.SWAGGER_ENABLED === undefined ? '' : String(env.SWAGGER_ENABLED).trim().toLowerCase();
  if (flag && !['true', 'false'].includes(flag)) throw new Error('SWAGGER_ENABLED debe ser true o false.');
  if (!isHosted(env)) return flag === 'false' ? 'disabled' : 'open';
  return flag === 'true' ? 'protected' : 'disabled';
}

// ---------- Swagger abierto (desarrollo): solo para la propia máquina o la red local ----------
// NODE_ENV por sí solo no basta: un servidor público arrancado sin NODE_ENV=production quedaría con Swagger abierto.
// Por eso, en modo "open" la documentación solo se sirve si la conexión directa viene de loopback o de una red privada
// y no pasó por un proxy o túnel (ngrok, Caddy, Railway...) que declare un cliente público.
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  let ip = address.trim().toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(ip) === 6) return ip === '::1' || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
  return false;
}

export function isLocalRequest(req: Pick<Request, 'socket' | 'headers'>): boolean {
  if (!isPrivateAddress(req.socket?.remoteAddress)) return false;
  const header = (name: string) => [req.headers[name]].flat().filter(Boolean).join(',');
  const claimed = [
    ...header('x-forwarded-for').split(','), ...header('x-real-ip').split(','), ...header('cf-connecting-ip').split(','), ...header('true-client-ip').split(','),
    ...[...header('forwarded').matchAll(/for=("?)([^;,"]+)\1/gi)].map(match => match[2]),
  ].map(value => value.trim().replace(/^\[|\](:\d+)?$/g, '').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1')).filter(Boolean);
  return claimed.every(isPrivateAddress); // sin cabeceras de proxy = conexión directa
}

const notFound = (req: Request, res: Response) => res.status(404).json({ message: 'Cannot ' + req.method + ' ' + req.originalUrl, error: 'Not Found', statusCode: 404 });

// Interfaz, documento OpenAPI (JSON y YAML) y archivos de la interfaz. Se decodifica la ruta para que variantes
// codificadas no eludan la comprobación.
const DOCS_PATH = /^\/api\/docs(?:-json|-yaml)?(?:\/|$)/i;
const isDocsPath = (req: Request) => {
  let path = req.path;
  try { path = decodeURIComponent(path); } catch { return true; }
  return DOCS_PATH.test(path);
};

const isUploadsPath = (req: Request) => /^\/api\/uploads\//i.test(req.path);

const apiCsp = { 'default-src': ["'none'"], 'base-uri': ["'none'"], 'form-action': ["'none'"], 'frame-ancestors': ["'none'"] };
// Imágenes públicas abiertas directamente: el visor del navegador aplica estilos en línea; nada más.
const uploadsCsp = { ...apiCsp, 'style-src': ["'unsafe-inline'"] };
// Swagger UI necesita sus propios scripts/estilos del mismo origen, estilos en línea y la imagen del favicon; nada de terceros.
const docsCsp = {
  'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'],
  'font-src': ["'self'", 'data:'], 'connect-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"],
};

// Cabeceras de seguridad. HSTS solo en producción y solo en respuestas que llegaron por HTTPS: así el acceso local por
// HTTP (localhost, LAN, Docker) no se rompe y el proxy no recibe un HSTS contradictorio.
export function securityHeaders(env: Env): RequestHandler[] {
  const base = helmet({
    contentSecurityPolicy: false, hsts: false,
    crossOriginResourcePolicy: { policy: 'same-origin' }, referrerPolicy: { policy: 'no-referrer' }, frameguard: { action: 'deny' },
  });
  const api = helmet.contentSecurityPolicy({ useDefaults: false, directives: apiCsp });
  const docs = helmet.contentSecurityPolicy({ useDefaults: false, directives: docsCsp });
  const images = helmet.contentSecurityPolicy({ useDefaults: false, directives: uploadsCsp });
  const hsts = helmet.hsts({ maxAge: 15552000, includeSubDomains: false, preload: false });
  const hosted = isHosted(env);
  const csp: RequestHandler = (req, res, next) => (isDocsPath(req) ? docs : isUploadsPath(req) ? images : api)(req, res, next);
  const transport: RequestHandler = (req, res, next) => (hosted && req.secure ? hsts(req, res, next) : next());
  // Las imágenes públicas las incrusta el frontend desde otro origen (p. ej. Vercel + API aparte): solo ellas relajan CORP.
  const uploads: RequestHandler = (req, res, next) => { if (isUploadsPath(req)) res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next(); };
  return [base, csp, transport, uploads];
}

export function configureCors(app: NestExpressApplication, env: Env) {
  app.enableCors({
    origin: corsOrigins(env), // lista exacta, nunca '*'
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'], // Idempotency-Key: creación de cotizaciones (sin él, el preflight entre orígenes la rechazaría)
  });
}

// Cabeceras, CORS y orden de middlewares: va antes de cualquier ruta.
export function configureHttpSecurity(app: NestExpressApplication, env: Env) {
  for (const middleware of securityHeaders(env)) app.use(middleware);
  configureCors(app, env);
}

// ---------- Acceso a Swagger en producción ----------
const FAILURE_LIMIT = 5, FAILURE_WINDOW_MS = 60_000;
const DUMMY_HASH = bcrypt.hashSync('no-es-una-cuenta', 10);

// Valida con una cuenta de administrador activa; el tiempo es parecido exista o no la cuenta.
export function adminDocsAuthenticator(prisma: { adminUser: { findFirst: (args: any) => Promise<any> } }): DocsAuthenticator {
  return async (email, password) => {
    const user = await prisma.adminUser.findFirst({ where: { email: email.toLowerCase().trim() } });
    const matches = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    return Boolean(user) && user.activo !== false && matches;
  };
}

// HTTP Basic con credenciales de un administrador, nunca en la URL. Solo por HTTPS. Limita los fallos por IP.
export function docsAccess(authenticate: DocsAuthenticator, options: { requireHttps: boolean; now?: () => number }): RequestHandler {
  const failures = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;
  const deny = (res: Response, status: number, mensaje: string, challenge = false) => {
    res.setHeader('Cache-Control', 'no-store');
    if (challenge) res.setHeader('WWW-Authenticate', 'Basic realm="Horus API docs", charset="UTF-8"');
    res.status(status).json({ ok: false, mensaje });
  };
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!isDocsPath(req)) return next();
    res.setHeader('Cache-Control', 'no-store');
    if (options.requireHttps && !req.secure) return deny(res, 403, 'La documentación solo se sirve por HTTPS.');
    const key = req.ip || 'unknown', time = now();
    for (const [ip, entry] of failures) if (entry.resetAt <= time) failures.delete(ip);
    const entry = failures.get(key);
    if (entry && entry.count >= FAILURE_LIMIT) { res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - time) / 1000))); return deny(res, 429, 'Demasiados intentos. Espera un minuto.'); }
    const header = req.headers.authorization || '';
    const match = /^Basic ([A-Za-z0-9+/=]{1,1024})$/.exec(header);
    let granted = false;
    if (match) {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8'), separator = decoded.indexOf(':');
      const email = separator > 0 ? decoded.slice(0, separator) : '', password = separator > 0 ? decoded.slice(separator + 1) : '';
      if (email && password && email.length <= 254 && Buffer.byteLength(password, 'utf8') <= 72) {
        try { granted = await authenticate(email, password); } catch { granted = false; }
      }
    }
    if (granted) { failures.delete(key); return next(); }
    if (match) failures.set(key, { count: (entry?.count ?? 0) + 1, resetAt: entry && entry.resetAt > time ? entry.resetAt : time + FAILURE_WINDOW_MS });
    return deny(res, 401, 'Se requiere una cuenta de administrador para ver la documentación.', true);
  };
}

// Registra Swagger según el modo. En 'disabled' no se crea ninguna ruta: /api/docs, -json y -yaml responden 404.
export function setupSwagger(app: NestExpressApplication, env: Env, authenticate: DocsAuthenticator): SwaggerMode {
  const mode = swaggerMode(env);
  if (mode === 'disabled') return mode;
  // El control de acceso se registra antes que las rutas de Swagger.
  if (mode === 'protected') app.use(docsAccess(authenticate, { requireHttps: true }));
  else app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isDocsPath(req)) return next();
    if (!isLocalRequest(req)) return notFound(req, res); // para el exterior, la documentación no existe
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const config = new DocumentBuilder()
    .setTitle('Horus Group API')
    .setDescription('API REST oficial para Horus Group SRL (Web Pública y Panel Administrativo)')
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'Authorization',
      description: 'Ingrese su token JWT (sin el prefijo Bearer)', in: 'header',
    }, 'bearer')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  return mode;
}
