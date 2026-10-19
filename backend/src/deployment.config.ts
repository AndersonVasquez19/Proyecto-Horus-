import { rsaPublicKey } from './database/connection-security';
import { trustedProxies } from './common/trusted-proxies';

export function corsOrigins(env: Record<string, unknown>): string[] {
  const hosted = env.VERCEL === '1' || env.NODE_ENV === 'production';
  const raw = String(env.CORS_ORIGINS || (hosted ? '' : 'http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173'));
  const origins = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (hosted && !origins.length) throw new Error('Configura CORS_ORIGINS con los orígenes HTTPS del frontend.');
  return origins.map(origin => {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS contiene un origen inválido.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin ||
        url.username || url.password || (hosted && url.protocol !== 'https:')) {
      throw new Error('CORS_ORIGINS debe contener orígenes exactos, sin rutas ni barra final.');
    }
    return origin;
  });
}

export function validateDeployment(env: Record<string, unknown>) {
  const hosted = env.VERCEL === '1' || env.NODE_ENV === 'production';
  corsOrigins(env);
  rsaPublicKey(env.DB_RSA_PUBLIC_KEY);
  trustedProxies(env.TRUSTED_PROXY_CIDRS);
  for (const key of ['PORT', 'DB_PORT']) {
    if (env[key] !== undefined && (!/^\d+$/.test(String(env[key])) || Number(env[key]) < 1 || Number(env[key]) > 65535)) {
      throw new Error(key + ' debe ser un puerto entre 1 y 65535.');
    }
  }
  for (const key of ['DB_SSL', 'DB_SYNC', 'SWAGGER_ENABLED']) {
    if (env[key] !== undefined && !['true', 'false'].includes(String(env[key]))) throw new Error(key + ' debe ser true o false.');
  }
  if (env.MAIL_PROVIDER !== undefined && !['resend', 'gmail'].includes(String(env.MAIL_PROVIDER).trim().toLowerCase())) {
    throw new Error('MAIL_PROVIDER debe ser resend o gmail.');
  }
  if (env.JWT_SECRET !== undefined && (typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
  }
  if (hosted) {
    for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS', 'JWT_SECRET']) {
      if (typeof env[key] !== 'string' || !String(env[key]).trim()) throw new Error('Falta configurar ' + key + ' en producción.');
    }
    if (String(env.JWT_SECRET).length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
    if (['localhost', '127.0.0.1', '::1'].includes(String(env.DB_HOST).toLowerCase())) {
      throw new Error('DB_HOST debe ser un servidor MySQL accesible desde el backend, no localhost.');
    }
    if (env.DB_SYNC === 'true') throw new Error('DB_SYNC debe estar desactivado en producción.');
  }
  return env;
}
