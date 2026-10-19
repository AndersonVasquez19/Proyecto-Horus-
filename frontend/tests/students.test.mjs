import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { studentPayload, studentFormErrors } from '../src/panel/services/students.ts';

test('formulario: DNI ASCII requerido, nombres obligatorios y contacto opcional válido', () => {
  const valid = { nombres: ' Ana ', apellidos: ' Pérez ', doc_numero: '00123456', email: '', telefono: '' };
  assert.deepEqual(studentFormErrors(valid), {});
  for (const doc_numero of ['', '1234567', '１２３４５６７８', '12345678\n']) assert.ok(studentFormErrors({ ...valid, doc_numero }).doc_numero);
  assert.ok(studentFormErrors({ ...valid, nombres: '  ' }).nombres);
  assert.ok(studentFormErrors({ ...valid, email: 'no es correo' }).email);
  assert.ok(studentFormErrors({ ...valid, telefono: 'abc' }).telefono);
  assert.deepEqual(studentPayload(valid), { nombres: 'Ana', apellidos: 'Pérez', doc_numero: '00123456', email: '', telefono: '' });
});

test('edición: conserva revisión, permite un registro heredado sin DNI; impide retirar uno existente', () => {
  const form = { nombres: 'Ana', apellidos: 'Pérez', doc_numero: '', email: '', telefono: '' };
  assert.deepEqual(studentFormErrors(form, { doc_numero: null }), {});
  assert.ok(studentFormErrors(form, { doc_numero: '00123456' }).doc_numero);
  assert.deepEqual(studentPayload(form, 3), { nombres: 'Ana', apellidos: 'Pérez', email: '', telefono: '', revision: 3 });
});

test('el smoke rechaza una API indicada por entorno antes de abrir el navegador o enviar solicitudes', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/smoke-estudiantes.cjs', import.meta.url))], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, STUDENTS_API_URL: 'http://127.0.0.1:3000/api', SMOKE_BROWSER: 'browser-inexistente-para-probar-la-barrera' },
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /API real solo mediante el proceso de integración aislada/);
});
