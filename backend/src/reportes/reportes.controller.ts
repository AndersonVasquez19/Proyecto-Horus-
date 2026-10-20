import { Controller, Get, Param, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { ReportesExportacionService } from './reportes-exportacion.service';
import { ReporteConsultaDto, ReporteExportacionDto, ReporteTipoDto } from './reportes.dto';
import { ReportesService } from './reportes.service';

// Reportes académicos (solo lectura). Contrato completo: docs/procedimientos/reportes-academicos.md.
@ApiTags('Reportes académicos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService, private readonly exportacion: ReportesExportacionService) {}

  @Get()
  @RequirePermission('reportes_academicos:leer')
  @ApiOperation({ summary: 'Catálogo de reportes, filtros admitidos y qué puede hacer la cuenta actual' })
  catalog(@Req() req: { user: { id: number } }) {
    return this.reportes.catalog(req.user.id);
  }

  @Get(':tipo')
  @RequirePermission('reportes_academicos:leer')
  @ApiOperation({ summary: 'Consultar un reporte (JSON paginado; el resumen y los totales cubren todo el filtro)' })
  preview(@Param() params: ReporteTipoDto, @Query() query: ReporteConsultaDto, @Req() req: { user: { id: number } }) {
    return this.reportes.preview(params.tipo, query, req.user.id);
  }

  @Get(':tipo/exportar')
  @RequirePermission('reportes_academicos:exportar')
  @ApiOperation({ summary: 'Descargar un reporte en CSV, XLSX o PDF con los mismos datos y totales que la consulta' })
  @ApiProduces('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf')
  @ApiResponse({ status: 200, description: 'Archivo adjunto (Content-Disposition: attachment)' })
  async export(
    @Param() params: ReporteTipoDto, @Query() query: ReporteExportacionDto, @Req() req: { user: { id: number } }, @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.exportacion.export(params.tipo, query, req.user.id);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.buffer, { type: file.contentType, disposition: 'attachment; filename="' + file.fileName + '"', length: file.buffer.length });
  }
}
