import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { GaleriaPublica } from '../../types/public'
import GalleryImage from './GalleryImage'
import { categoryLabel } from './galleryText'

// Distancia mínima (px) de un gesto horizontal para cambiar de foto.
const SWIPE_DISTANCE = 48

// Visor modal sobre <dialog>: foco atrapado y Escape nativos, flechas visibles en móvil, swipe, cierre al pulsar fuera,
// precarga de la foto anterior y siguiente, y contador anunciado. El scroll de fondo se bloquea desde galeria.css
// (html:has(.gl-lightbox[open])), así que no hay nada que restaurar al desmontar.
export default function GalleryLightbox({ items, initial, close }: { items: GaleriaPublica[]; initial: number; close: () => void }) {
  const [index, setIndex] = useState(initial)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const preloaded = useRef(new Map<string, HTMLImageElement>())
  const item = items[index]
  const many = items.length > 1
  const move = (offset: number) => { if (many) setIndex(value => (value + offset + items.length) % items.length) }

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { dialog?.close(); previous?.focus() }
  }, [])

  useEffect(() => {
    if (!many) return
    for (const offset of [1, -1]) {
      const url = items[(index + offset + items.length) % items.length].imagen_url
      if (!url || preloaded.current.has(url)) continue
      const image = new Image()
      image.decoding = 'async'
      image.src = url
      preloaded.current.set(url, image)
    }
  }, [index, items, many])

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (target) { event.preventDefault(); move(target) }
    else if (event.key === 'Home' && many) { event.preventDefault(); setIndex(0) }
    else if (event.key === 'End' && many) { event.preventDefault(); setIndex(items.length - 1) }
  }
  // Pulsar el fondo del diálogo o los huecos del escenario cierra; la foto, el pie y los botones no.
  const dismiss = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target === dialogRef.current || target.hasAttribute('data-dismiss')) close()
  }
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') return
    swipeStart.current = { x: event.clientX, y: event.clientY }
  }
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const dx = event.clientX - start.x, dy = event.clientY - start.y
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 1 : -1)
  }

  return <dialog ref={dialogRef} className="gl-lightbox" aria-label="Visor de fotografías" onKeyDown={onKeyDown} onClick={dismiss}
    onCancel={event => { event.preventDefault(); close() }}>
    <div className="gl-lb-frame" data-dismiss>
      <div className="gl-lb-bar" data-dismiss>
        <p className="gl-lb-count" aria-live="polite" aria-atomic="true">Imagen {index + 1} de {items.length}</p>
        <button type="button" className="gl-lb-btn" aria-label="Cerrar visor" onClick={close}><i className="fas fa-times" aria-hidden="true" /></button>
      </div>
      <div className="gl-lb-stage" data-dismiss onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipeStart.current = null }}>
        {many && <button type="button" className="gl-lb-btn gl-lb-prev" aria-label="Imagen anterior" onClick={() => move(-1)}><i className="fas fa-chevron-left" aria-hidden="true" /></button>}
        <figure className="gl-lb-figure">
          <div className="gl-lb-media"><GalleryImage key={item.id} src={item.imagen_url} alt={item.titulo} className="gl-lb-img" /></div>
          <figcaption className="gl-lb-caption">
            <span className="gl-lb-cat">{categoryLabel(item.categoria)}</span>
            <strong>{item.titulo}</strong>
            {item.descripcion && <p>{item.descripcion}</p>}
          </figcaption>
        </figure>
        {many && <button type="button" className="gl-lb-btn gl-lb-next" aria-label="Imagen siguiente" onClick={() => move(1)}><i className="fas fa-chevron-right" aria-hidden="true" /></button>}
      </div>
    </div>
  </dialog>
}
