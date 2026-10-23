import { Module } from '@nestjs/common';
import { CertificadosPublicController } from './certificados.controller';
import { CertificadosService } from './certificados.service';
@Module({ controllers: [CertificadosPublicController], providers: [CertificadosService] })
export class CertificadosModule {}
