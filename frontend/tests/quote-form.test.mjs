import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteFieldError, quoteRetryWarning } from '../src/panel/components/quoteFormFeedback.ts';

test('obligatorios: rechaza texto vacío o solo espacios, sin mínimos nuevos', () => {
  const control = { required: true, value: ' ', validity: { valid: true }, validationMessage: '' };
  assert.match(quoteFieldError(control), /obligatorio/);
  assert.equal(quoteFieldError({ ...control, value: 'A' }), '');
  assert.equal(quoteFieldError({ ...control, required: false, value: '' }), '');
});

test('correo, números y fechas reutilizan el resultado del validador nativo', () => {
  for (const message of ['Correo inválido', 'Debe ser mayor o igual a 1', 'Paso de 0,01', 'Fecha inválida']) {
    assert.equal(quoteFieldError({ required: false, value: 'x', validity: { valid: false }, validationMessage: message }), message);
  }
});

test('resultado incierto: distingue reintento idéntico de contenido cambiado', () => {
  assert.match(quoteRetryWarning(true), /misma clave/);
  assert.match(quoteRetryWarning(true), /si existe/);
  assert.doesNotMatch(quoteRetryWarning(true), /creará.*duplicada|completamente seguro/);
  assert.match(quoteRetryWarning(false), /clave nueva/);
  assert.match(quoteRetryWarning(false), /podrías crear otra/);
});
