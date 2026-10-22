import type { MessageExportRow } from '../../attention/message-state';
import { CSV_SEPARATORS, type CsvSeparator } from '../../reportes/formatos/csv';
import { PERSONAL_DATA_NOTICE, cleanText, neutralizeFormula } from '../../reportes/formatos/celdas';
import { limaDateTime } from '../../reportes/reportes.periodo';

// CSV de consultas para el panel. Mismas reglas que los reportes (BOM UTF-8, CRLF, comillas RFC 4180, neutralización de fórmulas),
// con un conjunto de columnas fijo: el cliente no elige columnas. No incluye el texto del mensaje ni nada del seguimiento.
export const MAX_EXPORT_MESSAGES = 5_000; // más allá se pide acotar con filtros; ~5 000 filas de 8 columnas caben holgadas en memoria
export const EXPORT_BATCH_SIZE = 500;

const ORIGIN_LABELS: Readonly<Record<string, string>> = { web: 'Formulario web', chatbot: 'Chatbot', manual: 'Registro manual' };
const STATE_LABELS: Readonly<Record<string, string>> = { nuevo: 'Nuevo', en_proceso: 'En proceso', atendido: 'Atendido', archivado: 'Archivado' };
export const MESSAGE_EXPORT_HEADERS = ['ID', 'Nombre', 'Correo', 'Teléfono', 'Asunto', 'Origen', 'Estado', 'Recibida (hora de Lima)'] as const;

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const cell = (value: unknown) => neutralizeFormula(cleanText(String(value ?? '')));
const asDate = (value: Date | string) => value instanceof Date ? value : new Date(value);

export function messageExportCells(row: MessageExportRow): string[] {
  const received = asDate(row.createdAt);
  return [
    String(row.id), cell(row.nombre), cell(row.email), cell(row.telefono), cell(row.asunto),
    cell(ORIGIN_LABELS[row.origen] ?? row.origen), cell(STATE_LABELS[row.estado] ?? row.estado),
    Number.isNaN(received.getTime()) ? '' : limaDateTime(received),
  ];
}

export function renderMessagesCsv(rows: readonly MessageExportRow[], now: Date, separator: CsvSeparator = 'punto_y_coma'): Buffer {
  const sep = CSV_SEPARATORS[separator];
  const needsQuotes = sep === ';' ? /[";\r\n]|^\s|\s$/ : /[",\r\n]|^\s|\s$/;
  const field = (value: string) => needsQuotes.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  const width = MESSAGE_EXPORT_HEADERS.length;
  const line = (cells: string[]) => [...cells, ...Array(width - cells.length).fill('')].map(field).join(sep);
  const lines = [line([...MESSAGE_EXPORT_HEADERS]), ...rows.map(row => line(messageExportCells(row))),
    line([]), line(['Filas', String(rows.length)]), line(['Generado el', limaDateTime(now) + ' (hora de Lima)']), line(['Aviso', PERSONAL_DATA_NOTICE])];
  return Buffer.concat([BOM, Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}

// Nombre ASCII seguro para Content-Disposition: horus-consultas-AAAAMMDD-HHmm.csv
export function messagesExportFileName(now: Date): string {
  return 'horus-consultas-' + limaDateTime(now).replace(/[^0-9]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2') + '.csv';
}
