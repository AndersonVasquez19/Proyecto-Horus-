import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PublicSignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRoute, PublicRoute, RequirePermission } from '../../permissions/access.decorators';
import { ACCESS_MODE, sessionAccess } from '../../permissions/session-access';

@ApiTags('Admin - Autenticación')
@Controller('admin')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Alta de cuentas por un administrador: solo la hace una cuenta activa con sesión válida (JwtAuthGuard) y el permiso cuentas:crear.
  // El registro público es otra ruta (POST /admin/signup). La respuesta no incluye token: la persona creada inicia sesión por /admin/login.
  @Post('register')
  @RequirePermission('cuentas:crear')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un administrador (requiere sesión de administrador)' })
  @ApiResponse({ status: 201, description: 'Administrador creado exitosamente' })
  @ApiResponse({ status: 401, description: 'Sin sesión válida' })
  async register(@Body() dto: RegisterDto, @CurrentUser('id') actor: number) {
    const { token: _issued, ...created } = await this.authService.register(dto, actor);
    return created;
  }

  // Registro público: sin sesión. La cuenta nace sin rol y por tanto sin acceso a las secciones del panel hasta que la gerencia le asigne
  // uno con el procedimiento auditado. Campos ajenos al DTO (rol, permisos, activo…) se rechazan con 400. Limitado por IP en
  // PublicRateLimitGuard (por minuto y por hora) y con un campo trampa contra envíos automatizados.
  @Post('signup')
  @PublicRoute()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una cuenta (registro público, sin rol ni acceso al panel hasta su autorización)' })
  @ApiResponse({ status: 201, description: 'Cuenta creada sin rol' })
  @ApiResponse({ status: 400, description: 'Datos no válidos o campos no permitidos' })
  @ApiResponse({ status: 409, description: 'Ya existe una cuenta con ese correo' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  async signup(@Body() dto: PublicSignupDto) {
    return this.authService.publicSignup(dto);
  }

  @Post('login')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión como administrador' })
  @ApiResponse({ status: 200, description: 'Inicio de sesión exitoso con token JWT' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @AuthenticatedRoute()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener datos del administrador autenticado' })
  @ApiResponse({ status: 200, description: 'Datos del usuario actual, su rol vigente (o null), sus permisos y el modo de acceso' })
  @ApiResponse({ status: 401, description: 'Sin sesión válida' })
  async me(@CurrentUser() user: { id: number; nombre: string; email: string; rol: unknown }) {
    // `user` lo construye JwtStrategy con la fila leída de la base en esta misma solicitud: no hace falta otra consulta.
    // Respuesta con campos explícitos: nunca contraseña, session_version ni datos de recuperación.
    return { ok: true, user: { id: user.id, nombre: user.nombre, email: user.email, ...sessionAccess(user.rol) }, acceso: { modo: ACCESS_MODE } };
  }
}
