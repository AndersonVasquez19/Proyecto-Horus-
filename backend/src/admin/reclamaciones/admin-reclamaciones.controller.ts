import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminReclamacionesService } from './admin-reclamaciones.service';
import { QueryReclamacionesDto } from './dto/query-reclamaciones.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../permissions/access.decorators';

@ApiTags('Admin - Reclamaciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/reclamaciones')
export class AdminReclamacionesController {
  constructor(private readonly service: AdminReclamacionesService) {}

  @Get()
  @RequirePermission('reclamaciones:leer')
  @ApiOperation({ summary: 'Listar reclamaciones y quejas registradas' })
  @ApiResponse({ status: 200, description: 'Listado obtenido exitosamente' })
  async findAll(@Query() query: QueryReclamacionesDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermission('reclamaciones:leer')
  @ApiOperation({ summary: 'Ver detalle de una reclamación por ID' })
  @ApiResponse({ status: 200, description: 'Detalle de la reclamación' })
  @ApiResponse({ status: 404, description: 'Reclamación no encontrada' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Delete(':id')
  @RequirePermission('reclamaciones:eliminar')
  @ApiOperation({ summary: 'Eliminar una reclamación' })
  @ApiResponse({ status: 200, description: 'Reclamación eliminada exitosamente' })
  @ApiResponse({ status: 404, description: 'Reclamación no encontrada' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
