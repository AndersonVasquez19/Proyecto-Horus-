import { Transform, Type } from 'class-transformer';
import { IsArray, ArrayUnique, IsString, Length, IsIn, IsInt, Min, Max, IsISO8601, Matches, ValidateIf, ValidateBy, isURL } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

import { isManagedUploadPath } from '../common/image-path';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

const PublicImageUrl=()=>ValidateBy({
  name:'publicImageUrl',
  validator:{
    validate:(value:unknown)=>typeof value==='string'&&(isManagedUploadPath(value)||/^\/site-original\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(value)||isURL(value,{protocols:['https','http'],require_protocol:true})),
    defaultMessage:()=> 'imagen_url debe ser una URL HTTP/HTTPS válida o una imagen de /api/uploads/ o /site-original/.',
  },
});

export class CatalogoQueryDto {
  @ValidateIf((_object,value)=>value!==undefined) @IsIn(['upcoming','unscheduled','past']) periodo?:string;
  @ApiPropertyOptional({ enum: ['curso', 'capacitacion'] })
  @ValidateIf((_, value) => value !== undefined) @IsIn(['curso', 'capacitacion'])
  tipo?: string;

  @ApiPropertyOptional({ enum: ['presencial', 'virtual', 'hibrida'] })
  @ValidateIf((_, value) => value !== undefined) @IsIn(['presencial', 'virtual', 'hibrida'])
  modalidad?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined) @Transform(trim) @IsString() @Length(1, 100)
  categoria?: string;

  @ApiPropertyOptional({ default: 1 })
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt() @Min(1) @Max(1000000)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt() @Min(1) @Max(100)
  limit = 20;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim) @IsString() @Length(1, 100)
  search?: string;

  @ApiPropertyOptional({ enum: ['borrador', 'publicado', 'archivado'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['borrador', 'publicado', 'archivado'])
  estado?: string;
}

export class VisualContentDto {
  @ApiPropertyOptional({ enum: ['indigo','coral','verde','violeta','oscuro'] })
  @ValidateIf((_,v)=>v!==undefined) @IsIn(['indigo','coral','verde','violeta','oscuro']) color?:string;
  @ApiPropertyOptional({ minimum:0 })
  @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(0) @Max(1000000) orden?:number;
  @ApiPropertyOptional({ enum: ['heart','legal','finance','technology','education','business','network','camera','bell','cloud','mobile','tools','software','emergency','star','users','target','handshake'] })
  @ValidateIf((_,v)=>v!==undefined) @IsIn(['heart','legal','finance','technology','education','business','network','camera','bell','cloud','mobile','tools','software','emergency','star','users','target','handshake']) icono?:string;
}

export class CreateCursoDto extends VisualContentDto {
  @ApiPropertyOptional() @ValidateIf((_,v)=>v!==undefined) @Transform(trim) @IsString() @Length(1,80) area?:string;
  @ApiPropertyOptional() @ValidateIf((_,v)=>v!==undefined) @Transform(trim) @IsString() @Length(1,150) certificacion?:string;
  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 160)
  titulo: string;

  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 180) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 20000)
  descripcion: string;

  @ApiProperty({ enum: ["curso","capacitacion"] })
  @Transform(trim)
  @IsIn(["curso","capacitacion"])
  tipo: string;

  @ApiPropertyOptional({ enum: ["presencial","virtual","hibrida"], description: "Obligatoria para cursos; puede quedar pendiente en programas de capacitación." })
  @ValidateIf((o,v)=>o.tipo!=='capacitacion'||v!==undefined)
  @Transform(trim)
  @IsIn(["presencial","virtual","hibrida"])
  modalidad?: string;

  @ApiPropertyOptional()
  @ValidateIf((o,v)=>o.tipo!=='capacitacion'||v!==undefined)
  @Transform(trim)
  @IsString() @Length(1, 120)
  duracion?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString() @Length(1, 20000)
  temario?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @PublicImageUrl() @Length(1, 2048)
  imagen_url?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsISO8601({ strict: true })
  fecha_inicio?: string;

  @ApiPropertyOptional({ enum: ["borrador","publicado","archivado"] })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsIn(["borrador","publicado","archivado"])
  estado?: string;
}
export class UpdateCursoDto extends PartialType(CreateCursoDto, { skipNullProperties: false }) {
  @ApiPropertyOptional({ enum: ['imagen_url', 'fecha_inicio', 'temario', 'area', 'certificacion', 'icono', 'modalidad', 'duracion'], isArray: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray() @ArrayUnique() @IsIn(['imagen_url', 'fecha_inicio', 'temario', 'area', 'certificacion', 'icono', 'modalidad', 'duracion'], { each: true })
  limpiar?: string[];
}

export class CreateServicioDto extends VisualContentDto {
  @ApiPropertyOptional() @ValidateIf((_,v)=>v!==undefined) @IsIn(['normal','cableado','camara','alertas','nube','app','mantenimiento','software','redes','emergencia','asesoria','beneficio']) presentacion?:string;
  @ApiPropertyOptional() @ValidateIf((_,v)=>v!==undefined) @Transform(trim) @IsString() @Length(1,80) nombre_corto?:string;
  @ApiPropertyOptional() @ValidateIf((_,v)=>v!==undefined) @Transform(trim) @IsString() @Length(1,100) destacado?:string;
  @ApiPropertyOptional() @ValidateIf((_,v)=>v!==undefined) @Transform(trim) @IsString() @Length(1,40) dato_principal?:string;
  @ApiPropertyOptional() @ValidateIf((_,v)=>v!==undefined) @Transform(trim) @IsString() @Length(1,100) dato_secundario?:string;
  @ApiPropertyOptional() @ValidateIf((_,v)=>v!==undefined) @Transform(trim) @IsString() @Length(1,2000) etiquetas?:string;
  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 160)
  titulo: string;

  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 180) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 20000)
  descripcion: string;

  @ApiProperty({ enum: ["cableado","camaras","soporte","asesoramiento"] })
  @Transform(trim)
  @IsIn(["cableado","camaras","soporte","asesoramiento"])
  categoria: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString() @Length(1, 20000)
  alcance?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @PublicImageUrl() @Length(1, 2048)
  imagen_url?: string;

  @ApiPropertyOptional({ enum: ["borrador","publicado","archivado"] })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsIn(["borrador","publicado","archivado"])
  estado?: string;
}
export class UpdateServicioDto extends PartialType(CreateServicioDto, { skipNullProperties: false }) {
  @ApiPropertyOptional({ enum: ['imagen_url', 'alcance', 'nombre_corto', 'destacado', 'dato_principal', 'dato_secundario', 'etiquetas', 'icono'], isArray: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray() @ArrayUnique() @IsIn(['imagen_url', 'alcance', 'nombre_corto', 'destacado', 'dato_principal', 'dato_secundario', 'etiquetas', 'icono'], { each: true })
  limpiar?: string[];
}

export class CreatePreguntaFrecuenteDto {
  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 300)
  pregunta: string;

  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 12000)
  respuesta: string;

  @ApiProperty()
  @Transform(trim)
  @IsString() @Length(1, 100)
  categoria: string;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt() @Min(0) @Max(1000000)
  orden?: number;

  @ApiPropertyOptional({ enum: ["borrador","publicado","archivado"] })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsIn(["borrador","publicado","archivado"])
  estado?: string;
}
export class UpdatePreguntaFrecuenteDto extends PartialType(CreatePreguntaFrecuenteDto, { skipNullProperties: false }) {}
