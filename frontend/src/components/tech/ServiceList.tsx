import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usePublicResource } from '../../hooks/usePublicResource'
import type { PublicList, ServicioPublico } from '../../types/public'

// Loads the published services of one category and owns the loading, error and empty states.
export default function ServiceList({ category, children }: { category: string; children: (items: ServicioPublico[]) => ReactNode }) {
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = usePublicResource<PublicList<ServicioPublico>>('servicios?' + new URLSearchParams({ page: String(page), limit: '12', categoria: category }))
  if (error) return <div className="tech-state" role="alert">
    <p>{error}</p><button type="button" className="home-button tech-btn" onClick={reload}>Reintentar</button>
  </div>
  if (loading || !data) return <div className="tech-skeleton" role="status">
    <span className="tech-sr">Cargando servicios…</span><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
  </div>
  if (!data.items.length) return <div className="tech-state" role="status">
    <p>Por el momento no hay servicios publicados en esta sección.</p>
    <Link className="home-button tech-btn" to="/contactos">Consultar con el equipo</Link>
  </div>
  const pages = data.pagination.pages
  return <>
    {children(data.items)}
    {pages > 1 && <nav className="tech-pagination" aria-label="Páginas de servicios">
      <button type="button" className="home-button home-button-outline tech-btn" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
      <span>Página {page} de {pages}</span>
      <button type="button" className="home-button home-button-outline tech-btn" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Siguiente</button>
    </nav>}
  </>
}
