import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExtractJwt } from 'passport-jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { ACCESS_METADATA } from './access.decorators';
import { requirementFor } from './access';
import { canAll } from './policy';
import { AdminRole, isAdminRole } from './roles';

// E3.6 — ACTIVA. AppModule la registra como APP_GUARD, después de PublicRateLimitGuard, junto con ACCESS_MODE = 'por_roles'.
// Ningún otro módulo la registra (ni con @UseGuards ni como APP_GUARD). Los JwtAuthGuard locales de los controladores se conservan.

export const UNAUTHORIZED_MESSAGE = 'Usuario no encontrado o inactivo.';
// Cuenta básica (sin rol): la sesión es válida y conserva el autoservicio, pero esta operación es administrativa.
export const NO_ROLE_MESSAGE = 'Esta función requiere permisos adicionales. Tu cuenta es básica: solicita a la gerencia que te asigne un rol.';
export const FORBIDDEN_MESSAGE = 'No tienes permiso para realizar esta operación.';

export interface AccountAccess { activo: boolean; sessionVersion: number; rol: AdminRole | null }

// Estado VIGENTE de la cuenta, leído de la base en cada solicitud protegida por permiso. El rol nunca se toma del JWT ni de la
// solicitud: un rol retirado, una cuenta desactivada o una sesión revocada surten efecto en la siguiente solicitud.
@Injectable()
export class AccountAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async find(id: number): Promise<AccountAccess | null> {
    const row = await this.prisma.adminUser.findUnique({ where: { id }, select: { activo: true, session_version: true, rol: true } });
    if (!row) return null;
    return { activo: row.activo !== false, sessionVersion: row.session_version ?? 1, rol: isAdminRole(row.rol) ? row.rol : null };
  }
}

// Versión de sesión del token ya verificado por JwtAuthGuard en esta misma solicitud (mismo extractor que JwtStrategy).
function tokenVersion(request: unknown): number | null {
  try {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request as never);
    const payload = token ? JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) : null;
    if (!payload || typeof payload !== 'object') return null;
    const version = payload.version ?? 1;
    return Number.isSafeInteger(version) ? version : null;
  } catch { return null; }
}

const unauthorized = () => new UnauthorizedException({ ok: false, mensaje: UNAUTHORIZED_MESSAGE });
const forbidden = (mensaje = FORBIDDEN_MESSAGE) => new ForbiddenException({ ok: false, mensaje });

// 401: falta la sesión o ya no es válida (token inválido o caducado, cuenta inexistente o desactivada, sesión revocada).
// 403: la sesión es válida pero no alcanza: ruta sin clasificar, recurso desconocido, cuenta sin rol o rol sin el permiso.
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authentication: JwtAuthGuard,
    private readonly accounts: AccountAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') throw forbidden();
    const request = context.switchToHttp().getRequest();
    const access = this.reflector.getAllAndOverride<unknown>(ACCESS_METADATA, [context.getHandler(), context.getClass()]);
    const requirement = requirementFor(access, request);
    if (requirement.kind === 'publica') return true;

    // Autenticación actual sin cambios (JwtStrategy: firma, emisor, audiencia, caducidad, cuenta activa y session_version).
    if (!(await this.authentication.canActivate(context))) throw unauthorized();
    if (requirement.kind === 'autenticada') return true;
    if (requirement.kind === 'denegada') throw forbidden();

    const id = request.user?.id;
    const version = tokenVersion(request);
    if (!Number.isSafeInteger(id) || id <= 0 || version === null) throw unauthorized();
    const account = await this.accounts.find(id);
    if (!account || !account.activo || account.sessionVersion !== version) throw unauthorized();
    if (!account.rol) throw forbidden(NO_ROLE_MESSAGE);
    if (!canAll(account.rol, requirement.permissions)) throw forbidden();
    return true;
  }
}
