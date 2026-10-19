import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, SubmitEvent } from 'react'
import { Link } from 'react-router-dom'
import { publicRequest } from '../../api'
import LibroField from './LibroField'
import {
  AREAS, FIELD_LABELS, FIELD_ORDER, INITIAL, LIMITS, SUBMIT_TIMEOUT_MS, TIPOS_DOC, TIPOS_REGISTRO,
  describeSubmitError, fieldId, limaToday, toConstancia, toPayload, validate,
} from './libroModel'
import type { Constancia, FormData, FormErrors, FormField } from './libroModel'

type SavedResponse = { ok: boolean; mensaje?: string; numero_reclamo?: string; correo_enviado?: boolean }
export type Registered = { numero: string; mailSent: boolean; constancia: Constancia }

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Formulario completo en una sola página, en 4 secciones (fieldset): el contrato del POST es el de siempre (toPayload).
export default function LibroForm({ empresa, onRegistered }: { empresa: string; onRegistered: (result: Registered) => void }) {
  const [form, setForm] = useState<FormData>(INITIAL)
  const [errores, setErrores] = useState<FormErrors>({})
  const [serverError, setServerError] = useState('')
  const [sending, setSending] = useState(false)
  // El ref es el candado real contra el doble envío: el estado puede estar desfasado si llegan dos submit en el mismo tick.
  const sendingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const alertRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; abortRef.current?.abort() }
  }, [])
  // Un error del servidor se anuncia y se acerca a la vista: el botón puede estar lejos del mensaje en móvil.
  useEffect(() => {
    if (!serverError) return
    const element = alertRef.current
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [serverError])

  const today = limaToday()
  const errorList = FIELD_ORDER.filter(field => errores[field])

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    if (sending) return // durante el envío los controles no cambian (selects, radios y casillas no admiten readOnly)
    const target = event.target
    const field = target.name as FormField
    const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value
    setForm(previous => ({ ...previous, [field]: value }))
    setErrores(previous => {
      if (!previous[field] && !(field === 'tipoDoc' && previous.numDoc)) return previous
      const next = { ...previous }
      delete next[field]
      if (field === 'tipoDoc') delete next.numDoc // el número se vuelve a revisar con las reglas del nuevo tipo
      return next
    })
  }

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sendingRef.current) return
    const found = validate(form, today)
    const first = FIELD_ORDER.find(field => found[field])
    if (first) {
      setErrores(found); setServerError('')
      document.getElementById(fieldId(first))?.focus()
      return
    }
    sendingRef.current = true
    setSending(true); setErrores({}); setServerError('')
    const controller = new AbortController()
    abortRef.current = controller
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, SUBMIT_TIMEOUT_MS)
    try {
      const response = await publicRequest<SavedResponse>('reclamaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload(form)), signal: controller.signal,
      })
      if (!alive.current) return
      onRegistered({ numero: response.numero_reclamo || '', mailSent: response.correo_enviado === true, constancia: toConstancia(form) })
    } catch (error) {
      if (!alive.current) return
      const { text, fields } = describeSubmitError(error, timedOut)
      const mapped = FIELD_ORDER.find(field => fields[field])
      setErrores(fields)
      if (mapped) document.getElementById(fieldId(mapped))?.focus()
      else setServerError(text)
    } finally {
      window.clearTimeout(timer)
      sendingRef.current = false
      abortRef.current = null
      if (alive.current) setSending(false)
    }
  }

  const describedBy = (field: FormField, extra?: string) => [extra, errores[field] ? fieldId(field) + '-error' : ''].filter(Boolean).join(' ') || undefined
  const control = (field: FormField, extra?: string) => ({
    id: fieldId(field), name: field, onChange: handleChange, required: true,
    'aria-invalid': errores[field] ? true : undefined, 'aria-describedby': describedBy(field, extra),
  })
  const text = (field: 'nombres' | 'apellidos' | 'email' | 'telefono' | 'numDoc' | 'direccion') => ({ ...control(field), value: form[field], readOnly: sending })
  const numericDoc = form.tipoDoc === 'dni' || form.tipoDoc === 'ruc'

  return <form className="lb-form" onSubmit={handleSubmit} noValidate aria-busy={sending}>
    <p className="lb-required-note">Los campos marcados con <span aria-hidden="true">*</span><span className="tech-sr">asterisco</span> son obligatorios.</p>

    {errorList.length > 1 && <div className="lb-summary" role="alert">
      <p>Revisa estos campos:</p>
      <ul>{errorList.map(field => <li key={field}>
        <a href={'#' + fieldId(field)} onClick={event => { event.preventDefault(); document.getElementById(fieldId(field))?.focus() }}>{FIELD_LABELS[field]}</a>: {errores[field]}
      </li>)}</ul>
    </div>}

    <fieldset className="lb-section">
      <legend><span className="lb-num" aria-hidden="true">1</span>Datos del consumidor</legend>
      <p className="lb-section-note">Ingresa tu información personal para poder contactarte.</p>
      <div className="lb-grid">
        <LibroField id="lb-nombres" label="Nombres" required error={errores.nombres}>
          <input {...text('nombres')} type="text" maxLength={LIMITS.nombres} autoComplete="given-name" placeholder="Tus nombres" />
        </LibroField>
        <LibroField id="lb-apellidos" label="Apellidos" required error={errores.apellidos}>
          <input {...text('apellidos')} type="text" maxLength={LIMITS.apellidos} autoComplete="family-name" placeholder="Tus apellidos" />
        </LibroField>
        <LibroField id="lb-tipoDoc" label="Tipo de documento" required error={errores.tipoDoc}>
          <select {...control('tipoDoc')} value={form.tipoDoc} autoComplete="off">
            <option value="">Selecciona tipo</option>
            {TIPOS_DOC.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </LibroField>
        <LibroField id="lb-numDoc" label="Número de documento" required error={errores.numDoc}>
          <input {...text('numDoc')} type="text" maxLength={LIMITS.numDoc} inputMode={numericDoc ? 'numeric' : 'text'} autoComplete="off" placeholder="Ej: 12345678" />
        </LibroField>
        <LibroField id="lb-email" label="Correo electrónico" required error={errores.email}>
          <input {...text('email')} type="email" maxLength={LIMITS.email} inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="correo@ejemplo.com" />
        </LibroField>
        <LibroField id="lb-telefono" label="Teléfono" required error={errores.telefono}>
          <input {...text('telefono')} type="tel" maxLength={LIMITS.telefono} inputMode="tel" autoComplete="tel" placeholder="987654321" />
        </LibroField>
        <LibroField id="lb-direccion" label="Dirección" optional full error={errores.direccion}>
          <input {...text('direccion')} required={false} type="text" maxLength={LIMITS.direccion} autoComplete="street-address" placeholder="Calle, número, distrito, ciudad" />
        </LibroField>
      </div>
    </fieldset>

    <fieldset className="lb-section">
      <legend><span className="lb-num" aria-hidden="true">2</span>Reclamo o queja</legend>
      <fieldset className="lb-radios" aria-describedby={errores.tipoRegistro ? 'lb-tipoRegistro-error' : undefined}>
        <legend>Tipo de registro<span className="lb-req" aria-hidden="true"> *</span></legend>
        <div className="lb-radio-list">
          {TIPOS_REGISTRO.map(item => <label key={item.value} className={'lb-radio' + (form.tipoRegistro === item.value ? ' is-selected' : '')}>
            <input type="radio" id={'lb-tipoRegistro-' + item.value} name="tipoRegistro" value={item.value} checked={form.tipoRegistro === item.value}
              onChange={handleChange} required aria-invalid={errores.tipoRegistro ? true : undefined} aria-describedby={'lb-tipoRegistro-' + item.value + '-desc'} />
            <span className="lb-radio-text"><strong>{item.label}</strong><span id={'lb-tipoRegistro-' + item.value + '-desc'}>{item.desc}</span></span>
          </label>)}
        </div>
        {errores.tipoRegistro && <p id="lb-tipoRegistro-error" className="lb-error"><i className="fas fa-exclamation-circle" aria-hidden="true" /> <span>{errores.tipoRegistro}</span></p>}
      </fieldset>
      <div className="lb-grid">
        <LibroField id="lb-area" label="Área / Servicio" required error={errores.area}>
          <select {...control('area')} value={form.area} autoComplete="off">
            <option value="">Selecciona área</option>
            {AREAS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </LibroField>
        <LibroField id="lb-fechaIncidente" label="Fecha del incidente" required error={errores.fechaIncidente}>
          <input {...control('fechaIncidente')} type="date" value={form.fechaIncidente} max={today} readOnly={sending} autoComplete="off" />
        </LibroField>
      </div>
    </fieldset>

    <fieldset className="lb-section">
      <legend><span className="lb-num" aria-hidden="true">3</span>Detalle</legend>
      <p className="lb-section-note">Describe con precisión lo ocurrido.</p>
      <div className="lb-grid">
        <LibroField id="lb-descripcionBien" label="Descripción del Bien / Servicio" required full error={errores.descripcionBien}
          hint={<small id="lb-descripcionBien-count" className="lb-counter">{form.descripcionBien.length} / {LIMITS.texto}</small>}>
          <textarea {...control('descripcionBien', 'lb-descripcionBien-count')} value={form.descripcionBien} readOnly={sending} rows={3} maxLength={LIMITS.texto} autoComplete="off" placeholder="Describe el producto o servicio adquirido..." />
        </LibroField>
        <LibroField id="lb-detalleReclamo" label="Detalle del Reclamo / Queja" required full error={errores.detalleReclamo}
          hint={<small id="lb-detalleReclamo-count" className="lb-counter">{form.detalleReclamo.length} / {LIMITS.texto}</small>}>
          <textarea {...control('detalleReclamo', 'lb-detalleReclamo-count')} value={form.detalleReclamo} readOnly={sending} rows={6} maxLength={LIMITS.texto} autoComplete="off" placeholder="Describe detalladamente lo ocurrido..." />
        </LibroField>
      </div>
    </fieldset>

    <fieldset className="lb-section">
      <legend><span className="lb-num" aria-hidden="true">4</span>Consentimiento y envío</legend>
      <div className="lb-consent">
        <div className="lb-check">
          <input type="checkbox" id="lb-aceptaTerminos" name="aceptaTerminos" checked={form.aceptaTerminos} onChange={handleChange} required
            aria-invalid={errores.aceptaTerminos ? true : undefined} aria-describedby={errores.aceptaTerminos ? 'lb-aceptaTerminos-error' : undefined} />
          <label htmlFor="lb-aceptaTerminos">Declaro que la información es verídica y acepto que {empresa} procese mis datos conforme a su <Link to="/politicas/privacidad" target="_blank" rel="noopener noreferrer">Política de Privacidad<span className="tech-sr"> (se abre en una pestaña nueva)</span></Link>. <span className="lb-req" aria-hidden="true">*</span></label>
        </div>
        {errores.aceptaTerminos && <p id="lb-aceptaTerminos-error" className="lb-error"><i className="fas fa-exclamation-circle" aria-hidden="true" /> <span>{errores.aceptaTerminos}</span></p>}
        <div className="lb-check">
          <input type="checkbox" id="lb-aceptaComunicaciones" name="aceptaComunicaciones" checked={form.aceptaComunicaciones} onChange={handleChange} aria-describedby="lb-aceptaComunicaciones-opt" />
          <label htmlFor="lb-aceptaComunicaciones">Acepto recibir comunicaciones sobre el seguimiento de mi reclamo por correo electrónico.</label>
          <span id="lb-aceptaComunicaciones-opt" className="lb-opt-tag">Opcional</span>
        </div>
      </div>

      {serverError && <div ref={alertRef} tabIndex={-1} className="lb-alert" role="alert">
        <i className="fas fa-exclamation-circle" aria-hidden="true" /> <span>{serverError}</span>
      </div>}

      <div className="lb-actions">
        <button type="submit" className="home-button lb-submit" aria-disabled={sending}>
          {sending
            ? <><span className="lb-spinner" aria-hidden="true" /> Enviando…</>
            : <><i className="fas fa-paper-plane" aria-hidden="true" /> Enviar Reclamo</>}
        </button>
      </div>
    </fieldset>
  </form>
}
