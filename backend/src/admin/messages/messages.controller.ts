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
import { MessagesService } from './messages.service';
import { CreateAdminMessageDto } from './dto/create-message.dto';
import { UpdateMessageStatusDto } from './dto/update-message-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../permissions/access.decorators';

import { Query } from '@nestjs/common';
import { ListQueryDto } from '../../common/list-query.dto';
@ApiTags('Admin - Mensajes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @RequirePermission('mensajes:leer')
  @ApiOperation({ summary: 'Listar todos los mensajes de contacto' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes obtenida exitosamente' })
  async findAll(@Query() query: ListQueryDto) {
    return this.messagesService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('mensajes:leer')
  @ApiOperation({ summary: 'Obtener un mensaje específico por ID' })
  @ApiResponse({ status: 200, description: 'Detalle del mensaje' })
  @ApiResponse({ status: 404, description: 'Mensaje no encontrado' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.messagesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('mensajes:crear')
  @ApiOperation({ summary: 'Crear un mensaje desde el panel' })
  @ApiResponse({ status: 201, description: 'Mensaje creado exitosamente' })
  async create(@Body() dto: CreateAdminMessageDto) {
    return this.messagesService.create(dto);
  }

  @Put(':id')
  @RequirePermission('mensajes:editar')
  @ApiOperation({ summary: 'Actualizar el estado de un mensaje' })
  @ApiResponse({ status: 200, description: 'Estado actualizado correctamente' })
  @ApiResponse({ status: 404, description: 'Mensaje no encontrado' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMessageStatusDto,
  ) {
    return this.messagesService.updateStatus(id, dto);
  }

  @Delete(':id')
  @RequirePermission('mensajes:eliminar')
  @ApiOperation({ summary: 'Eliminar un mensaje' })
  @ApiResponse({ status: 200, description: 'Mensaje eliminado correctamente' })
  @ApiResponse({ status: 404, description: 'Mensaje no encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.messagesService.remove(id);
  }
}
