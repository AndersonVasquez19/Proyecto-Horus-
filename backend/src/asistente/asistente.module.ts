import { Module } from '@nestjs/common';
import { AsistenteController } from './asistente.controller';
import { AsistenteConsultaService } from './asistente.consulta.service';
import { ASISTENTE_CONSULTA_DATA, ASISTENTE_DATA, PrismaAsistenteData } from './asistente.data';
import { AsistenteExplainer } from './asistente.explainer';
import { ASISTENTE_LIMITES, AsistenteLimites } from './asistente.limites';
import { AsistenteService } from './asistente.service';

// No importa ChatbotModule ni lo usa: el asistente interno y el chatbot público comparten solo la clave/API de OpenAI (por configuración).
@Module({
  controllers: [AsistenteController],
  providers: [PrismaAsistenteData, { provide: ASISTENTE_DATA, useExisting: PrismaAsistenteData }, { provide: ASISTENTE_CONSULTA_DATA, useExisting: PrismaAsistenteData },
    AsistenteLimites, { provide: ASISTENTE_LIMITES, useExisting: AsistenteLimites },
    AsistenteExplainer, AsistenteService, AsistenteConsultaService],
})
export class AsistenteModule {}
