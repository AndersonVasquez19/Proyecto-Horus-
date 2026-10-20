import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { CreateSesionDto, EdicionSesionesQueryDto, EstadoSesionDto, SesionesQueryDto, SesionIdDto, UpdateSesionDto } from './sesiones.dto';
import { SesionesService } from './sesiones.service';

type ActorRequest = { user: { id: number } };

// Horarios y sesiones académicas. Permisos del recurso `sesiones` (ya existente en la matriz): leer, crear y editar. Editar incluye
// reprogramar y cambiar de estado (realizada, cancelada, reabrir). No hay DELETE: una sesión se cancela y se conserva.
@ApiTags('Administración de sesiones académicas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/sesiones')
export class SesionesController {
  constructor(private readonly service: SesionesService) {}
  @Get() @RequirePermission('sesiones:leer') list(@Query() q: SesionesQueryDto) { return this.service.list(q); }
  @Get(':id') @RequirePermission('sesiones:leer') detail(@Param() p: SesionIdDto) { return this.service.detail(p.id); }
  @Post() @RequirePermission('sesiones:crear') create(@Body() dto: CreateSesionDto, @Req() req: ActorRequest) { return this.service.create(dto, req.user.id); }
  @Patch(':id') @RequirePermission('sesiones:editar') update(@Param() p: SesionIdDto, @Body() dto: UpdateSesionDto, @Req() req: ActorRequest) { return this.service.update(p.id, dto, req.user.id); }
  @Put(':id/estado') @RequirePermission('sesiones:editar') setState(@Param() p: SesionIdDto, @Body() dto: EstadoSesionDto, @Req() req: ActorRequest) { return this.service.changeState(p.id, dto, req.user.id); }
}

// Consulta por edición (calendario de una edición). Misma lista que GET /admin/sesiones?convocatoria_id=, pero responde 404 si la
// edición no existe en lugar de una lista vacía. Va bajo el recurso de ediciones (`convocatorias`), como se llama en la API.
@ApiTags('Administración de sesiones académicas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/convocatorias')
export class EdicionSesionesController {
  constructor(private readonly service: SesionesService) {}
  @Get(':id/sesiones') @RequirePermission('sesiones:leer') list(@Param() p: SesionIdDto, @Query() q: EdicionSesionesQueryDto) { return this.service.listByEdition(p.id, q); }
}
