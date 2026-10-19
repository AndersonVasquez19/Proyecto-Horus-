import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../../components/PageHero'
import CourseCatalog, { type CatalogCopy } from '../../components/edu/CourseCatalog'

const copy: CatalogCopy = {
  eyebrow: 'Oferta educativa', title: 'Capacitaciones disponibles',
  intro: 'Revisa cada capacitación, su detalle y consulta la que te interesa.',
  plural: 'capacitaciones',
  emptyTitle: 'Estamos preparando nuevas capacitaciones',
  emptyText: 'Por ahora no hay capacitaciones publicadas. Escríbenos y te contaremos qué programas se están organizando.',
  consultLabel: 'Consultar capacitaciones', consultSubject: 'Consulta sobre capacitaciones',
}

export default function Capacitaciones() {
  useEffect(() => { document.title = 'Capacitaciones — Horus Group SRL' }, [])
  return <>
    <PageHero eyebrow="Educación" title="Capacitaciones" actions={
      <Link to="/contactos?asunto=Consulta%20sobre%20capacitaciones" className="home-button"><i className="fas fa-comments" aria-hidden="true" /> Consultar capacitaciones</Link>
    }>
      Programas de capacitación publicados por Horus Group SRL, con el detalle de cada uno.
    </PageHero>
    <CourseCatalog tipo="capacitacion" copy={copy} />
  </>
}
