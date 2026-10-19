import { Transform } from 'class-transformer';
import { trimValue } from '../../common/validation';
import { Matches, IsBoolean, IsInt, ValidateIf, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGaleriaDto {
  @ApiPropertyOptional({ example: 'Capacitación en Primeros Auxilios' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @Length(1, 150)
  titulo?: string;

  @ApiPropertyOptional({ example: 'Taller práctico actualizado.' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  descripcion?: string;

  @ApiPropertyOptional({ example: 'capacitaciones' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @Length(1, 50)
  categoria?: string;

  @ApiPropertyOptional({ example: '/galeria/capacitaciones/imagen-1.jpg' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  @Matches(/^(?:https?:\/\/[^\s/]+(?:\/[^\s]*)?|\/(?!\/)[^\s\\\\]*)$/)
  @Length(1, 500)
  imagen_url?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @ValidateIf((_, value) => value !== undefined)
  orden?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @ValidateIf((_, value) => value !== undefined)
  activo?: boolean;
}
