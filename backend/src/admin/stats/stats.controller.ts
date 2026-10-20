import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityQueryDto } from './activity-query.dto';
import { DashboardQueryDto } from './dashboard-query.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../permissions/access.decorators';

@ApiTags('Admin - Estadísticas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @RequirePermission('estadisticas:leer')
  @ApiOperation({ summary: 'Obtener métricas, estadísticas y actividad reciente del sistema' })
  @ApiResponse({ status: 200, description: 'Estadísticas consolidadas para el dashboard' })
  async getDashboardStats(@Query() query: DashboardQueryDto) {
    return query.vista === 'operativa' ? this.statsService.getOperationalStats() : this.statsService.getDashboardStats();
  }

  @Get('actividad')
  @RequirePermission('estadisticas:leer')
  @ApiOperation({ summary: 'Mensajes recibidos por día y cotizaciones por estado (solo lectura)' })
  @ApiResponse({ status: 200, description: 'Serie diaria de los últimos 7, 30 o 90 días' })
  async getActivity(@Query() query: ActivityQueryDto) {
    return this.statsService.getActivity(query.dias);
  }
}
