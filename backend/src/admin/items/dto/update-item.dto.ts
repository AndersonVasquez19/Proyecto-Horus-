import { Transform } from 'class-transformer';
import { trimValue } from '../../../common/validation';
import { IsIn, ValidateIf, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateItemDto {
  @ApiPropertyOptional({ example: 'Título actualizado' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @Length(1, 150)
  titulo?: string;

  @ApiPropertyOptional({ example: 'Descripción actualizada' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @Length(1, 5000)
  descripcion?: string;

  @ApiPropertyOptional({ enum: ['general', 'servicio', 'contenido'] })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['general', 'servicio', 'contenido'])
  categoria?: string;

  @ApiPropertyOptional({ enum: ['activo', 'inactivo'] })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['activo', 'inactivo'])
  estado?: string;
}
