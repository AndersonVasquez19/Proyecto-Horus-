import PDFDocument = require('pdfkit');
import { INSTITUTION, limaDateTime, longDate } from '../common/pdf-format';
import { pdfText } from '../reportes/formatos/pdf';
import { limaToday } from './quote-rules';

// Cotización en PDF: A4 vertical, fuentes estándar (sin archivos de fuentes), varias páginas si hace falta y SIN escribir nada en disco.
// - Solo muestra lo que el sistema registró: nunca inventa precios, impuestos, condiciones, firmas, sellos ni datos del emisor.
// - Es el documento para el cliente: NO lleva historial, revisiones, intentos de correo, usuarios internos, correo ni teléfono del cliente.
// - Identifica al cliente con nombre, documento y dirección (si constan). Los importes se leen tal como están guardados.
// - Un borrador o una cotización anulada NO pueden parecer vigentes: insignia de estado y marca de agua diagonal.

export interface QuotePdfData {
  numero: string;
  estado: string;
  /** Enviada con la vigencia ya pasada (indicador derivado, no un estado guardado). */
  vencida: boolean;
  cliente: string;
  documento: string;
  direccion: string;
  emisor: string;
  datos_emisor: string;
  moneda: string;
  /** DATE guardado, como YYYY-MM-DD. */
  validez: string;
  condiciones: string;
  conceptos: unknown;
  subtotal: string | number;
  descuento: string | number;
  tasa: string | number;
  impuesto: string | number;
  total: string | number;
  createdAt: Date;
}
export interface QuotePdfOptions { /** Momento de generación mostrado en el pie. */ generatedAt?: Date }

const NAVY = '#0A2540', GOLD = '#C9A961', GOLD_LIGHT = '#F3EDE0', ZEBRA = '#F5F7FA', GRAY = '#555555', BORDER = '#D5DAE1', RED = '#B42318', GREEN = '#1B6E3C', AMBER = '#8A5A00', MUTED = '#6B7280';
const MARGIN = { top: 84, bottom: 56, left: 40, right: 40 };
const CURRENCIES: Record<string, { name: string; symbol: string }> = { PEN: { name: 'Soles', symbol: 'S/' }, USD: { name: 'Dólares estadounidenses', symbol: 'US$' } };
const STATUS: Record<string, { label: string; color: string }> = {
  borrador: { label: 'BORRADOR', color: MUTED }, enviada: { label: 'ENVIADA', color: NAVY }, aceptada: { label: 'ACEPTADA', color: GREEN },
  rechazada: { label: 'RECHAZADA', color: RED }, anulada: { label: 'ANULADA', color: RED },
};

// Importe con separador de miles y dos decimales, sin pasar por coma flotante cuando el valor ya es el texto exacto de la base.
export function money(value: string | number): string {
  const text = typeof value === 'number' ? value.toFixed(2) : String(value);
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) return '—';
  return match[1] + match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (match[3] ?? '').padEnd(2, '0').slice(0, 2);
}
const dateText = (iso: string) => longDate(new Date(iso + 'T00:00:00Z'));

interface Line { descripcion: string; cantidad: string; precio: string; importe: string }
// `conceptos` es JSON libre en la base: se lee con tolerancia y lo que no sea legible se muestra como «—», nunca se inventa.
function readLines(raw: unknown): Line[] {
  if (!Array.isArray(raw)) return [];
  const number = (value: unknown, format: (n: number) => string) => typeof value === 'number' && Number.isFinite(value) ? format(value) : '—';
  return raw.map(item => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return { descripcion: typeof row.descripcion === 'string' && row.descripcion.trim() ? pdfText(row.descripcion) : '—',
      cantidad: number(row.cantidad, n => String(n)), precio: number(row.precio, money), importe: number(row.importe, money) };
  });
}

export function renderQuotePdf(data: QuotePdfData, options: QuotePdfOptions = {}): Promise<Buffer> {
  const generatedAt = options.generatedAt ?? new Date();
  const status = STATUS[data.estado] ?? { label: pdfText(String(data.estado).toUpperCase()), color: MUTED };
  const badge = data.estado === 'enviada' && data.vencida ? { label: 'ENVIADA - VIGENCIA VENCIDA', color: AMBER } : status;
  const currency = CURRENCIES[data.moneda] ?? { name: pdfText(data.moneda), symbol: pdfText(data.moneda) };
  const lines = readLines(data.conceptos);

  const pdf = new PDFDocument({
    size: 'A4', margins: MARGIN, bufferPages: true, autoFirstPage: false, lang: 'es-PE', displayTitle: true,
    info: { Title: pdfText('Cotización ' + data.numero), Author: INSTITUTION, Creator: INSTITUTION, Subject: pdfText('Cotización para ' + data.cliente), CreationDate: generatedAt },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', chunk => chunks.push(chunk as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const left = MARGIN.left;
  const width = 595.28 - MARGIN.left - MARGIN.right;
  const bottom = () => pdf.page.height - MARGIN.bottom;
  let y = MARGIN.top;

  // Cabecera institucional: se dibuja en CADA página (también las que crea pdfkit al fluir un texto largo).
  pdf.on('pageAdded', () => {
    pdf.rect(left, 30, width, 28).fill(NAVY);
    pdf.rect(left, 58, width, 2.5).fill(GOLD);
    pdf.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text(pdfText(INSTITUTION.toUpperCase()), left + 12, 39, { width: width / 2, lineBreak: false });
    pdf.font('Helvetica').fontSize(9).fillColor(GOLD).text('COTIZACIÓN', left + width / 2, 41, { width: width / 2 - 12, align: 'right', lineBreak: false });
    y = MARGIN.top;
  });
  pdf.addPage();

  const ensure = (height: number) => { if (y + height > bottom()) pdf.addPage(); };
  const heading = (text: string) => {
    ensure(48);
    pdf.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(pdfText(text), left, y, { width, lineBreak: false });
    pdf.moveTo(left, y + 15).lineTo(left + width, y + 15).lineWidth(0.8).strokeColor(GOLD).stroke();
    y += 22;
  };

  // ---- Título, número y estado ----
  pdf.font('Helvetica').fontSize(9).fillColor(GRAY).text('Cotización', left, y, { width: width * 0.6, lineBreak: false });
  pdf.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text(pdfText(data.numero), left, y + 12, { width: width * 0.62, lineBreak: false, ellipsis: true });
  pdf.font('Helvetica-Bold').fontSize(9);
  const badgeWidth = Math.min(width * 0.38, pdf.widthOfString(badge.label) + 24);
  pdf.roundedRect(left + width - badgeWidth, y + 4, badgeWidth, 22, 4).fill(badge.color);
  pdf.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF').text(badge.label, left + width - badgeWidth, y + 11, { width: badgeWidth, align: 'center', lineBreak: false });
  y += 46;

  // ---- Fechas y moneda (tarjetas) ----
  const cardWidth = (width - 12) / 3;
  const cards: [string, string][] = [['Fecha de elaboración', dateText(limaToday(data.createdAt))], ['Válida hasta', dateText(data.validez)], ['Moneda', currency.name + ' (' + pdfText(data.moneda) + ')']];
  cards.forEach(([label, value], i) => {
    const x = left + i * (cardWidth + 6);
    pdf.rect(x, y, cardWidth, 40).lineWidth(0.6).fillAndStroke(GOLD_LIGHT, GOLD);
    pdf.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(label, x + 8, y + 7, { width: cardWidth - 16, lineBreak: false });
    pdf.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(pdfText(value), x + 8, y + 21, { width: cardWidth - 16, lineBreak: false, ellipsis: true });
  });
  y += 54;

  // ---- Cliente y emisor ----
  const boxWidth = (width - 14) / 2;
  const block = (title: string, rows: [string | null, string][]) => {
    const heights = rows.map(([label, text], index) => {
      pdf.font(index === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(index === 0 ? 11 : 9);
      return pdf.heightOfString(label ? label + ': ' + text : text, { width: boxWidth - 20 }) + 3;
    });
    return { title, rows, height: 30 + heights.reduce((sum, h) => sum + h, 0) };
  };
  const clientLines: [string | null, string][] = [[null, pdfText(data.cliente)]];
  if (data.documento) clientLines.push(['Documento', pdfText(data.documento)]);
  if (data.direccion) clientLines.push(['Dirección', pdfText(data.direccion)]);
  const issuerLines: [string | null, string][] = [[null, pdfText(data.emisor)]];
  if (data.datos_emisor) issuerLines.push([null, pdfText(data.datos_emisor)]);
  const blocks = [block('CLIENTE', clientLines), block('EMISOR', issuerLines)];
  const blockHeight = Math.max(...blocks.map(b => b.height));
  ensure(blockHeight + 10);
  blocks.forEach((b, i) => {
    const x = left + i * (boxWidth + 14);
    pdf.rect(x, y, boxWidth, blockHeight).lineWidth(0.6).strokeColor(BORDER).stroke();
    pdf.rect(x, y, boxWidth, 3).fill(NAVY);
    pdf.font('Helvetica-Bold').fontSize(8).fillColor(GOLD).text(b.title, x + 10, y + 12, { width: boxWidth - 20, lineBreak: false });
    let ty = y + 26;
    b.rows.forEach(([label, text], index) => {
      const first = index === 0;
      pdf.font(first ? 'Helvetica-Bold' : 'Helvetica').fontSize(first ? 11 : 9).fillColor(first ? '#000000' : GRAY);
      const content = label ? label + ': ' + text : text;
      pdf.text(content, x + 10, ty, { width: boxWidth - 20 });
      ty = pdf.y + 3;
    });
  });
  y += blockHeight + 18;

  // ---- Detalle de servicios ----
  heading('Detalle de la propuesta');
  const W = { cant: 52, precio: 88, importe: 92 };
  const descWidth = width - W.cant - W.precio - W.importe;
  const PAD = 5, SIZE = 9;
  const cellX = [left, left + descWidth, left + descWidth + W.cant, left + descWidth + W.cant + W.precio];
  const cellW = [descWidth, W.cant, W.precio, W.importe];
  const header = () => {
    pdf.rect(left, y, width, 20).fill(NAVY);
    pdf.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
    ['Servicio / descripción', 'Cant.', 'P. unitario (' + currency.symbol + ')', 'Importe (' + currency.symbol + ')'].forEach((label, i) =>
      pdf.text(pdfText(label), cellX[i] + PAD, y + 6, { width: cellW[i] - 2 * PAD, align: i === 0 ? 'left' : 'right', lineBreak: false }));
    y += 20;
  };
  ensure(60);
  header();
  if (!lines.length) {
    pdf.font('Helvetica-Oblique').fontSize(9).fillColor(GRAY).text('No hay conceptos registrados.', left + PAD, y + 7, { width: width - 2 * PAD, lineBreak: false });
    y += 24;
  }
  lines.forEach((line, index) => {
    pdf.font('Helvetica').fontSize(SIZE);
    const height = Math.max(pdf.heightOfString(line.descripcion, { width: descWidth - 2 * PAD }), pdf.currentLineHeight(true)) + 2 * PAD;
    if (y + height > bottom()) { pdf.addPage(); header(); }
    if (index % 2) pdf.rect(left, y, width, height).fill(ZEBRA);
    pdf.font('Helvetica').fontSize(SIZE).fillColor('#000000');
    pdf.text(line.descripcion, cellX[0] + PAD, y + PAD, { width: descWidth - 2 * PAD });
    [line.cantidad, line.precio, line.importe].forEach((text, i) =>
      pdf.text(text, cellX[i + 1] + PAD, y + PAD, { width: cellW[i + 1] - 2 * PAD, align: 'right', lineBreak: false }));
    pdf.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(0.4).strokeColor(BORDER).stroke();
    y += height;
  });
  y += 12;

  // ---- Totales (tal como están guardados; no se recalculan) ----
  const totals: [string, string, boolean][] = [['Subtotal', money(data.subtotal), false]];
  if (Number(data.descuento) > 0) totals.push(['Descuento', '- ' + money(data.descuento), false]);
  if (Number(data.tasa) > 0 || Number(data.impuesto) > 0) totals.push(['Impuesto (tasa ' + money(data.tasa) + ' %)', money(data.impuesto), false]);
  totals.push(['TOTAL (' + pdfText(data.moneda) + ')', currency.symbol + ' ' + money(data.total), true]);
  const totalsWidth = 250, totalsX = left + width - totalsWidth, rowH = 20;
  ensure(totals.length * rowH + 14);
  totals.forEach(([label, value, strong]) => {
    if (strong) pdf.rect(totalsX, y, totalsWidth, rowH + 2).fill(NAVY);
    pdf.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11 : 9.5).fillColor(strong ? '#FFFFFF' : '#000000');
    pdf.text(label, totalsX + 10, y + (strong ? 6 : 5), { width: totalsWidth * 0.55, lineBreak: false });
    pdf.text(value, totalsX + totalsWidth * 0.5, y + (strong ? 6 : 5), { width: totalsWidth * 0.5 - 10, align: 'right', lineBreak: false });
    if (!strong) pdf.moveTo(totalsX, y + rowH).lineTo(totalsX + totalsWidth, y + rowH).lineWidth(0.4).strokeColor(BORDER).stroke();
    y += rowH + (strong ? 2 : 0);
  });
  y += 18;

  // ---- Condiciones y observaciones: solo el texto registrado; el estado se explica con lo que ya consta ----
  const notes: string[] = [];
  if (data.estado === 'borrador') notes.push('Esta cotización es un borrador: aún no ha sido emitida y su contenido puede cambiar.');
  if (data.estado === 'anulada') notes.push('Esta cotización fue anulada y no tiene validez.');
  if (data.estado === 'rechazada') notes.push('Se registró que esta propuesta fue rechazada.');
  if (data.estado === 'enviada' && data.vencida) notes.push('La vigencia de esta propuesta venció el ' + dateText(data.validez) + '.');
  if (data.condiciones.trim() || notes.length) {
    heading('Condiciones y observaciones');
    for (const note of notes) {
      pdf.font('Helvetica-Bold').fontSize(9).fillColor(badge.color).text(pdfText(note), left, y, { width });
      y = pdf.y + 6;
    }
    if (data.condiciones.trim()) {
      // El texto largo fluye solo a otra página; la cabecera y la posición inicial las reponen 'pageAdded' y el margen superior.
      pdf.font('Helvetica').fontSize(9.5).fillColor('#000000').text(pdfText(data.condiciones.trim()), left, y, { width, lineGap: 2 });
      y = pdf.y + 6;
    }
  }

  // ---- Marca de agua y pie en todas las páginas ----
  const range = pdf.bufferedPageRange();
  const watermark = data.estado === 'anulada' ? { text: 'ANULADA', color: RED } : data.estado === 'borrador' ? { text: 'BORRADOR', color: MUTED } : null;
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    const saved = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0; // escribir en el margen inferior sin que pdfkit cree otra página
    if (watermark) {
      pdf.save();
      pdf.opacity(0.1).rotate(-35, { origin: [pdf.page.width / 2, pdf.page.height / 2] });
      pdf.font('Helvetica-Bold').fontSize(84).fillColor(watermark.color).text(watermark.text, 0, pdf.page.height / 2 - 44, { width: pdf.page.width, align: 'center', lineBreak: false });
      pdf.restore();
    }
    const footerY = pdf.page.height - 42;
    pdf.moveTo(left, footerY - 6).lineTo(left + width, footerY - 6).lineWidth(0.5).strokeColor(GOLD).stroke();
    pdf.font('Helvetica').fontSize(7.5).fillColor(GRAY)
      .text(pdfText(INSTITUTION) + ' · Cotización ' + pdfText(data.numero) + ' · Generado el ' + limaDateTime(generatedAt), left, footerY, { width: width * 0.8, lineBreak: false });
    pdf.text('Estado de la cotización al generar este documento: ' + status.label.toLowerCase(), left, footerY + 10, { width: width * 0.8, lineBreak: false });
    pdf.text('Página ' + (i - range.start + 1) + ' de ' + range.count, left + width * 0.8, footerY, { width: width * 0.2, align: 'right', lineBreak: false });
    pdf.page.margins.bottom = saved;
  }
  pdf.end();
  return done;
}
