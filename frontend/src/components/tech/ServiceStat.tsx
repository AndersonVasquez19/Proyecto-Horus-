import type { ServicioPublico } from '../../types/public'

// Main figure (and its explanation) when the panel provides them; a lone explanation is shown as a spec pill.
export default function ServiceStat({ item }: { item: ServicioPublico }) {
  const main = item.dato_principal?.trim()
  const extra = item.dato_secundario?.trim()
  if (!main && !extra) return null
  return main
    ? <p className="tech-stat"><strong>{main}</strong>{extra && <span>{extra}</span>}</p>
    : <p className="tech-spec"><i className="fas fa-bolt" aria-hidden="true" />{extra}</p>
}
