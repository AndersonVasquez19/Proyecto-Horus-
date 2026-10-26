import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { trimValue } from '../common/validation';
import { AuthenticatedRoute } from '../permissions/access.decorators';
import { MAX_PREGUNTA } from './asistente.consulta';
import { AsistenteConsultaService } from './asistente.consulta.service';
import { AsistenteService } from './asistente.service';

export class ResumenQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  explicar?: 'true' | 'false';
}

export class ConsultarDto {
  @Transform(trimValue)
  @IsString({ message: 'La pregunta debe ser un texto.' })
  @IsNotEmpty({ message: 'Escribe tu pregunta.' })
  @MaxLength(MAX_PREGUNTA, { message: `La pregunta no debe superar ${MAX_PREGUNTA} caracteres.` })
  pregunta!: string;
}

type ActorRequest = { user: { id: number } };

// HORUS Assistant (v1 resumen + v2 consultas en lenguaje natural, solo lectura). Es independiente del chatbot público (/api/chatbot): otro módulo, otra audiencia (personal del panel),
// otra ruta y otros datos. Cualquier sesión válida llega al servicio, que lee el rol VIGENTE de la base y filtra cada sección por permisos:
// una cuenta sin rol recibe 403 y un rol solo ve las áreas que ya puede consultar en el panel. No existe ninguna operación de escritura.
@ApiTags('Administración - HORUS Assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/asistente')
export class AsistenteController {
  constructor(private readonly service: AsistenteService, private readonly consultas: AsistenteConsultaService) {}

  @Get('resumen')
  @AuthenticatedRoute()
  @ApiOperation({ summary: 'Resumen personal del día: pendientes e indicadores según el rol (solo lectura)' })
  resumen(@Query() query: ResumenQueryDto, @Req() req: ActorRequest) {
    return this.service.resumen(req.user.id, { explicar: query.explicar === 'true' });
  }

  // Un POST porque envía una pregunta; no escribe nada. 200 (no 201): no crea ningún recurso.
  @Post('consultar')
  @HttpCode(200)
  @AuthenticatedRoute()
  @ApiOperation({ summary: 'Pregunta en lenguaje natural sobre las operaciones, limitada al rol de la cuenta (solo lectura, usa IA)' })
  consultar(@Body() body: ConsultarDto, @Req() req: ActorRequest) {
    return this.consultas.consultar(req.user.id, body.pregunta);
  }
}
