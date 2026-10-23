import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { createValidationPipe } from '../src/common/validation';
import type { PrismaService } from '../src/database/prisma.service';
import { ReporteConsultaDto, ReporteExportacionDto, ReporteTipoDto } from '../src/reportes/reportes.dto';
import { MAX_CONCURRENT_EXPORTS, MAX_EXPORT_ROWS, MAX_RANGE_DAYS } from '../src/reportes/reportes.limites';
import { monthsBetween, resolvePeriod } from '../src/reportes/reportes.periodo';
import { ReportesService } from '../src/reportes/reportes.service';
import { FORMAT_INFO, ReportesExportacionService } from '../src/reportes/reportes-exportacion.service';
import { renderCsv } from '../src/reportes/formatos/csv';
import { renderXlsx, excelSerial, columnName, sheetName } from '../src/reportes/formatos/xlsx';
import { pdfText, renderPdf } from '../src/reportes/formatos/pdf';
import { isFormulaLike, neutralizeFormula, reportFileName } from '../src/reportes/formatos/celdas';
import type { ReportDocument } from '../src/reportes/reportes.types';

// Todos los datos son ficticios. Ninguna prueba conecta con MySQL, red ni correo.
const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
const NOW = new Date('2026-10-19T15:30:00.000Z'); // 10:30 en Lima

// ------------------------------------------------------------------------------------------------------------------------------
// Documentos de ejemplo (ficticios) con acentos, ñ, comas, comillas, saltos de línea, controles y textos con forma de fórmula.
const FORMULAS = ['=HYPERLINK("http://malicioso.test","clic")', '+51 987 654 321', '-2+3', '@SUMA(A1:A2)', '\tTabulado', '\uFF1D1+1'];

function detailDoc(): ReportDocument {
  const filas = [
    { id: 1, fecha: '2026-03-02 08:05', apellidos: 'Peña Ñúñez', nombres: 'José Ángel', dni: '01234567', curso: 'Instalación de cámaras, CCTV "avanzado"', edicion: 'Edición 2026-I\nTurno noche', estado: 'Vigente', cumplimiento: 'Pendiente' },
    ...FORMULAS.map((text, index) => ({ id: index + 2, fecha: '2026-03-0' + (index + 3) + ' 23:59', apellidos: text, nombres: 'Ficticia\u0007 ' + index, dni: null, curso: 'Cableado estructurado', edicion: 'Edición única', estado: index % 2 ? 'Anulada' : 'Vigente', cumplimiento: 'Cumplido' })),
  ];
  return {
    tipo: 'matriculas', titulo: 'Matrículas vigentes y anuladas', descripcion: 'Detalle de matrículas.', institucion: 'Horus Group SRL',
    generado_at: NOW.toISOString(), generado_local: '2026-10-19 10:30',
    periodo: { desde: '2026-01-01', hasta: '2026-06-30', etiqueta: 'Del 01/01/2026 al 30/06/2026' },
    filtros: [{ clave: 'curso_id', etiqueta: 'Curso', valor: '=Curso con fórmula' }],
    resumen: [{ clave: 'total', etiqueta: 'Matrículas en el reporte', valor: filas.length, tipo: 'entero' }, { clave: 'vigentes', etiqueta: 'Vigentes', valor: 4, tipo: 'entero' }],
    tabla: {
      titulo: 'Matrículas', total_filas: filas.length, totales: null, filas,
      columnas: [
        { clave: 'id', titulo: 'ID', tipo: 'entero', ancho: 7 }, { clave: 'fecha', titulo: 'Fecha de matrícula', tipo: 'fecha_hora', ancho: 17 },
        { clave: 'apellidos', titulo: 'Apellidos', tipo: 'texto', ancho: 20 }, { clave: 'nombres', titulo: 'Nombres', tipo: 'texto', ancho: 20 },
        { clave: 'dni', titulo: 'DNI', tipo: 'texto', ancho: 11 }, { clave: 'curso', titulo: 'Curso', tipo: 'texto', ancho: 26 },
        { clave: 'edicion', titulo: 'Edición', tipo: 'texto', ancho: 22 }, { clave: 'estado', titulo: 'Estado', tipo: 'texto', ancho: 10 },
        { clave: 'cumplimiento', titulo: 'Cumplimiento', tipo: 'texto', ancho: 13 },
      ],
    },
    notas: ['Vigente = matrícula activa.'], datos_personales: true,
  };
}

function aggregateDoc(rows = 3): ReportDocument {
  const filas = Array.from({ length: rows }, (_, i) => ({
    id: i + 1, curso: i % 2 ? 'Redes y telecomunicación' : 'Ofimática básica', edicion: 'Edición ' + (i + 1), estado: 'Abierta', inicio: '2026-0' + ((i % 9) + 1) + '-15',
    capacidad: i === 1 ? null : 20, vigentes: i + 5, disponibles: i === 1 ? null : 20 - (i + 5), ocupacion: i === 1 ? null : Math.round((i + 5) * 1000 / 20) / 10,
  }));
  return {
    tipo: 'ocupacion', titulo: 'Ocupación de cupos', descripcion: 'Capacidad y ocupación.', institucion: 'Horus Group SRL',
    generado_at: NOW.toISOString(), generado_local: '2026-10-19 10:30', periodo: { desde: null, hasta: null, etiqueta: 'Todo el historial' }, filtros: [],
    resumen: [{ clave: 'ocupacion', etiqueta: 'Ocupación global (%)', valor: 33.3, tipo: 'decimal' }, { clave: 'sin', etiqueta: 'Sin base', valor: null, tipo: 'decimal' }],
    tabla: {
      titulo: 'Ocupación', total_filas: filas.length, filas,
      columnas: [
        { clave: 'id', titulo: 'ID', tipo: 'entero', ancho: 7 }, { clave: 'curso', titulo: 'Curso', tipo: 'texto', ancho: 28 }, { clave: 'edicion', titulo: 'Edición', tipo: 'texto', ancho: 24 },
        { clave: 'estado', titulo: 'Estado', tipo: 'texto', ancho: 12 }, { clave: 'inicio', titulo: 'Inicio', tipo: 'fecha', ancho: 11 },
        { clave: 'capacidad', titulo: 'Capacidad', tipo: 'entero', ancho: 10 }, { clave: 'vigentes', titulo: 'Vigentes', tipo: 'entero', ancho: 9 },
        { clave: 'disponibles', titulo: 'Disponibles', tipo: 'entero', ancho: 11 }, { clave: 'ocupacion', titulo: 'Ocupación (%)', tipo: 'decimal', ancho: 12 },
      ],
      totales: { id: 'Total', curso: null, edicion: null, estado: null, inicio: null, capacidad: 40, vigentes: filas.reduce((t, r) => t + r.vigentes, 0), disponibles: 22, ocupacion: 33.3 },
    },
    notas: [], datos_personales: false,
  };
}

// ------------------------------------------------------------------------------------------------------------------------------
// Lectores independientes de la implementación: CSV RFC 4180 y ZIP/XLSX (zlib de Node).
function parseCsv(text: string, sep = ';'): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch; continue; }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else if (ch === '\n' || ch === '\r') throw new Error('Fin de línea sin CRLF fuera de comillas');
    else field += ch;
  }
  assert.equal(quoted, false, 'comillas sin cerrar');
  assert.equal(row.length + field.length, 0, 'la última línea debe terminar en CRLF');
  return rows;
}

function unzip(buffer: Buffer): Map<string, Buffer> {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'falta el fin de directorio ZIP');
  const files = new Map<string, Buffer>();
  let offset = buffer.readUInt32LE(eocd + 16);
  const nativeCrc = (zlib as unknown as { crc32?: (data: Buffer) => number }).crc32;
  for (let i = 0; i < buffer.readUInt16LE(eocd + 10); i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10), crc = buffer.readUInt32LE(offset + 16), size = buffer.readUInt32LE(offset + 24);
    const compressed = buffer.readUInt32LE(offset + 20), nameLength = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    assert.equal(method, 8);
    const data = zlib.inflateRawSync(buffer.subarray(start, start + compressed));
    assert.equal(data.length, size, name + ': tamaño');
    if (nativeCrc) assert.equal(nativeCrc(data), crc, name + ': CRC-32');
    files.set(name, data);
    offset += 46 + nameLength + extra + comment;
  }
  return files;
}

const unxml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const fromSerial = (serial: number, withTime: boolean) => {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 1440) * 60000).toISOString();
  return withTime ? date.slice(0, 10) + ' ' + date.slice(11, 16) : date.slice(0, 10);
};
interface XCell { text?: string; number?: number; style: number }
function sheetRows(xml: string): Map<number, Map<string, XCell>> {
  const rows = new Map<number, Map<string, XCell>>();
  for (const [, r, body] of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<string, XCell>();
    for (const [, ref, attrs, inner] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const style = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? 0);
      if (/t="inlineStr"/.test(attrs)) cells.set(ref, { text: unxml(/<t[^>]*>(.*?)<\/t>/s.exec(inner)![1]), style });
      else if (inner) cells.set(ref, { number: Number(/<v>(.*?)<\/v>/.exec(inner)![1]), style });
      else cells.set(ref, { style });
    }
    rows.set(Number(r), cells);
  }
  return rows;
}

// Tabla (encabezados, filas y totales) tal como la ve una persona en cada formato, normalizada a texto comparable.
function csvTable(doc: ReportDocument, csv: Buffer) {
  const rows = parseCsv(csv.subarray(3).toString('utf8'));
  const end = rows.findIndex(row => row.every(cell => cell === ''));
  return rows.slice(0, end).map(row => row.slice(0, doc.tabla.columnas.length));
}
function xlsxTable(doc: ReportDocument, xlsx: Buffer) {
  const sheet = sheetRows(unzip(xlsx).get('xl/worksheets/sheet2.xml')!.toString('utf8'));
  // Fila 1: encabezados; filas 2..N+1: datos; fila N+2 vacía; fila N+3: «Total».
  const lines = [...Array.from({ length: 1 + doc.tabla.filas.length }, (_, i) => i + 1), ...(doc.tabla.totales ? [doc.tabla.filas.length + 3] : [])];
  assert.equal(sheet.has(doc.tabla.filas.length + 2), false, 'fila vacía antes de los totales');
  return lines.map((line, r) => doc.tabla.columnas.map((column, c) => {
    const cell = sheet.get(line)?.get(columnName(c));
    if (!cell || (cell.text === undefined && cell.number === undefined)) return '';
    if (cell.text !== undefined) return neutralizeFormula(cell.text);
    if (r > 0 && column.tipo === 'fecha') return fromSerial(cell.number!, false);
    if (r > 0 && column.tipo === 'fecha_hora') return fromSerial(cell.number!, true);
    return column.tipo === 'decimal' ? cell.number!.toFixed(1) : String(cell.number);
  }));
}

// Texto de un PDF de pdfkit: descomprime los flujos y decodifica los operadores TJ/Tj (hex o literales) con WinAnsi.
const WIN_ANSI_80: Record<number, number> = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030,
  0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178 };
const winAnsi = (bytes: number[]) => bytes.map(b => String.fromCodePoint(WIN_ANSI_80[b] ?? b)).join('');
function pdfPages(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const pages: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try { content = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { continue; }
    if (!/\bBT\b/.test(content)) continue;
    const lines: string[] = [];
    for (const op of content.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|(<[0-9a-fA-F]*>|\((?:[^)\\]|\\.)*\))\s*Tj/g)) {
      const body = op[1] ?? op[2];
      let text = '';
      for (const part of body.matchAll(/<([0-9a-fA-F]*)>|\(((?:[^)\\]|\\.)*)\)/g)) {
        if (part[1] !== undefined) text += winAnsi(part[1].match(/../g)?.map(h => parseInt(h, 16)) ?? []);
        else text += winAnsi([...part[2].replace(/\\([()\\])/g, '$1')].map(c => c.charCodeAt(0)));
      }
      lines.push(text);
    }
    pages.push(lines.join('\n'));
  }
  return pages;
}

const samplesDir = process.env.REPORTES_MUESTRAS_DIR;
function sample(name: string, data: Buffer) {
  if (!samplesDir) return;
  mkdirSync(samplesDir, { recursive: true });
  writeFileSync(join(samplesDir, name), data);
}

// ------------------------------------------------------------------------------------------------------------------------------
// Validación de entrada
const validate = (value: unknown, metatype: typeof ReporteConsultaDto | typeof ReporteExportacionDto | typeof ReporteTipoDto, type: 'query' | 'param' = 'query') =>
  createValidationPipe().transform(value, { type, metatype });

test('Reportes: tipo, formato, fechas y filtros se validan antes de consultar', async () => {
  assert.equal((await validate({ tipo: 'matriculas-por-edicion' }, ReporteTipoDto, 'param')).tipo, 'matriculas-por-edicion');
  for (const tipo of ['otro', '', '../stats', 'ESTUDIANTES']) await assert.rejects(validate({ tipo }, ReporteTipoDto, 'param'), BadRequestException);
  const ok = await validate({ desde: '2026-01-01', hasta: '2026-12-31', curso_id: '3', convocatoria_id: '4', estado: 'activa', limit: '50' }, ReporteConsultaDto);
  assert.equal(ok.curso_id, 3); assert.equal(ok.convocatoria_id, 4); assert.equal(ok.limit, 50); assert.equal(ok.page, 1);
  for (const input of [{ desde: '2026-02-30' }, { hasta: '01/02/2026' }, { desde: '2026-1-1' }, { curso_id: '0' }, { curso_id: 'abc' }, { estado: 'retirada' },
    { cumplimiento: 'aprobado' }, { archivo: 'borrados' }, { agrupar: 'estudiante' }, { limit: '101' }, { page: '0' }, { search: 'x' }, { estado: ['activa', 'anulada'] }, { formato: 'csv' }]) {
    await assert.rejects(validate(input, ReporteConsultaDto), BadRequestException, JSON.stringify(input));
  }
  assert.equal((await validate({ formato: 'xlsx', estado: 'anulada' }, ReporteExportacionDto)).formato, 'xlsx');
  assert.equal((await validate({ formato: 'csv', separador: 'coma' }, ReporteExportacionDto)).separador, 'coma');
  for (const separador of ['tab', ';', '']) await assert.rejects(validate({ formato: 'csv', separador }, ReporteExportacionDto), BadRequestException);
  for (const formato of [undefined, 'xls', 'docx', 'PDF', 'csv;']) await assert.rejects(validate({ formato }, ReporteExportacionDto), BadRequestException);
  await assert.rejects(validate({ formato: 'csv', page: '2' }, ReporteExportacionDto), BadRequestException);
});

test('Reportes: períodos en días de Lima, rango máximo y resumen acotado a 12 meses por defecto', () => {
  const period = resolvePeriod('2026-01-01', '2026-01-31', NOW);
  assert.equal(period.fromUtc!.toISOString(), '2026-01-01T05:00:00.000Z');
  assert.equal(period.toUtc!.toISOString(), '2026-02-01T05:00:00.000Z');
  assert.equal(period.etiqueta, 'Del 01/01/2026 al 31/01/2026');
  assert.deepEqual(resolvePeriod(undefined, undefined, NOW), { desde: null, hasta: null, fromUtc: null, toUtc: null, etiqueta: 'Todo el historial' });
  assert.throws(() => resolvePeriod('2026-02-01', '2026-01-31', NOW), BadRequestException);
  assert.throws(() => resolvePeriod('2000-01-01', '2026-01-31', NOW), (e: BadRequestException) => e.message.includes(String(MAX_RANGE_DAYS)));
  const summary = resolvePeriod(undefined, undefined, NOW, 12);
  assert.equal(summary.desde, '2025-11-01'); assert.equal(summary.hasta, '2026-10-19');
  // A las 03:00 UTC del 1 de enero todavía es 31 de diciembre en Lima.
  assert.equal(resolvePeriod(undefined, undefined, new Date('2027-01-01T03:00:00Z'), 12).hasta, '2026-12-31');
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

// ------------------------------------------------------------------------------------------------------------------------------
// Servicio con Prisma simulado
interface FakeOptions { rol?: string | null; students?: number; editions?: unknown[]; groups?: unknown[]; course?: unknown }
function fakePrisma(options: FakeOptions = {}) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown) => { (calls[name] ??= []).push(args); };
  const studentRows = (skip: number, take: number) => Array.from({ length: Math.max(0, Math.min(take, (options.students ?? 0) - skip)) }, (_, i) => ({
    id: skip + i + 1, apellidos: 'Ficticio ' + (skip + i), nombres: 'Ana', doc_numero: i % 2 ? null : '0000000' + (i % 10), email: null, telefono: null,
    archivado_at: i % 3 === 0 ? new Date('2026-05-01T00:00:00Z') : null, createdAt: new Date('2026-03-01T04:59:59.999Z'), _count: { matriculas: 1 },
  }));
  const tx = {
    curso: { findUnique: async (args: unknown) => { record('curso.findUnique', args); return options.course === undefined ? { titulo: 'Curso ficticio' } : options.course; } },
    convocatoria: {
      findUnique: async () => ({ nombre: 'Edición ficticia', curso: { titulo: 'Curso ficticio' } }),
      count: async (args: unknown) => { record('convocatoria.count', args); return (options.editions ?? []).length; },
      findMany: async (args: { skip?: number; take?: number }) => { record('convocatoria.findMany', args); return (options.editions ?? []).slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 1e9)); },
      aggregate: async () => ({ _sum: { capacidad: 0 } }),
    },
    estudiante: {
      count: async (args: unknown) => { record('estudiante.count', args); return options.students ?? 0; },
      findMany: async (args: { skip: number; take: number }) => { record('estudiante.findMany', args); return studentRows(args.skip, args.take); },
    },
    matricula: {
      groupBy: async (args: unknown) => { record('matricula.groupBy', args); return options.groups ?? []; },
      count: async () => 0,
      findMany: async () => [],
    },
    $queryRaw: async () => [],
  };
  const prisma = {
    adminUser: { findUnique: async () => options.rol === undefined ? { rol: G } : options.rol === null ? null : { rol: options.rol } },
    $transaction: async (fn: (client: typeof tx) => unknown, opts: unknown) => { record('$transaction', opts); return fn(tx); },
  } as unknown as PrismaService;
  return { prisma, calls };
}
const query = (extra: Record<string, unknown> = {}) => Object.assign(new ReporteConsultaDto(), extra);

test('Reportes: filtros que el reporte no admite y estados ajenos responden 400 sin consultar datos', async () => {
  const { prisma, calls } = fakePrisma();
  const service = new ReportesService(prisma);
  await assert.rejects(service.preview('estudiantes', query({ curso_id: 1 }), 1, NOW), (e: BadRequestException) => e.message.includes('curso_id'));
  await assert.rejects(service.preview('resumen', query({ estado: 'activa' }), 1, NOW), BadRequestException);
  await assert.rejects(service.preview('matriculas', query({ estado: 'abierta' }), 1, NOW), (e: BadRequestException) => e.message.includes('activa, anulada'));
  await assert.rejects(service.preview('ediciones', query({ estado: 'activos' }), 1, NOW), BadRequestException);
  assert.equal(calls.$transaction, undefined);
});

test('Reportes: datos personales exigen leer o exportar estudiantes con el rol vigente; los agregados solo el permiso del reporte', async () => {
  for (const [rol, tipo, allowed] of [[C, 'estudiantes', true], [C, 'matriculas', true], [null, 'matriculas', false], ['ADMIN', 'estudiantes', false], [G, 'ocupacion', true]] as const) {
    const service = new ReportesService(fakePrisma({ rol }).prisma);
    if (allowed) await service.preview(tipo, query(), 1, NOW);
    else await assert.rejects(service.preview(tipo, query(), 1, NOW), (e: ForbiddenException) => e instanceof ForbiddenException && e.message === 'No tienes permiso para realizar esta operación.');
  }
  // El servicio repite el permiso base de AccessGuard: la secretaría (sin reportes_academicos:leer) no consulta ni los agregados,
  // aunque tenga estudiantes:leer y matriculas:leer.
  for (const tipo of ['estudiantes', 'matriculas', 'ocupacion', 'resumen'] as const) {
    await assert.rejects(new ReportesService(fakePrisma({ rol: S }).prisma).preview(tipo, query(), 1, NOW), (e: ForbiddenException) => e instanceof ForbiddenException && !/datos personales/.test(e.message));
  }
  // La coordinadora consulta, pero no exporta (reportes_academicos:exportar y estudiantes:exportar son solo del gerente).
  for (const tipo of ['estudiantes', 'matriculas', 'ediciones'] as const) {
    await assert.rejects(new ReportesService(fakePrisma({ rol: C }).prisma).exportDocument(tipo, {}, 'csv', 1, NOW), ForbiddenException);
  }
  assert.equal((await new ReportesService(fakePrisma({ rol: G }).prisma).exportDocument('ediciones', {}, 'csv', 1, NOW)).tabla.total_filas, 0);
  assert.equal((await new ReportesService(fakePrisma({ rol: G }).prisma).exportDocument('estudiantes', {}, 'pdf', 1, NOW)).datos_personales, true);
});

test('Reportes: el catálogo informa lo que cada rol puede consultar y exportar', async () => {
  const of = async (rol: string | null) => Object.fromEntries((await new ReportesService(fakePrisma({ rol }).prisma).catalog(1)).reportes.map(r => [r.tipo, [r.puede_consultar, r.puede_exportar]]));
  assert.deepEqual((await of(G)).estudiantes, [true, true]);
  assert.deepEqual((await of(C)).estudiantes, [true, false]);
  assert.deepEqual((await of(C)).resumen, [true, false]);
  assert.deepEqual((await of(S)).matriculas, [false, false]);
  const catalog = await new ReportesService(fakePrisma({ rol: G }).prisma).catalog(1);
  // Los 6 reportes académicos (los de certificados se retiraron) conservan su orden y su ámbito; los comerciales (Etapa 3) se añaden después (ver reportes-comerciales.test.ts).
  assert.deepEqual(catalog.reportes.slice(0, 6).map(r => r.tipo), ['estudiantes', 'ediciones', 'ocupacion', 'matriculas', 'matriculas-por-edicion', 'resumen']);
  assert.ok(catalog.reportes.slice(0, 6).every(r => r.ambito === 'academico'));
  assert.deepEqual(catalog.limites.filas_exportacion, { csv: 20000, xlsx: 20000, pdf: 3000 });
});

test('Reportes: estudiantes filtra por días de Lima, lee por lotes en una transacción REPEATABLE READ y pagina la consulta', async () => {
  const { prisma, calls } = fakePrisma({ students: 2500 });
  const service = new ReportesService(prisma);
  const preview = await service.preview('estudiantes', query({ desde: '2026-03-01', hasta: '2026-03-31', estado: 'activos', page: 2, limit: 10 }), 1, NOW);
  assert.deepEqual(calls['estudiante.count'][0], { where: { createdAt: { gte: new Date('2026-03-01T05:00:00.000Z'), lt: new Date('2026-04-01T05:00:00.000Z') }, archivado_at: null } });
  assert.equal(preview.reporte.tabla.filas.length, 10); assert.equal(preview.reporte.tabla.filas[0].id, 11);
  assert.deepEqual(preview.pagination, { page: 2, limit: 10, total: 2500, pages: 250 });
  assert.equal(preview.reporte.tabla.filas[0].registrado, '2026-02-28 23:59'); // hora de Lima
  assert.deepEqual(calls.$transaction[0], { isolationLevel: 'RepeatableRead', timeout: 30000, maxWait: 5000 });
  assert.deepEqual(preview.reporte.filtros, [{ clave: 'estado', etiqueta: 'Estado', valor: 'Activos' }]);
  const exported = await service.exportDocument('estudiantes', {}, 'xlsx', 1, NOW);
  assert.equal(exported.tabla.filas.length, 2500);
  assert.deepEqual(calls['estudiante.findMany'].slice(1).map(c => [(c as { skip: number }).skip, (c as { take: number }).take]), [[0, 1000], [1000, 1000], [2000, 1000]]);
});

test('Reportes: un volumen mayor que el límite del formato responde 422 sin generar archivo', async () => {
  const service = new ReportesService(fakePrisma({ students: MAX_EXPORT_ROWS.pdf + 1 }).prisma);
  await assert.rejects(service.exportDocument('estudiantes', {}, 'pdf', 1, NOW), (e: UnprocessableEntityException) => e instanceof UnprocessableEntityException && e.message.includes('PDF'));
  assert.equal((await service.exportDocument('estudiantes', {}, 'csv', 1, NOW)).tabla.filas.length, MAX_EXPORT_ROWS.pdf + 1);
  await assert.rejects(new ReportesService(fakePrisma({ students: MAX_EXPORT_ROWS.csv + 1 }).prisma).exportDocument('estudiantes', {}, 'csv', 1, NOW), UnprocessableEntityException);
});

const edition = (id: number, curso: string, capacidad: number | null, estado = 'abierta', archivado = false, inicio = '2026-04-01') => ({
  id, nombre: 'Edición ' + id, fecha_inicio: new Date(inicio + 'T00:00:00Z'), fecha_fin: new Date('2026-06-30T00:00:00Z'), estado, capacidad,
  archivado_at: archivado ? new Date() : null, curso: { id: curso.length, titulo: curso, tipo: 'curso' },
});

test('Reportes: ediciones y ocupación calculan cupos, porcentajes y totales con capacidad nula y sin dividir por cero', async () => {
  const editions = [edition(1, 'Ofimática', 10), edition(2, 'Cableado', null, 'cerrada', true), edition(3, 'Ofimática', 4, 'planificada', false, '2026-01-10'), edition(4, 'Ánimo', 0)];
  const groups = [
    { convocatoria_id: 1, estado: 'activa', _count: { _all: 7 } }, { convocatoria_id: 1, estado: 'anulada', _count: { _all: 2 } },
    { convocatoria_id: 2, estado: 'activa', _count: { _all: 3 } }, { convocatoria_id: 3, estado: 'activa', _count: { _all: 4 } },
  ];
  const { prisma, calls } = fakePrisma({ editions, groups });
  const service = new ReportesService(prisma);
  const occupancy = await service.exportDocument('ocupacion', { desde: '2026-05-01', archivo: 'todos' }, 'csv', 1, NOW);
  assert.deepEqual(calls['convocatoria.count'][0], { where: { fecha_inicio: { not: null }, fecha_fin: { not: null, gte: new Date('2026-05-01T00:00:00.000Z') } } });
  // Orden: curso (alfabético español, sin distinguir tildes) e inicio.
  assert.deepEqual(occupancy.tabla.filas.map(r => r.id), [4, 2, 3, 1]);
  assert.deepEqual(occupancy.tabla.filas.map(r => r.ocupacion), [null, null, 100, 70]);
  const summary = Object.fromEntries(occupancy.resumen.map(e => [e.clave, e.valor]));
  assert.deepEqual(summary, { total: 4, con_capacidad: 3, sin_capacidad: 1, capacidad: 14, ocupados: 11, disponibles: 3, ocupacion: 78.6, completas: 2, matriculas_vigentes: 14 });
  assert.deepEqual(occupancy.tabla.totales, { id: 'Total', curso: null, edicion: null, estado: null, inicio: null, capacidad: 14, vigentes: 14, disponibles: 3, ocupacion: 78.6 });
  const editionsReport = await service.preview('ediciones', query({ limit: 2 }), 1, NOW);
  assert.equal(editionsReport.reporte.tabla.filas.length, 2); assert.equal(editionsReport.reporte.tabla.total_filas, 4);
  assert.equal(editionsReport.reporte.tabla.totales!.anuladas, 2);
  assert.deepEqual(Object.fromEntries(editionsReport.reporte.resumen.map(e => [e.clave, e.valor])), { total: 4, planificadas: 1, abiertas: 2, cerradas: 1, canceladas: 0, archivadas: 1, matriculas_vigentes: 14, matriculas_anuladas: 2 });
});

test('Reportes: matrículas por edición o por curso suman lo mismo en ambas agrupaciones', async () => {
  const editions = [edition(1, 'Ofimática', 10), edition(3, 'Ofimática', 4), edition(2, 'Cableado', 5)];
  const groups = [{ convocatoria_id: 1, estado: 'activa', _count: { _all: 7 } }, { convocatoria_id: 1, estado: 'anulada', _count: { _all: 2 } },
    { convocatoria_id: 3, estado: 'anulada', _count: { _all: 1 } }, { convocatoria_id: 2, estado: 'activa', _count: { _all: 3 } }];
  const service = new ReportesService(fakePrisma({ editions, groups }).prisma);
  const byEdition = await service.exportDocument('matriculas-por-edicion', {}, 'xlsx', 1, NOW);
  const byCourse = await service.exportDocument('matriculas-por-edicion', { agrupar: 'curso' }, 'xlsx', 1, NOW);
  assert.deepEqual(byEdition.tabla.totales, { curso: 'Total', edicion: null, inicio: null, estado: null, vigentes: 10, anuladas: 3, total: 13 });
  assert.deepEqual(byCourse.tabla.totales, { curso: 'Total', tipo: null, ediciones: 3, vigentes: 10, anuladas: 3, total: 13 });
  assert.deepEqual(byCourse.tabla.filas.map(r => [r.curso, r.ediciones, r.total]), [['Cableado', 1, 3], ['Ofimática', 2, 10]]);
  assert.deepEqual(byEdition.resumen, byCourse.resumen);
});

test('Reportes: un reporte vacío devuelve ceros confirmados, sin totales inventados', async () => {
  const service = new ReportesService(fakePrisma().prisma);
  for (const tipo of ['estudiantes', 'ediciones', 'ocupacion', 'matriculas', 'matriculas-por-edicion'] as const) {
    const doc = await service.exportDocument(tipo, {}, 'csv', 1, NOW);
    assert.equal(doc.tabla.filas.length, 0, tipo); assert.equal(doc.tabla.totales, null, tipo);
    for (const entry of doc.resumen) assert.ok(entry.valor === 0 || entry.valor === null, tipo + ' ' + entry.clave);
  }
  const summary = await service.exportDocument('resumen', {}, 'csv', 1, NOW);
  assert.equal(summary.tabla.filas.length, 12); assert.equal(summary.periodo.etiqueta, 'Del 01/11/2025 al 19/10/2026');
  assert.deepEqual(summary.tabla.totales, { mes: 'Total', estudiantes: 0, matriculas: 0, vigentes: 0, anuladas: 0 });
});

test('Reportes: curso o edición inexistentes responden 404; esquema pendiente o tiempo agotado, 503 sin detalles internos', async () => {
  await assert.rejects(new ReportesService(fakePrisma({ course: null }).prisma).preview('matriculas', query({ curso_id: 99 }), 1, NOW), NotFoundException);
  for (const code of ['P2022', 'P2021', 'P2028', 'P2024']) {
    const prisma = { adminUser: { findUnique: async () => ({ rol: G }) }, $transaction: async () => { throw new PrismaClientKnownRequestError('SELECT secreto FROM tabla_interna', { code, clientVersion: '6.19.3' }); } } as unknown as PrismaService;
    await assert.rejects(new ReportesService(prisma).preview('resumen', query(), 1, NOW), (e: ServiceUnavailableException) => e instanceof ServiceUnavailableException && !/SELECT|tabla_interna/.test(JSON.stringify(e.getResponse())));
  }
});

test('Reportes: exportaciones simultáneas por encima del límite responden 429 sin consultar la base', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const reportes = { exportDocument: async () => { calls++; await gate; return aggregateDoc(); } } as unknown as ReportesService;
  const exporter = new ReportesExportacionService(reportes);
  const running = Array.from({ length: MAX_CONCURRENT_EXPORTS }, () => exporter.export('ocupacion', Object.assign(new ReporteExportacionDto(), { formato: 'csv' }), 1, NOW));
  await assert.rejects(exporter.export('ocupacion', Object.assign(new ReporteExportacionDto(), { formato: 'csv' }), 1, NOW), (e: HttpException) => e.getStatus() === 429);
  assert.equal(calls, MAX_CONCURRENT_EXPORTS);
  release();
  const files = await Promise.all(running);
  assert.equal(files[0].fileName, 'horus-reporte-ocupacion-20261019-1030.csv');
  assert.equal(files[0].contentType, 'text/csv; charset=utf-8');
  await assert.rejects(exporter.export('ocupacion', Object.assign(new ReporteExportacionDto(), { formato: 'xlsx', separador: 'coma' }), 1, NOW), BadRequestException);
  // Liberado el cupo, vuelve a aceptar exportaciones.
  assert.equal((await exporter.export('ocupacion', Object.assign(new ReporteExportacionDto(), { formato: 'xlsx' }), 1, NOW)).fileName.endsWith('.xlsx'), true);
});

// ------------------------------------------------------------------------------------------------------------------------------
// Formatos
test('CSV: UTF-8 con BOM, CRLF, campos escapados, mismo número de campos y fórmulas neutralizadas', () => {
  const doc = detailDoc();
  const csv = renderCsv(doc);
  sample('muestra-matriculas.csv', csv);
  assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = csv.subarray(3).toString('utf8');
  assert.ok(text.includes('Peña Ñúñez') && text.includes('José Ángel') && text.includes('Edición'), 'tildes y ñ intactas');
  const rows = parseCsv(text);
  assert.ok(rows.every(row => row.length === doc.tabla.columnas.length), 'todas las líneas con el mismo número de campos');
  assert.deepEqual(rows[0], ['ID', 'Fecha de matrícula', 'Apellidos', 'Nombres', 'DNI', 'Curso', 'Edición', 'Estado', 'Cumplimiento']);
  assert.deepEqual(rows[1].slice(0, 7), ['1', '2026-03-02 08:05', 'Peña Ñúñez', 'José Ángel', '01234567', 'Instalación de cámaras, CCTV "avanzado"', 'Edición 2026-I\nTurno noche']);
  assert.ok(text.includes('"Instalación de cámaras, CCTV ""avanzado"""'), 'comillas duplicadas y campo entre comillas');
  for (const [index, formula] of FORMULAS.entries()) assert.equal(rows[index + 2][2], "'" + formula, 'neutraliza ' + JSON.stringify(formula));
  assert.equal(rows[2][3], 'Ficticia 0', 'retira caracteres de control');
  // Ningún campo (salvo los neutralizados con apóstrofo) empieza por un carácter de fórmula.
  for (const row of rows) for (const field of row) assert.ok(!isFormulaLike(field), JSON.stringify(field));
  assert.ok(rows.some(row => row[0] === 'Curso' && row[1] === "'=Curso con fórmula"), 'también neutraliza filtros y metadatos');
  assert.ok(rows.some(row => row[0] === 'Aviso' && /datos personales/.test(row[1])));
  assert.match(text.split('\r\n')[0], /^ID;Fecha de matrícula;Apellidos;/, 'punto y coma por defecto (Excel en es-PE)');
  // Con coma (opcional), el contenido es idéntico y los campos con coma van entre comillas.
  const comma = renderCsv(doc, 'coma');
  sample('muestra-matriculas-coma.csv', comma);
  assert.deepEqual(parseCsv(comma.subarray(3).toString('utf8'), ','), rows);
  assert.match(comma.subarray(3).toString('utf8').split('\r\n')[0], /^ID,Fecha de matrícula,Apellidos,/);
  // Un punto y coma dentro de un valor se protege con comillas en el modo por defecto.
  const withSemicolon = detailDoc(); withSemicolon.tabla.filas[0].curso = 'Redes; fibra óptica';
  assert.equal(parseCsv(renderCsv(withSemicolon).subarray(3).toString('utf8'))[1][5], 'Redes; fibra óptica');
  assert.deepEqual(rows.find(row => row[0] === 'Matrículas en el reporte')!.slice(0, 2), ['Matrículas en el reporte', '7']);
});

test('XLSX: paquete OOXML auténtico con hojas, estilos, autofiltro, encabezado fijo, fechas reales y sin fórmulas', () => {
  const doc = aggregateDoc();
  const xlsx = renderXlsx(doc);
  sample('muestra-ocupacion.xlsx', xlsx);
  sample('muestra-matriculas.xlsx', renderXlsx(detailDoc()));
  assert.deepEqual([...xlsx.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'firma ZIP (no es XML .xls renombrado)');
  const files = unzip(xlsx);
  assert.deepEqual([...files.keys()].sort(), ['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
  const all = [...files.values()].map(file => file.toString('utf8')).join('\n');
  assert.ok(!/<f[ >]/.test(all), 'ninguna celda con fórmula');
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(all), 'sin caracteres de control inválidos en XML');
  assert.match(files.get('[Content_Types].xml')!.toString(), /spreadsheetml\.sheet\.main\+xml/);
  const workbook = files.get('xl/workbook.xml')!.toString();
  assert.match(workbook, /<sheet name="Resumen" sheetId="1" r:id="rId1"\/><sheet name="Ocupación" sheetId="2" r:id="rId2"\/>/);
  assert.match(workbook, /_xlnm\._FilterDatabase" localSheetId="1" hidden="1">'Ocupación'!\$A\$1:\$I\$4</);
  const sheet = files.get('xl/worksheets/sheet2.xml')!.toString();
  assert.match(sheet, /<autoFilter ref="A1:I4"\/>/);
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sheet, /<pageSetup paperSize="9" orientation="landscape"/);
  const rows = sheetRows(sheet);
  assert.deepEqual(rows.get(2)!.get('E'), { number: excelSerial('2026-01-15'), style: 6 }, 'fecha real con formato dd/mm/aaaa');
  assert.equal(excelSerial('2026-01-15'), 46037); assert.equal(excelSerial('1900-03-01'), 61); assert.equal(excelSerial('2026-01-15 18:00'), 46037.75);
  assert.equal(rows.get(3)!.get('F'), undefined, 'capacidad nula = celda vacía');
  assert.equal(rows.get(5), undefined, 'fila vacía: el autofiltro no alcanza a los totales');
  assert.deepEqual(rows.get(6)!.get('A'), { text: 'Total', style: 9 });
  const styles = files.get('xl/styles.xml')!.toString();
  assert.match(styles, /numFmtId="164" formatCode="dd\/mm\/yyyy"/);
  // Estilo de texto (4) y totales de texto (9) llevan quotePrefix: Excel no los convierte en fórmula al editar.
  const xfs = [...styles.split('<cellXfs')[1].matchAll(/<xf [^>]*>/g)].map(m => m[0]);
  assert.match(xfs[4], /quotePrefix="1"/); assert.match(xfs[9], /quotePrefix="1"/);
  assert.equal(columnName(0), 'A'); assert.equal(columnName(25), 'Z'); assert.equal(columnName(26), 'AA'); assert.equal(columnName(701), 'ZZ'); assert.equal(columnName(702), 'AAA');
  assert.equal(sheetName('Matrículas: [2026/I]*?'), 'Matrículas   2026 I'); assert.equal(sheetName('x'.repeat(40)).length, 31);
});

test('XLSX: los textos con forma de fórmula se guardan como texto literal y las tildes se conservan', () => {
  const doc = detailDoc();
  const rows = sheetRows(unzip(renderXlsx(doc)).get('xl/worksheets/sheet2.xml')!.toString('utf8'));
  for (const [index, formula] of FORMULAS.entries()) assert.deepEqual(rows.get(index + 3)!.get('C'), { text: formula, style: 4 });
  assert.equal(rows.get(2)!.get('C')!.text, 'Peña Ñúñez');
  assert.equal(rows.get(2)!.get('G')!.text, 'Edición 2026-I\nTurno noche');
  assert.equal(rows.get(2)!.get('E')!.text, '01234567', 'el DNI conserva el cero inicial');
  const summary = sheetRows(unzip(renderXlsx(doc)).get('xl/worksheets/sheet1.xml')!.toString('utf8'));
  assert.equal(summary.get(1)!.get('A')!.text, 'Horus Group SRL');
  assert.equal(summary.get(5)!.get('B')!.number, excelSerial('2026-10-19 10:30'));
});

test('Coherencia: CSV y XLSX contienen exactamente las mismas filas, valores y totales del documento', () => {
  for (const doc of [detailDoc(), aggregateDoc(25)]) {
    const csv = csvTable(doc, renderCsv(doc));
    const xlsx = xlsxTable(doc, renderXlsx(doc));
    assert.equal(csv.length, 1 + doc.tabla.filas.length + (doc.tabla.totales ? 1 : 0));
    assert.deepEqual(xlsx, csv, doc.tipo);
    const csvRows = parseCsv(renderCsv(doc).subarray(3).toString('utf8'));
    const summary = sheetRows(unzip(renderXlsx(doc)).get('xl/worksheets/sheet1.xml')!.toString('utf8'));
    for (const entry of doc.resumen) {
      const fromCsv = csvRows.find(row => row[0] === entry.etiqueta)![1];
      const fromXlsx = [...summary.values()].find(row => row.get('A')?.text === entry.etiqueta)!.get('B')!;
      assert.equal(fromXlsx.text ?? (entry.tipo === 'decimal' ? fromXlsx.number!.toFixed(1) : String(fromXlsx.number)), fromCsv, entry.etiqueta);
    }
  }
});

test('PDF: documento válido A4 con encabezado institucional, metadatos, resumen, tildes, totales y paginación', async () => {
  const doc = aggregateDoc(25);
  doc.filtros = [{ clave: 'curso_id', etiqueta: 'Curso', valor: 'Instalación de cámaras' }];
  const pdf = await renderPdf(doc);
  sample('muestra-ocupacion.pdf', pdf);
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(pdf.subarray(-8).toString('latin1'), /%%EOF\s*$/);
  const raw = pdf.toString('latin1');
  assert.match(raw, /\/MediaBox \[0 0 841\.89 595\.28\]/, 'A4 horizontal (más de 6 columnas)');
  assert.match(raw, /\/Creator \d+ 0 R/); assert.ok(raw.includes('(Horus Group SRL)')); assert.ok(raw.includes('/Lang (es-PE)'));
  assert.ok(raw.includes('/Encoding /WinAnsiEncoding'), 'fuentes estándar con WinAnsi (tildes y ñ)');
  const pages = pdfPages(pdf);
  assert.equal(pages.length, (raw.match(/\/Type \/Page\b/g) ?? []).length);
  const first = pages[0];
  for (const expected of ['HORUS GROUP SRL', 'Reporte académico', 'Ocupación de cupos', 'Generado el', '19/10/2026 10:30 (hora de Lima)', 'Período', 'Todo el historial',
    'Curso', 'Instalación de cámaras', 'Ocupación global (%)', '33.3', 'Sin base', 'No aplica', 'Ocupación (%)', 'Ofimática básica', '15/01/2026']) {
    assert.ok(first.includes(expected), 'falta «' + expected + '» en la primera página');
  }
  const all = pages.join('\n');
  for (let i = 1; i <= 25; i++) assert.ok(all.includes('Edición ' + i), 'fila ' + i);
  assert.ok(all.includes('Total') && all.includes(String(doc.tabla.totales!.vigentes)), 'fila de totales');
  assert.ok(pages.every((page, i) => page.includes('Página ' + (i + 1) + ' de ' + pages.length)), 'pie con paginación en cada página');
});

test('PDF: tablas extensas saltan de página sin partir filas y repiten el encabezado; vacío y retrato también son válidos', async () => {
  const doc = aggregateDoc(160);
  const pdf = await renderPdf(doc);
  const pages = pdfPages(pdf);
  assert.ok(pages.length >= 4, 'varias páginas: ' + pages.length);
  for (const [i, page] of pages.entries()) {
    assert.ok(page.includes('HORUS GROUP SRL'), 'banda institucional en la página ' + (i + 1));
    assert.ok(page.includes('Ocupación (%)'), 'encabezado de tabla repetido en la página ' + (i + 1));
    if (i > 0) assert.ok(page.includes('Ocupación de cupos (continuación)'));
  }
  const rows = pages.join('\n').match(/^Edición \d+$/gm) ?? [];
  assert.equal(rows.length, 160, 'cada fila aparece una sola vez (ninguna partida ni duplicada)');

  const empty = aggregateDoc(0); empty.tabla.totales = null;
  const emptyPages = pdfPages(await renderPdf(empty));
  assert.equal(emptyPages.length, 1);
  assert.ok(emptyPages[0].includes('No hay registros para los filtros seleccionados.'));

  const detail = detailDoc();
  const detailPdf = await renderPdf(detail);
  sample('muestra-matriculas.pdf', detailPdf);
  const text = pdfPages(detailPdf).join('\n');
  assert.ok(text.includes('Peña Ñúñez') && text.includes('José Ángel'), 'tildes y ñ con WinAnsi');
  // La celda estrecha reparte el texto en varias líneas consecutivas; unidas, es el valor literal (en PDF no hay fórmulas).
  assert.ok(text.replace(/\n/g, '').includes('=HYPERLINK("http://malicioso.test","clic")'));
  assert.ok(text.includes('=1+1'), 'el signo igual de ancho completo se normaliza');
  assert.ok(text.includes('Confidencial'), 'aviso de datos personales');
  assert.ok(text.includes('02/03/2026 08:05'), 'fecha y hora en formato local');
  assert.equal(pdfText('Línea\tcon\u0007 control 中'), 'Línea con control ?');
});

test('Formatos: tipos MIME, extensiones y nombres de archivo seguros', () => {
  assert.equal(FORMAT_INFO.xlsx.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(FORMAT_INFO.pdf.contentType, 'application/pdf');
  assert.equal(reportFileName('matriculas-por-edicion', '2026-10-19 10:30', 'pdf'), 'horus-reporte-matriculas-por-edicion-20261019-1030.pdf');
  assert.equal(reportFileName('../"x"', '2026-10-19 10:30', 'csv'), 'horus-reporte-x-20261019-1030.csv');
});

test('Formatos: una exportación grande dentro del límite se genera en memoria acotada y tiempo razonable', () => {
  const doc = aggregateDoc(MAX_EXPORT_ROWS.xlsx);
  const started = Date.now();
  const csv = renderCsv(doc), xlsx = renderXlsx(doc);
  assert.ok(Date.now() - started < 20000, 'tiempo de generación');
  assert.ok(csv.length < 5 * 1024 * 1024 && xlsx.length < 5 * 1024 * 1024, 'tamaño del archivo');
  assert.equal(parseCsv(csv.subarray(3).toString('utf8')).length, MAX_EXPORT_ROWS.xlsx + 2 + 1 + 4 + 1 + 1 + 1 + 2);
  assert.equal(sheetRows(unzip(xlsx).get('xl/worksheets/sheet2.xml')!.toString('utf8')).size, MAX_EXPORT_ROWS.xlsx + 2);
});
