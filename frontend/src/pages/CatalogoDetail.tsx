import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePublicResource } from '../hooks/usePublicResource'
import PublicRequestState from '../components/PublicRequestState'
import PublicFailure from '../components/PublicFailure'
import type { CursoPublico, ServicioPublico } from '../types/public'

const SERVICE_SECTIONS: Record<string, string> = {
  cableado: '/tecnologias/cableado-estructurado', camaras: '/tecnologias/camaras-seguridad',
  soporte: '/tecnologias/soporte-mantenimiento', asesoramiento: '/educacion/asesoramiento',
}

export default function CatalogoDetail({ kind }: { kind: 'cursos' | 'servicios' }) {
  const { id } = useParams()
  const { data, loading, error, errorKind, reload } = usePublicResource<{ item: CursoPublico | ServicioPublico }>(kind + '/' + encodeURIComponent(id || ''))
  const item = data?.item
  const services = kind === 'servicios'
  const missingTitle = services ? 'Servicio no disponible' : 'Curso no disponible', failedTitle = 'No se pudo cargar el contenido'
  useEffect(() => { document.title = (item?.titulo || (error ? (errorKind === 'notFound' ? missingTitle : failedTitle) : 'Detalle del catálogo')) + ' — Horus Group SRL' }, [item?.titulo, error, errorKind, missingTitle])
  // Sin el registro no se conoce su categoría: se ofrece una página pública válida de Tecnologías (o de Cursos).
  if (error) return <PublicFailure kind={errorKind} message={error} reload={reload} eyebrow={services ? 'Tecnologías' : 'Cursos'} missingTitle={missingTitle} failedTitle={failedTitle}
    back={services ? { to: SERVICE_SECTIONS.cableado, label: 'Ver servicios de tecnología' } : { to: '/educacion/cursos', label: 'Volver a cursos' }} />
  return <section className="public-catalog public-catalog-detail"><div className="container"><Link to={kind === 'cursos' ? item && 'tipo' in item && item.tipo === 'capacitacion' ? '/educacion/capacitaciones' : '/educacion/cursos' : item && 'categoria' in item && SERVICE_SECTIONS[item.categoria] || '/tecnologias/cableado-estructurado'}>← Volver al catálogo</Link>
    <PublicRequestState loading={loading} error="" reload={reload} />
    {!loading && item && <article className="public-course-body"><h1>{item.titulo}</h1>{item.imagen_url && <img className="public-detail-image" src={item.imagen_url} alt={item.titulo} />}<p className="public-course-description">{item.descripcion}</p>
      {'duracion' in item && <><p>Duración: {item.duracion||'Por confirmar'} · Modalidad: {item.modalidad||'Por confirmar'}</p>{item.fecha_inicio && <p>Fecha publicada: {item.fecha_inicio.slice(0, 10)}. Consulta la vigencia de la convocatoria con el equipo.</p>}{item.temario && <><h2>Temario</h2><p className="public-course-description">{item.temario}</p></>}</>}
      {'alcance' in item && item.alcance && <><h2>Alcance</h2><p className="public-course-description">{item.alcance}</p></>}
      <Link className="btn-coral" to={'/contactos?asunto=' + encodeURIComponent('Consulta sobre ' + item.titulo)}>Solicitar información</Link>
    </article>}
  </div></section>
}
