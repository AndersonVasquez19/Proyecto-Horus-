import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react'
import { Link } from 'react-router-dom'
import { publicRequest } from '../../api'
import { writeErrorMessage } from '../../publicErrors'

const SUBMIT_TIMEOUT_MS = 25_000 // igual que Contactos
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Reuses the public newsletter endpoint (explicit consent, signed unsubscribe link) with the interest "cursos".
export default function NotifyForm() {
  const id = useId()
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; consent?: string }>({})
  const locked = useRef(false) // candado síncrono: un segundo envío (doble clic, Enter repetido) no llega a crear otro POST
  const controller = useRef<AbortController | null>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const consentInput = useRef<HTMLInputElement>(null)
  const message = useRef<HTMLParagraphElement>(null)

  useEffect(() => () => controller.current?.abort(), [])
  // El mensaje (éxito o error) recibe el foco cuando aparece, para que teclado y lectores de pantalla lo encuentren.
  useEffect(() => { if (notice || error) message.current?.focus() }, [notice, error])

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current) return
    const address = email.trim()
    const problems: { email?: string; consent?: string } = {}
    if (!address) problems.email = 'Ingresa tu correo electrónico.'
    else if (address.length > 254 || !EMAIL_PATTERN.test(address)) problems.email = 'Ingresa un correo válido, por ejemplo nombre@dominio.com.'
    if (!consent) problems.consent = 'Debes autorizar el aviso para suscribirte.'
    setFieldErrors(problems); setError(''); setNotice('')
    if (problems.email || problems.consent) { (problems.email ? emailInput : consentInput).current?.focus(); return }

    locked.current = true; setBusy(true)
    const abort = new AbortController(); controller.current = abort
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; abort.abort() }, SUBMIT_TIMEOUT_MS)
    try {
      const result = await publicRequest<{ correo_enviado: boolean }>('newsletter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ email: address, interes: 'cursos', consentimiento: consent }),
      })
      setNotice(result.correo_enviado
        ? 'Listo. Te avisaremos cuando haya cursos. Revisa tu correo: incluye el enlace para darte de baja.'
        : 'Listo. Te avisaremos cuando haya cursos. El correo de confirmación no pudo enviarse; puedes pedir la baja desde Contactos.')
      setEmail(''); setConsent(false)
    } catch (caught) {
      if (abort.signal.aborted && !timedOut) return // desmontado: no hay nada que mostrar
      setError(writeErrorMessage(caught, timedOut)) // conserva correo y consentimiento; nunca el texto del servidor
    } finally {
      window.clearTimeout(timer); locked.current = false
      if (controller.current === abort) controller.current = null
      if (!abort.signal.aborted || timedOut) setBusy(false)
    }
  }

  const emailError = fieldErrors.email, consentError = fieldErrors.consent
  return <form className="edu-notify" onSubmit={submit} noValidate aria-labelledby={id + '-title'} aria-busy={busy}>
    <h3 id={id + '-title'}>Avísame cuando haya cursos</h3>
    <fieldset disabled={busy}>
      <label htmlFor={id + '-email'}>Correo electrónico</label>
      <input ref={emailInput} id={id + '-email'} type="email" autoComplete="email" required aria-required="true" maxLength={254} value={email}
        aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? id + '-email-error' : undefined}
        onChange={event => { setEmail(event.target.value); if (emailError) setFieldErrors(previous => ({ ...previous, email: undefined })) }} />
      {emailError && <p id={id + '-email-error'} className="edu-notify-error">{emailError}</p>}
      <label className="edu-notify-consent">
        <input ref={consentInput} type="checkbox" required aria-required="true" checked={consent}
          aria-invalid={consentError ? true : undefined} aria-describedby={consentError ? id + '-consent-error' : undefined}
          onChange={event => { setConsent(event.target.checked); if (consentError) setFieldErrors(previous => ({ ...previous, consent: undefined })) }} />
        <span>Autorizo recibir este aviso y he leído la <Link to="/politicas/privacidad">política de privacidad</Link>.</span>
      </label>
      {consentError && <p id={id + '-consent-error'} className="edu-notify-error">{consentError}</p>}
    </fieldset>
    <button className="home-button tech-btn" disabled={busy}>{busy ? 'Registrando…' : 'Avísame'}</button>
    {notice && <p ref={message} tabIndex={-1} className="edu-notify-ok" role="status">{notice}</p>}
    {error && <p ref={message} tabIndex={-1} className="edu-notify-error" role="alert">{error}</p>}
  </form>
}
