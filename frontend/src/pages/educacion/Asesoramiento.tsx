import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import AdviceSections from '../../components/edu/AdviceSections'
import advicePhoto from '../../assets/images/asesoramiento/asesoramiento2.jpg'
import styles from './Asesoramiento.module.css'

export default function Asesoramiento() {
  useEffect(() => { document.title = 'Asesoramiento Profesional — Horus Group SRL' }, [])
  return <div className={styles.page}>
    <section className={styles.hero} aria-labelledby="advice-title">
      <div className={styles.container}>
        <nav className={styles.breadcrumb} aria-label="Ruta de navegación">
          <Link to="/">Inicio</Link><i className="fas fa-chevron-right" aria-hidden="true" />
          <span>Educación</span><i className="fas fa-chevron-right" aria-hidden="true" />
          <span aria-current="page">Asesoramiento</span>
        </nav>
        <div className={styles.heroGrid}>
          <div>
            <span className={styles.eyebrow}>Educativo · Empresarial · Legal</span>
            <h1 id="advice-title">Asesoramiento</h1>
            <p className={styles.lead}>El respaldo que necesitas<br />para dar el siguiente paso.</p>
            <p className={styles.description}>Acompañamiento profesional para tu proyecto, empresa o trayectoria. Encuentra la orientación que necesitas y construye tu próximo paso con nuestro equipo.</p>
            <div className={styles.actions}>
              <Link to="/contactos?asunto=Asesoramiento" className="home-button">Consultar con el equipo <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
              <a href="#asesoramiento" className={styles.explore}>Explorar áreas <i className="fas fa-arrow-down" aria-hidden="true" /></a>
            </div>
          </div>
          <figure className={styles.photo}>
            <img src={advicePhoto} alt="Profesional orientando a un grupo en una sesión de formación" width="800" height="365" fetchPriority="high" />
            <figcaption><span className={styles.photoIcon}><i className="fas fa-user-graduate" aria-hidden="true" /></span><span><strong>Tu proyecto, bien acompañado.</strong><span>Experiencia y orientación profesional.</span></span></figcaption>
          </figure>
        </div>
        <ul className={styles.highlights} aria-label="Nuestro enfoque">
          <li><i className="fas fa-award" aria-hidden="true" /><span>Orientación <strong>especializada</strong></span></li>
          <li><i className="fas fa-handshake" aria-hidden="true" /><span>Atención <strong>personalizada</strong></span></li>
          <li><i className="fas fa-compass" aria-hidden="true" /><span>Enfoque en <strong>tu proyecto</strong></span></li>
        </ul>
      </div>
    </section>
    <AdviceSections />
    <section className={styles.contact} aria-labelledby="advice-contact-title">
      <div className={styles.container}>
        <div className={styles.contactBox}>
          <div>
            <span className={styles.eyebrow}>Conversemos sobre tu proyecto</span>
            <h2 id="advice-contact-title">Las buenas decisiones empiezan<br />con una buena orientación.</h2>
            <p>Cuéntanos qué necesitas y consulta con nuestro equipo cómo podemos acompañarte.</p>
          </div>
          <Link to="/contactos?asunto=Asesoramiento" className="home-button">Hablemos de tu proyecto <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  </div>
}
