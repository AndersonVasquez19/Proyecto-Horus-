import type { GaleriaPublica } from '../../types/public'
import GalleryImage from './GalleryImage'
import { categoryLabel } from './galleryText'

const SKELETON_CELLS = 8

// Cuadrícula en orden de lectura. Título y categoría están siempre visibles; el hover solo refuerza.
// Mientras llega otra página se conserva la anterior atenuada (busy) para no colapsar la altura.
export function GalleryGrid({ items, busy, onOpen }: { items: GaleriaPublica[]; busy: boolean; onOpen: (index: number) => void }) {
  return <ul className="gl-grid" aria-busy={busy} inert={busy}>
    {items.map((item, index) => <li className="gl-cell fade-up" key={item.id}>
      <button type="button" className="gl-card" aria-haspopup="dialog" aria-label={'Ampliar ' + item.titulo + ', ' + categoryLabel(item.categoria)} onClick={() => onOpen(index)}>
        <span className="gl-card-media">
          <GalleryImage src={item.imagen_url} />
          <i className="fas fa-expand gl-card-zoom" aria-hidden="true" />
        </span>
        <span className="gl-card-body">
          <span className="gl-card-cat">{categoryLabel(item.categoria)}</span>
          <span className="gl-card-title">{item.titulo}</span>
        </span>
      </button>
    </li>)}
  </ul>
}

export function GallerySkeleton() {
  return <div className="gl-grid gl-skeleton" role="status">
    <span className="tech-sr">Cargando fotografías…</span>
    {Array.from({ length: SKELETON_CELLS }, (_, index) => <span key={index} aria-hidden="true" />)}
  </div>
}
