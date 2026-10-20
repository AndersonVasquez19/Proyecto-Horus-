import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImportFile, importOperationId } from '../src/panel/services/importations.ts';
test('archivo CSV: extensión, vacío y límite antes de leer el contenido', () => {
  assert.equal(validateImportFile({ name: 'Hoja.CSV', size: 49152 }), '');
  for (const file of [{ name: 'Hoja.xlsx', size: 10 }, { name: 'Hoja.csv', size: 0 }, { name: 'Hoja.csv', size: 49153 }]) assert.ok(validateImportFile(file));
});
test('recuperación de operación sin conservar datos personales', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(importOperationId(Buffer.from(JSON.stringify({ id })).toString('base64url') + '.firma'), id);
  for (const text of ['', 'basura', 'e30.firma']) assert.equal(importOperationId(text), '');
});
