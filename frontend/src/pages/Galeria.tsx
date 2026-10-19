import { useEffect, useState } from 'react'
import { usePublicResource } from '../hooks/usePublicResource'
import useReducedMotion from '../hooks/useReducedMotion'
import PageHero from '../components/PageHero'
import SectionHead from '../components/SectionHead'
import GalleryBand from '../components/gallery/GalleryBand'
import GalleryFilters from '../components/gallery/GalleryFilters'
import { GalleryGrid, GallerySkeleton } from '../components/gallery/GalleryGrid'
import GalleryLightbox from '../components/gallery/GalleryLightbox'
import type { GaleriaPublica, PublicList } from '../types/public'

const PAGE_SIZE = 24
type GalleryPage = PublicList<GaleriaPublica> & { categorias: string[] }

export default function Galeria() {
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const reducedMotion = useReducedMotion()
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), ...(category ? { categoria: category } : {}) })
  const { data, loading, error, reload } = usePublicResource<GalleryPage>('galeria?' + params)
  // Se conserva la última página recibida mientras llega la siguiente, para que la altura no colapse al paginar o filtrar.
  const [kept, setKept] = useState<GalleryPage | null>(null)
  if (data && data !== kept) setKept(data)
  const view = data ?? kept
  useEffect(() => { document.title = 'Galería — Horus Group SRL' }, [])

  const selectCategory = (value: string) => { setLightbox(null); setCategory(value); setPage(1) }
  const goToPage = (next: number) => {
    setLightbox(null); setPage(next)
    document.getElementById('galeria')?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' })
  }

  let body
  if (error) {
    body = <div className="tech-state" role="alert">
      <p>{error}</p>
      <button type="button" className="home-button tech-btn" onClick={reload}>Reintentar</button>
    </div>
  } else if (!view || (loading && !view.items.length)) {
    body = <GallerySkeleton />
  } else if (!view.items.length) {
    body = <div className="tech-state" role="status">
      <p>{category ? 'No hay imágenes publicadas en esta categoría.' : 'Por el momento no hay fotografías publicadas.'}</p>
      {category && <button type="button" className="home-button tech-btn" onClick={() => selectCategory('')}>Ver todas las fotografías</button>}
    </div>
  } else {
    body = <GalleryGrid items={view.items} busy={loading} onOpen={setLightbox} />
  }
  const pages = !error && view ? view.pagination.pages : 0

  return <>
    <div className="gl-intro">
      <PageHero eyebrow="Galería" title="Nuestro trabajo en imágenes" actions={
        <a href="#galeria" className="home-button home-button-outline"><i className="fas fa-arrow-down" aria-hidden="true" /> Ver fotografías</a>
      }>
        Capacitaciones, proyectos técnicos, eventos y los momentos que forman parte de nuestro trabajo.
      </PageHero>
      <GalleryBand />
    </div>
    <section className="tech-section is-light gl-main" id="galeria" aria-labelledby="galeria-title">
      <div className="container">
        <SectionHead id="galeria-title" eyebrow="Fotografías" title="Galería de momentos">
          Filtra por categoría y amplía cada fotografía para verla con más detalle.
        </SectionHead>
        <GalleryFilters categories={view?.categorias ?? []} active={category} total={view && !error ? view.pagination.total : null} onSelect={selectCategory} />
        {body}
        {pages > 1 && <nav className="tech-pagination gl-pagination" aria-label="Páginas de galería">
          <button type="button" className="home-button home-button-outline tech-btn gl-page-btn" disabled={loading || page <= 1} onClick={() => goToPage(page - 1)}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button type="button" className="home-button home-button-outline tech-btn gl-page-btn" disabled={loading || page >= pages} onClick={() => goToPage(page + 1)}>Siguiente</button>
        </nav>}
      </div>
    </section>
    {!loading && !error && view && lightbox !== null && view.items[lightbox] && <GalleryLightbox items={view.items} initial={lightbox} close={() => setLightbox(null)} />}
  </>
}
