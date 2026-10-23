import {
  SECTION_KEYS, authorizedSections, buildPendientes, type Pendiente, type SectionData, type SectionKey, type Severidad,
} from './asistente.rules';

// CATÁLOGO CERRADO de herramientas de consulta de HORUS Assistant (v2). Es la única lista de cosas que el asistente conversacional puede
// «mirar». La IA solo puede ELEGIR entre estas herramientas (por su id); no escribe consultas, no ve la base y no puede añadir herramientas.
// Cada herramienta:
//  - es de solo lectura y devuelve CONTEOS (nunca nombres, correos, teléfonos, DNI ni texto libre);
//  - hereda los permisos de las secciones del v1 (SECTION_PERMISSIONS en asistente.rules.ts): no existe una matriz paralela;
//  - se arma con datos que ya leyó el servicio con consultas fijas (asistente.data.ts).

export type HerramientaId = 'pendientes' | 'mensajes' | 'chatbot' | 'cotizaciones' | 'preinscripciones' | 'ediciones' | 'matriculas';
export type Parametros = Record<string, string>;

export interface Hecho { id: string; etiqueta: string; valor: number; severidad?: Severidad; puede_actuar?: boolean }

export interface Herramienta {
  id: HerramientaId;
  titulo: string;
  descripcion: string;                       // lo que ve el modelo al elegir (sin datos)
  ejemplo: string;                           // pregunta de ejemplo que se sugiere al usuario
  secciones: readonly SectionKey[];          // TODAS son obligatorias: sin el permiso de una, la herramienta no existe para ese rol
  opcionales?: readonly SectionKey[];        // se añaden solo si el rol las puede leer
  parametros?: Readonly<Record<string, readonly string[]>>; // valores permitidos (el primero es el valor por defecto)
  palabras: RegExp;                          // indicios para explicar «no tienes acceso a esa área» (no decide permisos)
}

export const HERRAMIENTAS: readonly Herramienta[] = Object.freeze([
  {
    id: 'pendientes', titulo: 'Pendientes y prioridades del día', secciones: [], palabras: /pendiente|prioriz|prioridad|urgente|por hacer|qu[eé] (debo|debería|tengo)/i,
    descripcion: 'Lista priorizada (alta, media, informativa) de lo que la cuenta tiene pendiente hoy, reuniendo todas las áreas a las que su rol tiene acceso. Úsala para «¿qué tengo pendiente?» y «¿qué debería priorizar?».',
    ejemplo: '¿Qué tengo pendiente hoy?',
  },
  {
    id: 'mensajes', titulo: 'Mensajes y solicitudes de clientes', secciones: ['atencion'], palabras: /mensaje|solicitud|consulta de cliente|cliente|contacto|bandeja|escribi/i,
    descripcion: 'Bandeja de Mensajes: consultas de clientes registradas por el formulario, el chatbot (con datos) o a mano. Cantidad recibida hoy, personas distintas hoy, nuevas, en proceso, con más de 48 horas sin cerrar y total.',
    ejemplo: '¿Cuántas solicitudes de clientes recibimos hoy?',
  },
  {
    id: 'chatbot', titulo: 'Chatbot público', secciones: ['chatbot'], palabras: /chatbot|bot\b/i,
    descripcion: 'Actividad del chatbot público hoy: preguntas recibidas, resueltas, sin resolver, atendidas con IA, y preguntas sin respuesta vigentes. No tiene identidad de visitantes.',
    ejemplo: '¿Cuántas preguntas del chatbot quedaron sin respuesta hoy?',
  },
  {
    id: 'cotizaciones', titulo: 'Cotizaciones', secciones: ['cotizaciones'], palabras: /cotizaci/i,
    descripcion: 'Cotizaciones por estado (borrador, enviada, aceptada, etc.) y cuántas enviadas tienen la validez vencida.',
    ejemplo: '¿Hay cotizaciones sin atender?',
  },
  {
    id: 'preinscripciones', titulo: 'Preinscripciones', secciones: ['preinscripciones'], palabras: /preinscri|inscripci/i,
    descripcion: 'Preinscripciones por estado: recibidas, pendientes de revisión, validadas sin matrícula, convertidas en matrícula, descartadas y desistidas.',
    ejemplo: '¿Qué preinscripciones necesitan revisión?',
  },
  {
    id: 'ediciones', titulo: 'Ediciones de cursos', secciones: ['ediciones'], opcionales: ['aperturas'], palabras: /edici|convocatoria|apertura|abrir|curso/i,
    descripcion: 'Ediciones (convocatorias) abiertas, planificadas cuya fecha de inicio ya llegó y, si el rol puede verlo, ediciones que alcanzaron el mínimo de preinscritos para abrir.',
    ejemplo: '¿Cuántas ediciones están abiertas?',
  },
  {
    id: 'matriculas', titulo: 'Matrículas por confirmar', secciones: ['matriculas'], palabras: /matr[ií]cula|cumplimiento/i,
    descripcion: 'Matrículas activas de ediciones cerradas que aún no tienen confirmado el cumplimiento.',
    ejemplo: '¿Cuántas matrículas faltan por confirmar?',
  },
] satisfies Herramienta[]);

export const HERRAMIENTA_IDS: readonly HerramientaId[] = HERRAMIENTAS.map(tool => tool.id);
export const MAX_HERRAMIENTAS = 4;

const byId = new Map<string, Herramienta>(HERRAMIENTAS.map(tool => [tool.id, tool]));
export const herramientaPorId = (id: unknown): Herramienta | undefined => typeof id === 'string' ? byId.get(id) : undefined;

// Una herramienta existe para un rol solo si el rol puede leer TODAS sus secciones (pendientes: al menos una sección).
export function herramientasPara(role: unknown): Herramienta[] {
  const sections = new Set(authorizedSections(role));
  return HERRAMIENTAS.filter(tool => tool.id === 'pendientes' ? sections.size > 0 : tool.secciones.every(section => sections.has(section)));
}

export const permitidaPara = (tool: Herramienta, role: unknown) => herramientasPara(role).some(other => other.id === tool.id);

// Valida los parámetros que propuso el modelo: solo claves y valores declarados; lo demás se descarta y se usa el valor por defecto.
export function parametrosValidos(tool: Herramienta, raw: unknown): Parametros {
  const result: Parametros = {};
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  for (const [name, allowed] of Object.entries(tool.parametros ?? {})) {
    const value = source[name];
    result[name] = typeof value === 'string' && allowed.includes(value) ? value : allowed[0];
  }
  return result;
}

// Secciones que hay que leer para ejecutar una herramienta (sin duplicados), siempre dentro de las autorizadas.
export function seccionesDe(tool: Herramienta, role: unknown): SectionKey[] {
  const authorized = new Set(authorizedSections(role));
  if (tool.id === 'pendientes') return SECTION_KEYS.filter(section => authorized.has(section));
  return [...tool.secciones, ...(tool.opcionales ?? []).filter(section => authorized.has(section))];
}

// ---- Armado de los hechos (puro: solo cifras que ya leyó el servicio) ----

export interface ContextoHechos {
  role: unknown;
  data: Partial<SectionData>;
}
export type ResultadoHerramienta =
  | { herramienta: HerramientaId; titulo: string; estado: 'ok'; parametros: Parametros; hechos: Hecho[]; ventana?: { desde: string; hasta: string } }
  | { herramienta: HerramientaId; titulo: string; estado: 'no_disponible'; parametros: Parametros; hechos: []; motivo: string };

const hecho = (id: string, etiqueta: string, valor: number): Hecho => ({ id, etiqueta, valor });
const NO_DISPONIBLE = 'No se pudo consultar esta área en este momento (módulo no disponible o con error).';

export function ejecutar(tool: Herramienta, params: Parametros, context: ContextoHechos): ResultadoHerramienta {
  const base = { herramienta: tool.id, titulo: tool.titulo, parametros: params };
  const unavailable = (): ResultadoHerramienta => ({ ...base, estado: 'no_disponible', hechos: [], motivo: NO_DISPONIBLE });
  const { data } = context;

  switch (tool.id) {
    case 'pendientes': {
      if (!Object.keys(data).length) return unavailable();
      const { items, truncated } = buildPendientes(data, context.role);
      const hechos: Hecho[] = items.map((p: Pendiente) => ({ id: p.id, etiqueta: p.titulo, valor: p.cantidad, severidad: p.severidad, puede_actuar: p.puedeActuar }));
      if (truncated) hechos.push({ ...hecho('truncado', 'Hay más pendientes de menor prioridad que no se muestran', 1) });
      return { ...base, estado: 'ok', hechos };
    }
    case 'mensajes': {
      const d = data.atencion; if (!d) return unavailable();
      return { ...base, estado: 'ok', hechos: [
        hecho('recibidos_hoy', 'Consultas de clientes registradas hoy', d.recibidosHoy), hecho('personas_hoy', 'Personas distintas (correos) que escribieron hoy', d.personasUnicasHoy),
        hecho('nuevos', 'Mensajes nuevos sin atender', d.nuevos), hecho('en_proceso', 'Mensajes en proceso', d.enProceso),
        hecho('antiguos_48h', 'Mensajes nuevos o en proceso con más de 48 horas', d.antiguos), hecho('personas_pendientes', 'Personas distintas con mensajes pendientes', d.personasPendientes),
        hecho('total', 'Total de mensajes en la bandeja', d.total),
      ] };
    }
    case 'chatbot': {
      const d = data.chatbot; if (!d) return unavailable();
      return { ...base, estado: 'ok', hechos: [
        hecho('preguntas_hoy', 'Preguntas hechas al chatbot hoy', d.interaccionesHoy), hecho('resueltas_hoy', 'Resueltas hoy', d.resueltasHoy),
        hecho('sin_resolver_hoy', 'Sin resolver hoy', d.sinResolverHoy), hecho('con_ia_hoy', 'Atendidas con IA hoy', d.conIaHoy),
        hecho('sin_respuesta_vigentes', 'Preguntas sin respuesta vigentes (90 días)', d.preguntasSinRespuestaVigentes),
      ] };
    }
    case 'cotizaciones': {
      const d = data.cotizaciones; if (!d) return unavailable();
      const estados = Object.entries(d.porEstado).sort(([a], [b]) => a.localeCompare(b)).map(([estado, cantidad]) => hecho('estado_' + estado, 'Cotizaciones en estado «' + estado + '»', cantidad));
      return { ...base, estado: 'ok', hechos: [...estados, hecho('vencidas', 'Enviadas con la validez vencida', d.vencidas)] };
    }
    case 'preinscripciones': {
      const d = data.preinscripciones; if (!d) return unavailable();
      return { ...base, estado: 'ok', hechos: [
        hecho('por_revisar', 'Recibidas por revisar (ediciones planificadas o abiertas)', d.pendientesRevision), hecho('recibidas', 'Recibidas (sin revisar)', d.recibidas),
        hecho('validadas', 'Validadas sin convertir en matrícula', d.validadas), hecho('convertidas', 'Convertidas en matrícula', d.convertidas),
        hecho('descartadas', 'Descartadas', d.descartadas), hecho('desistidas', 'Desistidas por el solicitante', d.desistidas),
        hecho('vigentes', 'Vigentes (recibidas, validadas y matriculadas)', d.vigentes), hecho('total', 'Total registradas', d.total),
      ] };
    }
    case 'ediciones': {
      const d = data.ediciones; if (!d) return unavailable();
      return { ...base, estado: 'ok', hechos: [
        hecho('abiertas', 'Ediciones abiertas', d.abiertas), hecho('inicio_vencido', 'Ediciones planificadas cuya fecha de inicio ya llegó', d.planificadasConInicioVencido),
        ...(data.aperturas ? [hecho('listas_para_abrir', 'Ediciones que alcanzaron el mínimo de preinscritos validados', data.aperturas.listasParaApertura)] : []),
      ] };
    }
    case 'matriculas': {
      const d = data.matriculas; if (!d) return unavailable();
      return { ...base, estado: 'ok', hechos: [hecho('por_confirmar', 'Matrículas activas de ediciones cerradas sin confirmar cumplimiento', d.porConfirmarCumplimiento)] };
    }
  }
}
