import { useId, type InputHTMLAttributes } from 'react';

// Campo pequeño: mantiene juntos etiqueta, ayuda y error, sin imponer validaciones.
export default function PanelInputField({ label, help, error, id: suppliedId, required, ...input }: InputHTMLAttributes<HTMLInputElement> & {
  label: string; help?: string; error?: string;
}) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  const describedBy = [input['aria-describedby'], help ? id + '-help' : '', error ? id + '-error' : ''].filter(Boolean).join(' ') || undefined;
  return <label className="hp-input-field" htmlFor={id}>
    <span id={id + '-label'} className="hp-field-label">{label}<span className="hp-field-status">{required ? 'Obligatorio' : 'Opcional'}</span></span>
    <input {...input} id={id} required={required} aria-labelledby={input['aria-labelledby'] || id + '-label'} aria-invalid={!!error || input['aria-invalid']} aria-describedby={describedBy} />
    {help && <small id={id + '-help'} className="hp-field-help">{help}</small>}
    {error && <small id={id + '-error'} className="hp-field-error">{error}</small>}
  </label>;
}
