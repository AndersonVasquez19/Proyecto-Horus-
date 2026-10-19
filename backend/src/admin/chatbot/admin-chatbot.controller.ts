import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ListQueryDto } from '../../common/list-query.dto';
import { RequirePermission } from '../../permissions/access.decorators';
import { AdminChatbotService } from './admin-chatbot.service';

@ApiTags('Admin - Chatbot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/chatbot')
export class AdminChatbotController {
  constructor(private readonly service: AdminChatbotService) {}

  @Get('sin-respuesta')
  @RequirePermission('chatbot_consultas:leer')
  @ApiOperation({ summary: 'Preguntas sin respuesta del chatbot y métricas de uso (solo lectura)' })
  unanswered(@Query() query: ListQueryDto) { return this.service.unanswered(query); }
}
