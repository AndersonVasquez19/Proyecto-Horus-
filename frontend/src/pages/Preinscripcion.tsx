import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompanySetting } from '../context/companySettings'
import PageHero from '../components/PageHero'
import PreregistrationForm from '../components/prereg/PreregistrationForm'
import { parseEditions } from '../components/prereg/preregModel'
import PublicRequestState from '../components/PublicRequestState'
import { usePublicResource } from '../hooks/usePublicResource'
import { PUBLIC_ERROR_TEXTS } from '../publicErrors'
import '../styles/preinscripcion.css'

export default function Preinscripcion() {
  const setting = useCompanySetting()
  const empresa = setting('empresa_nombre', 'Horus Group SRL')
  const [params] = useSearchParams()
  const { data, loading, error, reload } = usePublicResource<unknown>('preinscripciones/convocatorias')
  const [sent, setSent] = useState('')
  const editions = data === null ? null : parseEditions(data)
  useEffect(() => { document.title = 'Preinscripción — ' + empresa }, [empresa])

  return <>
    <PageHero eyebrow="Educación" title="Preinscripción" actions={<Link className="home-button" to="/educacion/cursos">Ver cursos</Link>}>
      {sent ? undefined : <>Déjanos tus datos y el equipo de Horus se pondrá en contacto contigo cuando la edición que te interesa esté confirmada.</>}
    </PageHero>
    <section className="lb-page pr-page">
      <div className="container lb-wrap">
        {sent ? <div className="pr-success" role="status" tabIndex={-1} ref={element => element?.focus()}>
          <i className="fas fa-circle-check" aria-hidden="true" />
          <h2>¡Recibimos tu preinscripción!</h2>
          <p>{sent}</p>
          <p className="pr-success-note">Esto no es una matrícula ni garantiza una vacante: el equipo revisará tu solicitud y te contactará.</p>
          <div className="pr-success-actions"><Link className="home-button" to="/educacion/cursos">Explorar cursos</Link><Link className="pr-link" to="/">Volver al inicio</Link></div>
        </div>
          : data === null && (loading || error) ? <PublicRequestState loading={loading} error={error} reload={reload} />
            : editions === null ? <PublicRequestState loading={false} error={PUBLIC_ERROR_TEXTS.server} reload={reload} />
              : editions.length === 0 ? <div className="pr-empty"><i className="fas fa-calendar-xmark" aria-hidden="true" />
                <h2>Por ahora no hay ediciones recibiendo preinscripciones</h2>
                <p>Cuando se habilite una nueva edición podrás registrarte aquí. Mientras tanto, escríbenos y te avisamos.</p>
                <div className="pr-success-actions"><Link className="home-button" to="/contactos">Contactar al equipo</Link><Link className="pr-link" to="/educacion/cursos">Ver cursos</Link></div></div>
                : <PreregistrationForm editions={editions} initialCode={params.get('edicion') ?? ''} empresa={empresa} onSent={setSent} onEditionClosed={reload} />}
      </div>
    </section>
  </>
}
