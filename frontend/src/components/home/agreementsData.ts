import type { Convenio, ConvenioDetalle } from '../../types/convenios'

export type AgreementData = {
  id: number
  siglas: string
  nombre: string
  logoUrl: string | null
  descripcionConvenio: string
  vigencia: string | null
  beneficios: string[]
}

// Extrae una vista previa del texto publicado; el diálogo conserva el original íntegro.
export function agreementSummary(item: Convenio | ConvenioDetalle): string {
  const identity = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const short = item.descripcion_corta.trim()
  const shortIdentity = identity(short).replace(/^convenio (?:interinstitucional )?con (?:el |la )?/, '')
  const nameIdentity = identity(item.nombre)
  const repeatsName = !!nameIdentity && [nameIdentity, nameIdentity + ' ' + identity(item.sigla || '')].includes(shortIdentity)
  const full = 'descripcion_completa' in item ? item.descripcion_completa?.trim() : ''
  const text = ((repeatsName ? full || short : short || full) || '').replace(/\s+/g, ' ').trim()
  return text.length <= 120 ? text : text.slice(0, 119).replace(/\s+\S*$/, '').trimEnd() + '…'
}

// La presentación reutiliza el catálogo: no presume fechas, horas ni beneficios.
export function toAgreementData(item: Convenio | ConvenioDetalle): AgreementData {
  return {
    id: item.id,
    siglas: item.sigla || '',
    nombre: item.nombre,
    logoUrl: item.logo_url,
    descripcionConvenio: ('descripcion_completa' in item && item.descripcion_completa?.trim()) || item.descripcion_corta.trim(),
    vigencia: null,
    beneficios: [],
  }
}
