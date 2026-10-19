import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useCompanySetting } from '../context/companySettings'

// 404 dentro del layout del sitio (Navbar y Footer). Una SPA no puede responder 404 desde el servidor, así que la página
// se marca como noindex mientras está abierta.
export default function NotFound() {
  const setting = useCompanySetting()
  const empresa = setting('empresa_nombre', 'Horus Group SRL')
  useEffect(() => { document.title = 'Página no encontrada — ' + empresa }, [empresa])
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'; meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
  return <div className="nf-page">
    <PageHero eyebrow="Error 404" title="Página no encontrada" id="nf-title" actions={<>
      <Link to="/" className="home-button"><i className="fas fa-home" aria-hidden="true" /> Volver al inicio</Link>
      <Link to="/contactos" className="home-button home-button-outline"><i className="fas fa-envelope" aria-hidden="true" /> Ir a Contactos</Link>
    </>}>
      La página que buscas no existe o fue movida.
    </PageHero>
  </div>
}
