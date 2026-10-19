import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../permissions/access.decorators';

import { Query } from '@nestjs/common';
import { ListQueryDto } from '../../common/list-query.dto';
@ApiTags('Admin - Items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @RequirePermission('items:leer')
  @ApiOperation({ summary: 'Listar todos los elementos' })
  async findAll(@Query() query: ListQueryDto) {
    return this.itemsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('items:leer')
  @ApiOperation({ summary: 'Obtener un elemento por ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.itemsService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('items:crear')
  @ApiOperation({ summary: 'Crear un nuevo elemento' })
  async create(@Body() dto: CreateItemDto) {
    return this.itemsService.create(dto);
  }

  @Put(':id')
  @RequirePermission('items:editar')
  @ApiOperation({ summary: 'Actualizar un elemento' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateItemDto) {
    return this.itemsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('items:eliminar')
  @ApiOperation({ summary: 'Eliminar un elemento' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.itemsService.remove(id);
  }
}
