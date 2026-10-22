import type { Permission } from '../permissions/permissions';
import { CERTIFICATE_STATES, EDITION_STATES, ENROLLMENT_STATES, FilterKey, STUDENT_STATES } from './reportes.dto';
import { REPORT_TYPES, ReportType } from './reportes.types';

// Catálogo de reportes: qué filtros admite cada uno, sus estados válidos y si contiene datos personales.
// Permisos (sin cambiar la matriz de roles):
//  - Consultar (JSON):  reportes_academicos:leer (AccessGuard) + `consultaRequiere` (comprobado en el servicio con el rol vigente).
//  - Exportar (archivo): reportes_academicos:exportar (AccessGuard) + `exportacionRequiere` (servicio).
// Los reportes con datos personales (nombres, DNI, correo, teléfono) exigen además poder leer o exportar estudiantes.
export interface ReportDefinition {
  tipo: ReportType;
  titulo: string;
  descripcion: string;
  filtros: readonly FilterKey[];
  estados: readonly string[]; // valores admitidos de `estado` (vacío = no admite el filtro)
  datosPersonales: boolean;
  consultaRequiere: readonly Permission[];
  exportacionRequiere: readonly Permission[];
  notas: readonly string[];
}

const PERIOD: readonly FilterKey[] = ['desde', 'hasta'];
const CURRENT_STATE_NOTE = 'Los estados son los vigentes al generar el reporte.';

export const REPORT_CATALOG: Readonly<Record<ReportType, ReportDefinition>> = Object.freeze({
  estudiantes: {
    tipo: 'estudiantes', titulo: 'Estudiantes registrados',
    descripcion: 'Estudiantes registrados con su estado (activo o inactivo) y sus matrículas vigentes.',
    filtros: [...PERIOD, 'estado'], estados: STUDENT_STATES, datosPersonales: true,
    consultaRequiere: ['estudiantes:leer'], exportacionRequiere: ['estudiantes:exportar'],
    notas: ['El período filtra por fecha de registro del estudiante (hora de Lima).', 'Inactivo = estudiante archivado.', CURRENT_STATE_NOTE],
  },
  ediciones: {
    tipo: 'ediciones', titulo: 'Ediciones académicas',
    descripcion: 'Ediciones de cursos con fechas, estado, capacidad y matrículas vigentes y anuladas.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'estado', 'archivo'], estados: EDITION_STATES, datosPersonales: false,
    consultaRequiere: [], exportacionRequiere: [],
    notas: ['Con período, se incluyen las ediciones cuyas fechas se superponen con él; las ediciones sin fechas quedan fuera.', CURRENT_STATE_NOTE],
  },
  ocupacion: {
    tipo: 'ocupacion', titulo: 'Ocupación de cupos',
    descripcion: 'Capacidad, matrículas vigentes, cupos disponibles y porcentaje de ocupación por edición.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'estado', 'archivo'], estados: EDITION_STATES, datosPersonales: false,
    consultaRequiere: [], exportacionRequiere: [],
    notas: ['Solo las matrículas vigentes ocupan cupo. Una edición sin capacidad definida no suma a la ocupación global.',
      'Con período, se incluyen las ediciones cuyas fechas se superponen con él; las ediciones sin fechas quedan fuera.', CURRENT_STATE_NOTE],
  },
  matriculas: {
    tipo: 'matriculas', titulo: 'Matrículas vigentes y anuladas',
    descripcion: 'Detalle de matrículas con estudiante, curso, edición, estado y cumplimiento.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'estado', 'cumplimiento'], estados: ENROLLMENT_STATES, datosPersonales: true,
    consultaRequiere: ['matriculas:leer', 'estudiantes:leer'], exportacionRequiere: ['estudiantes:exportar'],
    notas: ['El período filtra por fecha de registro de la matrícula (hora de Lima).', 'Vigente = matrícula activa.', CURRENT_STATE_NOTE],
  },
  'matriculas-por-edicion': {
    tipo: 'matriculas-por-edicion', titulo: 'Matrículas por curso o edición',
    descripcion: 'Matrículas vigentes, anuladas y totales agrupadas por edición o por curso.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'agrupar'], estados: [], datosPersonales: false,
    consultaRequiere: [], exportacionRequiere: [],
    notas: ['El período filtra por fecha de registro de la matrícula (hora de Lima).', 'Solo aparecen los grupos con al menos una matrícula en el filtro.', CURRENT_STATE_NOTE],
  },
  certificados: {
    tipo: 'certificados', titulo: 'Certificados emitidos',
    descripcion: 'Certificados emitidos con estudiante, curso, edición, estado (vigente o anulado) y si fueron sustituidos.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id', 'estado'], estados: CERTIFICATE_STATES, datosPersonales: true,
    consultaRequiere: ['certificados:leer', 'estudiantes:leer'], exportacionRequiere: ['certificados:leer', 'estudiantes:exportar'],
    notas: ['El período filtra por fecha de emisión (hora de Lima).', 'Los datos del estudiante, el curso y la edición son los copiados al emitir el certificado.',
      'No incluye el motivo de anulación.', CURRENT_STATE_NOTE],
  },
  'pendientes-certificacion': {
    tipo: 'pendientes-certificacion', titulo: 'Pendientes de certificación',
    descripcion: 'Matrículas vigentes con cumplimiento confirmado que todavía no tienen un certificado vigente, y si pueden emitirse ahora.',
    filtros: [...PERIOD, 'curso_id', 'convocatoria_id'], estados: [], datosPersonales: true,
    consultaRequiere: ['matriculas:leer', 'certificados:leer', 'estudiantes:leer'], exportacionRequiere: ['certificados:leer', 'estudiantes:exportar'],
    notas: ['El período filtra por la fecha de confirmación del cumplimiento (hora de Lima).', 'Las ediciones canceladas no se incluyen: no emiten certificados.',
      'Una matrícula con un certificado anulado y ninguno vigente sigue figurando como pendiente.',
      'La columna «Situación» aplica la misma regla que la emisión: sin DNI completo no se puede emitir.', CURRENT_STATE_NOTE],
  },
  resumen: {
    tipo: 'resumen', titulo: 'Resumen general por período',
    descripcion: 'Indicadores académicos del período y serie mensual de estudiantes y matrículas registrados.',
    filtros: PERIOD, estados: [], datosPersonales: false,
    consultaRequiere: [], exportacionRequiere: [],
    notas: ['Sin fechas, el período son los últimos 12 meses (incluido el actual).', 'Los indicadores marcados «al generar» no dependen del período.',
      'Meses y días en hora de Lima.', CURRENT_STATE_NOTE],
  },
});

// Contrato público del catálogo para el panel (sin permisos internos).
export function catalogEntries() {
  return REPORT_TYPES.map(tipo => {
    const def = REPORT_CATALOG[tipo];
    return { tipo, titulo: def.titulo, descripcion: def.descripcion, filtros: [...def.filtros], estados: [...def.estados], datos_personales: def.datosPersonales };
  });
}
