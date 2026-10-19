// Lectura de listas y exportación CSV de las tablas del panel. Sin importaciones y sin sintaxis no "borrable" para probarlo con `node --test`.

// Cada recurso entrega sus registros bajo su propia clave: Mensajes responde { messages, pagination, metrics }; los demás, { items, pagination }.
// La adaptación es explícita por recurso (no se mezclan claves de otros recursos). Para Mensajes, una respuesta sin la lista `messages` NO se
// toma por "lista vacía": es un formato inesperado y la tabla muestra el error de carga en vez de un vacío engañoso.
export function recordsOf<T>(endpoint: string, data: { items?: T[]; messages?: T[] } | null | undefined): T[] {
  if (endpoint === 'messages') {
    if (!Array.isArray(data?.messages)) throw new Error('El servidor devolvió una lista con un formato inesperado.')
    return data.messages
  }
  return data?.items || []
}

// Celda CSV: se neutralizan las fórmulas (=, +, -, @ o saltos al inicio) con un apóstrofo y se duplican las comillas.
export function csvCell(value: unknown): string {
  let text = String(value ?? '')
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}

export function buildCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  return '﻿' + [columns, ...rows.map(row => columns.map(key => row[key]))].map(line => line.map(csvCell).join(',')).join('\r\n')
}
