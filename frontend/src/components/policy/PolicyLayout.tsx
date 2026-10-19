import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import PageHero from '../PageHero'
import { usePolicyCompany } from './usePolicyCompany'

export type PolicyKey = 'privacidad' | 'cookies' | 'devolucion'
export type PolicyIndexItem = { id: string; label: string }

const RELATED = [
  { key: 'privacidad', to: '/politicas/privacidad', label: 'Política de Privacidad' },
  { key: 'cookies', to: '/politicas/cookies', label: 'Política de Cookies' },
  { key: 'devolucion', to: '/politicas/devolucion', label: 'Política de Devolución' },
  { key: 'faq', to: '/preguntas-frecuentes', label: 'Preguntas frecuentes' },
  { key: 'contacto', to: '/contactos', label: 'Contactos' },
]

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Shared structure of the legal pages: PageHero, a comfortable reading column, an optional index (sticky on desktop,
// collapsible on phones and tablets) and the related navigation. The legal text itself stays in each page.
// `closing` is each page's own closing heading and sentence (kept verbatim); the links below it replace the old buttons.
export default function PolicyLayout({ current, title, description, index, closing, children }: {
  current: PolicyKey; title: string; description: string; index?: PolicyIndexItem[]
  closing: { title: string; text: string }; children: ReactNode
}) {
  const { hash } = useLocation()
  const { empresa } = usePolicyCompany()
  const [active, setActive] = useState(index?.[0]?.id ?? '')
  const tocRef = useRef<HTMLDetailsElement>(null)
  const hadHash = useRef(false)
  const firstScroll = useRef(true)

  useEffect(() => { document.title = title + ' — ' + empresa }, [title, empresa])

  // The URL hash is the source of truth: clicking an index link, opening a shared link and Back/Forward all end here.
  // It runs in a timeout because MainLayout resets the scroll to the top after the page mounts; a shared link with a
  // #hash must land on its section after that reset, and does so without animation.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const behavior = reducedMotion() || firstScroll.current ? 'instant' : 'smooth'
      firstScroll.current = false
      if (!hash) {
        if (hadHash.current) { hadHash.current = false; window.scrollTo({ top: 0, behavior }) }
        return
      }
      const target = document.getElementById(decodeURIComponent(hash.slice(1)))
      if (!target) return
      hadHash.current = true
      target.scrollIntoView({ block: 'start', behavior })
      target.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [hash])

  // Highlights the section being read. Sections are measured from the viewport, so it also works with the sticky navbar.
  useEffect(() => {
    if (!index) return
    let frame = 0
    const update = () => {
      frame = 0
      const line = window.innerHeight * 0.3
      let current = index[0].id
      for (const item of index) {
        const element = document.getElementById(item.id)
        if (element && element.getBoundingClientRect().top <= line) current = item.id
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = index[index.length - 1].id
      setActive(current)
    }
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [index])

  const indexLinks = index?.map(item => <li key={item.id}>
    <Link to={{ hash: '#' + item.id }} aria-current={active === item.id ? 'location' : undefined}
      onClick={() => {
        if (tocRef.current) tocRef.current.open = false
        // Same hash twice does not navigate: scroll again by hand.
        if (hash === '#' + item.id) { const target = document.getElementById(item.id); target?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'instant' : 'smooth' }); target?.focus({ preventScroll: true }) }
      }}>{item.label}</Link>
  </li>)

  return <>
    <PageHero eyebrow="Legal" title={title}>{description}</PageHero>

    <div className="policy-page">
      <div className={'container policy-layout' + (index ? ' has-index' : '')}>
        {index && <nav className="policy-index" aria-label="Índice de esta política">
          <p className="policy-index-title">En esta página</p>
          <ol>{indexLinks}</ol>
        </nav>}
        <div className="policy-column">
          {index && <details className="policy-toc" ref={tocRef}>
            <summary>En esta página</summary>
            <nav aria-label="Índice de esta política"><ol>{indexLinks}</ol></nav>
          </details>}
          <div className="policy-body">{children}</div>
        </div>
      </div>
    </div>

    <section className="tech-section is-dark policy-related" aria-labelledby="policy-related-title">
      <div className="container">
        <h2 id="policy-related-title">{closing.title}</h2>
        <p>{closing.text}</p>
        <nav aria-label="Páginas relacionadas">
          <ul>{RELATED.filter(item => item.key !== current).map(item => <li key={item.key}><Link to={item.to}>{item.label}</Link></li>)}</ul>
        </nav>
      </div>
    </section>
  </>
}

// A numbered / titled block of a policy. Its heading carries id={id + '-title'}; the section is a focus target for the index.
export function PolicySection({ id, children }: { id: string; children: ReactNode }) {
  return <section id={id} tabIndex={-1} aria-labelledby={id + '-title'} className="policy-section fade-up">{children}</section>
}
