import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { normalizeEmail, PHONE_PATTERN, trimValue } from '../common/validation';

// Nombres de personas: sin espacios exteriores y con los espacios internos (incluidos saltos de línea y tabulaciones) reducidos a uno.
// Así «Ana  María» y «Ana María» son el mismo nombre al buscar homónimos.
export const normalizeName = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

const DNI = /^[0-9]{8}$/;
const DNI_MESSAGE = 'El DNI debe tener exactamente 8 dígitos.';
export const DOCENTE_ROLES = ['principal', 'participante'] as const;
export type DocenteRolValue = (typeof DOCENTE_ROLES)[number];

// Alta. Solo nombres y apellidos son obligatorios; documento, especialidad, profesión, correo y teléfono son opcionales (cadena vacía = sin dato).
export class CreateDocenteDto {
  @Transform(normalizeName) @IsString() @IsNotEmpty({ message: 'Los nombres son obligatorios.' }) @MaxLength(120)
  nombres: string;

  @Transform(normalizeName) @IsString() @IsNotEmpty({ message: 'Los apellidos son obligatorios.' }) @MaxLength(120)
  apellidos: string;

  // Sin trim: no convertir un documento inválido (saltos de línea, espacios) en uno válido.
  @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @Matches(DNI, { message: DNI_MESSAGE }) @MaxLength(8)
  doc_numero?: string;

  @Transform(normalizeName) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MaxLength(120)
  especialidad?: string;

  @Transform(normalizeName) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MaxLength(120)
  profesion?: string;

  @Transform(normalizeEmail) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsEmail({}, { message: 'Introduce un correo válido.' }) @MaxLength(254)
  email?: string;

  @Transform(trimValue) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MaxLength(30)
  @Matches(PHONE_PATTERN, { message: 'Introduce un teléfono válido.' })
  telefono?: string;

  // Confirma que existe otra persona con los mismos nombres y apellidos (homónimo). Sin esta confirmación, el servicio responde 409.
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean()
  confirmar_homonimo?: boolean;
}

// Edición parcial. Exige la revisión vista por quien edita y al menos un campo. '' limpia un campo opcional; los obligatorios no admiten vacío.
export class UpdateDocenteDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;

  @ValidateIf((_o, v) => v !== undefined) @Transform(normalizeName) @IsString() @IsNotEmpty({ message: 'Los nombres son obligatorios.' }) @MaxLength(120)
  nombres?: string;

  @ValidateIf((_o, v) => v !== undefined) @Transform(normalizeName) @IsString() @IsNotEmpty({ message: 'Los apellidos son obligatorios.' }) @MaxLength(120)
  apellidos?: string;

  @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @Matches(DNI, { message: DNI_MESSAGE }) @MaxLength(8)
  doc_numero?: string;

  @Transform(normalizeName) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MaxLength(120)
  especialidad?: string;

  @Transform(normalizeName) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MaxLength(120)
  profesion?: string;

  @Transform(normalizeEmail) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsEmail({}, { message: 'Introduce un correo válido.' }) @MaxLength(254)
  email?: string;

  @Transform(trimValue) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MaxLength(30)
  @Matches(PHONE_PATTERN, { message: 'Introduce un teléfono válido.' })
  telefono?: string;
}

export class EstadoDocenteDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @IsBoolean() activo: boolean;
}

export class DocenteIdDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) id: number;
}

export class DocentesQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  // Palabras en nombres, apellidos o número de documento.
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @MaxLength(100) search?: string;
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @MaxLength(120) especialidad?: string;
  @IsIn(['activos', 'inactivos', 'todos']) estado: 'activos' | 'inactivos' | 'todos' = 'activos';
}

export class DocenteAsignacionesQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsIn(['activas', 'retiradas', 'todas']) estado: 'activas' | 'retiradas' | 'todas' = 'todas';
}

// --- Asignaciones docente ↔ edición ---------------------------------------------------------------------------------------

export class AsignacionIdDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) id: number;
}

export class CreateAsignacionDto {
  @IsInt() @Min(1) @Max(2147483647) docente_id: number;
  @IsInt() @Min(1) @Max(2147483647) convocatoria_id: number;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(DOCENTE_ROLES) rol?: DocenteRolValue;
}

export class RolAsignacionDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @IsIn(DOCENTE_ROLES) rol: DocenteRolValue;
}

export class RetiroAsignacionDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Indica el motivo.' }) @MaxLength(300) motivo: string;
}

export class ReactivacionAsignacionDto extends RetiroAsignacionDto {
  @ValidateIf((_o, v) => v !== undefined) @IsIn(DOCENTE_ROLES) rol?: DocenteRolValue;
}

export class SustitucionAsignacionDto extends ReactivacionAsignacionDto {
  @IsInt() @Min(1) @Max(2147483647) docente_id: number;
}

export class AsignacionesQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) convocatoria_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) docente_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(DOCENTE_ROLES) rol?: DocenteRolValue;
  @IsIn(['activas', 'retiradas', 'todas']) estado: 'activas' | 'retiradas' | 'todas' = 'activas';
}
