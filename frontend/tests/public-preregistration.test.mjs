import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FORM, UNCERTAIN_TEXT, describeSubmitError, editionFacts, parseEditions, toPayload, validate } from '../src/components/prereg/preregModel.ts';

const code = 'a'.repeat(32);
const valid = { ...EMPTY_FORM, convocatoria: code, nombres: ' Ana María ', apellidos: 'Pérez', email: ' Ana@Ejemplo.TEST ', telefono: '+51 (999) 888-777', consentimiento: true };
const edition = { codigo: code, nombre: 'Noviembre', apertura_confirmada: false, fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', curso: { titulo: 'Excel', tipo: 'curso', modalidad: 'virtual', duracion: '20 horas' } };

test('Preinscripción pública: valida solo obligatorio, longitud máxima y formato', () => {
  assert.deepEqual(validate(valid), {});
  assert.deepEqual(Object.keys(validate(EMPTY_FORM)).sort(), ['apellidos', 'consentimiento', 'convocatoria', 'email', 'nombres', 'telefono']);
  assert.ok(validate({ ...valid, convocatoria: 'abc' }).convocatoria, 'el código opaco debe ser de 32 hexadecimales');
  assert.ok(validate({ ...valid, convocatoria: 'A'.repeat(32) }).convocatoria, 'en minúsculas, como lo entrega el servidor');
  assert.ok(validate({ ...valid, email: 'sin-arroba' }).email);
  assert.ok(validate({ ...valid, telefono: 'abc' }).telefono);
  assert.ok(validate({ ...valid, nombres: 'x'.repeat(121) }).nombres);
  assert.ok(validate({ ...valid, consentimiento: false }).consentimiento);
  assert.deepEqual(validate({ ...valid, nombres: 'A', telefono: '1' }), {}, 'sin longitudes mínimas inventadas');
});

test('Preinscripción pública: el cuerpo lleva solo los campos del contrato, con la trampa vacía', () => {
  const payload = toPayload(valid);
  assert.deepEqual(Object.keys(payload).sort(), ['apellidos', 'consentimiento', 'convocatoria', 'email', 'nombres', 'telefono', 'website']);
  assert.equal(payload.consentimiento, true); assert.equal(payload.website, ''); assert.equal(payload.email, 'ana@ejemplo.test'); assert.equal(payload.nombres, 'Ana María');
  for (const forbidden of ['canal', 'estado', 'dni', 'doc_numero', 'pago', 'convocatoria_id', 'origen']) assert.equal(forbidden in payload, false, forbidden);
});

test('Preinscripción pública: cada fallo tiene un mensaje fijo y un fallo sin respuesta no afirma que falló', () => {
  assert.equal(describeSubmitError(undefined).text, UNCERTAIN_TEXT);
  assert.equal(describeSubmitError(500, true).kind, 'uncertain');
  assert.equal(describeSubmitError(200).kind, 'uncertain', 'respuesta correcta pero ilegible: pudo guardarse');
  assert.equal(describeSubmitError(502).kind, 'uncertain');
  assert.deepEqual([400, 404, 409, 429, 503, 500].map(status => describeSubmitError(status).kind), ['invalid', 'closed', 'closed', 'wait', 'unavailable', 'server']);
  assert.equal(describeSubmitError(404).reload, true); assert.equal(describeSubmitError(409).reload, true); assert.equal(describeSubmitError(400).reload, false);
  for (const status of [400, 404, 409, 429, 500, 503]) assert.doesNotMatch(describeSubmitError(status).text, /internal|sql|prisma|exception/i);
});

test('Preinscripción pública: la lista de ediciones se valida antes de ofrecerse', () => {
  assert.equal(parseEditions({ ok: true, items: [edition] })?.length, 1);
  assert.deepEqual(parseEditions({ ok: true, items: [] }), []);
  for (const bad of [null, { items: 'no' }, { items: [{ ...edition, codigo: '1' }] }, { items: [{ ...edition, curso: null }] }, { items: [{ ...edition, apertura_confirmada: 'si' }] }]) assert.equal(parseEditions(bad), null);
  assert.deepEqual(editionFacts(edition), ['Del 01/11/2026 al 30/11/2026', 'Virtual', '20 horas']);
  assert.deepEqual(editionFacts({ ...edition, fecha_inicio: null, fecha_fin: null, curso: { ...edition.curso, modalidad: null, duracion: null } }), ['Fechas por confirmar']);
});
