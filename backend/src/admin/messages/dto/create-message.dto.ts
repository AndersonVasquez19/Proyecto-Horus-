import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';
import { PHONE_PATTERN, trimValue } from '../../../common/validation';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAdminMessageDto {
  @ApiProperty({ example: 'Mario Lopez' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  nombre: string;

  @ApiProperty({ example: 'mario@example.com' })
  @Transform(trimValue)
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '998877665' })
  @Transform(trimValue)
  @IsString()
  @IsOptional()
  @Length(1, 30)
  @Matches(PHONE_PATTERN, { message: 'telefono debe tener un formato válido' })
  telefono?: string;

  @ApiProperty({ example: 'Instalación de cámaras' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 150)
  asunto: string;

  @ApiProperty({ example: 'Requiero instalación en 3 sucursales' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 5000)
  mensaje: string;
}
