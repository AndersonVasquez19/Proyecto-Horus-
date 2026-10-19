import { Type } from 'class-transformer';
import { IsIn, IsInt, ValidateIf } from 'class-validator';

export const ACTIVITY_DAYS = [7, 30, 90] as const;

export class ActivityQueryDto {
  // Ventana en días del gráfico de actividad. Solo se aceptan valores cerrados para acotar la consulta.
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @IsIn(ACTIVITY_DAYS) dias?: number;
}
