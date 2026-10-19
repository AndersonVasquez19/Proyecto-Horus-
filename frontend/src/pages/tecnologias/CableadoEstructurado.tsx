import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../../components/PageHero'
import SectionHead from '../../components/SectionHead'
import CableTabs from '../../components/tech/CableTabs'
import ServiceList from '../../components/tech/ServiceList'

export default function CableadoEstructurado() {
  useEffect(() => { document.title = 'Cableado Estructurado — Horus Group SRL' }, [])

  return <>
    <PageHero eyebrow="Tecnología" title="Cableado Estructurado" actions={<>
      <Link to="/contactos?asunto=Cableado%20estructurado" className="home-button"><i className="fas fa-phone" aria-hidden="true" /> Solicitar cotización</Link>
      <a href="#categorias" className="home-button home-button-outline"><i className="fas fa-layer-group" aria-hidden="true" /> Ver categorías</a>
    </>}>
      Infraestructura de red certificada que garantiza velocidad, estabilidad y escalabilidad para tu negocio. Instalamos la columna vertebral digital que tu empresa necesita.
    </PageHero>
    <section className="tech-section is-dark" id="categorias" aria-labelledby="cable-title">
      <div className="container">
        <SectionHead id="cable-title" dark eyebrow="Nuestras Categorías" title="Soluciones para cada necesidad">
          Desde instalaciones básicas hasta infraestructura de alto rendimiento para centros de datos.
        </SectionHead>
        <ServiceList category="cableado">{items => <CableTabs items={items} />}</ServiceList>
      </div>
    </section>
  </>
}
