import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { EdicionesMatriculaQueryDto } from '../matriculas/matriculas.dto';
import { ArchivoImportacionDto, ConfirmarImportacionDto, PreviewImportacionDto } from './importaciones.dto';
import { ImportacionesService } from './importaciones.service';

class OperacionDto { @IsUUID('4') id: string; }
@UseGuards(JwtAuthGuard)
@Controller('admin/importaciones')
export class ImportacionesController {
  constructor(private readonly service: ImportacionesService) {}
  @Get('ediciones') @RequirePermission('importaciones:previsualizar') editions(@Query() q: EdicionesMatriculaQueryDto) { return this.service.editions(q); }
  @Post('archivo') @RequirePermission('importaciones:previsualizar') inspect(@Body() dto: ArchivoImportacionDto) { return this.service.inspect(dto); }
  @Post('vista-previa') @RequirePermission('importaciones:previsualizar') preview(@Body() dto: PreviewImportacionDto, @Req() req: { user: { id: number } }) { return this.service.preview(dto, req.user.id); }
  @Post('confirmacion') @RequirePermission('importaciones:aplicar') confirm(@Body() dto: ConfirmarImportacionDto, @Req() req: { user: { id: number } }) { return this.service.confirm(dto, req.user.id); }
  @Get('resultado/:id') @RequirePermission('importaciones:previsualizar') result(@Param() p: OperacionDto) { return this.service.result(p.id); }
}
