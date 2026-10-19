import { Transform } from 'class-transformer';
import { trimValue } from '../../../common/validation';
import { IsIn, IsNotEmpty, ValidateIf, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateItemDto {
  @ApiProperty({ example: 'Nuevo Servicio de Fibra Óptica' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 150)
  titulo: string;

  @ApiProperty({ example: 'Instalación y certificación de fibra monomodo y multimodo.' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 5000)
  descripcion: string;

  @ApiPropertyOptional({ enum: ['general', 'servicio', 'contenido'], default: 'general' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['general', 'servicio', 'contenido'])
  categoria?: string;

  @ApiPropertyOptional({ enum: ['activo', 'inactivo'], default: 'activo' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['activo', 'inactivo'])
  estado?: string;
}
