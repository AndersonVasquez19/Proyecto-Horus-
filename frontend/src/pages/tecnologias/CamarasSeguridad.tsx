import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../../components/PageHero'
import SectionHead from '../../components/SectionHead'
import CameraCards from '../../components/tech/CameraCards'
import ServiceList from '../../components/tech/ServiceList'

export default function CamarasSeguridad() {
  useEffect(() => { document.title = 'Cámaras de Seguridad — Horus Group SRL' }, [])

  return <>
    <PageHero eyebrow="Seguridad" title="Cámaras de Seguridad" actions={<>
      <Link to="/contactos?asunto=C%C3%A1maras%20de%20seguridad" className="home-button"><i className="fas fa-shield-alt" aria-hidden="true" /> Proteger mi negocio</Link>
      <a href="#soluciones" className="home-button home-button-outline"><i className="fas fa-eye" aria-hidden="true" /> Ver soluciones</a>
    </>}>
      Sistemas de seguridad inteligentes que protegen lo que más importa. Monitoreo continuo, alertas en tiempo real y evidencia cuando la necesitas.
    </PageHero>
    <section className="tech-section is-dark" id="soluciones" aria-labelledby="cam-title">
      <div className="container">
        <SectionHead id="cam-title" dark eyebrow="Lo que incluye" title="Seguridad completa, de principio a fin">
          Cada solución está diseñada para proteger lo que más importa.
        </SectionHead>
        <ServiceList category="camaras">{items => <CameraCards items={items} />}</ServiceList>
      </div>
    </section>
  </>
}
