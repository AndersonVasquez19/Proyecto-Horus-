import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, SubmitEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PublicApiError, publicRequest } from '../api'
import { useCompanySetting } from '../context/companySettings'
import PageHero from '../components/PageHero'
import SectionHead from '../components/SectionHead'
import LocationMap from '../components/LocationMap'
import useSocialLinks from '../hooks/useSocialLinks'
import { MAP_DIRECTIONS_URL } from '../siteLinks'

type ContactForm = { nombre: string; email: string; telefono: string; asunto: string; mensaje: string }
type Field = keyof ContactForm
type ContactErrors = Partial<Record<Field, string>>
type Notice = { kind: 'ok' | 'error'; text: string }
type SavedResponse = { ok: boolean; mensaje?: string; correo_enviado?: boolean }

const INITIAL: ContactForm = { nombre: '', email: '', telefono: '', asunto: '', mensaje: '' }
const FIELDS: Field[] = ['nombre', 'email', 'telefono', 'asunto', 'mensaje']
// Same limits as the backend DTO (contacto/dto), so the client never sends what the API would reject.
const LIMITS: Record<Field, number> = { nombre: 100, email: 254, telefono: 30, asunto: 150, mensaje: 5000 }
// The backend waits for the notification e-mail before answering, so the limit leaves room for a slow SMTP.
const SUBMIT_TIMEOUT_MS = 25_000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_CHARS = /^[+()\d\s.-]+$/

const SENT_TEXT = 'Recibimos tu mensaje. Gracias por escribirnos.'
const SENT_PENDING_TEXT = 'Recibimos tu mensaje. Gracias por escribirnos. No es necesario que lo envíes de nuevo.'

// Never cuts an emoji in half when shortening a value taken from the URL.
const clip = (value: string, max: number) => {
  const cut = value.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

function validate(form: ContactForm): ContactErrors {
  const errors: ContactErrors = {}
  const nombre = form.nombre.trim(), email = form.email.trim(), telefono = form.telefono.trim(), asunto = form.asunto.trim(), mensaje = form.mensaje.trim()
  if (!nombre) errors.nombre = 'Ingresa tu nombre.'
  if (!email) errors.email = 'Ingresa tu correo.'
  else if (!EMAIL.test(email)) errors.email = 'Ingresa un correo válido.'
  if (!telefono) errors.telefono = 'Ingresa tu teléfono.'
  else if (!PHONE_CHARS.test(telefono) || telefono.replace(/\D/g, '').length < 1) errors.telefono = 'Ingresa un teléfono válido.'
  if (!asunto) errors.asunto = 'Ingresa el asunto.'
  if (!mensaje) errors.mensaje = 'Escribe tu mensaje.'
  return errors
}

const SERVER_FIELD_MESSAGES: Record<Field, string> = {
  nombre: 'Revisa tu nombre.', email: 'Ingresa un correo válido.', telefono: 'Ingresa un teléfono válido.',
  asunto: 'Revisa el asunto.', mensaje: 'Revisa tu mensaje.',
}

// Turns any failure into Spanish text for the visitor: raw browser/validator messages are never shown.
function describeSubmitError(error: unknown, timedOut: boolean): { text: string; fields: ContactErrors } {
  if (timedOut) return { text: 'El servidor tardó demasiado en responder. Revisa tu conexión e inténtalo nuevamente.', fields: {} }
  if (error instanceof PublicApiError) {
    if (error.status === 400 || error.status === 422) {
      const fields: ContactErrors = {}
      for (const detail of error.details) {
        const field = FIELDS.find(name => detail.startsWith(name + ' '))
        if (field) fields[field] = SERVER_FIELD_MESSAGES[field]
      }
      return { text: 'Revisa los datos del formulario e inténtalo nuevamente.', fields }
    }
    if (error.status === 429) return { text: 'Enviaste demasiados mensajes en poco tiempo. Espera unos minutos e inténtalo nuevamente.', fields: {} }
    if (error.status >= 500) return { text: 'No pudimos enviar tu mensaje en este momento. Inténtalo nuevamente en unos minutos.', fields: {} }
    return { text: 'No pudimos enviar tu mensaje. Inténtalo nuevamente.', fields: {} }
  }
  return { text: 'No pudimos enviar tu mensaje. Revisa tu conexión e inténtalo nuevamente.', fields: {} }
}

type FieldProps = {
  field: Field; label: string; value: string; error?: string; sending: boolean; placeholder: string; autoComplete: string
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  icon?: string; type?: string; inputMode?: 'tel' | 'email'; multiline?: boolean
}

function ContactField({ field, label, value, error, sending, placeholder, autoComplete, onChange, icon, type = 'text', inputMode, multiline }: FieldProps) {
  const id = 'ct-' + field, errorId = id + '-error'
  const shared = {
    id, name: field, value, onChange, placeholder, autoComplete, required: true, maxLength: LIMITS[field], readOnly: sending,
    'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined,
  }
  return <div className="ct-field">
    <label htmlFor={id}>{label}</label>
    {multiline
      ? <textarea {...shared} rows={5} />
      : <div className="ct-control">
        {icon && <i className={icon} aria-hidden="true" />}
        <input {...shared} type={type} inputMode={inputMode} autoCapitalize={field === 'email' ? 'none' : undefined} spellCheck={field === 'email' ? false : undefined} />
      </div>}
    {error && <p id={errorId} className="ct-error"><i className="fas fa-exclamation-circle" aria-hidden="true" /> {error}</p>}
  </div>
}

export default function Contactos() {
  const setting = useCompanySetting()
  const [params] = useSearchParams()
  const subjectParam = clip(params.get('asunto') || '', LIMITS.asunto)
  const [appliedSubject, setAppliedSubject] = useState(subjectParam)
  const [form, setForm] = useState<ContactForm>(() => ({ ...INITIAL, asunto: subjectParam }))
  const [errores, setErrores] = useState<ContactErrors>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [sending, setSending] = useState(false)
  // The ref is the real guard against double submission: state can still be stale when two submits arrive in the same tick.
  const sendingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const noticeRef = useRef<HTMLDivElement>(null)

  useEffect(() => { document.title = 'Contacto — Horus Group SRL' }, [])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; abortRef.current?.abort() }
  }, [])
  // The result (sent or failed) is announced and brought into view, since the button can be far from the notice on phones.
  useEffect(() => {
    const element = noticeRef.current
    if (!element) return
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [notice])

  // A new ?asunto= (links from Cursos, Tecnologías, Chatbot…) fills the subject even if this page was already open.
  if (subjectParam !== appliedSubject && !sending) {
    setAppliedSubject(subjectParam)
    if (subjectParam) {
      setForm(previous => ({ ...previous, asunto: subjectParam }))
      setErrores(previous => ({ ...previous, asunto: undefined }))
    }
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const field = event.target.name as Field
    const value = event.target.value
    setForm(previous => ({ ...previous, [field]: value }))
    if (errores[field]) setErrores(previous => ({ ...previous, [field]: undefined }))
  }

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sendingRef.current) return
    const found = validate(form)
    const firstInvalid = FIELDS.find(field => found[field])
    if (firstInvalid) {
      setErrores(found); setNotice(null)
      document.getElementById('ct-' + firstInvalid)?.focus()
      return
    }
    sendingRef.current = true
    setSending(true); setErrores({}); setNotice(null)
    const controller = new AbortController()
    abortRef.current = controller
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, SUBMIT_TIMEOUT_MS)
    try {
      const response = await publicRequest<SavedResponse>('contacto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form), signal: controller.signal,
      })
      if (!alive.current) return
      setForm(INITIAL)
      setNotice({ kind: 'ok', text: response.correo_enviado ? SENT_TEXT : SENT_PENDING_TEXT })
    } catch (error) {
      if (!alive.current) return
      const { text, fields } = describeSubmitError(error, timedOut)
      const mapped = FIELDS.find(field => fields[field])
      if (mapped) { setErrores(fields); document.getElementById('ct-' + mapped)?.focus() }
      else setNotice({ kind: 'error', text })
    } finally {
      window.clearTimeout(timer)
      sendingRef.current = false
      abortRef.current = null
      if (alive.current) setSending(false)
    }
  }

  const phone = setting('telefono_principal', '+51 927 582 305')
  const email = setting('email_contacto', 'horusgroupcajamarca@gmail.com')
  const { whatsapp } = useSocialLinks()
  const address = setting('direccion', 'Cajamarca - Peru')
  const hours = setting('horario_atencion', 'Horario por confirmar')
  const common = { sending, onChange: handleChange }

  return <>
    <PageHero eyebrow="Contacto" title="Hablemos de tu próximo proyecto" actions={<>
      <a href={whatsapp} target="_blank" rel="noreferrer" className="home-button"><i className="fab fa-whatsapp" aria-hidden="true" /> Escribir por WhatsApp<span className="tech-sr"> (se abre en una pestaña nueva)</span></a>
      <a href={'tel:' + phone.replace(/[^+\d]/g, '')} className="home-button home-button-outline"><i className="fas fa-phone" aria-hidden="true" /> Llamar</a>
    </>}>
      Cuéntanos qué necesitas. Puedes escribirnos con el formulario, por WhatsApp o llamarnos.
    </PageHero>

    <section className="tech-section is-light ct-main" id="contacto" aria-labelledby="ct-main-title">
      <div className="container">
        <SectionHead id="ct-main-title" eyebrow="Escríbenos" title="Elige cómo contactarnos">
          Usa el formulario o el canal que prefieras.
        </SectionHead>
        <div className="ct-layout">
          <div className="ct-form-col">
            <div className="ct-card fade-up">
              <div className="ct-card-head">
                <span className="tech-icon ct-card-icon" aria-hidden="true"><i className="fas fa-paper-plane" /></span>
                <div>
                  <h3>Envíanos un mensaje</h3>
                  <p id="ct-form-note">Todos los campos son obligatorios.</p>
                </div>
              </div>
              {notice && <div ref={noticeRef} tabIndex={-1} className={'ct-alert is-' + notice.kind} role={notice.kind === 'ok' ? 'status' : 'alert'}>
                <i className={notice.kind === 'ok' ? 'fas fa-check-circle' : 'fas fa-exclamation-circle'} aria-hidden="true" /> <span>{notice.text}</span>
              </div>}
              <form onSubmit={handleSubmit} noValidate aria-busy={sending} aria-describedby="ct-form-note">
                <div className="ct-row">
                  <ContactField {...common} field="nombre" label="Nombre" icon="fas fa-user" value={form.nombre} error={errores.nombre} placeholder="Tu nombre completo" autoComplete="name" />
                  <ContactField {...common} field="email" label="Correo" icon="fas fa-envelope" type="email" inputMode="email" value={form.email} error={errores.email} placeholder="tu@correo.com" autoComplete="email" />
                </div>
                <div className="ct-row">
                  <ContactField {...common} field="telefono" label="Teléfono" icon="fas fa-phone" type="tel" inputMode="tel" value={form.telefono} error={errores.telefono} placeholder="+51 000 000 000" autoComplete="tel" />
                  <ContactField {...common} field="asunto" label="Asunto" icon="fas fa-tag" value={form.asunto} error={errores.asunto} placeholder="Motivo de tu consulta" autoComplete="off" />
                </div>
                <ContactField {...common} field="mensaje" label="Mensaje" multiline value={form.mensaje} error={errores.mensaje} placeholder="Cuéntanos más sobre tu consulta o proyecto" autoComplete="off" />
                <button type="submit" className="home-button ct-submit" aria-disabled={sending}>
                  {sending
                    ? <><span className="ct-spinner" aria-hidden="true" /> Enviando…</>
                    : <><i className="fas fa-paper-plane" aria-hidden="true" /> Enviar mensaje</>}
                </button>
              </form>
            </div>
          </div>

          <div className="ct-info-col">
            <h3 className="ct-col-title fade-up">Contacto directo</h3>
            <ul className="ct-channels">
              <li className="fade-up">
                <a className="ct-channel" href={'tel:' + phone.replace(/[^+\d]/g, '')}>
                  <span className="ct-channel-icon" aria-hidden="true"><i className="fas fa-phone" /></span>
                  <span className="ct-channel-text"><span className="ct-channel-label">Teléfono</span><span className="ct-channel-value">{phone}</span></span>
                  <i className="fas fa-chevron-right ct-channel-arrow" aria-hidden="true" />
                </a>
              </li>
              <li className="fade-up">
                <a className="ct-channel" href={whatsapp} target="_blank" rel="noreferrer">
                  <span className="ct-channel-icon" aria-hidden="true"><i className="fab fa-whatsapp" /></span>
                  <span className="ct-channel-text"><span className="ct-channel-label">WhatsApp</span><span className="ct-channel-value">Escríbenos por WhatsApp<span className="tech-sr"> (se abre en una pestaña nueva)</span></span></span>
                  <i className="fas fa-chevron-right ct-channel-arrow" aria-hidden="true" />
                </a>
              </li>
              <li className="fade-up">
                <a className="ct-channel" href={'mailto:' + email}>
                  <span className="ct-channel-icon" aria-hidden="true"><i className="fas fa-envelope" /></span>
                  <span className="ct-channel-text"><span className="ct-channel-label">Correo electrónico</span><span className="ct-channel-value">{email}</span></span>
                  <i className="fas fa-chevron-right ct-channel-arrow" aria-hidden="true" />
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section className="tech-section is-dark ct-location" id="ubicacion" aria-labelledby="ct-location-title">
      <div className="container">
        <SectionHead id="ct-location-title" dark eyebrow="Ubicación" title="Dónde estamos">
          Consulta nuestra dirección y horario de atención.
        </SectionHead>
        <div className="ct-location-grid">
          <div className="ct-place">
            <div className="ct-place-card fade-up">
              <span className="tech-icon" aria-hidden="true"><i className="fas fa-location-dot" /></span>
              <div><h3>Dirección</h3><p>{address}</p></div>
            </div>
            <div className="ct-place-card fade-up">
              <span className="tech-icon" aria-hidden="true"><i className="fas fa-clock" /></span>
              <div><h3>Horario de atención</h3><p className="ct-hours">{hours}</p></div>
            </div>
            <a className="home-button ct-directions fade-up" href={MAP_DIRECTIONS_URL} target="_blank" rel="noreferrer">
              <i className="fas fa-diamond-turn-right" aria-hidden="true" /> Cómo llegar<span className="tech-sr"> (se abre en una pestaña nueva)</span>
            </a>
          </div>
          <div className="ct-map fade-up"><LocationMap /></div>
        </div>
      </div>
    </section>
  </>
}
