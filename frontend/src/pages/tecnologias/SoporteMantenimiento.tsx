import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../../components/PageHero'
import SectionHead from '../../components/SectionHead'
import ServiceList from '../../components/tech/ServiceList'
import SupportCards from '../../components/tech/SupportCards'

export default function SoporteMantenimiento() {
  useEffect(() => { document.title = 'Soporte y Mantenimiento — Horus Group SRL' }, [])

  return <>
    <PageHero eyebrow="Soporte tecnológico" title="Soporte y Mantenimiento" actions={<>
      <Link to="/contactos?asunto=Soporte%20y%20mantenimiento" className="home-button"><i className="fas fa-headset" aria-hidden="true" /> Soporte ahora</Link>
      <a href="#servicios" className="home-button home-button-outline"><i className="fas fa-tools" aria-hidden="true" /> Ver servicios</a>
    </>}>
      Respuesta rápida, solución definitiva. Nuestro equipo técnico está disponible para resolver cualquier problema de hardware, software o redes en tu empresa.
    </PageHero>
    <section className="tech-section is-light" id="servicios" aria-labelledby="sop-title">
      <div className="container">
        <SectionHead id="sop-title" eyebrow="Nuestros Servicios" title="Todo lo que tu empresa necesita para funcionar">
          Cubrimos cada aspecto del soporte tecnológico para que tu negocio nunca se detenga.
        </SectionHead>
        <ServiceList category="soporte">{items => <SupportCards items={items} />}</ServiceList>
      </div>
    </section>
  </>
}
