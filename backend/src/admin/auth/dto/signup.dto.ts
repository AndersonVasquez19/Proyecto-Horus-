import { Transform } from 'class-transformer';
import { normalizeEmail, trimValue, MaxUtf8Bytes } from '../../../common/validation';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Registro público (POST /api/admin/signup). Solo admite estos campos: con forbidNonWhitelisted, cualquier otro (rol, permisos, activo,
// id, session_version…) hace que la solicitud se rechace con 400 antes de llegar al servicio. La cuenta nace siempre sin rol.
export class PublicSignupDto {
  @ApiProperty({ example: 'Nombre Apellido' })
  @IsString()
  @IsNotEmpty()
  @Transform(trimValue)
  @Length(1, 100)
  nombre: string;

  @ApiProperty({ example: 'persona@ejemplo.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'contraseña-de-ejemplo' })
  @IsString()
  @IsNotEmpty()
  @MaxUtf8Bytes(72)
  @Length(8, 72)
  password: string;

  // Campo trampa: el formulario lo oculta a las personas (y a los lectores de pantalla). Un envío automatizado que lo rellena recibe la
  // misma respuesta que un registro correcto, pero no se crea ninguna cuenta.
  @ApiPropertyOptional({ description: 'Debe quedar vacío.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
