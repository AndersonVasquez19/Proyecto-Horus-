import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PublicRoute, RequirePermission } from '../permissions/access.decorators';
import { CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';
import { AnularCertificadoDto, CertificadoIdDto, CertificadosQueryDto, EmitirCertificadoDto, SustituirCertificadoDto } from './certificados.dto';
import { CertificadosService } from './certificados.service';

type ActorRequest = { user: { id: number } };

// Verificación pública: cualquiera con el código impreso (o su QR) comprueba si el certificado es vigente. El código es aleatorio de
// 100 bits; la respuesta solo trae nombre, curso y fechas (nunca el DNI) y no se guarda en cachés.
@ApiTags('Certificados públicos')
@Controller('certificados')
export class CertificadosPublicController {
  constructor(private readonly service: CertificadosService) {}
  @Get('verificar/:codigo') @PublicRoute() @Header('Cache-Control', 'no-store') verify(@Param('codigo') codigo: string) { return this.service.verify(codigo); }
}

// Sin DELETE: un certificado se anula o se sustituye y se conserva con su historial. Rutas fijas antes de ':id'.
@ApiTags('Administración de certificados')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/certificados')
export class CertificadosController {
  constructor(private readonly service: CertificadosService) {}
  @Get() @RequirePermission('certificados:leer') list(@Query() q: CertificadosQueryDto) { return this.service.list(q); }
  @Get(':id') @RequirePermission('certificados:leer') detail(@Param() p: CertificadoIdDto) { return this.service.detail(p.id); }
  @Get(':id/historial') @RequirePermission('certificados:leer') history(@Param() p: CertificadoIdDto, @Query() q: CursosConvocatoriaQueryDto) { return this.service.history(p.id, q); }
  // PDF A4 con QR. Sin DNI; un certificado anulado se imprime con su estado visible. 503 si la URL pública de verificación no está configurada.
  @Get(':id/pdf') @RequirePermission('certificados:leer') @Header('Cache-Control', 'no-store') @ApiOperation({ summary: 'Descargar el PDF del certificado' }) @ApiProduces('application/pdf')
  async pdf(@Param() p: CertificadoIdDto) {
    const file = await this.service.pdf(p.id);
    return new StreamableFile(file.buffer, { type: 'application/pdf', disposition: 'attachment; filename="' + file.fileName + '"', length: file.buffer.length });
  }
  @Post() @HttpCode(201) @RequirePermission('certificados:emitir') emit(@Body() dto: EmitirCertificadoDto, @Req() req: ActorRequest) { return this.service.emit(dto, req.user.id); }
  @Put(':id/anulacion') @RequirePermission('certificados:anular') annul(@Param() p: CertificadoIdDto, @Body() dto: AnularCertificadoDto, @Req() req: ActorRequest) { return this.service.annul(p.id, dto, req.user.id); }
  @Post(':id/sustitucion') @HttpCode(201) @RequirePermission('certificados:anular') substitute(@Param() p: CertificadoIdDto, @Body() dto: SustituirCertificadoDto, @Req() req: ActorRequest) { return this.service.substitute(p.id, dto, req.user.id); }
}
