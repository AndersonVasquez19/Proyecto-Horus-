import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicRoute } from '../permissions/access.decorators';
import { CertificadosService } from './certificados.service';

// Verificación pública: cualquiera con el código impreso (o su QR) comprueba si el certificado es vigente. El código es aleatorio de
// 100 bits; la respuesta solo trae nombre, curso y fechas (nunca el DNI) y no se guarda en cachés.
// Es lo único que queda del módulo: ya no hay rutas administrativas de certificados.
@ApiTags('Certificados públicos')
@Controller('certificados')
export class CertificadosPublicController {
  constructor(private readonly service: CertificadosService) {}
  @Get('verificar/:codigo') @PublicRoute() @Header('Cache-Control', 'no-store') verify(@Param('codigo') codigo: string) { return this.service.verify(codigo); }
}
