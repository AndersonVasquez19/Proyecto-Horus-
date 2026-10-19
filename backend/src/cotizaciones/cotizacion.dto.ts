import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested, ValidateIf } from 'class-validator';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class ConceptoDto {
  @Transform(trim) @IsString() @Length(1, 500) descripcion: string;
  @IsInt() @Min(1) @Max(10000) cantidad: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) precio: number;
}
export class CotizacionDto {
  @Transform(trim) @IsString() @Length(1, 160) cliente: string;
  @Transform(trim) @IsString() @Length(0, 254) email: string;
  @Transform(trim) @IsString() @Length(0, 30) telefono: string;
  @Transform(trim) @IsString() @Length(0, 30) documento: string;
  @Transform(trim) @IsString() @Length(0, 300) direccion: string;
  @Transform(trim) @IsString() @Length(1, 160) emisor: string;
  @Transform(trim) @IsString() @Length(0, 500) datos_emisor: string;
  @IsIn(['PEN', 'USD']) moneda: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) validez: string;
  @Transform(trim) @IsString() @Length(0, 5000) condiciones: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ConceptoDto) conceptos: ConceptoDto[];
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10000000000) descuento: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) tasa: number;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) contacto_id?: number;
}
export class EditCotizacionDto extends CotizacionDto {
  @IsInt() @Min(1) revision: number;
}
// confirmar_reenvio: confirmación expresa para volver a enviar una cotización ya aceptada, incierta o con un envío sin resultado.
export class SendCotizacionDto { @IsInt() @Min(1) revision: number; @IsOptional() @IsBoolean() confirmar_reenvio?: boolean; }
export class EstadoCotizacionDto {
  @IsIn(['enviada', 'aceptada', 'rechazada', 'anulada']) estado: string;
  @IsInt() @Min(1) revision: number;
}
export class CotizacionQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 12;
  @IsString() @Length(0, 100) search: string = '';
  @IsIn(['', 'borrador', 'enviada', 'aceptada', 'rechazada', 'anulada']) estado: string = '';
}
