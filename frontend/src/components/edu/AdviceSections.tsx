import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePublicResource } from '../../hooks/usePublicResource'
import type { PublicList, ServicioPublico } from '../../types/public'
import SectionHead from '../SectionHead'
import { contentIcon } from '../presentation'
import ServiceFeatures from '../tech/ServiceFeatures'
import ServiceMedia from '../tech/ServiceMedia'
import { displayTitle } from '../tech/text'

const consultPath = (item: ServicioPublico) => '/contactos?asunto=' + encodeURIComponent('Consulta sobre: ' + displayTitle(item.titulo))

// Published advice lines (categoría asesoramiento). Records marked as "beneficio" are shown apart as reasons to choose Horus.
export default function AdviceSections() {
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = usePublicResource<PublicList<ServicioPublico>>(
    'servicios?' + new URLSearchParams({ page: String(page), limit: '12', categoria: 'asesoramiento' }))
  const items = data?.items ?? []
  const advice = items.filter(item => item.presentacion !== 'beneficio')
  const benefits = items.filter(item => item.presentacion === 'beneficio')
  const pages = data?.pagination.pages ?? 1

  let body
  if (error) body = <div className="tech-state" role="alert">
    <p>{error}</p><button type="button" className="home-button tech-btn" onClick={reload}>Reintentar</button>
  </div>
  else if (loading || !data) body = <div className="edu-skeleton" role="status">
    <span className="tech-sr">Cargando asesoramiento…</span>
    <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
  </div>
  else if (!advice.length) body = <div className="tech-state" role="status">
    <p>Por el momento no hay líneas de asesoramiento publicadas.</p>
    <Link className="home-button tech-btn" to="/contactos?asunto=Asesoramiento">Consultar con el equipo</Link>
  </div>
  else body = <>
    <div className="edu-grid">
      {advice.map((item, index) => {
        const name = displayTitle(item.titulo)
        return <article key={item.id} className="edu-card fade-up">
          <div className="edu-card-media tech-media">
            <ServiceMedia src={item.imagen_url} title={name} priority={index === 0} />
            <span className="tech-icon edu-card-icon" aria-hidden="true"><i className={'fas ' + contentIcon(item.icono)} /></span>
          </div>
          <div className="edu-card-body">
            <h3>{name}</h3>
            <p className="tech-desc edu-card-desc">{item.descripcion}</p>
            <ServiceFeatures value={item.alcance} label={'Alcance de ' + name} />
            <div className="tech-actions">
              <Link className="home-button tech-btn" to={consultPath(item)} aria-label={'Solicitar asesoramiento: ' + name}>
                Solicitar asesoramiento <i className="fas fa-arrow-right" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </article>
      })}
    </div>
    {pages > 1 && <nav className="tech-pagination" aria-label="Páginas de asesoramiento">
      <button type="button" className="home-button tech-btn" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
      <span>Página {page} de {pages}</span>
      <button type="button" className="home-button tech-btn" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Siguiente</button>
    </nav>}
  </>

  return <>
    <section className="tech-section is-light edu-section" id="asesoramiento" aria-labelledby="edu-advice-title" aria-busy={loading}>
      <div className="container">
        <SectionHead id="edu-advice-title" eyebrow="Tipos de asesoramiento" title="¿En qué área podemos ayudarte?">
          Elige la línea de asesoramiento que necesitas y solicita información al equipo.
        </SectionHead>
        {body}
      </div>
    </section>
    {!loading && !error && benefits.length > 0 && <section className="tech-section is-dark edu-section" aria-labelledby="edu-benefits-title">
      <div className="container">
        <SectionHead id="edu-benefits-title" eyebrow="Por qué elegirnos" title="Lo que nos hace diferentes" dark />
        <ol className="edu-benefits">
          {benefits.map((item, index) => <li key={item.id} className="edu-benefit fade-up">
            <span className="edu-benefit-num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span className="tech-icon" aria-hidden="true"><i className={'fas ' + contentIcon(item.icono)} /></span>
            <h3>{displayTitle(item.titulo)}</h3>
            <p>{item.descripcion}</p>
          </li>)}
        </ol>
      </div>
    </section>}
  </>
}
