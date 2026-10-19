import type { ServicioPublico } from '../../types/public'
import { contentIcon } from '../presentation'
import ServiceActions from './ServiceActions'
import ServiceFeatures from './ServiceFeatures'
import ServiceMedia from './ServiceMedia'
import ServiceStat from './ServiceStat'
import { displayTitle } from './text'

// One consistent card per service: the record's image, order, icon, title, description, features and actions.
export default function SupportCards({ items }: { items: ServicioPublico[] }) {
  return <div className="sop-grid">
    {items.map((item, index) => <article key={item.id} className="sop-card fade-up">
      <div className="sop-card-media tech-media">
        <ServiceMedia src={item.imagen_url} title={displayTitle(item.titulo)} priority={index === 0} />
        <span className="sop-card-num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <span className="tech-icon sop-card-icon" aria-hidden="true"><i className={'fas ' + contentIcon(item.icono)} /></span>
        {item.destacado && <span className="tech-badge sop-card-badge">{displayTitle(item.destacado)}</span>}
      </div>
      <div className="sop-card-body">
        <h3>{displayTitle(item.titulo)}</h3>
        <p className="tech-desc">{item.descripcion}</p>
        <ServiceStat item={item} />
        <ServiceFeatures value={item.etiquetas} label={'Características de ' + displayTitle(item.titulo)} />
        <ServiceActions item={item} />
      </div>
    </article>)}
  </div>
}
