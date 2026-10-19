import { useEffect, type RefObject } from 'react'
import useReducedMotion from '../../hooks/useReducedMotion'

// Subtle 3D follow for fine pointers: at most `max` degrees. Touch devices and reduced motion get nothing.
export default function useTilt(ref: RefObject<HTMLElement | null>, max = 2.5) {
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    const element = ref.current
    if (!element || reducedMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let frame = 0
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = element.getBoundingClientRect()
        const x = (event.clientX - box.left) / box.width
        const y = (event.clientY - box.top) / box.height
        element.style.setProperty('--ry', ((x - .5) * 2 * max).toFixed(2))
        element.style.setProperty('--rx', ((.5 - y) * 2 * max).toFixed(2))
        element.style.setProperty('--mx', (x * 100).toFixed(1) + '%')
        element.style.setProperty('--my', (y * 100).toFixed(1) + '%')
        element.classList.add('is-tilting')
      })
    }
    const leave = () => {
      cancelAnimationFrame(frame)
      element.classList.remove('is-tilting')
      element.style.setProperty('--rx', '0')
      element.style.setProperty('--ry', '0')
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    return () => { cancelAnimationFrame(frame); element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', leave) }
  }, [ref, max, reducedMotion])
}
