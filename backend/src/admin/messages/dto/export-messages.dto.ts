import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, ValidateIf } from 'class-validator';
import { trimValue } from '../../../common/validation';

// Exportación de consultas (GET /api/admin/messages/exportar). Solo admite estos parámetros: el ValidationPipe global (forbidNonWhitelisted)
// rechaza con 400 page, limit, vista o cualquier otro, de modo que el cliente no puede pedir más columnas ni saltarse el tope de filas.
// Los filtros son los de la bandeja (búsqueda, estado, canal, responsable, antiguas) para exportar exactamente lo que se ve.
export class MessageExportQueryDto {
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['csv']) formato?: string;
  // Separador de campos: punto y coma por defecto (Excel en es-PE); `coma` para herramientas que esperan el CSV clásico.
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['punto_y_coma', 'coma']) separador?: 'punto_y_coma' | 'coma';
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @Length(0, 100) search?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['nuevo', 'en_proceso', 'atendido', 'archivado']) estado?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['chatbot', 'other']) channel?: string;
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @Length(0, 100) responsable?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['si']) antiguas?: string;
}
