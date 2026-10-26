import { Type, Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trimValue } from '../common/validation';
import { CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';

export class MatriculasQueryDto extends CursosConvocatoriaQueryDto {
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) estudiante_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) curso_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) convocatoria_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['activa', 'anulada']) estado?: 'activa' | 'anulada';
}
export class EdicionesMatriculaQueryDto extends CursosConvocatoriaQueryDto {
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) curso_id?: number;
}
export class CreateMatriculaDto {
  @IsInt() @Min(1) @Max(2147483647) estudiante_id: number;
  @IsInt() @Min(1) @Max(2147483647) convocatoria_id: number;
  @IsInt() @Min(1) @Max(2147483646) convocatoria_revision: number;
}
export class AnularMatriculaDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @Transform(trimValue) @IsString() @IsNotEmpty() @MaxLength(300) motivo: string;
}
// Confirmación administrativa del cumplimiento (no es una calificación). El motivo es opcional en la primera confirmación y
// obligatorio al corregirla o devolverla a «pendiente» (lo exige el servicio, que conoce el estado guardado).
export const CUMPLIMIENTOS = ['pendiente', 'cumplido', 'no_cumplido'] as const;
export class ConfirmarCumplimientoDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @IsIn(CUMPLIMIENTOS) cumplimiento: (typeof CUMPLIMIENTOS)[number];
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @IsNotEmpty() @MaxLength(300) motivo?: string;
}
export class ReactivarMatriculaDto extends AnularMatriculaDto {
  @IsInt() @Min(1) @Max(2147483646) convocatoria_revision: number;
}
