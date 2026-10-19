import { useEffect, useReducer } from 'react'
import { useCompanySetting } from '../context/companySettings'
import { INITIAL_MAP_STATE, locationMapReducer } from '../locationMapState'
import { MAP_EMBED_URL } from '../siteLinks'
import '../styles/location-map.css'

// Ubicación del negocio (URL única en siteLinks.ts). Siempre muestra primero una tarjeta local con la dirección institucional
// guardada en el panel; el iframe de Google Maps no existe (ni genera peticiones externas) hasta que se pulsa «Mostrar mapa».
// Si el navegador se desconecta con el mapa abierto, se retira el iframe y vuelve la tarjeta. El resto de la página no depende del mapa.
export default function LocationMap({ title = 'Ubicación de Horus Group SRL' }: { title?: string }) {
  const setting = useCompanySetting()
  const address = setting('direccion', 'Cajamarca - Peru')
  const [state, dispatch] = useReducer(locationMapReducer, INITIAL_MAP_STATE)

  useEffect(() => {
    const goOffline = () => dispatch({ type: 'offline' })
    const goOnline = () => dispatch({ type: 'online' })
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (state.view === 'map') {
    return (
      <div className="location-map-view">
        <iframe src={MAP_EMBED_URL} title={title} allowFullScreen referrerPolicy="no-referrer-when-downgrade" />
        <div className="location-map-view-bar">
          <span className="location-map-view-address"><i className="fas fa-location-dot" aria-hidden="true" /> {address}</span>
          <button type="button" className="location-map-action" onClick={() => dispatch({ type: 'hide' })}>
            Ocultar mapa
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="location-map-fallback" role="group" aria-label={title}>
      <span className="location-map-fallback-icon" aria-hidden="true"><i className="fas fa-location-dot" /></span>
      <h3>Horus Group SRL</h3>
      <p className="location-map-fallback-address">{address}</p>
      <button type="button" className="location-map-action" onClick={() => dispatch({ type: 'show', online: navigator.onLine !== false })}>
        <i className="fas fa-map" aria-hidden="true" /> Mostrar mapa — requiere Internet
      </button>
      <p className="location-map-fallback-note" role="status">
        {state.notice === 'offline' ? 'Sin conexión a Internet: el mapa no está disponible ahora. La dirección sigue arriba.' : ''}
      </p>
    </div>
  )
}
