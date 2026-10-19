import { useEffect, useRef, useState } from 'react'
import useReducedMotion from '../../hooks/useReducedMotion'

export default function AnimatedCounter({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  const element = useRef<HTMLSpanElement>(null)
  const started = useRef(false)
  const reducedMotion = useReducedMotion()
  const [frame, setFrame] = useState({ target: value, value: 0 })
  useEffect(() => {
    if (value === null || started.current || !element.current || typeof IntersectionObserver === 'undefined') return
    let raf = 0
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return }
      started.current = true
      observer.disconnect()
      const start = performance.now()
      const tick = (now: number) => {
        const progress = Math.min((now - start) / 1200, 1)
        setFrame({ target: value, value: Math.round(value * (1 - Math.pow(1 - progress, 3))) })
        if (progress < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, { threshold: 0.5, rootMargin: '0px 0px -36px 0px' })
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finish = () => {
      if (!media.matches) {
        if (!started.current && element.current) observer.observe(element.current)
        return
      }
      started.current = true
      observer.disconnect()
      cancelAnimationFrame(raf)
      setFrame({ target: value, value })
    }
    media.addEventListener('change', finish)
    if (media.matches) raf = requestAnimationFrame(finish)
    else observer.observe(element.current)
    return () => { observer.disconnect(); cancelAnimationFrame(raf); media.removeEventListener('change', finish) }
  }, [value])
  const final = value === null ? '—' : value + suffix
  const displayed = value === null || reducedMotion || frame.target !== value ||
    typeof IntersectionObserver === 'undefined' ? final : frame.value + suffix
  return <strong aria-label={final}><span ref={element} aria-hidden="true">{displayed}</span></strong>
}
