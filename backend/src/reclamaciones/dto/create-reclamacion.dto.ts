import { Transform } from 'class-transformer';
import { trimValue, normalizeEmail } from '../../common/validation';
import { IsISO8601, Matches, MaxLength, IsBoolean, IsEmail, IsIn, IsNotEmpty, ValidateIf, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReclamacionDto {
  @ApiProperty({ example: 'Carlos' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nombres: string;

  @ApiProperty({ example: 'Ramirez' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  apellidos: string;

  @ApiPropertyOptional({ example: 'DNI' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @MaxLength(255)
  tipo_doc?: string;

  @ApiPropertyOptional({ example: '76543210' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @MaxLength(255)
  num_doc?: string;

  @ApiProperty({ example: 'carlos@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: '987654321' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  telefono: string;

  @ApiPropertyOptional({ example: 'Av. Las Palmeras 123' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @MaxLength(255)
  direccion?: string;

  @ApiProperty({ enum: ['reclamo', 'queja'], example: 'reclamo' })
  @IsIn(['reclamo', 'queja'])
  tipo_registro: 'reclamo' | 'queja';

  @ApiProperty({ example: 'Soporte y Mantenimiento' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  area: string;

  @ApiProperty({ example: '2026-03-01' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  fecha_incidente: string;

  @ApiProperty({ example: 'Servicio de mantenimiento de cámaras' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  descripcion_bien: string;

  @ApiProperty({ example: 'No se presentaron a la hora acordada' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  detalle_reclamo: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @ValidateIf((_, value) => value !== undefined)
  acepta_comunicaciones?: boolean;
}
