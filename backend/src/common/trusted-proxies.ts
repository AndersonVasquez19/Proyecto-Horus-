import { isIP } from 'node:net';

// Sin confianza por defecto. Un salto solo es seguro si no existe acceso directo a NestJS.
export function trustedProxies(value: unknown, hops?: unknown): string[] | false | 1 {
  if (hops !== undefined) {
    if (hops !== '1') throw new Error('TRUSTED_PROXY_HOPS solo admite el valor 1.');
    if (trustedProxies(value) !== false) throw new Error('TRUSTED_PROXY_HOPS y TRUSTED_PROXY_CIDRS son mutuamente excluyentes.');
    return 1;
  }
  if (value === undefined || value === '') return false;
  if (typeof value !== 'string') throw new Error('TRUSTED_PROXY_CIDRS debe contener IPs o CIDRs explícitos.');
  const addresses = value.split(/[\s,]+/).filter(Boolean);
  if (!addresses.length) return false;
  for (const address of addresses) {
    const [ip, prefix, extra] = address.split('/');
    const version = isIP(ip);
    if (!version || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error('TRUSTED_PROXY_CIDRS debe contener IPs o CIDRs explícitos, sin comodines ni /0.');
    }
  }
  return addresses;
}

// Aviso (no error) para un despliegue alojado sin proxies de confianza: tras Caddy/la plataforma, Express vería la dirección del proxy como IP de
// todos los visitantes y el límite de frecuencia se compartiría entre ellos. No bloquea el arranque (hay despliegues directos legítimos) ni incluye
// valores de configuración. No presupone rangos de ninguna plataforma: quien despliega debe confirmarlos con su proveedor.
export function proxyTrustWarning(env: Record<string, unknown>): string | null {
  const hosted = env.VERCEL === '1' || env.NODE_ENV === 'production';
  if (!hosted || trustedProxies(env.TRUSTED_PROXY_CIDRS, env.TRUSTED_PROXY_HOPS) !== false) return null;
  return 'TRUSTED_PROXY_CIDRS no está configurado en un despliegue alojado: si la API recibe el tráfico a través de un proxy, todos los visitantes ' +
    'compartirán el mismo límite de frecuencia. Configura las IPs o CIDRs de los proxies confiables (y las del proxy de entrada en el frontend) ' +
    'confirmados con tu proveedor, o TRUSTED_PROXY_HOPS=1 exclusivamente tras un único ingress sin acceso directo a NestJS; ' +
    'si la API recibe conexiones directas de los clientes, puedes ignorar este aviso.';
}
