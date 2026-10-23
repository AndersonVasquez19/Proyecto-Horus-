import { Body, Controller, Header, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../permissions/access.decorators';
import { CheckDuplicateMessageDto } from './dto/check-duplicate.dto';
import { MessagesDuplicadosService } from './duplicados.service';

// Controlador propio (no toca MessagesController): la ruta es POST, no coincide con ningún GET/PUT/DELETE de admin/messages ni con POST admin/messages.
@ApiTags('Admin - Mensajes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/messages')
export class MessagesDuplicadosController {
  constructor(private readonly duplicados: MessagesDuplicadosService) {}

  // Es una LECTURA aunque use POST (el correo y el texto viajan en el cuerpo, no en la URL): responde 200, sin caché y sin escribir mensajes.
  @Post('duplicados')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @RequirePermission('mensajes:crear')
  @ApiOperation({ summary: 'Comprobar si ya existe una consulta reciente con el mismo correo, asunto y mensaje (solo recuento)' })
  @ApiResponse({ status: 200, description: '{ hayCoincidencias, cantidad } (cantidad máxima 5); sin datos personales' })
  @ApiResponse({ status: 429, description: 'Más de 30 comprobaciones por cuenta en 15 minutos' })
  @ApiResponse({ status: 503, description: 'El control de uso compartido no responde: no se lee ningún dato' })
  async comprobar(@Body() dto: CheckDuplicateMessageDto, @Req() req: { user: { id: number } }) {
    return this.duplicados.comprobar(dto, req.user.id);
  }
}
