import type { ReactNode } from 'react'

// Etiqueta + control + ayuda/error de un campo del Libro. El control se pasa como hijo y lleva su propio
// aria-describedby (ver LibroForm): aquí solo se dibuja el marco y el mensaje de error junto al campo.
export default function LibroField({ id, label, required = false, optional = false, error, full = false, hint, children }: {
  id: string; label: string; required?: boolean; optional?: boolean; error?: string; full?: boolean; hint?: ReactNode; children: ReactNode
}) {
  return <div className={'lb-field' + (full ? ' is-full' : '')}>
    <label htmlFor={id}>
      {label}
      {required && <span className="lb-req" aria-hidden="true"> *</span>}
      {optional && <span className="lb-opt"> (opcional)</span>}
    </label>
    {children}
    {hint}
    {error && <p id={id + '-error'} className="lb-error"><i className="fas fa-exclamation-circle" aria-hidden="true" /> <span>{error}</span></p>}
  </div>
}
