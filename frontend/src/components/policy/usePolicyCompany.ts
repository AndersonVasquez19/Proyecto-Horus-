import { useCompanySetting } from '../../context/companySettings'

// Datos de la empresa que las tres políticas muestran. Vienen de CompanySettings; si la API falla o el valor está
// vacío se usa el valor actual, de modo que el texto visible no cambia. La dirección, el horario y el WhatsApp de las
// políticas siguen escritos en cada página a propósito (ver las marcas REVISIÓN-HUMANA).
export const POLICY_COMPANY_FALLBACK = { empresa: 'Horus Group SRL', correo: 'horusgroupcajamarca@gmail.com' }

export function usePolicyCompany() {
  const setting = useCompanySetting()
  return {
    empresa: setting('empresa_nombre', POLICY_COMPANY_FALLBACK.empresa),
    correo: setting('email_contacto', POLICY_COMPANY_FALLBACK.correo),
  }
}
