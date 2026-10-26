// Vocabulario del contrato, sin matriz de reglas: los destinos siempre vienen del servidor.
export const ATTENTION_STATES = ['nuevo', 'en_proceso', 'atendido', 'archivado'] as const;
export type AttentionContract = { estado: string; transiciones_permitidas?: unknown };
export const TRANSITIONS_UNAVAILABLE = 'No se pudieron verificar las opciones de estado. Puedes editar los demás campos conservando el estado actual.';

export function transitionsOf(item: AttentionContract): string[] | null {
  const value = item.transiciones_permitidas;
  if (!Array.isArray(value) || !value.every(state => typeof state === 'string' && (ATTENTION_STATES as readonly string[]).includes(state)) || new Set(value).size !== value.length) return null;
  return value.filter(state => state !== item.estado);
}

export function canKeepOrTransition(item: AttentionContract, target: string): boolean {
  return target === item.estado || (transitionsOf(item)?.includes(target) ?? false);
}
