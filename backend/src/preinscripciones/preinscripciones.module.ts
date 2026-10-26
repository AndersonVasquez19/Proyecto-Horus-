import { Module } from '@nestjs/common';
import { EstudiantesModule } from '../estudiantes/estudiantes.module';
import { MatriculasModule } from '../matriculas/matriculas.module';
import { ChatbotPreinscripcionController, PreinscripcionesController, PreinscripcionesPublicController } from './preinscripciones.controller';
import { PreinscripcionesPublicService } from './preinscripciones-public.service';
import { PreinscripcionesService } from './preinscripciones.service';

// Módulo independiente: NO importa ChatbotModule ni lo importa él. El servicio público y el administrativo son clases distintas.
// Reutiliza MatriculasService y EstudiantesService (exportados por sus módulos) para la conversión, sin duplicar sus reglas.
@Module({
  imports: [MatriculasModule, EstudiantesModule],
  controllers: [PreinscripcionesPublicController, ChatbotPreinscripcionController, PreinscripcionesController],
  providers: [PreinscripcionesPublicService, PreinscripcionesService],
})
export class PreinscripcionesModule {}
