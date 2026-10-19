// Interpreta la respuesta de un envío manual de correo (respuesta, constancia, cotización).
// Regla central: un fallo de red, un timeout del navegador o un 5xx sin cuerpo estructurado NO prueban que el correo no salió, así que se tratan como
// «incierto» y nunca se invita a reintentar a ciegas. Solo un «fallido» confirmado por el servidor permite reintentar sin confirmación.
export type MailKind = 'aceptado' | 'fallido' | 'incierto' | 'bloqueado' | 'obsoleto' | 'conflicto' | 'error';
export interface MailResult { kind: MailKind; message: string; needsConfirm: boolean }

export const UNCERTAIN_CLIENT = 'No pudimos confirmar si el correo salió. Es posible que el destinatario lo reciba. Revisa el historial antes de reenviarlo.';
export const STALE_CASE = 'El caso cambió mientras se enviaba, así que el correo pudo haber salido. Estamos comparando los cambios; revisa el historial antes de enviar otra vez.';

const REVISION_CONFLICT = /cambi/i;
type Failure ={ status?: number; body?: unknown; message?: string; name?: string };
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback;

export function mailResultFromSuccess(data: unknown): MailResult {
  const body = asRecord(data);
  return { kind: 'aceptado', message: text(body.mensaje, 'El proveedor aceptó el correo. Esto no confirma que ya esté en la bandeja del destinatario.'), needsConfirm: false };
}

// `failure` es un PanelApiError (status/body/message) o cualquier otro error de la petición (red, timeout, cancelación).
export function mailResultFromFailure(failure: Failure | null | undefined): MailResult {
  const status = typeof failure?.status === 'number' ? failure.status : undefined;
  const body = asRecord(failure?.body);
  if (body.envio === 'bloqueado') return { kind: 'bloqueado', message: text(body.mensaje, 'Ya hay un envío registrado de este contenido. Confirma si quieres enviarlo otra vez.'), needsConfirm: true };
  if (body.envio === 'fallido') return { kind: 'fallido', message: text(body.mensaje, 'No se pudo enviar el correo. Puedes volver a intentarlo.'), needsConfirm: false };
  if (body.envio === 'incierto') return { kind: 'incierto', message: text(body.mensaje, UNCERTAIN_CLIENT), needsConfirm: false };
  if (status === 409) {
    // Dos 409 distintos sin `envio`: la revisión quedó obsoleta (los textos del servidor dicen que el registro «cambió»; también ocurre si el navegador
    // repite solo un POST cuya conexión se cortó) o una regla de negocio lo impide (p. ej. «La propuesta está vencida»), cuyo mensaje se conserva.
    if (REVISION_CONFLICT.test(failure?.message ?? '') || !failure?.message) return { kind: 'obsoleto', message: STALE_CASE, needsConfirm: false };
    return { kind: 'conflicto', message: failure.message, needsConfirm: false };
  }
  // Con respuesta HTTP que el servidor explica (validación, permisos, correo no disponible) se muestra su mensaje; sin ella, no se sabe qué pasó.
  if (status !== undefined && status < 500) return { kind: 'error', message: text(failure?.message, 'No se pudo completar el envío.'), needsConfirm: false };
  if (status === 503 && body.envio === undefined && typeof failure?.message === 'string' && failure.message.trim()) return { kind: 'error', message: failure.message, needsConfirm: false };
  // timeout, red caída, 502/504 de un proxy o 500: la petición pudo llegar al proveedor
  return { kind: 'incierto', message: UNCERTAIN_CLIENT, needsConfirm: false };
}
