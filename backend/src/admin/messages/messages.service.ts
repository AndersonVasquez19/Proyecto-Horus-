import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateAdminMessageDto } from './dto/create-message.dto';
import { UpdateMessageStatusDto } from './dto/update-message-status.dto';

import { ListQueryDto, pageResult } from '../../common/list-query.dto';
import { countMessages, lockMessage, messageTotals, readMessages } from '../../attention/message-state';
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findAll(q: ListQueryDto = {}) {
    const messages = await readMessages(this.prisma,q);
    if(q.page===undefined)return{ok:true,messages};
    const [total,counts]=await Promise.all([countMessages(this.prisma,q),messageTotals(this.prisma)]);
    const {nuevo,en_proceso,atendido,archivado}=counts;
    return{ok:true,messages,...pageResult(q,total),metrics:{nuevo,en_proceso,atendido,archivado}};
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
