import { useEffect, useRef, useState } from 'react'
import HomeConvenioDetail from './HomeConvenioDetail'

export default function HomeConvenioDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (!trigger.current && document.activeElement instanceof HTMLElement) trigger.current = document.activeElement
    const element = dialog.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.showModal()
    return () => {
      window.clearTimeout(timer.current)
      element?.close()
      document.body.style.overflow = overflow
      if (trigger.current?.isConnected) trigger.current.focus()
    }
  }, [])
  const close = () => {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return }
    setClosing(true)
    timer.current = window.setTimeout(onClose, 350)
  }
  return <dialog ref={dialog} id="convModal" className={'home-convenio-dialog' + (closing ? ' is-closing' : '')}
    aria-labelledby="convNombre" onCancel={event => { event.preventDefault(); close() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
    }}>
    <HomeConvenioDetail id={id} onClose={close} />
  </dialog>
}
