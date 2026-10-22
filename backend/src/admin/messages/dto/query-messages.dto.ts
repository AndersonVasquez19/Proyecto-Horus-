import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, ValidateIf } from 'class-validator';
import { ListQueryDto } from '../../../common/list-query.dto';
import { trimValue } from '../../../common/validation';

// Parámetros propios de la bandeja de consultas, además de page, limit, search, estado y channel (ver ListQueryDto). Todos opcionales:
// sin ellos la respuesta es la de siempre.
export class MessageQueryDto extends ListQueryDto {
  // `resumen`: listado con los datos mínimos para trabajar la bandeja (sin correo, teléfono ni mensaje completo). El detalle conserva todo.
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['resumen']) vista?: string;
  // Consultas cuyo seguimiento tiene exactamente este responsable.
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @Length(0, 100) responsable?: string;
  // `si`: solo consultas nuevas o en proceso con más de 48 horas (el mismo criterio que HORUS Assistant).
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['si']) antiguas?: string;
}
