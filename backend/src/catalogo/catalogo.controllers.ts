import { Body, Controller, Get, Post, Put, Delete, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PublicRoute, RequireByField, RequirePermission } from '../permissions/access.decorators';
import { CatalogoService } from './catalogo.service';
import { CatalogoQueryDto, CreateCursoDto, UpdateCursoDto, CreateServicioDto, UpdateServicioDto, CreatePreguntaFrecuenteDto, UpdatePreguntaFrecuenteDto } from './catalogo.dto';

@ApiTags('cursos')
@Controller('cursos')
export class CursoController {
  constructor(private readonly service: CatalogoService) {}
  @Get()
  @ApiOperation({ summary: 'Listar contenido publicado con paginación y búsqueda' })
  @PublicRoute()
  list(@Query() query: CatalogoQueryDto) { return this.service.list('cursos', query, true); }
  @Get(':id')
  @PublicRoute()
  detail(@Param('id', ParseIntPipe) id: number) { return this.service.detail('cursos', id, true); }
}

@ApiTags('Admin - cursos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/cursos')
export class AdminCursoController {
  constructor(private readonly service: CatalogoService) {}
  @Get()
  @RequirePermission('cursos:leer')
  list(@Query() query: CatalogoQueryDto) { return this.service.list('cursos', query); }
  @Get(':id')
  @RequirePermission('cursos:leer')
  detail(@Param('id', ParseIntPipe) id: number) { return this.service.detail('cursos', id); }
  @Post()
  @RequirePermission('cursos:crear')
  create(@Body() dto: CreateCursoDto) { return this.service.create('cursos', dto); }
  @Put(':id')
  @RequireByField('estado', 'cursos:editar', { archivado: 'cursos:archivar' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCursoDto) {
    return this.service.update('cursos', id, dto);
  }
  @Delete(':id')
  @RequirePermission('cursos:eliminar')
  @ApiOperation({ summary: 'Borrado bloqueado (409): conservar el registro y archivar desde Editar mediante PUT' })
  remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove('cursos', id); }
}

@ApiTags('servicios')
@Controller('servicios')
export class ServicioController {
  constructor(private readonly service: CatalogoService) {}
  @Get()
  @ApiOperation({ summary: 'Listar contenido publicado con paginación y búsqueda' })
  @PublicRoute()
  list(@Query() query: CatalogoQueryDto) { return this.service.list('servicios', query, true); }
  @Get(':id')
  @PublicRoute()
  detail(@Param('id', ParseIntPipe) id: number) { return this.service.detail('servicios', id, true); }
}

@ApiTags('Admin - servicios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/servicios')
export class AdminServicioController {
  constructor(private readonly service: CatalogoService) {}
  @Get()
  @RequirePermission('servicios:leer')
  list(@Query() query: CatalogoQueryDto) { return this.service.list('servicios', query); }
  @Get(':id')
  @RequirePermission('servicios:leer')
  detail(@Param('id', ParseIntPipe) id: number) { return this.service.detail('servicios', id); }
  @Post()
  @RequirePermission('servicios:crear')
  create(@Body() dto: CreateServicioDto) { return this.service.create('servicios', dto); }
  @Put(':id')
  @RequirePermission('servicios:editar')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateServicioDto) {
    return this.service.update('servicios', id, dto);
  }
  @Delete(':id')
  @RequirePermission('servicios:eliminar')
  @ApiOperation({ summary: 'Eliminar definitivamente un servicio' })
  remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove('servicios', id); }
}

@ApiTags('preguntas-frecuentes')
@Controller('preguntas-frecuentes')
export class PreguntaFrecuenteController {
  constructor(private readonly service: CatalogoService) {}
  @Get()
  @ApiOperation({ summary: 'Listar contenido publicado con paginación y búsqueda' })
  @PublicRoute()
  list(@Query() query: CatalogoQueryDto) { return this.service.list('preguntas-frecuentes', query, true); }
  @Get(':id')
  @PublicRoute()
  detail(@Param('id', ParseIntPipe) id: number) { return this.service.detail('preguntas-frecuentes', id, true); }
}

@ApiTags('Admin - preguntas-frecuentes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/preguntas-frecuentes')
export class AdminPreguntaFrecuenteController {
  constructor(private readonly service: CatalogoService) {}
  @Get()
  @RequirePermission('preguntas_frecuentes:leer')
  list(@Query() query: CatalogoQueryDto) { return this.service.list('preguntas-frecuentes', query); }
  @Get(':id')
  @RequirePermission('preguntas_frecuentes:leer')
  detail(@Param('id', ParseIntPipe) id: number) { return this.service.detail('preguntas-frecuentes', id); }
  @Post()
  @RequirePermission('preguntas_frecuentes:crear')
  create(@Body() dto: CreatePreguntaFrecuenteDto) { return this.service.create('preguntas-frecuentes', dto); }
  @Put(':id')
  @RequireByField('estado', 'preguntas_frecuentes:editar', { archivado: 'preguntas_frecuentes:archivar' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePreguntaFrecuenteDto) {
    return this.service.update('preguntas-frecuentes', id, dto);
  }
  @Delete(':id')
  @RequirePermission('preguntas_frecuentes:archivar')
  @ApiOperation({ summary: 'Archivar contenido sin borrar su registro' })
  archive(@Param('id', ParseIntPipe) id: number) { return this.service.archive('preguntas-frecuentes', id); }
}
