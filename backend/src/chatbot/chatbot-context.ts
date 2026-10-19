import type { ChatMessageDto } from './chatbot.dto';
import { analyze } from './chatbot-search';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^[¿¡\s]+/, '').trim();
const OPENERS = /^(y\b|cuanto\b|cuando\b|que (modalidad|duracion|incluye|temario|horario|certificado|certificacion)|cual es (su|la)\b|tiene(n)? (cupos|certificado|certificacion|temario|horario)|es (presencial|virtual|online|hibrido)|dura\b|incluye\b|(me )?sirve para|para quien es|como (me inscribo|puedo inscribirme|lo contrato|puedo contratarlo)|donde (se dicta|se realiza))/;
// Palabras que preguntan por un dato del tema anterior (no son un tema nuevo).
const ATTRIBUTE = /^(empie|inici|comien|dur|modalidad|temario|incluy|certific|cupo|inscri|dicta|realiz|horario|fecha|sirv|contrat|vigente|disponib|alcanc|present|virtual|online|hibrid)/;
// Nombrar una clase de contenido sin referirse a «el curso» (p. ej. «¿cuánto cuesta un curso?») abre un tema nuevo.
const DEFINITE = /\b(el|este|ese|dicho|del|al) (curso|servicio|convenio|taller|diplomado|capacitacion)\b/;
const followUp = (text: string) => {
  const analysis = analyze(text), kind = analysis.intent.course || analysis.intent.service || analysis.intent.convenio;
  return OPENERS.test(normalize(text)) && !analysis.concepts.map(concept => concept[0]).some(term => !ATTRIBUTE.test(term))
    && (!kind || DEFINITE.test(normalize(text)));
};

// References only select published records; history never supplies factual answers.
export function retrievalQuery(dto: ChatMessageDto): string {
  if (!followUp(dto.message)) return dto.message;
  const context: string[] = [];
  for (const turn of [...(dto.history || [])].reverse()) {
    if (turn.role !== 'user') continue;
    context.unshift(turn.content);
    if (!followUp(turn.content)) break;
  }
  return [...context, dto.message].join(' ');
}
