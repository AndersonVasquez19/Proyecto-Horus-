import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min, registerDecorator, ValidateIf } from 'class-validator';
import { isCalendarDate } from '../convocatorias/convocatorias.dto';
import { PREVIEW_MAX_LIMIT } from './reportes.limites';
import { REPORT_FORMATS, REPORT_TYPES, ReportFormat, ReportType } from './reportes.types';

const CalendarDate = (): PropertyDecorator => (target, propertyKey) => registerDecorator({
  name: 'reportCalendarDate', target: target.constructor, propertyName: String(propertyKey),
  validator: { validate: isCalendarDate, defaultMessage: () => 'Introduce una fecha válida en formato AAAA-MM-DD.' },
});

// Valores de `estado` admitidos por algún reporte. Cada reporte acepta solo los suyos (ver REPORT_CATALOG); el resto responde 400.
export const STUDENT_STATES = ['activos', 'inactivos', 'todos'] as const;
export const EDITION_STATES = ['planificada', 'abierta', 'cerrada', 'cancelada'] as const;
export const ENROLLMENT_STATES = ['activa', 'anulada'] as const;
// Reportes comerciales y de atención (cotizaciones y consultas). Los valores coinciden con QUOTE_STATES, MESSAGE_STATES y las monedas de CotizacionDto.
export const QUOTE_REPORT_STATES = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada'] as const;
export const OPEN_INQUIRY_STATES = ['nuevo', 'en_proceso'] as const;
export const CURRENCY_FILTERS = ['PEN', 'USD'] as const;
export const ALL_STATES = [...STUDENT_STATES, ...EDITION_STATES, ...ENROLLMENT_STATES, ...QUOTE_REPORT_STATES, ...OPEN_INQUIRY_STATES] as const;
export const COMPLIANCE_STATES = ['pendiente', 'cumplido', 'no_cumplido'] as const;
export const ARCHIVE_FILTERS = ['activos', 'archivados', 'todos'] as const;
export const GROUPINGS = ['edicion', 'curso'] as const;

export class ReporteTipoDto {
  @IsIn(REPORT_TYPES, { message: 'El reporte solicitado no existe.' }) tipo: ReportType;
}

// Filtros comunes. Todos son opcionales; un filtro que el reporte no admite responde 400 (no se ignora en silencio).
export class ReporteFiltrosDto {
  @ValidateIf((_o, v) => v !== undefined) @CalendarDate() desde?: string;
  @ValidateIf((_o, v) => v !== undefined) @CalendarDate() hasta?: string;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) curso_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) convocatoria_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(ALL_STATES) estado?: (typeof ALL_STATES)[number];
  @ValidateIf((_o, v) => v !== undefined) @IsIn(COMPLIANCE_STATES) cumplimiento?: (typeof COMPLIANCE_STATES)[number];
  @ValidateIf((_o, v) => v !== undefined) @IsIn(ARCHIVE_FILTERS) archivo?: (typeof ARCHIVE_FILTERS)[number];
  @ValidateIf((_o, v) => v !== undefined) @IsIn(GROUPINGS) agrupar?: (typeof GROUPINGS)[number];
  @ValidateIf((_o, v) => v !== undefined) @IsIn(CURRENCY_FILTERS) moneda?: (typeof CURRENCY_FILTERS)[number];
}

export class ReporteConsultaDto extends ReporteFiltrosDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(PREVIEW_MAX_LIMIT) limit = 20;
}

export const CSV_SEPARATOR_OPTIONS = ['punto_y_coma', 'coma'] as const;

export class ReporteExportacionDto extends ReporteFiltrosDto {
  @IsIn(REPORT_FORMATS, { message: 'Formato no admitido. Usa csv, xlsx o pdf.' }) formato: ReportFormat;
  // Solo CSV. Por defecto punto y coma (Excel en es-PE); con otro formato responde 400.
  @ValidateIf((_o, v) => v !== undefined) @IsIn(CSV_SEPARATOR_OPTIONS) separador?: (typeof CSV_SEPARATOR_OPTIONS)[number];
}

export type FilterKey = keyof ReporteFiltrosDto;
export const FILTER_KEYS: readonly FilterKey[] = ['desde', 'hasta', 'curso_id', 'convocatoria_id', 'estado', 'cumplimiento', 'archivo', 'agrupar', 'moneda'];
