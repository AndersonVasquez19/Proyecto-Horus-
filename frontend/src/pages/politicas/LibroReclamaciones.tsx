import { useEffect, useState } from 'react'
import { useCompanySetting } from '../../context/companySettings'
import PageHero from '../../components/PageHero'
import LibroForm from '../../components/libro/LibroForm'
import type { Registered } from '../../components/libro/LibroForm'
import LibroResult from '../../components/libro/LibroResult'

// PENDIENTE (revisión humana): la dirección sigue escrita aquí porque no coincide con CompanySettings.direccion ("Cajamarca - Peru").
const ADDRESS = 'Jr. Jose Gálvez #322, Cajamarca'

export default function LibroReclamaciones() {
  const setting = useCompanySetting()
  const empresa = setting('empresa_nombre', 'Horus Group SRL')
  const phone = setting('telefono_principal', '+51 927 582 305')
  const email = setting('email_contacto', 'horusgroupcajamarca@gmail.com')
  const [result, setResult] = useState<Registered | null>(null)

  useEffect(() => { document.title = 'Libro de Reclamaciones — ' + empresa }, [empresa])

  return <>
    <PageHero eyebrow="Atención" title="Libro de Reclamaciones" actions={<span className="lb-law">Ley N° 29571 — INDECOPI</span>}>
      {result ? undefined : <>Tu opinión es importante para nosotros. Registra tu queja o reclamo y te responderemos en un plazo máximo de <strong>15 días hábiles</strong>.</>}
    </PageHero>

    <section className="lb-page">
      <div className="container lb-wrap">
        {result
          ? <LibroResult result={result} />
          : <>
            <p className="lb-notice">La formulación de un reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI. Conforme al Código de Protección y Defensa del Consumidor (Ley N° 29571).</p>
            <LibroForm empresa={empresa} onRegistered={setResult} />
            <aside className="lb-contact" aria-labelledby="lb-contact-title">
              <h2 id="lb-contact-title">Contacto</h2>
              <ul>
                <li><i className="fas fa-phone" aria-hidden="true" /> <a href={'tel:' + phone.replace(/[^+\d]/g, '')}>{phone}</a></li>
                <li><i className="fas fa-envelope" aria-hidden="true" /> <a href={'mailto:' + email}>{email}</a></li>
                <li><i className="fas fa-map-marker-alt" aria-hidden="true" /> <span>{ADDRESS}</span></li>
              </ul>
            </aside>
          </>}
      </div>
    </section>
  </>
}
