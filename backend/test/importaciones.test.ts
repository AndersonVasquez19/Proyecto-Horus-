import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { readCsv, mapCsv, detectMapping, forbiddenColumn } from '../src/importaciones/csv';
import { ConfirmarImportacionDto } from '../src/importaciones/importaciones.dto';

const file = (text: string, encoding: BufferEncoding = 'utf8') => ({ nombre: 'ficticio.csv', mime: 'text/csv', contenido: Buffer.from(text, encoding).toString('base64') });
test('CSV: coma, punto y coma, tabulador, ceros iniciales, comillas y saltos de línea', () => {
  for (const delimiter of [',', ';', '\t']) {
    const r = mapCsv({ ...file(['DNI', 'Nombres', 'Apellidos'].join(delimiter) + '\r\n' + ['00123456', 'Ana', 'Ficticia'].join(delimiter)), codificacion: 'auto', encabezado: 1 });
    assert.equal(r.data[0].cells[0], '00123456'); assert.equal(r.mapeo.doc_numero, 0);
  }
  assert.deepEqual(readCsv(file('DNI,Nombres,Apellidos\n00123456,"Ana\nMaría","Ficticia, Pérez"')).rows[1], ['00123456', 'Ana\nMaría', 'Ficticia, Pérez']);
});
test('CSV: UTF-8 BOM, UTF-16LE, Windows-1252 y detección de encabezados', () => {
  for (const f of [file('\ufeffDNI;Nombres;Apellidos\n00123456;María;Ficticia'), file('\ufeffDNI;Nombres;Apellidos\n00123456;María;Ficticia', 'utf16le'), file('DNI;Nombres;Apellidos\n00123456;María;Ficticia', 'latin1')]) assert.equal(readCsv(f).rows[1][1], 'María');
  assert.equal(readCsv(file('Curso de prueba\nDNI;Nombres;Apellidos\n00123456;Ana;Ficticia')).encabezado, 2);
});
test('CSV: vacío, corrupto, binario, ZIP, fórmulas en cabecera, tamaños y formatos rechazados', () => {
  for (const text of ['', '   ', 'DNI;Nombres;Apellidos\n"sin cerrar', 'DNI;Nombres;Apellidos\nabc"d', 'PK\x03\x04', '\x00binario', '<html>']) assert.throws(() => readCsv(file(text)));
  assert.throws(() => readCsv({ ...file('texto'), nombre: 'falso.xlsx' }));
  assert.throws(() => readCsv({ ...file('texto'), mime: 'application/zip' }));
  assert.throws(() => readCsv(file('a'.repeat(49153))));
  assert.throws(() => mapCsv({ ...file('DNI;Nombres;=CMD()\n00123456;Ana;Test'), encabezado: 1, codificacion: 'auto' }));
  assert.throws(() => readCsv(file(Array(42).fill('col').join(';'))));
  assert.throws(() => mapCsv({ ...file('DNI;Nombres;Apellidos\n' + Array(201).fill('00123456;Ana;Test').join('\n')), encabezado: 1, codificacion: 'auto' }));
});
test('CSV: mapeo manual, faltantes, duplicados y columnas reservadas', () => {
  const dto = { ...file('Identidad;Primero;Familia\n00123456;Ana;Ficticia'), encabezado: 1, codificacion: 'auto' };
  assert.throws(() => mapCsv(dto));
  assert.equal(mapCsv({ ...dto, mapeo: { doc_numero: 0, nombres: 1, apellidos: 2 } }).data.length, 1);
  assert.throws(() => mapCsv({ ...dto, mapeo: { doc_numero: 0, nombres: 1, apellidos: 1 } }));
  assert.throws(() => mapCsv({ ...dto, nombre: 'x.csv', contenido: file('DNI;Nota;Apellidos\n00123456;Ana;Test').contenido, mapeo: { doc_numero: 0, nombres: 1, apellidos: 2 } }));
  assert.equal(detectMapping(['DNI', 'DNI', 'Nombres', 'Apellidos']).doc_numero, undefined);
  for (const column of ['Código de registro', 'COD. REGISTRO', 'Código registro', 'Pago', 'NOTA', 'Certificación']) assert.equal(forbiddenColumn(column), true);
});
test('confirmación exige true booleano y comprobante; no admite coerción', () => {
  for (const confirmar of [undefined, false, 'true', 1]) assert.ok(validateSync(plainToInstance(ConfirmarImportacionDto, { confirmar })).some(e => e.property === 'confirmar'));
});
