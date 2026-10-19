// Inventario para una importación manual; ninguna consulta o arranque lo utiliza.
export const initialConvenios = [
  {
    "origen_local": "corlad",
    "sigla": "CORLAD",
    "nombre": "Colegio de Administradores",
    "descripcion_corta": "Alianza para el desarrollo profesional de administradores con capacitaciones especializadas.",
    "logoFile": "frontend/src/assets/images/logos/logo-convenio-administracion.jpg",
    "descripcion_completa": "",
    "informacion_adicional": "",
    "orden": 1,
    "visible": true
  },
  {
    "origen_local": "cec",
    "sigla": "CEC",
    "nombre": "Colegio de Economistas",
    "descripcion_corta": "Convenio para la formación continua de economistas con certificaciones en gestión económica.",
    "logoFile": "frontend/src/assets/images/logos/logo-convenio-economistas.jpg",
    "descripcion_completa": "",
    "informacion_adicional": "",
    "orden": 2,
    "visible": true
  },
  {
    "origen_local": "cep-cr-xiii",
    "sigla": "CEP/CR XIII",
    "nombre": "Colegio de Enfermeros - Cajamarca",
    "descripcion_corta": "Alianza para capacitaciones en salud y gestión hospitalaria para el personal de enfermería.",
    "logoFile": "frontend/src/assets/images/logos/logo-convenio-enfermeros.png",
    "descripcion_completa": "",
    "informacion_adicional": "",
    "orden": 3,
    "visible": true
  },
  {
    "origen_local": "cep-cr-ii",
    "sigla": "CEP/CR II",
    "nombre": "Colegio de Enfermeros - La Libertad",
    "descripcion_corta": "Alianza para capacitaciones en salud y gestión hospitalaria para el personal de enfermería.",
    "logoFile": "frontend/src/assets/images/logos/logo-convenio-enfermeros.png",
    "descripcion_completa": "",
    "informacion_adicional": "",
    "orden": 4,
    "visible": true
  },
  {
    "origen_local": "isam",
    "sigla": "ISAM",
    "nombre": "Instituto ISAM",
    "descripcion_corta": "Alianza educativa con el ISAM para programas de formación y certificaciones de alto nivel.",
    "logoFile": "frontend/src/assets/images/logos/logo-convenio-isam.png",
    "descripcion_completa": "",
    "informacion_adicional": "",
    "orden": 5,
    "visible": true
  }
] as const;
