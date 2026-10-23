import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { CheckDuplicateMessageDto } from './dto/check-duplicate.dto';
import { MessagesDuplicadosLimites } from './duplicados.limites';

// Ventana de búsqueda y tope interno de coincidencias (decisión 4A.2 fase 2). El tope solo acota la lectura: `cantidad` nunca supera DUPLICADOS_MAX
// (5 significa «5 o más»). NO es una paginación de candidatos: la comparación se hace en la propia consulta, de modo que cuantas más consultas
// compartan el correo, más candidatos se descartan en SQL y ninguno se pierde por una ventana de filas (el algoritmo anterior miraba solo 20).
export const DUPLICADOS_VENTANA_MS = 7 * 24 * 3_600_000;
export const DUPLICADOS_MAX = 5;

// Normalización (la misma que aplicaba React en findPossibleDuplicates): se recortan los espacios de los extremos y no se distinguen mayúsculas.
// El DTO ya recorta la entrada; aquí se repite para que el servicio sea correcto aunque se llame sin el ValidationPipe. En la base se aplica
// LOWER(TRIM(columna)) = LOWER(valor). Diferencia conocida: MySQL compara con la colación de la columna (utf8mb4_0900_ai_ci), que además ignora
// acentos (React no lo hacía) y cuyo TRIM solo quita espacios, no tabuladores ni saltos de línea. No hay LIKE: «%» y «_» son caracteres literales.
export const normalizarCampo = (value: string) => value.trim();

export type ComprobacionDuplicados = { hayCoincidencias: boolean; cantidad: number };

@Injectable()
export class MessagesDuplicadosService {
  private readonly logger = new Logger(MessagesDuplicadosService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: MessagesDuplicadosLimites,
  ) {}

  // SOLO LECTURA sobre contactos (un único SELECT parametrizado). La única escritura es el contador del límite en rate_limit_buckets.
  // Devuelve únicamente si hay coincidencias y cuántas: nunca identificadores, nombres, correos, teléfonos ni texto de mensajes.
  async comprobar(dto: CheckDuplicateMessageDto, actorId: number, now = new Date()): Promise<ComprobacionDuplicados> {
    await this.limites.admitir(actorId, now); // 429 / 503 ANTES de leer datos personales
    const desde = new Date(now.getTime() - DUPLICADOS_VENTANA_MS);
    const email = normalizarCampo(dto.email), asunto = normalizarCampo(dto.asunto), mensaje = normalizarCampo(dto.mensaje);
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT m.id FROM contactos m
      WHERE m.createdAt >= ${desde} AND LOWER(TRIM(m.email)) = LOWER(${email}) AND LOWER(TRIM(m.asunto)) = LOWER(${asunto}) AND LOWER(TRIM(m.mensaje)) = LOWER(${mensaje})
      ORDER BY m.id DESC LIMIT ${DUPLICADOS_MAX}`);
    const cantidad = Math.min(rows.length, DUPLICADOS_MAX);
    // Registro sin datos personales: solo la cuenta y el resultado (ni correo, ni asunto, ni texto).
    this.logger.log('Comprobación de duplicados: cuenta=' + actorId + ' cantidad=' + cantidad);
    return { hayCoincidencias: cantidad > 0, cantidad };
  }
}
