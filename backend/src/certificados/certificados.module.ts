import { Module } from '@nestjs/common';
import { CertificadosController, CertificadosPublicController } from './certificados.controller';
import { CertificadosService } from './certificados.service';
@Module({ controllers: [CertificadosPublicController, CertificadosController], providers: [CertificadosService], exports: [CertificadosService] })
export class CertificadosModule {}
