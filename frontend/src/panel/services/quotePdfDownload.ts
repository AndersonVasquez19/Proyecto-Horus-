import { API_BASE } from '../../apiBase';
import { reportAccessDenied, reportExpiredSession } from '../context/sessionEvents';
import { ACCESS_DENIED } from '../context/sessionRefresh';
import { PanelApiError } from './panelApi';
import { pdfErrorText, quotePdfFileName } from './quoteActions';

// Descarga el PDF real de una cotización (GET /api/admin/cotizaciones/:id/pdf) con el token en `Authorization` (nunca en la URL). Antes de entregar
// el archivo se comprueba que la respuesta sea correcta, application/pdf y no vacía: un error llega como mensaje, nunca como archivo. No se reintenta.
// El archivo se entrega con `saveBlob` (services/reportDownload.ts).
export async function downloadQuotePdf(id: number, numero: string, token: string | null, signal: AbortSignal): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(API_BASE + '/admin/cotizaciones/' + encodeURIComponent(String(id)) + '/pdf', { method: 'GET', signal, cache: 'no-store', headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (response.status === 401) reportExpiredSession(token);
  if (response.status === 403) { reportAccessDenied(token); throw new PanelApiError(ACCESS_DENIED, 403); }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { mensaje?: unknown; message?: unknown } | null;
    throw new PanelApiError(pdfErrorText(response.status, body?.mensaje ?? body?.message), response.status);
  }
  if (!/^application\/pdf/i.test(response.headers.get('Content-Type') ?? '')) throw new PanelApiError('El servidor devolvió un archivo inesperado. Inténtalo de nuevo.', response.status);
  const blob = await response.blob();
  if (!blob.size) throw new PanelApiError('El servidor devolvió un archivo vacío. Inténtalo de nuevo.', response.status);
  return { blob, fileName: quotePdfFileName(response.headers.get('Content-Disposition'), numero) };
}
