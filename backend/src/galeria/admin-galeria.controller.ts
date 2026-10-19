import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GaleriaService } from './galeria.service';
import { CreateGaleriaDto } from './dto/create-galeria.dto';
import { UpdateGaleriaDto } from './dto/update-galeria.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';

import { ListQueryDto } from '../common/list-query.dto';
@ApiTags('Admin - Galería')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/galeria')
export class AdminGaleriaController {
  constructor(private readonly galeriaService: GaleriaService) {}

  @Get()
  @RequirePermission('galeria:leer')
  @ApiOperation({ summary: 'Listar todos los elementos de galería para administración' })
  @ApiQuery({ name: 'categoria', required: false })
  @ApiResponse({ status: 200, description: 'Listado completo para el panel' })
  async findAll(@Query() q: ListQueryDto) {
    return this.galeriaService.findAllAdmin(q.categoria, q);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('galeria:crear')
  @ApiOperation({ summary: 'Crear un nuevo elemento en la galería' })
  @ApiResponse({ status: 201, description: 'Elemento de galería creado' })
  async create(@Body() dto: CreateGaleriaDto) {
    return this.galeriaService.create(dto);
  }

  @Put(':id')
  @RequirePermission('galeria:editar')
  @ApiOperation({ summary: 'Actualizar un elemento de la galería' })
  @ApiResponse({ status: 200, description: 'Elemento actualizado' })
  @ApiResponse({ status: 404, description: 'Elemento no encontrado' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGaleriaDto,
  ) {
    return this.galeriaService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('galeria:eliminar')
  @ApiOperation({ summary: 'Eliminar un elemento de la galería' })
  @ApiResponse({ status: 200, description: 'Elemento eliminado' })
  @ApiResponse({ status: 404, description: 'Elemento no encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.galeriaService.remove(id);
  }
}
