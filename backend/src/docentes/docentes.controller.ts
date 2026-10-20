import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { AsignacionesService } from './asignaciones.service';
import { AsignacionesQueryDto, AsignacionIdDto, CreateAsignacionDto, CreateDocenteDto, DocenteAsignacionesQueryDto, DocenteIdDto, DocentesQueryDto, EstadoDocenteDto, ReactivacionAsignacionDto, RetiroAsignacionDto, RolAsignacionDto, SustitucionAsignacionDto, UpdateDocenteDto } from './docentes.dto';
import { DocentesService } from './docentes.service';

type ActorRequest = { user: { id: number } };

@ApiTags('Administración de docentes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/docentes')
export class DocentesController {
  constructor(private readonly service: DocentesService, private readonly assignments: AsignacionesService) {}
  @Get() @RequirePermission('docentes:leer') list(@Query() q: DocentesQueryDto) { return this.service.list(q); }
  @Get(':id') @RequirePermission('docentes:leer') detail(@Param() p: DocenteIdDto) { return this.service.detail(p.id); }
  @Get(':id/asignaciones') @RequirePermission('docentes:leer') assignmentsOf(@Param() p: DocenteIdDto, @Query() q: DocenteAsignacionesQueryDto) { return this.assignments.listByTeacher(p.id, q); }
  @Post() @RequirePermission('docentes:crear') create(@Body() dto: CreateDocenteDto, @Req() req: ActorRequest) { return this.service.create(dto, req.user.id); }
  @Patch(':id') @RequirePermission('docentes:editar') update(@Param() p: DocenteIdDto, @Body() dto: UpdateDocenteDto, @Req() req: ActorRequest) { return this.service.update(p.id, dto, req.user.id); }
  @Put(':id/estado') @RequirePermission('docentes:editar') setActive(@Param() p: DocenteIdDto, @Body() dto: EstadoDocenteDto, @Req() req: ActorRequest) { return this.service.setActive(p.id, dto, req.user.id); }
}

@ApiTags('Administración de docentes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/asignaciones-docentes')
export class AsignacionesDocentesController {
  constructor(private readonly service: AsignacionesService) {}
  @Get() @RequirePermission('docentes:leer') list(@Query() q: AsignacionesQueryDto) { return this.service.list(q); }
  @Get(':id') @RequirePermission('docentes:leer') detail(@Param() p: AsignacionIdDto) { return this.service.detail(p.id); }
  @Post() @RequirePermission('docentes:asignar') create(@Body() dto: CreateAsignacionDto, @Req() req: ActorRequest) { return this.service.create(dto, req.user.id); }
  @Put(':id') @RequirePermission('docentes:asignar') changeRole(@Param() p: AsignacionIdDto, @Body() dto: RolAsignacionDto, @Req() req: ActorRequest) { return this.service.changeRole(p.id, dto, req.user.id); }
  @Put(':id/retiro') @RequirePermission('docentes:asignar') retire(@Param() p: AsignacionIdDto, @Body() dto: RetiroAsignacionDto, @Req() req: ActorRequest) { return this.service.retire(p.id, dto, req.user.id); }
  @Put(':id/reactivacion') @RequirePermission('docentes:asignar') reactivate(@Param() p: AsignacionIdDto, @Body() dto: ReactivacionAsignacionDto, @Req() req: ActorRequest) { return this.service.reactivate(p.id, dto, req.user.id); }
  @Post(':id/sustitucion') @RequirePermission('docentes:asignar') substitute(@Param() p: AsignacionIdDto, @Body() dto: SustitucionAsignacionDto, @Req() req: ActorRequest) { return this.service.substitute(p.id, dto, req.user.id); }
}
