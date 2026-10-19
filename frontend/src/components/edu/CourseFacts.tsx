import type { ReactNode } from 'react'
import type { CursoPublico } from '../../types/public'
import { modalidadText, startDate, TO_CONFIRM } from './courseText'

// Modalidad, duración and start date are always shown; a missing value reads "Por confirmar", never a blank label.
// Area and certificación only appear when the panel filled them in.
export default function CourseFacts({ course, label }: { course: CursoPublico; label: string }) {
  const start = startDate(course.fecha_inicio)
  const rows: { icon: string; name: string; value: ReactNode; pending?: boolean }[] = [
    { icon: 'fa-laptop-house', name: 'Modalidad', value: modalidadText(course.modalidad), pending: !course.modalidad },
    { icon: 'fa-clock', name: 'Duración', value: course.duracion?.trim() || TO_CONFIRM, pending: !course.duracion?.trim() },
    { icon: 'fa-calendar-day', name: 'Inicio', value: start ? <time dateTime={start.iso}>{start.text}</time> : TO_CONFIRM, pending: !start },
  ]
  if (course.area?.trim()) rows.push({ icon: 'fa-layer-group', name: 'Área', value: course.area.trim() })
  if (course.certificacion?.trim()) rows.push({ icon: 'fa-certificate', name: 'Certificación', value: course.certificacion.trim() })
  return <dl className="edu-facts" aria-label={label}>
    {rows.map(row => <div key={row.name} className={row.pending ? 'is-pending' : undefined}>
      <dt><i className={'fas ' + row.icon} aria-hidden="true" />{row.name}</dt>
      <dd>{row.value}</dd>
    </div>)}
  </dl>
}
