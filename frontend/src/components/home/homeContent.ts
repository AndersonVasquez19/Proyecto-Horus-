import slide0 from '../../assets/images/galeria/capacitaciones/imagen 1.jpg'
import slide1 from '../../assets/images/galeria/nuestro servicio tecnico/servicio-instalacion.jpg'
import slide2 from '../../assets/images/galeria/colegio de enfermeros/imagen 1.jpg'
import slide3 from '../../assets/images/galeria/practicas de primeros auxilios/imagen 1.jpg'


export { default as imgCableado } from '../../assets/images/tecnologias/cableado.jpg'
export const imgCapacitaciones = slide2

export const SLIDES = [
  { src: slide0, alt: 'Capacitaciones de Horus Group', label: 'Capacitación', position: '50% 45%' },
  { src: slide1, alt: 'Instalación de cámaras y servicio técnico', label: 'Servicio técnico', position: '32% 40%' },
  { src: slide2, alt: 'Actividades con el Colegio de Enfermeros', label: 'Formación profesional', position: '50% 50%' },
  { src: slide3, alt: 'Prácticas de primeros auxilios', label: 'Primeros auxilios', position: '50% 55%' },
]

export const WHY_CARDS = [
  { num: '01', icon: 'fa-medal', title: 'Experiencia comprobada',      desc: 'Más de 5 años brindando soluciones tecnológicas y educativas de calidad en Cajamarca, con cientos de clientes satisfechos.' },
  { num: '02', icon: 'fa-certificate', title: 'Certificaciones oficiales',   desc: 'Programas avalados por colegios profesionales reconocidos a nivel nacional.' },
  { num: '03', icon: 'fa-headset', title: 'Soporte permanente',          desc: 'Atención personalizada antes, durante y después de cada proyecto o programa.' },
  { num: '04', icon: 'fa-map-marker-alt', title: 'Presencia local en Cajamarca', desc: 'Somos cajamarquinos. Conocemos las necesidades de la región y trabajamos para su desarrollo.' },
]

export const METRICS = [
  { num: '5+', lbl: 'Años de experiencia', icon: 'fa-medal' },
  { num: '400+', lbl: 'Profesionales formados', icon: 'fa-user-graduate' },
  { num: '', lbl: 'Convenios activos', icon: 'fa-handshake' },
  { num: '98%', lbl: 'Satisfacción', icon: 'fa-star' },
]
