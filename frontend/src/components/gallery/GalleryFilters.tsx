import { categoryLabel } from './galleryText'

// Chips de categoría y contador. El chip activo se resalta con aria-pressed, sin depender solo del color.
export default function GalleryFilters({ categories, active, total, onSelect }: {
  categories: string[]; active: string; total: number | null; onSelect: (category: string) => void;
}) {
  // Orden estable: el de la API. Solo si la categoría activa no viene en la lista se antepone, para no perder su chip.
  const options = ['', ...(active && !categories.includes(active) ? [active, ...categories] : categories)]
  return <div className="gl-toolbar">
    <div className="gl-chips" role="group" aria-label="Categorías de fotografías">
      {options.map(value => <button type="button" key={value || 'todos'} className="gl-chip" aria-pressed={value === active} onClick={() => onSelect(value)}>
        {value ? categoryLabel(value) : 'Todos'}
      </button>)}
    </div>
    <p className="gl-count" aria-live="polite">{total === null ? '' : total + (total === 1 ? ' foto' : ' fotos')}</p>
  </div>
}
