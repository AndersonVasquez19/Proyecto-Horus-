import { randomUUID } from 'node:crypto';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateReclamacionDto } from './dto/create-reclamacion.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ReclamacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  private generarNumeroReclamo(): string {
    const hoy = new Date();
    const fecha = hoy.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = randomUUID();
    return `HG-${fecha}-${rand}`;
  }

  async create(dto: CreateReclamacionDto) {
    const numero_reclamo = this.generarNumeroReclamo();
    let registro: { id: number };
    try {
      registro = await this.prisma.reclamacion.create({ data: {
        ...dto,
        fecha_incidente: new Date(dto.fecha_incidente),
        numero_reclamo,
      } });
    } catch {
      throw new InternalServerErrorException({
        ok: false,
        mensaje: 'Error al registrar la reclamación.',
      });
    }

    // El registro ya está guardado: la constancia por correo es un efecto aparte. Que falle (o lance) nunca convierte el registro en un error,
    // para que la persona no vuelva a enviar una reclamación ya almacenada; la respuesta lo indica con correo_enviado: false.
    let correoEnviado = false;
    try {
      // Esperar al correo antes de finalizar la función en Vercel.
      correoEnviado = (await this.mailService.sendReclamoConstancia({
        email: dto.email,
        nombres: dto.nombres,
        apellidos: dto.apellidos,
        tipo_registro: dto.tipo_registro,
        numero_reclamo,
        area: dto.area,
        detalle_reclamo: dto.detalle_reclamo,
      })) === true;
    } catch { /* sin datos de la persona en los registros */ }

    return {
      ok: true,
      correo_enviado: correoEnviado,
      mensaje: 'Su requerimiento fue registrado exitosamente.',
      numero_reclamo,
      id: registro.id,
    };
  }
}
