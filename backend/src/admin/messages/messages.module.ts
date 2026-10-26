import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesDuplicadosController } from './duplicados.controller';
import { MessagesDuplicadosService } from './duplicados.service';
import { MessagesDuplicadosLimites } from './duplicados.limites';

@Module({
  imports: [],
  controllers: [MessagesController, MessagesDuplicadosController],
  providers: [MessagesService, MessagesDuplicadosService, MessagesDuplicadosLimites],
  exports: [MessagesService],
})
export class MessagesModule {}
