import { Module } from '@nestjs/common';
import { MatriculasController } from './matriculas.controller';
import { MatriculasService } from './matriculas.service';
@Module({ controllers: [MatriculasController], providers: [MatriculasService], exports: [MatriculasService] })
export class MatriculasModule {}
