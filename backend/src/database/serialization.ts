import { Prisma } from '@prisma/client';

// Preserve MySQL DATEONLY and DECIMAL representations in API responses.
// La clave y la huella de idempotencia son internas: nunca salen en la API.
export function serializeQuote<T extends { validez: Date }>(item: T) {
  const result = { ...item, validez: item.validez.toISOString().slice(0, 10) };
  delete result['idempotencia_clave'];
  delete result['idempotencia_huella'];
  for (const field of ['subtotal', 'descuento', 'tasa', 'impuesto', 'total']) {
    if (item[field] instanceof Prisma.Decimal) result[field] = item[field].toFixed(2);
  }
  return result;
}
export function serializeComplaint<T extends { fecha_incidente: Date }>(item: T) {
  return { ...item, fecha_incidente: item.fecha_incidente.toISOString().slice(0, 10) };
}
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
// P2021 (tabla inexistente) o P2022 (columna inexistente): la base no tiene la estructura que espera este código, normalmente porque
// faltan migraciones. No se corrige aquí (nada de cambios de esquema improvisados): solo permite responder 503 en vez de un 500 genérico.
export function isSchemaOutdated(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022');
}
