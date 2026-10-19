import { createHash } from 'node:crypto';
import type { MailOutcome } from './mail.service';

// Registro de intentos de envío dentro del `historial` JSON que ya tienen AttentionRecord y Cotizacion (sin tablas ni migraciones).
// Cada intento deja entradas con la forma { accion, usuario, fecha, correo: { intento, tipo, estado, huella, proveedor_id? } }:
//   'iniciado'  -> se reclamó el envío (antes de contactar al proveedor)
//   'aceptado'  -> el proveedor aceptó la solicitud (NO significa entregado en la bandeja)
//   'fallido'   -> rechazo confirmado: el mensaje no se aceptó
//   'incierto'  -> no se puede confirmar si el proveedor lo aceptó
// El estado vigente de un intento es el de su última entrada. Las entradas antiguas sin `correo` se ignoran.
export type AttemptKind = 'respuesta' | 'constancia' | 'cotizacion';
export type AttemptState = 'iniciado' | 'aceptado' | 'fallido' | 'incierto';
export interface AttemptRef { intento: string; estado: AttemptState; fecha: string; proveedor_id?: string }
export interface AttemptEntry { accion: string; usuario: number; fecha: string; correo: { intento: string; tipo: AttemptKind; estado: AttemptState; huella: string; proveedor_id?: string } }

const KIND_TEXT: Record<AttemptKind, string> = { respuesta: 'Correo de respuesta', constancia: 'Constancia al visitante', cotizacion: 'Correo de cotización' };
const STATE_TEXT: Record<AttemptState, string> = {
  iniciado: 'envío iniciado, sin resultado todavía',
  aceptado: 'aceptado por el proveedor (no confirma la entrega)',
  fallido: 'no se pudo enviar',
  incierto: 'no se pudo confirmar si el proveedor lo aceptó',
};

// Huella del contenido y destino de un envío lógico. No es un secreto ni permite reconstruir el texto; sirve para saber si el contenido
// o el destinatario cambiaron desde el intento anterior (un contenido nuevo es otro envío lógico).
export const fingerprint = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);

export function attemptEntry(kind: AttemptKind, state: AttemptState, user: number, huella: string, intento: string, providerId?: string): AttemptEntry {
  const proveedor = providerId && /^[\w.@<>=+:-]{1,200}$/.test(providerId) ? providerId : undefined; // solo ids con forma de identificador
  return { accion: KIND_TEXT[kind] + ': ' + STATE_TEXT[state], usuario: user, fecha: new Date().toISOString(), correo: { intento, tipo: kind, estado: state, huella, ...(proveedor ? { proveedor_id: proveedor } : {}) } };
}

export const stateOfOutcome = (outcome: MailOutcome): AttemptState => outcome.status === 'accepted' ? 'aceptado' : outcome.status === 'failed' ? 'fallido' : 'incierto';

// Último intento (por orden de aparición) del mismo tipo y la misma huella, con el estado de su última entrada.
export function lastAttempt(historial: unknown, kind: AttemptKind, huella: string): AttemptRef | null {
  if (!Array.isArray(historial)) return null;
  let found: AttemptRef | null = null;
  for (const entry of historial as Array<Partial<AttemptEntry> | null>) {
    const info = entry?.correo;
    if (!info || info.tipo !== kind || info.huella !== huella || typeof info.intento !== 'string') continue;
    found = { intento: info.intento, estado: info.estado as AttemptState, fecha: String(entry?.fecha ?? ''), ...(info.proveedor_id ? { proveedor_id: info.proveedor_id } : {}) };
  }
  return found;
}

export type SendBlock = 'en_curso' | 'ya_aceptado' | 'incierto';
export type SendDecision = { allow: boolean; motivo?: SendBlock };
// Un nuevo envío del MISMO contenido solo se permite sin confirmar tras un fallo confirmado. Con un intento iniciado sin resultado, aceptado o
// incierto se exige confirmación explícita: nunca se desbloquea por el simple paso del tiempo ni se reintenta automáticamente.
export function decideSend(last: AttemptRef | null, confirmed: boolean): SendDecision {
  if (!last || last.estado === 'fallido' || confirmed) return { allow: true };
  return { allow: false, motivo: last.estado === 'iniciado' ? 'en_curso' : last.estado === 'aceptado' ? 'ya_aceptado' : 'incierto' };
}
