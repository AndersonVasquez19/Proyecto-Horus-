import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatDate, formatTime, isClockTime, limaClock, limaToUtc, parseDate, parseTime, ZONA_HORARIA } from '../src/common/lima-time';

// Hora de pared de America/Lima (common/lima-time.ts), compartida por Horarios y HORUS Assistant. Trasladadas desde las pruebas del
// módulo de Sesiones, retirado: las conversiones no pueden depender de la zona horaria del proceso ni de MySQL.
test('lima-time: Lima es UTC-5 todo el año y la conversión no depende de la zona del proceso', () => {
  const zones = ['UTC', 'Asia/Tokyo', 'Pacific/Auckland', 'America/Los_Angeles', 'America/Lima', 'Europe/Madrid'];
  const original = process.env.TZ;
  try {
    const results = zones.map(zone => {
      process.env.TZ = zone;
      return JSON.stringify([
        limaToUtc('2026-11-05', '14:00').toISOString(), limaToUtc('2026-07-01', '00:00').toISOString(), limaToUtc('2027-12-31', '23:59').toISOString(), limaToUtc('2028-02-29', '12:30').toISOString(),
        limaClock(new Date('2026-11-05T19:00:00Z')), limaClock(new Date('2026-11-06T04:59:59Z')), limaClock(new Date('2026-11-06T05:00:00Z')), limaClock(new Date('2026-01-01T04:59:00Z')),
      ]);
    });
    assert.equal(new Set(results).size, 1, 'mismo resultado con cualquier TZ del sistema');
    process.env.TZ = 'Pacific/Auckland';
    assert.notEqual(new Date(2026, 0, 1).getTimezoneOffset(), 300, 'el cambio de TZ del proceso está activo');
    assert.equal(limaToUtc('2026-11-05', '14:00').toISOString(), '2026-11-05T19:00:00.000Z');
    assert.equal(limaToUtc('2026-07-01', '00:00').toISOString(), '2026-07-01T05:00:00.000Z', 'sin horario de verano: julio igual que enero');
    assert.equal(limaToUtc('2027-12-31', '23:59').toISOString(), '2028-01-01T04:59:00.000Z', 'la medianoche local cae en el día siguiente en UTC');
    assert.deepEqual(limaClock(new Date('2026-11-06T04:59:59Z')), { fecha: '2026-11-05', hora: '23:59' });
    assert.deepEqual(limaClock(new Date('2026-11-06T05:00:00Z')), { fecha: '2026-11-06', hora: '00:00' }, 'la hora 24 no existe: medianoche = 00:00');
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('lima-time: horas HH:MM y conversiones con DATE/TIME de la base sin desplazar el día', () => {
  for (const good of ['00:00', '09:05', '23:59']) assert.equal(isClockTime(good), true, good);
  for (const bad of ['24:00', '9:00', '14:60', '14:00:00', '1400', '', ' 14:00', '14:00 ', null, 1400]) assert.equal(isClockTime(bad), false, String(bad));
  const day = parseDate('2026-11-05');
  assert.equal(day.toISOString(), '2026-11-05T00:00:00.000Z'); assert.equal(formatDate(day), '2026-11-05');
  const value = parseTime('14:30');
  assert.equal(value.toISOString(), '1970-01-01T14:30:00.000Z'); assert.equal(formatTime(value), '14:30');
  assert.equal(formatTime(parseTime('00:00')), '00:00'); assert.equal(formatTime(parseTime('23:59')), '23:59');
  assert.equal(ZONA_HORARIA, 'America/Lima');
});
