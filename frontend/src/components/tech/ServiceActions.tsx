import { Link } from 'react-router-dom'
import type { ServicioPublico } from '../../types/public'
import { displayTitle } from './text'

export default function ServiceActions({ item }: { item: ServicioPublico }) {
  const name = displayTitle(item.titulo)
  return <div className="tech-actions">
    <Link className="home-button tech-btn" aria-label={'Solicitar información sobre ' + name}
      to={'/contactos?asunto=' + encodeURIComponent('Consulta sobre ' + item.titulo)}>
      Solicitar información <i className="fas fa-arrow-right" aria-hidden="true" />
    </Link>
    <Link className="tech-link" aria-label={'Ver alcance de ' + name} to={'/tecnologias/servicios/' + item.id}>
      Ver alcance <i className="fas fa-chevron-right" aria-hidden="true" />
    </Link>
  </div>
}
