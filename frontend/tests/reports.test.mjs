import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTERS, downloadErrorText, downloadFileName, exportQuery, filterErrors, formatCell, formatSummary, parseCatalog, parseReportPage, reportQuery, sameFilters } from '../src/panel/services/reports.ts';

const entry = { tipo: 'ocupacion', titulo: 'Ocupación de cupos', descripcion: 'x', filtros: ['desde', 'hasta', 'curso_id', 'convocatoria_id', 'estado', 'archivo'], estados: ['planificada', 'abierta'], datos_personales: false, ambito: 'academico', puede_consultar: true, puede_exportar: true };
const f = patch => ({ ...EMPTY_FILTERS, ...patch });
const page = { ok: true, reporte: { tipo: 'ocupacion', titulo: 'Ocupación', descripcion: '', institucion: 'Horus', generado_local: '2026-10-23 10:00', periodo: { desde: null, hasta: null, etiqueta: 'Todo el historial' }, filtros: [], resumen: [], notas: [], datos_personales: false, tabla: { titulo: 'T', columnas: [{ clave: 'a', titulo: 'A', tipo: 'entero', ancho: 5 }], filas: [{ a: 1 }], totales: null, total_filas: 1 } }, pagination: { page: 1, limit: 20, total: 1, pages: 1 } };

test('Reportes: la consulta solo lleva los filtros que el reporte declara y que tienen valor', () => {
  assert.equal(reportQuery(entry, f({ desde: '2026-01-01', estado: 'abierta', agrupar: 'curso', moneda: 'PEN', cumplimiento: 'pendiente' }), { page: 2, limit: 20 }).toString(), 'desde=2026-01-01&estado=abierta&page=2&limit=20');
  assert.equal(reportQuery(entry, EMPTY_FILTERS).toString(), '');
});

test('Reportes: la exportación no lleva paginación y el separador solo va en CSV', () => {
  const filters = f({ hasta: '2026-12-31', curso_id: '3' });
  assert.equal(exportQuery(entry, filters, 'csv', 'coma').toString(), 'hasta=2026-12-31&curso_id=3&formato=csv&separador=coma');
  assert.equal(exportQuery(entry, filters, 'xlsx', 'coma').toString(), 'hasta=2026-12-31&curso_id=3&formato=xlsx');
  assert.equal(exportQuery(entry, filters, 'pdf', 'punto_y_coma').has('separador'), false);
  for (const format of ['csv', 'xlsx', 'pdf']) { const query = exportQuery(entry, filters, format, 'coma'); assert.equal(query.has('page') || query.has('limit'), false, format); }
});

test('Reportes: el período se valida como lo hace el servidor', () => {
  assert.deepEqual(filterErrors(entry, f({ desde: '2026-01-01', hasta: '2026-01-31' })), {});
  assert.ok(filterErrors(entry, f({ desde: '2026-02-30' })).desde);
  assert.ok(filterErrors(entry, f({ desde: '2026-03-01', hasta: '2026-02-01' })).hasta);
  assert.ok(filterErrors(entry, f({ desde: '2000-01-01', hasta: '2026-01-01' })).hasta, 'más de 3660 días');
  assert.deepEqual(filterErrors(entry, f({ desde: '2016-01-01', hasta: '2026-01-01' })), {}, 'diez años caben');
  assert.deepEqual(filterErrors({ filtros: [] }, f({ desde: 'basura' })), {}, 'un filtro que el reporte no admite no se valida ni se envía');
  assert.equal(sameFilters(f({ desde: '2026-01-01' }), f({ desde: '2026-01-01' })), true);
  assert.equal(sameFilters(f({ desde: '2026-01-01' }), f({})), false);
});

test('Reportes: las celdas se formatean según su tipo y un dato ausente no se convierte en cero', () => {
  assert.equal(formatCell(1234, 'entero'), '1,234'); assert.equal(formatCell(66.7, 'decimal'), '66.7'); assert.equal(formatCell(1500, 'importe'), '1,500.00');
  assert.equal(formatCell('2026-10-19', 'fecha'), '19/10/2026'); assert.equal(formatCell('2026-10-19 10:30', 'fecha_hora'), '19/10/2026 10:30');
  assert.equal(formatCell(null, 'entero'), '—'); assert.equal(formatCell(undefined, 'texto'), '—'); assert.equal(formatCell(0, 'entero'), '0');
  assert.equal(formatCell('=SUMA(A1)', 'texto'), '=SUMA(A1)', 'se muestra literal: en pantalla no hay fórmulas');
  assert.equal(formatSummary({ clave: 'x', etiqueta: 'X', valor: null, tipo: 'decimal' }), 'No aplica'); assert.equal(formatSummary({ clave: 'x', etiqueta: 'X', valor: 40, tipo: 'decimal' }), '40.0');
});

test('Reportes: el nombre del archivo es el del servidor, saneado, o uno propio', () => {
  const now = new Date('2026-10-23T15:00:00Z');
  assert.equal(downloadFileName('attachment; filename="horus-reporte-ocupacion-20261023-1000.xlsx"', 'ocupacion', 'xlsx', now), 'horus-reporte-ocupacion-20261023-1000.xlsx');
  assert.equal(downloadFileName(null, 'ocupacion', 'pdf', now), 'horus-reporte-ocupacion-20261023.pdf');
  assert.equal(downloadFileName('attachment', 'resumen', 'csv', now), 'horus-reporte-resumen-20261023.csv');
  for (const hostile of ['attachment; filename="../../etc/passwd"', 'attachment; filename="..\\..\\x.csv"', 'attachment; filename=".."', 'attachment; filename="a/b.csv"']) {
    const name = downloadFileName(hostile, 'resumen', 'csv', now);
    assert.doesNotMatch(name, /[\\/]|\.\./, hostile);
  }
  assert.equal(downloadFileName("attachment; filename*=UTF-8''reporte%20%C3%B1.csv", 'resumen', 'csv', now), 'reporte ñ.csv');
  assert.equal(downloadFileName('attachment; filename="x"', 'a<b>c', 'csv', now), 'x');
});

test('Reportes: los errores de descarga son mensajes seguros por estado', () => {
  assert.match(downloadErrorText(422, 'El reporte tiene 25000 filas y el máximo para el formato PDF es 3000.'), /25000 filas.*Acota/);
  assert.match(downloadErrorText(429, 'Hay otras exportaciones en curso.'), /otras exportaciones/);
  assert.match(downloadErrorText(500, 'Internal server error: SELECT * FROM x'), /servidor no pudo/);
  assert.doesNotMatch(downloadErrorText(500, 'Internal server error: SELECT * FROM x'), /SELECT|Internal/);
  assert.match(downloadErrorText(503, 'detalle'), /no está disponible/);
  assert.match(downloadErrorText(404, { objeto: 1 }), /No se pudo generar/);
  assert.match(downloadErrorText(400, ['Fecha inválida', 'Otra']), /Fecha inválida · Otra/);
});

test('Reportes: el catálogo y la página se validan antes de usarse', () => {
  assert.ok(parseCatalog({ ok: true, formatos: ['csv'], limites: { filas_exportacion: { csv: 1 }, filas_por_pagina: 100 }, reportes: [entry] }));
  for (const bad of [null, { reportes: 'no' }, { formatos: [], limites: {}, reportes: [{ ...entry, ambito: 'otro' }] }, { formatos: [], limites: {}, reportes: [{ ...entry, tipo: '../x' }] }, { formatos: [], limites: {}, reportes: [{ ...entry, filtros: 'desde' }] }]) assert.equal(parseCatalog(bad), null);
  assert.ok(parseReportPage(page));
  assert.equal(parseReportPage({ ...page, reporte: { ...page.reporte, tabla: { ...page.reporte.tabla, columnas: [{ clave: 'a', titulo: 'A', tipo: 'inventado' }] } } }), null);
  assert.equal(parseReportPage({ ...page, pagination: { page: 1 } }), null);
  assert.equal(parseReportPage({ ok: true }), null);
});
