import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import CourseCatalog, { type CatalogCopy } from '../../components/edu/CourseCatalog'
import { MODALIDAD_LABEL, type Modalidad } from '../../components/edu/courseText'
import coursePhoto from '../../assets/images/capacitaciones/capacitaciones.jpg'
import styles from './Cursos.module.css'

const modalities: { key: Modalidad; icon: string; format: string; description: string; features: string[] }[] = [
  {
    key: 'presencial', icon: 'fa-chalkboard-user', format: 'En el aula',
    description: 'Aprende en un entorno compartido, con sesiones teóricas y prácticas e interacción directa con el docente y tus compañeros.',
    features: ['Interacción cara a cara', 'Aprendizaje práctico', 'Experiencia en grupo'],
  },
  {
    key: 'hibrida', icon: 'fa-laptop-house', format: 'Presencial + online',
    description: 'Combina encuentros presenciales con actividades online. Una modalidad que conecta la experiencia en el aula con el aprendizaje digital.',
    features: ['Dos entornos de aprendizaje', 'Encuentros presenciales', 'Actividades online'],
  },
  {
    key: 'virtual', icon: 'fa-laptop', format: 'En línea',
    description: 'Continúa tu formación desde donde estés. Consulta en cada curso el formato de las sesiones, los materiales y los horarios.',
    features: ['Acceso a distancia', 'Entorno de aprendizaje digital', 'Sin desplazamientos al aula'],
  },
]

const copy: CatalogCopy = {
  eyebrow: 'Oferta educativa', title: 'Cursos disponibles',
  intro: 'Filtra por modalidad, revisa el detalle de cada curso y consulta el que te interesa.',
  plural: 'cursos',
  emptyTitle: 'Estamos preparando nuevos cursos',
  emptyText: 'Por ahora no hay cursos publicados. Escríbenos para consultar los próximos cursos o deja tu correo y te avisaremos cuando haya novedades.',
  consultLabel: 'Consultar próximos cursos', consultSubject: 'Consulta sobre próximos cursos',
  notify: true,
}

export default function Cursos() {
  useEffect(() => { document.title = 'Cursos — Horus Group SRL' }, [])
  return <div className={styles.page}>
    <section className={styles.hero} aria-labelledby="courses-title">
      <div className={styles.container}>
        <nav className={styles.breadcrumb} aria-label="Ruta de navegación">
          <Link to="/">Inicio</Link><i className="fas fa-chevron-right" aria-hidden="true" />
          <span>Educación</span><i className="fas fa-chevron-right" aria-hidden="true" />
          <span aria-current="page">Cursos</span>
        </nav>
        <div className={styles.heroGrid}>
          <div>
            <span className={'horus-hero-eyebrow ' + styles.eyebrow}>Educación</span>
            <h1 id="courses-title">Cursos</h1>
            <p className={styles.lead}>Sigue aprendiendo.<br /><span>Abre nuevas posibilidades.</span></p>
            <p className={styles.description}>Fortalece tus conocimientos y da el siguiente paso en tu desarrollo personal y profesional. Conoce las modalidades y consulta las próximas propuestas de Horus Group.</p>
            <div className={styles.actions}>
              <a href="#catalogo" className="home-button">Explorar cursos <i className="fas fa-arrow-right" aria-hidden="true" /></a>
              <a href="#modalidades" className={styles.explore}>Ver modalidades <i className="fas fa-arrow-down" aria-hidden="true" /></a>
            </div>
          </div>
          <figure className={styles.photo}>
            <img src={coursePhoto} alt="Docente compartiendo una sesión de aprendizaje con un grupo de participantes" width="612" height="408" fetchPriority="high" />
            <figcaption><i className="fas fa-book-open" aria-hidden="true" /><span><strong>Aprender para seguir creciendo</strong><span>Formación para tu desarrollo profesional.</span></span></figcaption>
          </figure>
        </div>
        <div className={styles.heroFooter}>
          <span><i className="fas fa-graduation-cap" aria-hidden="true" /> Tu siguiente paso empieza aquí</span>
          <p>Conoce el formato, la duración y la certificación de cada programa.</p>
        </div>
      </div>
    </section>
    <section className={styles.modalities} id="modalidades" aria-labelledby="modalities-title">
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <div><span className={styles.sectionLabel}>Modalidades de aprendizaje</span><h2 id="modalities-title">Distintas formas de aprender.{' '}<br />Un mismo impulso para avanzar.</h2></div>
          <p>Conoce cada modalidad y encuentra la que mejor encaja contigo. La disponibilidad y los horarios se indican en cada curso.</p>
        </div>
        <div className={styles.modalityGrid}>
          {modalities.map((modality, index) => <article key={modality.key} className={styles.modalityCard + (modality.key === 'hibrida' ? ' ' + styles.hybrid : '')}>
            <div className={styles.cardTop}><span className={styles.icon}><i className={'fas ' + modality.icon} aria-hidden="true" /></span><span className={styles.number} aria-hidden="true">0{index + 1}</span></div>
            <span className={styles.format}>{modality.format}</span>
            <h3>{MODALIDAD_LABEL[modality.key]}</h3>
            <p>{modality.description}</p>
            <ul>{modality.features.map(feature => <li key={feature}><i className="fas fa-check" aria-hidden="true" />{feature}</li>)}</ul>
            <Link className={styles.consult} to={'/contactos?asunto=' + encodeURIComponent('Consulta sobre cursos en modalidad ' + MODALIDAD_LABEL[modality.key])} aria-label={'Consultar modalidad ' + MODALIDAD_LABEL[modality.key]}>Consultar modalidad <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
          </article>)}
        </div>
      </div>
    </section>
    <CourseCatalog tipo="curso" copy={copy} />
  </div>
}
