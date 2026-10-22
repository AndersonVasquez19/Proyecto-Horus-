import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateAdminMessageDto } from './dto/create-message.dto';
import { UpdateMessageStatusDto } from './dto/update-message-status.dto';

import { pageResult } from '../../common/list-query.dto';
import type { MessageQueryDto } from './dto/query-messages.dto';
import { countMessages, lockMessage, messageTotals, readMessageExportBatch, readMessages, type MessageExportRow } from '../../attention/message-state';
import type { MessageExportQueryDto } from './dto/export-messages.dto';
import { EXPORT_BATCH_SIZE, MAX_EXPORT_MESSAGES, messagesExportFileName, renderMessagesCsv } from './messages.export';
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // Exportación controlada. SOLO LECTURA: ningún UPDATE/INSERT/DELETE. El conjunto se lee por lotes dentro de una misma transacción de
  // lectura (instantánea coherente), con tope de filas; si el filtro lo supera responde 422 sin leer datos personales.
  // La autorización (mensajes:exportar) la aplica AccessGuard con el rol vigente; aquí solo se registra la descarga.
  async exportCsv(q: MessageExportQueryDto, actorId: number, now = new Date()) {
    const requested = { search: q.search, estado: q.estado, channel: q.channel, responsable: q.responsable, antiguas: q.antiguas };
    const filters = { ...requested, now }; // un único instante de referencia para el conteo y todos los lotes
    const rows = await this.prisma.$transaction(async tx => {
      const total = await countMessages(tx, filters);
      if (total > MAX_EXPORT_MESSAGES) {
        throw new UnprocessableEntityException('Hay ' + total + ' consultas y el máximo por exportación es ' + MAX_EXPORT_MESSAGES + '. Acota la búsqueda o los filtros.');
      }
      const all: MessageExportRow[] = [];
      while (all.length < total) {
        const batch = await readMessageExportBatch(tx, filters, all.length, EXPORT_BATCH_SIZE);
        all.push(...batch);
        if (batch.length < EXPORT_BATCH_SIZE) break;
      }
      return all;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000, maxWait: 5_000 });
    // Registro de la descarga sin datos personales: quién, cuántas filas y QUÉ filtros se usaron (nombres, no valores: la búsqueda puede ser un nombre o un correo).
    const used = Object.entries(requested).filter(([, value]) => value !== undefined).map(([key]) => key).join(',') || 'ninguno';
    this.logger.log('Exportación de consultas: cuenta=' + actorId + ' filas=' + rows.length + ' filtros=' + used);
    return { buffer: renderMessagesCsv(rows, now, q.separador), fileName: messagesExportFileName(now), rows: rows.length };
  }

  // Siempre paginado: omitir `page` ya no devuelve todos los registros (con correo, teléfono y mensaje) sino la página 1 con el límite
  // vigente (20 por defecto, 100 como máximo según ListQueryDto). La respuesta añade `pagination` y `metrics`; `ok` y `messages` no cambian.
  async findAll(q: MessageQueryDto = {}) {
    const paged = { ...q, page: q.page ?? 1 };
    const messages = await readMessages(this.prisma,paged);
    const [total,counts]=await Promise.all([countMessages(this.prisma,paged),messageTotals(this.prisma)]);
    const {nuevo,en_proceso,atendido,archivado}=counts;
    return{ok:true,messages,...pageResult(paged,total),metrics:{nuevo,en_proceso,atendido,archivado}};
  }

  async findOne(id: number) {
    const [message] = await readMessages(this.prisma,{},id);
    if (!message) {
      throw new NotFoundException({ ok: false, mensaje: 'Mensaje no encontrado.' });
    }
    return { ok: true, message };
  }

  async create(dto: CreateAdminMessageDto) {
    let message = await this.prisma.contacto.create({ data: {
      ...dto,
      telefono: dto.telefono ?? '',
      estado: 'nuevo',
      origen: 'manual',
    } });
    return { ok: true, mensaje: 'Mensaje creado correctamente.', message };
  }

  async updateStatus(id: number, dto: UpdateMessageStatusDto) {
    return this.prisma.$transaction(async tx => {
      if (!(await lockMessage(tx,id)).length) {
        throw new NotFoundException({ ok: false, mensaje: 'Mensaje no encontrado.' });
      }
      if (await tx.attentionRecord.findUnique({where:{recurso_registro_id:{recurso:'messages',registro_id:id}}})) throw new ConflictException('Actualiza este caso desde Seguimiento para conservar su historial.');
      const message = await tx.contacto.update({ where: { id }, data: { estado: dto.estado } });
      return { ok: true, mensaje: 'Estado del mensaje actualizado.', message };
    });
  }

  async remove(id: number) {
    let message = await this.prisma.contacto.findUnique({ where: { id } });
    if (!message) {
      throw new NotFoundException({ ok: false, mensaje: 'Mensaje no encontrado.' });
    }
    if (await this.prisma.cotizacion.count({ where: { contacto_id: id } }) || await this.prisma.attentionRecord.count({ where: { recurso: 'messages', registro_id: id } })) {
      throw new ConflictException('El mensaje tiene cotizaciones vinculadas. Conserva su registro.');
    }
    try { await this.prisma.contacto.delete({ where: { id } }); }
    catch (error) { if (error instanceof PrismaClientKnownRequestError && error.code === 'P2003') throw new ConflictException('El mensaje tiene cotizaciones vinculadas. Conserva su registro.'); throw error; }
    return { ok: true, mensaje: 'Mensaje eliminado correctamente.' };
  }
}
