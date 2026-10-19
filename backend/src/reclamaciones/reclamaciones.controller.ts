import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReclamacionesService } from './reclamaciones.service';
import { CreateReclamacionDto } from './dto/create-reclamacion.dto';
import { PublicRoute } from '../permissions/access.decorators';

@ApiTags('Reclamaciones')
@Controller('reclamaciones')
export class ReclamacionesController {
  constructor(private readonly reclamacionesService: ReclamacionesService) {}

  @Post()
  @PublicRoute()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar reclamo o queja en el libro de reclamaciones' })
  @ApiResponse({ status: 201, description: 'Reclamación registrada exitosamente' })
  async create(@Body() dto: CreateReclamacionDto) {
    return this.reclamacionesService.create(dto);
  }
}
