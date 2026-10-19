import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { isAdminRole } from '../../permissions/roles';

export interface JwtPayload {
  version?: number;
  id: number;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer: 'horus-api',
      audience: 'horus-panel',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !Number.isSafeInteger(payload.id) || payload.id <= 0) {
      throw new UnauthorizedException({ ok: false, mensaje: 'Identidad no válida.' });
    }
    // Una sola lectura por solicitud: la misma fila que confirma cuenta activa y session_version aporta el rol vigente (instantánea
    // coherente). Solo se seleccionan los campos necesarios: el hash de la contraseña no se carga.
    const user = await this.prisma.adminUser.findUnique({
      where: { id: payload.id },
      select: { id: true, nombre: true, email: true, activo: true, session_version: true, rol: true },
    });
    if (!user || user.activo === false || (payload.version ?? 1) !== (user.session_version ?? 1)) {
      throw new UnauthorizedException({ ok: false, mensaje: 'Usuario no encontrado o inactivo.' });
    }
    // `rol` es informativo (lo muestra GET /admin/me); la autorización por permisos la decide AccessGuard con su propia lectura.
    return { id: user.id, nombre: user.nombre, email: user.email, rol: isAdminRole(user.rol) ? user.rol : null };
  }
}
