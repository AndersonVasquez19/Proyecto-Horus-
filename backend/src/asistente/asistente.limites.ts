import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { operatingDay } from './asistente.time';

// Mensaje de 429 por cuenta (lo reexporta asistente.service.ts: se define aquí para que el servicio pueda importar este módulo sin ciclos).
export const RATE_MESSAGE = 'Has consultado el asistente muchas veces. Espera un momento y vuelve a intentar.';

// Límite de uso de las consultas de HORUS Assistant COMPARTIDO entre instancias. Antes vivía en memoria de cada proceso, de modo que con N
// instancias el tope efectivo era N veces mayor. Ahora usa la tabla ya existente rate_limit_buckets (sin migración) con la MISMA operación atómica
// de PublicRateLimitGuard: «INSERT … ON DUPLICATE KEY» + «UPDATE … SET count = count + 1 WHERE count < tope». Dos procesos o dos solicitudes
// simultáneas se coordinan en MySQL: nadie supera el tope y una solicitud rechazada no consume la cuota de otro cubo (todo va en una transacción).
//
// Topes (se conservan los de la v2): 10 consultas por cuenta cada 10 minutos y 100 por cuenta al día (día operativo de Lima).
// Resumen v1 (GET resumen): 30 solicitudes por cuenta cada 10 minutos y, de ellas, 6 con explicación de IA (los topes que tenía en memoria por instancia).
// No lleva tope diario ni de IP: no los tenía y no se añaden aquí. Falla CERRADA igual que las consultas: sin el almacén compartido responde 503.
// El tope GLOBAL y el de IP de las consultas los aplica PublicRateLimitGuard (200 por minuto en total y 20 por minuto / 150 por hora por IP en esta ruta), también en
// MySQL: el antiguo tope global en memoria (300 por minuto) quedaba por encima del compartido y nunca podía actuar, así que se retiró.
// Ventanas FIJAS (no deslizantes): el tope se mantiene exacto dentro de cada ventana; en el cambio de ventana una cuenta podría concentrar hasta el doble.
//
// Privacidad: los identificadores de los cubos son un hash SHA-256; no se guarda la IP, el correo ni el id de cuenta en texto claro.
export const ASISTENTE_LIMITES = Symbol('ASISTENTE_LIMITES');

export interface LimitesConsulta {
  // Reserva UNA consulta de la cuenta o lanza HttpException (429 al excederse, 503 si el almacén compartido no responde).
  admitir(actorId: number, now: Date): Promise<void>;
}

export interface LimitesResumen {
  // Reserva UNA solicitud del resumen v1 (y, si pide explicación con IA, también una de la cuota de IA) o lanza HttpException (429 / 503).
  // Es todo o nada: si la cuota de IA está agotada, la solicitud tampoco gasta la del resumen.
  admitirResumen(actorId: number, now: Date, conIa: boolean): Promise<void>;
}

export const LIMITE_VENTANA_MS = 10 * 60_000;
export const LIMITE_POR_VENTANA = 10;
export const LIMITE_POR_DIA = 100;
// Resumen v1: se conservan los topes que tenía en memoria (por cuenta y 10 minutos): 30 solicitudes, de las cuales a lo sumo 6 pueden pedir explicación con IA.
export const LIMITE_RESUMEN_POR_VENTANA = 30;
export const LIMITE_RESUMEN_IA_POR_VENTANA = 6;
const MAX_ATTEMPTS = 3;
export const LIMITE_NO_DISPONIBLE_MESSAGE = 'El control de uso del asistente no está disponible en este momento. Intenta de nuevo en unos minutos.';

type Cubo = { id: string; max: number; expiraEn: Date; reintentarEn: number };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AsistenteLimites implements LimitesConsulta, LimitesResumen {
  private readonly logger = new Logger(AsistenteLimites.name);
  constructor(private readonly prisma: PrismaService) {}

  async admitir(actorId: number, now: Date): Promise<void> {
    const ventana = Math.floor(now.getTime() / LIMITE_VENTANA_MS);
    const dia = operatingDay(now);
    // Orden FIJO (ventana → día): todas las transacciones bloquean las filas en el mismo orden, así que no se cruzan.
    await this.reservar([
      { id: hash(`asistente:cuenta:ventana:${actorId}:${ventana}`), max: LIMITE_POR_VENTANA, expiraEn: new Date((ventana + 1) * LIMITE_VENTANA_MS + 60_000), reintentarEn: (ventana + 1) * LIMITE_VENTANA_MS },
      { id: hash(`asistente:cuenta:dia:${actorId}:${dia.fecha}`), max: LIMITE_POR_DIA, expiraEn: new Date(dia.hastaUtc.getTime() + 60_000), reintentarEn: dia.hastaUtc.getTime() },
    ], now.getTime());
  }

  async admitirResumen(actorId: number, now: Date, conIa: boolean): Promise<void> {
    const ventana = Math.floor(now.getTime() / LIMITE_VENTANA_MS);
    const expiraEn = new Date((ventana + 1) * LIMITE_VENTANA_MS + 60_000), reintentarEn = (ventana + 1) * LIMITE_VENTANA_MS;
    // Orden FIJO (resumen → IA). Una cuota de IA agotada revierte también la del resumen (todo en una transacción).
    const cubos: Cubo[] = [{ id: hash(`asistente:resumen:ventana:${actorId}:${ventana}`), max: LIMITE_RESUMEN_POR_VENTANA, expiraEn, reintentarEn }];
    if (conIa) cubos.push({ id: hash(`asistente:resumen_ia:ventana:${actorId}:${ventana}`), max: LIMITE_RESUMEN_IA_POR_VENTANA, expiraEn, reintentarEn });
    await this.reservar(cubos, now.getTime());
  }

  // Admisión ATÓMICA de todos los cubos o de ninguno (ver el comentario de la cabecera).
  private async reservar(cubos: Cubo[], t: number): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.$transaction(async tx => {
          for (const cubo of cubos) {
            await tx.$executeRaw`INSERT INTO rate_limit_buckets (id, count, expiresAt) VALUES (${cubo.id}, 0, ${cubo.expiraEn}) ON DUPLICATE KEY UPDATE count = count`;
            const admitido = await tx.$executeRaw`UPDATE rate_limit_buckets SET count = count + 1 WHERE id = ${cubo.id} AND count < ${cubo.max}`;
            if (!admitido) throw new CuboAgotado(cubo); // revierte la transacción: ningún otro cubo gasta cuota
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        return;
      } catch (error) {
        if (error instanceof CuboAgotado) {
          throw new HttpException({ ok: false, codigo: 'limite_de_uso', mensaje: RATE_MESSAGE, reintentar_en_segundos: Math.max(1, Math.ceil((error.cubo.reintentarEn - t) / 1000)) }, HttpStatus.TOO_MANY_REQUESTS);
        }
        const conflicto = error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code);
        if (conflicto && attempt < MAX_ATTEMPTS) continue; // interbloqueo bajo mucha concurrencia: se reintenta, nunca se omite el límite
        // Falla CERRADA: sin el almacén compartido no se sabe cuánto se ha gastado, así que no se llama a OpenAI. Solo se registra el tipo del error.
        this.logger.warn(`Asistente: límite de uso no disponible (${error instanceof Error ? error.name : 'error'}).`);
        throw new HttpException({ ok: false, codigo: 'limite_no_disponible', mensaje: LIMITE_NO_DISPONIBLE_MESSAGE }, HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
  }
}

class CuboAgotado extends Error { constructor(readonly cubo: Cubo) { super('cubo_agotado'); } }
