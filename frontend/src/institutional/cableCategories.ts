import category1 from '../assets/images/tecnologias/categoria1.jpg'
import category2 from '../assets/images/tecnologias/categoria2.webp'
import category3 from '../assets/images/tecnologias/categoria3.webp'
import category4 from '../assets/images/tecnologias/categoria4.jpg'
import category5 from '../assets/images/tecnologias/categoria5.jpeg'
import category6 from '../assets/images/tecnologias/categoria6.jpg'

// Guía informativa de categorías. No son altas ni sustitutos de los servicios del catálogo.
export const cableCategories = [
  {
    number: '01', image: category1, application: 'Telefonía analógica',
    description: 'Diseñada para comunicaciones telefónicas analógicas. Su capacidad limitada no es adecuada para las redes de datos actuales.',
    spec: 'Transmisión de voz', icon: 'fa-phone', legacy: true,
  },
  {
    number: '02', image: category2, application: 'Primeras redes de datos',
    description: 'Utilizada en redes Token Ring de primera generación para transmitir voz y datos básicos en entornos de baja demanda.',
    spec: 'Hasta 4 Mbit/s', icon: 'fa-bolt', legacy: true,
  },
  {
    number: '03', image: category3, application: 'Ethernet 10BASE-T',
    description: 'Utilizada en instalaciones de voz y redes Ethernet de oficinas. Una de las primeras categorías estandarizadas para conectar equipos.',
    spec: 'Hasta 10 Mbit/s', icon: 'fa-bolt', legacy: true,
  },
  {
    number: '04', image: category4, application: 'Redes Token Ring',
    description: 'Ofreció mayor capacidad que sus predecesoras para redes Token Ring. Forma parte de la evolución del cableado en entornos corporativos.',
    spec: 'Hasta 16 Mbit/s', icon: 'fa-bolt', legacy: true,
  },
  {
    number: '05', image: category5, application: 'Fast Ethernet',
    description: 'Pensada para la transmisión de datos en redes Fast Ethernet. Su evolución, Cat 5e, amplió las posibilidades de las redes Gigabit.',
    spec: 'Hasta 100 Mbit/s', icon: 'fa-bolt', legacy: false,
  },
  {
    number: '06', image: category6, application: 'Redes de alto rendimiento',
    description: 'Una opción para redes empresariales, video y aplicaciones de alta demanda. La velocidad depende de la longitud y las condiciones de instalación.',
    spec: 'Hasta 10 Gbit/s*', icon: 'fa-bolt', legacy: false,
  },
] as const
