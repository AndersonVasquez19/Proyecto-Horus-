import { Type } from 'class-transformer';
import { Equals, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export class MapeoImportacionDto {
  @IsInt() @Min(0) @Max(39) doc_numero: number;
  @IsInt() @Min(0) @Max(39) nombres: number;
  @IsInt() @Min(0) @Max(39) apellidos: number;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) @Max(39) email?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) @Max(39) telefono?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) @Max(39) tipo_persona?: number;
}

export class ArchivoImportacionDto {
  @IsString() @MaxLength(150) @Matches(/^[^\\/\x00-\x1f]+\.csv$/i, { message: 'Solo se admite CSV. Exporta una hoja de Excel como CSV.' }) nombre: string;
  @IsIn(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', '']) mime: string;
  @IsString() @MaxLength(65536) @Matches(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) contenido: string;
}
export class PreviewImportacionDto extends ArchivoImportacionDto {
  @IsInt() @Min(1) @Max(2147483647) convocatoria_id: number;
  @IsInt() @Min(1) @Max(20) encabezado = 1;
  @IsIn(['auto', 'utf-8', 'windows-1252', 'utf-16le']) codificacion = 'auto';
  @ValidateIf((_o, v) => v !== undefined) @ValidateNested() @Type(() => MapeoImportacionDto) mapeo?: MapeoImportacionDto;
}
export class ConfirmarImportacionDto extends PreviewImportacionDto {
  @Equals(true, { message: 'Debes confirmar explícitamente la importación.' }) confirmar: boolean;
  @IsString() @MaxLength(1500) comprobante: string;
}
