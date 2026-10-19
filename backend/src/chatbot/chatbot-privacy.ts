import { createHash } from 'node:crypto';

// Oculta correos, teléfonos/documentos largos y enlaces antes de enviar texto a un proveedor o de guardarlo.
export const redactPersonalData = (text: string) => text
  .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[correo oculto]')
  .replace(/(?:\+?\d[\d ()./-]{5,}\d)/g, '[número oculto]')
  .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[enlace oculto]');

export const MAX_STORED_QUESTION = 500;

// Retención de las preguntas sin respuesta y de las métricas: 90 días desde su último registro. Pasado ese plazo se eliminan y, hasta eliminarse, no se muestran.
export const RETENTION_DAYS = 90;
export const retentionCutoff = (now = new Date()) => new Date(now.getTime() - RETENTION_DAYS * 86_400_000);

// Texto que se guarda de una pregunta sin respuesta: sin datos personales, en una línea y acotado al tamaño de la columna.
export function cleanQuestion(text: unknown): string {
  const value = redactPersonalData(String(text ?? '')).replace(/\s+/g, ' ').trim();
  return value.length > MAX_STORED_QUESTION ? value.slice(0, MAX_STORED_QUESTION - 1) + '…' : value;
}

// Identidad estable de una pregunta (sin mayúsculas, tildes ni espacios de más) para contar repeticiones sin guardar duplicados.
export const questionFingerprint = (cleaned: string) =>
  createHash('sha256').update(cleaned.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
