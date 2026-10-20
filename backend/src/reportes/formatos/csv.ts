import type { ReportDocument } from '../reportes.types';
import { PERSONAL_DATA_NOTICE, cellText, cleanText, neutralizeFormula, summaryText } from './celdas';

// CSV para Excel: UTF-8 con BOM (Excel reconoce así las tildes y la ñ), fin de línea CRLF y comillas dobles solo cuando hacen
// falta (se duplican las internas), según RFC 4180. Todas las líneas tienen el mismo número de campos.
//
// Separador: punto y coma por defecto. Excel abre un CSV con el separador de lista de Windows, y en es-PE (como en es-ES) es «;»:
// con comas, toda la fila queda en una sola columna (comprobado con Excel en es-PE). `coma` queda disponible para herramientas que
// esperan el CSV clásico o para Windows con separador «,» (p. ej. en-US). Los decimales usan punto, igual que es-PE.
//
// Estructura: primero la tabla (encabezados, filas y, si el reporte la define, la fila «Total»), para que Excel y las
// herramientas de importación detecten los encabezados en la primera línea; después, separados por una línea vacía, los metadatos
// (reporte, período, filtros) y el resumen con los mismos totales que el XLSX y el PDF.
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
export const CSV_SEPARATORS = { punto_y_coma: ';', coma: ',' } as const;
export type CsvSeparator = keyof typeof CSV_SEPARATORS;

const text = (value: string) => neutralizeFormula(cleanText(value));

export function renderCsv(doc: ReportDocument, separator: CsvSeparator = 'punto_y_coma'): Buffer {
  const sep = CSV_SEPARATORS[separator];
  const needsQuotes = sep === ';' ? /[";\r\n]|^\s|\s$/ : /[",\r\n]|^\s|\s$/;
  const field = (value: string) => needsQuotes.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  const { columnas, filas, totales } = doc.tabla;
  const width = Math.max(columnas.length, 2);
  const lines: string[] = [];
  const push = (cells: string[]) => lines.push([...cells, ...Array(width - cells.length).fill('')].map(field).join(sep));

  push(columnas.map(column => text(column.titulo)));
  for (const row of filas) push(columnas.map(column => cellText(row[column.clave] ?? null, column.tipo, 'csv')));
  if (totales) push(columnas.map(column => cellText(totales[column.clave] ?? null, column.tipo, 'csv')));

  push([]);
  push([text('Reporte'), text(doc.titulo)]);
  push([text('Institución'), text(doc.institucion)]);
  push([text('Generado el'), text(doc.generado_local + ' (hora de Lima)')]);
  push([text('Período'), text(doc.periodo.etiqueta)]);
  for (const filter of doc.filtros) push([text(filter.etiqueta), text(filter.valor)]);
  push([text('Filas'), String(doc.tabla.total_filas)]);
  push([]);
  push([text('Indicador'), text('Valor')]);
  for (const entry of doc.resumen) push([text(entry.etiqueta), summaryText(entry)]);
  if (doc.notas.length || doc.datos_personales) push([]);
  for (const note of doc.notas) push([text('Nota'), text(note)]);
  if (doc.datos_personales) push([text('Aviso'), text(PERSONAL_DATA_NOTICE)]);

  return Buffer.concat([BOM, Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}
