import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, Max, Min, ValidateIf, ValidateNested, ValidateBy, isURL } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { trimValue } from '../common/validation';
import { isManagedUploadPath } from '../common/image-path';

const ImageUrl = (allowEmpty = false) => ValidateBy({
  name: 'convenioImageUrl',
  validator: { validate: (value: unknown) => typeof value === 'string' && ((allowEmpty && value === '') || isManagedUploadPath(value) ||
    isURL(value, { protocols: ['http', 'https'], require_protocol: true, require_tld: false })),
    defaultMessage: () => 'La imagen debe tener una URL HTTP/HTTPS válida o una ruta de imagen subida.' },
});

export class ConveniosQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ValidateIf((_, v) => v !== undefined) @Transform(trimValue) @IsString() @Length(0, 100) search?: string;
  // Solo filtra la lista administrativa; la pública impone visible=true.
  @ValidateIf((_, v) => v !== undefined) @IsIn(['visible', 'oculto']) estado?: string;
}

export class CreateConvenioDto {
  @Transform(trimValue) @IsString() @Length(1, 160) nombre: string;
  @ValidateIf((_, v) => v !== undefined) @Transform(trimValue) @IsString() @Length(0, 50) sigla?: string;
  @ValidateIf((_, v) => v !== undefined) @Transform(trimValue) @ImageUrl(true) @Length(0, 2048) logo_url?: string;
  @Transform(trimValue) @IsString() @Length(1, 2000) descripcion_corta: string;
  @ValidateIf((_, v) => v !== undefined) @Transform(trimValue) @IsString() @Length(0, 20000) descripcion_completa?: string;
  @ValidateIf((_, v) => v !== undefined) @Transform(trimValue) @IsString() @Length(0, 20000) informacion_adicional?: string;
  @ValidateIf((_, v) => v !== undefined) @IsInt() @Min(0) @Max(1000000) orden?: number;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() visible?: boolean;
}
export class UpdateConvenioDto extends PartialType(CreateConvenioDto, { skipNullProperties: false }) {}

export class CreateConvenioFotoDto {
  @Transform(trimValue) @ImageUrl() @Length(1, 2048) imagen_url: string;
  @ValidateIf((_, v) => v !== undefined) @IsInt() @Min(0) @Max(1000000) orden?: number;
}
export class UpdateConvenioFotoDto {
  @IsInt() @Min(0) @Max(1000000) orden: number;
}
export class FotoOrderDto extends UpdateConvenioFotoDto {
  @IsInt() @Min(1) id: number;
}
export class ReorderConvenioFotosDto {
  @IsArray() @ArrayMinSize(1) @ArrayUnique((item: FotoOrderDto) => item?.id)
  @ValidateNested({ each: true }) @Type(() => FotoOrderDto) fotos: FotoOrderDto[];
}
