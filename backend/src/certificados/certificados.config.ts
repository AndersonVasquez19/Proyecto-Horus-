import { isIP } from 'node:net';

// Dirección pública de verificación que se imprime en el QR del certificado. NO se deduce de la solicitud (cabecera Host o Origin, que
// controla quien llama) ni se inventa un dominio: la fija quien despliega con CERTIFICADOS_VERIFICACION_URL y se valida aquí.
//
// Ejemplo: CERTIFICADOS_VERIFICACION_URL=https://dominio-real.example/verificar  →  https://dominio-real.example/verificar/<CÓDIGO>
//
// Un documento ya impreso no se puede corregir, por eso se rechaza todo lo que no sea una dirección pública estable: http, localhost,
// direcciones IP, nombres internos, puertos, credenciales, parámetros y fragmentos.
export const VERIFICATION_URL_ENV = 'CERTIFICADOS_VERIFICACION_URL';
const MAX_BASE_LENGTH = 120; // con el código (20) cabe holgado en un QR de versión 8 (152 bytes)
const INTERNAL_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.intranet', '.lan', '.home', '.corp', '.test', '.invalid'];

export type VerificationBase = { ok: true; base: string } | { ok: false; reason: 'ausente' | 'invalida' };

export function resolveVerificationBase(value: unknown): VerificationBase {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return { ok: false, reason: 'ausente' };
  if (typeof value !== 'string' || value.length > MAX_BASE_LENGTH + 20) return { ok: false, reason: 'invalida' };
  const raw = value.trim();
  if (/[\s\\<>"'`]/.test(raw)) return { ok: false, reason: 'invalida' };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'invalida' }; }
  const host = url.hostname.toLowerCase();
  const bad = url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || !host.includes('.') || host.endsWith('.') || host === 'localhost' || isIP(host.replace(/^\[|\]$/g, '')) !== 0
    || INTERNAL_SUFFIXES.some(suffix => host.endsWith(suffix)) || !/^[a-z0-9.-]+$/.test(host); // URL ya convierte los dominios internacionales a punycode (ASCII)
  if (bad) return { ok: false, reason: 'invalida' };
  const base = (url.origin + url.pathname).replace(/\/+$/, '');
  if (base.length > MAX_BASE_LENGTH) return { ok: false, reason: 'invalida' };
  return { ok: true, base };
}

// Dirección completa que codifica el QR. El código solo contiene [A-Z2-9] (certificados.rules), así que no necesita escaparse.
export function verificationUrl(base: string, code: string): string {
  return base + '/' + code;
}
