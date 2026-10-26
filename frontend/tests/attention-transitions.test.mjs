import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedTransitions } from '../../backend/src/attention/attention-rules.ts';
import { ATTENTION_STATES, transitionsOf, canKeepOrTransition } from '../src/panel/services/attentionTransitions.ts';

for (const estado of ATTENTION_STATES) test(`Contrato real: ${estado}`, () => {
  const item = { estado, transiciones_permitidas: allowedTransitions(estado) };
  assert.deepEqual(transitionsOf(item), allowedTransitions(estado));
  for (const target of ATTENTION_STATES) assert.equal(canKeepOrTransition(item, target), target === estado || allowedTransitions(estado).includes(target));
});
for (const value of [undefined, null, {}, 'atendido', ['desconocido'], ['atendido', 1], ['atendido', 'atendido']]) test(`Contrato inválido: ${JSON.stringify(value)}`, () => {
  const item = { estado: 'en_proceso', transiciones_permitidas: value };
  assert.equal(transitionsOf(item), null);
  assert.equal(canKeepOrTransition(item, 'en_proceso'), true);
  assert.equal(canKeepOrTransition(item, 'atendido'), false);
});
test('Lista vacía válida y recuperación histórica explícita', () => {
  assert.deepEqual(transitionsOf({ estado: 'nuevo', transiciones_permitidas: [] }), []);
  const item = { estado: 'historico', transiciones_permitidas: allowedTransitions('historico') };
  assert.equal(canKeepOrTransition(item, 'atendido'), true);
});
