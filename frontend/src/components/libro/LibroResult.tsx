import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Registered } from './LibroForm'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Copia con la API del portapapeles y, si no está disponible (p. ej. contexto no seguro), con un textarea temporal.
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true }
  } catch { /* se intenta el método alternativo */ }
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(area)
  area.select()
  let done: boolean
  try { done = document.execCommand('copy') } catch { done = false }
  area.remove()
  return done
}

// Estado de éxito: se acerca a la vista, recibe el foco y es lo único que imprime "Imprimir constancia" (ver libro.css).
export default function LibroResult({ result }: { result: Registered }) {
  const { numero, mailSent, constancia } = result
  const headingRef = useRef<HTMLHeadingElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const [copy, setCopy] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = useRef(0)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
    // Marca la página para que @media print muestre solo la constancia.
    document.body.classList.add('lb-print')
    return () => { document.body.classList.remove('lb-print'); window.clearTimeout(timer.current) }
  }, [])

  const handleCopy = async () => {
    const ok = await copyText(numero)
    setCopy(ok ? 'ok' : 'fail')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopy('idle'), 3000)
  }

  return <section ref={sectionRef} className="lb-result" aria-labelledby="lb-result-title">
    <div className="lb-result-head">
      <span className="lb-result-icon" aria-hidden="true"><i className="fas fa-check" /></span>
      <h2 id="lb-result-title" ref={headingRef} tabIndex={-1}>Reclamo Registrado</h2>
    </div>
    <p role="status" className="lb-result-status">{mailSent ? 'Constancia enviada a tu correo.' : 'El registro se guardó, pero la constancia por correo no pudo enviarse. Conserva este código y contacta con el equipo; no necesitas registrar otro reclamo.'}</p>
    <p>Tu reclamo ha sido recibido correctamente. Te responderemos en un plazo máximo de <strong>15 días hábiles</strong>.</p>

    {numero && <div className="lb-code">
      <span className="lb-code-label">Número de Reclamo</span>
      <strong className="lb-code-value">{numero}</strong>
    </div>}

    <dl className="lb-summary-list">
      <div><dt>Nombre</dt><dd>{constancia.nombre}</dd></div>
      <div><dt>Tipo</dt><dd>{constancia.tipo}</dd></div>
      <div><dt>Área</dt><dd>{constancia.area}</dd></div>
      <div><dt>Fecha del incidente</dt><dd>{constancia.fecha}</dd></div>
      <div className="is-full"><dt>Bien / Servicio</dt><dd>{constancia.bien}</dd></div>
      <div className="is-full"><dt>Detalle</dt><dd>{constancia.detalle}</dd></div>
    </dl>

    <div className="lb-result-actions lb-no-print">
      {numero && <button type="button" className="home-button" onClick={handleCopy}><i className="fas fa-copy" aria-hidden="true" /> Copiar código</button>}
      <button type="button" className="home-button" onClick={() => window.print()}><i className="fas fa-print" aria-hidden="true" /> Imprimir constancia</button>
      <Link to="/" className="home-button home-button-light"><i className="fas fa-home" aria-hidden="true" /> Volver al Inicio</Link>
    </div>
    <p className="lb-copy-status lb-no-print" role="status">{copy === 'ok' ? 'Código copiado' : copy === 'fail' ? 'No se pudo copiar. Selecciona el código manualmente.' : ''}</p>
  </section>
}
