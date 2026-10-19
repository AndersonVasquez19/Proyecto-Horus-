import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../../components/PageHero'
import AdviceSections from '../../components/edu/AdviceSections'

export default function Asesoramiento() {
  useEffect(() => { document.title = 'Asesoramiento Profesional — Horus Group SRL' }, [])
  return <>
    <PageHero eyebrow="Educación" title="Asesoramiento" actions={<>
      <Link to="/contactos?asunto=Asesoramiento" className="home-button"><i className="fas fa-calendar-check" aria-hidden="true" /> Agendar consulta</Link>
      <a href="#asesoramiento" className="home-button home-button-outline"><i className="fas fa-arrow-down" aria-hidden="true" /> Ver tipos</a>
    </>}>
      Acompañamiento profesional para tu proyecto, empresa o trayectoria. Elige el área y consulta con nuestro equipo.
    </PageHero>
    <AdviceSections />
  </>
}
