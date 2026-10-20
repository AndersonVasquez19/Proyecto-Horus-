import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf, registerDecorator } from 'class-validator';
import { trimValue } from '../common/validation';
import { isCalendarDate, TIME_PATTERN } from './sesiones.time';

export const SESION_MODALIDADES = ['presencial', 'virtual', 'hibrida'] as const;
export const SESION_ESTADOS = ['programada', 'realizada', 'cancelada'] as const;
export type SesionModalidadValue = (typeof SESION_MODALIDADES)[number];
export type SesionEstadoValue = (typeof SESION_ESTADOS)[number];

// Textos de una línea (título, lugar): sin espacios exteriores y con los internos reducidos a uno.
const collapse = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const HOUR_MESSAGE = 'La hora debe tener el formato HH:MM (24 horas, hora de Lima).';
const DATE_MESSAGE = 'La fecha debe ser un día real con el formato AAAA-MM-DD (entre 2000 y 2100).';
// Enlace de reunión: solo https, sin espacios (la misma regla que sesiones_enlace_chk en MySQL).
const LINK = /^https:\/\/\S+$/;
const LINK_MESSAGE = 'El enlace debe empezar por https:// y no contener espacios.';

function IsCalendarDate(): PropertyDecorator {
  return (target, propertyKey) => registerDecorator({
    name: 'isCalendarDate', target: target.constructor, propertyName: String(propertyKey), options: { message: DATE_MESSAGE },
    validator: { validate: (value: unknown) => isCalendarDate(value) },
  });
}

const present = (_object: unknown, value: unknown) => value !== undefined;
const presentOrCleared = (_object: unknown, value: unknown) => value !== undefined && value !== '';

// Alta. Obligatorios: edición, título, fecha y horas. La modalidad se hereda del curso si se omite (y el curso la tiene); lugar, enlace
// y observaciones son opcionales (cadena vacía = sin dato). El estado y la revisión no se envían: nace «programada».
export class CreateSesionDto {
  @IsInt() @Min(1) @Max(2147483647) convocatoria_id: number;
  @Transform(collapse) @IsString() @IsNotEmpty({ message: 'El título es obligatorio.' }) @MaxLength(160) titulo: string;
  @IsString() @IsCalendarDate() fecha: string;
  @IsString() @Matches(TIME_PATTERN, { message: HOUR_MESSAGE }) hora_inicio: string;
  @IsString() @Matches(TIME_PATTERN, { message: HOUR_MESSAGE }) hora_fin: string;
  // Docente del equipo de la edición (se resuelve su asignación). Omitido = sin docente definido.
  @ValidateIf(present) @IsInt() @Min(1) @Max(2147483647) docente_id?: number;
  @ValidateIf(present) @IsIn(SESION_MODALIDADES) modalidad?: SesionModalidadValue;
  @Transform(collapse) @ValidateIf(presentOrCleared) @IsString() @MaxLength(200) lugar?: string;
  @Transform(trimValue) @ValidateIf(presentOrCleared) @IsString() @MaxLength(2048) @Matches(LINK, { message: LINK_MESSAGE }) enlace_url?: string;
  @Transform(trimValue) @ValidateIf(presentOrCleared) @IsString() @MaxLength(500) observaciones?: string;
}

// Edición parcial. Exige la revisión vista y al menos un campo. '' limpia lugar, enlace y observaciones; `docente_id: null` quita al
// docente. Cambiar la fecha, las horas o el docente es reprogramar: exige `motivo` (se guarda en el historial).
export class UpdateSesionDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @ValidateIf(present) @Transform(collapse) @IsString() @IsNotEmpty({ message: 'El título es obligatorio.' }) @MaxLength(160) titulo?: string;
  @ValidateIf(present) @IsString() @IsCalendarDate() fecha?: string;
  @ValidateIf(present) @IsString() @Matches(TIME_PATTERN, { message: HOUR_MESSAGE }) hora_inicio?: string;
  @ValidateIf(present) @IsString() @Matches(TIME_PATTERN, { message: HOUR_MESSAGE }) hora_fin?: string;
  @ValidateIf((_o, v) => v !== undefined && v !== null) @IsInt() @Min(1) @Max(2147483647) docente_id?: number | null;
  @ValidateIf(present) @IsIn(SESION_MODALIDADES) modalidad?: SesionModalidadValue;
  @Transform(collapse) @ValidateIf(presentOrCleared) @IsString() @MaxLength(200) lugar?: string;
  @Transform(trimValue) @ValidateIf(presentOrCleared) @IsString() @MaxLength(2048) @Matches(LINK, { message: LINK_MESSAGE }) enlace_url?: string;
  @Transform(trimValue) @ValidateIf(presentOrCleared) @IsString() @MaxLength(500) observaciones?: string;
  @Transform(trimValue) @ValidateIf(present) @IsString() @IsNotEmpty({ message: 'Indica el motivo.' }) @MaxLength(300) motivo?: string;
}

export class EstadoSesionDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @IsIn(SESION_ESTADOS) estado: SesionEstadoValue;
  // Obligatorio al cancelar y al reabrir una realizada; opcional al marcarla como realizada.
  @Transform(trimValue) @ValidateIf(present) @IsString() @IsNotEmpty({ message: 'Indica el motivo.' }) @MaxLength(300) motivo?: string;
}

export class SesionIdDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) id: number;
}

class PageQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ValidateIf(present) @IsIn(SESION_ESTADOS) estado?: SesionEstadoValue;
  // Días de calendario de Lima, ambos incluidos.
  @ValidateIf(present) @IsString() @IsCalendarDate() desde?: string;
  @ValidateIf(present) @IsString() @IsCalendarDate() hasta?: string;
  // Orden por fecha y hora; el desempate por id mantiene un orden estable entre páginas.
  @IsIn(['asc', 'desc']) orden: 'asc' | 'desc' = 'asc';
}

export class SesionesQueryDto extends PageQuery {
  @ValidateIf(present) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) convocatoria_id?: number;
  @ValidateIf(present) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) docente_id?: number;
}

export class EdicionSesionesQueryDto extends PageQuery {
  @ValidateIf(present) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) docente_id?: number;
}
