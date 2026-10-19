import { IsEmail, IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimValue, normalizeEmail, PHONE_PATTERN } from '../../common/validation';
import { ApiProperty } from '@nestjs/swagger';

export class CreateContactoDto {
  @ApiProperty({ example: 'Juan Perez', description: 'Nombre completo' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  nombre: string;

  @ApiProperty({ example: 'juan@example.com', description: 'Correo electrónico' })
  @Transform(normalizeEmail)
  @IsEmail()
  @Length(1, 254)
  email: string;

  @ApiProperty({ example: '999888777', description: 'Número telefónico' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 30)
  @Matches(PHONE_PATTERN, { message: 'telefono debe tener un formato válido' })
  telefono: string;

  @ApiProperty({ example: 'Consulta sobre cámaras', description: 'Asunto de la consulta' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 150)
  asunto: string;

  @ApiProperty({ example: 'Quisiera cotizar 4 cámaras IP para mi negocio', description: 'Mensaje detallado' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 5000)
  mensaje: string;
}
