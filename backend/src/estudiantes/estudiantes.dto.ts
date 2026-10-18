import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { normalizeEmail, PHONE_PATTERN, trimValue } from '../common/validation';

export class CreateEstudianteDto {
  @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Los nombres son obligatorios.' }) @MaxLength(120)
  nombres: string;

  @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Los apellidos son obligatorios.' }) @MaxLength(120)
  apellidos: string;

  // Sin trim: no convertir un documento inválido (saltos de línea, espacios) en uno válido.
  @IsString() @Matches(/^[0-9]{8}$/, { message: 'El DNI debe tener exactamente 8 dígitos.' }) @MaxLength(8)
  doc_numero: string;

  @Transform(normalizeEmail) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsEmail({}, { message: 'Introduce un correo válido.' }) @MaxLength(254)
  email?: string;

  @Transform(trimValue) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MaxLength(30)
  @Matches(PHONE_PATTERN, { message: 'Introduce un teléfono válido.' })
  telefono?: string;
}

export class UpdateEstudianteDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Los nombres son obligatorios.' }) @MaxLength(120)
  nombres?: string;
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Los apellidos son obligatorios.' }) @MaxLength(120)
  apellidos?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @Matches(/^[0-9]{8}$/, { message: 'El DNI debe tener exactamente 8 dígitos.' }) @MaxLength(8)
  doc_numero?: string;
  @Transform(normalizeEmail) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsEmail({}, { message: 'Introduce un correo válido.' }) @MaxLength(254)
  email?: string;
  @Transform(trimValue) @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MaxLength(30)
  @Matches(PHONE_PATTERN, { message: 'Introduce un teléfono válido.' })
  telefono?: string;
}

export class ArchivoEstudianteDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
  @IsBoolean() archivado: boolean;
}

export class EstudiantesQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @MaxLength(100) search?: string;
  @IsIn(['activos', 'archivados', 'todos']) estado: 'activos' | 'archivados' | 'todos' = 'activos';
}

export class EstudianteIdDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) id: number;
}
