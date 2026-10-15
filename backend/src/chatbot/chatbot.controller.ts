import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { ChatContactDto, ChatMessageDto } from './chatbot.dto';
import { ChatbotGuard } from './chatbot.guard';
import { PublicRoute } from '../permissions/access.decorators';

@ApiTags('Chatbot')
@UseGuards(ChatbotGuard)
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  @Post('message')
  @PublicRoute()
  @HttpCode(200)
  message(@Body() dto: ChatMessageDto) { return this.chatbot.reply(dto); }

  @Post('contact')
  @PublicRoute()
  contact(@Body() dto: ChatContactDto) { return this.chatbot.contact(dto); }
}
