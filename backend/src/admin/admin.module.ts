import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ItemsModule } from './items/items.module';
import { MessagesModule } from './messages/messages.module';
import { AdminReclamacionesModule } from './reclamaciones/admin-reclamaciones.module';
import { StatsModule } from './stats/stats.module';
import { AdminChatbotModule } from './chatbot/admin-chatbot.module';

@Module({
  imports: [
    AuthModule,
    ItemsModule,
    MessagesModule,
    AdminReclamacionesModule,
    StatsModule,
    AdminChatbotModule,
  ],
  exports: [
    AuthModule,
    ItemsModule,
    MessagesModule,
    AdminReclamacionesModule,
    StatsModule,
    AdminChatbotModule,
  ],
})
export class AdminModule {}

