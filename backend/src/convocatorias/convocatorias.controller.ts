import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { ArchivoConvocatoriaDto, CierreConvocatoriaDto, ConvocatoriaIdDto, ConvocatoriasQueryDto, CreateConvocatoriaDto, CursosConvocatoriaQueryDto, RecepcionPreinscripcionDto, RevisionConvocatoriaDto, UpdateConvocatoriaDto } from './convocatorias.dto';
import { ConvocatoriasService } from './convocatorias.service';

type ActorRequest = { user: { id: number } };
@ApiTags('Administración de ediciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/convocatorias')
export class ConvocatoriasController {
  constructor(private readonly service: ConvocatoriasService) {}
  @Get() @RequirePermission('convocatorias:leer') list(@Query() q: ConvocatoriasQueryDto) { return this.service.list(q); }
  @Get('cursos') @RequirePermission('convocatorias:leer') courses(@Query() q: CursosConvocatoriaQueryDto) { return this.service.courses(q); }
  @Get(':id') @RequirePermission('convocatorias:leer') detail(@Param() p: ConvocatoriaIdDto) { return this.service.detail(p.id); }
  @Post() @RequirePermission('convocatorias:crear') create(@Body() dto: CreateConvocatoriaDto, @Req() req: ActorRequest) { return this.service.create(dto, req.user.id); }
  @Put(':id') @RequirePermission('convocatorias:editar') update(@Param() p: ConvocatoriaIdDto, @Body() dto: UpdateConvocatoriaDto, @Req() req: ActorRequest) { return this.service.update(p.id, dto, req.user.id); }
  @Put(':id/apertura') @RequirePermission('convocatorias:editar') open(@Param() p: ConvocatoriaIdDto, @Body() dto: RevisionConvocatoriaDto, @Req() req: ActorRequest) { return this.service.open(p.id, dto.revision, req.user.id); }
  @Put(':id/preinscripcion') @RequirePermission('convocatorias:editar') setReception(@Param() p: ConvocatoriaIdDto, @Body() dto: RecepcionPreinscripcionDto, @Req() req: ActorRequest) { return this.service.setReception(p.id, dto, req.user.id); }
  @Put(':id/cierre') @RequirePermission('convocatorias:cerrar') close(@Param() p: ConvocatoriaIdDto, @Body() dto: CierreConvocatoriaDto, @Req() req: ActorRequest) { return this.service.close(p.id, dto, req.user.id); }
  @Put(':id/archivo') @RequirePermission('convocatorias:archivar') archive(@Param() p: ConvocatoriaIdDto, @Body() dto: ArchivoConvocatoriaDto, @Req() req: ActorRequest) { return this.service.archive(p.id, dto, req.user.id); }
}
