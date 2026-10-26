import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { TIME_PATTERN } from '../common/lima-time';
import { MAX_HORARIOS } from './horarios.rules';

const HOUR_MESSAGE = 'La hora debe tener el formato HH:MM (24 horas, hora de Lima).';
const DAY_MESSAGE = 'El día de la semana debe ser un número del 1 (lunes) al 7 (domingo).';

// Un tramo semanal: día ISO-8601 (1 = lunes … 7 = domingo) y horas HH:MM. Que fin > inicio y que no se solape con otros lo comprueba
// validateTramos (422), porque depende de varios campos o de varios tramos.
export class HorarioTramoDto {
  @IsInt({ message: DAY_MESSAGE }) @Min(1, { message: DAY_MESSAGE }) @Max(7, { message: DAY_MESSAGE }) dia_semana: number;
  @IsString() @Matches(TIME_PATTERN, { message: HOUR_MESSAGE }) hora_inicio: string;
  @IsString() @Matches(TIME_PATTERN, { message: HOUR_MESSAGE }) hora_fin: string;
}

// Reemplazo controlado del conjunto completo de horarios de la edición. `revision` es la de la EDICIÓN (la misma que usan Editar, abrir,
// cerrar y archivar): si cambió, 409 sin escribir nada. Una lista vacía deja la edición sin horarios (operación explícita, no un error).
// Campos ajenos (id, convocatoria_id, fechas, estados…) se rechazan con 400: el cliente no elige ids ni la edición del cuerpo.
export class ReemplazoHorariosDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @IsArray() @ArrayMaxSize(MAX_HORARIOS, { message: `Una edición admite como máximo ${MAX_HORARIOS} horarios.` })
  @ValidateNested({ each: true }) @Type(() => HorarioTramoDto) horarios: HorarioTramoDto[];
}

export class HorariosEdicionIdDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) id: number;
}
