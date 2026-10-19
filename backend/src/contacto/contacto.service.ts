import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateContactoDto } from './dto/create-contacto.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ContactoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async create(dto: CreateContactoDto) {
    try {
      const nuevo = await this.prisma.contacto.create({ data: {
        ...dto,
        estado: 'nuevo',
      } });

      // Esperar al correo antes de finalizar la función en Vercel.
      const correoEnviado = await this.mailService.sendContactoNotificacion({
        nombre: dto.nombre,
        email: dto.email,
        telefono: dto.telefono,
        asunto: dto.asunto,
        mensaje: dto.mensaje,
      });

      return {
        ok: true,
        correo_enviado: correoEnviado === true,
        mensaje: 'Mensaje enviado correctamente. Nos pondremos en contacto pronto.',
        id: nuevo.id,
      };
    } catch {
      throw new InternalServerErrorException({
        ok: false,
        mensaje: 'Error al enviar el mensaje. Intente más tarde.',
      });
    }
  }
}

