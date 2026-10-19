import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import logoHorus from '../assets/images/logo-horus.png'
import useReducedMotion from '../hooks/useReducedMotion'

const NAV_ITEMS = [
  { label: 'Inicio',    to: '/' },
  { label: 'Quiénes somos', to: '/quienes-somos' },
  {
    label: 'Tecnologías',
    children: [
      { label: 'Cableado Estructurado', to: '/tecnologias/cableado-estructurado', icon: 'fa-network-wired' },
      { label: 'Cámaras de Seguridad',  to: '/tecnologias/camaras-seguridad',     icon: 'fa-video' },
      { label: 'Soporte y Mantenimiento', to: '/tecnologias/soporte-mantenimiento', icon: 'fa-tools' },
    ],
  },
  {
    label: 'Educación',
    children: [
      { label: 'Asesoramiento',  to: '/educacion/asesoramiento',  icon: 'fa-user-tie' },
      { label: 'Capacitaciones', to: '/educacion/capacitaciones', icon: 'fa-chalkboard-teacher' },
      { label: 'Cursos',         to: '/educacion/cursos',         icon: 'fa-book-open' },
    ],
  },
  { label: 'Galería',  to: '/galeria' },
]

const subscribeViewport = (callback: () => void) => { const media = window.matchMedia('(max-width: 1024px)'); media.addEventListener('change', callback); return () => media.removeEventListener('change', callback); }
export default function Navbar() {
  const [scrolled,    setScrolled]    = useState(false)
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ path: string; label: string } | null>(null)
  const [closingDrop, setClosingDrop] = useState<{ path: string; label: string } | null>(null)
  const reducedMotion = useReducedMotion()
  const { pathname } = useLocation()
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuOpen = menuPath === pathname
  const openDrop = drop?.path === pathname ? drop.label : null
  const mobile = useSyncExternalStore(subscribeViewport, () => window.matchMedia('(max-width: 1024px)').matches, () => false)
  const hoverTimer = useRef(0)
  const lastPointer = useRef('')
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])
  // Un clic fuera del menú desplegable lo cierra (en móvil el cajón ya tiene su propio overlay).
  useEffect(() => {
    if (!openDrop || mobile) return
    const outside = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest('.nav-drop')) setDrop(null) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [openDrop, mobile])
  // El ratón abre y cierra el menú por JavaScript (no con :hover) para que aria-expanded y lo que se ve coincidan siempre.
  const hover = (label: string, over: boolean) => {
    window.clearTimeout(hoverTimer.current)
    if (over) { setClosingDrop(null); setDrop({ path: pathname, label }); return }
    hoverTimer.current = window.setTimeout(() => setDrop(current => current?.label === label ? null : current), 120)
  }
  // Un grupo (Tecnologías, Educación) figura como activo cuando la página actual es una de sus rutas o un detalle suyo.
  const groupActive = (children: { to: string }[]) => pathname.startsWith('/' + children[0].to.split('/')[1])


  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    const initial = window.requestAnimationFrame(onScroll)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.cancelAnimationFrame(initial); window.removeEventListener('scroll', onScroll) }
  }, [])

  useEffect(() => {
    if (!menuOpen || !mobile) return
    const trigger = toggleRef.current
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    listRef.current?.querySelector<HTMLElement>('a,button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { setMenuPath(null); return }
      if (event.key !== 'Tab') return
      const links = Array.from(listRef.current?.querySelectorAll<HTMLElement>('a,button') || []).filter(el => el.getClientRects().length && !el.closest('[inert]'))
      const first=links[0], last=links[links.length-1]
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); toggleRef.current?.focus()}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); toggleRef.current?.focus()}
      else if (document.activeElement === toggleRef.current) {event.preventDefault(); (event.shiftKey ? last : first)?.focus()}
    }
    document.addEventListener('keydown',keydown)
    return () => {document.body.style.overflow=previous;document.removeEventListener('keydown',keydown);trigger?.focus()}
  }, [menuOpen,mobile])

  useEffect(() => {
    if (!closingDrop) return
    const timer = window.setTimeout(() => setClosingDrop(null), reducedMotion ? 0 : 200)
    return () => window.clearTimeout(timer)
  }, [closingDrop, reducedMotion])

  const toggleDrop = (label: string) => {
    if (mobile && !reducedMotion && openDrop) setClosingDrop({ path: pathname, label: openDrop })
    else setClosingDrop(null)
    setDrop(openDrop === label ? null : { path: pathname, label })
  }

  return (
    <header className={`nav${scrolled ? ' scrolled' : ''}`} ref={navRef}>
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <img src={logoHorus} alt="Horus Group" />
          <span>Horus Group SRL</span>
        </Link>

        <div
          className={`nav-overlay${menuOpen ? ' show' : ''}`}
          onClick={() => setMenuPath(null)}
        />

        <nav className="nav-menu" aria-label="Navegación principal">
        <ul ref={listRef} id="public-navigation" inert={mobile && !menuOpen} className={`nav-links${menuOpen ? ' open' : ''}`}>
          {NAV_ITEMS.map(item =>
            item.children ? (
              <li
                key={item.label}
                className={`nav-drop${openDrop === item.label ? ' open' : ''}${closingDrop?.path === pathname && closingDrop.label === item.label && openDrop !== item.label ? ' is-closing' : ''}`}
                onPointerEnter={event => { if (!mobile && event.pointerType === 'mouse') hover(item.label, true) }}
                onPointerLeave={event => { if (!mobile && event.pointerType === 'mouse') hover(item.label, false) }}
                onBlur={event => { const next = event.relatedTarget as Node | null; if (!mobile && next && !event.currentTarget.contains(next)) setDrop(null) }}
                onKeyDown={event => {
                  if (event.key !== 'Escape' || openDrop !== item.label) return
                  event.preventDefault(); event.stopPropagation()
                  toggleDrop(item.label)
                  event.currentTarget.querySelector('button')?.focus()
                }}
              >
                <button type="button" className={groupActive(item.children) ? 'active' : undefined} aria-current={groupActive(item.children) ? 'true' : undefined} aria-expanded={openDrop === item.label} aria-controls={"drop-"+item.label}
                  onPointerDown={event => { lastPointer.current = event.pointerType }}
                  // Con el ratón el menú ya se abrió al pasar por encima: un clic no debe cerrarlo (se cierra al salir). Con teclado o táctil, alterna.
                  onClick={event => { if (!mobile && event.detail > 0 && lastPointer.current === 'mouse' && openDrop === item.label) return; toggleDrop(item.label) }}>
                  {item.label}
                </button>
                <ul id={"drop-"+item.label} className="dropdown" inert={mobile && openDrop !== item.label}>
                  {item.children.map(child => (
                    <li key={child.to}>
                      <NavLink to={child.to}>
                        <i className={`fas ${child.icon}`} />
                        {child.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>
            ) : (
              <li key={item.to}>
                <NavLink to={item.to}>{item.label}</NavLink>
              </li>
            )
          )}
          <li>
            <NavLink to="/contactos" className="nav-cta">Contáctanos</NavLink>
          </li>
        </ul>
        </nav>

        <button
          className={`nav-toggle${menuOpen ? ' open' : ''}`}
          ref={toggleRef}
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} aria-controls="public-navigation"
          onClick={() => setMenuPath(menuOpen ? null : pathname)}
        >
          <span /><span /><span />
        </button>
      </div>
    </header>
  )
}
