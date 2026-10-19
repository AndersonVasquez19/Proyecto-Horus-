import { useState } from 'react'
export default function PublicImage({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  return src && failed !== src ? <img src={src} alt={title} loading="lazy" onError={() => setFailed(src)} /> : <span>Sin imagen disponible</span>
}
