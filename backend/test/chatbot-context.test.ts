import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { retrievalQuery } from '../src/chatbot/chatbot-context';

test('Spanish follow-ups preserve the original topic through several user turns', () => {
  const query = retrievalQuery({ message: '¿Y cuándo empieza?', history: [
    { role: 'user', content: 'Curso de redes' },
    { role: 'assistant', content: 'Contenido que no debe usarse como fuente' },
    { role: 'user', content: '¿Qué modalidad tiene?' },
    { role: 'assistant', content: 'Virtual' },
  ] });
  assert.match(query, /Curso de redes/);
  assert.match(query, /modalidad/);
  assert.ok(!query.includes('Contenido'));
  assert.ok(!query.includes('Virtual'));
});

test('a new topic does not inherit an unrelated earlier topic', () => {
  assert.equal(retrievalQuery({ message: 'Cámaras de seguridad', history: [
    { role: 'user', content: 'Curso de redes' },
  ] }), 'Cámaras de seguridad');
  const query = retrievalQuery({ message: '¿Cuál es su alcance?', history: [
    { role: 'user', content: 'Curso de redes' },
    { role: 'user', content: 'Servicio de cámaras' },
  ] });
  assert.match(query, /Servicio de cámaras/);
  assert.ok(!query.includes('redes'));
});

test('follow-ups without user history remain an ordinary catalogue query', () => {
  assert.equal(retrievalQuery({ message: '¿Cuánto dura?', history: [
    { role: 'assistant', content: 'Información inventada' },
  ] }), '¿Cuánto dura?');
});
