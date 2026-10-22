import { Module, Controller, Get, Post, Put, Param, ParseIntPipe, Body, Query, UseGuards, Headers } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthModule } from '../admin/auth/auth.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireByField, RequirePermission } from '../permissions/access.decorators';
import { CotizacionesService } from './cotizaciones.service';
import { IDEMPOTENCY_HEADER, parseIdempotencyKey } from './idempotency';
import { SendCotizacionDto, CotizacionDto, CotizacionQueryDto, EditCotizacionDto, EstadoCotizacionDto } from './cotizacion.dto';

@ApiTags('Admin - Cotizaciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/cotizaciones')
export class CotizacionesController {
  constructor(private readonly service: CotizacionesService) {}
  @Get() @RequirePermission('cotizaciones:leer') list(@Query() query: CotizacionQueryDto) { return this.service.list(query); }
  @Get(':id') @RequirePermission('cotizaciones:leer') detail(@Param('id', ParseIntPipe) id: number) { return this.service.detail(id); }
  @Post() @RequirePermission('cotizaciones:crear') create(@Body() dto: CotizacionDto, @CurrentUser('id') user: number, @Headers(IDEMPOTENCY_HEADER) key?: string) { return this.service.create(dto, user, parseIdempotencyKey(key)); }
  @Put(':id') @RequirePermission('cotizaciones:editar') edit(@Param('id', ParseIntPipe) id: number, @Body() dto: EditCotizacionDto, @CurrentUser('id') user: number) { return this.service.edit(id, dto, user); }
  @Post(':id/correo') @RequirePermission('cotizaciones:enviar') email(@Param('id', ParseIntPipe) id: number, @Body() dto: SendCotizacionDto, @CurrentUser('id') user: number) { return this.service.email(id, dto.revision, user, dto.confirmar_reenvio === true); }
  @Post(':id/estado') @RequireByField('estado', 'cotizaciones:editar', { anulada: 'cotizaciones:anular', enviada: 'cotizaciones:enviar' }) status(@Param('id', ParseIntPipe) id: number, @Body() dto: EstadoCotizacionDto, @CurrentUser('id') user: number) { return this.service.status(id, dto, user); }
}
@Module({ imports: [AuthModule], controllers: [CotizacionesController], providers: [CotizacionesService] })
export class CotizacionesModule {}
