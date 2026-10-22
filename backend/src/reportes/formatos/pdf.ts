import PDFDocument = require('pdfkit');
import { displayDate } from '../reportes.periodo';
import type { ColumnKind, ReportDocument, ReportRow } from '../reportes.types';
import { PERSONAL_DATA_NOTICE, cellText, cleanText, summaryText } from './celdas';

// PDF A4 con pdfkit (fuentes estándar Helvetica, sin archivos de fuentes): encabezado institucional en cada página, título, fecha de
// generación, período y filtros; indicadores del resumen; tabla con encabezado repetido tras cada salto de página, filas que no se
// parten entre páginas, fila «Total», notas y pie «Página X de Y». Horizontal si la tabla tiene más de 6 columnas.

const NAVY = '#0A2540';
const GOLD = '#C9A961';
const GOLD_LIGHT = '#F3EDE0';
const ZEBRA = '#F5F7FA';
const GRAY = '#555555';
const BORDER = '#D5DAE1';
const MARGIN = { top: 30, bottom: 36, left: 36, right: 36 };
const FOOTER_SPACE = 16;
const BODY_SIZE = 7.5;
const PAD = 3;
const MAX_CELL_LINES = 4;

// Las fuentes estándar codifican WinAnsi (Latin-1 + 27 signos). Lo demás se normaliza (NFKC: el signo igual de ancho completo pasa a «=») o se sustituye por «?».
const WIN_ANSI_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019,
  0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
export function pdfText(value: string): string {
  let out = '';
  for (const ch of cleanText(value).normalize('NFKC').replace(/\t/g, ' ').replace(/\r\n?/g, '\n')) {
    const code = ch.codePointAt(0)!;
    out += ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(code) ? ch : '?';
  }
  return out;
}

const numeric = (kind: ColumnKind) => kind === 'entero' || kind === 'decimal' || kind === 'importe';
function displayCell(value: ReportRow[string], kind: ColumnKind, total: boolean): string {
  if ((value === null || value === undefined) && numeric(kind) && !total) return '—';
  return pdfText(cellText(value ?? null, kind, 'pdf'));
}

export function renderPdf(report: ReportDocument): Promise<Buffer> {
  const { columnas, filas, totales } = report.tabla;
  const landscape = columnas.length > 6;
  const pdf = new PDFDocument({
    size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: MARGIN, bufferPages: true, autoFirstPage: true, lang: 'es-PE', displayTitle: true,
    info: { Title: pdfText(report.titulo), Author: pdfText(report.institucion), Subject: pdfText(report.descripcion), Creator: pdfText(report.institucion), CreationDate: new Date(report.generado_at) },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', chunk => chunks.push(chunk as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const left = MARGIN.left;
  const width = pdf.page.width - MARGIN.left - MARGIN.right;
  const bottom = () => pdf.page.height - MARGIN.bottom - FOOTER_SPACE;
  let y = 0;

  const band = () => {
    pdf.rect(left, MARGIN.top, width, 24).fill(NAVY);
    pdf.rect(left, MARGIN.top + 24, width, 2).fill(GOLD);
    pdf.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF').text(pdfText(report.institucion.toUpperCase()), left + 10, MARGIN.top + 7, { width: width / 2, lineBreak: false });
    pdf.font('Helvetica').fontSize(8).fillColor(GOLD).text('Reporte académico', left + width / 2, MARGIN.top + 9, { width: width / 2 - 10, align: 'right', lineBreak: false });
    y = MARGIN.top + 34;
  };
  const newPage = () => {
    pdf.addPage();
    band();
    pdf.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(pdfText(report.titulo) + ' (continuación)', left, y, { width, lineBreak: false });
    y += 16;
  };
  const ensure = (height: number) => { if (y + height > bottom()) newPage(); };
  const heading = (text: string) => {
    ensure(40);
    pdf.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(pdfText(text), left, y, { width });
    y = pdf.y + 4;
  };

  // ---------- Portada: título y metadatos ----------
  band();
  pdf.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(pdfText(report.titulo), left, y, { width });
  y = pdf.y + 2;
  pdf.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(pdfText(report.descripcion), left, y, { width });
  y = pdf.y + 6;
  const generated = displayDate(report.generado_local.slice(0, 10)) + report.generado_local.slice(10) + ' (hora de Lima)';
  const meta: [string, string][] = [['Generado el', generated], ['Período', report.periodo.etiqueta],
    ...report.filtros.map(filter => [filter.etiqueta, filter.valor] as [string, string]), ['Filas', String(report.tabla.total_filas)]];
  for (const [label, value] of meta) {
    pdf.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000').text(pdfText(label) + ': ', left, y, { continued: true, width });
    pdf.font('Helvetica').text(pdfText(value));
    y = pdf.y + 1;
  }
  if (report.datos_personales) {
    y += 3;
    pdf.font('Helvetica-Bold').fontSize(8).fillColor('#8A5A00').text('Confidencial: ' + pdfText(PERSONAL_DATA_NOTICE), left, y, { width });
    y = pdf.y;
  }
  y += 10;

  // ---------- Resumen en tarjetas ----------
  heading('Resumen');
  const perRow = landscape ? 4 : 3;
  const cardWidth = (width - (perRow - 1) * 6) / perRow;
  report.resumen.forEach((entry, index) => {
    const column = index % perRow;
    if (column === 0) ensure(38);
    const x = left + column * (cardWidth + 6);
    pdf.rect(x, y, cardWidth, 34).lineWidth(0.6).fillAndStroke(GOLD_LIGHT, GOLD);
    pdf.font('Helvetica').fontSize(7).fillColor(GRAY).text(pdfText(entry.etiqueta), x + 5, y + 4, { width: cardWidth - 10, height: 16, ellipsis: true });
    pdf.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(pdfText(summaryText(entry)), x + 5, y + 20, { width: cardWidth - 10, lineBreak: false });
    if (column === perRow - 1 || index === report.resumen.length - 1) y += 40;
  });
  y += 6;

  // ---------- Tabla ----------
  heading('Detalle: ' + report.tabla.titulo + ' (' + report.tabla.total_filas + ' filas)');
  const totalWeight = columnas.reduce((sum, column) => sum + Math.max(column.ancho, 6), 0);
  const widths = columnas.map(column => (width * Math.max(column.ancho, 6)) / totalWeight);
  const lineHeight = (bold: boolean) => { pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(BODY_SIZE); return pdf.currentLineHeight(true); };
  const rowHeight = (texts: string[], bold: boolean) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(BODY_SIZE);
    const max = lineHeight(bold) * MAX_CELL_LINES;
    return Math.min(max, Math.max(...texts.map((text, i) => text ? pdf.heightOfString(text, { width: widths[i] - 2 * PAD }) : 0), lineHeight(bold))) + 2 * PAD;
  };
  const drawRow = (texts: string[], height: number, options: { fill?: string; bold?: boolean; color?: string; header?: boolean }) => {
    if (options.fill) pdf.rect(left, y, width, height).fill(options.fill);
    let x = left;
    pdf.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(BODY_SIZE).fillColor(options.color ?? '#000000');
    texts.forEach((text, i) => {
      if (text) {
        pdf.text(text, x + PAD, y + PAD, {
          width: widths[i] - 2 * PAD, height: height - 2 * PAD, ellipsis: true,
          align: !options.header && numeric(columnas[i].tipo) ? 'right' : 'left',
        });
      }
      x += widths[i];
    });
    pdf.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(0.4).strokeColor(BORDER).stroke();
    y += height;
  };
  const headerTexts = columnas.map(column => pdfText(column.titulo));
  const header = () => drawRow(headerTexts, rowHeight(headerTexts, true), { fill: NAVY, bold: true, color: '#FFFFFF', header: true });
  ensure(rowHeight(headerTexts, true) + 20);
  header();
  if (!filas.length) {
    pdf.font('Helvetica-Oblique').fontSize(8.5).fillColor(GRAY).text('No hay registros para los filtros seleccionados.', left + PAD, y + 6, { width });
    y = pdf.y + 6;
  }
  filas.forEach((row, index) => {
    const texts = columnas.map(column => displayCell(row[column.clave], column.tipo, false));
    const height = rowHeight(texts, false);
    if (y + height > bottom()) { newPage(); header(); }
    drawRow(texts, height, { fill: index % 2 ? ZEBRA : undefined });
  });
  if (totales) {
    const texts = columnas.map(column => displayCell(totales[column.clave], column.tipo, true));
    const height = rowHeight(texts, true);
    if (y + height > bottom()) { newPage(); header(); }
    drawRow(texts, height, { fill: GOLD_LIGHT, bold: true, color: NAVY });
  }

  // ---------- Notas ----------
  if (report.notas.length) {
    y += 10;
    heading('Notas');
    for (const note of report.notas) {
      ensure(14);
      pdf.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('• ' + pdfText(note), left, y, { width });
      y = pdf.y + 2;
    }
  }

  // ---------- Pie de página en todas las páginas ----------
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    const saved = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0; // escribir en el margen inferior sin que pdfkit cree otra página
    const footerY = pdf.page.height - MARGIN.bottom + 4;
    pdf.moveTo(left, footerY - 4).lineTo(left + width, footerY - 4).lineWidth(0.5).strokeColor(GOLD).stroke();
    const leftText = pdfText(report.institucion) + ' · ' + pdfText(report.titulo) + ' · Generado el ' + generated + (report.datos_personales ? ' · Confidencial' : '');
    pdf.font('Helvetica').fontSize(7).fillColor(GRAY).text(leftText, left, footerY, { width: width * 0.8, lineBreak: false, ellipsis: true });
    pdf.text('Página ' + (i - range.start + 1) + ' de ' + range.count, left + width * 0.8, footerY, { width: width * 0.2, align: 'right', lineBreak: false });
    pdf.page.margins.bottom = saved;
  }
  pdf.end();
  return done;
}
