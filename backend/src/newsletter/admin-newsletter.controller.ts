import { Controller, Get, Delete, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NewsletterService } from './newsletter.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';

import { Query } from '@nestjs/common';
import { ListQueryDto } from '../common/list-query.dto';
@ApiTags('Admin - Boletín')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/newsletter')
export class AdminNewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Get()
  @RequirePermission('boletin:leer')
  @ApiOperation({ summary: 'Listar todos los suscriptores del boletín' })
  @ApiResponse({ status: 200, description: 'Listado de suscriptores' })
  async findAll(@Query() query: ListQueryDto) {
    return this.newsletterService.findAll(query);
  }

  @Delete(':id')
  @RequirePermission('boletin:eliminar')
  @ApiOperation({ summary: 'Eliminar un suscriptor' })
  @ApiResponse({ status: 200, description: 'Suscriptor eliminado' })
  @ApiResponse({ status: 404, description: 'Suscriptor no encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.newsletterService.remove(id);
  }
}
