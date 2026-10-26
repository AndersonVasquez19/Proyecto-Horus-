import type { ServicioPublico } from '../../types/public'
import ServiceActions from './ServiceActions'
import ServiceFeatures from './ServiceFeatures'
import ServiceMedia from './ServiceMedia'
import ServiceStat from './ServiceStat'
import { displayTitle } from './text'

// Fotografías de los equipos del catálogo; las características completas se pueden desplegar.
export default function CameraCards({ items }: { items: ServicioPublico[] }) {
  return <div className="cam-list">
    {items.map((item, index) => <article key={item.id} className="cam-card fade-up">
      <div className="cam-card-media tech-media">
        <ServiceMedia src={item.imagen_url} title={displayTitle(item.titulo)} priority={index === 0} />
        <span className="cam-card-photo-label">{displayTitle(item.nombre_corto || item.titulo)}</span>
      </div>
      <div className="cam-card-body">
        <div className="cam-card-head">
          <span className="cam-card-num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          {item.destacado && <span className="tech-badge">{displayTitle(item.destacado)}</span>}
        </div>
        <h3>{displayTitle(item.titulo)}</h3>
        <p className="tech-desc">{item.descripcion}</p>
        <ServiceStat item={item} />
        {item.etiquetas?.trim() && <details className="cam-card-details">
          <summary>Ver características</summary>
          <ServiceFeatures value={item.etiquetas} label={'Características de ' + displayTitle(item.titulo)} />
        </details>}
        <ServiceActions item={item} />
      </div>
    </article>)}
  </div>
}
