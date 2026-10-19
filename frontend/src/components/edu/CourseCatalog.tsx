import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePublicResource } from '../../hooks/usePublicResource'
import type { CursoPublico, PublicList } from '../../types/public'
import SectionHead from '../SectionHead'
import CourseCard from './CourseCard'
import NotifyForm from './NotifyForm'
import { MODALIDAD_LABEL, MODALIDAD_ORDER, type Modalidad } from './courseText'

const PAGE_SIZE = 100 // largest page the API serves; filters and counts work on what was loaded
const STEP = 9

export type CatalogCopy = {
  eyebrow: string; title: string; intro: string
  plural: string // "cursos" / "capacitaciones"
  emptyTitle: string; emptyText: string; consultLabel: string; consultSubject: string
  notify?: boolean
}

type Filter = 'todas' | Modalidad

// Published courses (or capacitaciones) of one type. Everything shown comes from the API; the modality filters are
// built from the modalities that actually exist in the loaded records.
export default function CourseCatalog({ tipo, copy }: { tipo: CursoPublico['tipo']; copy: CatalogCopy }) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Filter>('todas')
  const [shown, setShown] = useState(STEP)
  const { data, loading, error, reload } = usePublicResource<PublicList<CursoPublico>>(
    'cursos?' + new URLSearchParams({ tipo, page: String(page), limit: String(PAGE_SIZE) }))
  const headingId = 'edu-catalog-' + tipo

  const items = data?.items ?? []
  const counts = MODALIDAD_ORDER.map(key => ({ key, total: items.filter(item => item.modalidad === key).length })).filter(entry => entry.total > 0)
  const active: Filter = counts.some(entry => entry.key === selected) ? selected : 'todas'
  const visible = active === 'todas' ? items : items.filter(item => item.modalidad === active)
  const pages = data?.pagination.pages ?? 1

  const choose = (filter: Filter) => { setSelected(filter); setShown(STEP) }
  const turnPage = (next: number) => { setPage(next); setSelected('todas'); setShown(STEP) }

  let body
  if (error) body = <div className="tech-state" role="alert">
    <p>{error}</p><button type="button" className="home-button tech-btn" onClick={reload}>Reintentar</button>
  </div>
  else if (loading || !data) body = <div className="edu-skeleton" role="status">
    <span className="tech-sr">Cargando {copy.plural}…</span>
    <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
  </div>
  else if (!items.length) body = <div className="edu-empty fade-up">
    <span className="tech-icon edu-empty-icon" aria-hidden="true"><i className="fas fa-graduation-cap" /></span>
    <h3>{copy.emptyTitle}</h3>
    <p>{copy.emptyText}</p>
    <div className="tech-actions">
      <Link className="home-button tech-btn" to={'/contactos?asunto=' + encodeURIComponent(copy.consultSubject)}>
        {copy.consultLabel} <i className="fas fa-arrow-right" aria-hidden="true" />
      </Link>
    </div>
    {copy.notify && <NotifyForm />}
  </div>
  else body = <>
    {counts.length > 0 && <div className="edu-filters" role="group" aria-label="Filtrar por modalidad">
      <button type="button" className="edu-chip" aria-pressed={active === 'todas'} onClick={() => choose('todas')}>
        Todas <span className="edu-chip-count">{items.length}</span>
      </button>
      {counts.map(entry => <button key={entry.key} type="button" className="edu-chip" aria-pressed={active === entry.key} onClick={() => choose(entry.key)}>
        {MODALIDAD_LABEL[entry.key]} <span className="edu-chip-count">{entry.total}</span>
      </button>)}
    </div>}
    <p className="edu-count" role="status">
      {visible.length} {visible.length === 1 ? 'propuesta publicada' : 'propuestas publicadas'}
      {active !== 'todas' && ' · ' + MODALIDAD_LABEL[active]}
    </p>
    <div className="edu-grid" key={active}>
      {visible.slice(0, shown).map((course, index) => <CourseCard key={course.id} course={course} priority={index === 0} />)}
    </div>
    {visible.length > shown && <div className="edu-more">
      <button type="button" className="home-button home-button-outline edu-more-btn" onClick={() => setShown(value => value + STEP)}>
        Ver más ({visible.length - shown} restantes)
      </button>
    </div>}
    {pages > 1 && <nav className="tech-pagination" aria-label={'Páginas de ' + copy.plural}>
      <button type="button" className="home-button tech-btn" disabled={page <= 1} onClick={() => turnPage(page - 1)}>Anterior</button>
      <span>Página {page} de {pages}</span>
      <button type="button" className="home-button tech-btn" disabled={page >= pages} onClick={() => turnPage(page + 1)}>Siguiente</button>
    </nav>}
  </>

  return <section className="tech-section is-light edu-section" id="catalogo" aria-labelledby={headingId} aria-busy={loading}>
    <div className="container">
      <SectionHead id={headingId} eyebrow={copy.eyebrow} title={copy.title}>{copy.intro}</SectionHead>
      {body}
    </div>
  </section>
}
