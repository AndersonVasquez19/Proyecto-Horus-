import { API_BASE } from '../../apiBase'
import { PublicApiError } from '../../api'
import { PUBLIC_ERROR_TEXTS } from '../../publicErrors'
export type ChatSource = { id: string; title: string; text: string; href?: string };
export type ChatTurn = { role: 'user' | 'assistant'; content: string; sources?: ChatSource[]; suggestions?: string[] };
export type ChatKind = 'saludo' | 'aclaracion' | 'listado' | 'respuesta' | 'parcial' | 'sin_informacion';
export type ChatReply = { ok: boolean; answer: string; sources: ChatSource[]; mode: 'catalogo' | 'ia'; kind?: ChatKind; suggestions?: string[]; notice?: string };

// Solo se enlazan rutas propias del sitio; cualquier otro valor que llegue en `href` se ignora.
export const internalPath = (href?: string) => (href && /^\/(?!\/)[A-Za-z0-9\-._~/]*$/.test(href) ? href : undefined);

export async function chatRequest<T>(path: 'message' | 'contact', body: unknown, signal: AbortSignal): Promise<T> {
  const attempt = await fetch(API_BASE + '/chatbot/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  }).catch((error: Error) => error);
  if (attempt instanceof Error) {
    if (signal.aborted) throw attempt; // el chat distingue la cancelación por tiempo
    throw new TypeError(PUBLIC_ERROR_TEXTS.network); // nunca "Failed to fetch"; TypeError = caída de red
  }
  const response = attempt;
  if (!response.ok) {
    if (response.status === 429) throw new PublicApiError('Has enviado varias solicitudes. Espera un minuto y vuelve a intentar.', 429);
    if (response.status === 400) throw new PublicApiError('Revisa los datos enviados y vuelve a intentar.', 400);
    throw new PublicApiError('No pudimos completar la solicitud. Intenta nuevamente o visita Contacto.', response.status);
  }
  return response.json().catch(() => { throw new PublicApiError(PUBLIC_ERROR_TEXTS.server, response.status); }) as Promise<T>;
}
