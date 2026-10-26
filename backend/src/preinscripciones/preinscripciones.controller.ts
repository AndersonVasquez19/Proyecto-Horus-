import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PublicRoute, RequirePermission } from '../permissions/access.decorators';
import { ConvocatoriaIdDto, CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';
import { ChatbotPreinscripcionDto, ConvertirPreinscripcionDto, DescartePreinscripcionDto, DesistimientoPreinscripcionDto, PreinscripcionesQueryDto, RegistroPreinscripcionDto, ResumenPreinscripcionesQueryDto, RevisionPreinscripcionDto, UpdatePreinscripcionDto } from './preinscripciones.dto';
import { PreinscripcionesPublicService } from './preinscripciones-public.service';
import { PreinscripcionesService } from './preinscripciones.service';

type ActorRequest = { user: { id: number } };

// ---- Público -------------------------------------------------------------------------------------------------------------------
// Formulario web. El canal lo fija el servidor ('formulario'); el cliente no puede elegir un origen.
@ApiTags('Preinscripciones públicas')
@Controller('preinscripciones')
export class PreinscripcionesPublicController {
  constructor(private readonly service: PreinscripcionesPublicService) {}
  @Get('convocatorias') @PublicRoute() editions() { return this.service.editions(); }
  @Post() @PublicRoute() register(@Body() dto: RegistroPreinscripcionDto) { return this.service.register(dto, 'formulario'); }
}

// Chatbot de Horus Group. Es una ACCIÓN DETERMINISTA del backend: el widget la invoca solo cuando el visitante completó y confirmó sus
// datos. El modelo de OpenAI no la llama, no la ve y no recibe esos datos (ChatbotService no depende de este módulo). Reutiliza el
// mismo servicio de negocio que el formulario, con el canal fijado a 'chatbot'.
@ApiTags('Preinscripciones públicas')
@Controller('chatbot')
export class ChatbotPreinscripcionController {
  constructor(private readonly service: PreinscripcionesPublicService) {}
  @Post('preinscripcion') @PublicRoute() register(@Body() dto: ChatbotPreinscripcionDto) { return this.service.register(dto, 'chatbot'); }
}

// ---- Administración ------------------------------------------------------------------------------------------------------------
// Sin DELETE: las preinscripciones se descartan, desisten o convierten y se conservan con su historial. Rutas fijas ('resumen')
// antes de ':id'.
@ApiTags('Administración de preinscripciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/preinscripciones')
export class PreinscripcionesController {
  constructor(private readonly service: PreinscripcionesService) {}
  @Get() @RequirePermission('preinscripciones:leer') list(@Query() q: PreinscripcionesQueryDto) { return this.service.list(q); }
  @Get('resumen') @RequirePermission('preinscripciones:leer') summary(@Query() q: ResumenPreinscripcionesQueryDto) { return this.service.summary(q); }
  @Get(':id') @RequirePermission('preinscripciones:leer') detail(@Param() p: ConvocatoriaIdDto) { return this.service.detail(p.id); }
  @Get(':id/historial') @RequirePermission('preinscripciones:leer') history(@Param() p: ConvocatoriaIdDto, @Query() q: CursosConvocatoriaQueryDto) { return this.service.history(p.id, q); }
  @Patch(':id') @RequirePermission('preinscripciones:editar') update(@Param() p: ConvocatoriaIdDto, @Body() dto: UpdatePreinscripcionDto, @Req() req: ActorRequest) { return this.service.update(p.id, dto, req.user.id); }
  @Put(':id/validacion') @RequirePermission('preinscripciones:editar') validate(@Param() p: ConvocatoriaIdDto, @Body() dto: RevisionPreinscripcionDto, @Req() req: ActorRequest) { return this.service.validate(p.id, dto.revision, req.user.id); }
  @Put(':id/descarte') @RequirePermission('preinscripciones:editar') discard(@Param() p: ConvocatoriaIdDto, @Body() dto: DescartePreinscripcionDto, @Req() req: ActorRequest) { return this.service.discard(p.id, dto, req.user.id); }
  @Put(':id/desistimiento') @RequirePermission('preinscripciones:editar') withdraw(@Param() p: ConvocatoriaIdDto, @Body() dto: DesistimientoPreinscripcionDto, @Req() req: ActorRequest) { return this.service.withdraw(p.id, dto, req.user.id); }
  @Post(':id/conversion') @HttpCode(201) @RequirePermission('preinscripciones:convertir') convert(@Param() p: ConvocatoriaIdDto, @Body() dto: ConvertirPreinscripcionDto, @Req() req: ActorRequest) { return this.service.convert(p.id, dto, req.user.id); }
}
