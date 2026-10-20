// Fuente editorial en código. Semilla de fuentes versionadas en 6994691; no es una exportación de MySQL.
// IDs editoriales propios: nunca usarlos en convocatorias, matrículas o el chatbot NestJS.
import type { InstitutionalCatalog } from './types';

export const institutionalCatalog: InstitutionalCatalog = {
  "cursos": [
    {
      "id": 1,
      "modalidad": null,
      "duracion": null,
      "fecha_inicio": null,
      "imagen_url": null,
      "temario": "Primeros auxilios avanzados\nRCP y desfibrilación\nAtención de emergencias",
      "titulo": "Salud y Primeros Auxilios",
      "slug": "original-salud-y-primeros-auxilios",
      "descripcion": "Para enfermeros, obstetras y personal médico. Prácticas de primeros auxilios y RCP certificadas.",
      "tipo": "capacitacion",
      "area": "Salud",
      "certificacion": "Colegio de Enfermeros",
      "icono": "heart",
      "color": "indigo",
      "orden": 1
    },
    {
      "id": 2,
      "modalidad": null,
      "duracion": null,
      "fecha_inicio": null,
      "imagen_url": null,
      "temario": "Derecho procesal actualizado\nÉtica profesional\nGestión de casos",
      "titulo": "Derecho y Gestión Legal",
      "slug": "original-derecho-y-gestion-legal",
      "descripcion": "Actualización jurídica para abogados. Temas de actualidad legal, procesal y gestión de casos.",
      "tipo": "capacitacion",
      "area": "Derecho",
      "certificacion": "Colegio de Abogados",
      "icono": "legal",
      "color": "coral",
      "orden": 2
    },
    {
      "id": 3,
      "modalidad": null,
      "duracion": null,
      "fecha_inicio": null,
      "imagen_url": null,
      "temario": "Gestión financiera empresarial\nAnálisis económico\nHerramientas de gestión",
      "titulo": "Administración y Economía",
      "slug": "original-administracion-y-economia",
      "descripcion": "Para administradores y economistas: gestión financiera, análisis económico y herramientas de gestión.",
      "tipo": "capacitacion",
      "area": "Administración",
      "certificacion": "CORLAD y CEC",
      "icono": "finance",
      "color": "verde",
      "orden": 3
    },
    {
      "id": 4,
      "modalidad": null,
      "duracion": null,
      "fecha_inicio": null,
      "imagen_url": null,
      "temario": "Ofimática avanzada\nCiberseguridad básica\nTransformación digital",
      "titulo": "Tecnología e Informática",
      "slug": "original-tecnologia-e-informatica",
      "descripcion": "Herramientas digitales, ofimática avanzada, ciberseguridad y transformación digital para profesionales.",
      "tipo": "capacitacion",
      "area": "Tecnología",
      "certificacion": "Horus Group SRL",
      "icono": "technology",
      "color": "violeta",
      "orden": 4
    }
  ],
  "servicios": [
    {
      "id": 1,
      "alcance": null,
      "imagen_url": "/site-original/categoria1.jpg",
      "titulo": "Cableado Básico Cat 1-3",
      "slug": "original-cableado-basico-cat-1-3",
      "descripcion": "Ideal para instalaciones residenciales y pequeñas oficinas con necesidades de conectividad básica. Perfecto para telefonía, sistemas de alarma y redes de baja demanda.",
      "categoria": "cableado",
      "presentacion": "cableado",
      "nombre_corto": "Cat 1-3 Básico",
      "destacado": "Instalación residencial",
      "dato_principal": "10",
      "dato_secundario": "Mbps máximos",
      "etiquetas": "Residencial\nTelefonía\nAlarmas\nBajo costo",
      "icono": "network",
      "color": "indigo",
      "orden": 1
    },
    {
      "id": 2,
      "alcance": null,
      "imagen_url": "/site-original/categoria2.webp",
      "titulo": "Cableado Empresarial Cat 5e / Cat 6",
      "slug": "original-cableado-empresarial-cat-5e-cat-6",
      "descripcion": "El estándar de la industria para oficinas y empresas medianas. Soporta Gigabit Ethernet con excelente relación costo-beneficio. Certificado para PoE y VoIP.",
      "categoria": "cableado",
      "presentacion": "cableado",
      "nombre_corto": "Cat 5e-6 Empresarial",
      "destacado": "Estándar empresarial",
      "dato_principal": "1",
      "dato_secundario": "Gbps garantizados",
      "etiquetas": "Gigabit\nPoE\nVoIP\nOficinas",
      "icono": "network",
      "color": "indigo",
      "orden": 2
    },
    {
      "id": 3,
      "alcance": null,
      "imagen_url": "/site-original/categoria3.webp",
      "titulo": "Alto Rendimiento Cat 6A / Cat 7",
      "slug": "original-alto-rendimiento-cat-6a-cat-7",
      "descripcion": "Para empresas que exigen lo mejor. Soporta 10 Gigabit Ethernet con blindaje total contra interferencias. Ideal para centros de datos, hospitales y entornos críticos.",
      "categoria": "cableado",
      "presentacion": "cableado",
      "nombre_corto": "Cat 6A-7 Alto Rendimiento",
      "destacado": "Alto rendimiento",
      "dato_principal": "10",
      "dato_secundario": "Gbps de capacidad",
      "etiquetas": "10 Gbps\nBlindado\nData Center\nPoE++",
      "icono": "network",
      "color": "indigo",
      "orden": 3
    },
    {
      "id": 4,
      "alcance": null,
      "imagen_url": "/site-original/categoria4.jpg",
      "titulo": "Fibra Óptica — Velocidad de Luz",
      "slug": "original-fibra-optica-velocidad-de-luz",
      "descripcion": "La tecnología más avanzada para infraestructuras críticas. Inmune a interferencias electromagnéticas, con alcances de hasta 80 km sin repetidores. El futuro de las redes.",
      "categoria": "cableado",
      "presentacion": "cableado",
      "nombre_corto": "Fibra Velocidad de Luz",
      "destacado": "Máxima velocidad",
      "dato_principal": "40",
      "dato_secundario": "Gbps y más",
      "etiquetas": "40+ Gbps\nLarga distancia\nSin EMI\nFuturo-proof",
      "icono": "network",
      "color": "indigo",
      "orden": 4
    },
    {
      "id": 5,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Cámaras HD con Visión Nocturna",
      "slug": "original-camaras-hd-con-vision-nocturna",
      "descripcion": "Instalamos cámaras de alta definición que graban con total claridad de día y de noche, hasta 50 metros en oscuridad completa. Resistentes al agua y al polvo.",
      "categoria": "camaras",
      "presentacion": "camara",
      "icono": "camera",
      "color": "indigo",
      "etiquetas": "Full HD 1080p\nVisión nocturna 50m\nIP66 resistente",
      "orden": 1
    },
    {
      "id": 6,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Alertas al Instante en tu Celular",
      "slug": "original-alertas-al-instante-en-tu-celular",
      "descripcion": "Cuando la cámara detecta movimiento, recibes una notificación en tu teléfono en segundos. No necesitas estar mirando la pantalla — el sistema trabaja por ti.",
      "categoria": "camaras",
      "presentacion": "alertas",
      "icono": "bell",
      "color": "coral",
      "etiquetas": "Detección por IA\nPush en segundos\niOS y Android",
      "orden": 2
    },
    {
      "id": 7,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Grabación en la Nube 24/7",
      "slug": "original-grabacion-en-la-nube-24-7",
      "descripcion": "Todo queda grabado y guardado de forma segura en la nube. Puedes revisar lo que pasó hace 30 días desde tu celular o computadora, en cualquier momento.",
      "categoria": "camaras",
      "presentacion": "nube",
      "icono": "cloud",
      "color": "verde",
      "etiquetas": "30 días de historial\nEncriptado AES-256\nAcceso global",
      "orden": 3
    },
    {
      "id": 8,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Control Remoto desde tu App",
      "slug": "original-control-remoto-desde-tu-app",
      "descripcion": "Ve todas tus cámaras en vivo, mueve las cámaras PTZ, revisa grabaciones pasadas y gestiona alertas — todo desde la palma de tu mano, donde estés en el mundo.",
      "categoria": "camaras",
      "presentacion": "app",
      "icono": "mobile",
      "color": "violeta",
      "etiquetas": "Vista en vivo\nControl PTZ\nMultidispositivo",
      "orden": 4
    },
    {
      "id": 9,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Mantenimiento Preventivo",
      "slug": "original-mantenimiento-preventivo",
      "descripcion": "Revisiones periódicas programadas para mantener tu infraestructura en óptimas condiciones. Antes de que algo falle, ya lo revisamos.",
      "categoria": "soporte",
      "presentacion": "mantenimiento",
      "icono": "tools",
      "color": "indigo",
      "etiquetas": "Mensual\nTrimestral\nHardware",
      "orden": 1
    },
    {
      "id": 10,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Soporte de Software",
      "slug": "original-soporte-de-software",
      "descripcion": "Instalación, configuración y actualización de sistemas operativos, aplicaciones empresariales y software especializado. Errores resueltos.",
      "categoria": "soporte",
      "presentacion": "software",
      "icono": "software",
      "color": "coral",
      "etiquetas": "Windows\nLinux\nAntivirus",
      "orden": 2
    },
    {
      "id": 11,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Soporte de Redes",
      "slug": "original-soporte-de-redes",
      "descripcion": "Diagnóstico y resolución de problemas de conectividad, configuración de routers, switches y seguridad perimetral de tu red empresarial.",
      "categoria": "soporte",
      "presentacion": "redes",
      "icono": "network",
      "color": "verde",
      "etiquetas": "LAN / WAN\nWiFi\nFirewall",
      "orden": 3
    },
    {
      "id": 12,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Atención de Emergencias",
      "slug": "original-atencion-de-emergencias",
      "descripcion": "Cuando algo falla y no puede esperar, estamos ahí. Respuesta prioritaria para fallas críticas que afectan la operación de tu empresa.",
      "categoria": "soporte",
      "presentacion": "emergencia",
      "icono": "emergency",
      "color": "oscuro",
      "etiquetas": "Prioritario\nRápido\nGarantizado",
      "orden": 4
    },
    {
      "id": 13,
      "alcance": "Metodología de investigación\nEstructura y redacción\nAcompañamiento continuo",
      "imagen_url": null,
      "titulo": "Asesoramiento Educativo",
      "slug": "original-asesoramiento-educativo",
      "descripcion": "Tesis, trabajos de grado, diseño curricular y evaluación de programas académicos con metodología rigurosa.",
      "categoria": "asesoramiento",
      "presentacion": "asesoria",
      "icono": "education",
      "color": "indigo",
      "orden": 1
    },
    {
      "id": 14,
      "alcance": "Plan estratégico\nGestión de equipos\nResultados medibles",
      "imagen_url": null,
      "titulo": "Asesoramiento Empresarial",
      "slug": "original-asesoramiento-empresarial",
      "descripcion": "Estrategia, gestión financiera, liderazgo y optimización de procesos para que tu organización crezca.",
      "categoria": "asesoramiento",
      "presentacion": "asesoria",
      "icono": "business",
      "color": "coral",
      "orden": 2
    },
    {
      "id": 15,
      "alcance": "Asesoría especializada\nDocumentación legal\nRespaldo profesional",
      "imagen_url": null,
      "titulo": "Asesoramiento Legal",
      "slug": "original-asesoramiento-legal",
      "descripcion": "Orientación jurídica especializada para personas, empresas e instituciones que necesitan seguridad legal.",
      "categoria": "asesoramiento",
      "presentacion": "asesoria",
      "icono": "legal",
      "color": "verde",
      "orden": 3
    },
    {
      "id": 16,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Consultores especializados",
      "slug": "original-consultores-especializados",
      "descripcion": "Equipo con formación académica y experiencia práctica en gestión institucional y empresarial.",
      "categoria": "asesoramiento",
      "presentacion": "beneficio",
      "icono": "users",
      "color": "indigo",
      "orden": 11
    },
    {
      "id": 17,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Soluciones a medida",
      "slug": "original-soluciones-a-medida",
      "descripcion": "Cada propuesta es diseñada específicamente para las necesidades y contexto de tu organización.",
      "categoria": "asesoramiento",
      "presentacion": "beneficio",
      "icono": "target",
      "color": "indigo",
      "orden": 12
    },
    {
      "id": 18,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Resultados medibles",
      "slug": "original-resultados-medibles",
      "descripcion": "Establecemos indicadores claros y hacemos seguimiento continuo para garantizar el impacto real.",
      "categoria": "asesoramiento",
      "presentacion": "beneficio",
      "icono": "finance",
      "color": "indigo",
      "orden": 13
    },
    {
      "id": 19,
      "alcance": null,
      "imagen_url": null,
      "titulo": "Acompañamiento real",
      "slug": "original-acompanamiento-real",
      "descripcion": "No solo entregamos un informe: te acompañamos en la implementación y ajuste de las soluciones.",
      "categoria": "asesoramiento",
      "presentacion": "beneficio",
      "icono": "handshake",
      "color": "indigo",
      "orden": 14
    }
  ],
  "galeria": [
    {
      "id": 1,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 1",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-1.jpg",
      "orden": 1
    },
    {
      "id": 2,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 2",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-2.jpg",
      "orden": 2
    },
    {
      "id": 3,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 3",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-3.jpg",
      "orden": 3
    },
    {
      "id": 4,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 4",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-4.jpg",
      "orden": 4
    },
    {
      "id": 5,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 5",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-5.jpg",
      "orden": 5
    },
    {
      "id": 6,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 6",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-6.jpg",
      "orden": 6
    },
    {
      "id": 7,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 7",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-7.jpg",
      "orden": 7
    },
    {
      "id": 8,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 8",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-8.jpg",
      "orden": 8
    },
    {
      "id": 9,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 9",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-9.jpg",
      "orden": 9
    },
    {
      "id": 10,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 10",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-10.jpg",
      "orden": 10
    },
    {
      "id": 11,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 11",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-11.jpg",
      "orden": 11
    },
    {
      "id": 12,
      "descripcion": null,
      "titulo": "Capacitaciones — imagen 12",
      "categoria": "capacitaciones",
      "imagen_url": "/galeria/capacitaciones/imagen-12.jpg",
      "orden": 12
    },
    {
      "id": 13,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 1",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-1.jpg",
      "orden": 13
    },
    {
      "id": 14,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 2",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-2.jpg",
      "orden": 14
    },
    {
      "id": 15,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 3",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-3.jpg",
      "orden": 15
    },
    {
      "id": 16,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 4",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-4.jpg",
      "orden": 16
    },
    {
      "id": 17,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 5",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-5.jpg",
      "orden": 17
    },
    {
      "id": 18,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 6",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-6.jpg",
      "orden": 18
    },
    {
      "id": 19,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 7",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-7.jpg",
      "orden": 19
    },
    {
      "id": 20,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 8",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-8.jpg",
      "orden": 20
    },
    {
      "id": 21,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 9",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-9.jpg",
      "orden": 21
    },
    {
      "id": 22,
      "descripcion": null,
      "titulo": "Servicio Técnico — imagen 10",
      "categoria": "servicio-tecnico",
      "imagen_url": "/galeria/nuestro-servicio-tecnico/imagen-10.jpg",
      "orden": 22
    },
    {
      "id": 23,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 1",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-1.jpg",
      "orden": 23
    },
    {
      "id": 24,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 2",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-2.jpg",
      "orden": 24
    },
    {
      "id": 25,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 3",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-3.jpg",
      "orden": 25
    },
    {
      "id": 26,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 4",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-4.jpg",
      "orden": 26
    },
    {
      "id": 27,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 5",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-5.jpg",
      "orden": 27
    },
    {
      "id": 28,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 6",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-6.jpg",
      "orden": 28
    },
    {
      "id": 29,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 7",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-7.jpg",
      "orden": 29
    },
    {
      "id": 30,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 8",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-8.jpg",
      "orden": 30
    },
    {
      "id": 31,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 9",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-9.jpg",
      "orden": 31
    },
    {
      "id": 32,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 10",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-10.jpg",
      "orden": 32
    },
    {
      "id": 33,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 11",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-11.jpg",
      "orden": 33
    },
    {
      "id": 34,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 12",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-12.jpg",
      "orden": 34
    },
    {
      "id": 35,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 13",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-13.jpg",
      "orden": 35
    },
    {
      "id": 36,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 14",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-14.jpg",
      "orden": 36
    },
    {
      "id": 37,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 15",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-15.jpg",
      "orden": 37
    },
    {
      "id": 38,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 16",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-16.jpg",
      "orden": 38
    },
    {
      "id": 39,
      "descripcion": null,
      "titulo": "Colegio Enfermeros — imagen 17",
      "categoria": "colegio-enfermeros",
      "imagen_url": "/galeria/colegio-de-enfermeros/imagen-17.jpg",
      "orden": 39
    },
    {
      "id": 40,
      "descripcion": null,
      "titulo": "Colegio Abogados — imagen 1",
      "categoria": "colegio-abogados",
      "imagen_url": "/galeria/colegio-de-abogados/imagen-1.jpg",
      "orden": 40
    },
    {
      "id": 41,
      "descripcion": null,
      "titulo": "Colegio Abogados — imagen 2",
      "categoria": "colegio-abogados",
      "imagen_url": "/galeria/colegio-de-abogados/imagen-2.jpg",
      "orden": 41
    },
    {
      "id": 42,
      "descripcion": null,
      "titulo": "Colegio Abogados — imagen 3",
      "categoria": "colegio-abogados",
      "imagen_url": "/galeria/colegio-de-abogados/imagen-3.jpg",
      "orden": 42
    },
    {
      "id": 43,
      "descripcion": null,
      "titulo": "Colegio Abogados — imagen 4",
      "categoria": "colegio-abogados",
      "imagen_url": "/galeria/colegio-de-abogados/imagen-4.jpg",
      "orden": 43
    },
    {
      "id": 44,
      "descripcion": null,
      "titulo": "Colegio Abogados — imagen 7",
      "categoria": "colegio-abogados",
      "imagen_url": "/galeria/colegio-de-abogados/imagen-7.jpg",
      "orden": 44
    },
    {
      "id": 45,
      "descripcion": null,
      "titulo": "Colegio Abogados — imagen 9",
      "categoria": "colegio-abogados",
      "imagen_url": "/galeria/colegio-de-abogados/imagen-9.jpg",
      "orden": 45
    },
    {
      "id": 46,
      "descripcion": null,
      "titulo": "Colegio Abogados — imagen 10",
      "categoria": "colegio-abogados",
      "imagen_url": "/galeria/colegio-de-abogados/imagen-10.jpg",
      "orden": 46
    },
    {
      "id": 47,
      "descripcion": null,
      "titulo": "ISAM — imagen 1",
      "categoria": "isam",
      "imagen_url": "/galeria/ISAM/imagen-1.jpg",
      "orden": 47
    },
    {
      "id": 48,
      "descripcion": null,
      "titulo": "ISAM — imagen 2",
      "categoria": "isam",
      "imagen_url": "/galeria/ISAM/imagen-2.jpg",
      "orden": 48
    },
    {
      "id": 49,
      "descripcion": null,
      "titulo": "ISAM — imagen 3",
      "categoria": "isam",
      "imagen_url": "/galeria/ISAM/imagen-3.jpg",
      "orden": 49
    },
    {
      "id": 50,
      "descripcion": null,
      "titulo": "ISAM — imagen 4",
      "categoria": "isam",
      "imagen_url": "/galeria/ISAM/imagen-4.jpg",
      "orden": 50
    },
    {
      "id": 51,
      "descripcion": null,
      "titulo": "ISAM — imagen 5",
      "categoria": "isam",
      "imagen_url": "/galeria/ISAM/imagen-5.jpg",
      "orden": 51
    },
    {
      "id": 52,
      "descripcion": null,
      "titulo": "ISAM — imagen 6",
      "categoria": "isam",
      "imagen_url": "/galeria/ISAM/imagen-6.jpg",
      "orden": 52
    },
    {
      "id": 53,
      "descripcion": null,
      "titulo": "ISAM — imagen 7",
      "categoria": "isam",
      "imagen_url": "/galeria/ISAM/imagen-7.jpg",
      "orden": 53
    },
    {
      "id": 54,
      "descripcion": null,
      "titulo": "ISAM — imagen 8",
      "categoria": "isam",
      "imagen_url": "/galeria/ISAM/imagen-8.jpg",
      "orden": 54
    },
    {
      "id": 55,
      "descripcion": null,
      "titulo": "Primeros Auxilios — imagen 1",
      "categoria": "primeros-auxilios",
      "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-1.jpg",
      "orden": 55
    },
    {
      "id": 56,
      "descripcion": null,
      "titulo": "Primeros Auxilios — imagen 2",
      "categoria": "primeros-auxilios",
      "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-2.jpg",
      "orden": 56
    },
    {
      "id": 57,
      "descripcion": null,
      "titulo": "Primeros Auxilios — imagen 3",
      "categoria": "primeros-auxilios",
      "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-3.jpg",
      "orden": 57
    },
    {
      "id": 58,
      "descripcion": null,
      "titulo": "Primeros Auxilios — imagen 4",
      "categoria": "primeros-auxilios",
      "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-4.jpg",
      "orden": 58
    },
    {
      "id": 59,
      "descripcion": null,
      "titulo": "Primeros Auxilios — imagen 5",
      "categoria": "primeros-auxilios",
      "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-5.jpg",
      "orden": 59
    },
    {
      "id": 60,
      "descripcion": null,
      "titulo": "Primeros Auxilios — imagen 6",
      "categoria": "primeros-auxilios",
      "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-6.jpg",
      "orden": 60
    },
    {
      "id": 61,
      "descripcion": null,
      "titulo": "Primeros Auxilios — imagen 7",
      "categoria": "primeros-auxilios",
      "imagen_url": "/galeria/practicas-de-primeros-auxilios/imagen-7.jpg",
      "orden": 61
    }
  ],
  "preguntasFrecuentes": [],
  "convenios": [
    {
      "id": 1,
      "logo_url": null,
      "fotos": [],
      "sigla": "CORLAD",
      "nombre": "Colegio de Administradores",
      "descripcion_corta": "Alianza para el desarrollo profesional de administradores con capacitaciones especializadas.",
      "descripcion_completa": "",
      "informacion_adicional": "",
      "orden": 1,
      "visible": true
    },
    {
      "id": 2,
      "logo_url": null,
      "fotos": [],
      "sigla": "CEC",
      "nombre": "Colegio de Economistas",
      "descripcion_corta": "Convenio para la formación continua de economistas con certificaciones en gestión económica.",
      "descripcion_completa": "",
      "informacion_adicional": "",
      "orden": 2,
      "visible": true
    },
    {
      "id": 3,
      "logo_url": null,
      "fotos": [],
      "sigla": "CEP/CR XIII",
      "nombre": "Colegio de Enfermeros - Cajamarca",
      "descripcion_corta": "Alianza para capacitaciones en salud y gestión hospitalaria para el personal de enfermería.",
      "descripcion_completa": "",
      "informacion_adicional": "",
      "orden": 3,
      "visible": true
    },
    {
      "id": 4,
      "logo_url": null,
      "fotos": [],
      "sigla": "CEP/CR II",
      "nombre": "Colegio de Enfermeros - La Libertad",
      "descripcion_corta": "Alianza para capacitaciones en salud y gestión hospitalaria para el personal de enfermería.",
      "descripcion_completa": "",
      "informacion_adicional": "",
      "orden": 4,
      "visible": true
    },
    {
      "id": 5,
      "logo_url": null,
      "fotos": [],
      "sigla": "ISAM",
      "nombre": "Instituto ISAM",
      "descripcion_corta": "Alianza educativa con el ISAM para programas de formación y certificaciones de alto nivel.",
      "descripcion_completa": "",
      "informacion_adicional": "",
      "orden": 5,
      "visible": true
    }
  ],
  "settings": {
    "empresa_nombre": "Horus Group SRL",
    "ruc": "20611010977",
    "email_contacto": "horusgroupcajamarca@gmail.com",
    "telefono_principal": "+51 927 582 305",
    "direccion": "Cajamarca - Peru",
    "horario_atencion": "",
    "whatsapp": "",
    "facebook_url": "",
    "instagram_url": "",
    "linkedin_url": ""
  }
};
