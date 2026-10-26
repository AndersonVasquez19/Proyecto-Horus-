import { ConveniosModule } from './convenios/convenios.module';
import { OriginalContentModule } from './content-original/content-original.module';
import { UploadsModule } from './uploads/uploads.module';
import { AttentionModule } from './attention/attention.module';
import { CotizacionesModule } from './cotizaciones/cotizaciones.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { validateDeployment } from './deployment.config';
import { CatalogoModule } from './catalogo/catalogo.module';
import { EstudiantesModule } from './estudiantes/estudiantes.module';
import { ConvocatoriasModule } from './convocatorias/convocatorias.module';
import { MatriculasModule } from './matriculas/matriculas.module';
import { CertificadosModule } from './certificados/certificados.module';
import { AsistenteModule } from './asistente/asistente.module';
import { HorariosModule } from './horarios/horarios.module';
import { PreinscripcionesModule } from './preinscripciones/preinscripciones.module';
import { ImportacionesModule } from './importaciones/importaciones.module';
import { ReportesModule } from './reportes/reportes.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PublicRateLimitGuard } from './common/public-rate-limit.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AccessGuard, AccountAccessService } from './permissions/access.guard';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { MailModule } from './mail/mail.module';
import { ContactoModule } from './contacto/contacto.module';
import { ReclamacionesModule } from './reclamaciones/reclamaciones.module';
import { AdminModule } from './admin/admin.module';
import { GaleriaModule } from './galeria/galeria.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { SettingsModule } from './settings/settings.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  // H-BACK-01 E3.6: autorización por roles activa. Nest ejecuta las guards globales en el orden de esta lista: primero el límite de
  // frecuencia (un intento denegado también consume cuota) y después AccessGuard, que reutiliza JwtAuthGuard (JwtStrategy sigue en
  // AuthModule) y lee el rol vigente con AccountAccessService. Va unido a ACCESS_MODE = 'por_roles' (permissions/session-access.ts):
  // no se activa ni se retira por separado ni con variables de entorno (lo comprueban session-access.test.ts y access-guard.test.ts).
  providers: [
    JwtAuthGuard,
    AccountAccessService,
    { provide: APP_GUARD, useClass: PublicRateLimitGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateDeployment,
      envFilePath: '.env',
    }),
    DatabaseModule,
    CotizacionesModule,
    AttentionModule,
    UploadsModule,
    OriginalContentModule,
    ConveniosModule,
    CatalogoModule,
    EstudiantesModule,
    ConvocatoriasModule,
    MatriculasModule,
    CertificadosModule,
    HorariosModule,
    PreinscripcionesModule,
    ImportacionesModule,
    ReportesModule,
    ChatbotModule,
    AsistenteModule,
    MailModule,
    ContactoModule,
    ReclamacionesModule,
    AdminModule,
    GaleriaModule,
    NewsletterModule,
    SettingsModule,
  ],
})
export class AppModule {}

