import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';

// Límite por cuenta de la comprobación de duplicados, COMPARTIDO entre instancias. Usa la tabla ya existente rate_limit_buckets (sin migración) con la
// MISMA operación atómica que PublicRateLimitGuard y AsistenteLimites: «INSERT … ON DUPLICATE KEY» + «UPDATE … SET count = count + 1 WHERE count < tope».
// Dos procesos o dos solicitudes simultáneas se coordinan en MySQL: nadie supera el tope. No hay estado en memoria.
//
// Tope: 30 comprobaciones por cuenta cada 15 minutos (ventana FIJA: en el cambio de ventana una cuenta podría concentrar hasta el doble).
// Falla CERRADA: si el almacén compartido no responde se devuelve 503 y NO se lee ningún dato (nunca se omite el límite).
// Se consume una unidad por solicitud que llega al servicio (haya o no coincidencias). Las solicitudes sin sesión (401), sin permiso (403) o con
// datos inválidos (400) se rechazan antes y no gastan cuota.
// Privacidad: el identificador del cubo es un hash SHA-256; no se guarda el id de cuenta en texto claro ni ningún dato del formulario.
export const DUPLICADOS_LIMITE_VENTANA_MS = 15 * 60_000;
export const DUPLICADOS_LIMITE_POR_VENTANA = 30;
export const DUPLICADOS_RATE_MESSAGE = 'Has comprobado duplicados muchas veces. Espera unos minutos y vuelve a intentar.';
export const DUPLICADOS_LIMITE_NO_DISPONIBLE_MESSAGE = 'El control de uso no está disponible en este momento. Intenta de nuevo en unos minutos.';
const MAX_ATTEMPTS = 3;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class MessagesDuplicadosLimites {
  private readonly logger = new Logger(MessagesDuplicadosLimites.name);
  constructor(private readonly prisma: PrismaService) {}

  // Reserva UNA comprobación de la cuenta o lanza HttpException (429 al excederse, 503 si el almacén compartido no responde).
  async admitir(actorId: number, now: Date): Promise<void> {
    const ventana = Math.floor(now.getTime() / DUPLICADOS_LIMITE_VENTANA_MS);
    const id = hash(`mensajes:duplicados:cuenta:ventana:${actorId}:${ventana}`);
    const expiraEn = new Date((ventana + 1) * DUPLICADOS_LIMITE_VENTANA_MS + 60_000);
    const reintentarEn = (ventana + 1) * DUPLICADOS_LIMITE_VENTANA_MS;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.$transaction(async tx => {
          await tx.$executeRaw`INSERT INTO rate_limit_buckets (id, count, expiresAt) VALUES (${id}, 0, ${expiraEn}) ON DUPLICATE KEY UPDATE count = count`;
          const admitido = await tx.$executeRaw`UPDATE rate_limit_buckets SET count = count + 1 WHERE id = ${id} AND count < ${DUPLICADOS_LIMITE_POR_VENTANA}`;
          if (!admitido) throw new CuboAgotado();
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        return;
      } catch (error) {
        if (error instanceof CuboAgotado) {
          throw new HttpException({ ok: false, codigo: 'limite_de_uso', mensaje: DUPLICADOS_RATE_MESSAGE, reintentar_en_segundos: Math.max(1, Math.ceil((reintentarEn - now.getTime()) / 1000)) }, HttpStatus.TOO_MANY_REQUESTS);
        }
        const conflicto = error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code);
        if (conflicto && attempt < MAX_ATTEMPTS) continue; // interbloqueo bajo mucha concurrencia: se reintenta, nunca se omite el límite
        // Falla CERRADA: sin el almacén compartido no se sabe cuánto se ha gastado. Solo se registra el tipo del error.
        this.logger.warn(`Comprobación de duplicados: límite de uso no disponible (${error instanceof Error ? error.name : 'error'}).`);
        throw new HttpException({ ok: false, codigo: 'limite_no_disponible', mensaje: DUPLICADOS_LIMITE_NO_DISPONIBLE_MESSAGE }, HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
  }
}

class CuboAgotado extends Error { constructor() { super('cubo_agotado'); } }
