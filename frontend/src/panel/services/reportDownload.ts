import { API_BASE } from '../../apiBase';
import { reportAccessDenied, reportExpiredSession } from '../context/sessionEvents';
import { ACCESS_DENIED } from '../context/sessionRefresh';
import { PanelApiError } from './panelApi';
import { downloadErrorText, downloadFileName, type ReportFormat } from './reports';

const EXPECTED: Record<ReportFormat, RegExp> = { csv: /^text\/csv/i, xlsx: /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/i, pdf: /^application\/pdf/i };

// Descarga un reporte con el token en `Authorization` (nunca en la URL). Antes de entregar el archivo se comprueba que la respuesta sea
// correcta, del tipo esperado y no vacía: un error del servidor llega como JSON y se muestra como mensaje, nunca como archivo. No se reintenta.
export async function downloadReport(tipo: string, query: URLSearchParams, format: ReportFormat, token: string | null, signal: AbortSignal): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(API_BASE + '/admin/reportes/' + encodeURIComponent(tipo) + '/exportar?' + query, { method: 'GET', signal, cache: 'no-store', headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (response.status === 401) reportExpiredSession(token);
  if (response.status === 403) { reportAccessDenied(token); throw new PanelApiError(ACCESS_DENIED, 403); }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { mensaje?: unknown; message?: unknown } | null;
    throw new PanelApiError(downloadErrorText(response.status, body?.mensaje ?? body?.message), response.status);
  }
  if (!EXPECTED[format].test(response.headers.get('Content-Type') ?? '')) throw new PanelApiError('El servidor devolvió un archivo inesperado. Inténtalo de nuevo.', response.status);
  const blob = await response.blob();
  if (!blob.size) throw new PanelApiError('El servidor devolvió un archivo vacío. Inténtalo de nuevo.', response.status);
  return { blob, fileName: downloadFileName(response.headers.get('Content-Disposition'), tipo, format) };
}

// Entrega el archivo al navegador y libera el enlace temporal.
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  try { const link = Object.assign(document.createElement('a'), { href: url, download: fileName, rel: 'noopener' }); document.body.appendChild(link); link.click(); link.remove(); }
  finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
