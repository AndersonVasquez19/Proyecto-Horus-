import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { enrollmentPayload, canEnroll, enrollmentActions } from '../src/panel/services/enrollments.ts';

const edition = { id: 2, revision: 3, estado: 'abierta', archivado_at: null, capacidad: 1, disponibles: 1 };
test('solo ediciones abiertas sin archivar, con capacidad definida y cupos', () => {
  assert.equal(canEnroll(edition), true);
  for (const patch of [{ capacidad: null }, { disponibles: 0 }, { estado: 'cerrada' }, { estado: 'cancelada' }, { estado: 'planificada' }, { archivado_at: '2026-01-01' }]) assert.equal(canEnroll({ ...edition, ...patch }), false);
});
test('alta usa estudiantes existentes y revisión de la edición elegida', () => {
  assert.deepEqual(enrollmentPayload({ id: 9 }, edition), { estudiante_id: 9, convocatoria_id: 2, convocatoria_revision: 3 });
});
test('anulación y reactivación respetan permisos sin ampliar secretaría', () => {
  assert.deepEqual(enrollmentActions({ estado: 'activa' }, () => true), ['annul']);
  assert.deepEqual(enrollmentActions({ estado: 'anulada' }, () => true), ['reactivate']);
  const secretary = p => ['matriculas:leer', 'matriculas:crear', 'matriculas:editar'].includes(p);
  for (const estado of ['activa', 'anulada']) assert.deepEqual(enrollmentActions({ estado }, secretary), []);
});
test('el smoke de matrículas rechaza destinos reales por entorno antes de iniciar navegador', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/smoke-matriculas.cjs', import.meta.url))], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MATRICULAS_API_URL: 'http://127.0.0.1:3000/api', SMOKE_BROWSER: 'inexistente' },
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /API real solo por IPC/);
});
