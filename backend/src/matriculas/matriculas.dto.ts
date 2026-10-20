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
export class ReactivarMatriculaDto extends AnularMatriculaDto {
  @IsInt() @Min(1) @Max(2147483646) convocatoria_revision: number;
}
