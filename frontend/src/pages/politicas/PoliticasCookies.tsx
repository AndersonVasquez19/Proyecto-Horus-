import logoHorus from '../../assets/images/logo-horus.png'
import PolicyLayout, { PolicySection } from '../../components/policy/PolicyLayout'
import { usePolicyCompany } from '../../components/policy/usePolicyCompany'

const INDEX = [
  { id: 'introduccion',  label: '1. Introducción' },
  { id: 'que-son',       label: '2. ¿Qué son las cookies?' },
  { id: 'tipos',         label: '3. Tipos de cookies' },
  { id: 'cookies-horus', label: '4. Qué utiliza este sitio' },
  { id: 'gestion',       label: '5. Gestión de cookies' },
  { id: 'consultas',     label: '6. Consultas' },
  { id: 'vigencia',      label: '7. Vigencia' },
]

export default function PoliticasCookies() {
  const { empresa, correo } = usePolicyCompany()
  return (
    <PolicyLayout current="cookies" title="Política de Cookies" index={INDEX}
      description="Información sobre el uso de cookies en nuestro sitio web y cómo gestionarlas para proteger tu privacidad."
      closing={{ title: '¿Necesitas más información?', text: 'Estamos disponibles para resolver cualquier duda sobre nuestra política de cookies.' }}>
      <PolicySection id="introduccion">
        <h2 id="introduccion-title">1. Introducción</h2>
        <p>{empresa} describe en el presente documento la <strong>"Política de Cookies"</strong> que regula el sitio web con el objetivo de garantizar la privacidad del usuario, que en adelante se le llamará <strong>"EL USUARIO"</strong>.</p>
        {/* REVISIÓN-HUMANA [direccion]: el panel (CompanySettings.direccion) dice "Cajamarca - Peru"; se mantiene la dirección de la política hasta decidir cuál es la vigente (también en la firma del apartado 7). */}
        <div className="policy-note">
          <p>El sitio web es propiedad de la empresa <strong>{empresa}</strong>, con domicilio en el <strong>Jr. José Gálvez Nro. 322 – Provincia y Departamento de Cajamarca</strong>.</p>
        </div>
        <p>En este documento explicamos qué cookies y recursos de terceros utiliza el sitio.</p>
      </PolicySection>

      <PolicySection id="que-son">
        <h2 id="que-son-title">2. ¿Qué son las cookies?</h2>
        <p>Las cookies son pequeños archivos de texto que los sitios web guardan en tu computadora o dispositivo móvil cuando los visitas. Estos archivos permiten que el sitio web recuerde información sobre tu visita.</p>
      </PolicySection>

      <PolicySection id="tipos">
        <h2 id="tipos-title">3. Tipos de cookies</h2>
        <h3><span className="policy-num">A</span> Según la entidad que las gestione</h3>
        <div className="policy-item">
          <h4>Cookies propias</h4>
          <p>Son aquellas que se envían al dispositivo de acceso a Internet del Usuario desde el sitio web gestionada por el propio titular del sitio y desde el que se presta el servicio solicitado por "EL USUARIO".</p>
        </div>
        <div className="policy-item">
          <h4>Cookies de terceros</h4>
          <p>Son aquellas que se envían al dispositivo de acceso a Internet de "EL USUARIO" desde el sitio web pero que no es gestionado por el titular del sitio, sino por otra entidad que trata los datos obtenidos mediante las cookies.</p>
        </div>
        <h3><span className="policy-num">B</span> Según el plazo de tiempo</h3>
        <div className="policy-item">
          <h4>Cookies de sesión</h4>
          <p>Son un tipo de cookies diseñadas para recoger y almacenar datos mientras "EL USUARIO" accede al sitio web. Se suelen utilizar para almacenar información que sólo interesa conservar para la prestación del servicio solicitado en una sola ocasión.</p>
        </div>
        <div className="policy-item">
          <h4>Cookies persistentes</h4>
          <p>Son un tipo de cookies en la que los datos siguen almacenados en el dispositivo de acceso a Internet de "EL USUARIO" y pueden ser accedidas y tratadas durante un periodo definido por el responsable de la cookie, que puede ir de unos minutos a varios años.</p>
        </div>
      </PolicySection>

      <PolicySection id="cookies-horus">
        <h2 id="cookies-horus-title">4. Qué utiliza este sitio</h2>
        {/* REVISIÓN-HUMANA [cookies-terceros]: no se puede demostrar desde el código si Google Maps establece cookies (las fuentes y los iconos ya son locales); el texto solo afirma las solicitudes externas y que pueden aplicar sus propias tecnologías o políticas. Revisar si sigue siendo cierto cuando cambie el sitio (nuevas integraciones, analítica, etc.). */}
        <div className="policy-item">
          <h3>Cookies propias</h3>
          <p>El sitio público no establece cookies propias actualmente. No utilizamos herramientas de analítica ni de publicidad, y no realizamos seguimiento del comportamiento de las personas que lo visitan.</p>
        </div>
        <div className="policy-item">
          <h3>Servicios externos</h3>
          <p>Las tipografías y los iconos se sirven desde este mismo sitio. El mapa de ubicación solo se carga cuando pulsas «Mostrar mapa»; en ese momento tu navegador realiza solicitudes a los servidores de este proveedor externo:</p>
          <dl className="policy-defs">
            {[
              { title: 'Google Maps',          desc: 'Mapa de ubicación, en las páginas de Inicio y Contactos.' },
            ].map(s => (
              <div key={s.title}>
                <dt>{s.title}</dt>
                <dd>{s.desc}</dd>
              </div>
            ))}
          </dl>
          <p>Este proveedor puede aplicar sus propias tecnologías y políticas, que no controlamos.</p>
        </div>
        <div className="policy-item">
          <h3>Enlaces a sitios externos</h3>
          <p>Los enlaces a WhatsApp, Facebook, Instagram y Google Maps (para indicaciones) llevan a sitios externos y solo se abren cuando haces clic en ellos.</p>
        </div>
      </PolicySection>

      <PolicySection id="gestion">
        <h2 id="gestion-title">5. Gestión de cookies</h2>
        <p>{empresa} asume un compromiso sobre el uso de cookies, en consecuencia, otorga a "EL USUARIO" acceso a información para que pueda comprender qué tipo de cookies se utiliza en este sitio web y la razón de ello.</p>
        <ul>
          <li>"EL USUARIO" puede configurar su navegador para establecer que solo los sitios web de confianza puedan gestionar cookies.</li>
        </ul>
        <h3>Configuración de navegadores:</h3>
        {[
          { name: 'Safari',  desc: 'Preferencias → Seguridad', url: 'https://support.apple.com', label: 'Soporte de Apple' },
          { name: 'Firefox', desc: 'Herramientas → Opciones → Privacidad → Historial → Configuración Personalizada', url: 'https://support.mozilla.org', label: 'Soporte de Mozilla' },
          { name: 'Chrome',  desc: 'Configuración → Mostrar opciones avanzadas → Privacidad → Configuración de contenido', url: 'https://support.google.com', label: 'Soporte de Google' },
        ].map(b => (
          <div key={b.name} className="policy-item">
            <h4>{b.name}</h4>
            <p>{b.desc}</p>
            <p><a href={b.url} target="_blank" rel="noreferrer" aria-label={b.label + ' (se abre en una pestaña nueva)'}>{b.label}</a></p>
          </div>
        ))}
      </PolicySection>

      <PolicySection id="consultas">
        <h2 id="consultas-title">6. Consultas</h2>
        <p>Para realizar cualquier tipo de consulta respecto a esta política puede dirigirse a la siguiente dirección de correo electrónico:</p>
        <p className="policy-mail"><a href={`mailto:${correo}`}>{correo}</a></p>
      </PolicySection>

      <PolicySection id="vigencia">
        {/* REVISIÓN-HUMANA [fechas]: no hay fecha de vigencia ni de última actualización; decide la persona responsable. */}
        <h2 id="vigencia-title">7. Vigencia y modificación de la presente política de cookies</h2>
        <p>{empresa} puede modificar esta Política de Cookies en función de exigencias legislativas, reglamentarias, jurisprudenciales o con la finalidad de adaptarla a las instrucciones dictadas por la Autoridad Nacional de Protección de Datos Personales.</p>
        <div className="policy-note"><p>Dado que dicha política puede ser actualizada periódicamente, sugerimos a "EL USUARIO" que la revise de forma regular en nuestro sitio web.</p></div>
        <div className="policy-signature">
          <img src={logoHorus} alt="" />
          <div><p><strong>{empresa}</strong></p><p>Jr. José Gálvez Nro. 322 – Cajamarca</p></div>
        </div>
      </PolicySection>
    </PolicyLayout>
  )
}
