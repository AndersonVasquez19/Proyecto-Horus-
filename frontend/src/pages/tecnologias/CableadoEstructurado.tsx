import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import cableadoImage from '../../assets/images/tecnologias/cableado.jpg'
import { cableCategories } from '../../institutional/cableCategories'
import styles from './CableadoEstructurado.module.css'

export default function CableadoEstructurado() {
  useEffect(() => { document.title = 'Cableado Estructurado — Horus Group SRL' }, [])

  return <div className={styles.page}>
    <section className={styles.hero} aria-labelledby="cableado-title">
      <div className={styles.container}>
        <nav className={styles.breadcrumb} aria-label="Ruta de navegación">
          <Link to="/">Inicio</Link><i className="fas fa-chevron-right" aria-hidden="true" />
          <span>Tecnologías</span><i className="fas fa-chevron-right" aria-hidden="true" />
          <span aria-current="page">Cableado estructurado</span>
        </nav>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>Infraestructura & conectividad</p>
            <h1 id="cableado-title" className={styles.title}>Cableado <span>estructurado.</span></h1>
            <p className={styles.intro}>
              Diseñamos e implementamos sistemas de cableado estructurado (UTP/STP) y redes LAN.
              Conectamos las áreas de tu empresa con una infraestructura organizada, eficiente y preparada para crecer.
            </p>
            <div className={styles.actions}>
              <Link to="/contactos?asunto=Cableado%20estructurado" className={styles.primary}>
                Solicitar cotización <i className="fas fa-arrow-right" aria-hidden="true" />
              </Link>
              <a href="#categorias" className={styles.secondary}>Explorar categorías <i className="fas fa-arrow-down" aria-hidden="true" /></a>
            </div>
          </div>
          <figure className={styles.visual}>
            <div className={styles.heroImage}>
              <img src={cableadoImage} alt="Instalación de cableado de red en un rack de comunicaciones" width="1200" height="798" fetchPriority="high" />
            </div>
            <span className={styles.photoLabel}><i className="fas fa-network-wired" aria-hidden="true" /> CONECTIVIDAD EMPRESARIAL</span>
            <figcaption>
              <span className={styles.captionIcon}><i className="fas fa-network-wired" aria-hidden="true" /></span>
              <div><small>La base de tu conexión</small><strong>Una red que crece contigo.</strong></div>
            </figcaption>
          </figure>
        </div>
        <ul className={styles.benefits} aria-label="Nuestro enfoque">
          <li><i className="fas fa-diagram-project" aria-hidden="true" /><div><strong>Diseño a tu medida</strong><span>Según las necesidades de tu empresa</span></div></li>
          <li><i className="fas fa-network-wired" aria-hidden="true" /><div><strong>Instalación organizada</strong><span>Orden y conectividad en cada punto</span></div></li>
          <li><i className="fas fa-arrow-trend-up" aria-hidden="true" /><div><strong>Preparada para crecer</strong><span>Infraestructura que acompaña tu negocio</span></div></li>
        </ul>
      </div>
    </section>

    <section className={styles.categories} id="categorias" aria-labelledby="categorias-title">
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <div><p className={styles.eyebrow}>Conoce tu red</p><h2 id="categorias-title">Categorías de cableado</h2></div>
          <p>De la telefonía a las redes de alto rendimiento. Conoce cómo ha evolucionado el cableado y qué distingue a cada categoría.</p>
        </div>
        <div className={styles.grid}>
          {cableCategories.map(category => <article className={styles.card} key={category.number}>
            <div className={styles.cardMedia}>
              <img src={category.image} alt="" width="600" height="324" loading="lazy" decoding="async" />
              <span className={styles.cardBadge}>CAT. {Number(category.number)}</span>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.cardHeading}>
                <h3>Categoría {Number(category.number)}</h3><span className={styles.cardNumber} aria-hidden="true">{category.number}</span>
              </div>
              <p className={styles.application}>{category.application}</p>
              <p className={styles.description}>{category.description}</p>
              <div className={styles.spec}>
                <i className={'fas ' + category.icon} aria-hidden="true" /><strong>{category.spec}</strong>
                {category.legacy && <span className={styles.legacy}>Uso histórico</span>}
              </div>
            </div>
          </article>)}
        </div>
        <p className={styles.note}>
          <i className="fas fa-circle-info" aria-hidden="true" />
          <span>*Cat 6 puede alcanzar 10 Gbit/s en tramos de hasta 55 m, según las condiciones del enlace.
            {' '}<a href="https://www.flukenetworks.com/blog/cabling-chronicles/ethernet-cable-history" target="_blank" rel="noreferrer">Referencia técnica de Fluke Networks</a>.
          </span>
        </p>
        <aside className={styles.help} aria-labelledby="cableado-help">
          <div><h3 id="cableado-help">¿Qué cableado necesita tu empresa?</h3><p>Cuéntanos sobre tu espacio y tus equipos. Te orientamos para elegir una solución.</p></div>
          <Link to="/contactos?asunto=Asesor%C3%ADa%20en%20cableado%20estructurado" className={styles.primary}>Conversemos <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
        </aside>
      </div>
    </section>
  </div>
}
