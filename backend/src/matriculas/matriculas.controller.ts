import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { ConvocatoriaIdDto, CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';
import { AnularMatriculaDto, ConfirmarCumplimientoDto, CreateMatriculaDto, EdicionesMatriculaQueryDto, MatriculasQueryDto, ReactivarMatriculaDto } from './matriculas.dto';
import { MatriculasService } from './matriculas.service';

@ApiTags('Administración de matrículas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/matriculas')
export class MatriculasController {
  constructor(private readonly service: MatriculasService) {}
  @Get() @RequirePermission('matriculas:leer') list(@Query() q: MatriculasQueryDto) { return this.service.list(q); }
  @Get('ediciones') @RequirePermission('matriculas:leer') editions(@Query() q: EdicionesMatriculaQueryDto) { return this.service.editions(q); }
  @Get(':id') @RequirePermission('matriculas:leer') detail(@Param() p: ConvocatoriaIdDto) { return this.service.detail(p.id); }
  @Get(':id/historial') @RequirePermission('matriculas:leer') history(@Param() p: ConvocatoriaIdDto, @Query() q: CursosConvocatoriaQueryDto) { return this.service.history(p.id, q); }
  @Post() @RequirePermission('matriculas:crear') create(@Body() dto: CreateMatriculaDto, @Req() req: { user: { id: number } }) { return this.service.create(dto, req.user.id); }
  @Put(':id/anulacion') @RequirePermission('matriculas:anular') annul(@Param() p: ConvocatoriaIdDto, @Body() dto: AnularMatriculaDto, @Req() req: { user: { id: number } }) { return this.service.annul(p.id, dto, req.user.id); }
  @Put(':id/cumplimiento') @RequirePermission('matriculas:confirmar') confirm(@Param() p: ConvocatoriaIdDto, @Body() dto: ConfirmarCumplimientoDto, @Req() req: { user: { id: number } }) { return this.service.confirm(p.id, dto, req.user.id); }
  @Put(':id/reactivacion') @RequirePermission('matriculas:anular') reactivate(@Param() p: ConvocatoriaIdDto, @Body() dto: ReactivarMatriculaDto, @Req() req: { user: { id: number } }) { return this.service.reactivate(p.id, dto, req.user.id); }
}
