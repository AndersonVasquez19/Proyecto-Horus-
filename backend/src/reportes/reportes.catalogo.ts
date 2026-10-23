import type { Permission } from '../permissions/permissions';
import { EDITION_STATES, ENROLLMENT_STATES, FilterKey, OPEN_INQUIRY_STATES, QUOTE_REPORT_STATES, STUDENT_STATES } from './reportes.dto';
import { REPORT_TYPES, ReportType } from './reportes.types';

// Catálogo de reportes: qué filtros admite cada uno, sus estados válidos y si contiene datos personales.
// Permisos (sin cambiar la matriz de roles):
//  - Consultar (JSON):  reportes_academicos:leer (AccessGuard) + `consultaRequiere` (comprobado en el servicio con el rol vigente).
//  - Exportar (archivo): reportes_academicos:exportar (AccessGuard) + `exportacionRequiere` (servicio).
// Los reportes con datos personales (nombres, DNI, correo, teléfono) exigen además poder leer o exportar estudiantes.
//
// Reportes COMERCIALES y de ATENCIÓN (ámbito «comercial»): usan el mismo motor y las mismas rutas, y NO cambian la matriz de roles. La ruta exige
// el acceso general a reportes (reportes_academicos:leer / :exportar) y el servicio exige además, con el rol vigente, el permiso del módulo de
// origen: cotizaciones:leer para cotizaciones; mensajes:leer y seguimiento_mensajes:leer para consultas de Atención. Quien no tenga ambos queda
// fuera: la secretaría no tiene reportes_academicos:leer ni cotizaciones:leer; la coordinadora consulta (tiene todos los permisos de lectura) pero
// no exporta (reportes_academicos:exportar es solo del gerente). Son agregados u hojas de trabajo SIN datos personales (ver reportes.comerciales.ts).
export interface ReportDefinition {
  tipo: ReportType;
  titulo: string;
  descripcion: string;
  filtros: readonly FilterKey[];
  estados: readonly string[]; // valores admitidos de `estado` (vacío = no admite el filtro)
  datosPersonales: boolean;
  ambito: 'academico' | 'comercial';
  consultaRequiere: readonly Permission[];
  exportacionRequiere: readonly Permission[];
  notas: readonly string[];
}

const PERIOD: readonly FilterKey[] = ['desde', 'hasta'];
const CURRENT_STATE_NOTE = 'Los estados son los vigentes al generar el reporte.';
const QUOTE_READ: readonly Permission[] = ['cotizaciones:leer'];
const INQUIRY_READ: readonly Permission[] = ['mensajes:leer', 'seguimiento_mensajes:leer'];
const NOT_REVENUE_NOTE = 'Los importes son lo COTIZADO por escrito. No son ingresos recibidos ni ventas cobradas: el sistema no registra pagos ni facturas. «Aceptada» es un registro administrativo.';
const CURRENCY_NOTE = 'Cada moneda (soles PEN, dólares USD) se muestra por separado: nunca se suman monedas distintas.';
const NO_PERSONAL_NOTE = 'No incluye datos personales (cliente, correo, teléfono, documento, asunto ni mensaje). Para ver un caso, ábrelo en el panel con su número o ID.';

export const REPORT_CATALOG: Readonly<Record<ReportType, ReportDefinition>> = Object.freeze({
  estudiantes: {
    tipo: 'estudiantes', titulo: 'Estudiantes registrados',
    descripcion: 'Estudiantes registrados con su estado (activo o inactivo) y sus matrículas vigentes.',
    filtros: [...PERIOD, 'estado'], estados: STUDENT_STATES, datosPersonales: true, ambito: 'academico',
    consultaRequiere: ['estudiantes:leer'], exportacionRequiere: ['estudiantes:exportar'],
    notas: ['El período filtra por fecha de registro del estudiante (hora de Lima).', 'Inactivo = estudiante archivado.', CURRENT_STATE_NOTE],
  },
  ediciones: {
    tipo: 'ediciones', titulo: 'Ediciones académicas',
    descripcion: 'Ediciones de cursos con fechas, estado, capacidad y matrículas vigentes y anuladas.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'estado', 'archivo'], estados: EDITION_STATES, datosPersonales: false, ambito: 'academico',
    consultaRequiere: [], exportacionRequiere: [],
    notas: ['Con período, se incluyen las ediciones cuyas fechas se superponen con él; las ediciones sin fechas quedan fuera.', CURRENT_STATE_NOTE],
  },
  ocupacion: {
    tipo: 'ocupacion', titulo: 'Ocupación de cupos',
    descripcion: 'Capacidad, matrículas vigentes, cupos disponibles y porcentaje de ocupación por edición.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'estado', 'archivo'], estados: EDITION_STATES, datosPersonales: false, ambito: 'academico',
    consultaRequiere: [], exportacionRequiere: [],
    notas: ['Solo las matrículas vigentes ocupan cupo. Una edición sin capacidad definida no suma a la ocupación global.',
      'Con período, se incluyen las ediciones cuyas fechas se superponen con él; las ediciones sin fechas quedan fuera.', CURRENT_STATE_NOTE],
  },
  matriculas: {
    tipo: 'matriculas', titulo: 'Matrículas vigentes y anuladas',
    descripcion: 'Detalle de matrículas con estudiante, curso, edición, estado y cumplimiento.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'estado', 'cumplimiento'], estados: ENROLLMENT_STATES, datosPersonales: true, ambito: 'academico',
    consultaRequiere: ['matriculas:leer', 'estudiantes:leer'], exportacionRequiere: ['estudiantes:exportar'],
    notas: ['El período filtra por fecha de registro de la matrícula (hora de Lima).', 'Vigente = matrícula activa.', CURRENT_STATE_NOTE],
  },
  'matriculas-por-edicion': {
    tipo: 'matriculas-por-edicion', titulo: 'Matrículas por curso o edición',
    descripcion: 'Matrículas vigentes, anuladas y totales agrupadas por edición o por curso.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'agrupar'], estados: [], datosPersonales: false, ambito: 'academico',
    consultaRequiere: [], exportacionRequiere: [],
    notas: ['El período filtra por fecha de registro de la matrícula (hora de Lima).', 'Solo aparecen los grupos con al menos una matrícula en el filtro.', CURRENT_STATE_NOTE],
  },
  resumen: {
    tipo: 'resumen', titulo: 'Resumen general por período',
    descripcion: 'Indicadores académicos del período y serie mensual de estudiantes y matrículas registrados.',
    filtros: PERIOD, estados: [], datosPersonales: false, ambito: 'academico',
    consultaRequiere: [], exportacionRequiere: [],
    notas: ['Sin fechas, el período son los últimos 12 meses (incluido el actual).', 'Los indicadores marcados «al generar» no dependen del período.',
      'Meses y días en hora de Lima.', CURRENT_STATE_NOTE],
  },
  'cotizaciones-por-estado': {
    tipo: 'cotizaciones-por-estado', titulo: 'Cotizaciones por estado', ambito: 'comercial',
    descripcion: 'Cantidad de cotizaciones por estado (borrador, enviada, aceptada, rechazada, anulada) y su porcentaje.',
    filtros: [...PERIOD, 'moneda'], estados: [], datosPersonales: false,
    consultaRequiere: QUOTE_READ, exportacionRequiere: QUOTE_READ,
    notas: ['El período filtra por la fecha de creación de la cotización (hora de Lima).', 'Abiertas = borrador o enviada. «Vencida» no es un estado: ver el reporte de cotizaciones vencidas.',
      CURRENT_STATE_NOTE, NO_PERSONAL_NOTE],
  },
  'cotizaciones-vencidas': {
    tipo: 'cotizaciones-vencidas', titulo: 'Cotizaciones enviadas con vigencia vencida', ambito: 'comercial',
    descripcion: 'Propuestas enviadas cuya vigencia ya pasó, de la más atrasada a la más reciente, con su importe cotizado.',
    filtros: [...PERIOD, 'moneda'], estados: [], datosPersonales: false,
    consultaRequiere: QUOTE_READ, exportacionRequiere: QUOTE_READ,
    notas: ['Vencida = estado «enviada» y vigencia anterior al día de hoy en Lima (mismo criterio que el listado de cotizaciones y HORUS Assistant). Un borrador con la fecha pasada no cuenta.',
      'El período filtra por la FECHA DE VENCIMIENTO (vigencia), no por la de creación.', NOT_REVENUE_NOTE, CURRENCY_NOTE, NO_PERSONAL_NOTE],
  },
  'cotizaciones-importes': {
    tipo: 'cotizaciones-importes', titulo: 'Importes cotizados por estado y moneda', ambito: 'comercial',
    descripcion: 'Subtotal, descuento, impuesto y total cotizados por moneda y estado.',
    filtros: [...PERIOD, 'moneda', 'estado'], estados: QUOTE_REPORT_STATES, datosPersonales: false,
    consultaRequiere: QUOTE_READ, exportacionRequiere: QUOTE_READ,
    notas: ['El período filtra por la fecha de creación de la cotización (hora de Lima).', NOT_REVENUE_NOTE, CURRENCY_NOTE, 'Sin fila de totales: no se suman monedas distintas.',
      CURRENT_STATE_NOTE, NO_PERSONAL_NOTE],
  },
  'consultas-por-estado': {
    tipo: 'consultas-por-estado', titulo: 'Consultas de Atención por estado', ambito: 'comercial',
    descripcion: 'Consultas recibidas agrupadas por su estado de atención (nuevo, en proceso, atendido, archivado).',
    filtros: PERIOD, estados: [], datosPersonales: false,
    consultaRequiere: INQUIRY_READ, exportacionRequiere: INQUIRY_READ,
    notas: ['El período filtra por la fecha en que se recibió la consulta (hora de Lima).', 'El estado es el del seguimiento y, si no hay seguimiento, el de la consulta. Abiertas = nuevo o en proceso.',
      'Incluye solo consultas (mensajes); las reclamaciones no forman parte de este reporte.', CURRENT_STATE_NOTE, NO_PERSONAL_NOTE],
  },
  'consultas-abiertas-antiguas': {
    tipo: 'consultas-abiertas-antiguas', titulo: 'Consultas abiertas con más de 48 horas', ambito: 'comercial',
    descripcion: 'Consultas nuevas o en proceso recibidas hace más de 48 horas, de la más antigua a la más reciente.',
    filtros: [...PERIOD, 'estado'], estados: OPEN_INQUIRY_STATES, datosPersonales: false,
    consultaRequiere: INQUIRY_READ, exportacionRequiere: INQUIRY_READ,
    notas: ['Antigüedad = horas desde que se recibió la consulta hasta que se genera el reporte; se considera antigua a partir de 48 horas (el mismo umbral del filtro «antiguas» de la bandeja y de HORUS Assistant).',
      'El período filtra por la fecha en que se recibió la consulta (hora de Lima).', CURRENT_STATE_NOTE, NO_PERSONAL_NOTE],
  },
  'actividad-comercial': {
    tipo: 'actividad-comercial', titulo: 'Actividad comercial y de atención por mes', ambito: 'comercial',
    descripcion: 'Serie mensual de consultas recibidas y cotizaciones creadas, con cuántas siguen abiertas, cerradas o aceptadas.',
    filtros: PERIOD, estados: [], datosPersonales: false,
    consultaRequiere: [...QUOTE_READ, ...INQUIRY_READ], exportacionRequiere: [...QUOTE_READ, ...INQUIRY_READ],
    notas: ['Sin fechas, el período son los últimos 12 meses (incluido el actual). Meses en hora de Lima.', 'Cada cifra se cuenta por la fecha de creación del registro. Las columnas «hoy» muestran el estado vigente al generar el reporte, no el que tenía en ese mes.',
      '«Aceptada» es un registro administrativo, no un ingreso cobrado.', NO_PERSONAL_NOTE],
  },
});

// Contrato público del catálogo para el panel (sin permisos internos).
export function catalogEntries() {
  return REPORT_TYPES.map(tipo => {
    const def = REPORT_CATALOG[tipo];
    return { tipo, titulo: def.titulo, descripcion: def.descripcion, filtros: [...def.filtros], estados: [...def.estados], datos_personales: def.datosPersonales, ambito: def.ambito };
  });
}
