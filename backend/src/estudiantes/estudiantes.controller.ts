import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { ArchivoEstudianteDto, CreateEstudianteDto, EstudianteIdDto, EstudiantesQueryDto, UpdateEstudianteDto } from './estudiantes.dto';
import { EstudiantesService } from './estudiantes.service';

@ApiTags('Administración de estudiantes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/estudiantes')
export class EstudiantesController {
  constructor(private readonly service: EstudiantesService) {}
  @Get() @RequirePermission('estudiantes:leer') list(@Query() q: EstudiantesQueryDto) { return this.service.list(q); }
  @Get(':id') @RequirePermission('estudiantes:leer') detail(@Param() params: EstudianteIdDto) { return this.service.detail(params.id); }
  @Post() @RequirePermission('estudiantes:crear') create(@Body() dto: CreateEstudianteDto) { return this.service.create(dto); }
  @Put(':id') @RequirePermission('estudiantes:editar') update(@Param() params: EstudianteIdDto, @Body() dto: UpdateEstudianteDto) { return this.service.update(params.id, dto); }
  @Put(':id/archivo') @RequirePermission('estudiantes:archivar') archive(@Param() params: EstudianteIdDto, @Body() dto: ArchivoEstudianteDto) { return this.service.archive(params.id, dto); }
}
