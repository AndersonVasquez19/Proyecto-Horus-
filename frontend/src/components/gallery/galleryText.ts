// Nombres legibles de las categorías conocidas de la galería; cualquier otra se muestra a partir de su clave.
const categoryNames: Record<string, string> = {
  capacitaciones: 'Capacitaciones',
  'servicio-tecnico': 'Servicio Técnico',
  'colegio-enfermeros': 'Colegio Enfermeros',
  'colegio-abogados': 'Colegio Abogados',
  isam: 'ISAM',
  'primeros-auxilios': 'Primeros Auxilios',
}

export const categoryLabel = (key: string) => categoryNames[key] || key.replace(/-/g, ' ')
