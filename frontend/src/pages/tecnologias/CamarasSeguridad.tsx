import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import SectionHead from '../../components/SectionHead'
import CameraCards from '../../components/tech/CameraCards'
import ServiceList from '../../components/tech/ServiceList'
import styles from './CamarasSeguridad.module.css'

export default function CamarasSeguridad() {
  useEffect(() => { document.title = 'Cámaras de Seguridad — Horus Group SRL' }, [])

  return <>
    <section className={styles.hero} aria-labelledby="camaras-title">
      <div className={styles.container}>
        <nav className={styles.breadcrumb} aria-label="Ruta de navegación">
          <Link to="/">Inicio</Link><i className="fas fa-chevron-right" aria-hidden="true" />
          <span>Tecnologías</span><i className="fas fa-chevron-right" aria-hidden="true" />
          <span aria-current="page">Cámaras de seguridad</span>
        </nav>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>Seguridad & videovigilancia</p>
            <h1 id="camaras-title">Cámaras de <span>seguridad.</span></h1>
            <p className={styles.description}>Desarrollamos proyectos de videovigilancia para proteger tu hogar, empresa o institución. Encuentra una solución para mantener tus espacios a la vista, estés donde estés.</p>
            <div className={styles.actions}>
              <Link to="/contactos?asunto=C%C3%A1maras%20de%20seguridad" className="home-button">Consultar mi proyecto <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
              <a href="#soluciones" className={styles.explore}>Ver soluciones <i className="fas fa-arrow-down" aria-hidden="true" /></a>
            </div>
          </div>
          <figure className={styles.photo}>
            <span className={styles.photoLabel}>VIDEOVIGILANCIA</span>
            <img src="/contenido/e1111f92-b6d6-455b-92ad-8a8dea3eb591.png" alt="Cámara de seguridad real tipo bala con soporte de montaje" width="600" height="600" fetchPriority="high" />
            <figcaption><i className="fas fa-shield-halved" aria-hidden="true" /><span>Protección para tus espacios</span></figcaption>
          </figure>
        </div>
      </div>
    </section>
    <section className="tech-section is-light" id="soluciones" aria-labelledby="cam-title">
      <div className="container">
        <SectionHead id="cam-title" eyebrow="Nuestras soluciones" title="Seguridad completa, de principio a fin">
          Cada solución está diseñada para proteger lo que más importa.
        </SectionHead>
        <ServiceList category="camaras">{items => <CameraCards items={items} />}</ServiceList>
      </div>
    </section>
  </>
}
