import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { CotizacionDto } from './cotizacion.dto';

// Encabezado opcional `Idempotency-Key` de POST /admin/cotizaciones. Sin él se conserva el comportamiento anterior (cada POST crea una cotización).
export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

export function parseIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) throw new BadRequestException('La clave de idempotencia no es válida (16 a 128 caracteres: letras, números, punto, guion, guion bajo o dos puntos).');
  return value;
}

// Huella del contenido lógico de la solicitud: usuario + todos los campos que forman la cotización, en orden fijo.
// Dos peticiones con la misma clave son «la misma operación» solo si esta huella coincide.
export function quoteRequestHash(dto: CotizacionDto, user: number): string {
  const canonical = JSON.stringify([user, dto.cliente, dto.email, dto.telefono, dto.documento, dto.direccion, dto.emisor, dto.datos_emisor, dto.moneda, dto.validez, dto.condiciones,
    dto.conceptos.map(item => [item.descripcion, item.cantidad, item.precio]), dto.descuento, dto.tasa, dto.contacto_id ?? null]);
  return createHash('sha256').update(canonical).digest('hex');
}
