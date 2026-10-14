import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Autenticación')
@Controller('admin')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Alta de administradores: solo la hace una cuenta activa con sesión válida (JwtAuthGuard). No hay registro público.
  // La respuesta no incluye token: la persona creada inicia sesión por /admin/login con su propia contraseña.
  @Post('register')
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

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión como administrador' })
  @ApiResponse({ status: 200, description: 'Inicio de sesión exitoso con token JWT' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener datos del administrador autenticado' })
  @ApiResponse({ status: 200, description: 'Datos del usuario actual' })
  async me(@CurrentUser() user: any) {
    return { ok: true, user };
  }
}
