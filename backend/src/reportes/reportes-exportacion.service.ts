import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { renderCsv } from './formatos/csv';
import { reportFileName } from './formatos/celdas';
import { renderPdf } from './formatos/pdf';
import { renderXlsx } from './formatos/xlsx';
import { ReporteExportacionDto } from './reportes.dto';
import { MAX_CONCURRENT_EXPORTS } from './reportes.limites';
import { ReportesService } from './reportes.service';
import type { ReportDocument, ReportFormat, ReportType } from './reportes.types';

export interface ExportedReport { buffer: Buffer; contentType: string; fileName: string }

export const FORMAT_INFO: Readonly<Record<ReportFormat, { contentType: string; extension: string; render: (doc: ReportDocument) => Buffer | Promise<Buffer> }>> = Object.freeze({
  csv: { contentType: 'text/csv; charset=utf-8', extension: 'csv', render: renderCsv },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx', render: renderXlsx },
  pdf: { contentType: 'application/pdf', extension: 'pdf', render: renderPdf },
});

// Genera el archivo completo en memoria (acotado por MAX_EXPORT_ROWS) antes de responder: un fallo nunca entrega un archivo a medias.
// Limita las exportaciones simultáneas del proceso para no agotar memoria ni conexiones; la que excede responde 429 sin consultar.
@Injectable()
export class ReportesExportacionService {
  private active = 0;

  constructor(private readonly reportes: ReportesService) {}

  async export(tipo: ReportType, q: ReporteExportacionDto, actorId: number, now = new Date()): Promise<ExportedReport> {
    if (this.active >= MAX_CONCURRENT_EXPORTS) {
      throw new HttpException({ statusCode: 429, message: 'Hay otras exportaciones en curso. Inténtalo de nuevo en unos segundos.', error: 'Too Many Requests' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const { formato, separador, ...filters } = q;
    if (separador !== undefined && formato !== 'csv') throw new BadRequestException('El separador solo se aplica al formato CSV.');
    this.active++;
    try {
      const doc = await this.reportes.exportDocument(tipo, filters, formato, actorId, now);
      const info = FORMAT_INFO[formato];
      const buffer = formato === 'csv' ? renderCsv(doc, separador) : await info.render(doc);
      return { buffer, contentType: info.contentType, fileName: reportFileName(tipo, doc.generado_local, info.extension) };
    } finally {
      this.active--;
    }
  }
}
