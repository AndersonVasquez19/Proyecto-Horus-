// Interpretación de preguntas y relevancia para el asistente. Funciones puras: sin base de datos, sin red y sin estado.
// Solo ayudan a elegir QUÉ registros publicados se consultan y en qué orden; nunca aportan hechos.

export const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STOP = new Set(`que como cual cuales cuando donde quien quienes tienen tiene tienes hay quiero quisiera queria saber informacion info sobre para una unos unas los las del con por
me mi mis tus sus nos puedes pueden puedo favor hola buenas buenos dias tardes noches gracias horus group ofrecen ofrece ofrecer ofreces brindan brinda disponible disponibles busco buscando
necesito necesitamos algun alguna algunos algunas mas muy esta este estos estas son ser hacen hace hago ayuda ayudar ayudan cosas casa hogar instalar instalacion dan dar dame tambien pero
estan estoy oculto numero enlace correo precio precios cuesta cuestan costo costos cuanto cuantos tarifa tarifas valor vale cotizacion cotizar presupuesto`.split(/\s+/));

// Raíz aproximada que sirve para el plural y el singular: «redes» → «red», «cursos» → «curso», «cámaras» → «camara».
export function root(word: string): string {
  if (word.length >= 5 && word.endsWith('es') && !'aeiou'.includes(word[word.length - 3])) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function searchTerms(text: string): string[] {
  return [...new Set(normalize(text).match(/[a-z0-9]{3,}/g) || [])]
    .filter(word => !STOP.has(word)).map(root).filter(word => word.length >= 3 && !STOP.has(word)).slice(0, 12);
}

// Palabras que indican la clase de contenido o el tipo de dato, pero no el tema: no cuentan como concepto específico.
const GENERIC = /^(curso|capacitacion|formacion|servicio|solucion|taller|diplomado|clas|clase|convenio|alianza|tecnologic|contact|telefon|correo|direccion|ubicacion|whatsapp|horario|ruc|empresa|razon|social)/;

// Sinónimos de uso común entre el vocabulario del visitante y el de los contenidos publicados.
const SYNONYMS: [RegExp, string[]][] = [
  [/^(camara|vigilancia|videovigilancia|cctv|dvr)/, ['camara', 'vigilancia', 'videovigilancia', 'cctv']],
  [/^(red|wifi|internet|ethernet|utp|fibra|cableado)/, ['red', 'cableado', 'wifi', 'inalambrica']],
  [/^(soporte|mantenimiento|reparacion|reparar|tecnico|computadora|computador|ordenador|laptop)/, ['soporte', 'mantenimiento', 'reparacion']],
  [/^(asesor|asesoria|asesoramiento|consultoria|consultor)/, ['asesor', 'asesoramiento', 'consultoria']],
  [/^(certific|diploma|constancia)/, ['certific', 'diploma', 'constancia']],
  [/^(online|remot|distancia|virtual|zoom)/, ['virtual', 'online', 'remoto', 'distancia']],
  [/^(hibrid|semipresenc|mixto)/, ['hibrida', 'hibrido', 'mixto']],
];

export type Intent = { course: boolean; service: boolean; convenio: boolean; institutional: boolean; price: boolean };
export type Analysis = {
  terms: string[];
  concepts: string[][]; // cada concepto es una lista de formas equivalentes; basta una para considerarlo presente
  intent: Intent;
  generic: boolean; // pide un tipo de contenido sin tema («¿qué cursos tienen?»)
};

export function analyze(raw: string): Analysis {
  const text = normalize(raw);
  const terms = searchTerms(raw);
  const intent: Intent = {
    course: /\b(curso|capacitacion|formacion|taller|diplomado|clase)(e?s)?\b/.test(text),
    service: /\b(servicio|solucion)(e?s)?\b/.test(text),
    convenio: /\b(convenio|alianza)(e?s)?\b/.test(text),
    institutional: /\b(contact|telefono|correo|direccion|ubicaci|whatsapp|horario|ruc\b|razon social|(nombre|datos|informacion) de (la )?empresa|(la )?empresa (esta|queda))/.test(text),
    price: /(precio|costo|cuesta|cuanto (vale|cuesta|cobran|cobra|sale)|tarifa|presupuesto|cotiz)/.test(text),
  };
  const specific = terms.filter(term => !GENERIC.test(term));
  const concepts = specific.map(term => [...new Set([term, ...(SYNONYMS.find(([pattern]) => pattern.test(term))?.[1] || [])])]);
  const generic = !concepts.length && (intent.course || intent.service || intent.convenio);
  return { terms, concepts, intent, generic };
}

// Un término coincide con una palabra del contenido por prefijo (las raíces cubren plural y singular). Los términos cortos
// exigen la palabra exacta o su plural: «red» no debe coincidir con «reducir».
export function tokenMatches(token: string, term: string, fuzzy = false): boolean {
  if (term.length <= 3) return token === term || token === term + 's' || token === term + 'es';
  if (token.startsWith(term)) return true;
  if (!fuzzy || term.length < 5) return false;
  const allowed = term.length >= 9 ? 2 : 1;
  return editDistance(token.slice(0, term.length), term) <= allowed || editDistance(token, term) <= allowed;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export const tokens = (text: string) => normalize(text).match(/[a-z0-9]+/g) || [];

export type Scored = { score: number; matched: number; titleHit: boolean };

// Relevancia de una fuente: cuántos conceptos de la pregunta aparecen y dónde (el título pesa más que el cuerpo).
export function relevance(analysis: Analysis, title: string, body: string, fuzzy = false): Scored {
  const titleTokens = tokens(title), bodyTokens = tokens(body);
  let score = 0, matched = 0, titleHit = false;
  for (const concept of analysis.concepts) {
    let best = 0;
    for (const alt of concept) {
      if (titleTokens.some(token => tokenMatches(token, alt, fuzzy))) { best = 4; titleHit = true; break; }
      if (best < 1 && bodyTokens.some(token => tokenMatches(token, alt, fuzzy))) best = 1;
    }
    if (best) { matched++; score += best; }
  }
  return { score, matched, titleHit };
}

// «completa» si responde a todos los conceptos (o a la mayoría cuando la pregunta es larga); «parcial» si solo a algunos.
export function coverage(analysis: Analysis, matched: number): 'completa' | 'parcial' | 'ninguna' {
  const total = analysis.concepts.length;
  if (!total || !matched) return 'ninguna';
  const ratio = matched / total;
  return ratio >= (total <= 2 ? 1 : 0.6) ? 'completa' : ratio >= 0.5 ? 'parcial' : 'ninguna';
}

// Formas que se buscan en la base de datos (candidatos amplios; la relevancia decide después).
export const candidateTerms = (analysis: Analysis) => [...new Set(analysis.concepts.flat())];

const MODALITIES: [string, RegExp][] = [['presencial', /^presenc/], ['virtual', /^(virtual|online|remot|distancia|zoom)/], ['hibrida', /^(hibrid|semipresenc|mixto)/]];
const CATEGORIES: [string, RegExp][] = [['cableado', /^(cableado|red$|redes?$|wifi|utp|fibra|estructurad)/], ['camaras', /^(camara|vigilancia|videovigilancia|cctv)/], ['soporte', /^(soporte|mantenimiento|reparacion)/], ['asesoramiento', /^(asesor|consultor)/]];
// Solo valores válidos de los enums de Prisma: un valor inexistente haría fallar la consulta.
export const modalitiesFor = (terms: string[]) => MODALITIES.filter(([, pattern]) => terms.some(term => pattern.test(term))).map(([value]) => value);
export const categoriesFor = (terms: string[]) => CATEGORIES.filter(([, pattern]) => terms.some(term => pattern.test(term))).map(([value]) => value);

export const CATEGORY_LABELS: Record<string, string> = {
  cableado: 'Cableado estructurado', camaras: 'Cámaras de seguridad', soporte: 'Soporte y mantenimiento', asesoramiento: 'Asesoramiento',
};

export type Smalltalk = 'saludo' | 'gracias' | 'despedida' | null;
export function smalltalk(raw: string): Smalltalk {
  const text = normalize(raw).replace(/^[¿¡\s]+/, '').trim();
  if (/^(hola|holi|hey|buenas|buenos dias|buenas tardes|buenas noches|saludos)( horus| asistente)?[!.?\s]*$/.test(text)) return 'saludo';
  if (/^((muchas|mil|muy amables|ok|vale|listo|perfecto|genial|excelente)[,.\s]+)*gracias( por (todo|tu ayuda|la ayuda|la informacion))?[!.?\s]*$/.test(text)
    || /^(ok|vale|listo|perfecto|entendido|genial)[!.?\s]*$/.test(text)) return 'gracias';
  if (/^(chao|chau|adios|hasta luego|nos vemos|hasta pronto)[!.?\s]*$/.test(text)) return 'despedida';
  return null;
}
