import { isSchemaOutdated, isUniqueViolation } from '../../database/serialization';
import { ConflictException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AdminUser } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PublicSignupDto } from './dto/signup.dto';
import { BCRYPT_COST, DUMMY_PASSWORD_HASH } from './password-security';
import { ACCESS_MODE, sessionAccess } from '../../permissions/session-access';

// Respuestas del registro público. La de éxito es la misma para un registro real y para un envío automatizado detectado por el campo
// trampa, y no incluye identificador, token ni datos de la cuenta.
export const SIGNUP_CREATED = Object.freeze({ ok: true, mensaje: 'Cuenta creada. El acceso al panel requiere la autorización de la gerencia.' });
export const SIGNUP_DUPLICATE = 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.';
// Motivo que queda en admin_auditoria: distingue el autorregistro (actor_id NULL, origen panel) del alta hecha por un administrador.
export const PUBLIC_SIGNUP_REASON = 'Registro público desde el sitio web; la cuenta nace sin rol.';
export const AUTH_UNAVAILABLE = 'El acceso al panel no está disponible temporalmente. Inténtalo más tarde.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

  // Base sin la estructura esperada (p. ej. sin admin_users.rol porque faltan migraciones): 503 con un mensaje neutro en lugar de un 500
  // genérico. El registro del servidor indica qué revisar, sin consultas, valores ni datos de conexión.
  private unavailable(error: unknown): never {
    if (isSchemaOutdated(error)) {
      this.logger.error('La base de datos no tiene la estructura que espera la API (Prisma ' + (error as { code: string }).code + '). Revisa las migraciones pendientes con npm run db:check.');
      throw new ServiceUnavailableException({ ok: false, mensaje: AUTH_UNAVAILABLE });
    }
    throw error;
  }

  // Registro público: cualquier visitante puede crear una cuenta, que nace SIN rol (rol NULL) y activa. Sin rol, AccessGuard le deniega
  // toda ruta con permiso (403); solo puede consultar su sesión y cambiar su contraseña. Asignar un rol sigue siendo exclusivo del
  // procedimiento auditado (npm run admin:assign-role). No devuelve token: la persona inicia sesión por /admin/login.
  async publicSignup(dto: PublicSignupDto) {
    if (dto.website) return { ...SIGNUP_CREATED }; // campo trampa relleno: envío automatizado; no se crea nada
    const email = dto.email.toLowerCase().trim();
    try {
      const exists = await this.prisma.adminUser.findFirst({ where: { email }, select: { id: true } });
      if (exists) throw new ConflictException({ ok: false, mensaje: SIGNUP_DUPLICATE });
      const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_COST);
      await this.prisma.$transaction(async tx => {
        const created = await tx.adminUser.create({
          data: { nombre: dto.nombre.trim(), email, password: hashedPassword, activo: true, rol: null },
          select: { id: true, activo: true },
        });
        await tx.adminAuditoria.create({ data: {
          origen: 'panel', actor_id: null, cuenta_id: created.id, operacion: 'cuenta_creada',
          rol_anterior: null, rol_nuevo: null, activo_anterior: null, activo_nuevo: created.activo, resultado: 'aplicado', motivo: PUBLIC_SIGNUP_REASON,
        } });
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isUniqueViolation(error)) throw new ConflictException({ ok: false, mensaje: SIGNUP_DUPLICATE });
      this.unavailable(error);
    }
    return { ...SIGNUP_CREATED };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.adminUser.findFirst({ where: { email: dto.email.toLowerCase().trim() } }).catch(error => this.unavailable(error));
    // bcrypt se ejecuta siempre: sin cuenta se compara contra un hash ficticio del mismo coste. La respuesta es la misma en los tres casos.
    const matches = await bcrypt.compare(dto.password, user?.password ?? DUMMY_PASSWORD_HASH);
    if (!user || user.activo === false || !matches) {
      throw new UnauthorizedException({ ok: false, mensaje: 'Credenciales incorrectas.' });
    }

    // El JWT no cambia (id, email, version): el rol y los permisos nunca viajan dentro del token.
    const token = this.generateToken(user);

    // Mismo contrato que GET /admin/me: el panel no vuelve a consultar /me tras iniciar sesión. El rol sale de la fila recién leída.
    return {
      ok: true,
      mensaje: 'Login correcto.',
      token,
      user: { id: user.id, nombre: user.nombre, email: user.email, ...sessionAccess(user.rol) },
      acceso: { modo: ACCESS_MODE },
    };
  }
}
