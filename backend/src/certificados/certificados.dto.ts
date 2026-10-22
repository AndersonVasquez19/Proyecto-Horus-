import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trimValue } from '../common/validation';
import { CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';

export class CertificadosQueryDto extends CursosConvocatoriaQueryDto {
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) matricula_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) convocatoria_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) estudiante_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['vigente', 'anulado']) estado?: 'vigente' | 'anulado';
}
export class CertificadoIdDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) id: number;
}
// matricula_revision: la revisión de la matrícula que vio quien emite; si el cumplimiento cambió entretanto, la emisión se rechaza.
export class EmitirCertificadoDto {
  @IsInt() @Min(1) @Max(2147483647) matricula_id: number;
  @IsInt() @Min(1) @Max(2147483646) matricula_revision: number;
}
export class AnularCertificadoDto {
  @Transform(trimValue) @IsString() @IsNotEmpty() @MaxLength(300) motivo: string;
}
// Sustituir = anular el vigente (o partir de uno anulado sin sustituto) y emitir otro con los datos ACTUALES del estudiante y la edición.
export class SustituirCertificadoDto extends AnularCertificadoDto {}
