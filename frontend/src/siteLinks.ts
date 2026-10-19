// Links shared by the whole website. Social links live in the panel (CompanySettings, see hooks/useSocialLinks.ts);
// the only global fallback is the WhatsApp short link below, used while the panel number is empty or invalid.
// It carries the preset message ("Hola, quisiera que me brinde información sobre lo que están ofreciendo en este mes.").
const WHATSAPP_FALLBACK_URL = 'https://wa.link/m8o5hw'

// WhatsApp link built from the number saved in the panel (setting "whatsapp"); the panel stays the main source.
export const whatsappHref = (panelNumber: string) => {
  const digits = panelNumber.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15 ? 'https://wa.me/' + digits : WHATSAPP_FALLBACK_URL
}

// Single reference for the business location, shared by Home and Contactos. The embedded map and the "Cómo llegar"
// link point to the same place (same Google feature id and coordinates), so they cannot drift apart.
const MAP_PLACE = { name: 'Plazuela Bolognesi', lat: -7.1637652, lng: -78.5107197, featureId: '0x91b25b809bf9b7e3:0x70d5a58b14aa7eff' }
export const MAP_EMBED_URL = 'https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d989.6682159535815!2d-78.5107197!3d-7.1637652!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x91b25b809bf9b7e3%3A0x70d5a58b14aa7eff!2sPlazuela%20Bolognesi!5e0!3m2!1ses-419!2spe!4v1772667902105!5m2!1ses-419!2spe'
export const MAP_DIRECTIONS_URL = 'https://www.google.com/maps/dir//' + encodeURIComponent(MAP_PLACE.name) + '/@' + MAP_PLACE.lat + ',' + MAP_PLACE.lng + ',17z'
  + '/data=!4m8!4m7!1m0!1m5!1m1!1s' + MAP_PLACE.featureId + '!2m2!1d' + MAP_PLACE.lng + '!2d' + MAP_PLACE.lat
