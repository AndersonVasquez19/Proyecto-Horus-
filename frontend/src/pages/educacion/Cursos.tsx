import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../../components/PageHero'
import CourseCatalog, { type CatalogCopy } from '../../components/edu/CourseCatalog'

const copy: CatalogCopy = {
  eyebrow: 'Oferta educativa', title: 'Cursos disponibles',
  intro: 'Filtra por modalidad, revisa el detalle de cada curso y consulta el que te interesa.',
  plural: 'cursos',
  emptyTitle: 'Estamos preparando nuevos cursos',
  emptyText: 'Por ahora no hay cursos publicados. Escríbenos para consultar los próximos cursos o deja tu correo y te avisaremos cuando haya novedades.',
  consultLabel: 'Consultar próximos cursos', consultSubject: 'Consulta sobre próximos cursos',
  notify: true,
}

export default function Cursos() {
  useEffect(() => { document.title = 'Cursos — Horus Group SRL' }, [])
  return <>
    <PageHero eyebrow="Educación" title="Cursos" actions={
      <Link to="/contactos?asunto=Consulta%20sobre%20cursos" className="home-button"><i className="fas fa-comments" aria-hidden="true" /> Consultar cursos</Link>
    }>
      Cursos publicados por Horus Group, con su modalidad, duración y fecha de inicio.
    </PageHero>
    <CourseCatalog tipo="curso" copy={copy} />
  </>
}
