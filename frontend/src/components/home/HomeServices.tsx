import { Link } from 'react-router-dom'
import { imgCableado, imgCapacitaciones } from './homeContent'

export default function HomeServices() {
  return (
    <section className="home-services" id="ix-services">
      <div className="container">
        <div className="home-section-head fade-up">
          <span className="home-eyebrow">Nuestros Servicios</span>
          <h2>Todo lo que necesitas en un solo lugar</h2>
          <p>Tecnología e infraestructura para empresas, y formación profesional certificada para personas.</p>
        </div>
        <div className="home-services-grid">
          <div className="home-svc-card fade-up">
            <div className="home-svc-img">
              <img src={imgCableado} alt="Tecnologías" loading="lazy" decoding="async" />
              <div className="home-svc-badge"><i aria-hidden="true" className="fas fa-microchip" /> Tecnologías</div>
            </div>
            <div className="home-svc-body">
              <div className="home-svc-icon">
                <i aria-hidden="true" className="fas fa-network-wired" />
              </div>
              <h3>Soluciones Tecnológicas</h3>
              <p>Redes, cámaras de seguridad y soporte técnico especializado para empresas e instituciones de Cajamarca.</p>
              <div className="home-svc-links">
                <Link to="/tecnologias/cableado-estructurado"><i aria-hidden="true" className="fas fa-chevron-right" /> Cableado Estructurado</Link>
                <Link to="/tecnologias/camaras-seguridad"><i aria-hidden="true" className="fas fa-chevron-right" /> Cámaras de Seguridad</Link>
                <Link to="/tecnologias/soporte-mantenimiento"><i aria-hidden="true" className="fas fa-chevron-right" /> Soporte Técnico</Link>
              </div>
            </div>
          </div>

          <div className="home-svc-card fade-up">
            <div className="home-svc-img">
              <img src={imgCapacitaciones} alt="Educación" loading="lazy" decoding="async" />
              <div className="home-svc-badge home-svc-badge-coral"><i aria-hidden="true" className="fas fa-graduation-cap" /> Educación</div>
            </div>
            <div className="home-svc-body">
              <div className="home-svc-icon">
                <i aria-hidden="true" className="fas fa-chalkboard-teacher" />
              </div>
              <h3>Formación Profesional</h3>
              <p>Capacitaciones, cursos y asesoramiento con certificación oficial de colegios profesionales reconocidos.</p>
              <div className="home-svc-links">
                <Link to="/educacion/asesoramiento"><i aria-hidden="true" className="fas fa-chevron-right" /> Asesoramiento</Link>
                <Link to="/educacion/capacitaciones"><i aria-hidden="true" className="fas fa-chevron-right" /> Capacitaciones</Link>
                <Link to="/educacion/cursos"><i aria-hidden="true" className="fas fa-chevron-right" /> Cursos</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

  )
}
