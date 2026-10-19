// Category as typed in the panel ("pagos-y-facturacion", "general") shown in a readable way. The raw value is still what
// the API receives when filtering.
export const categoryLabel = (value: string) => {
  const text = value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

// Blank lines start a new paragraph; single line breaks are kept by the stylesheet (white-space: pre-line).
export const paragraphs = (text: string) => text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
