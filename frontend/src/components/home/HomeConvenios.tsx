import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import logoHorus from '../../assets/images/logo-horus.png'
import PublicImage from '../PublicImage'
import HomeConvenioDialog from './HomeConvenioDialog'
import HomeConvenioDetail from './HomeConvenioDetail'
import useReducedMotion from '../../hooks/useReducedMotion'
import type { ConvenioResource } from '../../types/convenios'

const viewportQuery = '(max-width: 1024px)'
const subscribeViewport = (callback: () => void) => {
  const media = window.matchMedia(viewportQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

export default function HomeConvenios({ resource, page, onPage }: {
  resource: ConvenioResource; page: number; onPage: (page: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const [displayed, setDisplayed] = useState<number | null>(null)
  const [changing, setChanging] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const compact = useSyncExternalStore(subscribeViewport, () => window.matchMedia(viewportQuery).matches, () => true)
  const reducedMotion = useReducedMotion()
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const select = (id: number | null) => {
    window.clearTimeout(timer.current)
    setSelected(id)
    if (compact || reducedMotion || id === displayed) {
      setDisplayed(id)
      setChanging(false)
    } else {
      setChanging(true)
      timer.current = window.setTimeout(() => { setDisplayed(id); setChanging(false) }, 350)
    }
    if (id === null && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
  }
  const { data, loading, error, reload } = resource
  return <section className="home-convenios" aria-labelledby="home-convenios-title"
    onKeyDown={event => {
      if (!compact && selected !== null && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); select(null)
      }
    }}>
    <div className="container">
      <div className="home-section-head fade-up">
        <span className="home-eyebrow">Alianzas</span>
        <h2 id="home-convenios-title">Convenios que respaldan tu certificación</h2>
        <p>Conoce nuestras alianzas institucionales y sus actividades.</p>
      </div>
      {loading ? <p role="status" className="home-conv-notice">Cargando convenios…</p> :
        error ? <div role="alert" className="home-conv-notice"><p>{error}</p><button className="home-button" onClick={reload}>Reintentar convenios</button></div> :
        !data?.items.length ? <div className="home-conv-notice" role="status"><p>No hay convenios visibles en este momento.</p>
          {page > 1 && <button className="home-button" onClick={() => onPage(1)}>Volver al inicio de convenios</button>}</div> :
        <div className="home-conv-grid">
          <div id="home-conv-center" className="home-conv-brand home-conv-center fade-up"
            style={!compact ? { gridRow: 1 } : undefined}
            role="region" aria-label="Detalle del convenio" aria-busy={!compact && changing}>
            <div key={compact ? 'brand' : displayed ?? 'brand'}
              className={'home-conv-content' + (!compact && changing ? ' is-leaving' : '')}
              inert={!compact && changing}>
              {!compact && displayed !== null ? <HomeConvenioDetail inline id={displayed} onClose={() => select(null)} /> :
                <div className="home-conv-identity">
                  <img src={logoHorus} alt="" aria-hidden="true" width="588" height="425" loading="lazy" />
                  <h3>Selecciona un convenio</h3>
                  <p>Conoce nuestras alianzas institucionales y sus beneficios.</p>
                </div>}
            </div>
          </div>
          {[data.items.slice(0, Math.ceil(data.items.length / 2)), data.items.slice(Math.ceil(data.items.length / 2))].map((group, side) =>
            <div key={side} className="home-conv-side" style={!compact ? { gridColumn: side === 0 ? 1 : 3, gridRow: 1 } : undefined}>
            {group.map((convenio, index) => <button type="button" key={convenio.id}
            data-reveal-index={index + side * Math.ceil(data.items.length / 2)}
            className={'home-conv-card fade-up' + (selected === convenio.id ? ' is-selected' : '')} onClick={event => { trigger.current = event.currentTarget; select(convenio.id) }}
            aria-haspopup={compact ? 'dialog' : undefined} aria-controls={compact ? undefined : 'home-conv-center'}
            aria-expanded={selected === convenio.id}>
            <span className="home-conv-logo" aria-hidden="true"><PublicImage src={convenio.logo_url} title="" /></span>
            <span className="home-conv-name">{convenio.nombre}</span>
            {convenio.sigla && <span className="home-conv-sigla">{convenio.sigla}</span>}
            <span className="home-conv-more">Conocer convenio <i className="fas fa-arrow-right" aria-hidden="true" /></span>
          </button>)}</div>)}
        </div>}
      {!loading && !error && data && data.pagination.pages > 1 && <nav className="home-conv-pagination" aria-label="Páginas de convenios">
        <button className="home-button home-button-outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
        <span>Página {page} de {data.pagination.pages}</span>
        <button className="home-button home-button-outline" disabled={page >= data.pagination.pages} onClick={() => onPage(page + 1)}>Siguiente</button>
      </nav>}
    </div>
    {compact && selected !== null && <HomeConvenioDialog key={selected} id={selected} onClose={() => select(null)} />}
  </section>
}
