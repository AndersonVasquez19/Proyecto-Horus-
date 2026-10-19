import { Link } from 'react-router-dom'
import { useCompanySetting } from '../../context/companySettings'
import LocationMap from '../LocationMap'

export default function HomeLocation() {
  const setting = useCompanySetting()
  return (
    <section className="home-location">
      <div className="container">
        <div className="home-location-grid">
          <div className="home-location-info">
            <span className="home-eyebrow fade-up">Dónde estamos</span>
            <h2 className="fade-up">Visítanos en Cajamarca</h2>
            <p className="fade-up">Estamos en el corazón de Cajamarca, listos para atenderte.</p>
            <div className="home-loc-items">
              <div className="home-loc-item fade-up">
                <div className="home-loc-icon"><i aria-hidden="true" className="fas fa-map-marker-alt" /></div>
                <div><strong>Dirección</strong><span>{setting('direccion', 'Cajamarca - Peru')}</span></div>
              </div>
              <div className="home-loc-item fade-up">
                <div className="home-loc-icon"><i aria-hidden="true" className="fas fa-clock" /></div>
                <div><strong>Horario</strong><span>{setting('horario_atencion', 'Horario por confirmar')}</span></div>
              </div>
              <div className="home-loc-item fade-up">
                <div className="home-loc-icon"><i aria-hidden="true" className="fas fa-phone" /></div>
                <div><strong>Teléfono</strong><span>{setting('telefono_principal', '+51 927 582 305')}</span></div>
              </div>
            </div>
            <Link to="/contactos" className="home-button">
              <i aria-hidden="true" className="fas fa-paper-plane" /> Contáctanos
            </Link>
          </div>
          <div className="home-location-map fade-up">
            <LocationMap title="Ubicación Horus Group" />
          </div>
        </div>
      </div>
    </section>
  )
}
