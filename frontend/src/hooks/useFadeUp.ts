import { useEffect } from 'react'

export default function useFadeUp() {
  useEffect(() => {
    const root = document.querySelector('.site-layout') ?? document
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pending = new Set<Element>()
    const reveal = (element: Element) => {
      element.classList.add('visible')
      observer?.unobserve(element)
      pending.delete(element)
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) reveal(entry.target) })
    }, { threshold: 0.15, rootMargin: '0px 0px -36px 0px' })
    const register = (element: Element) => {
      if (element.classList.contains('visible') || pending.has(element)) return
      if (media.matches || !observer) { reveal(element); return }
      element.classList.add('reveal-ready')
      pending.add(element)
      observer.observe(element)
    }
    root.querySelectorAll('.fade-up').forEach(register)
    // Remote lists mount after the initial effect; observe only inserted elements.
    const mutations = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return
        if (node.matches('.fade-up')) register(node)
        node.querySelectorAll('.fade-up').forEach(register)
      }))
      pending.forEach(element => {
        if (!element.isConnected) { observer?.unobserve(element); pending.delete(element) }
      })
    })
    mutations.observe(root, { childList: true, subtree: true })
    const onTransition = (event: Event) => {
      if (event instanceof TransitionEvent && event.propertyName === 'opacity' &&
        event.target instanceof Element && event.target.matches('.fade-up.visible')) {
        event.target.classList.add('reveal-complete')
      }
    }
    root.addEventListener('transitionend', onTransition)
    const onMotion = () => { if (media.matches) pending.forEach(reveal) }
    // A keyboard user never has to wait for a hidden link or button.
    const onFocus = (event: Event) => {
      if (!(event.target instanceof Element)) return
      let element = event.target.closest('.fade-up')
      while (element) { reveal(element); element = element.parentElement?.closest('.fade-up') ?? null }
    }
    media.addEventListener('change', onMotion)
    root.addEventListener('focusin', onFocus)
    return () => {
      observer?.disconnect()
      mutations.disconnect()
      media.removeEventListener('change', onMotion)
      root.removeEventListener('focusin', onFocus)
      root.removeEventListener('transitionend', onTransition)
      pending.forEach(element => element.classList.remove('reveal-ready'))
    }
  }, [])
}
