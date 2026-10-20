import { Module } from '@nestjs/common';
import { AsignacionesService } from './asignaciones.service';
import { AsignacionesDocentesController, DocentesController } from './docentes.controller';
import { DocentesService } from './docentes.service';

@Module({ controllers: [DocentesController, AsignacionesDocentesController], providers: [DocentesService, AsignacionesService] })
export class DocentesModule {}
