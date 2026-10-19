import { useCompanySetting } from '../context/companySettings'
import { Link } from 'react-router-dom'
import logoHorus from '../assets/images/logo-horus.png'
import useSocialLinks from '../hooks/useSocialLinks'

export default function Footer() {
  const setting = useCompanySetting()
  const social = useSocialLinks()
  const reveal = ' fade-up'
  return (
    <footer className="footer">
      <div className="container">
        <div className="ix-footer-top">

          <div className={'ix-footer-brand' + reveal}>
            <img src={logoHorus} alt="Horus Group" />
            <div className="ix-footer-name">{setting('empresa_nombre', 'Horus Group SRL')}</div>
            <div className="ix-footer-ruc">RUC: {setting('ruc', '20611010977')}</div>
            <p>Tecnología y formación profesional de calidad en Cajamarca, Perú.</p>
          </div>

          <div className={'ix-footer-col' + reveal}>
            <h5 className="ix-footer-heading">Políticas</h5>
            <ul className="ix-footer-list">
              <li><Link to="/politicas/cookies">Políticas de Cookies</Link></li>
              <li><Link to="/politicas/devolucion">Políticas de Devolución</Link></li>
              <li><Link to="/politicas/privacidad">Políticas de Privacidad</Link></li>
              <li><Link to="/preguntas-frecuentes">Preguntas Frecuentes</Link></li>
            </ul>
          </div>

          <div className={'ix-footer-col' + reveal}>
            <h5 className="ix-footer-heading">Contacto</h5>
            <ul className="footer-contact">
              <li><i className="fas fa-phone" />{setting('telefono_principal', '+51 927 582 305')}</li>
              <li><i className="fas fa-envelope" />{setting('email_contacto', 'horusgroupcajamarca@gmail.com')}</li>
              <li><i className="fas fa-map-marker-alt" />{setting('direccion', 'Cajamarca - Peru')}</li>
            </ul>
          </div>

          <div className={'ix-footer-col' + reveal}>
            <h5 className="ix-footer-heading">Síguenos</h5>
            <div className="ix-footer-social">
              {social.facebook && <a href={social.facebook} target="_blank" rel="noreferrer" className="ix-social-item">
                <span className="ix-social-icon ix-social-fb"><i className="fab fa-facebook-f" /></span>
                <span>Facebook</span>
              </a>}
              <a href={social.whatsapp} target="_blank" rel="noreferrer" className="ix-social-item">
                <span className="ix-social-icon ix-social-wa"><i className="fab fa-whatsapp" /></span>
                <span>WhatsApp</span>
              </a>
              {social.instagram && <a href={social.instagram} target="_blank" rel="noreferrer" className="ix-social-item">
                <span className="ix-social-icon ix-social-ig"><i className="fab fa-instagram" /></span>
                <span>Instagram</span>
              </a>}
            </div>
          </div>

        </div>

        <div className={'footer-bottom' + reveal}>
          <p>&copy; {new Date().getFullYear()} Horus Group SRL. Todos los derechos reservados.</p>
          <Link to="/libro-reclamaciones" className="footer-libro-link">
            <span className="footer-libro-icon" aria-hidden="true"><i className="fas fa-book" /></span>
            <span className="footer-libro-text">
              <strong>Libro de Reclamaciones</strong>
              <small>Ley N° 29571 – INDECOPI</small>
            </span>
          </Link>
        </div>
      </div>
    </footer>
  )
}
