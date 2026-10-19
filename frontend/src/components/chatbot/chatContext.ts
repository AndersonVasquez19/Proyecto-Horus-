import type { ChatTurn } from './chatApi';

export function contactSummary(turns: ChatTurn[]): string {
  const questions = turns.filter(turn => turn.role === 'user').slice(-4);
  return questions.length ? 'Consultas que quiero revisar con el equipo:\n' + questions.map(turn => '• ' + turn.content.slice(0, 1000)).join('\n') : '';
}

export function followUpQuestions(turn: ChatTurn | undefined): string[] {
  const source = turn?.role === 'assistant' ? turn.sources?.[0] : undefined;
  if (!source) return [];
  if (/^cursos?-/.test(source.id)) return ['Modalidad y duración de ', 'Temario de ', 'Fecha de inicio de '].map(prefix => prefix + source.title);
  if (/^servicios?-/.test(source.id)) return ['Alcance de ', 'Información sobre '].map(prefix => prefix + source.title);
  return [];
}
