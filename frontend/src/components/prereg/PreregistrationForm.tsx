import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, SubmitEvent } from 'react'
import { Link } from 'react-router-dom'
import { PublicApiError, publicRequest } from '../../api'
import LibroField from '../libro/LibroField'
import { EMPTY_FORM, FIELD_LABELS, FIELD_ORDER, LIMITS, SUBMIT_TIMEOUT_MS, describeSubmitError, editionFacts, toPayload, validate } from './preregModel'
import type { PreregEdition, PreregErrors, PreregField, PreregForm } from './preregModel'

const fieldId = (field: PreregField) => 'pr-' + field
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Formulario público. Un solo envío a la vez (candado en un ref), sin reintentos automáticos: un fallo sin respuesta puede haber guardado la
// solicitud, así que el mensaje lo dice y la persona decide. El servidor responde igual ante un duplicado, por eso repetir a propósito es seguro.
export default function PreregistrationForm({ editions, initialCode, empresa, onSent, onEditionClosed }: {
  editions: PreregEdition[]; initialCode: string; empresa: string; onSent: (message: string) => void; onEditionClosed: () => void
}) {
  const [form, setForm] = useState<PreregForm>(() => ({ ...EMPTY_FORM, convocatoria: editions.some(edition => edition.codigo === initialCode) ? initialCode : '' }))
  const [errors, setErrors] = useState<PreregErrors>({}), [serverError, setServerError] = useState(''), [sending, setSending] = useState(false)
  const sendingRef = useRef(false), abortRef = useRef<AbortController | null>(null), alive = useRef(true), alertRef = useRef<HTMLDivElement>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; abortRef.current?.abort() } }, [])
  useEffect(() => {
    if (!serverError) return
    alertRef.current?.focus({ preventScroll: true })
    alertRef.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [serverError])
  const selectedStillOffered = !form.convocatoria || editions.some(edition => edition.codigo === form.convocatoria)
  const invalidFields = FIELD_ORDER.filter(field => errors[field])

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    if (sending) return
    const { name, value, type, checked } = event.target
    const field = name as keyof PreregForm
    setForm(previous => ({ ...previous, [field]: type === 'checkbox' ? checked : value }))
    setErrors(previous => { if (!previous[field as PreregField]) return previous; const next = { ...previous }; delete next[field as PreregField]; return next })
  }
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sendingRef.current) return
    const found = validate(selectedStillOffered ? form : { ...form, convocatoria: '' }), first = FIELD_ORDER.find(field => found[field])
    if (first) { setErrors(found); setServerError(''); document.getElementById(fieldId(first))?.focus(); return }
    sendingRef.current = true; setSending(true); setErrors({}); setServerError('')
    const controller = new AbortController(); abortRef.current = controller
    let timedOut = false; const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, SUBMIT_TIMEOUT_MS)
    try {
      const response = await publicRequest<{ ok: boolean; mensaje?: string }>('preinscripciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload(form)), signal: controller.signal })
      if (alive.current) onSent(typeof response.mensaje === 'string' && response.mensaje ? response.mensaje : 'Recibimos tu preinscripción. El equipo de Horus la revisará.')
    } catch (error) {
      if (!alive.current) return
      const outcome = describeSubmitError(error instanceof PublicApiError ? error.status : undefined, timedOut)
      setServerError(outcome.text)
      if (outcome.reload) { setForm(previous => ({ ...previous, convocatoria: '' })); onEditionClosed() }
    } finally { window.clearTimeout(timer); sendingRef.current = false; abortRef.current = null; if (alive.current) setSending(false) }
  }
  const describedBy = (field: PreregField) => errors[field] ? fieldId(field) + '-error' : undefined
  const input = (field: 'nombres' | 'apellidos' | 'email' | 'telefono') => ({ id: fieldId(field), name: field, value: form[field], onChange: change, readOnly: sending, required: true, maxLength: LIMITS[field], 'aria-invalid': errors[field] ? true as const : undefined, 'aria-describedby': describedBy(field) })

  return <form className="lb-form pr-form" onSubmit={submit} noValidate aria-busy={sending} data-prereg-form>
    <p className="lb-required-note">Los campos marcados con <span aria-hidden="true">*</span><span className="tech-sr">asterisco</span> son obligatorios.</p>
    {invalidFields.length > 1 && <div className="lb-summary" role="alert"><p>Revisa estos campos:</p>
      <ul>{invalidFields.map(field => <li key={field}><a href={'#' + fieldId(field)} onClick={e => { e.preventDefault(); document.getElementById(fieldId(field))?.focus() }}>{FIELD_LABELS[field]}</a>: {errors[field]}</li>)}</ul></div>}

    <fieldset className="lb-section">
      <legend><span className="lb-num" aria-hidden="true">1</span>Elige la edición</legend>
      <p className="lb-section-note">Estas ediciones están recibiendo preinscripciones ahora. Preinscribirte no es una matrícula ni reserva una vacante.</p>
      <div className="pr-editions" role="radiogroup" aria-label="Ediciones disponibles" aria-describedby={describedBy('convocatoria')}>
        {editions.map(edition => <label key={edition.codigo} className={'pr-edition' + (form.convocatoria === edition.codigo ? ' is-selected' : '')}>
          <input type="radio" id={'pr-edition-' + edition.codigo} name="convocatoria" value={edition.codigo} checked={form.convocatoria === edition.codigo} onChange={change}
            required aria-invalid={errors.convocatoria ? true : undefined} {...(edition === editions[0] ? { id: fieldId('convocatoria') } : {})} />
          <span className="pr-edition-body"><strong>{edition.curso.titulo}</strong><span className="pr-edition-name">{edition.nombre}</span>
            <span className="pr-edition-facts">{editionFacts(edition).map(fact => <span key={fact}>{fact}</span>)}</span>
            <span className={'pr-edition-status' + (edition.apertura_confirmada ? ' is-open' : '')}>{edition.apertura_confirmada ? 'Apertura confirmada' : 'Apertura por confirmar'}</span></span>
        </label>)}
      </div>
      {errors.convocatoria && <p id={fieldId('convocatoria') + '-error'} className="lb-error"><i className="fas fa-exclamation-circle" aria-hidden="true" /> <span>{errors.convocatoria}</span></p>}
    </fieldset>

    <fieldset className="lb-section">
      <legend><span className="lb-num" aria-hidden="true">2</span>Tus datos</legend>
      <p className="lb-section-note">Solo te pedimos lo necesario para contactarte. No pedimos DNI, pagos ni comprobantes.</p>
      <div className="lb-grid">
        <LibroField id="pr-nombres" label="Nombres" required error={errors.nombres}><input {...input('nombres')} type="text" autoComplete="given-name" placeholder="Tus nombres" /></LibroField>
        <LibroField id="pr-apellidos" label="Apellidos" required error={errors.apellidos}><input {...input('apellidos')} type="text" autoComplete="family-name" placeholder="Tus apellidos" /></LibroField>
        <LibroField id="pr-email" label="Correo electrónico" required error={errors.email}><input {...input('email')} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="correo@ejemplo.com" /></LibroField>
        <LibroField id="pr-telefono" label="Teléfono" required error={errors.telefono}><input {...input('telefono')} type="tel" inputMode="tel" autoComplete="tel" placeholder="987654321" /></LibroField>
      </div>
      {/* Trampa para robots: fuera de la vista y del teclado; una persona nunca la rellena. */}
      <div className="pr-trap" aria-hidden="true"><label>Sitio web<input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={change} /></label></div>
    </fieldset>

    <fieldset className="lb-section">
      <legend><span className="lb-num" aria-hidden="true">3</span>Consentimiento y envío</legend>
      <div className="lb-consent"><div className="lb-check">
        <input type="checkbox" id={fieldId('consentimiento')} name="consentimiento" checked={form.consentimiento} onChange={change} required aria-invalid={errors.consentimiento ? true : undefined} aria-describedby={describedBy('consentimiento')} />
        <label htmlFor={fieldId('consentimiento')}>Acepto que {empresa} use mis datos para contactarme sobre esta preinscripción, conforme a su <Link to="/politicas/privacidad" target="_blank" rel="noopener noreferrer">Política de Privacidad<span className="tech-sr"> (se abre en una pestaña nueva)</span></Link>. <span className="lb-req" aria-hidden="true">*</span></label>
      </div>
        {errors.consentimiento && <p id={fieldId('consentimiento') + '-error'} className="lb-error"><i className="fas fa-exclamation-circle" aria-hidden="true" /> <span>{errors.consentimiento}</span></p>}</div>
      {serverError && <div ref={alertRef} tabIndex={-1} className="lb-alert" role="alert"><i className="fas fa-exclamation-circle" aria-hidden="true" /> <span>{serverError}</span></div>}
      <div className="lb-actions"><button type="submit" className="home-button lb-submit" aria-disabled={sending}>
        {sending ? <><span className="lb-spinner" aria-hidden="true" /> Enviando…</> : <><i className="fas fa-paper-plane" aria-hidden="true" /> Enviar preinscripción</>}</button></div>
    </fieldset>
  </form>
}
