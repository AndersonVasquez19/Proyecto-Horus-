import { useEffect, useMemo, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link } from 'react-router-dom'
import { usePublicResource } from '../../hooks/usePublicResource'
import PageHero from '../../components/PageHero'
import SectionHead from '../../components/SectionHead'
import FaqItem from '../../components/faq/FaqItem'
import { categoryLabel } from '../../components/faq/faqText'
import type { FaqPublica, PublicList } from '../../types/public'

type FaqPage = PublicList<FaqPublica>

const PAGE_SIZE = 20
// The API caps a page at 100; that first page is enough to know the published total and the real categories.
const OVERVIEW_SIZE = 100
const SEARCH_MIN_TOTAL = 10
const SKELETON_ROWS = 6
const CONTACT_PATH = '/contactos?asunto=' + encodeURIComponent('Consulta desde preguntas frecuentes')

export default function PreguntasFrecuentes() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)
  const refocusResults = useRef(false)

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
  if (query) params.set('search', query)
  if (category) params.set('categoria', category)
  const list = usePublicResource<FaqPage>('preguntas-frecuentes?' + params)
  // Unfiltered overview: published total (decides whether search / empty state apply) and the categories that really exist.
  const overview = usePublicResource<FaqPage>('preguntas-frecuentes?page=1&limit=' + OVERVIEW_SIZE)
  // The last received page stays on screen while the next one loads, so the height does not collapse when paging or filtering.
  const [kept, setKept] = useState<FaqPage | null>(null)
  if (list.data && list.data !== kept) setKept(list.data)
  const view = list.data ?? kept

  useEffect(() => { document.title = 'Preguntas frecuentes — Horus Group SRL' }, [])

  // After changing page, move focus to the top of the results once they have arrived.
  useEffect(() => {
    const element = resultsRef.current
    if (list.loading || !refocusResults.current || !element) return
    refocusResults.current = false
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [list.loading, view])

  const publishedTotal = overview.data?.pagination.total ?? null
  const categories = useMemo(() => [...new Set((overview.data?.items ?? []).map(item => item.categoria).filter(Boolean))], [overview.data])
  const filtering = Boolean(query || category)
  const showSearch = (publishedTotal ?? 0) > SEARCH_MIN_TOTAL || Boolean(query)
  const showCategories = categories.length >= 2 || Boolean(category)
  const initialLoading = (list.loading && !view) || (overview.loading && !overview.data && !overview.error)
  const noPublished = publishedTotal === 0 || (publishedTotal === null && !overview.loading && !filtering && !list.loading && !list.error && !!view && view.items.length === 0)
  const pages = view?.pagination.pages ?? 0

  const reloadAll = () => { list.reload(); overview.reload() }
  const submitSearch = (event: SubmitEvent<HTMLFormElement>) => { event.preventDefault(); setPage(1); setQuery(search.trim()) }
  const clearSearch = () => { setSearch(''); setQuery(''); setPage(1) }
  const showAll = () => { setSearch(''); setQuery(''); setCategory(''); setPage(1) }
  const selectCategory = (value: string) => { setCategory(value); setPage(1) }
  const goToPage = (next: number) => { refocusResults.current = true; setPage(next) }

  let body
  if (list.error) {
    body = <div className="tech-state" role="alert">
      <p>{list.error}</p>
      <button type="button" className="home-button tech-btn" onClick={reloadAll}>Reintentar</button>
    </div>
  } else if (initialLoading || (!view && list.loading) || (list.loading && !view?.items.length)) {
    body = <div className="faq-skeleton" role="status">
      <span className="tech-sr">Cargando preguntas…</span>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => <span key={index} aria-hidden="true" />)}
    </div>
  } else if (noPublished) {
    body = <div className="faq-empty fade-up" role="status">
      <span className="tech-icon faq-empty-icon" aria-hidden="true"><i className="fas fa-circle-question" /></span>
      <h3>No hay preguntas frecuentes publicadas por el momento.</h3>
      <p>Si necesitas ayuda, puedes comunicarte directamente con nuestro equipo.</p>
      <Link className="home-button" to={CONTACT_PATH}><i className="fas fa-comments" aria-hidden="true" /> Consultar con el equipo</Link>
    </div>
  } else if (!view || !view.items.length) {
    body = <div className="tech-state" role="status">
      <p>No encontramos preguntas con esos criterios.</p>
      <div className="faq-state-actions">
        {query && <button type="button" className="home-button home-button-outline tech-btn faq-outline" onClick={clearSearch}>Limpiar búsqueda</button>}
        <button type="button" className="home-button tech-btn" onClick={showAll}>Mostrar todas</button>
      </div>
    </div>
  } else {
    body = <div className="faq-list" aria-busy={list.loading} inert={list.loading}>
      {view.items.map(item => <FaqItem key={item.id} item={item} showBadge={categories.length >= 2} />)}
    </div>
  }

  const showCta = !list.error && !initialLoading && !noPublished
  const total = view?.pagination.total ?? 0
  const countText = filtering ? total + (total === 1 ? ' resultado' : ' resultados') : total + (total === 1 ? ' pregunta' : ' preguntas')

  return <>
    <PageHero eyebrow="Ayuda" title="Preguntas frecuentes">
      Consulta las respuestas publicadas por nuestro equipo.
    </PageHero>

    <section className="tech-section is-light faq-main" id="preguntas" aria-labelledby="faq-title">
      <div className="container">
        <SectionHead id="faq-title" eyebrow="Respuestas" title="Preguntas frecuentes">
          {noPublished ? null : 'Despliega cada pregunta para ver su respuesta.'}
        </SectionHead>

        {!noPublished && !initialLoading && (showSearch || showCategories) && <div className="faq-tools">
          {showSearch && <form className="faq-search" role="search" onSubmit={submitSearch}>
            <label className="tech-sr" htmlFor="faq-search-input">Buscar por pregunta</label>
            <i className="fas fa-search faq-search-icon" aria-hidden="true" />
            <input id="faq-search-input" type="search" maxLength={100} value={search} placeholder="Buscar por pregunta" autoComplete="off" onChange={event => setSearch(event.target.value)} />
            <button type="submit" className="home-button tech-btn">Buscar</button>
            {(search || query) && <button type="button" className="home-button home-button-outline tech-btn faq-outline" onClick={() => { clearSearch(); document.getElementById('faq-search-input')?.focus() }}>Limpiar</button>}
          </form>}
          {showCategories && <div className="faq-chips" role="group" aria-label="Filtrar por categoría">
            {['', ...(category && !categories.includes(category) ? [category] : []), ...categories].map(value => <button type="button" key={value || 'todas'} className="faq-chip" aria-pressed={value === category} onClick={() => selectCategory(value)}>
              {value ? categoryLabel(value) : 'Todas'}
            </button>)}
          </div>}
          <p className="faq-count" aria-live="polite">{countText}</p>
        </div>}

        <div className="faq-results" ref={resultsRef} tabIndex={-1} aria-label="Lista de preguntas frecuentes">
          {body}
        </div>

        {!list.error && !noPublished && pages > 1 && <nav className="tech-pagination faq-pagination" aria-label="Páginas de preguntas frecuentes">
          <button type="button" className="home-button home-button-outline tech-btn faq-outline" disabled={list.loading || page <= 1} onClick={() => goToPage(page - 1)}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button type="button" className="home-button home-button-outline tech-btn faq-outline" disabled={list.loading || page >= pages} onClick={() => goToPage(page + 1)}>Siguiente</button>
        </nav>}
      </div>
    </section>

    {showCta && <section className="tech-section is-dark faq-cta" aria-labelledby="faq-cta-title">
      <div className="container">
        <h2 id="faq-cta-title" className="fade-up">¿No encontraste lo que buscabas?</h2>
        <p className="fade-up">Puedes enviarnos tu consulta con el formulario de contacto.</p>
        <Link className="home-button fade-up" to={CONTACT_PATH}><i className="fas fa-comments" aria-hidden="true" /> Consultar con el equipo</Link>
      </div>
    </section>}
  </>
}
