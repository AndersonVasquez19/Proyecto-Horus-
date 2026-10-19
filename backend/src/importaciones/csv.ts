import { BadRequestException } from '@nestjs/common';
import { ArchivoImportacionDto, MapeoImportacionDto } from './importaciones.dto';

export const MAX_BYTES = 48 * 1024;
export const MAX_ROWS = 200;
const fail = (message: string): never => { throw new BadRequestException(message); };
export const canonical = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases: Record<keyof MapeoImportacionDto, string[]> = {
  doc_numero: ['dni', 'documento', 'numerodedocumento', 'nrodocumento', 'nrodedocumento'], nombres: ['nombres', 'nombre'], apellidos: ['apellidos'],
  email: ['email', 'correo', 'correoelectronico'], telefono: ['telefono', 'celular'], tipo_persona: ['tipopersona', 'rol', 'participacion', 'tipoparticipante'],
};
export const forbiddenColumn = (value: string) => /^(nota|calificacion|asistencia|pago|monto|estado|aprob|certific|cod(?:igo)?(?:de)?registro|cumpl|docente|ponente)/.test(canonical(value));

export function readCsv(dto: ArchivoImportacionDto, encoding = 'auto') {
  if (!/^[^\\/\x00-\x1f]+\.csv$/i.test(dto.nombre) || !['', 'text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'].includes(dto.mime)) fail('Formato no permitido. Solo se admite CSV.');
  const buffer = Buffer.from(dto.contenido, 'base64');
  if (!buffer.length) fail('El archivo está vacío.');
  if (buffer.length > MAX_BYTES) fail('El archivo supera 48 KiB. Divide la hoja en lotes pequeños.');
  if (buffer.toString('base64') !== dto.contenido) fail('El archivo está corrupto.');
  if (buffer.subarray(0, 2).toString() === 'PK' || buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) fail('El contenido es un libro binario o ZIP. Expórtalo como CSV.');
  let detected = encoding;
  if (detected === 'auto') {
    detected = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le' : 'utf-8';
    if (detected === 'utf-8') { try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { detected = 'windows-1252'; } }
  }
  let content: string;
  try { content = new TextDecoder(detected, { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { return fail('La codificación no coincide con el archivo.'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(content) || /^\s*(?:<|\{\s*"|%PDF)/.test(content)) fail('El archivo contiene datos binarios o contenido no permitido.');
  // Contar separadores fuera de comillas en las primeras líneas, incluidas cabeceras precedidas por títulos.
  const counts = new Map([[';', 0], [',', 0], ['\t', 0]]); let quoted = false;
  for (const c of content.split(/\r?\n/).slice(0, 21).join('\n')) { if (c === '"') quoted = !quoted; else if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1); }
  const delimiter = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = [], cell = '', mode: 'plain' | 'quoted' | 'after' = 'plain';
  const pushCell = () => { if (cell.length > 1000) fail('Una celda supera 1000 caracteres.'); row.push(cell); cell = ''; if (row.length > 40) fail('Se admiten hasta 40 columnas.'); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 20) fail('El archivo supera el límite de filas (200 datos y hasta 20 de cabecera).'); };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (mode === 'quoted') { if (c === '"') { if (content[i + 1] === '"') { cell += '"'; i++; } else mode = 'after'; } else cell += c; }
    else if (c === delimiter) { pushCell(); mode = 'plain'; }
    else if (c === '\r' || c === '\n') { if (c === '\r' && content[i + 1] === '\n') i++; pushRow(); mode = 'plain'; }
    else if (c === '"' && mode === 'plain' && !cell) mode = 'quoted';
    else { if (mode === 'after' || c === '"') fail('CSV corrupto: comillas mal cerradas.'); cell += c; }
    if (cell.length > 1000) fail('Una celda supera 1000 caracteres.');
  }
  if (mode === 'quoted') fail('CSV corrupto: falta cerrar una comilla.');
  if (cell || row.length || mode === 'after') pushRow();
  if (!rows.some(r => r.some(c => c.trim()))) fail('El archivo está vacío.');
  const headerIndex = rows.slice(0, 20).findIndex(r => r.some(c => aliases.doc_numero.includes(canonical(c))));
  return { rows, codificacion: detected, separador: delimiter === '\t' ? 'tabulación' : delimiter, encabezado: headerIndex < 0 ? 1 : headerIndex + 1 };
}

export function detectMapping(columns: string[]) {
  const result: Partial<MapeoImportacionDto> = {};
  for (const [key, names] of Object.entries(aliases)) { const indices = columns.flatMap((c, i) => names.includes(canonical(c)) ? [i] : []); if (indices.length === 1) result[key as keyof MapeoImportacionDto] = indices[0]; }
  return result;
}

export function mapCsv(dto: ArchivoImportacionDto & { codificacion: string; encabezado: number; mapeo?: MapeoImportacionDto }) {
  const parsed = readCsv(dto, dto.codificacion), columns = parsed.rows[dto.encabezado - 1];
  if (!columns?.length || columns.length < 3 || columns.some(c => /^[=+@-]/.test(c.trimStart()))) fail('Selecciona una fila de encabezados válida con al menos tres columnas.');
  const mapeo = dto.mapeo || detectMapping(columns);
  if (['doc_numero', 'nombres', 'apellidos'].some(k => !Number.isInteger(mapeo[k as keyof MapeoImportacionDto]))) fail('Mapea DNI, nombres y apellidos por separado. No se separan nombres completos automáticamente.');
  const indices = Object.values(mapeo).filter(v => v !== null && v !== undefined);
  if (new Set(indices).size !== indices.length || indices.some(i => i < 0 || i >= columns.length || forbiddenColumn(columns[i]))) fail('Mapeo inválido: columnas repetidas, fuera del archivo o reservadas (notas, pagos, certificados).');
  const rows = parsed.rows.slice(dto.encabezado).map((cells, i) => ({ cells, fila: dto.encabezado + i + 1 })).filter(r => r.cells.some(c => c.trim()));
  if (!rows.length || rows.length > MAX_ROWS) fail('Se admiten de 1 a 200 filas de datos por lote.');
  return { ...parsed, columns, mapeo: mapeo as MapeoImportacionDto, data: rows };
}
