import { useState } from 'react'
import logoHorus from '../../assets/images/logo-horus.png'

// The record's own image always wins. The generic Horus placeholder only appears when there is none or it fails to load.
export default function ServiceMedia({ src, title, priority = false }: { src: string | null; title: string; priority?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <div className="tech-media-fallback" role="img" aria-label="Imagen no disponible">
    <img src={logoHorus} alt="" aria-hidden="true" />
  </div>
  return <img src={src} alt={title} decoding="async" loading={priority ? 'eager' : 'lazy'} onError={() => setFailed(src)} />
}
