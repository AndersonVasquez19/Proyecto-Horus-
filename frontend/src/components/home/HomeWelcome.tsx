import { useEffect, useState, type ReactNode } from 'react'
import logoHorus from '../../assets/images/logo-horus.png'
import { useCompanySetting } from '../../context/companySettings'

// Home is imported with the initial application, before internal navigation.
const enteredOnHome = typeof window !== 'undefined' && window.location.pathname === '/'
let welcomed = false

export default function HomeWelcome({ children }: { children: (ready: boolean) => ReactNode }) {
  const [visible, setVisible] = useState(() => enteredOnHome && !welcomed)
  const setting = useCompanySetting()

  useEffect(() => {
    if (!visible) return
    welcomed = true
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const dismiss = () => setVisible(false)
    const timer = window.setTimeout(dismiss, motion.matches ? 400 : 650)
    // The greeting never delays an attempt to use the page.
    window.addEventListener('pointerdown', dismiss, { once: true })
    window.addEventListener('keydown', dismiss, { once: true })
    window.addEventListener('wheel', dismiss, { once: true, passive: true })
    motion.addEventListener('change', dismiss, { once: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', dismiss)
      window.removeEventListener('wheel', dismiss)
      motion.removeEventListener('change', dismiss)
    }
  }, [visible])

  return <>
    {visible && <div className="home-welcome" role="status" aria-live="polite" aria-atomic="true">
    <div className="home-welcome-content">
      <div className="home-welcome-emblem">
        <span className="home-welcome-ring" aria-hidden="true" />
        <img src={logoHorus} alt="" width="588" height="425" decoding="async" />
      </div>
      <p className="home-welcome-name">{setting('empresa_nombre', 'Horus Group')}</p>
      <p className="home-welcome-greeting">Te da la bienvenida</p>
    </div>
  </div>}
    {children(!visible)}
  </>
}
