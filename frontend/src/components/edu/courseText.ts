import type { CursoPublico } from '../../types/public'
import { displayTitle } from '../tech/text'

export const TO_CONFIRM = 'Por confirmar'

export const MODALIDAD_LABEL = { presencial: 'Presencial', hibrida: 'Semipresencial', virtual: 'Virtual' } as const
export type Modalidad = keyof typeof MODALIDAD_LABEL
// Order in which the filters are offered; only the ones present in the data are shown.
export const MODALIDAD_ORDER: Modalidad[] = ['presencial', 'hibrida', 'virtual']

const longDate = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// fecha_inicio is a calendar date: it is read in UTC so the day never shifts with the visitor's time zone.
export function startDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : { iso: value.slice(0, 10), text: longDate.format(date) }
}

export const modalidadText = (value: CursoPublico['modalidad']) => (value && MODALIDAD_LABEL[value]) || TO_CONFIRM
export const courseName = (course: Pick<CursoPublico, 'titulo'>) => displayTitle(course.titulo)
export const kindLabel = (tipo: CursoPublico['tipo']) => tipo === 'capacitacion' ? 'Capacitación' : 'Curso'
export const detailPath = (course: Pick<CursoPublico, 'id' | 'tipo'>) =>
  (course.tipo === 'capacitacion' ? '/educacion/capacitaciones/' : '/educacion/cursos/') + course.id
// The subject always carries the name of the course so the context survives the trip to the contact form.
export const consultPath = (course: Pick<CursoPublico, 'titulo'>) =>
  '/contactos?asunto=' + encodeURIComponent('Consulta sobre: ' + courseName(course))
