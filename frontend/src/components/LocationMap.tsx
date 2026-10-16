import { useEffect, useState } from 'react'
import { useCompanySetting } from '../context/companySettings'
import { probeMapReachable } from '../mapAvailability'
import { MAP_EMBED_URL } from '../siteLinks'
import '../styles/location-map.css'

type MapState = 'map' | 'fallback' | 'retrying'

// Embedded map of the business location (single source: siteLinks.ts). The parent decides its size.
// Sin conexión (o si Google Maps no responde) muestra una tarjeta local con la dirección institucional guardada en el panel
// (la misma que el resto del sitio, mismo valor por defecto) en lugar de un iframe roto. El resto de la página no depende del mapa.
export default function LocationMap({ title = 'Ubicación de Horus Group SRL' }: { title?: string }) {
  const setting = useCompanySetting()
  const address = setting('direccion', 'Cajamarca - Peru')
  // Optimista: con red se pinta el mapa como siempre y se comprueba en segundo plano. Sin interfaz de red ni se intenta.
  const [state, setState] = useState<MapState>(() => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'fallback' : 'map'))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      if (navigator.onLine === false) { setState('fallback'); return }
      void probeMapReachable().then(ok => { if (!cancelled) setState(ok ? 'map' : 'fallback') })
    }
    const goOffline = () => setState('fallback')
    const timer = setTimeout(check, 0)
    window.addEventListener('online', check)
    window.addEventListener('offline', goOffline)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', goOffline)
    }
  }, [attempt])

  if (state === 'map') {
    return <iframe src={MAP_EMBED_URL} title={title} loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade" />
  }
  const retrying = state === 'retrying'
  return (
    <div className="location-map-fallback" role="group" aria-label={title}>
      <span className="location-map-fallback-icon" aria-hidden="true"><i className="fas fa-location-dot" /></span>
      <h3>Mapa no disponible sin conexión</h3>
      <p className="location-map-fallback-address">{address}</p>
      <p className="location-map-fallback-note" role="status">
        {retrying ? 'Comprobando la conexión…' : 'Mostramos la dirección registrada. El mapa aparecerá cuando haya conexión a Internet.'}
      </p>
      <button type="button" className="location-map-fallback-retry" disabled={retrying} onClick={() => { setState('retrying'); setAttempt(n => n + 1) }}>
        <i className="fas fa-rotate-right" aria-hidden="true" /> Reintentar
      </button>
    </div>
  )
}
