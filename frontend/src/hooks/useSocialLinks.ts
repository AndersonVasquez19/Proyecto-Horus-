import { useCompanySetting } from '../context/companySettings'
import { whatsappHref } from '../siteLinks'

// Social and messaging links shown on the public site: WhatsApp, Facebook and Instagram. The panel (CompanySettings) is
// the only source: an empty or invalid URL returns '' so the caller hides that link. WhatsApp always resolves, using the
// global fallback. linkedin_url stays in the panel and in CompanySettings but is not exposed while LinkedIn is not shown.
export default function useSocialLinks() {
  const setting = useCompanySetting()
  const url = (key: string) => {
    const value = setting(key, '')
    return /^https?:\/\//i.test(value) ? value : ''
  }
  return {
    whatsapp: whatsappHref(setting('whatsapp', '')),
    facebook: url('facebook_url'),
    instagram: url('instagram_url'),
  }
}
