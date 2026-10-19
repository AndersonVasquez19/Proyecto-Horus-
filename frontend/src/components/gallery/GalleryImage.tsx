import { useState } from 'react'

// Imagen de la galería: carga diferida, decodificación asíncrona y un marcador estable si el archivo falla.
// `quiet` (imágenes decorativas) hace que el marcador no muestre texto ni se anuncie.
export default function GalleryImage({ src, alt = '', className, quiet = false }: { src: string | null; alt?: string; className?: string; quiet?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) {
    return <span className={'gl-img-missing' + (quiet ? ' is-quiet' : '')} role={alt ? 'img' : undefined} aria-label={alt ? alt + ' (imagen no disponible)' : undefined} aria-hidden={quiet || undefined}>
      <i className="fas fa-image" aria-hidden="true" />
      {!quiet && <span>Imagen no disponible</span>}
    </span>
  }
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(src)} />
}
