import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import AcademicSelect from './AcademicSelect';

// El selector permanece montado al plegarse: conserva consulta, página y respuestas protegidas.
export default function EnrollmentPicker<T extends { id: number }>({ label, title = label, value, onChange, summary, error, disabled, ...selector }: {
  label: string; title?: string; value: T | null; onChange: (value: T | null) => void;
  summary: ReactNode; error?: string; disabled: boolean; path: string;
  text: (item: T) => string; unavailable?: (item: T) => boolean;
}) {
  const id = useId(), root = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(true);
  const open = !value || expanded;
  const pendingFocus = useRef<'search' | 'toggle' | null>(null);
  const focusSearch = () => root.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  useLayoutEffect(() => {
    if (pendingFocus.current === 'toggle') toggle.current?.focus({ preventScroll: true });
    else if (pendingFocus.current === 'search') focusSearch();
    pendingFocus.current = null;
  });
  const collapse = () => { pendingFocus.current = 'toggle'; setExpanded(false); };
  return <section ref={root} className="hme-selection" data-enrollment-picker={label} role="group" aria-labelledby={id + '-title'} aria-invalid={!!error} aria-describedby={error ? id + '-error' : undefined}
    onKeyDown={event => {
      if (event.key === 'Escape' && open && value) { event.preventDefault(); event.stopPropagation(); collapse(); }
    }}>
    <div className="hme-summary">
      <div className="hme-selection-heading"><h3 id={id + '-title'}>{title}</h3>
        <button ref={toggle} type="button" className="hp-btn" disabled={disabled} aria-expanded={open} aria-controls={id + '-picker'}
          aria-label={(open && value ? 'Conservar' : value ? 'Cambiar' : 'Buscar') + ' ' + label.toLowerCase()}
          onClick={() => { if (open && value) collapse(); else if (open) focusSearch(); else { pendingFocus.current = 'search'; setExpanded(true); } }}>
          {open && value ? 'Conservar selección' : value ? 'Cambiar' : 'Buscar'}
        </button>
      </div>
      {value ? summary : <p className="hme-muted">Selecciona {label === 'Estudiante' ? 'un estudiante existente.' : 'una edición abierta con cupos.'}</p>}
      {error && <p id={id + '-error'} className="hme-field-error">{error}</p>}
    </div>
    <div id={id + '-picker'} className="hme-picker" hidden={!open}>
      <AcademicSelect<T> {...selector} label={label} value={value} disabled={disabled} errorId={error ? id + '-error' : undefined} onChange={next => {
        onChange(next);
        if (next) collapse();
      }} />
      {open && <p className="hme-muted">{value ? 'La selección actual se conserva hasta elegir otra opción.' : 'Busca por ' + (label === 'Estudiante' ? 'nombre, apellidos o DNI.' : 'curso o edición.')}</p>}
    </div>
    <p className="hp-sr hme-announcement" role="status">{value && !open ? label + ' seleccionado: buscador plegado.' : ''}</p>
  </section>;
}
