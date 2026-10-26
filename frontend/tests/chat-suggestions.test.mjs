import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_SUGGESTIONS, validSuggestions } from '../src/components/chatbot/chatSuggestions.ts';

test('sugerencias públicas iniciales y contrato ausente o inválido', () => {
  assert.equal(INITIAL_SUGGESTIONS.length, 4);
  for (const value of [undefined, null, {}, 'pregunta', 9]) assert.deepEqual(validSuggestions(value), []);
  assert.deepEqual(validSuggestions(INITIAL_SUGGESTIONS), INITIAL_SUGGESTIONS);
});
test('filtra datos inválidos y sensibles sin interpretar marcado ni truncar preguntas', () => {
  assert.deepEqual(validSuggestions([null, {}, 2, '', '  ', '<b>Hola</b>', 'a@example.test', 'https://example.test',
    'Teléfono +51 999 123 456', 'DNI: 12345678', 'token privado', 'a'.repeat(161), '\u202eoculto',
    ' Ver  servicios ', 'VER servicios', '¿Qué cursos ofrecen?']), ['Ver servicios', '¿Qué cursos ofrecen?']);
});
test('limita opciones, conserva 160 caracteres y deduplica Unicode', () => {
  assert.deepEqual(validSuggestions(['Cotizacio\u0301n', 'Cotización', 'a'.repeat(160), 'Tres', 'Cuatro', 'Cinco']),
    ['Cotizacio\u0301n', 'a'.repeat(160), 'Tres', 'Cuatro']);
});
