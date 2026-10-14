import { isUniqueViolation } from '../../database/serialization';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AdminUser } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { BCRYPT_COST, DUMMY_PASSWORD_HASH } from './password-security';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private generateToken(user: AdminUser): string {
    return this.jwtService.sign({ id: user.id, email: user.email, version: user.session_version });
  }

  // La cuenta nace siempre sin rol. Su alta y el registro de auditoría (quién la creó) se confirman en la misma transacción.
  async register(dto: RegisterDto, actorId: number | null) {
    const exists = await this.prisma.adminUser.findFirst({ where: { email: dto.email.toLowerCase().trim() } });
    if (exists) {
      throw new ConflictException({ ok: false, mensaje: 'Ya existe un administrador con ese correo.' });
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_COST);
    let user: AdminUser;
    try {
      user = await this.prisma.$transaction(async tx => {
        const created = await tx.adminUser.create({ data: {
          nombre: dto.nombre.trim(),
          email: dto.email.toLowerCase().trim(),
          password: hashedPassword,
        } });
        await tx.adminAuditoria.create({ data: {
          origen: 'panel', actor_id: actorId, cuenta_id: created.id, operacion: 'cuenta_creada',
          rol_anterior: null, rol_nuevo: null, activo_anterior: null, activo_nuevo: created.activo, resultado: 'aplicado',
        } });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException({ ok: false, mensaje: 'Ya existe un administrador con ese correo.' });
      throw error;
    }

    const token = this.generateToken(user);

    return {
      ok: true,
      mensaje: 'Administrador registrado correctamente.',
      token,
      user: { id: user.id, nombre: user.nombre, email: user.email },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.adminUser.findFirst({ where: { email: dto.email.toLowerCase().trim() } });
    // bcrypt se ejecuta siempre: sin cuenta se compara contra un hash ficticio del mismo coste. La respuesta es la misma en los tres casos.
    const matches = await bcrypt.compare(dto.password, user?.password ?? DUMMY_PASSWORD_HASH);
    if (!user || user.activo === false || !matches) {
      throw new UnauthorizedException({ ok: false, mensaje: 'Credenciales incorrectas.' });
    }

    const token = this.generateToken(user);

    return {
      ok: true,
      mensaje: 'Login correcto.',
      token,
      user: { id: user.id, nombre: user.nombre, email: user.email },
    };
  }
}
