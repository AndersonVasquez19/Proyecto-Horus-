import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editionErrors, editionPayload, editionForm, EMPTY_EDITION, editionActions } from '../src/panel/services/editions.ts';

const form = { ...EMPTY_EDITION, curso_id: '1', nombre: ' Noviembre ', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: '20' };
test('Ediciones: formulario exige curso, fechas reales y capacidad entera sin cambiar el día', () => {
  assert.deepEqual(editionErrors(form), {});
  for (const patch of [{ curso_id: '' }, { nombre: ' ' }, { fecha_inicio: '2026-02-29' }, { fecha_fin: '2026-10-31' }, { capacidad: '0' }, { capacidad: '2.5' }, { capacidad: 'abc' }, { capacidad: '2147483648' }]) assert.ok(Object.keys(editionErrors({ ...form, ...patch })).length);
  assert.deepEqual(editionPayload(form), { curso_id: 1, nombre: 'Noviembre', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 });
  const edited = editionPayload(form, 2);
  assert.equal(edited.revision, 2); assert.equal('curso_id' in edited, false); assert.equal('estado' in edited, false);
});
test('Ediciones: filas anteriores sin capacidad se conservan; acciones terminales no se ofrecen', () => {
  assert.equal(editionForm({ ...form, capacidad: null }).capacidad, '');
  const can = () => true;
  assert.deepEqual(editionActions({ estado: 'planificada', archivado_at: null }, can), ['open', 'cancel']);
  assert.deepEqual(editionActions({ estado: 'abierta', archivado_at: null }, can), ['close', 'cancel']);
  assert.deepEqual(editionActions({ estado: 'cerrada', archivado_at: null }, can), ['archive']);
  assert.deepEqual(editionActions({ estado: 'cancelada', archivado_at: 'now' }, can), ['restore']);
  assert.deepEqual(editionActions({ estado: 'planificada', archivado_at: null }, () => false), []);
  assert.deepEqual(editionActions({ estado: 'abierta', archivado_at: null }, p => p === 'convocatorias:editar'), []);
});
test('Ediciones: renombrar una planificada anterior conserva fechas y capacidad sin definir', () => {
  const previous = { curso_id: 1, nombre: 'Anterior', fecha_inicio: null, fecha_fin: null, capacidad: null };
  const draft = { ...editionForm(previous), nombre: 'Anterior renombrada' };
  assert.deepEqual(editionErrors(draft, previous), {});
  assert.deepEqual(editionPayload(draft, 1, previous), { nombre: 'Anterior renombrada', revision: 1 });
  assert.ok(editionErrors({ ...draft, capacidad: '' }).capacidad, 'un alta nueva sigue exigiendo capacidad');
  const configured = { ...previous, fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20 };
  assert.ok(editionErrors({ ...editionForm(configured), capacidad: '' }, configured).capacidad, 'no se puede retirar una capacidad definida');
});
