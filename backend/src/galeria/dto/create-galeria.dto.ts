import { Transform } from 'class-transformer';
import { trimValue } from '../../common/validation';
import { Matches, IsBoolean, IsInt, IsNotEmpty, ValidateIf, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGaleriaDto {
  @ApiProperty({ example: 'Capacitación en Primeros Auxilios' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 150)
  titulo: string;

  @ApiPropertyOptional({ example: 'Taller práctico realizado con el personal.' })
  @Transform(trimValue)
  @IsString()
  @ValidateIf((_, value) => value !== undefined)
  descripcion?: string;

  @ApiProperty({ example: 'capacitaciones' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  categoria: string;

  @ApiProperty({ example: '/galeria/capacitaciones/imagen-1.jpg' })
  @Transform(trimValue)
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:https?:\/\/[^\s/]+(?:\/[^\s]*)?|\/(?!\/)[^\s\\\\]*)$/)
  @Length(1, 500)
  imagen_url: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @ValidateIf((_, value) => value !== undefined)
  orden?: number;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @ValidateIf((_, value) => value !== undefined)
  activo?: boolean;
}
