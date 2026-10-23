import { useEffect, useState } from 'react'
import { useCompanySetting } from '../../context/companySettings'
import LibroForm from '../../components/libro/LibroForm'
import type { Registered } from '../../components/libro/LibroForm'
import LibroResult from '../../components/libro/LibroResult'

// PENDIENTE (revisión humana): la dirección sigue escrita aquí porque no coincide con CompanySettings.direccion ("Cajamarca - Peru").
const ADDRESS = 'Jr. Jose Gálvez #322, Cajamarca'

export default function LibroReclamaciones() {
  const setting = useCompanySetting()
  const empresa = setting('empresa_nombre', 'Horus Group SRL')
  const phone = setting('telefono_principal', '+51 972 021 374')
  const email = setting('email_contacto', 'horusgroupcajamarca@gmail.com')
  const [result, setResult] = useState<Registered | null>(null)

  useEffect(() => { document.title = 'Libro de Reclamaciones — ' + empresa }, [empresa])

  return <div className="lb-shell">
    <section className="horus-hero lb-hero" aria-labelledby="lb-page-title">
      <div className="container lb-hero-inner">
        <div className="lb-hero-copy">
          <span className="horus-hero-eyebrow">Atención al consumidor</span>
          <h1 id="lb-page-title">Libro de <span>Reclamaciones</span></h1>
          {!result && <p>Tu opinión nos ayuda a mejorar. Este es tu espacio para registrar una queja o reclamo.</p>}
          <span className="lb-law"><i className="fas fa-scale-balanced" aria-hidden="true" /> Ley N° 29571 — INDECOPI</span>
        </div>
        <div className="lb-response">
          <span className="lb-response-icon" aria-hidden="true"><i className="far fa-clock" /></span>
          <span className="lb-response-label">Plazo máximo de respuesta</span>
          <strong>15 <span>días hábiles</span></strong>
          <p>Nos comprometemos a atender tu solicitud.</p>
        </div>
      </div>
    </section>

    <section className="lb-page">
      <div className="container lb-wrap">
        {result
          ? <LibroResult result={result} />
          : <div className="lb-layout">
            <LibroForm empresa={empresa} onRegistered={setResult} />
            <aside className="lb-aside" aria-label="Información para tu registro">
              <nav className="lb-guide" aria-labelledby="lb-guide-title">
                <span className="lb-eyebrow">Tu registro, paso a paso</span>
                <h2 id="lb-guide-title">Te acompañamos</h2>
                <p>Completa las cuatro secciones del formulario.</p>
                <ol>
                  <li><a href="#lb-consumidor"><span aria-hidden="true">01</span><span>Datos del consumidor<small>Tu información de contacto</small></span></a></li>
                  <li><a href="#lb-registro"><span aria-hidden="true">02</span><span>Reclamo o queja<small>Tipo, área y fecha</small></span></a></li>
                  <li><a href="#lb-detalle"><span aria-hidden="true">03</span><span>Detalle<small>Cuéntanos lo ocurrido</small></span></a></li>
                  <li><a href="#lb-envio"><span aria-hidden="true">04</span><span>Consentimiento y envío<small>Revisa y envía tu registro</small></span></a></li>
                </ol>
              </nav>
              <div className="lb-notice">
                <h2><i className="fas fa-circle-info" aria-hidden="true" /> Ten en cuenta</h2>
                <p>La formulación de un reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI. Conforme al Código de Protección y Defensa del Consumidor (Ley N° 29571).</p>
              </div>
              <div className="lb-contact" aria-labelledby="lb-contact-title">
                <h2 id="lb-contact-title">¿Necesitas ayuda?</h2>
                <p>También puedes contactarnos.</p>
                <ul>
                  <li><i className="fas fa-phone" aria-hidden="true" /> <a href={'tel:' + phone.replace(/[^+\d]/g, '')}>{phone}</a></li>
                  <li><i className="fas fa-envelope" aria-hidden="true" /> <a href={'mailto:' + email}>{email}</a></li>
                  <li><i className="fas fa-map-marker-alt" aria-hidden="true" /> <span>{ADDRESS}</span></li>
                </ul>
              </div>
            </aside>
          </div>}
      </div>
    </section>
  </div>
}
