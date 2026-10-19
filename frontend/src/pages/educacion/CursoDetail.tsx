import { useEffect } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import PageHero from '../../components/PageHero'
import PublicFailure from '../../components/PublicFailure'
import { PUBLIC_ERROR_TEXTS } from '../../publicErrors'
import CourseFacts from '../../components/edu/CourseFacts'
import { consultPath, courseName, detailPath, kindLabel } from '../../components/edu/courseText'
import ServiceFeatures from '../../components/tech/ServiceFeatures'
import ServiceMedia from '../../components/tech/ServiceMedia'
import { usePublicResource } from '../../hooks/usePublicResource'
import type { CursoPublico } from '../../types/public'

// Detail of one published course or capacitación. Served at /educacion/cursos/:id and /educacion/capacitaciones/:id;
// a record opened under the wrong path is redirected to its own.
export default function CursoDetail() {
  const { id } = useParams()
  const { pathname } = useLocation()
  const { data, loading, error, errorKind, reload } = usePublicResource<{ item: CursoPublico }>('cursos/' + encodeURIComponent(id || ''))
  const item = data?.item
  const name = item ? courseName(item) : ''
  const isTraining = pathname.startsWith('/educacion/capacitaciones')
  const missingTitle = isTraining ? 'Capacitación no disponible' : 'Curso no disponible', failedTitle = 'No se pudo cargar el contenido'
  useEffect(() => { document.title = (name || (error ? (errorKind === 'notFound' ? missingTitle : failedTitle) : 'Detalle')) + ' — Horus Group SRL' }, [name, error, errorKind, missingTitle])

  if (item && detailPath(item) !== pathname) return <Navigate to={detailPath(item)} replace />
  const back = isTraining ? '/educacion/capacitaciones' : '/educacion/cursos'
  // Un 404 (id inexistente, oculto o archivado) es "no disponible"; un fallo de red o servidor es "no se pudo cargar" y se puede reintentar.
  if (error) return <PublicFailure kind={errorKind} message={error || PUBLIC_ERROR_TEXTS.unknown} reload={reload} eyebrow={isTraining ? 'Capacitaciones' : 'Cursos'} missingTitle={missingTitle} failedTitle={failedTitle}
    back={{ to: back, label: 'Volver a ' + (isTraining ? 'capacitaciones' : 'cursos') }} />

  return <>
    <PageHero eyebrow={item ? kindLabel(item.tipo) : 'Educación'} title={name || 'Detalle'} />
    <section className="tech-section is-light edu-section" aria-label={name ? 'Detalle de ' + name : 'Detalle'} aria-busy={loading}>
      <div className="container">
        <Link className="tech-link edu-back" to={back}><i className="fas fa-arrow-left" aria-hidden="true" /> Volver a {back.endsWith('capacitaciones') ? 'capacitaciones' : 'cursos'}</Link>
        {(loading || !item) && <div className="edu-skeleton edu-skeleton-detail" role="status">
          <span className="tech-sr">Cargando detalle…</span><span aria-hidden="true" /><span aria-hidden="true" />
        </div>}
        {!loading && item && <article className="edu-detail">
          <div className="edu-detail-media tech-media fade-up">
            <ServiceMedia src={item.imagen_url} title={name} priority />
          </div>
          <div className="edu-detail-info fade-up">
            <CourseFacts course={item} label={'Datos de ' + name} />
            <p className="tech-desc edu-detail-desc">{item.descripcion}</p>
            <div className="tech-actions">
              <Link className="home-button tech-btn" to={consultPath(item)}>Solicitar información <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
            </div>
          </div>
          {item.temario?.trim() && <div className="edu-detail-syllabus fade-up">
            <h2>Temario</h2>
            <ServiceFeatures value={item.temario} label={'Temario de ' + name} />
          </div>}
        </article>}
      </div>
    </section>
  </>
}
