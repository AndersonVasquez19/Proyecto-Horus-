import logoHorus from '../../assets/images/logo-horus.png'
import PolicyLayout, { PolicySection } from '../../components/policy/PolicyLayout'
import { usePolicyCompany } from '../../components/policy/usePolicyCompany'

export default function PoliticasPrivacidad() {
  const { empresa, correo } = usePolicyCompany()
  return (
    <PolicyLayout current="privacidad" title="Política de Privacidad"
      description="Protegemos tu información personal con los más altos estándares de seguridad."
      closing={{ title: '¿Tienes dudas sobre tu privacidad?', text: 'Estamos comprometidos con la protección de tus datos personales. Contáctanos para cualquier consulta.' }}>
      <div className="policy-lead">
        <p>La presente <strong>"POLÍTICA DE PRIVACIDAD"</strong> tiene por finalidad informar cómo <strong>{empresa}</strong> trata la información personal de todos los usuarios que visiten e interactúen en nuestro sitio web o al utilizar los diferentes servicios que brindamos.</p>
        <p>El usuario declara haber leído y aceptado de manera previa y expresa la POLÍTICA sujetándose a todas sus disposiciones.</p>
      </div>

      <PolicySection id="recoleccion">
        <h2 id="recoleccion-title">¿Qué información recolectamos o recopilamos?</h2>
        <p>El usuario puede navegar en LA PÁGINA de manera libre. Los datos personales se solicitan únicamente cuando el usuario completa un formulario: Contactos, solicitud de atención del asistente virtual, suscripción a novedades o Libro de Reclamaciones.</p>
        <div className="policy-note">
          <p><strong>Los datos personales del usuario que se solicitan son:</strong></p>
          <ul>
            <li>Nombres y apellidos</li>
            <li>Correo electrónico</li>
            <li>Número de celular</li>
            {/* REVISIÓN-HUMANA [datos-recogidos]: el Libro de Reclamaciones también recoge tipo y número de documento, dirección, relato del reclamo y fecha del incidente; Contactos y chatbot recogen asunto y mensaje. Hoy solo los cubre la fórmula "otros necesarios". */}
            <li>Otros necesarios para el servicio que corresponda</li>
          </ul>
        </div>
      </PolicySection>

      <PolicySection id="uso">
        <h2 id="uso-title">¿Qué hacemos con tu información?</h2>
        <p>Los datos personales proporcionados a través de LA PÁGINA quedan incorporados en nuestro banco de datos y podrán ser utilizados para:</p>
        <ul>
          <li>Desarrollo de acciones comerciales.</li>
          <li>La remisión vía correo electrónico de publicidad.</li>
          <li>Información personalizada o general de cursos, talleres, diplomados y/o servicios de LA PÁGINA.</li>
        </ul>
        <p>A través de la presente POLÍTICA DE PRIVACIDAD, el usuario da su consentimiento expreso para la inclusión de sus datos personales en el mencionado banco de datos.</p>
      </PolicySection>

      <PolicySection id="asistente">
        <h2 id="asistente-title">Asistente virtual: preguntas sin respuesta</h2>
        <p>Cuando el asistente virtual no encuentra información publicada para responder una consulta escrita en el chat, registramos el texto de la pregunta (con los correos, teléfonos, números largos y enlaces ocultados automáticamente) junto con contadores de uso. La <strong>finalidad</strong> es únicamente mejorar los contenidos que publicamos y la calidad de las respuestas del asistente.</p>
        <p>Este registro no incluye tu nombre ni se asocia a ningún formulario. Lo conservamos durante <strong>90 días</strong> desde la última vez que se repite la pregunta y después se elimina automáticamente. La ocultación automática no puede reconocer nombres ni direcciones: evita escribir datos personales en el chat. Para solicitar la eliminación anticipada escríbenos a <a href={`mailto:${correo}`}>{correo}</a>.</p>
      </PolicySection>

      <PolicySection id="consentimiento">
        <h2 id="consentimiento-title">Consentimiento</h2>
        {/* REVISIÓN-HUMANA [contactos-sin-consentimiento]: el formulario de Contactos no tiene casilla de autorización ni enlace a esta política, por eso no se menciona aquí. Pendiente decidir (producto/humano) cómo se informa su consentimiento. */}
        <p>Los usuarios darán su consentimiento explícito del tratamiento de sus datos personales cuando marquen la casilla de autorización y envíen el formulario correspondiente (solicitud de atención del asistente virtual, suscripción a novedades y Libro de Reclamaciones).</p>
        <div className="policy-note">
          <p>Si luego de haber aceptado cambias de opinión, puedes anular tu consentimiento en cualquier momento contactándonos a <a href={`mailto:${correo}`}>{correo}</a></p>
        </div>
      </PolicySection>

      <PolicySection id="tiempo">
        <h2 id="tiempo-title">¿Cuánto tiempo conservamos tus datos?</h2>
        {/* REVISIÓN-HUMANA [retencion]: la baja de la newsletter solo desactiva el correo (no lo borra) y no hay borrado automático; no se toca el texto sin revisión. */}
        <p>Los Datos Personales que son almacenados, utilizados o transmitidos permanecerán en el banco de datos de LA PÁGINA durante el tiempo que sea necesario para cumplir los fines previstos en la presente Política o hasta el momento en que usted decida eliminarlos.</p>
      </PolicySection>

      <PolicySection id="derechos">
        <h2 id="derechos-title">Derechos de acceso, rectificación, cancelación y oposición</h2>
        <p>El Usuario tiene derecho de acceso, rectificación, oposición y/o cancelación de su información personal comunicándose con LA PÁGINA al correo electrónico:</p>
        <p className="policy-mail"><a href={`mailto:${correo}`}>{correo}</a></p>
        <dl className="policy-defs">
          {[
            { title: 'Acceso',        desc: 'Conocer qué datos personales tenemos sobre ti' },
            { title: 'Rectificación', desc: 'Corregir datos inexactos o incompletos' },
            { title: 'Cancelación',   desc: 'Eliminar tus datos de nuestros registros' },
            { title: 'Oposición',     desc: 'Oponerte al tratamiento de tus datos' },
          ].map(d => (
            <div key={d.title}>
              <dt>{d.title}</dt>
              <dd>{d.desc}</dd>
            </div>
          ))}
        </dl>
      </PolicySection>

      <PolicySection id="modificaciones">
        <h2 id="modificaciones-title">Modificaciones a nuestras Políticas de Privacidad</h2>
        <p>LA PÁGINA se reserva el derecho de modificar, rectificar, alterar, agregar o eliminar cualquier punto del presente escrito en cualquier momento y sin previo aviso, siendo su responsabilidad el mantenerse informado del mismo para una adecuada administración de su información.</p>
      </PolicySection>

      <PolicySection id="terceros">
        <h2 id="terceros-title">¿Compartiremos tus datos con terceros?</h2>
        <div className="policy-note">
          <p><strong>Protegemos la información que recabamos</strong> estableciendo las medidas de seguridad técnicas y administrativas señaladas en las normas legales, de forma que la información queda protegida contra el acceso, la indisponibilidad, la divulgación o el uso no autorizado.</p>
        </div>
        <ul>
          <li>Los formularios y correos utilizan los datos de contacto que proporcionas para atender tu solicitud. Si está habilitada la asistencia con IA, la consulta, el contexto de conversación y las fuentes públicas pueden enviarse al proveedor de IA. Se ocultan correos y secuencias numéricas que parecen teléfonos o documentos, pero esto no garantiza anonimato. No escribas datos personales en el chat; utiliza el formulario de atención.</li>
          <li>Si nuestro negocio entra en una empresa conjunta, compra otra empresa o se fusiona con otra entidad comercial, tus datos personales podrían ser divulgados o transferidos a la empresa de destino.</li>
          <li>En estas circunstancias, siempre informaremos a las entidades correspondientes de que solo deben usar tus datos personales para los fines descritos en esta Política de Privacidad.</li>
        </ul>
      </PolicySection>

      <PolicySection id="contacto-pp">
        <h2 id="contacto-pp-title">Contacto</h2>
        <p>Para cualquier consulta sobre nuestras Políticas de Privacidad, puedes contactarnos al correo electrónico:</p>
        <p className="policy-mail"><a href={`mailto:${correo}`}>{correo}</a></p>
        <div className="policy-signature">
          <img src={logoHorus} alt="" />
          <div><p><strong>Asesoría Legal</strong></p><p>{empresa}</p></div>
        </div>
      </PolicySection>
    </PolicyLayout>
  )
}
