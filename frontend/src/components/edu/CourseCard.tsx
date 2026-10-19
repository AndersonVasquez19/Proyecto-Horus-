import { Link } from 'react-router-dom'
import type { CursoPublico } from '../../types/public'
import ServiceMedia from '../tech/ServiceMedia'
import CourseFacts from './CourseFacts'
import { consultPath, courseName, detailPath, kindLabel } from './courseText'

export default function CourseCard({ course, priority = false }: { course: CursoPublico; priority?: boolean }) {
  const name = courseName(course)
  return <article className="edu-card fade-up">
    <div className="edu-card-media tech-media">
      <ServiceMedia src={course.imagen_url} title={name} priority={priority} />
      <span className="tech-badge edu-card-kind">{kindLabel(course.tipo)}</span>
    </div>
    <div className="edu-card-body">
      <h3>{name}</h3>
      <p className="tech-desc edu-card-desc">{course.descripcion}</p>
      <CourseFacts course={course} label={'Datos de ' + name} />
      <div className="tech-actions">
        <Link className="home-button tech-btn" to={detailPath(course)} aria-label={'Ver detalle de ' + name}>
          Ver detalle <i className="fas fa-arrow-right" aria-hidden="true" />
        </Link>
        <Link className="tech-link" to={consultPath(course)} aria-label={'Consultar sobre ' + name}>
          Consultar <i className="fas fa-chevron-right" aria-hidden="true" />
        </Link>
      </div>
    </div>
  </article>
}
