import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import useReducedMotion from '../../hooks/useReducedMotion'
import type { ServicioPublico } from '../../types/public'
import { contentIcon } from '../presentation'
import ServiceActions from './ServiceActions'
import ServiceFeatures from './ServiceFeatures'
import ServiceMedia from './ServiceMedia'
import ServiceStat from './ServiceStat'
import { displayTitle } from './text'
import useTilt from './useTilt'

const preload = (src: string | null) => new Promise<void>(resolve => {
  if (!src) return resolve()
  const image = new Image()
  image.onload = image.onerror = () => resolve()
  image.src = src
  window.setTimeout(resolve, 700)
})

// Category selector plus the active category's detail. Selecting crossfades once the next image is ready.
export default function CableTabs({ items }: { items: ServicioPublico[] }) {
  const reducedMotion = useReducedMotion()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [frozenId, setFrozenId] = useState<number | null>(null) // content on screen while the next one loads
  const [swapping, setSwapping] = useState(false)
  const run = useRef(0)
  const tabs = useRef<Record<number, HTMLButtonElement | null>>({})
  const panel = useRef<HTMLDivElement>(null)
  useTilt(panel)
  useEffect(() => () => { run.current = -1 }, [])
  // The panel never shrinks below the tallest content it has shown, so switching category does not move what is below.
  useEffect(() => {
    const release = () => { if (panel.current) panel.current.style.minHeight = '' }
    window.addEventListener('resize', release)
    return () => window.removeEventListener('resize', release)
  }, [panel])

  const selected = items.find(item => item.id === selectedId) ?? items[0]
  const shown = items.find(item => item.id === (frozenId ?? selected.id)) ?? selected

  const select = (item: ServicioPublico) => {
    tabs.current[item.id]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
    if (item.id === selected.id) return
    if (panel.current) panel.current.style.minHeight = Math.max(parseFloat(panel.current.style.minHeight || '0'), panel.current.offsetHeight) + 'px'
    const current = ++run.current
    setSelectedId(item.id)
    setFrozenId(shown.id)
    setSwapping(true)
    const fade = reducedMotion ? Promise.resolve() : new Promise<void>(resolve => window.setTimeout(resolve, 180))
    void Promise.all([fade, preload(item.imagen_url)]).then(() => {
      if (run.current !== current) return
      setFrozenId(null)
      setSwapping(false)
    })
  }
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    select(items[next])
    tabs.current[items[next].id]?.focus()
  }

  return <div className="cable">
    <div className="cable-tabs-wrap">
      <div className="cable-tabs" role="tablist" aria-label="Categorías de cableado">
        {items.map((item, index) => <button key={item.id} ref={element => { tabs.current[item.id] = element }} type="button" role="tab"
          id={'cable-tab-' + item.id} aria-controls="cable-panel" aria-selected={item.id === selected.id} tabIndex={item.id === selected.id ? 0 : -1}
          className="cable-tab" onClick={() => select(item)} onKeyDown={event => move(event, index)}>
          <i className={'fas ' + contentIcon(item.icono)} aria-hidden="true" /><span>{displayTitle(item.nombre_corto || item.titulo)}</span>
        </button>)}
      </div>
    </div>
    <div className="cable-stage fade-up">
      <div ref={panel} className={'cable-panel' + (swapping ? ' is-swapping' : '')} role="tabpanel" id="cable-panel"
        aria-labelledby={'cable-tab-' + selected.id} aria-busy={swapping}>
        <div className="cable-panel-media tech-media">
          <ServiceMedia src={shown.imagen_url} title={displayTitle(shown.titulo)} priority />
          {shown.destacado && <span className="cable-panel-badge">{displayTitle(shown.destacado)}</span>}
        </div>
        <div className="cable-panel-info">
          <ServiceStat item={shown} />
          <h3>{displayTitle(shown.titulo)}</h3>
          <p className="tech-desc">{shown.descripcion}</p>
          <ServiceFeatures value={shown.etiquetas} label="Características" />
          <ServiceActions item={shown} />
        </div>
      </div>
    </div>
  </div>
}
