// Presentation-only text helpers. They never change what the panel stored, only how it is displayed.
const CONNECTORS = new Set(['de', 'del', 'la', 'el', 'las', 'los', 'y', 'e', 'o', 'u', 'en', 'con', 'por', 'para', 'a', 'al'])

const isShouting = (text: string) => {
  const letters = text.replace(/[^\p{L}]/gu, '')
  return letters.length > 3 && text === text.toUpperCase() && text !== text.toLowerCase()
}

// "CÁMARAS DE 360°" -> "Cámaras de 360°"; text that is not entirely uppercase is returned untouched.
export function displayTitle(text: string) {
  const clean = text.trim()
  if (!isShouting(clean)) return clean
  let first = true
  return clean.toLowerCase().replace(/\p{L}+/gu, word => {
    const connector = CONNECTORS.has(word) && !first
    const acronym = word.length <= 2 && !CONNECTORS.has(word)
    first = false
    return connector ? word : acronym ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)
  })
}

const sentenceCase = (text: string) => isShouting(text) ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : text

// One feature per line. Leftover list markers ("- ") are dropped and bullets that were pasted on the same
// line ("...oficinas.- - Preparación...") are separated again.
export function featureLines(value?: string | null) {
  return (value ?? '')
    .replace(/([.;!?])\s*[-–•]\s*(?:[-–•]\s*)?(?=\S)/gu, '$1\n')
    .split('\n')
    .map(line => line.replace(/^\s*[-–•*]+\s*/, '').trim())
    .filter(Boolean)
    .map(sentenceCase)
}

// "Conectividad de red: Se conectan..." -> label + text, only when the label is short enough to be a label.
export function splitLabel(line: string): [string, string] | null {
  const match = /^([^:]{3,60}):\s+(\S[\s\S]*)$/.exec(line)
  return match ? [match[1].trim(), match[2].trim()] : null
}

export const isShortList = (lines: string[]) => lines.length > 0 && lines.every(line => line.length <= 34 && !splitLabel(line))
