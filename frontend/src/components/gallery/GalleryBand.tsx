import { useEffect, useRef, type CSSProperties } from 'react'
import { usePublicResource } from '../../hooks/usePublicResource'
import useReducedMotion from '../../hooks/useReducedMotion'
import type { GaleriaPublica, PublicList } from '../../types/public'
import GalleryImage from './GalleryImage'

const BAND_SIZE = 4
// Desplazamiento vertical máximo de cada imagen (px) mientras la franja cruza la pantalla.
const MAX_SHIFT = 10

// Franja decorativa bajo el hero: las primeras fotos publicadas, con entrada escalonada y un parallax ligero.
// Es una sola petición de BAND_SIZE fotos, sin duplicar listas, y queda estática con movimiento reducido.
export default function GalleryBand() {
  const { data, loading, error } = usePublicResource<PublicList<GaleriaPublica>>('galeria?page=1&limit=' + BAND_SIZE)
  const reducedMotion = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const items = data?.items.slice(0, BAND_SIZE) ?? []
  const showing = loading || (!error && items.length > 0)

  useEffect(() => {
    const root = ref.current
    if (!root || reducedMotion || typeof IntersectionObserver === 'undefined') return
    const panels = Array.from(root.querySelectorAll<HTMLElement>('.gl-band-panel'))
    let frame = 0
    const update = () => {
      frame = 0
      const middle = window.innerHeight / 2
      panels.forEach(panel => {
        const box = panel.getBoundingClientRect()
        const progress = Math.max(-1, Math.min(1, (box.top + box.height / 2 - middle) / window.innerHeight))
        panel.style.setProperty('--gl-shift', (-progress * MAX_SHIFT).toFixed(1) + 'px')
      })
    }
    const request = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    const listen = () => { window.addEventListener('scroll', request, { passive: true }); window.addEventListener('resize', request) }
    const unlisten = () => { window.removeEventListener('scroll', request); window.removeEventListener('resize', request) }
    // Solo escucha el scroll mientras la franja está visible.
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) { listen(); request() } else unlisten()
    })
    observer.observe(root)
    return () => {
      observer.disconnect(); unlisten()
      if (frame) window.cancelAnimationFrame(frame)
      panels.forEach(panel => panel.style.removeProperty('--gl-shift'))
    }
  }, [reducedMotion, items.length])

  if (!showing) return null
  const count = loading ? BAND_SIZE : items.length
  return <div className="gl-band">
    <div className="container">
      {/* Decorativa: las mismas fotos están, con su descripción, en la galería de abajo. */}
      <div ref={ref} className="gl-band-grid" aria-hidden="true" data-count={count} style={{ '--gl-count': count } as CSSProperties}>
        {loading
          ? Array.from({ length: count }, (_, index) => <div className="gl-band-panel" key={index} />)
          : items.map(item => <div className="gl-band-panel fade-up" key={item.id}><GalleryImage src={item.imagen_url} quiet /></div>)}
      </div>
    </div>
  </div>
}
