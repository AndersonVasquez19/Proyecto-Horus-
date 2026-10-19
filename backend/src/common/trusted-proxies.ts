import { isIP } from 'node:net';

// Empty by default. Never trust every source or a user-controlled hop count.
export function trustedProxies(value: unknown): string[] | false {
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
  if (!hosted || trustedProxies(env.TRUSTED_PROXY_CIDRS) !== false) return null;
  return 'TRUSTED_PROXY_CIDRS no está configurado en un despliegue alojado: si la API recibe el tráfico a través de un proxy, todos los visitantes ' +
    'compartirán el mismo límite de frecuencia. Configura las IPs o CIDRs de los proxies confiables (y las del proxy de entrada en el frontend) ' +
    'confirmados con tu proveedor; si la API recibe conexiones directas de los clientes, puedes ignorar este aviso.';
}
