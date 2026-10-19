// Comparación a tres bandas del seguimiento de atención. Sin importaciones y sin sintaxis no "borrable" para probarlo con `node --test`.
//
// Contrato del backend (PUT /admin/seguimiento/:recurso/:id): reemplaza LOS CUATRO campos y solo acepta la petición si `revision` coincide con la
// actual (si no, 409). Por eso fusionar en el cliente es seguro únicamente si (1) se decide contra una versión FRESCA del servidor y (2) se guarda con
// la revisión de esa versión fresca: si otra persona guarda entre medias, el servidor vuelve a rechazar con 409 y no se pisa nada.
export const ATTENTION_FIELDS = ['estado', 'responsable', 'notas', 'respuesta'] as const
export type AttentionField = typeof ATTENTION_FIELDS[number]
export type AttentionValues = Record<AttentionField, string>

export const FIELD_LABELS: Record<AttentionField, string> = { estado: 'Estado', responsable: 'Responsable', notas: 'Notas internas', respuesta: 'Respuesta al cliente' }

// base: última versión del servidor aceptada como punto de partida. local: borrador. remote: versión más reciente del servidor.
//  - sin cambios locales               -> se toma el valor remoto (también si no cambió);
//  - solo cambió el borrador           -> se conserva el borrador;
//  - cambiaron ambos al MISMO valor    -> no hay conflicto;
//  - cambiaron ambos a valores distintos -> CONFLICTO: se conserva el borrador a la espera de que la persona elija; nunca se decide en silencio.
export function reconcile(base: AttentionValues, local: AttentionValues, remote: AttentionValues): { merged: AttentionValues; conflicts: AttentionField[]; remoteOnly: AttentionField[] } {
  const merged = { ...local }
  const conflicts: AttentionField[] = []
  const remoteOnly: AttentionField[] = []
  for (const key of ATTENTION_FIELDS) {
    const localChanged = local[key] !== base[key]
    const remoteChanged = remote[key] !== base[key]
    if (!localChanged) { merged[key] = remote[key]; if (remoteChanged) remoteOnly.push(key) }
    else if (!remoteChanged || local[key] === remote[key]) merged[key] = local[key]
    else conflicts.push(key)
  }
  return { merged, conflicts, remoteOnly }
}

// El seguimiento fresco solo puede reemplazar a la base si no es más antiguo que ella (una respuesta que llega fuera de orden se descarta).
export const isOlderThan = (fresh: { revision: number }, base: { revision: number }) => fresh.revision < base.revision

export const valuesOf = (item: AttentionValues): AttentionValues => ({ estado: item.estado, responsable: item.responsable, notas: item.notas, respuesta: item.respuesta })
