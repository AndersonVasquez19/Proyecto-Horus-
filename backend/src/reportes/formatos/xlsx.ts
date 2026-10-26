import { PERSONAL_DATA_NOTICE, NOT_APPLICABLE, cleanText } from './celdas';
import { createZip } from './zip';
import type { CellValue, ColumnKind, ReportDocument } from '../reportes.types';

// Libro XLSX auténtico (Office Open XML / SpreadsheetML, ISO/IEC 29500) empaquetado en ZIP. No es un XML .xls renombrado.
// Hojas: «Resumen» (encabezado institucional, período, filtros, indicadores y notas) y la hoja de datos (encabezados fijos,
// autofiltro, fechas reales con formato dd/mm/aaaa y fila «Total»).
//
// Fórmulas: todo texto se escribe como cadena (t="inlineStr"), que Excel nunca evalúa, y con quotePrefix="1" (el apóstrofo oculto
// de Excel), de modo que tampoco se convierte en fórmula si alguien edita la celda y pulsa Intro. No se escribe ninguna fórmula.

const NAVY = 'FF0A2540';
const GOLD = 'FFC9A961';
const TOTAL_FILL = 'FFF3EDE0';

// Índices de cellXfs (ver STYLES).
const S = { title: 1, subtitle: 2, header: 3, text: 4, int: 5, date: 6, datetime: 7, dec: 8, totalText: 9, totalInt: 10, totalDec: 11, label: 12, note: 13, totalEmpty: 14, money: 15, totalMoney: 16 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="166" formatCode="0.0"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="${NAVY}"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="13"/><color rgb="${NAVY}"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${NAVY}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${TOTAL_FILL}"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="${GOLD}"/></bottom><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="${NAVY}"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" quotePrefix="1"/>
<xf numFmtId="1" fontId="1" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" quotePrefix="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" quotePrefix="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="1" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

type Cell = { value: string | number; style: number } | { value: null; style: number } | null;

const xml = (value: string) => cleanText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const columnName = (index: number) => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
// Número de serie de Excel (sistema 1900) de 'AAAA-MM-DD' o 'AAAA-MM-DD HH:mm' (hora local de Lima, sin zona).
export function excelSerial(value: string): number {
  const day = (Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) - EXCEL_EPOCH) / 86_400_000;
  if (value.length < 16) return day;
  return day + (Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16))) / 1440;
}

// Nombre de hoja válido: sin []:*?/\ ni apóstrofo inicial/final, máximo 31 caracteres.
export const sheetName = (value: string) => cleanText(value).replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Datos';
const quotedSheet = (name: string) => "'" + name.replace(/'/g, "''") + "'";

function dataCell(value: CellValue, kind: ColumnKind, total: boolean): Cell {
  if (value === null || value === undefined) return total ? { value: null, style: S.totalEmpty } : null;
  if (typeof value === 'string') {
    if (kind === 'fecha' || kind === 'fecha_hora') return { value: excelSerial(value), style: kind === 'fecha' ? S.date : S.datetime };
    return { value, style: total ? S.totalText : S.text };
  }
  if (kind === 'decimal') return { value, style: total ? S.totalDec : S.dec };
  if (kind === 'importe') return { value, style: total ? S.totalMoney : S.money };
  return { value, style: total ? S.totalInt : S.int };
}

function cellXml(cell: Cell, ref: string): string {
  if (!cell) return '';
  if (cell.value === null) return `<c r="${ref}" s="${cell.style}"/>`;
  if (typeof cell.value === 'number') return `<c r="${ref}" s="${cell.style}"><v>${Number.isFinite(cell.value) ? cell.value : 0}</v></c>`;
  return `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
}

interface SheetSpec {
  rows: Cell[][];
  widths: number[];
  headerRow?: number; // fila (1-based) de encabezados: se fija y se le da altura
  autoFilter?: string;
}

function sheetXml(spec: SheetSpec): string {
  const lastCol = Math.max(1, ...spec.rows.map(row => row.length), spec.widths.length);
  const dimension = 'A1:' + columnName(lastCol - 1) + Math.max(1, spec.rows.length);
  const pane = spec.headerRow
    ? `<pane ySplit="${spec.headerRow}" topLeftCell="A${spec.headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${spec.headerRow + 1}" sqref="A${spec.headerRow + 1}"/>`
    : '';
  const cols = spec.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(60, Math.max(8, width + 2))}" customWidth="1"/>`).join('');
  const rows = spec.rows.map((row, r) => {
    const cells = row.map((cell, c) => cellXml(cell, columnName(c) + (r + 1))).join('');
    const height = spec.headerRow === r + 1 ? ' ht="32" customHeight="1"' : '';
    return cells || height ? `<row r="${r + 1}"${height}>${cells}</row>` : '';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="${dimension}"/>`
    + `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${rows}</sheetData>`
    + (spec.autoFilter ? `<autoFilter ref="${spec.autoFilter}"/>` : '')
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '<headerFooter><oddHeader>&amp;L&amp;"Calibri,Bold"Horus Group SRL</oddHeader><oddFooter>&amp;LGenerado por Horus Group SRL&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter>'
    + '</worksheet>';
}

const text = (value: string, style: number = S.text): Cell => ({ value, style });

function summarySheet(doc: ReportDocument, dataSheet: string): SheetSpec {
  const rows: Cell[][] = [
    [text(doc.institucion, S.title)],
    [text(doc.titulo, S.subtitle)],
    [text(doc.descripcion, S.note)],
    [],
    [text('Generado el', S.label), { value: excelSerial(doc.generado_local), style: S.datetime }, text('hora de Lima', S.note)],
    [text('Período', S.label), text(doc.periodo.etiqueta)],
    ...doc.filtros.map(filter => [text(filter.etiqueta, S.label), text(filter.valor)]),
    [text('Filas de datos', S.label), { value: doc.tabla.total_filas, style: S.int }, text('hoja «' + dataSheet + '»', S.note)],
    [],
    [text('Indicador', S.header), text('Valor', S.header)],
    ...doc.resumen.map(entry => [text(entry.etiqueta), entry.valor === null ? text(NOT_APPLICABLE) : { value: entry.valor, style: entry.tipo === 'decimal' ? S.dec : entry.tipo === 'importe' ? S.money : S.int }]),
  ];
  if (doc.notas.length || doc.datos_personales) rows.push([], [text('Notas', S.label)]);
  for (const note of doc.notas) rows.push([text(note, S.note)]);
  if (doc.datos_personales) rows.push([text(PERSONAL_DATA_NOTICE, S.note)]);
  return { rows, widths: [52, 34, 22] };
}

function dataSheet(doc: ReportDocument): SheetSpec {
  const { columnas, filas, totales } = doc.tabla;
  const rows: Cell[][] = [columnas.map(column => text(column.titulo, S.header))];
  for (const row of filas) rows.push(columnas.map(column => dataCell(row[column.clave] ?? null, column.tipo, false)));
  // Una fila vacía separa los totales: si fueran contiguos, Excel ampliaría el autofiltro y al ordenar los mezclaría con los datos.
  if (totales) rows.push([], columnas.map(column => dataCell(totales[column.clave] ?? null, column.tipo, true)));
  const lastCol = columnName(columnas.length - 1);
  return { rows, widths: columnas.map(column => Math.max(column.ancho, column.titulo.length)), headerRow: 1, autoFilter: 'A1:' + lastCol + (filas.length + 1) };
}

export function renderXlsx(doc: ReportDocument): Buffer {
  const dataName = sheetName(doc.tabla.titulo === 'Resumen' ? 'Datos' : doc.tabla.titulo);
  const data = dataSheet(doc);
  const lastCol = columnName(doc.tabla.columnas.length - 1);
  const created = doc.generado_at.replace(/\.\d{3}Z$/, 'Z');
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
    'docProps/core.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${xml(doc.titulo)}</dc:title><dc:creator>${xml(doc.institucion)}</dc:creator>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
      + `<Application>Horus Group SRL</Application><Company>${xml(doc.institucion)}</Company></Properties>`,
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<bookViews><workbookView activeTab="0"/></bookViews>'
      + `<sheets><sheet name="Resumen" sheetId="1" r:id="rId1"/><sheet name="${xml(dataName)}" sheetId="2" r:id="rId2"/></sheets>`
      + '<definedNames>'
      + `<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">${xml(quotedSheet(dataName))}!$A$1:$${lastCol}$${doc.tabla.filas.length + 1}</definedName>`
      + `<definedName name="_xlnm.Print_Titles" localSheetId="1">${xml(quotedSheet(dataName))}!$1:$1</definedName>`
      + '</definedNames></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': sheetXml(summarySheet(doc, dataName)),
    'xl/worksheets/sheet2.xml': sheetXml(data),
  };
  return createZip(Object.entries(files).map(([name, content]) => ({ name, data: Buffer.from(content, 'utf8') })), new Date(doc.generado_local.replace(' ', 'T') + ':00Z'));
}
