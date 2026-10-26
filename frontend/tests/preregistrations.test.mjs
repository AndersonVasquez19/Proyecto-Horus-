import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_ACTIONS } from '../src/panel/context/panelAccess.ts';
import { PREREG_PERMISSION, conversionPayload, dniError, hasPersonalData, identityIssue, parsePreregDetail, parsePreregList, parsePreregSummary, preregActions, preregCorrectionPayload, preregForm, preregFormErrors, reasonError } from '../src/panel/services/preregistrations.ts';

const edition = { id: 3, nombre: 'Noviembre', estado: 'planificada', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', archivado_at: null, preinscripcion_estado: 'abierta', minimo_apertura: 10, capacidad: 20, revision: 2, curso: { id: 1, titulo: 'Excel', tipo: 'curso' } };
const item = (estado = 'recibida') => ({ id: 9, convocatoria_id: 3, convocatoria: edition, nombres: 'Ana María', apellidos: 'Pérez', email: 'Ana@Ejemplo.test', telefono: '+51 999 888 777', canal: 'formulario', estado, consentimiento_at: '2026-10-01T10:00:00.000Z', aviso_version: 'v1', estudiante_id: null, matricula_id: null, convertida_at: null, revision: 4, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z' });
const pagination = { page: 1, limit: 20, total: 1, pages: 1 };
const all = () => true;

test('Preinscripciones: las acciones siguen las transiciones del backend y sus permisos', () => {
  assert.deepEqual(preregActions(item('recibida'), all), ['correct', 'validate', 'discard', 'withdraw']);
  assert.deepEqual(preregActions(item('validada'), all), ['correct', 'discard', 'withdraw', 'convert']);
  for (const estado of ['matriculada', 'desistida', 'descartada']) assert.deepEqual(preregActions(item(estado), all), [], estado);
  assert.deepEqual(preregActions(item('validada'), p => p === 'preinscripciones:convertir'), ['convert']);
  assert.deepEqual(preregActions(item('recibida'), p => p === 'preinscripciones:leer'), []);
});

test('Preinscripciones: los permisos del módulo son los que declara el panel', () => {
  assert.equal(PREREG_PERMISSION.convert, PANEL_ACTIONS.convertirPreinscripcion);
  for (const action of ['correct', 'validate', 'discard', 'withdraw']) assert.equal(PREREG_PERMISSION[action], PANEL_ACTIONS.editarPreinscripcion, action);
});

test('Preinscripciones: el motivo exige texto sin datos personales ni más de 300 caracteres', () => {
  assert.equal(reasonError('Ya no puede asistir en ese horario', true), '');
  assert.equal(reasonError('  ', false), '');
  assert.ok(reasonError('', true));
  assert.ok(reasonError('x'.repeat(301), true));
  for (const text of ['escribió a ana@ejemplo.test', 'llamar al 999 888 777', 'DNI 12345678', 'contraseña: abc', 'token = xyz']) assert.ok(reasonError(text, true), text);
  assert.equal(hasPersonalData('Reunión el 12/10/2026 con 3 personas'), false);
});

test('Preinscripciones: la corrección envía solo lo que cambió, con la revisión leída', () => {
  const original = item();
  const same = preregForm(original);
  assert.equal(preregCorrectionPayload({ ...same, email: ' ana@ejemplo.test ' }, original), null, 'mayúsculas y espacios del correo no son un cambio');
  assert.deepEqual(preregCorrectionPayload({ ...same, telefono: '999111222' }, original), { revision: 4, telefono: '999111222' });
  assert.deepEqual(Object.keys(preregCorrectionPayload({ ...same, nombres: 'Ana', apellidos: 'Gómez' }, original)).sort(), ['apellidos', 'nombres', 'revision']);
  assert.deepEqual(preregFormErrors(same), {});
  assert.deepEqual(Object.keys(preregFormErrors({ nombres: ' ', apellidos: '', email: 'sin-arroba', telefono: 'abc' })).sort(), ['apellidos', 'email', 'nombres', 'telefono']);
  assert.ok(preregFormErrors({ ...same, nombres: 'x'.repeat(121) }).nombres);
});

test('Preinscripciones: la conversión exige un DNI de 8 dígitos y envía la revisión', () => {
  assert.equal(dniError('12345678'), '');
  for (const value of ['', '1234567', '123456789', '1234 5678', 'abcdefgh', ' 12345678']) assert.ok(dniError(value), JSON.stringify(value));
  assert.deepEqual(conversionPayload(4, '01234567'), { revision: 4, doc_numero: '01234567' });
});

test('Preinscripciones: un 409 de identidad explica qué revisar sin ofrecer forzar', () => {
  const issue = identityIssue({ statusCode: 409, codigo: 'IDENTIDAD_DISCREPANTE', discrepancias: ['nombres', 'contacto', 'raro'], message: 'x' });
  assert.match(issue.message, /los nombres y apellidos y el correo o el teléfono/);
  assert.doesNotMatch(issue.message, /forzar|omitir/i);
  assert.match(identityIssue({ codigo: 'POSIBLE_DUPLICADO' }).message, /otro DNI/);
  assert.match(identityIssue({ codigo: 'DNI_NO_COINCIDE', discrepancias: ['dni'] }).message, /el DNI/);
  for (const body of [null, 'texto', {}, { codigo: 'OTRO' }, { codigo: 'HORARIO_SOLAPADO' }]) assert.equal(identityIssue(body), null);
});

test('Preinscripciones: las respuestas fuera de contrato se rechazan', () => {
  assert.ok(parsePreregList({ ok: true, items: [item()], pagination }));
  assert.ok(parsePreregList({ ok: true, items: [], pagination }));
  for (const bad of [null, { items: 'no', pagination }, { items: [item()] }, { items: [{ ...item(), estado: 'inventado' }], pagination }, { items: [{ ...item(), convocatoria: null }], pagination }]) assert.equal(parsePreregList(bad), null);
  assert.ok(parsePreregDetail({ ok: true, item: item(), matricula: null, estudiante: null, coincidencias: [] }));
  assert.equal(parsePreregDetail({ ok: true, item: item() }), null);
  const summary = { convocatoria: edition, conteo: { recibida: 1, validada: 2, matriculada: 0, desistida: 0, descartada: 0, total: 3 }, apertura: { minimo: 10, contadas: 2, faltan: 8, cumple_minimo: false }, cupos: { capacidad: 20, ocupados: 0, disponibles: 20 } };
  assert.ok(parsePreregSummary({ ok: true, items: [summary], pagination }));
  assert.equal(parsePreregSummary({ ok: true, items: [{ convocatoria: edition }], pagination }), null);
});
