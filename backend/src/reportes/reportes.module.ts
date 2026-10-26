import { Module } from '@nestjs/common';
import { ReportesExportacionService } from './reportes-exportacion.service';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';

@Module({ controllers: [ReportesController], providers: [ReportesService, ReportesExportacionService] })
export class ReportesModule {}
