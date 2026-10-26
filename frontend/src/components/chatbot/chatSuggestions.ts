// Solo orientación pública. Las sugerencias nunca se envían sin activación explícita.
export const INITIAL_SUGGESTIONS = [
  '¿Qué capacitaciones ofrecen?',
  '¿Qué servicios tecnológicos brindan?',
  '¿Cómo puedo solicitar una cotización?',
  '¿Qué convenios tiene Horus?',
];

export function validSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [], seen = new Set<string>();
  for (const item of value.slice(0, 32)) {
    if (typeof item !== 'string') continue;
    const text = item.trim().replace(/\s+/g, ' ');
    // Descartar marcado, enlaces e identificadores potencialmente sensibles; no intentar redactarlos.
    if (!text || text.length > 160 || /[<>@]|https?:|www\.|\d[\d\s().+-]{5,}\d|\b(?:dni|contraseña|password|token|secreto|api[ _-]?key)\b|\p{Cc}|[\u202a-\u202e\u2066-\u2069]/iu.test(text)) continue;
    const key = text.normalize('NFC').toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key); result.push(text);
    if (result.length === 4) break;
  }
  return result;
}
