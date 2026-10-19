import { Module } from '@nestjs/common';
import { EstudiantesService } from '../estudiantes/estudiantes.service';
import { MatriculasService } from '../matriculas/matriculas.service';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';
@Module({ controllers: [ImportacionesController], providers: [ImportacionesService, EstudiantesService, MatriculasService] })
export class ImportacionesModule {}
