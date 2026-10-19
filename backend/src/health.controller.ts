import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PublicRoute } from './permissions/access.decorators';

// Comprobación de vida para el healthcheck del despliegue: no toca la base de datos ni expone datos.
@ApiExcludeController()
@Controller('health')
export class HealthController {
  @Get()
  @PublicRoute()
  check() {
    return { ok: true };
  }
}
