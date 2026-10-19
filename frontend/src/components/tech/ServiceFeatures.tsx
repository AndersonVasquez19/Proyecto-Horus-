import { featureLines, isShortList, splitLabel } from './text'

// Short features become chips; long ones a list (with the "Label:" part emphasised). Nothing is dropped.
export default function ServiceFeatures({ value, label }: { value?: string | null; label: string }) {
  const lines = featureLines(value)
  if (!lines.length) return null
  if (isShortList(lines)) return <ul className="tech-chips" aria-label={label}>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
  return <ul className="tech-list" aria-label={label}>{lines.map((line, index) => {
    const parts = splitLabel(line)
    return <li key={index}>{parts ? <><strong>{parts[0]}:</strong> {parts[1]}</> : line}</li>
  })}</ul>
}
