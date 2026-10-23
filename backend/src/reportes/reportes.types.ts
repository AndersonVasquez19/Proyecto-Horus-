// Modelo único de un reporte académico. El servicio lo construye UNA vez por solicitud y los tres formatos (CSV, XLSX y PDF)
// son renderizadores puros de este mismo objeto: por construcción muestran las mismas filas, el mismo resumen y los mismos totales.
// La consulta JSON del panel devuelve este mismo documento con la tabla paginada (el resumen y los totales cubren todo el filtro).

export const ACADEMIC_REPORT_TYPES = ['estudiantes', 'ediciones', 'ocupacion', 'matriculas', 'matriculas-por-edicion', 'resumen'] as const;
// Reportes comerciales y de atención al cliente (Cotizaciones y Consultas). Mismo motor, mismos formatos; permisos propios (ver reportes.catalogo.ts).
export const COMMERCIAL_REPORT_TYPES = ['cotizaciones-por-estado', 'cotizaciones-vencidas', 'cotizaciones-importes', 'consultas-por-estado', 'consultas-abiertas-antiguas', 'actividad-comercial'] as const;
export const REPORT_TYPES = [...ACADEMIC_REPORT_TYPES, ...COMMERCIAL_REPORT_TYPES] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

// texto       cadena (se neutralizan fórmulas al exportar)
// entero      número entero
// decimal     número con un decimal (porcentajes: 75.0 significa 75,0 %; el título de la columna indica «(%)»)
// fecha       fecha de calendario 'AAAA-MM-DD'
// fecha_hora  fecha y hora de Lima 'AAAA-MM-DD HH:mm' (America/Lima, UTC-5 sin horario de verano)
// importe     importe monetario con dos decimales (la moneda va en otra columna o en el título; nunca se suman monedas distintas)
export type ColumnKind = 'texto' | 'entero' | 'decimal' | 'importe' | 'fecha' | 'fecha_hora';
export type CellValue = string | number | null;

export interface ReportColumn {
  clave: string;
  titulo: string;
  tipo: ColumnKind;
  ancho: number; // ancho relativo aproximado en caracteres (XLSX y reparto proporcional en PDF)
}

export type ReportRow = Record<string, CellValue>;

export interface ReportSummaryItem {
  clave: string;
  etiqueta: string;
  valor: number | null; // null = no aplica (p. ej. ocupación sin capacidad definida)
  tipo: 'entero' | 'decimal' | 'importe';
}

export interface ReportFilterLabel {
  clave: string;
  etiqueta: string;
  valor: string;
}

export interface ReportTable {
  titulo: string; // también nombre de la hoja de datos del XLSX (máximo 31 caracteres)
  columnas: ReportColumn[];
  filas: ReportRow[];
  totales: ReportRow | null; // fila de totales (primera columna = «Total»), o null si el reporte no la define
  total_filas: number; // filas de TODO el filtro (no solo de la página)
}

export interface ReportDocument {
  tipo: ReportType;
  titulo: string;
  descripcion: string;
  institucion: string;
  generado_at: string; // ISO UTC
  generado_local: string; // 'AAAA-MM-DD HH:mm' en hora de Lima
  periodo: { desde: string | null; hasta: string | null; etiqueta: string };
  filtros: ReportFilterLabel[];
  resumen: ReportSummaryItem[];
  tabla: ReportTable;
  notas: string[];
  datos_personales: boolean;
}

export const INSTITUTION_NAME = 'Horus Group SRL';
