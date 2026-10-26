import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SLOTS, draftFrom, hasScheduleErrors, parseSchedule, scheduleChanged, scheduleErrors, schedulePayload, serverScheduleIssue, sortSlots, describeSlot } from '../src/panel/services/schedules.ts';

const slot = (dia, inicio, fin) => ({ dia_semana: String(dia), hora_inicio: inicio, hora_fin: fin });
const rowsOf = (...slots) => slots.map((s, i) => ({ key: 'k' + i, ...s }));
const response = { ok: true, convocatoria: { id: 7, nombre: 'Edición', estado: 'abierta', archivada: false, revision: 4, modificable: true }, zona_horaria: 'America/Lima', items: [{ id: 12, dia_semana: 1, dia: 'lunes', hora_inicio: '19:00', hora_fin: '21:00' }] };

test('Horarios: acepta varios tramos el mismo día y tramos contiguos; rechaza fin anterior, duplicados y solapamientos', () => {
  assert.equal(hasScheduleErrors(scheduleErrors(rowsOf(slot(6, '09:00', '12:00'), slot(6, '12:00', '14:00'), slot(6, '15:00', '17:00'), slot(1, '09:00', '12:00')))), false);
  const bad = scheduleErrors(rowsOf(slot(1, '10:00', '10:00'), slot(2, '', '11:00'), slot(3, '09:00', '11:00'), slot(3, '09:00', '11:00'), slot(4, '09:00', '11:00'), slot(4, '10:00', '12:00')));
  assert.deepEqual(Object.keys(bad.rows).sort(), ['k0', 'k1', 'k3', 'k5']);
  assert.match(bad.rows.k3, /repetido/); assert.match(bad.rows.k5, /solapa/);
  assert.ok(scheduleErrors(rowsOf({ dia_semana: '8', hora_inicio: '09:00', hora_fin: '10:00' })).rows.k0, 'día fuera de 1–7');
  assert.ok(scheduleErrors(rowsOf(slot(1, '7:00', '10:00'))).rows.k0, 'la hora exige dos dígitos');
});

test('Horarios: un máximo de 21 tramos', () => {
  const many = Array.from({ length: MAX_SLOTS + 1 }, (_, i) => slot((i % 7) + 1, String(8 + Math.floor(i / 7) * 2).padStart(2, '0') + ':00', String(9 + Math.floor(i / 7) * 2).padStart(2, '0') + ':00'));
  assert.ok(scheduleErrors(rowsOf(...many)).general);
  assert.equal(scheduleErrors(rowsOf(...many.slice(0, MAX_SLOTS))).general, '');
});

test('Horarios: el cuerpo lleva números reales, la revisión y el conjunto completo; vacío es explícito', () => {
  assert.deepEqual(schedulePayload(rowsOf(slot(1, '19:00', '21:00')), 4), { revision: 4, horarios: [{ dia_semana: 1, hora_inicio: '19:00', hora_fin: '21:00' }] });
  assert.deepEqual(schedulePayload([], 9), { revision: 9, horarios: [] });
  assert.equal(Object.keys(schedulePayload(rowsOf(slot(1, '19:00', '21:00')), 4).horarios[0]).includes('id'), false);
});

test('Horarios: detecta cambios sin depender del orden ni de las claves', () => {
  const saved = [{ dia_semana: 1, hora_inicio: '19:00', hora_fin: '21:00' }, { dia_semana: 6, hora_inicio: '09:00', hora_fin: '12:00' }];
  assert.equal(scheduleChanged(draftFrom([saved[1], saved[0]]), saved), false);
  assert.equal(scheduleChanged(draftFrom([saved[0]]), saved), true);
  assert.equal(scheduleChanged([], []), false);
  assert.deepEqual(sortSlots(rowsOf(slot(6, '09:00', '10:00'), slot(1, '20:00', '21:00'), slot(1, '08:00', '09:00'))).map(r => r.key), ['k2', 'k1', 'k0']);
});

test('Horarios: la respuesta del servidor se valida antes de usarse', () => {
  assert.equal(parseSchedule(response)?.convocatoria.revision, 4);
  assert.equal(parseSchedule({ ...response, items: [{ ...response.items[0], hora_inicio: '7:00' }] }), null);
  assert.equal(parseSchedule({ ...response, convocatoria: { ...response.convocatoria, revision: 0 } }), null);
  assert.equal(parseSchedule({ ok: true, items: [] }), null);
  assert.equal(parseSchedule(null), null);
  assert.equal(parseSchedule({ ...response, cambios: false })?.cambios, false);
  assert.equal(describeSlot(response.items[0]), 'Lunes, de 19:00 a 21:00');
});

test('Horarios: los 422 señalan los tramos afectados; otras formas no se interpretan', () => {
  const rows = rowsOf(slot(2, '18:00', '20:00'), slot(2, '19:00', '21:00'), slot(5, '10:00', '09:00'));
  const overlap = serverScheduleIssue({ statusCode: 422, codigo: 'HORARIO_SOLAPADO', message: 'Hay horarios que se solapan el mismo día.', conflictos: [{ tipo: 'solapamiento', primero: { dia_semana: 2, hora_inicio: '18:00', hora_fin: '20:00' }, segundo: { dia_semana: 2, hora_inicio: '19:00', hora_fin: '21:00' } }] }, rows);
  assert.deepEqual(Object.keys(overlap.rows).sort(), ['k0', 'k1']); assert.match(overlap.message, /solapan/);
  const invalid = serverScheduleIssue({ codigo: 'HORARIO_INVALIDO', message: 'Hora de fin inválida.', tramos: [{ indice: 2, dia_semana: 5, hora_inicio: '10:00', hora_fin: '09:00' }] }, rows);
  assert.deepEqual(Object.keys(invalid.rows), ['k2']);
  const duplicate = serverScheduleIssue({ codigo: 'HORARIO_DUPLICADO', message: ['Repetido', 'otro'], conflictos: [{ tipo: 'duplicado', primero: { dia_semana: 2, hora_inicio: '18:00', hora_fin: '20:00' }, segundo: { dia_semana: 9 } }] }, rows);
  assert.equal(duplicate.message, 'Repetido · otro'); assert.deepEqual(Object.keys(duplicate.rows), ['k0']);
  for (const body of [null, 'texto', {}, { codigo: 'OTRO' }, { codigo: 'HORARIO_INVENTADO' }]) assert.equal(serverScheduleIssue(body, rows), null);
  assert.deepEqual(serverScheduleIssue({ codigo: 'HORARIO_INVALIDO', message: 'x', tramos: [{ indice: 99 }, 'raro'] }, rows).rows, {});
});
