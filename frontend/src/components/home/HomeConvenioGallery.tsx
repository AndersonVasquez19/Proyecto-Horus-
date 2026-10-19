import { useEffect, useRef, useState } from 'react'
import useReducedMotion from '../../hooks/useReducedMotion'
import type { ConvenioFoto } from '../../types/convenios'

function GalleryImage({ foto, title, onReady }: { foto: ConvenioFoto; title: string; onReady: () => void }) {
  const [failed, setFailed] = useState(false)
  return failed ? <span>Sin imagen disponible</span> :
    <img src={foto.imagen_url} alt={title} decoding="async" onLoad={event => { event.currentTarget.decode().catch(() => {}).then(onReady) }}
      onError={() => { setFailed(true); onReady() }} />
}

export default function HomeConvenioGallery({ fotos, nombre }: { fotos: ConvenioFoto[]; nombre: string }) {
  const [frame, setFrame] = useState<{ current: number; next: number | null; ready: boolean }>({ current: 0, next: null, ready: false })
  const touch = useRef<{ x: number; y: number } | null>(null)
  const scheduled = useRef<number[]>([])
  const reducedMotion = useReducedMotion()
  useEffect(() => () => scheduled.current.forEach(window.cancelAnimationFrame), [])
  useEffect(() => {
    if (!frame.ready || frame.next === null) return
    const timer = window.setTimeout(() => {
      setFrame(value => value.next === null ? value : { current: value.next, next: null, ready: false })
    }, reducedMotion ? 0 : 450)
    return () => window.clearTimeout(timer)
  }, [frame.ready, frame.next, reducedMotion])
  if (!fotos.length) return null
  const choose = (index: number) => setFrame(value => value.next !== null || index === value.current ? value :
    { ...value, next: index, ready: false })
  const move = (step: number) => setFrame(value => value.next !== null || fotos.length < 2 ? value :
    { ...value, next: (value.current + step + fotos.length) % fotos.length, ready: false })
  const loaded = (index: number) => {
    if (frame.next !== index || frame.ready) return
    // Paint the incoming layer at opacity 0 before starting the crossfade.
    scheduled.current.push(window.requestAnimationFrame(() => {
      scheduled.current.push(window.requestAnimationFrame(() => {
        setFrame(value => value.next !== index ? value : reducedMotion ?
          { current: index, next: null, ready: false } : { ...value, ready: true })
      }))
    }))
  }
  return <section className="home-conv-gallery" role="region" aria-roledescription={fotos.length > 1 ? 'carrusel' : undefined}
    aria-label={'Fotografías de ' + nombre} tabIndex={fotos.length > 1 ? 0 : undefined}
    onKeyDown={event => {
      if (fotos.length < 2 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1)
    }}
    onTouchStart={event => { const t = event.touches[0]; touch.current = { x: t.clientX, y: t.clientY } }}
    onTouchEnd={event => {
      const t = event.changedTouches[0], start = touch.current
      touch.current = null
      if (!start || fotos.length < 2) return
      const dx = t.clientX - start.x, dy = t.clientY - start.y
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1)
    }}>
    <span className="home-conv-gallery-title" aria-hidden="true">Fotografías del convenio</span>
    <figure className="home-conv-photo">
      <div className={'home-conv-photo-stage' + (frame.ready ? ' is-crossfading' : '')} aria-busy={frame.next !== null}>
        {[frame.current, ...(frame.next === null ? [] : [frame.next])].map(index =>
          <div key={fotos[index].id} className={'home-conv-photo-layer' + (index === frame.next ? ' is-next' : '')}
            aria-hidden={index !== frame.current}>
            <GalleryImage foto={fotos[index]} title={nombre + ' — fotografía ' + (index + 1)} onReady={() => loaded(index)} />
          </div>)}
      </div>
      <figcaption aria-live="polite">Fotografía {frame.current + 1} de {fotos.length}</figcaption>
    </figure>
    {fotos.length > 1 && <div className="home-conv-gallery-dots" role="group" aria-label="Elegir fotografía">
      {fotos.map((foto, index) => <button key={foto.id} type="button"
        aria-label={'Ver fotografía ' + (index + 1) + ' de ' + fotos.length}
        aria-pressed={frame.current === index} aria-disabled={frame.next !== null} onClick={() => choose(index)} />)}
    </div>}
    {fotos.length > 1 && <div className="home-conv-gallery-controls">
      <button type="button" className="home-button home-button-outline" aria-label="Fotografía anterior" aria-disabled={frame.next !== null} onClick={() => move(-1)}>
        <i className="fas fa-chevron-left" aria-hidden="true" /> Anterior</button>
      <button type="button" className="home-button home-button-outline" aria-label="Fotografía siguiente" aria-disabled={frame.next !== null} onClick={() => move(1)}>
        Siguiente <i className="fas fa-chevron-right" aria-hidden="true" /></button>
    </div>}
  </section>
}
