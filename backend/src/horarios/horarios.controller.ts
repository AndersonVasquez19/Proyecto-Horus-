import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { HorariosEdicionIdDto, ReemplazoHorariosDto } from './horarios.dto';
import { HorariosService } from './horarios.service';

type ActorRequest = { user: { id: number } };

// Horarios recurrentes de una edición (días y horas en que se dicta). Son parte de la edición, así que reutilizan sus permisos sin cambiar
// la matriz: leer = convocatorias:leer (Gerencia, Coordinación y Secretaría, que atiende consultas sobre horarios); reemplazar =
// convocatorias:editar (Gerencia y Coordinación). No hay POST ni DELETE por tramo: el PUT reemplaza el conjunto con la revisión de la edición.
@ApiTags('Administración de ediciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/convocatorias')
export class HorariosController {
  constructor(private readonly service: HorariosService) {}
  @Get(':id/horarios') @RequirePermission('convocatorias:leer') list(@Param() p: HorariosEdicionIdDto) { return this.service.list(p.id); }
  @Put(':id/horarios') @RequirePermission('convocatorias:editar') replace(@Param() p: HorariosEdicionIdDto, @Body() dto: ReemplazoHorariosDto, @Req() req: ActorRequest) { return this.service.replace(p.id, dto, req.user.id); }
}
