import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';

@ApiTags('Admin - Configuración')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @RequirePermission('configuracion:leer')
  @ApiOperation({ summary: 'Obtener todos los parámetros institucionales para el panel' })
  @ApiResponse({ status: 200, description: 'Listado completo de parámetros y ajustes' })
  async getAll() {
    return this.settingsService.getAllSettingsAdmin();
  }

  @Put()
  @RequirePermission('configuracion:editar')
  @ApiOperation({ summary: 'Actualizar configuración corporativa de la empresa' })
  @ApiResponse({ status: 200, description: 'Ajustes actualizados exitosamente' })
  async update(@Body() dto: UpdateSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }
}
