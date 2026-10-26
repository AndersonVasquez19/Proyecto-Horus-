import { Fragment, useEffect, useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import useSocialLinks from '../hooks/useSocialLinks'

import photoMain     from '../assets/images/somos/marco 2.png'
import photoMarco    from '../assets/images/somos/marco 2.png'
import photoMilagros from '../assets/images/somos/milagros.jpeg'
import photoMonica   from '../assets/images/somos/monica.jpeg'
import photoAna      from '../assets/images/somos/Persona4.jpeg'
import photologo3 from '../assets/images/somos/logo 3.jpeg'
import stickerHorus  from '../assets/images/somos/sticker.png'
import artMision     from '../assets/images/somos/mision.png'
import artVision     from '../assets/images/somos/vision.png'
import artValores    from '../assets/images/somos/valores.jpg'

type Member = {
  img: string
  name: string
  role: string
  bio: string
  // Face position (0-1 of the circle) and zoom, only for photos whose original framing is too wide.
  frame?: { x: number; y: number; zoom: number }
}

const TITLE = '¿Quiénes Somos?'

const VALUES = ['Puntualidad', 'Calidad', 'Superación', 'Empatía', 'Confianza', 'Vocación', 'Trabajo en equipo']

// Keep words together and reserve the full title while CSS animates each letter.
function AnimatedTitle({ id, text }: { id: string; text: string }) {
  let letterIndex = 0
  return (
    <h1 id={id} className="ns-hero-title" aria-label={text}>
      <span aria-hidden="true">
        {text.split(' ').map((word, wordIndex) => (
          <Fragment key={wordIndex}>
            {wordIndex > 0 && ' '}
            <span className="ns-title-word">
              {[...word].map((letter, index) => (
                <span className="ns-title-letter" key={index}
                  style={{ '--letter-index': letterIndex++ } as CSSProperties}>{letter}</span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </h1>
  )
}

function TeamCard({ img, name, role, bio, frame, open, onToggle }: Member & { open: boolean; onToggle: () => void }) {
  const bioId = useId()
  const social = useSocialLinks()
  return (
    <article className={'ns-member fade-up' + (open ? ' is-open' : '')}>
      <div className={'ns-member-photo' + (frame ? ' has-frame' : '')}
        style={frame ? ({ '--fx': frame.x, '--fy': frame.y, '--zoom': frame.zoom } as CSSProperties) : undefined}>
        <img src={img} alt={'Retrato de ' + name} loading="lazy" />
      </div>
      <h3 className="ns-member-name">{name}</h3>
      <p className="ns-member-role">{role}</p>
      <div className="ns-member-socials">
        {social.facebook && <a href={social.facebook} target="_blank" rel="noreferrer" aria-label={'Facebook de Horus Group (' + name + ')'}>
          <i className="fab fa-facebook-f" aria-hidden="true" />
        </a>}
        {social.instagram && <a href={social.instagram} target="_blank" rel="noreferrer" aria-label={'Instagram de Horus Group (' + name + ')'}>
          <i className="fab fa-instagram" aria-hidden="true" />
        </a>}
      </div>
      <button type="button" className="ns-member-toggle" aria-expanded={open} aria-controls={bioId} onClick={onToggle}>
        {open ? 'Ocultar perfil' : 'Ver perfil'} <i className={'fas fa-chevron-' + (open ? 'up' : 'down')} aria-hidden="true" />
      </button>
      <div className="ns-member-bio" id={bioId} role="region" aria-label={'Perfil de ' + name} hidden={!open}>
        <p>{bio}</p>
      </div>
    </article>
  )
}

export default function QuienesSomos() {
  useEffect(() => { document.title = 'Quiénes somos — Horus Group SRL' }, [])
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const members: Member[] = [
    { img: photoMarco,    name: 'Marco Alvarez',     role: 'Gerente General',             frame: { x: .42, y: .49, zoom: 2.6 }, bio: 'Profesional de Economía de la Universidad Nacional de Cajamarca. Experiencia en manejo de personal, trabajo en equipo. Docente en institutos de educación superior en los cursos de sociedad y economía, proyectos de investigación, taller de competencias profesionales entre otros.' },
    { img: photoMonica,   name: 'Mónica Monzón',     role: 'Coordinadora Institucional',  bio: 'Profesional de Enfermería por la Universidad Nacional de Cajamarca. Maestra en Ciencias con mención en Salud Ocupacional y Ambiental por la Universidad Privada Antenor Orrego - Trujillo. Actualmente labora en el Hospital Regional Docente de Cajamarca en la unidad de cuidados intensivos (UCI).' },
    { img: photoAna,      name: 'Karen Távara',      role: 'Asesora Legal',               bio: 'Profesional en Derecho por la Universidad Privada Antonio Guillermo Urrelo. Con sólida experiencia en el ejercicio legal y en la docencia. Ha desempeñado funciones como abogada en diversas instituciones públicas.' },
    { img: photoMilagros, name: 'Milagros Villegas', role: 'Secretaria',                  bio: 'Profesional de enfermería técnica, con experiencia en ventas y trato al cliente entre otros.' },
  ]

  return (
    <>
      <section className="ns-hero" aria-labelledby="ns-hero-heading">
        <div className="container ns-hero-inner">
          <span className="ns-hero-pill">Horus Group SRL</span>
          <AnimatedTitle id="ns-hero-heading" text={TITLE} />
          <p className="ns-hero-sub">Conoce a la empresa y a las personas que están detrás de Horus Group.</p>
          <div className="ns-sticker-wrap">
            <img className="ns-sticker" src={stickerHorus} alt="Logo de Horus Group SRL" width="530" height="470" />
          </div>
        </div>
      </section>

      <section className="ns-intro">
        <div className="container ns-intro-wrap">
          <div className="ns-left fade-up">
            <div className="ns-photo-stack">
              <img className="ns-photo-main" src={photoMain} alt="Horus Group" />
              <img className="ns-photo-sec"  src={photologo3 }  alt="Equipo" />
              <div className="ns-photo-badge">
                <i className="fas fa-map-marker-alt" />
                <span>Cajamarca, Perú</span>
              </div>
            </div>
            <div className="ns-quick-facts">
              <div className="ns-qf"><span>2019</span><p>Año de fundación</p></div>
              <div className="ns-qf"><span>400+</span><p>Personas formadas</p></div>
              <div className="ns-qf"><span>6</span><p>Convenios activos</p></div>
            </div>
          </div>
          <div className="ns-right fade-up">
            <div className="ns-intro-label">Hola, somos</div>
            <h2 className="ns-intro-title">Horus Group <span>SRL</span></h2>
            <div className="ns-intro-body">
              <p className="ns-intro-lead">Una empresa cajamarquina que nació con una idea simple: que la tecnología y la educación de calidad no deberán ser privilegio de las grandes ciudades.</p>
              <p>Desde 2019 trabajamos cada día para llevar soluciones tecnológicas reales y formación profesional certificada a empresas, instituciones y personas de nuestra región.</p>
              <p>No somos una multinacional. Somos tu vecino, tu aliado local, el equipo que conoce Cajamarca porque vivimos aquí.</p>
            </div>
            <Link to="/contactos" className="btn-coral ns-intro-cta">
              <i className="fas fa-paper-plane" /> Hablemos
            </Link>
          </div>
        </div>
      </section>

      <section className="ns-mvv" aria-labelledby="ns-mvv-title">
        <div className="container">
          <div className="ns-section-head fade-up">
            <span className="ns-pill">Nuestra identidad</span>
            <h2 id="ns-mvv-title">Misión, Visión y Valores</h2>
            <p>Los pilares que guían cada decisión y acción en Horus Group SRL.</p>
          </div>
          <div className="ns-mvv-grid">
            <article className="ns-mvv-card fade-up">
              <div className="ns-mvv-icon"><i className="fas fa-bullseye" aria-hidden="true" /></div>
              <h3>Misión</h3>
              <p>“Somos una empresa Cajamarquina que busca el desarrollo y crecimiento de la comunidad a través de los diferentes servicios de tecnología y capacitaciones que brindamos, con calidad y vocación para que nuestros clientes se sientan satisfechos y sigan confiando en nosotros.”</p>
              <div className="ns-mvv-art"><img src={artMision} alt="" loading="lazy" /></div>
            </article>
            <article className="ns-mvv-card fade-up">
              <div className="ns-mvv-icon"><i className="fas fa-eye" aria-hidden="true" /></div>
              <h3>Visión</h3>
              <p>Lograr ser una empresa reconocida en la Región de Cajamarca, posicionándonos como líderes en el desarrollo de competencias tecnológicas y capacitaciones de alto nivel, contando con un equipo de profesionales especializados y adaptándonos a las necesidades de la población.</p>
              <div className="ns-mvv-art"><img src={artVision} alt="" loading="lazy" /></div>
            </article>
            <article className="ns-mvv-card fade-up">
              <div className="ns-mvv-icon"><i className="fas fa-star" aria-hidden="true" /></div>
              <h3>Valores</h3>
              <p>En Horus Group SRL nos caracterizamos por los siguientes valores institucionales:</p>
              <ul className="ns-mvv-values">
                {VALUES.map(value => <li key={value}>{value}</li>)}
              </ul>
              <div className="ns-mvv-art"><img src={artValores} alt="" loading="lazy" /></div>
            </article>
          </div>
        </div>
      </section>

      <section className="ns-team" aria-labelledby="ns-team-title">
        <div className="container">
          <div className="ns-section-head fade-up">
            <span className="ns-pill">Nuestro equipo</span>
            <h2 id="ns-team-title">Profesionales comprometidos</h2>
            <p>Conoce a las personas que hacen posible nuestro éxito.</p>
          </div>
          <div className="ns-team-grid">
            {members.map((m, i) => (
              <TeamCard key={m.name} {...m} open={openIndex === i} onToggle={() => setOpenIndex(openIndex === i ? null : i)} />
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
