import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createValidationPipe } from '../src/common/validation';
import type { PrismaService } from '../src/database/prisma.service';
import { ALL_PERMISSIONS } from '../src/permissions/permissions';
import { can, permissionsOf } from '../src/permissions/policy';
import { REPORT_CATALOG } from '../src/reportes/reportes.catalogo';
import { ReporteConsultaDto, ReporteExportacionDto } from '../src/reportes/reportes.dto';
import { COMMERCIAL_REPORT_TYPES, REPORT_TYPES } from '../src/reportes/reportes.types';
import { ReportesService } from '../src/reportes/reportes.service';
import { FORMAT_INFO, ReportesExportacionService } from '../src/reportes/reportes-exportacion.service';
import { renderCsv } from '../src/reportes/formatos/csv';

// Etapa 3: reportes comerciales y de atención. Todo es ficticio y en memoria: sin MySQL, red, correo ni OpenAI.
// El doble de Prisma EVALÚA los filtros que usan los reportes (período, moneda, estado, vigencia) sobre datos de ejemplo y solo devuelve las
// columnas pedidas en `select`: si un reporte pidiera datos personales, aparecerían en el documento y la prueba de privacidad fallaría.
const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const NOW = new Date('2026-10-19T15:30:00.000Z'); // lunes 10:30 en Lima; «hoy» = 2026-10-19
const d = (iso: string) => new Date(iso);
const dec = (value: string) => new Prisma.Decimal(value);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const SECRETS = ['Cliente Secreto', 'secreto@example.invalid', '999111222', '20123456789', 'Dirección Secreta', 'Asunto Secreto', 'Mensaje Secreto', 'Persona Secreta', 'persona@example.invalid', '988777666'];
const quote = (id: number, estado: string, moneda: string, validez: string, createdAt: string, total: string, extra: Record<string, unknown> = {}) => ({
  id, numero: 'COT-2026-' + String(id).padStart(6, '0'), estado, moneda, validez: d(validez + 'T00:00:00Z'), createdAt: d(createdAt), contacto_id: null as number | null,
  subtotal: dec(total), descuento: dec('0'), impuesto: dec('0'), total: dec(total),
  cliente: 'Cliente Secreto S.A.', email: 'secreto@example.invalid', telefono: '999111222', documento: '20123456789', direccion: 'Dirección Secreta 123', ...extra,
});
const QUOTES = [
  quote(1, 'borrador', 'PEN', '2026-12-01', '2026-10-01T15:00:00Z', '118.00', { subtotal: dec('100.00'), impuesto: dec('18.00'), contacto_id: 1 }),
  quote(2, 'enviada', 'PEN', '2026-10-18', '2026-09-10T15:00:00Z', '236.00', { contacto_id: 2 }),   // vencida ayer
  quote(3, 'enviada', 'PEN', '2026-10-19', '2026-10-02T15:00:00Z', '59.00'),                           // vence HOY: todavía vigente
  quote(4, 'enviada', 'USD', '2026-09-01', '2026-08-15T15:00:00Z', '1000.50'),                         // vencida
  quote(5, 'aceptada', 'PEN', '2026-11-01', '2026-10-05T15:00:00Z', '500.25', { contacto_id: 3 }),
  quote(6, 'aceptada', 'USD', '2026-11-01', '2026-10-06T15:00:00Z', '200.00'),
  quote(7, 'rechazada', 'PEN', '2026-09-30', '2026-09-30T04:59:00Z', '0.10'),                          // 2026-09-29 23:59 en Lima (septiembre)
  quote(8, 'anulada', 'PEN', '2026-10-30', '2026-10-01T05:00:00Z', '0.20'),                            // 2026-10-01 00:00 en Lima (octubre)
  quote(9, 'borrador', 'PEN', '2020-01-01', '2026-10-03T15:00:00Z', '10.00'),                          // borrador con fecha pasada: NO es «vencida»
  quote(10, 'enviada', 'PEN', '2026-07-01', '2026-06-01T15:00:00Z', '77.00'),                          // vencida desde julio
];
const inquiry = (id: number, estado: string, origen: string, createdAt: Date) => ({ id, estado, origen, createdAt, nombre: 'Persona Secreta', email: 'persona@example.invalid', telefono: '988777666', asunto: 'Asunto Secreto', mensaje: 'Mensaje Secreto' });
const INQUIRIES = [
  inquiry(1, 'nuevo', 'web', hoursAgo(100)),
  inquiry(2, 'nuevo', 'chatbot', hoursAgo(72)),       // el seguimiento la tiene «en_proceso»
  inquiry(3, 'en_proceso', 'web', hoursAgo(48)),      // exactamente 48 h: aún NO es antigua (debe pasar de 48 h)
  inquiry(4, 'nuevo', 'web', hoursAgo(47)),
  inquiry(5, 'atendido', 'web', hoursAgo(200)),
  inquiry(6, 'atendido', 'manual', hoursAgo(150)),    // contactos.estado «atendido» pero el seguimiento dice «archivado»
  inquiry(7, 'nuevo', 'web', hoursAgo(120)),          // el seguimiento la cerró («atendido»)
  inquiry(8, 'en_proceso', 'web', d('2026-09-15T15:00:00Z')),
];
const RECORDS = [
  { recurso: 'messages', registro_id: 2, estado: 'en_proceso' }, { recurso: 'messages', registro_id: 6, estado: 'archivado' }, { recurso: 'messages', registro_id: 7, estado: 'atendido' },
  { recurso: 'reclamaciones', registro_id: 1, estado: 'atendido' }, // otro recurso con el mismo número: no debe afectar a la consulta 1
];

interface FakeOptions { rol?: string | null; quotes?: typeof QUOTES; inquiries?: typeof INQUIRIES; records?: typeof RECORDS; forceQuoteCount?: number }
const inRange = (value: Date, cond: { gte?: Date; lt?: Date; lte?: Date } | undefined) => !cond || ((!cond.gte || value >= cond.gte) && (!cond.lt || value < cond.lt) && (!cond.lte || value <= cond.lte));
const pick = <T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) => select ? Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, row[k]])) : { ...row };

function fakePrisma(options: FakeOptions = {}) {
  const calls: Record<string, any[]> = {};
  const record = (name: string, args: unknown) => { (calls[name] ??= []).push(args); };
  const quotes = options.quotes ?? QUOTES, inquiries = options.inquiries ?? INQUIRIES, records = options.records ?? RECORDS;
  const quoteMatches = (where: any = {}) => quotes.filter(q => inRange(q.createdAt, where.createdAt) && (!where.moneda || q.moneda === where.moneda) && (!where.estado || q.estado === where.estado)
    && inRange(q.validez, where.validez));
  const sortBy = <T>(rows: T[], order: any) => { const keys = (Array.isArray(order) ? order : [order]).map((o: any) => Object.entries(o)[0] as [string, string]); return [...rows].sort((a: any, b: any) => { for (const [k, dir] of keys) { const x = a[k], y = b[k]; if (x < y) return dir === 'asc' ? -1 : 1; if (x > y) return dir === 'asc' ? 1 : -1; } return 0; }); };
  const tx = {
    cotizacion: {
      count: async (args: any) => { record('cotizacion.count', args); return options.forceQuoteCount ?? quoteMatches(args.where).length; },
      findMany: async (args: any) => { record('cotizacion.findMany', args); return sortBy(quoteMatches(args.where), args.orderBy ?? { id: 'asc' }).slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 1e9)).map(r => pick(r, args.select)); },
      groupBy: async (args: any) => {
        record('cotizacion.groupBy', args);
        const groups = new Map<string, any>();
        for (const q of quoteMatches(args.where)) {
          const key = args.by.map((k: string) => (q as any)[k]).join('|');
          const g = groups.get(key) ?? { ...Object.fromEntries(args.by.map((k: string) => [k, (q as any)[k]])), _count: { _all: 0 }, _sum: Object.fromEntries(Object.keys(args._sum ?? {}).map(k => [k, dec('0')])) };
          g._count._all++; for (const k of Object.keys(args._sum ?? {})) g._sum[k] = g._sum[k].add((q as any)[k]);
          groups.set(key, g);
        }
        return sortBy([...groups.values()], args.orderBy);
      },
      aggregate: async (args: any) => { record('cotizacion.aggregate', args); const rows = quoteMatches(args.where); return { _min: { validez: rows.length ? new Date(Math.min(...rows.map(r => r.validez.getTime()))) : null } }; },
    },
    contacto: {
      count: async (args: any) => { record('contacto.count', args); return inquiries.filter(i => inRange(i.createdAt, args.where?.createdAt)).length; },
      findMany: async (args: any) => { record('contacto.findMany', args); return sortBy(inquiries.filter(i => inRange(i.createdAt, args.where?.createdAt)), args.orderBy).slice(args.skip, args.skip + args.take).map(r => pick(r, args.select)); },
    },
    attentionRecord: {
      findMany: async (args: any) => { record('attentionRecord.findMany', args); return records.filter(r => r.recurso === args.where.recurso && args.where.registro_id.in.includes(r.registro_id)).map(r => pick(r, args.select)); },
    },
  };
  const prisma = {
    adminUser: { findUnique: async () => options.rol === undefined ? { rol: G } : options.rol === null ? null : { rol: options.rol } },
    $transaction: async (fn: (client: typeof tx) => unknown, opts: unknown) => { record('$transaction', opts); return fn(tx); },
  } as unknown as PrismaService;
  return { prisma, calls };
}
const query = (extra: Record<string, unknown> = {}) => Object.assign(new ReporteConsultaDto(), extra);
const run = async (tipo: (typeof REPORT_TYPES)[number], filters: Record<string, unknown> = {}, options: FakeOptions = {}) =>
  (await new ReportesService(fakePrisma(options).prisma).exportDocument(tipo, filters as never, 'csv', 1, NOW));
const rowsOf = (doc: Awaited<ReturnType<typeof run>>) => doc.tabla.filas;
const summaryOf = (doc: Awaited<ReturnType<typeof run>>) => Object.fromEntries(doc.resumen.map(x => [x.clave, x.valor]));

// ------------------------------------------------------------------------------------------------------------------------------
// 1. Cotizaciones por estado
test('Cotizaciones por estado: conteos, porcentajes y total correctos; todos los estados aparecen', async () => {
  const doc = await run('cotizaciones-por-estado');
  assert.deepEqual(rowsOf(doc).map(r => [r.estado, r.cantidad]), [['Borrador', 2], ['Enviada', 4], ['Aceptada', 2], ['Rechazada', 1], ['Anulada', 1]]);
  assert.equal(doc.tabla.totales?.cantidad, 10);
  assert.equal(rowsOf(doc).reduce((t, r) => t + (r.cantidad as number), 0), 10, 'la suma de las filas coincide con el total');
  assert.deepEqual(rowsOf(doc).map(r => r.porcentaje), [20, 40, 20, 10, 10]);
  assert.deepEqual(summaryOf(doc), { total: 10, abiertas: 6, aceptadas: 2, tasa_aceptacion: 20 });
  assert.equal(doc.datos_personales, false);
});

test('Cotizaciones por estado: el filtro de moneda separa soles y dólares', async () => {
  const pen = await run('cotizaciones-por-estado', { moneda: 'PEN' }), usd = await run('cotizaciones-por-estado', { moneda: 'USD' });
  assert.equal(pen.tabla.totales?.cantidad, 8); assert.equal(usd.tabla.totales?.cantidad, 2);
  assert.deepEqual(rowsOf(usd).map(r => r.cantidad), [0, 1, 1, 0, 0]);
  assert.deepEqual(pen.filtros.map(f => f.valor), ['Soles (PEN)']);
});

test('Filtros por fechas: usan días de Lima (23:59 del 29-sep es septiembre; 00:00 del 1-oct es octubre) y ambos extremos incluidos', async () => {
  const oct = await run('cotizaciones-por-estado', { desde: '2026-10-01', hasta: '2026-10-31' });
  assert.equal(oct.tabla.totales?.cantidad, 6, 'creadas 1-oct 00:00 (Lima) a 31-oct'); // 1,3,5,6,8,9
  const sep = await run('cotizaciones-por-estado', { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.equal(sep.tabla.totales?.cantidad, 2); // 2 (10-sep) y 7 (29-sep 23:59 Lima)
  const one = await run('cotizaciones-por-estado', { desde: '2026-10-01', hasta: '2026-10-01' });
  assert.deepEqual(rowsOf(one).map(r => r.cantidad), [1, 0, 0, 0, 1]); // 1 (borrador, 10:00 Lima) y 8 (anulada, 00:00 Lima)
  await assert.rejects(new ReportesService(fakePrisma().prisma).exportDocument('cotizaciones-por-estado', { desde: '2026-10-31', hasta: '2026-10-01' } as never, 'csv', 1, NOW), BadRequestException);
});

test('Períodos sin registros: ceros confirmados, sin porcentajes inventados ni errores', async () => {
  const doc = await run('cotizaciones-por-estado', { desde: '2030-01-01', hasta: '2030-01-31' });
  assert.deepEqual(rowsOf(doc).map(r => r.cantidad), [0, 0, 0, 0, 0]);
  assert.deepEqual(rowsOf(doc).map(r => r.porcentaje), [null, null, null, null, null]);
  assert.equal(doc.tabla.totales?.cantidad, 0); assert.equal(doc.tabla.totales?.porcentaje, null);
  assert.equal(summaryOf(doc).tasa_aceptacion, null);
  const venc = await run('cotizaciones-vencidas', { desde: '2030-01-01', hasta: '2030-01-31' });
  assert.equal(venc.tabla.total_filas, 0); assert.deepEqual(rowsOf(venc), []); assert.equal(summaryOf(venc).mayor_atraso, null); assert.equal(summaryOf(venc).importe_pen, 0);
  const imp = await run('cotizaciones-importes', { desde: '2030-01-01', hasta: '2030-01-31' });
  assert.deepEqual(rowsOf(imp), []); assert.equal(summaryOf(imp).aceptadas_pen, 0);
  const cons = await run('consultas-por-estado', { desde: '2030-01-01', hasta: '2030-01-31' });
  assert.deepEqual(rowsOf(cons).map(r => r.cantidad), [0, 0, 0, 0]); assert.equal(summaryOf(cons).porcentaje_cerradas, null);
  assert.deepEqual(rowsOf(await run('consultas-abiertas-antiguas', { desde: '2030-01-01', hasta: '2030-01-31' })), []);
  const act = await run('actividad-comercial', { desde: '2030-01-01', hasta: '2030-03-31' });
  assert.deepEqual(rowsOf(act).map(r => [r.mes, r.consultas, r.cotizaciones]), [['2030-01', 0, 0], ['2030-02', 0, 0], ['2030-03', 0, 0]]);
  assert.equal(act.tabla.totales?.consultas, 0);
  // Sin ningún dato en la base tampoco falla.
  const vacio = { quotes: [], inquiries: [], records: [] } as FakeOptions;
  for (const tipo of COMMERCIAL_REPORT_TYPES) assert.equal((await run(tipo, {}, vacio)).tabla.total_filas >= 0, true);
});

// ------------------------------------------------------------------------------------------------------------------------------
// 2. Cotizaciones vencidas
test('Cotizaciones vencidas: solo «enviada» con vigencia anterior a hoy (Lima); hoy no vence; un borrador con fecha pasada no cuenta', async () => {
  const doc = await run('cotizaciones-vencidas');
  assert.deepEqual(rowsOf(doc).map(r => r.numero), ['COT-2026-000010', 'COT-2026-000004', 'COT-2026-000002'], 'de la más atrasada a la más reciente');
  assert.deepEqual(rowsOf(doc).map(r => r.dias), [110, 48, 1]);
  assert.ok(!rowsOf(doc).some(r => r.numero === 'COT-2026-000003'), 'vence hoy: sigue vigente');
  assert.ok(!rowsOf(doc).some(r => r.numero === 'COT-2026-000009'), 'borrador: no es «vencida»');
  assert.deepEqual(rowsOf(doc).map(r => [r.moneda, r.total]), [['PEN', 77], ['USD', 1000.5], ['PEN', 236]]);
  assert.deepEqual(rowsOf(doc).map(r => r.consulta), ['No', 'No', 'Sí']);
  assert.equal(doc.tabla.total_filas, 3);
});

test('Cotizaciones vencidas: no mezcla monedas, filtra por vencimiento y pagina sin cambiar los totales', async () => {
  const doc = await run('cotizaciones-vencidas');
  assert.deepEqual(summaryOf(doc), { total: 3, importe_pen: 313, importe_usd: 1000.5, mayor_atraso: 110 });
  const usd = await run('cotizaciones-vencidas', { moneda: 'USD' });
  assert.deepEqual(rowsOf(usd).map(r => r.numero), ['COT-2026-000004']); assert.deepEqual(summaryOf(usd), { total: 1, importe_usd: 1000.5, mayor_atraso: 48 });
  const sept = await run('cotizaciones-vencidas', { desde: '2026-09-01', hasta: '2026-10-18' });
  assert.deepEqual(rowsOf(sept).map(r => r.numero), ['COT-2026-000004', 'COT-2026-000002'], 'el período filtra por la fecha de vencimiento');
  const page = await new ReportesService(fakePrisma().prisma).preview('cotizaciones-vencidas', query({ page: 2, limit: 2 }), 1, NOW);
  assert.deepEqual(page.reporte.tabla.filas.map(r => r.numero), ['COT-2026-000002']); assert.equal(page.pagination.total, 3); assert.equal(page.pagination.pages, 2);
  assert.deepEqual(summaryOf(page.reporte as never), summaryOf(doc), 'el resumen cubre todo el filtro, no solo la página');
});

// ------------------------------------------------------------------------------------------------------------------------------
// 3. Importes
test('Importes: agrupados por moneda y estado con suma decimal exacta y sin mezclar monedas ni presentarlos como ingresos', async () => {
  const doc = await run('cotizaciones-importes');
  assert.deepEqual(rowsOf(doc).map(r => [r.moneda, r.estado, r.cantidad, r.total]), [
    ['PEN', 'Borrador', 2, 128], ['PEN', 'Enviada', 3, 372], ['PEN', 'Aceptada', 1, 500.25], ['PEN', 'Rechazada', 1, 0.1], ['PEN', 'Anulada', 1, 0.2],
    ['USD', 'Enviada', 1, 1000.5], ['USD', 'Aceptada', 1, 200],
  ]);
  assert.equal(doc.tabla.totales, null, 'sin fila de totales: no se suman soles con dólares');
  assert.equal(rowsOf(doc).find(r => r.estado === 'Borrador')?.impuesto, 18);
  assert.deepEqual(summaryOf(doc), { cotizaciones: 10, cotizaciones_pen: 8, enviadas_pen: 372, aceptadas_pen: 500.25, cotizaciones_usd: 2, enviadas_usd: 1000.5, aceptadas_usd: 200 });
  assert.ok(doc.resumen.filter(x => x.tipo === 'importe').every(x => /no es ingreso|pendientes de respuesta/.test(x.etiqueta)), 'las etiquetas aclaran que no es ingreso');
  assert.ok(doc.notas.some(n => /No son ingresos recibidos ni ventas cobradas/.test(n)) && doc.notas.some(n => /nunca se suman monedas distintas/.test(n)));
  const aceptadas = await run('cotizaciones-importes', { estado: 'aceptada' });
  assert.deepEqual(rowsOf(aceptadas).map(r => [r.moneda, r.total]), [['PEN', 500.25], ['USD', 200]]);
  const usd = await run('cotizaciones-importes', { moneda: 'USD' });
  assert.ok(rowsOf(usd).every(r => r.moneda === 'USD')); assert.equal(Object.keys(summaryOf(usd)).some(k => k.endsWith('_pen')), false);
});

// ------------------------------------------------------------------------------------------------------------------------------
test('Importes: la suma usa decimales exactos (0,10 + 0,20 = 0,30) y no depende de la coma flotante', async () => {
  const quotes = [quote(1, 'enviada', 'PEN', '2026-12-01', '2026-10-01T15:00:00Z', '0.10'), quote(2, 'enviada', 'PEN', '2026-12-01', '2026-10-01T15:00:00Z', '0.20')];
  const doc = await run('cotizaciones-importes', {}, { quotes });
  assert.equal(rowsOf(doc)[0].total, 0.3); assert.equal(summaryOf(doc).enviadas_pen, 0.3); assert.equal(0.1 + 0.2 === 0.3, false);
});

// ------------------------------------------------------------------------------------------------------------------------------
// 4-5. Consultas de Atención
test('Consultas por estado: el estado efectivo es el del seguimiento (por recurso y registro), si no el de la consulta', async () => {
  const doc = await run('consultas-por-estado');
  assert.deepEqual(rowsOf(doc).map(r => [r.estado, r.cantidad]), [['Nuevo', 2], ['En proceso', 3], ['Atendido', 2], ['Archivado', 1]]);
  assert.equal(doc.tabla.totales?.cantidad, 8);
  // #2 «nuevo» → en proceso por el seguimiento; #6 «atendido» → archivado; #7 «nuevo» → atendido; #1 ignora el seguimiento de una reclamación.
  assert.deepEqual(summaryOf(doc), { total: 8, abiertas: 5, antiguas: 3, cerradas: 3, porcentaje_cerradas: 37.5 });
  assert.equal(rowsOf(doc).reduce((t, r) => t + (r.cantidad as number), 0), 8);
});

test('Consultas abiertas antiguas: solo nuevo o en proceso con MÁS de 48 horas; 48 h exactas no cuentan; ordenadas de la más antigua', async () => {
  const doc = await run('consultas-abiertas-antiguas');
  assert.deepEqual(rowsOf(doc).map(r => r.id), [8, 1, 2]);
  assert.deepEqual(rowsOf(doc).map(r => r.estado), ['En proceso', 'Nuevo', 'En proceso']);
  assert.equal(rowsOf(doc).find(r => r.id === 1)?.horas, 100); assert.equal(rowsOf(doc).find(r => r.id === 2)?.horas, 72);
  assert.ok(!rowsOf(doc).some(r => [3, 4].includes(r.id as number)), '48 h exactas y 47 h no son antiguas');
  assert.ok(!rowsOf(doc).some(r => [5, 6, 7].includes(r.id as number)), 'las cerradas no cuentan, aunque la consulta diga otra cosa');
  assert.deepEqual(rowsOf(doc).map(r => r.origen), ['Formulario web', 'Formulario web', 'Chatbot']);
  assert.deepEqual(summaryOf(doc), { total: 3, nuevo: 1, en_proceso: 2, mayor_antiguedad: Math.floor((NOW.getTime() - d('2026-09-15T15:00:00Z').getTime()) / 3_600_000) });
  assert.deepEqual(rowsOf(await run('consultas-abiertas-antiguas', { estado: 'nuevo' })).map(r => r.id), [1]);
  assert.deepEqual(rowsOf(await run('consultas-abiertas-antiguas', { estado: 'en_proceso' })).map(r => r.id), [8, 2]);
  assert.deepEqual(rowsOf(await run('consultas-abiertas-antiguas', { desde: '2026-10-10', hasta: '2026-10-19' })).map(r => r.id), [1, 2]);
  // Con el reloj movido 2 h, la de 47 h cruza el umbral: la antigüedad se calcula contra el momento de generar el reporte.
  const later = await new ReportesService(fakePrisma().prisma).exportDocument('consultas-abiertas-antiguas', {}, 'csv', 1, new Date(NOW.getTime() + 2 * 3_600_000));
  assert.deepEqual(later.tabla.filas.map(r => r.id), [8, 1, 2, 3, 4]);
});

// ------------------------------------------------------------------------------------------------------------------------------
// 6. Actividad por período
test('Actividad comercial y de atención: serie mensual de Lima con ceros, totales coherentes y estados vigentes', async () => {
  const doc = await run('actividad-comercial', { desde: '2026-06-01', hasta: '2026-10-31' });
  assert.deepEqual(rowsOf(doc).map(r => r.mes), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(rowsOf(doc).map(r => r.cotizaciones), [1, 0, 1, 2, 6]);
  assert.deepEqual(rowsOf(doc).map(r => r.consultas), [0, 0, 0, 1, 7]);
  assert.deepEqual(rowsOf(doc).map(r => r.cerradas), [0, 0, 0, 0, 3]);
  assert.deepEqual(rowsOf(doc).map(r => r.con_consulta), [0, 0, 0, 1, 2]);
  assert.deepEqual(rowsOf(doc).map(r => r.aceptadas), [0, 0, 0, 0, 2]);
  assert.deepEqual(doc.tabla.totales, { mes: 'Total', consultas: 8, cerradas: 3, cotizaciones: 10, con_consulta: 3, aceptadas: 2 });
  assert.ok(doc.notas.some(n => /estado vigente al generar/.test(n)));
  const sinFechas = await run('actividad-comercial');
  assert.equal(sinFechas.tabla.total_filas, 12, 'por defecto, los últimos 12 meses');
  assert.equal(sinFechas.periodo.hasta, '2026-10-19'); assert.equal(rowsOf(sinFechas)[0].mes, '2025-11');
});

// ------------------------------------------------------------------------------------------------------------------------------
// Permisos por rol
test('Permisos: el gerente consulta y exporta; la coordinadora consulta pero no exporta; la secretaría no accede a ninguno', async () => {
  for (const tipo of COMMERCIAL_REPORT_TYPES) {
    await new ReportesService(fakePrisma({ rol: G }).prisma).preview(tipo, query(), 1, NOW);
    await new ReportesService(fakePrisma({ rol: G }).prisma).exportDocument(tipo, {}, 'csv', 1, NOW);
    await new ReportesService(fakePrisma({ rol: C }).prisma).preview(tipo, query(), 1, NOW);
    await assert.rejects(new ReportesService(fakePrisma({ rol: C }).prisma).exportDocument(tipo, {}, 'csv', 1, NOW), ForbiddenException);
    for (const rol of [S, null, 'ADMIN']) {
      const { prisma, calls } = fakePrisma({ rol });
      await assert.rejects(new ReportesService(prisma).preview(tipo, query(), 1, NOW), ForbiddenException, tipo + ' consulta ' + String(rol));
      await assert.rejects(new ReportesService(prisma).exportDocument(tipo, {}, 'pdf', 1, NOW), ForbiddenException, tipo + ' exporta ' + String(rol));
      assert.equal(calls.$transaction, undefined, 'una cuenta sin permiso no llega a leer datos');
    }
  }
  const of = async (rol: string | null) => Object.fromEntries((await new ReportesService(fakePrisma({ rol }).prisma).catalog(1)).reportes.map(r => [r.tipo, [r.puede_consultar, r.puede_exportar, r.ambito]]));
  for (const tipo of COMMERCIAL_REPORT_TYPES) {
    assert.deepEqual((await of(G))[tipo], [true, true, 'comercial']); assert.deepEqual((await of(C))[tipo], [true, false, 'comercial']);
    assert.equal((await of(S))[tipo], undefined, 'el catálogo omite los reportes comerciales que la cuenta no puede consultar');
  }
  assert.deepEqual((await of(S)).resumen, [false, false, 'academico']);
});

test('Permisos: la matriz de roles no cambió (sin permisos nuevos, la secretaría no gana reportes ni cotizaciones, lo académico igual)', () => {
  assert.equal(ALL_PERMISSIONS.some(p => p.startsWith('reportes_comerciales')), false, 'no se creó un permiso nuevo');
  const secretaria = permissionsOf(S);
  assert.deepEqual(secretaria.filter(p => p.startsWith('reportes') || p.startsWith('cotizaciones') || p.startsWith('estadisticas')), []);
  assert.equal(can(S, 'reportes_academicos:leer'), false); assert.equal(can(S, 'reportes_academicos:exportar'), false);
  assert.equal(can(C, 'reportes_academicos:leer'), true); assert.equal(can(C, 'reportes_academicos:exportar'), false);
  assert.equal(can(G, 'reportes_academicos:exportar'), true);
  assert.deepEqual(REPORT_CATALOG.estudiantes.consultaRequiere, ['estudiantes:leer']); assert.deepEqual(REPORT_CATALOG.estudiantes.exportacionRequiere, ['estudiantes:exportar']);
  assert.deepEqual(REPORT_CATALOG.matriculas.consultaRequiere, ['matriculas:leer', 'estudiantes:leer']);
  assert.deepEqual(REPORT_CATALOG.matriculas.exportacionRequiere, ['estudiantes:exportar']);
  assert.deepEqual(REPORT_CATALOG.resumen.consultaRequiere, []); assert.deepEqual(REPORT_CATALOG.ocupacion.exportacionRequiere, []);
  // Cada reporte comercial exige el permiso de lectura de SU módulo además del acceso general a reportes.
  assert.deepEqual(REPORT_CATALOG['cotizaciones-vencidas'].consultaRequiere, ['cotizaciones:leer']);
  assert.deepEqual(REPORT_CATALOG['consultas-por-estado'].consultaRequiere, ['mensajes:leer', 'seguimiento_mensajes:leer']);
  assert.deepEqual(REPORT_CATALOG['actividad-comercial'].exportacionRequiere, ['cotizaciones:leer', 'mensajes:leer', 'seguimiento_mensajes:leer']);
});

// ------------------------------------------------------------------------------------------------------------------------------
// Protección de datos personales
test('Privacidad: ningún reporte pide ni expone cliente, correo, teléfono, documento, dirección, asunto ni mensaje', async () => {
  const { prisma, calls } = fakePrisma();
  const service = new ReportesService(prisma);
  for (const tipo of COMMERCIAL_REPORT_TYPES) {
    const doc = await service.exportDocument(tipo, {}, 'csv', 1, NOW);
    assert.equal(doc.datos_personales, false); assert.equal(REPORT_CATALOG[tipo].datosPersonales, false);
    const everything = JSON.stringify(doc) + renderCsv(doc).toString('utf8');
    for (const secret of SECRETS) assert.equal(everything.includes(secret), false, tipo + ' filtró «' + secret + '»');
    assert.equal(doc.tabla.columnas.some(c => /cliente|correo|email|tel[eé]fono|documento|dni|direcci|asunto|mensaje|nombre/i.test(c.clave + ' ' + c.titulo)), false, tipo);
  }
  const requested = [...(calls['cotizacion.findMany'] ?? []), ...(calls['contacto.findMany'] ?? []), ...(calls['attentionRecord.findMany'] ?? [])].flatMap(a => Object.keys(a.select ?? {}));
  for (const field of ['cliente', 'email', 'telefono', 'documento', 'direccion', 'nombre', 'asunto', 'mensaje', 'condiciones', 'conceptos', 'historial', 'notas', 'respuesta', 'responsable']) assert.equal(requested.includes(field), false, 'se pidió «' + field + '»');
  assert.ok(requested.length > 0);
});

// ------------------------------------------------------------------------------------------------------------------------------
// Exportación CSV, XLSX y PDF
function unzip(buffer: Buffer): Map<string, string> {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'falta el fin de directorio ZIP');
  const files = new Map<string, string>(); let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < buffer.readUInt16LE(eocd + 10); i++) {
    const compressed = buffer.readUInt32LE(offset + 20), nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    files.set(name, zlib.inflateRawSync(buffer.subarray(start, start + compressed)).toString('utf8'));
    offset += 46 + nameLength + extra + comment;
  }
  return files;
}

test('Exportación: CSV, XLSX y PDF válidos para los seis reportes, con las mismas filas y nombres de archivo seguros', async () => {
  const service = new ReportesExportacionService(new ReportesService(fakePrisma().prisma));
  for (const tipo of COMMERCIAL_REPORT_TYPES) {
    const doc = await new ReportesService(fakePrisma().prisma).exportDocument(tipo, {}, 'csv', 1, NOW);
    const csv = await service.export(tipo, Object.assign(new ReporteExportacionDto(), { formato: 'csv' }), 1, NOW);
    const xlsx = await service.export(tipo, Object.assign(new ReporteExportacionDto(), { formato: 'xlsx' }), 1, NOW);
    const pdf = await service.export(tipo, Object.assign(new ReporteExportacionDto(), { formato: 'pdf' }), 1, NOW);
    assert.equal(csv.contentType, 'text/csv; charset=utf-8'); assert.equal(csv.fileName, 'horus-reporte-' + tipo + '-20261019-1030.csv');
    assert.equal(xlsx.fileName, 'horus-reporte-' + tipo + '-20261019-1030.xlsx'); assert.equal(pdf.fileName, 'horus-reporte-' + tipo + '-20261019-1030.pdf');
    const text = csv.buffer.subarray(3).toString('utf8');
    assert.deepEqual([...csv.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(text.split('\r\n')[0], doc.tabla.columnas.map(c => c.titulo).join(';'));
    const dataLines = text.split('\r\n').slice(1, 1 + doc.tabla.filas.length);
    assert.equal(dataLines.length, doc.tabla.filas.length);
    const files = unzip(xlsx.buffer);
    assert.ok(files.has('xl/workbook.xml') && files.has('xl/styles.xml') && files.has('xl/worksheets/sheet1.xml') && files.has('xl/worksheets/sheet2.xml'));
    assert.equal((files.get('xl/worksheets/sheet2.xml')!.match(/<row /g) ?? []).length >= doc.tabla.filas.length + 1, true);
    assert.doesNotMatch(files.get('xl/worksheets/sheet2.xml')! + files.get('xl/worksheets/sheet1.xml')!, /<f>/, 'sin fórmulas');
    assert.equal(pdf.buffer.subarray(0, 5).toString('latin1'), '%PDF-'); assert.match(pdf.buffer.subarray(-32).toString('latin1'), /%%EOF/);
    assert.equal(pdf.contentType, 'application/pdf');
  }
});

test('Exportación: los importes se escriben con dos decimales en CSV y como números reales con formato 0.00 en XLSX; los enteros no cambian', async () => {
  const doc = await run('cotizaciones-importes');
  const csv = renderCsv(doc).subarray(3).toString('utf8');
  assert.match(csv, /PEN;Aceptada;1;500\.25;0\.00;0\.00;500\.25/); assert.match(csv, /USD;Enviada;1;1000\.50;0\.00;0\.00;1000\.50/);
  assert.match(csv, /Importe en propuestas aceptadas \(registro administrativo, no es ingreso cobrado\) — Soles \(PEN\);500\.25/);
  const xlsx = unzip(await FORMAT_INFO.xlsx.render(doc) as Buffer);
  const sheet = xlsx.get('xl/worksheets/sheet2.xml')!;
  assert.match(sheet, /<v>1000\.5<\/v>/); assert.match(xlsx.get('xl/styles.xml')!, /<xf numFmtId="2"/);
  assert.match(sheet, /<c r="G2" s="15"><v>/, 'importe con estilo 0.00');
  assert.match(csv, /Nota;Los importes son lo COTIZADO por escrito\. No son ingresos recibidos/);
});

test('Exportación: un volumen que supera el límite del PDF responde 422 sin generar archivo; la tabla se calcula una vez en una transacción de lectura', async () => {
  const many = Array.from({ length: 3001 }, (_, i) => quote(100 + i, 'enviada', 'PEN', '2026-01-01', '2026-01-01T15:00:00Z', '1.00'));
  const { prisma, calls } = fakePrisma({ quotes: many });
  const service = new ReportesExportacionService(new ReportesService(prisma));
  await assert.rejects(service.export('cotizaciones-vencidas', Object.assign(new ReporteExportacionDto(), { formato: 'pdf' }), 1, NOW), UnprocessableEntityException);
  assert.equal(calls['cotizacion.findMany'], undefined, 'no se leyeron filas antes de rechazar');
  const csv = await service.export('cotizaciones-vencidas', Object.assign(new ReporteExportacionDto(), { formato: 'csv' }), 1, NOW);
  assert.equal(csv.buffer.toString('utf8').split('\r\n').filter(l => l.startsWith('COT-2026-')).length, 3001, 'el CSV admite más filas que el PDF');
  assert.equal((calls.$transaction ?? []).length, 2); assert.equal(calls.$transaction[0].isolationLevel, Prisma.TransactionIsolationLevel.RepeatableRead);
  // El recorrido de consultas o cotizaciones para agregar tiene su propio tope (20 000): se pide acotar el período.
  const huge = fakePrisma({ forceQuoteCount: 20_001 });
  await assert.rejects(new ReportesService(huge.prisma).exportDocument('actividad-comercial', {}, 'csv', 1, NOW), UnprocessableEntityException);
});

// ------------------------------------------------------------------------------------------------------------------------------
// Validación de filtros y catálogo
const validate = (value: unknown, metatype: typeof ReporteConsultaDto | typeof ReporteExportacionDto) => createValidationPipe().transform(value, { type: 'query', metatype });

test('Filtros: moneda y estados se validan; los filtros que un reporte no admite responden 400 sin consultar', async () => {
  await assert.rejects(validate({ moneda: 'EUR' }, ReporteConsultaDto), BadRequestException);
  assert.equal(((await validate({ moneda: 'USD', page: '1', limit: '20' }, ReporteConsultaDto)) as ReporteConsultaDto).moneda, 'USD');
  await assert.rejects(validate({ formato: 'csv', moneda: 'pen' }, ReporteExportacionDto), BadRequestException);
  const { prisma, calls } = fakePrisma();
  const service = new ReportesService(prisma);
  await assert.rejects(service.preview('consultas-por-estado', query({ moneda: 'PEN' }), 1, NOW), (e: BadRequestException) => e.message.includes('moneda'));
  await assert.rejects(service.preview('consultas-abiertas-antiguas', query({ estado: 'atendido' }), 1, NOW), (e: BadRequestException) => e.message.includes('nuevo, en_proceso'));
  await assert.rejects(service.preview('cotizaciones-por-estado', query({ estado: 'enviada' }), 1, NOW), BadRequestException);
  await assert.rejects(service.preview('cotizaciones-vencidas', query({ estado: 'enviada' }), 1, NOW), BadRequestException);
  await assert.rejects(service.preview('cotizaciones-importes', query({ estado: 'nuevo' }), 1, NOW), (e: BadRequestException) => e.message.includes('borrador'));
  await assert.rejects(service.preview('actividad-comercial', query({ moneda: 'PEN' }), 1, NOW), BadRequestException);
  await assert.rejects(service.preview('cotizaciones-importes', query({ curso_id: 1 }), 1, NOW), BadRequestException);
  assert.equal(calls.$transaction, undefined);
});

test('Catálogo: los seis reportes comerciales se publican con su ámbito y filtros, tras los seis académicos que no cambian', async () => {
  const catalog = await new ReportesService(fakePrisma().prisma).catalog(1);
  assert.deepEqual(catalog.reportes.slice(6).map(r => r.tipo), [...COMMERCIAL_REPORT_TYPES]);
  assert.deepEqual(catalog.reportes.slice(6).map(r => r.ambito), Array(6).fill('comercial'));
  assert.ok(catalog.reportes.slice(6).every(r => r.datos_personales === false));
  assert.deepEqual(catalog.reportes.find(r => r.tipo === 'cotizaciones-importes')!.filtros, ['desde', 'hasta', 'moneda', 'estado']);
  assert.deepEqual(catalog.reportes.find(r => r.tipo === 'cotizaciones-importes')!.estados, ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada']);
  assert.deepEqual(catalog.limites.filas_exportacion, { csv: 20000, xlsx: 20000, pdf: 3000 });
});

test('Regresión académica: los reportes académicos siguen exigiendo lo mismo y los formatos conservan los decimales de un dígito', async () => {
  const service = new ReportesService(fakePrisma({ rol: S }).prisma);
  for (const tipo of ['estudiantes', 'matriculas', 'ocupacion', 'resumen'] as const) await assert.rejects(service.preview(tipo, query(), 1, NOW), (e: ForbiddenException) => e instanceof ForbiddenException && !/comercial/.test(e.message));
  await assert.rejects(new ReportesService(fakePrisma({ rol: C }).prisma).exportDocument('estudiantes', {}, 'csv', 1, NOW), ForbiddenException);
  const doc = { ...(await run('cotizaciones-por-estado')), tipo: 'resumen' as const };
  assert.match(renderCsv({ ...doc, resumen: [{ clave: 'x', etiqueta: 'Porcentaje', valor: 75, tipo: 'decimal' }] }).toString('utf8'), /Porcentaje;75\.0/);
});

// ------------------------------------------------------------------------------------------------------------------------------
// Catálogo filtrado por permisos efectivos. La matriz real no tiene un rol con reportes_academicos:leer sin cotizaciones o mensajes, así
// que se simula con un permiso retirado SOLO durante la prueba (la matriz no se modifica; se restaura siempre).
const ACADEMIC_TYPES = REPORT_TYPES.filter(t => !(COMMERCIAL_REPORT_TYPES as readonly string[]).includes(t));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const policyModule = require('../src/permissions/policy') as { can: (role: unknown, permission: unknown) => boolean };
async function withoutPermissions<T>(denied: string[], fn: () => Promise<T>): Promise<T> {
  const original = policyModule.can;
  policyModule.can = (role, permission) => !denied.includes(String(permission)) && original(role, permission);
  try { return await fn(); } finally { policyModule.can = original; }
}
const catalogTypes = async (rol: string | null, calls?: { prisma: PrismaService }) => (await new ReportesService((calls ?? fakePrisma({ rol })).prisma).catalog(1)).reportes.map(r => r.tipo);

test('Catálogo filtrado: gerencia y coordinación ven los seis reportes comerciales y los seis académicos', async () => {
  for (const rol of [G, C]) {
    const tipos = await catalogTypes(rol);
    assert.deepEqual(tipos.slice(0, 6), ACADEMIC_TYPES); assert.deepEqual(tipos.slice(6), [...COMMERCIAL_REPORT_TYPES]);
  }
});

test('Catálogo filtrado: secretaría sigue sin acceso (el guard exige reportes_academicos:leer) y su matriz no cambió', () => {
  assert.equal(can(S, 'reportes_academicos:leer'), false);
  assert.equal(can(S, 'cotizaciones:leer'), false);
});

test('Catálogo filtrado: sin cotizaciones:leer se omiten los reportes de cotizaciones y la actividad; los de consultas quedan', async () => {
  await withoutPermissions(['cotizaciones:leer'], async () => {
    const tipos = await catalogTypes(G);
    assert.deepEqual(tipos.slice(0, 6), ACADEMIC_TYPES, 'los académicos no se filtran');
    assert.deepEqual(tipos.slice(6), ['consultas-por-estado', 'consultas-abiertas-antiguas']);
  });
});

test('Catálogo filtrado: sin mensajes:leer o seguimiento_mensajes:leer se omiten las consultas y la actividad; las cotizaciones quedan', async () => {
  for (const denied of ['mensajes:leer', 'seguimiento_mensajes:leer']) {
    await withoutPermissions([denied], async () => {
      const tipos = await catalogTypes(G);
      assert.deepEqual(tipos.slice(0, 6), ACADEMIC_TYPES);
      assert.deepEqual(tipos.slice(6), ['cotizaciones-por-estado', 'cotizaciones-vencidas', 'cotizaciones-importes'], denied);
    });
  }
  await withoutPermissions(['cotizaciones:leer', 'mensajes:leer'], async () => assert.deepEqual(await catalogTypes(G), ACADEMIC_TYPES));
});

test('Catálogo filtrado: los reportes académicos conservan sus banderas y no desaparecen aunque la cuenta no pueda consultarlos', async () => {
  // Con permisos académicos retirados el reporte sigue listado con puede_consultar=false (comportamiento anterior).
  await withoutPermissions(['estudiantes:leer', 'matriculas:leer'], async () => {
    const catalog = await new ReportesService(fakePrisma({ rol: G }).prisma).catalog(1);
    const byType = Object.fromEntries(catalog.reportes.map(r => [r.tipo, r.puede_consultar]));
    assert.deepEqual(catalog.reportes.slice(0, 6).map(r => r.tipo), ACADEMIC_TYPES);
    for (const tipo of ['estudiantes', 'matriculas'] as const) assert.equal(byType[tipo], false, tipo);
    for (const tipo of ['ediciones', 'ocupacion', 'matriculas-por-edicion', 'resumen'] as const) assert.equal(byType[tipo], true, tipo);
  });
  const tal = await new ReportesService(fakePrisma({ rol: G }).prisma).catalog(1);
  assert.deepEqual(tal.reportes.slice(0, 6).map(r => [r.tipo, r.puede_consultar, r.puede_exportar]), ACADEMIC_TYPES.map(t => [t, true, true]));
});

test('Catálogo filtrado: no lee datos de negocio, no abre transacciones y no modifica el catálogo estático', async () => {
  const before = JSON.stringify(REPORT_CATALOG);
  const fake = fakePrisma({ rol: G });
  await withoutPermissions(['cotizaciones:leer'], () => new ReportesService(fake.prisma).catalog(1));
  await new ReportesService(fake.prisma).catalog(1);
  assert.deepEqual(Object.keys(fake.calls), [], 'el catálogo solo consulta el rol: ni transacciones ni tablas de negocio');
  assert.equal(JSON.stringify(REPORT_CATALOG), before);
  assert.equal(Object.isFrozen(REPORT_CATALOG), true);
});

test('Autorización real: sin el permiso del módulo comercial, el endpoint JSON y la exportación CSV, XLSX y PDF responden 403 sin leer datos', async () => {
  const denied: Record<string, string[]> = { 'cotizaciones:leer': ['cotizaciones-por-estado', 'cotizaciones-vencidas', 'cotizaciones-importes', 'actividad-comercial'],
    'mensajes:leer': ['consultas-por-estado', 'consultas-abiertas-antiguas', 'actividad-comercial'] };
  for (const [permission, tipos] of Object.entries(denied)) {
    await withoutPermissions([permission], async () => {
      for (const tipo of tipos as (typeof REPORT_TYPES)[number][]) {
        const { prisma, calls } = fakePrisma({ rol: G });
        const service = new ReportesService(prisma);
        await assert.rejects(service.preview(tipo, query(), 1, NOW), ForbiddenException, tipo + ' JSON');
        for (const formato of ['csv', 'xlsx', 'pdf'] as const) {
          await assert.rejects(new ReportesExportacionService(service).export(tipo, Object.assign(new ReporteExportacionDto(), { formato }), 1, NOW), ForbiddenException, tipo + ' ' + formato);
        }
        assert.equal(calls.$transaction, undefined, tipo + ': no se llegó a leer datos');
      }
    });
  }
  // Un reporte comercial cuyo módulo sí está permitido sigue funcionando para esa cuenta.
  await withoutPermissions(['cotizaciones:leer'], async () => {
    const ok = await new ReportesService(fakePrisma({ rol: G }).prisma).preview('consultas-por-estado', query(), 1, NOW);
    assert.equal(ok.ok, true);
  });
});
