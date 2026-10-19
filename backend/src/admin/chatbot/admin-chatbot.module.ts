import { Module } from '@nestjs/common';
import { AdminChatbotController } from './admin-chatbot.controller';
import { AdminChatbotService } from './admin-chatbot.service';

@Module({ controllers: [AdminChatbotController], providers: [AdminChatbotService] })
export class AdminChatbotModule {}
