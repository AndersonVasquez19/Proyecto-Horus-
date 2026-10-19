import logoHorus from '../../assets/images/logo-horus.png'
import PolicyLayout, { PolicySection } from '../../components/policy/PolicyLayout'
import { usePolicyCompany } from '../../components/policy/usePolicyCompany'

const INDEX = [
  { id: 'intro-pd',     label: 'Introducción' },
  { id: 'educacion-pd', label: 'Educación' },
  { id: 'modif-pd',     label: 'Modificaciones' },
  { id: 'atencion-pd',  label: 'Atención al usuario' },
]

export default function PoliticasDevolucion() {
  const { empresa, correo } = usePolicyCompany()
  return (
    <PolicyLayout current="devolucion" title="Política de Devolución" index={INDEX}
      description="Conoce nuestros términos y condiciones para la devolución de cursos, talleres, capacitaciones y diplomados."
      closing={{ title: '¿Tienes alguna consulta?', text: 'Nuestro equipo legal está disponible para resolver cualquier duda sobre nuestras políticas.' }}>
      <div className="policy-lead" id="intro-pd" tabIndex={-1}>
        <p>Al acceder y utilizar este sitio web, usted está aceptando todos los términos y condiciones. Si no está de acuerdo con alguna parte, puede desistir de la utilización de este sitio web o de alguno de los servicios que brindamos por la empresa <strong>{empresa}</strong>.</p>
      </div>

      <PolicySection id="educacion-pd">
        <h2 id="educacion-pd-title">Educación — Talleres, capacitaciones, cursos, diplomados</h2>
        {/* REVISIÓN-HUMANA [promesa][plazos]: "satisfacción garantizada" y los plazos de este bloque (1 día calendario, 2 días hábiles, 1 mes) son compromisos concretos; no se tocan sin revisión. El sitio no tiene inscripción ni pago en línea: el proceso es por correo. */}
        <p>La empresa de Telecomunicaciones y Capacitaciones Profesionales {empresa} se compromete en ofrecer una satisfacción garantizada en todos talleres, cursos de actualización, capacitaciones y/o diplomados que se realice, por ello se realizará la devolución del monto pagado solo en el caso de que amerite.</p>
        <p>Todas las solicitudes serán recibidas y atendidas por nuestro equipo de Asistencia Legal a través de nuestro correo electrónico <a href={`mailto:${correo}`}>{correo}</a></p>

        <h3 id="educacion-pd-1" tabIndex={-1}><span className="policy-num">1</span> Circunstancia para solicitar la devolución de dinero</h3>
        <p>Casos fortuitos o de fuerza mayor que impidan el asistir a la clase teórica y/o práctica, cursos de actualización, talleres, capacitaciones y otros con características distintas a las ofrecidas, incumplimiento en los días de capacitación.</p>

        <h3 id="educacion-pd-2" tabIndex={-1}><span className="policy-num">2</span> Consideraciones que se debe tener en cuenta</h3>
        <ul>
          <li>Puedes solicitar la devolución del dinero cancelado en un plazo máximo de <strong>1 día calendario</strong> desde la fecha en la cual te inscribiste y como máximo hasta la fecha en la cual se dará la clase teórica y/o práctica. Pasado este día, ya no tienes opción a solicitar la devolución.</li>
          <li>Al momento de solicitar la devolución, el correo electrónico debe contener los <strong>medios probatorios</strong> que acrediten la situación expuesta.</li>
          <li>No se aceptará la devolución de ser que no se adjunten los medios probatorios en el correo electrónico.</li>
          <li>Si ya asististe a la clase teórica, <strong>no puedes solicitar la devolución</strong> de tu dinero.</li>
        </ul>

        <h3 id="educacion-pd-3" tabIndex={-1}><span className="policy-num">3</span> Canales para realizar el cambio o devolución</h3>
        <p>Todas las solicitudes serán recibidas y atendidas por nuestro equipo de Asistencia Legal a través de nuestro correo electrónico:</p>
        <p className="policy-mail"><a href={`mailto:${correo}`}>{correo}</a></p>

        <h3 id="educacion-pd-4" tabIndex={-1}><span className="policy-num">4</span> Consideraciones para la solicitud de devolución de dinero</h3>
        <ul>
          <li>Puedes solicitar la <strong>devolución íntegra</strong> del dinero.</li>
          <li>En el correo electrónico, debes indicar tus datos personales, DNI, medio de pago y comprobante del mismo, así como el taller, curso, capacitación o diplomado al cual te inscribiste y la fecha de este.</li>
        </ul>

        <h3 id="educacion-pd-5" tabIndex={-1}><span className="policy-num">5</span> Pasos para solicitudes de devolución</h3>
        <ul className="policy-steps">
          <li>
            <span>1</span>
            <div>
              <h4>Envía tu solicitud</h4>
              <p>Comunicarte mediante correo electrónico a <a href={`mailto:${correo}`}>{correo}</a> adjuntando tus medios probatorios.</p>
              <ul><li><strong>ASUNTO:</strong> DEVOLUCIÓN DE DINERO</li>{/* REVISIÓN-HUMANA [persona-nombrada]: destinatario nombrado en el texto; ningún dato del panel lo respalda. */}<li><strong>DESTINATARIO:</strong> Abog. Luz Karen Tavara Camacho</li></ul>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h4>Espera la respuesta</h4>
              <p>En un plazo de <strong>2 días hábiles</strong> recibirás una respuesta por parte del equipo de Asistencia Legal.</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h4>Recibe tu devolución</h4>
              <p>De ser que proceda la devolución del dinero, nos pondremos en contacto contigo para comunicarte el modo de esta.</p>
            </div>
          </li>
        </ul>

        <h3 id="educacion-pd-6" tabIndex={-1}><span className="policy-num">6</span> Tiempo de devolución de dinero</h3>
        <p>Se efectuará después de haberse aprobado la solicitud de devolución. El tiempo aproximado es <strong>2 (dos) días hábiles</strong> posteriores a la aprobación.</p>

        <h3 id="educacion-pd-7" tabIndex={-1}><span className="policy-num">7</span> Resguardo de los certificados</h3>
        <ul>
          <li>Los certificados que no se recojan por parte del participante en la ceremonia de entrega quedarán bajo resguardo de la empresa {empresa}.</li>
          <li>El tiempo de resguardo garantizado por parte la empresa es de <strong>1 mes</strong>, luego de ese tiempo la empresa no se responsabiliza por el deterioro o pérdida de este.</li>
          {/* REVISIÓN-HUMANA [whatsapp-especifico]: 942 956 207 es el contacto de la "coordinadora institucional" y NO coincide con el WhatsApp general del panel (51927582305); se deja intacto hasta confirmarlo. */}
          <li>Para la entrega del certificado pasada la fecha de ceremonia, el participante deberá ponerse en contacto con la empresa a través del número de WhatsApp <strong>942 956 207</strong> (coordinadora institucional).</li>
        </ul>
      </PolicySection>

      <PolicySection id="modif-pd">
        <h2 id="modif-pd-title">Modificación en los términos y condiciones de uso</h2>
        <p>{empresa} podrá modificar, adicionar, eliminar y/o actualizar las políticas de devolución en cualquier momento, por cualquier razón y/o sin previo aviso, los cuales seguirán siendo de obligatoriedad el cumplimiento de estas desde el momento de su publicación.</p>
      </PolicySection>

      <PolicySection id="atencion-pd">
        <h2 id="atencion-pd-title">Atención al usuario</h2>
        <p>Para cualquier aclaración o duda sobre los Términos y Condiciones comunicarse al correo electrónico:</p>
        <p className="policy-mail"><a href={`mailto:${correo}`}>{correo}</a></p>
        <div className="policy-signature">
          <img src={logoHorus} alt="" />
          <div><p><strong>Asesoría Legal</strong></p><p>{empresa}</p></div>
        </div>
      </PolicySection>
    </PolicyLayout>
  )
}
