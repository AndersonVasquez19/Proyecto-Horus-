import { Module } from '@nestjs/common';
import { EdicionSesionesController, SesionesController } from './sesiones.controller';
import { SesionesService } from './sesiones.service';

@Module({ controllers: [SesionesController, EdicionSesionesController], providers: [SesionesService] })
export class SesionesModule {}
