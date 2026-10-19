import { Module } from '@nestjs/common';
import { AuthModule } from '../admin/auth/auth.module';
import { ConveniosController, AdminConveniosController } from './convenios.controllers';
import { ConveniosService } from './convenios.service';
@Module({ imports: [AuthModule], controllers: [ConveniosController, AdminConveniosController], providers: [ConveniosService] })
export class ConveniosModule {}
