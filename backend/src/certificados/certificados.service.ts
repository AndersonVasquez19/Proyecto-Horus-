import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated } from '../database/serialization';
import { CERTIFICATE_NOT_FOUND, normalizeCode, publicView } from './certificados.rules';

// Solo verificación pública de certificados ya entregados (de solo lectura). La emisión, anulación, sustitución, el listado
// administrativo y el PDF con QR se retiraron del alcance; las tablas, los datos y el historial se conservan intactos.
@Injectable()
export class CertificadosService {
  constructor(private readonly prisma: PrismaService) {}

  // Verificación PÚBLICA por código. Un código con formato inválido y uno inexistente responden igual (404, mismo texto): no se
  // distingue qué falló. La respuesta no incluye el DNI ni datos internos (ver publicView).
  async verify(rawCode: unknown) {
    const code = normalizeCode(rawCode);
    if (!code) throw new NotFoundException(CERTIFICATE_NOT_FOUND);
    try {
      const row = await this.prisma.certificado.findUnique({ where: { codigo_verificacion: code }, select: {
        estado: true, estudiante_nombres: true, estudiante_apellidos: true, curso_titulo: true, curso_tipo: true, curso_duracion: true,
        convocatoria_nombre: true, convocatoria_fecha_inicio: true, convocatoria_fecha_fin: true, emitido_at: true, sustituido_por: { select: { id: true } },
      } });
      if (!row) throw new NotFoundException(CERTIFICATE_NOT_FOUND);
      return publicView(row);
    } catch (error) {
      if (isSchemaOutdated(error)) throw new ServiceUnavailableException('La verificación de certificados no está disponible. Solicita revisar la estructura académica.');
      throw error;
    }
  }
}
