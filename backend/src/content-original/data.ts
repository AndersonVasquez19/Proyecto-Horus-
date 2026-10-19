// Contenido recuperado de las secciones originales del proyecto (fb2880b).
// Se importa solo por una acción explícita; las lecturas públicas nunca lo insertan.
import type { Prisma } from '@prisma/client';

export const originalServices: Prisma.ServicioCreateManyInput[] = [
  {
    "titulo": "Cableado Básico Cat 1-3",
    "slug": "original-cableado-basico-cat-1-3",
    "descripcion": "Ideal para instalaciones residenciales y pequeñas oficinas con necesidades de conectividad básica. Perfecto para telefonía, sistemas de alarma y redes de baja demanda.",
    "categoria": "cableado",
    "estado": "publicado",
    "presentacion": "cableado",
    "nombre_corto": "Cat 1-3 Básico",
    "destacado": "Instalación residencial",
    "dato_principal": "10",
    "dato_secundario": "Mbps máximos",
    "etiquetas": "Residencial\nTelefonía\nAlarmas\nBajo costo",
    "imagen_url": "/site-original/categoria1.jpg",
    "icono": "network",
    "color": "indigo",
    "orden": 1
  },
  {
    "titulo": "Cableado Empresarial Cat 5e / Cat 6",
    "slug": "original-cableado-empresarial-cat-5e-cat-6",
    "descripcion": "El estándar de la industria para oficinas y empresas medianas. Soporta Gigabit Ethernet con excelente relación costo-beneficio. Certificado para PoE y VoIP.",
    "categoria": "cableado",
    "estado": "publicado",
    "presentacion": "cableado",
    "nombre_corto": "Cat 5e-6 Empresarial",
    "destacado": "Estándar empresarial",
    "dato_principal": "1",
    "dato_secundario": "Gbps garantizados",
    "etiquetas": "Gigabit\nPoE\nVoIP\nOficinas",
    "imagen_url": "/site-original/categoria2.webp",
    "icono": "network",
    "color": "indigo",
    "orden": 2
  },
  {
    "titulo": "Alto Rendimiento Cat 6A / Cat 7",
    "slug": "original-alto-rendimiento-cat-6a-cat-7",
    "descripcion": "Para empresas que exigen lo mejor. Soporta 10 Gigabit Ethernet con blindaje total contra interferencias. Ideal para centros de datos, hospitales y entornos críticos.",
    "categoria": "cableado",
    "estado": "publicado",
    "presentacion": "cableado",
    "nombre_corto": "Cat 6A-7 Alto Rendimiento",
    "destacado": "Alto rendimiento",
    "dato_principal": "10",
    "dato_secundario": "Gbps de capacidad",
    "etiquetas": "10 Gbps\nBlindado\nData Center\nPoE++",
    "imagen_url": "/site-original/categoria3.webp",
    "icono": "network",
    "color": "indigo",
    "orden": 3
  },
  {
    "titulo": "Fibra Óptica — Velocidad de Luz",
    "slug": "original-fibra-optica-velocidad-de-luz",
    "descripcion": "La tecnología más avanzada para infraestructuras críticas. Inmune a interferencias electromagnéticas, con alcances de hasta 80 km sin repetidores. El futuro de las redes.",
    "categoria": "cableado",
    "estado": "publicado",
    "presentacion": "cableado",
    "nombre_corto": "Fibra Velocidad de Luz",
    "destacado": "Máxima velocidad",
    "dato_principal": "40",
    "dato_secundario": "Gbps y más",
    "etiquetas": "40+ Gbps\nLarga distancia\nSin EMI\nFuturo-proof",
    "imagen_url": "/site-original/categoria4.jpg",
    "icono": "network",
    "color": "indigo",
    "orden": 4
  },
  {
    "titulo": "Cámaras HD con Visión Nocturna",
    "slug": "original-camaras-hd-con-vision-nocturna",
    "descripcion": "Instalamos cámaras de alta definición que graban con total claridad de día y de noche, hasta 50 metros en oscuridad completa. Resistentes al agua y al polvo.",
    "categoria": "camaras",
    "estado": "publicado",
    "presentacion": "camara",
    "icono": "camera",
    "color": "indigo",
    "etiquetas": "Full HD 1080p\nVisión nocturna 50m\nIP66 resistente",
    "orden": 1
  },
  {
    "titulo": "Alertas al Instante en tu Celular",
    "slug": "original-alertas-al-instante-en-tu-celular",
    "descripcion": "Cuando la cámara detecta movimiento, recibes una notificación en tu teléfono en segundos. No necesitas estar mirando la pantalla — el sistema trabaja por ti.",
    "categoria": "camaras",
    "estado": "publicado",
    "presentacion": "alertas",
    "icono": "bell",
    "color": "coral",
    "etiquetas": "Detección por IA\nPush en segundos\niOS y Android",
    "orden": 2
  },
  {
    "titulo": "Grabación en la Nube 24/7",
    "slug": "original-grabacion-en-la-nube-24-7",
    "descripcion": "Todo queda grabado y guardado de forma segura en la nube. Puedes revisar lo que pasó hace 30 días desde tu celular o computadora, en cualquier momento.",
    "categoria": "camaras",
    "estado": "publicado",
    "presentacion": "nube",
    "icono": "cloud",
    "color": "verde",
    "etiquetas": "30 días de historial\nEncriptado AES-256\nAcceso global",
    "orden": 3
  },
  {
    "titulo": "Control Remoto desde tu App",
    "slug": "original-control-remoto-desde-tu-app",
    "descripcion": "Ve todas tus cámaras en vivo, mueve las cámaras PTZ, revisa grabaciones pasadas y gestiona alertas — todo desde la palma de tu mano, donde estés en el mundo.",
    "categoria": "camaras",
    "estado": "publicado",
    "presentacion": "app",
    "icono": "mobile",
    "color": "violeta",
    "etiquetas": "Vista en vivo\nControl PTZ\nMultidispositivo",
    "orden": 4
  },
  {
    "titulo": "Mantenimiento Preventivo",
    "slug": "original-mantenimiento-preventivo",
    "descripcion": "Revisiones periódicas programadas para mantener tu infraestructura en óptimas condiciones. Antes de que algo falle, ya lo revisamos.",
    "categoria": "soporte",
    "estado": "publicado",
    "presentacion": "mantenimiento",
    "icono": "tools",
    "color": "indigo",
    "etiquetas": "Mensual\nTrimestral\nHardware",
    "orden": 1
  },
  {
    "titulo": "Soporte de Software",
    "slug": "original-soporte-de-software",
    "descripcion": "Instalación, configuración y actualización de sistemas operativos, aplicaciones empresariales y software especializado. Errores resueltos.",
    "categoria": "soporte",
    "estado": "publicado",
    "presentacion": "software",
    "icono": "software",
    "color": "coral",
    "etiquetas": "Windows\nLinux\nAntivirus",
    "orden": 2
  },
  {
    "titulo": "Soporte de Redes",
    "slug": "original-soporte-de-redes",
    "descripcion": "Diagnóstico y resolución de problemas de conectividad, configuración de routers, switches y seguridad perimetral de tu red empresarial.",
    "categoria": "soporte",
    "estado": "publicado",
    "presentacion": "redes",
    "icono": "network",
    "color": "verde",
    "etiquetas": "LAN / WAN\nWiFi\nFirewall",
    "orden": 3
  },
  {
    "titulo": "Atención de Emergencias",
    "slug": "original-atencion-de-emergencias",
    "descripcion": "Cuando algo falla y no puede esperar, estamos ahí. Respuesta prioritaria para fallas críticas que afectan la operación de tu empresa.",
    "categoria": "soporte",
    "estado": "publicado",
    "presentacion": "emergencia",
    "icono": "emergency",
    "color": "oscuro",
    "etiquetas": "Prioritario\nRápido\nGarantizado",
    "orden": 4
  },
  {
    "titulo": "Asesoramiento Educativo",
    "slug": "original-asesoramiento-educativo",
    "descripcion": "Tesis, trabajos de grado, diseño curricular y evaluación de programas académicos con metodología rigurosa.",
    "categoria": "asesoramiento",
    "estado": "publicado",
    "presentacion": "asesoria",
    "icono": "education",
    "color": "indigo",
    "alcance": "Metodología de investigación\nEstructura y redacción\nAcompañamiento continuo",
    "orden": 1
  },
  {
    "titulo": "Asesoramiento Empresarial",
    "slug": "original-asesoramiento-empresarial",
    "descripcion": "Estrategia, gestión financiera, liderazgo y optimización de procesos para que tu organización crezca.",
    "categoria": "asesoramiento",
    "estado": "publicado",
    "presentacion": "asesoria",
    "icono": "business",
    "color": "coral",
    "alcance": "Plan estratégico\nGestión de equipos\nResultados medibles",
    "orden": 2
  },
  {
    "titulo": "Asesoramiento Legal",
    "slug": "original-asesoramiento-legal",
    "descripcion": "Orientación jurídica especializada para personas, empresas e instituciones que necesitan seguridad legal.",
    "categoria": "asesoramiento",
    "estado": "publicado",
    "presentacion": "asesoria",
    "icono": "legal",
    "color": "verde",
    "alcance": "Asesoría especializada\nDocumentación legal\nRespaldo profesional",
    "orden": 3
  },
  {
    "titulo": "Consultores especializados",
    "slug": "original-consultores-especializados",
    "descripcion": "Equipo con formación académica y experiencia práctica en gestión institucional y empresarial.",
    "categoria": "asesoramiento",
    "estado": "publicado",
    "presentacion": "beneficio",
    "icono": "users",
    "color": "indigo",
    "orden": 11
  },
  {
    "titulo": "Soluciones a medida",
    "slug": "original-soluciones-a-medida",
    "descripcion": "Cada propuesta es diseñada específicamente para las necesidades y contexto de tu organización.",
    "categoria": "asesoramiento",
    "estado": "publicado",
    "presentacion": "beneficio",
    "icono": "target",
    "color": "indigo",
    "orden": 12
  },
  {
    "titulo": "Resultados medibles",
    "slug": "original-resultados-medibles",
    "descripcion": "Establecemos indicadores claros y hacemos seguimiento continuo para garantizar el impacto real.",
    "categoria": "asesoramiento",
    "estado": "publicado",
    "presentacion": "beneficio",
    "icono": "finance",
    "color": "indigo",
    "orden": 13
  },
  {
    "titulo": "Acompañamiento real",
    "slug": "original-acompanamiento-real",
    "descripcion": "No solo entregamos un informe: te acompañamos en la implementación y ajuste de las soluciones.",
    "categoria": "asesoramiento",
    "estado": "publicado",
    "presentacion": "beneficio",
    "icono": "handshake",
    "color": "indigo",
    "orden": 14
  }
];
export const originalCourses: Prisma.CursoCreateManyInput[] = [
  {
    "titulo": "Salud y Primeros Auxilios",
    "slug": "original-salud-y-primeros-auxilios",
    "descripcion": "Para enfermeros, obstetras y personal médico. Prácticas de primeros auxilios y RCP certificadas.",
    "tipo": "capacitacion",
    "estado": "publicado",
    "area": "Salud",
    "certificacion": "Colegio de Enfermeros",
    "icono": "heart",
    "color": "indigo",
    "temario": "Primeros auxilios avanzados\nRCP y desfibrilación\nAtención de emergencias",
    "orden": 1
  },
  {
    "titulo": "Derecho y Gestión Legal",
    "slug": "original-derecho-y-gestion-legal",
    "descripcion": "Actualización jurídica para abogados. Temas de actualidad legal, procesal y gestión de casos.",
    "tipo": "capacitacion",
    "estado": "publicado",
    "area": "Derecho",
    "certificacion": "Colegio de Abogados",
    "icono": "legal",
    "color": "coral",
    "temario": "Derecho procesal actualizado\nÉtica profesional\nGestión de casos",
    "orden": 2
  },
  {
    "titulo": "Administración y Economía",
    "slug": "original-administracion-y-economia",
    "descripcion": "Para administradores y economistas: gestión financiera, análisis económico y herramientas de gestión.",
    "tipo": "capacitacion",
    "estado": "publicado",
    "area": "Administración",
    "certificacion": "CORLAD y CEC",
    "icono": "finance",
    "color": "verde",
    "temario": "Gestión financiera empresarial\nAnálisis económico\nHerramientas de gestión",
    "orden": 3
  },
  {
    "titulo": "Tecnología e Informática",
    "slug": "original-tecnologia-e-informatica",
    "descripcion": "Herramientas digitales, ofimática avanzada, ciberseguridad y transformación digital para profesionales.",
    "tipo": "capacitacion",
    "estado": "publicado",
    "area": "Tecnología",
    "certificacion": "Horus Group SRL",
    "icono": "technology",
    "color": "violeta",
    "temario": "Ofimática avanzada\nCiberseguridad básica\nTransformación digital",
    "orden": 4
  }
];
export const originalGallery: Prisma.GaleriaItemCreateManyInput[] = [
  {
    "titulo": "Capacitaciones — imagen 1",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-1.jpg",
    "activo": true,
    "orden": 1,
    "origen_original": "/galeria/capacitaciones/imagen-1.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 2",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-2.jpg",
    "activo": true,
    "orden": 2,
    "origen_original": "/galeria/capacitaciones/imagen-2.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 3",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-3.jpg",
    "activo": true,
    "orden": 3,
    "origen_original": "/galeria/capacitaciones/imagen-3.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 4",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-4.jpg",
    "activo": true,
    "orden": 4,
    "origen_original": "/galeria/capacitaciones/imagen-4.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 5",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-5.jpg",
    "activo": true,
    "orden": 5,
    "origen_original": "/galeria/capacitaciones/imagen-5.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 6",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-6.jpg",
    "activo": true,
    "orden": 6,
    "origen_original": "/galeria/capacitaciones/imagen-6.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 7",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-7.jpg",
    "activo": true,
    "orden": 7,
    "origen_original": "/galeria/capacitaciones/imagen-7.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 8",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-8.jpg",
    "activo": true,
    "orden": 8,
    "origen_original": "/galeria/capacitaciones/imagen-8.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 9",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-9.jpg",
    "activo": true,
    "orden": 9,
    "origen_original": "/galeria/capacitaciones/imagen-9.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 10",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-10.jpg",
    "activo": true,
    "orden": 10,
    "origen_original": "/galeria/capacitaciones/imagen-10.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 11",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-11.jpg",
    "activo": true,
    "orden": 11,
    "origen_original": "/galeria/capacitaciones/imagen-11.jpg"
  },
  {
    "titulo": "Capacitaciones — imagen 12",
    "categoria": "capacitaciones",
    "imagen_url": "/galeria/capacitaciones/imagen-12.jpg",
    "activo": true,
    "orden": 12,
    "origen_original": "/galeria/capacitaciones/imagen-12.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 1",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-1.jpg",
    "activo": true,
    "orden": 13,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-1.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 2",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-2.jpg",
    "activo": true,
    "orden": 14,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-2.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 3",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-3.jpg",
    "activo": true,
    "orden": 15,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-3.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 4",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-4.jpg",
    "activo": true,
    "orden": 16,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-4.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 5",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-5.jpg",
    "activo": true,
    "orden": 17,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-5.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 6",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-6.jpg",
    "activo": true,
    "orden": 18,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-6.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 7",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-7.jpg",
    "activo": true,
    "orden": 19,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-7.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 8",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-8.jpg",
    "activo": true,
    "orden": 20,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-8.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 9",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-9.jpg",
    "activo": true,
    "orden": 21,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-9.jpg"
  },
  {
    "titulo": "Servicio Técnico — imagen 10",
    "categoria": "servicio-tecnico",
    "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-10.jpg",
    "activo": true,
    "orden": 22,
    "origen_original": "/galeria/nuestro-servicio-tecnico/imagen-10.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 1",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-1.jpg",
    "activo": true,
    "orden": 23,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-1.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 2",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-2.jpg",
    "activo": true,
    "orden": 24,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-2.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 3",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-3.jpg",
    "activo": true,
    "orden": 25,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-3.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 4",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-4.jpg",
    "activo": true,
    "orden": 26,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-4.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 5",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-5.jpg",
    "activo": true,
    "orden": 27,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-5.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 6",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-6.jpg",
    "activo": true,
    "orden": 28,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-6.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 7",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-7.jpg",
    "activo": true,
    "orden": 29,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-7.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 8",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-8.jpg",
    "activo": true,
    "orden": 30,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-8.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 9",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-9.jpg",
    "activo": true,
    "orden": 31,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-9.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 10",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-10.jpg",
    "activo": true,
    "orden": 32,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-10.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 11",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-11.jpg",
    "activo": true,
    "orden": 33,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-11.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 12",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-12.jpg",
    "activo": true,
    "orden": 34,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-12.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 13",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-13.jpg",
    "activo": true,
    "orden": 35,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-13.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 14",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-14.jpg",
    "activo": true,
    "orden": 36,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-14.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 15",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-15.jpg",
    "activo": true,
    "orden": 37,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-15.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 16",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-16.jpg",
    "activo": true,
    "orden": 38,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-16.jpg"
  },
  {
    "titulo": "Colegio Enfermeros — imagen 17",
    "categoria": "colegio-enfermeros",
    "imagen_url": "/galeria/colegio-de-enfermeros/imagen-17.jpg",
    "activo": true,
    "orden": 39,
    "origen_original": "/galeria/colegio-de-enfermeros/imagen-17.jpg"
  },
  {
    "titulo": "Colegio Abogados — imagen 1",
    "categoria": "colegio-abogados",
    "imagen_url": "/galeria/colegio-de-abogados/imagen-1.jpg",
    "activo": true,
    "orden": 40,
    "origen_original": "/galeria/colegio-de-abogados/imagen-1.jpg"
  },
  {
    "titulo": "Colegio Abogados — imagen 2",
    "categoria": "colegio-abogados",
    "imagen_url": "/galeria/colegio-de-abogados/imagen-2.jpg",
    "activo": true,
    "orden": 41,
    "origen_original": "/galeria/colegio-de-abogados/imagen-2.jpg"
  },
  {
    "titulo": "Colegio Abogados — imagen 3",
    "categoria": "colegio-abogados",
    "imagen_url": "/galeria/colegio-de-abogados/imagen-3.jpg",
    "activo": true,
    "orden": 42,
    "origen_original": "/galeria/colegio-de-abogados/imagen-3.jpg"
  },
  {
    "titulo": "Colegio Abogados — imagen 4",
    "categoria": "colegio-abogados",
    "imagen_url": "/galeria/colegio-de-abogados/imagen-4.jpg",
    "activo": true,
    "orden": 43,
    "origen_original": "/galeria/colegio-de-abogados/imagen-4.jpg"
  },
  {
    "titulo": "Colegio Abogados — imagen 7",
    "categoria": "colegio-abogados",
    "imagen_url": "/galeria/colegio-de-abogados/imagen-7.jpg",
    "activo": true,
    "orden": 44,
    "origen_original": "/galeria/colegio-de-abogados/imagen-7.jpg"
  },
  {
    "titulo": "Colegio Abogados — imagen 9",
    "categoria": "colegio-abogados",
    "imagen_url": "/galeria/colegio-de-abogados/imagen-9.jpg",
    "activo": true,
    "orden": 45,
    "origen_original": "/galeria/colegio-de-abogados/imagen-9.jpg"
  },
  {
    "titulo": "Colegio Abogados — imagen 10",
    "categoria": "colegio-abogados",
    "imagen_url": "/galeria/colegio-de-abogados/imagen-10.jpg",
    "activo": true,
    "orden": 46,
    "origen_original": "/galeria/colegio-de-abogados/imagen-10.jpg"
  },
  {
    "titulo": "ISAM — imagen 1",
    "categoria": "isam",
    "imagen_url": "/galeria/ISAM/imagen-1.jpg",
    "activo": true,
    "orden": 47,
    "origen_original": "/galeria/ISAM/imagen-1.jpg"
  },
  {
    "titulo": "ISAM — imagen 2",
    "categoria": "isam",
    "imagen_url": "/galeria/ISAM/imagen-2.jpg",
    "activo": true,
    "orden": 48,
    "origen_original": "/galeria/ISAM/imagen-2.jpg"
  },
  {
    "titulo": "ISAM — imagen 3",
    "categoria": "isam",
    "imagen_url": "/galeria/ISAM/imagen-3.jpg",
    "activo": true,
    "orden": 49,
    "origen_original": "/galeria/ISAM/imagen-3.jpg"
  },
  {
    "titulo": "ISAM — imagen 4",
    "categoria": "isam",
    "imagen_url": "/galeria/ISAM/imagen-4.jpg",
    "activo": true,
    "orden": 50,
    "origen_original": "/galeria/ISAM/imagen-4.jpg"
  },
  {
    "titulo": "ISAM — imagen 5",
    "categoria": "isam",
    "imagen_url": "/galeria/ISAM/imagen-5.jpg",
    "activo": true,
    "orden": 51,
    "origen_original": "/galeria/ISAM/imagen-5.jpg"
  },
  {
    "titulo": "ISAM — imagen 6",
    "categoria": "isam",
    "imagen_url": "/galeria/ISAM/imagen-6.jpg",
    "activo": true,
    "orden": 52,
    "origen_original": "/galeria/ISAM/imagen-6.jpg"
  },
  {
    "titulo": "ISAM — imagen 7",
    "categoria": "isam",
    "imagen_url": "/galeria/ISAM/imagen-7.jpg",
    "activo": true,
    "orden": 53,
    "origen_original": "/galeria/ISAM/imagen-7.jpg"
  },
  {
    "titulo": "ISAM — imagen 8",
    "categoria": "isam",
    "imagen_url": "/galeria/ISAM/imagen-8.jpg",
    "activo": true,
    "orden": 54,
    "origen_original": "/galeria/ISAM/imagen-8.jpg"
  },
  {
    "titulo": "Primeros Auxilios — imagen 1",
    "categoria": "primeros-auxilios",
    "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-1.jpg",
    "activo": true,
    "orden": 55,
    "origen_original": "/galeria/practicas-de-primeros-auxilios/imagen-1.jpg"
  },
  {
    "titulo": "Primeros Auxilios — imagen 2",
    "categoria": "primeros-auxilios",
    "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-2.jpg",
    "activo": true,
    "orden": 56,
    "origen_original": "/galeria/practicas-de-primeros-auxilios/imagen-2.jpg"
  },
  {
    "titulo": "Primeros Auxilios — imagen 3",
    "categoria": "primeros-auxilios",
    "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-3.jpg",
    "activo": true,
    "orden": 57,
    "origen_original": "/galeria/practicas-de-primeros-auxilios/imagen-3.jpg"
  },
  {
    "titulo": "Primeros Auxilios — imagen 4",
    "categoria": "primeros-auxilios",
    "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-4.jpg",
    "activo": true,
    "orden": 58,
    "origen_original": "/galeria/practicas-de-primeros-auxilios/imagen-4.jpg"
  },
  {
    "titulo": "Primeros Auxilios — imagen 5",
    "categoria": "primeros-auxilios",
    "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-5.jpg",
    "activo": true,
    "orden": 59,
    "origen_original": "/galeria/practicas-de-primeros-auxilios/imagen-5.jpg"
  },
  {
    "titulo": "Primeros Auxilios — imagen 6",
    "categoria": "primeros-auxilios",
    "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-6.jpg",
    "activo": true,
    "orden": 60,
    "origen_original": "/galeria/practicas-de-primeros-auxilios/imagen-6.jpg"
  },
  {
    "titulo": "Primeros Auxilios — imagen 7",
    "categoria": "primeros-auxilios",
    "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-7.jpg",
    "activo": true,
    "orden": 61,
    "origen_original": "/galeria/practicas-de-primeros-auxilios/imagen-7.jpg"
  }
];
