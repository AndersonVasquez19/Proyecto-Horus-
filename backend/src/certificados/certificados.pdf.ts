import PDFDocument = require('pdfkit');
import { pdfText } from '../reportes/formatos/pdf';
import { encodeQr } from './certificados.qr';

// Certificado en PDF: una sola página A4 horizontal, fuentes estándar (sin archivos de fuentes) y QR vectorial.
// - Solo lleva lo imprescindible: nombre, curso, edición, fechas, código y estado. NUNCA el DNI ni el motivo de una anulación.
// - No inventa firmas, sellos, autoridades ni acreditaciones: solo afirma lo que el sistema registró (cumplimiento confirmado).
// - Un certificado anulado NO puede parecer vigente: banner, marca de agua diagonal y paleta gris, pero el QR se conserva para que
//   la verificación pública responda «no válido».

export interface CertificatePdfData {
  estado: 'vigente' | 'anulado' | string;
  sustituido: boolean;
  estudiante_nombres: string;
  estudiante_apellidos: string;
  curso_titulo: string;
  curso_tipo: 'curso' | 'capacitacion' | string;
  curso_duracion: string | null;
  convocatoria_nombre: string;
  convocatoria_fecha_inicio: Date | null;
  convocatoria_fecha_fin: Date | null;
  emitido_at: Date;
  codigo_verificacion: string;
}
export interface CertificatePdfOptions {
  /** Dirección completa que codifica el QR (ya validada por certificados.config). */
  verificationUrl: string;
  /** Momento de generación mostrado en el documento. */
  generatedAt?: Date;
}

export const INSTITUTION = 'Horus Group SRL';
const NAVY = '#0A2540', GOLD = '#C9A961', GRAY = '#555555', LIGHT_GRAY = '#9AA0A6', RED = '#B42318';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Las fechas de edición son DATE (medianoche UTC): se leen en UTC para no retroceder un día con la zona horaria.
export function longDate(value: Date): string {
  return value.getUTCDate() + ' de ' + MONTHS[value.getUTCMonth()] + ' de ' + value.getUTCFullYear();
}
// Instantes (emisión, generación): se muestran en hora de Lima.
export function limaDateTime(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(value).map(part => [part.type, part.value]));
  return parts.day + '/' + parts.month + '/' + parts.year + ' ' + parts.hour + ':' + parts.minute + ' (hora de Lima)';
}
function limaDate(value: Date): string {
  return limaDateTime(value).slice(0, 10);
}

export function datesLine(start: Date | null, end: Date | null): string | null {
  if (start && end) return 'Del ' + longDate(start) + ' al ' + longDate(end);
  if (start) return 'Desde el ' + longDate(start);
  if (end) return 'Hasta el ' + longDate(end);
  return null;
}

export function renderCertificatePdf(data: CertificatePdfData, options: CertificatePdfOptions): Promise<Buffer> {
  const annulled = data.estado !== 'vigente';
  const generatedAt = options.generatedAt ?? new Date();
  const primary = annulled ? GRAY : NAVY, accent = annulled ? LIGHT_GRAY : GOLD;
  const fullName = pdfText((data.estudiante_nombres + ' ' + data.estudiante_apellidos).trim());
  const courseKind = data.curso_tipo === 'capacitacion' ? 'de la capacitación' : 'del curso';

  const pdf = new PDFDocument({
    size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: true, lang: 'es-PE', displayTitle: true,
    info: {
      Title: pdfText('Certificado ' + (annulled ? '(ANULADO) ' : '') + '- ' + fullName), Author: INSTITUTION, Creator: INSTITUTION,
      Subject: pdfText(data.curso_titulo), CreationDate: generatedAt,
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', chunk => chunks.push(chunk as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const W = pdf.page.width, H = pdf.page.height, MID = W / 2;
  const left = 70, width = W - 140;

  // Texto que reduce su tamaño hasta caber en `maxLines` líneas (mínimo `min`); si aun así no cabe, se corta con puntos suspensivos.
  const fitted = (text: string, font: string, max: number, min: number, boxWidth: number, maxLines: number) => {
    let size = max;
    pdf.font(font);
    for (; size > min; size -= 1) { pdf.fontSize(size); if (pdf.heightOfString(text, { width: boxWidth }) <= pdf.currentLineHeight(true) * maxLines + 0.5) break; }
    pdf.fontSize(size);
    return { size, height: Math.min(pdf.heightOfString(text, { width: boxWidth }), pdf.currentLineHeight(true) * maxLines) };
  };
  const centered = (text: string, y: number, font: string, max: number, min: number, color: string, maxLines = 1, boxWidth = width) => {
    const { height } = fitted(text, font, max, min, boxWidth, maxLines);
    pdf.fillColor(color).text(text, (W - boxWidth) / 2, y, { width: boxWidth, align: 'center', height: pdf.currentLineHeight(true) * maxLines, ellipsis: true });
    return y + height;
  };

  // Marco doble.
  pdf.lineWidth(2.5).strokeColor(primary).rect(22, 22, W - 44, H - 44).stroke();
  pdf.lineWidth(0.8).strokeColor(accent).rect(29, 29, W - 58, H - 58).stroke();

  let y = 48;
  if (annulled) {
    pdf.rect(36, y - 6, W - 72, 26).fill(RED);
    pdf.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF')
      .text(data.sustituido ? 'CERTIFICADO ANULADO - SUSTITUIDO POR OTRO - SIN VALIDEZ' : 'CERTIFICADO ANULADO - SIN VALIDEZ', 36, y + 1, { width: W - 72, align: 'center', lineBreak: false });
    y += 30;
  }

  y = centered(pdfText(INSTITUTION.toUpperCase()), y + 4, 'Helvetica-Bold', 22, 22, primary) + 8;
  pdf.moveTo(MID - 60, y).lineTo(MID + 60, y).lineWidth(1.5).strokeColor(accent).stroke();
  y += 14;
  y = centered('CERTIFICADO', y, 'Helvetica-Bold', 38, 38, primary) + 8;
  y = centered('Se certifica que', y, 'Helvetica', 13, 13, GRAY) + 12;

  y = centered(fullName, y, 'Helvetica-Bold', 30, 14, annulled ? GRAY : '#000000', 2, width - 40) + 6;
  pdf.moveTo(left + 60, y).lineTo(W - left - 60, y).lineWidth(0.8).strokeColor(accent).stroke();
  y += 12;

  y = centered('cumplió con los requisitos ' + courseKind, y, 'Helvetica', 13, 13, GRAY) + 8;
  y = centered(pdfText(data.curso_titulo), y, 'Helvetica-Bold', 22, 12, primary, 2, width - 40) + 10;

  const details = [pdfText('Edición: ' + data.convocatoria_nombre), data.curso_duracion ? pdfText('Duración: ' + data.curso_duracion) : null,
    datesLine(data.convocatoria_fecha_inicio, data.convocatoria_fecha_fin)].filter((line): line is string => line !== null);
  for (const line of details) y = centered(line, y, 'Helvetica', 11.5, 8, GRAY, 1) + 1;

  // ---- Zona inferior: emisión y estado (izquierda), código y QR (derecha) ----
  // La zona arranca en su posición habitual, pero nunca por encima del final del bloque de fechas: con nombre y curso de dos líneas
  // (sobre todo con el banner de anulado, que consume 34 pt) las fechas llegaban a pisar la fecha de emisión y el estado.
  const qrSize = 104, qrX = W - left - qrSize, qrY = Math.max(H - 60 - qrSize - 14, y + 8);
  const blockY = qrY;
  const textWidth = qrX - left - 24;
  pdf.font('Helvetica').fontSize(9.5).fillColor(GRAY).text('Emitido el ' + pdfText(limaDate(data.emitido_at)), left, blockY, { width: textWidth, lineBreak: false });
  pdf.font('Helvetica-Bold').fontSize(9.5).fillColor(annulled ? RED : primary)
    .text('Estado al generar este documento: ' + (annulled ? 'ANULADO' : 'VIGENTE') + ' (' + limaDateTime(generatedAt) + ')', left, blockY + 15, { width: textWidth, lineBreak: false });
  pdf.font('Helvetica').fontSize(8.5).fillColor(GRAY)
    .text('El estado vigente de un certificado solo se confirma en la dirección de verificación. Este documento no incluye firmas ni sellos: su autenticidad se comprueba en línea con el código o el QR.',
      left, blockY + 34, { width: textWidth });
  const afterNote = pdf.y;
  pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(primary).text('Código de verificación', left, afterNote + 8, { width: textWidth, lineBreak: false });
  pdf.font('Courier-Bold').fontSize(14).fillColor(annulled ? GRAY : '#000000').text(data.codigo_verificacion, left, pdf.y + 2, { width: textWidth, lineBreak: false });
  pdf.font('Helvetica').fontSize(8).fillColor(GRAY).text(pdfText(options.verificationUrl), left, pdf.y + 4, { width: textWidth, lineBreak: true });

  // QR: módulos oscuros como rectángulos (se unen los consecutivos de una fila); zona de silencio de 4 módulos.
  const matrix = encodeQr(options.verificationUrl);
  const quiet = 4, cell = qrSize / (matrix.length + 2 * quiet);
  pdf.rect(qrX, qrY, qrSize, qrSize).fill('#FFFFFF');
  pdf.fillColor('#000000');
  matrix.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (!row[c]) continue;
      let end = c;
      while (end + 1 < row.length && row[end + 1]) end++;
      pdf.rect(qrX + (c + quiet) * cell, qrY + (r + quiet) * cell, (end - c + 1) * cell, cell).fill();
      c = end;
    }
  });
  pdf.font('Helvetica').fontSize(8).fillColor(GRAY).text('Escanee para verificar', qrX - 10, qrY + qrSize + 2, { width: qrSize + 20, align: 'center', lineBreak: false });

  // Marca de agua diagonal (después de todo el contenido, para quedar por encima y legible).
  if (annulled) {
    pdf.save();
    pdf.opacity(0.16).rotate(-28, { origin: [MID, H / 2] });
    pdf.font('Helvetica-Bold').fontSize(130).fillColor(RED).text('ANULADO', 0, H / 2 - 70, { width: W, align: 'center', lineBreak: false });
    pdf.restore();
  }
  pdf.end();
  return done;
}
