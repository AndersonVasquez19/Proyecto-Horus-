import { Link } from 'react-router-dom'
import PageHero from './PageHero'
import { RETRYABLE_ERRORS } from '../publicErrors'
import type { PublicErrorKind } from '../publicErrors'

// Detalle que no se pudo mostrar. Distingue un contenido inexistente (404: título específico, sin "Reintentar", aviso de estado)
// de un fallo pasajero (red, servidor, tiempo: alerta con "Reintentar"). Conserva Navbar y Footer; el título de la pestaña lo fija
// quien lo usa. El mensaje siempre es el de publicErrors.ts, nunca el texto técnico original.
export default function PublicFailure({ kind, message, reload, eyebrow, missingTitle, failedTitle, back }: {
  kind: PublicErrorKind | null; message: string; reload: () => void; eyebrow: string; missingTitle: string; failedTitle: string
  back: { to: string; label: string }
}) {
  const missing = kind === 'notFound'
  const retry = kind ? RETRYABLE_ERRORS.includes(kind) : true
  return <>
    <PageHero eyebrow={eyebrow} title={missing ? missingTitle : failedTitle} />
    <section className="tech-section is-light" aria-label="Estado del contenido">
      <div className="container">
        <div className="tech-state" role={missing ? 'status' : 'alert'}>
          <p>{message}</p>
          <div className="tech-actions">
            {retry && <button type="button" className="home-button tech-btn" onClick={reload}>Reintentar</button>}
            <Link className={retry ? 'tech-link' : 'home-button tech-btn'} to={back.to}><i className="fas fa-arrow-left" aria-hidden="true" /> {back.label}</Link>
          </div>
        </div>
      </div>
    </section>
  </>
}
