import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotGuard } from './chatbot.guard';
import { ChatbotMetricsService } from './chatbot-metrics.service';

@Module({
  imports: [],
  controllers: [ChatbotController],
  providers: [ChatbotService, ChatbotMetricsService, ChatbotGuard],
})
export class ChatbotModule {}
