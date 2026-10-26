import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, registerDecorator, ValidateIf } from 'class-validator';
import { trimValue } from '../common/validation';

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const CalendarDate = (): PropertyDecorator => (target, propertyKey) => registerDecorator({
  name: 'calendarDate', target: target.constructor, propertyName: String(propertyKey),
  validator: { validate: isCalendarDate, defaultMessage: () => 'Introduce una fecha válida en formato AAAA-MM-DD.' },
});
export class RevisionConvocatoriaDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
}
export class CreateConvocatoriaDto {
  @IsInt() @Min(1) @Max(2147483647) curso_id: number;
  @Transform(trimValue) @IsString() @IsNotEmpty() @MaxLength(160) nombre: string;
  @CalendarDate() fecha_inicio: string;
  @CalendarDate() fecha_fin: string;
  @IsInt() @Min(1) @Max(2147483647) capacidad: number;
}
export class UpdateConvocatoriaDto extends RevisionConvocatoriaDto {
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @IsNotEmpty() @MaxLength(160) nombre?: string;
  @ValidateIf((_o, v) => v !== undefined) @CalendarDate() fecha_inicio?: string;
  @ValidateIf((_o, v) => v !== undefined) @CalendarDate() fecha_fin?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(1) @Max(2147483647) capacidad?: number;
}
export class CierreConvocatoriaDto extends RevisionConvocatoriaDto {
  @IsIn(['cerrada', 'cancelada']) estado: 'cerrada' | 'cancelada';
}
// Recepción de preinscripciones: independiente de la apertura académica. Lo decide Gerencia o Coordinación (convocatorias:editar).
export class RecepcionPreinscripcionDto extends RevisionConvocatoriaDto {
  @IsIn(['abierta', 'cerrada']) estado: 'abierta' | 'cerrada';
}
export class ArchivoConvocatoriaDto extends RevisionConvocatoriaDto {
  @IsBoolean() archivado: boolean;
}
export class CursosConvocatoriaQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @MaxLength(100) search?: string;
}
export class ConvocatoriasQueryDto extends CursosConvocatoriaQueryDto {
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) curso_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['planificada', 'abierta', 'cerrada', 'cancelada']) estado?: 'planificada' | 'abierta' | 'cerrada' | 'cancelada';
  @IsIn(['activos', 'archivados', 'todos']) archivo: 'activos' | 'archivados' | 'todos' = 'activos';
}
export class ConvocatoriaIdDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) id: number;
}
