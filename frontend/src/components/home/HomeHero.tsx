import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { METRICS, SLIDES } from './homeContent'
import useReducedMotion from '../../hooks/useReducedMotion'
import AnimatedCounter from './AnimatedCounter'

type PhotoStatus = 'loading' | 'ready' | 'error'
const SCENE_DURATION = 12000
const CAMERA_MOVES = [
  ['translate3d(-.8%, .3%, 0) scale(1.045)', 'translate3d(.8%, -.3%, 0) scale(1.045)'],
  ['translate3d(.8%, -.2%, 0) scale(1.045)', 'translate3d(-.8%, .2%, 0) scale(1.045)'],
  ['translate3d(0, -.7%, 0) scale(1.045)', 'translate3d(0, .7%, 0) scale(1.045)'],
  ['translate3d(-.6%, -.4%, 0) scale(1.045)', 'translate3d(.6%, .4%, 0) scale(1.045)'],
]

export default function HomeHero({ conveniosTotal, ready }: { conveniosTotal: number | null; ready: boolean }) {
  const [scene, setScene] = useState<{ current: number; previous: number | null; revision: number }>({ current: 0, previous: null, revision: 0 })
  const { current, previous, revision } = scene
  const [photos, setPhotos] = useState<PhotoStatus[]>(() => SLIDES.map(() => 'loading'))
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [tabVisible, setTabVisible] = useState(() => !document.hidden)
  const [inView, setInView] = useState(true)
  const reducedMotion = useReducedMotion()
  const stage = useRef<HTMLDivElement>(null)
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([])
  const gesture = useRef<{ x: number; y: number; id: number } | null>(null)
  const clock = useRef<Animation | null>(null)
  const continuous = useRef<Animation[]>([])
  const transitions = useRef<Animation[]>([])
  const photoReady = photos[current] === 'ready'
  const stopped = paused || hovered || focused || !tabVisible || !inView || !ready || reducedMotion ||
    !photoReady || photos.filter(status => status !== 'error').length < 2

  const selectPhoto = (index: number) => setScene(value => index === value.current ? value :
    { current: index, previous: value.current, revision: value.revision + 1 })
  const step = (direction: number) => setScene(value => ({
    current: (value.current + direction + SLIDES.length) % SLIDES.length,
    previous: value.current, revision: value.revision + 1,
  }))
  const updatePhoto = (index: number, status: PhotoStatus) => {
    setPhotos(values => values.map((value, position) => position === index ? status : value))
  }

  useEffect(() => {
    const element = stage.current
    const synchronizeVisibility = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', synchronizeVisibility)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(
      entries => setInView(entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .15)),
      { threshold: [0, .15] },
    )
    if (element) observer?.observe(element)
    return () => {
      document.removeEventListener('visibilitychange', synchronizeVisibility)
      observer?.disconnect()
      element?.querySelectorAll('.home-slide-image, .home-slide-photo, .home-slide-light, .home-hero-progress-fill')
        .forEach(child => child.getAnimations().forEach(animation => animation.cancel()))
    }
  }, [])

  // Keep the outgoing camera position while the next photo reveals over it.
  useLayoutEffect(() => {
    const element = stage.current
    if (reducedMotion) {
      element?.querySelectorAll('.home-slide-image, .home-slide-photo, .home-slide-light, .home-hero-progress-fill')
        .forEach(child => child.getAnimations().forEach(animation => animation.cancel()))
      clock.current = null
      continuous.current = []
      transitions.current = []
      return
    }
    if (!ready || !photoReady) return
    const image = element?.querySelector<HTMLImageElement>('.home-slide.is-active .home-slide-photo')
    const frame = element?.querySelector<HTMLElement>('.home-slide.is-active .home-slide-image')
    const light = element?.querySelector<HTMLElement>('.home-slide.is-active .home-slide-light')
    const progress = thumbnails.current[current]?.querySelector<HTMLElement>('.home-hero-progress-fill')
    if (!image || !frame || !progress) return
    image.getAnimations().forEach(animation => animation.cancel())
    const movement = CAMERA_MOVES[current]
    const camera = image.animate([{ transform: movement[0] }, { transform: movement[1] }],
      { duration: SCENE_DURATION, easing: 'ease-in-out', fill: 'forwards' })
    const countdown = progress.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: SCENE_DURATION, easing: 'linear', fill: 'forwards' })
    camera.pause()
    countdown.pause()
    clock.current = countdown
    continuous.current = [camera, countdown]
    const entrance: Animation[] = []
    if (previous !== null) {
      const from = current % 2 === 0 ? 'polygon(0% 0%, 0% 0%, -15% 100%, 0% 100%)' :
        'polygon(115% 0%, 100% 0%, 100% 100%, 100% 100%)'
      entrance.push(frame.animate([{ clipPath: from }, { clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' }],
        { duration: 1350, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' }))
      if (light) entrance.push(light.animate([
        { transform: 'translateX(-100%)', opacity: 0 },
        { transform: 'translateX(0)', opacity: .35, offset: .45 },
        { transform: 'translateX(100%)', opacity: 0 },
      ], { duration: 1500, easing: 'ease-out', fill: 'forwards' }))
    }
    transitions.current = entrance
    return () => {
      countdown.cancel()
      camera.pause()
      entrance.forEach(animation => animation.cancel())
      clock.current = null
      continuous.current = []
      transitions.current = []
    }
  }, [current, previous, revision, ready, reducedMotion, photoReady])

  useLayoutEffect(() => {
    continuous.current.forEach(animation => {
      if (stopped) {
        const time = animation.currentTime
        animation.pause()
        if (time !== null) animation.currentTime = time
      } else if (animation.playState !== 'finished') animation.play()
    })
    transitions.current.forEach(animation => {
      if (animation.playState === 'finished') return
      if (!tabVisible || !inView || !ready) animation.pause()
      else animation.play()
    })
  }, [stopped, current, revision, ready, reducedMotion, photoReady, tabVisible, inView])

  useEffect(() => {
    if (stopped || !clock.current) return
    const remaining = Math.max(0, SCENE_DURATION - Number(clock.current.currentTime ?? 0))
    const timer = window.setTimeout(() => setScene(value => {
      if (value.revision !== revision) return value
      let next = (value.current + 1) % SLIDES.length
      while (next !== value.current && photos[next] === 'error') next = (next + 1) % SLIDES.length
      return next === value.current ? value : { current: next, previous: value.current, revision: value.revision + 1 }
    }), remaining)
    return () => window.clearTimeout(timer)
  }, [stopped, revision, photos])

  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute('data-photo')) return
    const index = Number(event.target.dataset.photo)
    let next: number
    switch (event.key) {
      case 'ArrowLeft': next = (index - 1 + SLIDES.length) % SLIDES.length; break
      case 'ArrowRight': next = (index + 1) % SLIDES.length; break
      case 'Home': next = 0; break
      case 'End': next = SLIDES.length - 1; break
      default: return
    }
    event.preventDefault()
    selectPhoto(next)
    thumbnails.current[next]?.focus()
  }
  const startGesture = (event: PointerEvent<HTMLDivElement>) => {
    gesture.current = null
    if (!event.isPrimary || event.pointerType === 'mouse' ||
      (event.target instanceof Element && event.target.closest('a, button'))) return
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
  }
  const endGesture = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current
    gesture.current = null
    if (!start || start.id !== event.pointerId) return
    const horizontal = event.clientX - start.x
    const vertical = event.clientY - start.y
    if (Math.abs(horizontal) >= 60 && Math.abs(horizontal) > Math.abs(vertical) * 1.5) step(horizontal < 0 ? 1 : -1)
  }

  return <>
    <section className={'home-hero' + (!ready ? ' is-waiting' : '')} aria-labelledby="home-title">
      <div className={'home-hero-stage' + (stopped ? ' is-paused' : '')} ref={stage}
        role="region" aria-roledescription="carrusel" aria-label="Fotografías de Horus Group"
        onFocusCapture={event => {
          if (!(event.target instanceof Element) || !event.target.closest('[data-playback]')) setFocused(true)
        }}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget) ||
            (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-playback]'))) setFocused(false)
        }}
        onPointerDown={startGesture} onPointerUp={endGesture} onPointerCancel={() => { gesture.current = null }}>
        <div className="home-slides">
          {SLIDES.map((slide, index) => <div key={slide.src}
            className={'home-slide' + (index === current ? ' is-active' : index === previous ? ' is-outgoing' : '')}
            aria-hidden={index !== current}>
            <div className="home-slide-image">
              <img className="home-slide-photo" src={slide.src} alt={slide.alt}
                loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : 'auto'} decoding="async"
                onLoad={() => updatePhoto(index, 'ready')} onError={() => updatePhoto(index, 'error')}
                style={{ objectPosition: slide.position }} />
              <span className="home-slide-light" aria-hidden="true" />
            </div>
          </div>)}
        </div>
        <div className="home-hero-shade" aria-hidden="true" />
        <div className="home-hero-copy">
          <span className="home-eyebrow"><i className="fas fa-map-marker-alt" aria-hidden="true" /> Cajamarca, Perú</span>
          <h1 id="home-title">Soluciones que<br /><span className="home-hero-title-line"><span className="home-hero-accent">impulsan</span> tu crecimiento</span></h1>
          <p>Infraestructura tecnológica y formación profesional certificada.
            <span>Conectamos tecnología, educación y nuevas oportunidades.</span></p>
          <div className="home-hero-actions">
            <Link to="/contactos" className="home-button">
              Solicitar información <i className="fas fa-arrow-right" aria-hidden="true" />
            </Link>
            <a href="#ix-services" className="home-button home-button-outline">
              Explorar servicios <i className="fas fa-arrow-down" aria-hidden="true" />
            </a>
          </div>
          <div className="home-hero-disciplines" aria-label="Áreas de Horus Group">
            <span><i className="fas fa-network-wired" aria-hidden="true" /> Tecnología</span>
            <span aria-hidden="true" className="home-hero-divider" />
            <span><i className="fas fa-graduation-cap" aria-hidden="true" /> Educación</span>
          </div>
        </div>
        <div className="home-hero-gallery">
          <div className="home-hero-gallery-heading">
            <div>
              <span className="home-hero-gallery-label">Nuestro trabajo, en imágenes <span className="home-hero-tempo"></span></span>
              <p className="home-carousel-caption" aria-live={stopped ? 'polite' : 'off'} aria-atomic="true">
                {photos[current] === 'error' ? 'No se pudo cargar esta fotografía. Elige otra imagen.' :
                  photos[current] === 'loading' ? 'Cargando fotografía…' : SLIDES[current].alt}
              </p>
            </div>
            <div className="home-carousel-controls">
              <button type="button" className="home-carousel-arrow" aria-label="Imagen anterior" onClick={() => step(-1)}>
                <i className="fas fa-arrow-left" aria-hidden="true" />
              </button>
              {!reducedMotion && <button type="button" className="home-carousel-arrow home-carousel-pause" data-playback
                aria-label={paused ? 'Reanudar presentación' : 'Pausar presentación'} aria-pressed={paused}
                onClick={() => { setPaused(value => !value); setFocused(false) }}>
                <i className={'fas ' + (paused ? 'fa-play' : 'fa-pause')} aria-hidden="true" />
              </button>}
              <button type="button" className="home-carousel-arrow" aria-label="Imagen siguiente" onClick={() => step(1)}>
                <i className="fas fa-arrow-right" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="home-hero-thumbnails" role="group" aria-label="Elegir fotografía" onKeyDown={handleKeys}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            {SLIDES.map((slide, index) => <button type="button" key={slide.src} data-photo={index}
              ref={element => { thumbnails.current[index] = element }}
              aria-label={'Ver imagen ' + (index + 1) + ': ' + slide.alt} aria-pressed={index === current}
              onClick={() => selectPhoto(index)}>
              <span className="home-hero-thumbnail-image"><img src={slide.src} alt="" loading="lazy" decoding="async" style={{ objectPosition: slide.position }} /></span>
              <span className="home-hero-thumbnail-copy">
                <span className="home-hero-thumbnail-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="home-hero-thumbnail-label">{slide.label}</span>
              </span>
              {index === current && <i className="fas fa-check home-hero-thumbnail-check" aria-hidden="true" />}
              {!reducedMotion && index === current && <span className="home-hero-progress" aria-hidden="true"><span className="home-hero-progress-fill" /></span>}
            </button>)}
          </div>
        </div>
      </div>
    </section>
    <section className="home-metrics" aria-label="Horus Group en cifras">
      <div className="container home-metrics-grid">
        {METRICS.map(metric => <article key={metric.lbl} className="home-metric fade-up">
          <span className="home-metric-icon"><i className={'fas ' + metric.icon} aria-hidden="true" /></span>
          <div><AnimatedCounter value={metric.lbl === 'Convenios activos' ? conveniosTotal : parseInt(metric.num, 10)} suffix={metric.num.replace(/[0-9]/g, '')} /><p>{metric.lbl}</p></div>
        </article>)}
      </div>
    </section>
  </>
}
