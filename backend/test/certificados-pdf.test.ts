import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { inflateSync } from 'node:zlib';
import { HttpException, Module, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { can } from '../src/permissions/policy';
import { PublicRateLimitGuard } from '../src/common/public-rate-limit.guard';
import { trustedProxies } from '../src/common/trusted-proxies';
import { PrismaService } from '../src/database/prisma.service';
import { CertificadosController, CertificadosPublicController } from '../src/certificados/certificados.controller';
import { VERIFICATION_URL_ENV, resolveVerificationBase, verificationUrl } from '../src/certificados/certificados.config';
import { datesLine, limaDateTime, longDate, renderCertificatePdf, type CertificatePdfData } from '../src/certificados/certificados.pdf';
import { MAX_VERSION, QrTooLongError, blockLayout, byteCapacity, dataCodewords, encodeQr, formatBits, maskApplies, reedSolomonRemainder, versionBits } from '../src/certificados/certificados.qr';
import { CertificadosService } from '../src/certificados/certificados.service';
import { memoryBuckets } from './fixtures/rate-limit-memory';

// Aislado: sin MySQL, sin correo, sin red externa y sin datos reales. Ninguna prueba abre .env ni lee secretos: la configuración se pasa explícita.

const CODE = 'ABCDEFGHJKLMNPQRSTUV';
const BASE = 'https://horus.example.pe/verificar';
const URL_OK = BASE + '/' + CODE;
const DNI = '01234567';
const ENV_OK = { [VERIFICATION_URL_ENV]: BASE };

const data = (extra: Partial<CertificatePdfData> = {}): CertificatePdfData => ({
  estado: 'vigente', sustituido: false, estudiante_nombres: 'Ana', estudiante_apellidos: 'Quispe Huamán', curso_titulo: 'Excel Intermedio', curso_tipo: 'curso', curso_duracion: '20 horas',
  convocatoria_nombre: 'Edición 1', convocatoria_fecha_inicio: new Date('2026-11-01T00:00:00Z'), convocatoria_fecha_fin: new Date('2026-11-30T00:00:00Z'),
  emitido_at: new Date('2026-12-02T15:30:00Z'), codigo_verificacion: CODE, ...extra,
});

// Texto visible del PDF: descomprime los flujos y concatena las cadenas hexadecimales (WinAnsi) que pdfkit escribe con las fuentes estándar.
function pdfContent(buffer: Buffer): { raw: string; text: string; pages: number } {
  const latin = buffer.toString('latin1');
  let raw = latin;
  for (const match of latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { raw += '\n' + inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { raw += '\n' + match[1]; }
  }
  const chunks = [...raw.matchAll(/\[((?:\s*<[0-9a-fA-F]*>\s*-?[\d.]*)+)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)];
  const text = chunks.map(m => [...(m[1] ?? m[2]).matchAll(/<([0-9a-fA-F]*)>/g)].map(h => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n');
  return { raw, text, pages: Number(/\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(raw)?.[1] ?? 0) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// QR: verificación contra la norma y decodificación completa de la matriz
// ---------------------------------------------------------------------------------------------------------------------------------
test('QR: el vector de Reed-Solomon de la norma (versión 1-M, «01234567») coincide', () => {
  const dataWords = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  assert.deepEqual(reedSolomonRemainder(dataWords, 10), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});
test('QR: bits de formato (nivel M, 8 máscaras) y de versión (7 a 10) iguales a las tablas de la norma', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(formatBits), [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]);
  assert.deepEqual([7, 8, 9, 10].map(versionBits), [0x07c94, 0x085bc, 0x09a99, 0x0a4d3]);
});
test('QR: capacidad en bytes por versión (nivel M) y rechazo de textos demasiado largos', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(byteCapacity), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  for (let v = 1; v <= MAX_VERSION; v++) {
    const { blocks, ecPerBlock } = blockLayout(v);
    assert.equal(dataCodewords(v) + ecPerBlock * blocks.reduce((sum, [count]) => sum + count, 0), [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346][v], 'codewords totales de la versión ' + v);
  }
  assert.equal(encodeQr('x'.repeat(213)).length, 57);
  assert.throws(() => encodeQr('x'.repeat(214)), QrTooLongError);
});

// Decodificador independiente de la matriz (solo usa las tablas de la norma y la función de Reed-Solomon ya verificada).
function decodeQr(matrix: boolean[][]): { text: string; mask: number; version: number } {
  const size = matrix.length, version = (size - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= MAX_VERSION);
  // Máscara: bits de formato de la primera copia (alrededor del finder superior izquierdo) y de la segunda; deben coincidir.
  const bit = (x: number, y: number) => (matrix[y][x] ? 1 : 0);
  let first = 0;
  const firstCoords: Array<[number, number]> = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  firstCoords.forEach(([x, y], i) => { first |= bit(x, y) << i; });
  let second = 0;
  for (let i = 0; i < 8; i++) second |= bit(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) second |= bit(8, size - 15 + i) << i;
  assert.equal(first, second, 'las dos copias de la información de formato coinciden');
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find(m => formatBits(m) === first);
  assert.notEqual(mask, undefined, 'la información de formato es válida');
  // Módulos de función (no llevan datos): finders con separadores y formato, sincronización, alineación y versión.
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) fn[y][x] = true;
  for (let y = 0; y < 9; y++) for (let x = size - 8; x < size; x++) fn[y][x] = true;
  for (let y = size - 8; y < size; y++) for (let x = 0; x < 9; x++) fn[y][x] = true;
  for (let i = 0; i < size; i++) { fn[6][i] = true; fn[i][6] = true; }
  const centers = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]][version];
  for (const cy of centers) for (const cx of centers) {
    const corner = (cy === 6 && cx === 6) || (cy === 6 && cx === centers[centers.length - 1]) || (cy === centers[centers.length - 1] && cx === 6);
    if (!corner) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fn[cy + dy][cx + dx] = true;
  }
  if (version >= 7) for (let a = 0; a < 6; a++) for (let b = size - 11; b < size - 8; b++) { fn[a][b] = true; fn[b][a] = true; }
  // Lectura en zigzag con la máscara deshecha.
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fn[y][x]) bits.push(bit(x, y) ^ (maskApplies(mask as number, x, y) ? 1 : 0));
    }
  }
  const words: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  // Desentrelazado, comprobación de la corrección de errores de cada bloque y reconstrucción de los datos.
  const { blocks, ecPerBlock } = blockLayout(version);
  const sizes = blocks.flatMap(([count, length]) => Array<number>(count).fill(length));
  const dataBlocks = sizes.map(() => [] as number[]), ecBlocks = sizes.map(() => [] as number[]);
  let at = 0;
  for (let i = 0; i < Math.max(...sizes); i++) sizes.forEach((length, b) => { if (i < length) dataBlocks[b].push(words[at++]); });
  for (let i = 0; i < ecPerBlock; i++) sizes.forEach((_, b) => { ecBlocks[b].push(words[at++]); });
  dataBlocks.forEach((block, b) => assert.deepEqual(reedSolomonRemainder(block, ecPerBlock), ecBlocks[b], 'corrección de errores del bloque ' + b));
  const stream = dataBlocks.flat().map(w => w.toString(2).padStart(8, '0')).join('');
  assert.equal(stream.slice(0, 4), '0100', 'modo byte');
  const countBits = version < 10 ? 8 : 16, length = parseInt(stream.slice(4, 4 + countBits), 2);
  const body = Buffer.from(Array.from({ length }, (_, i) => parseInt(stream.slice(4 + countBits + i * 8, 4 + countBits + i * 8 + 8), 2)));
  return { text: body.toString('utf8'), mask: mask as number, version };
}

test('QR: la matriz decodificada devuelve exactamente el texto (URL de verificación, largos límite y varias versiones)', () => {
  const samples = [URL_OK, 'a', 'x'.repeat(14), 'x'.repeat(15), URL_OK + '/' + 'p'.repeat(60), 'https://horus.example.pe/' + 'ñ'.repeat(20), 'z'.repeat(121), 'z'.repeat(122), 'q'.repeat(213)];
  const versions = new Set<number>();
  for (const text of samples) {
    const decoded = decodeQr(encodeQr(text));
    assert.equal(decoded.text, text);
    versions.add(decoded.version);
  }
  assert.ok(versions.size >= 5, 'se ejercitan varias versiones (con y sin alineación, versión ≥ 7 y ≥ 10): ' + [...versions]);
  assert.ok(versions.has(1) && versions.has(10));
});
test('QR: patrones fijos (buscadores, sincronización, módulo oscuro) y tamaño de la URL de verificación', () => {
  const m = encodeQr(URL_OK), size = m.length;
  assert.equal(size, 17 + 4 * decodeQr(m).version);
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let d = 0; d < 7; d++) for (let e = 0; e < 7; e++) {
      const ring = Math.max(Math.abs(d - 3), Math.abs(e - 3));
      assert.equal(m[oy + d][ox + e], ring !== 2, 'buscador en ' + ox + ',' + oy);
    }
  }
  for (let i = 8; i < size - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
  assert.equal(m[size - 8][8], true, 'módulo oscuro');
  assert.ok(decodeQr(m).version <= 6, 'la URL típica cabe en un QR pequeño y fácil de escanear');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// URL pública de verificación
// ---------------------------------------------------------------------------------------------------------------------------------
test('URL de verificación: solo https público estable; se normaliza y se concatena el código', () => {
  for (const [input, base] of [['https://horus.example.pe/verificar', BASE], ['  https://horus.example.pe/verificar/// ', BASE], ['https://HORUS.example.pe', 'https://horus.example.pe'],
    ['https://www.horus.pe/certificados/verificar/', 'https://www.horus.pe/certificados/verificar'], ['https://ñandú.pe/v', 'https://xn--and-6ma2c.pe/v']] as const) {
    const result = resolveVerificationBase(input);
    assert.ok(result.ok, input);
    if (result.ok) assert.equal(result.base, base);
  }
  assert.equal(verificationUrl(BASE, CODE), URL_OK);
  for (const absent of [undefined, null, '', '   ']) assert.deepEqual(resolveVerificationBase(absent), { ok: false, reason: 'ausente' });
  const invalid = ['http://horus.example.pe/verificar', 'https://localhost/verificar', 'https://LOCALHOST', 'https://app.localhost', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.10', 'https://[::1]/x', 'https://[2001:db8::1]/x',
    'https://8.8.8.8/x', 'https://intranet', 'https://servidor.local', 'https://api.internal', 'https://horus.example.pe:8443/x', 'https://user:pass@horus.example.pe/x', 'https://horus.example.pe/x?a=1',
    'https://horus.example.pe/x#frag', 'ftp://horus.example.pe', 'javascript:alert(1)', '//horus.example.pe', 'horus.example.pe', 'https://horus.example.pe/ con espacio', 'https://horus.example.pe/x"y', 'https://horus.example.pe/' + 'a'.repeat(150), 42, {}, ['https://horus.example.pe']];
  for (const value of invalid) assert.deepEqual(resolveVerificationBase(value), { ok: false, reason: 'invalida' }, String(JSON.stringify(value)));
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Contenido del PDF
// ---------------------------------------------------------------------------------------------------------------------------------
test('PDF: A4 horizontal de una página con institución, nombre, curso, fechas, código, URL y estado; sin DNI', async () => {
  const buffer = await renderCertificatePdf(data(), { verificationUrl: URL_OK, generatedAt: new Date('2026-12-05T20:00:00Z') });
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-'); assert.match(buffer.subarray(-8).toString(), /%%EOF/);
  const { raw, text, pages } = pdfContent(buffer);
  assert.equal(pages, 1);
  assert.match(raw, /\/MediaBox \[0 0 841\.89 595\.28\]/, 'A4 horizontal');
  for (const expected of ['HORUS GROUP SRL', 'CERTIFICADO', 'Se certifica que', 'Ana Quispe Huamán', 'cumplió con los requisitos del curso', 'Excel Intermedio', 'Edición: Edición 1',
    'Duración: 20 horas', 'Del 1 de noviembre de 2026 al 30 de noviembre de 2026', 'Emitido el 02/12/2026', CODE, URL_OK, 'Estado al generar este documento: VIGENTE (05/12/2026 15:00 (hora de Lima))', 'Escanee para verificar']) {
    assert.ok(text.includes(expected), 'falta «' + expected + '»');
  }
  assert.ok(!/ANULADO|SIN VALIDEZ/.test(text), 'un vigente no menciona anulación');
  for (const forbidden of [DNI, 'DNI', 'Documento', 'Firma:', 'Director', 'Gerente', 'acreditad', 'localhost', 'http://']) assert.ok(!text.includes(forbidden) && !raw.includes(forbidden), 'no debe aparecer «' + forbidden + '»');
  assert.ok(!text.includes('\xe1ndalo') && text.includes('Este documento no incluye firmas ni sellos'), 'declara que no hay firmas ni sellos en lugar de inventarlos');
});
test('PDF: capacitaciones, sin duración y fechas parciales o ausentes', async () => {
  const text = async (patch: Partial<CertificatePdfData>) => pdfContent(await renderCertificatePdf(data(patch), { verificationUrl: URL_OK })).text;
  assert.ok((await text({ curso_tipo: 'capacitacion' })).includes('cumplió con los requisitos de la capacitación'));
  const noDuration = await text({ curso_duracion: null });
  assert.ok(!noDuration.includes('Duraci'));
  assert.ok((await text({ convocatoria_fecha_fin: null })).includes('Desde el 1 de noviembre de 2026'));
  assert.ok((await text({ convocatoria_fecha_inicio: null })).includes('Hasta el 30 de noviembre de 2026'));
  const none = await text({ convocatoria_fecha_inicio: null, convocatoria_fecha_fin: null });
  assert.ok(!/Del |Desde |Hasta /.test(none));
  assert.equal(datesLine(null, null), null);
  assert.equal(longDate(new Date('2026-01-31T00:00:00Z')), '31 de enero de 2026');
  assert.equal(limaDateTime(new Date('2026-12-02T03:05:00Z')), '01/12/2026 22:05 (hora de Lima)');
});
test('PDF: el QR del documento es el de la URL de verificación (un rectángulo por tramo de módulos oscuros)', async () => {
  const matrix = encodeQr(URL_OK);
  let runs = 0;
  for (const row of matrix) for (let c = 0; c < row.length; c++) { if (!row[c]) continue; runs++; while (c + 1 < row.length && row[c + 1]) c++; }
  const { raw } = pdfContent(await renderCertificatePdf(data(), { verificationUrl: URL_OK }));
  const rectangles = (raw.match(/\bre\b/g) ?? []).length;
  assert.equal(rectangles, runs + 3, 'marco doble (2) + fondo blanco del QR (1) + tramos del QR');
  // Otra URL produce otro QR: no es una imagen fija.
  const other = pdfContent(await renderCertificatePdf(data(), { verificationUrl: 'https://otro.example.pe/v/' + CODE })).raw;
  assert.notEqual(other, raw);
  assert.equal(decodeQr(matrix).text, URL_OK);
});
test('PDF: un certificado anulado no puede parecer vigente (banner, marca de agua, estado, sin «VIGENTE») y no revela el motivo', async () => {
  for (const sustituido of [false, true]) {
    const { text } = pdfContent(await renderCertificatePdf({ ...data({ estado: 'anulado', sustituido }), anulacion_motivo: 'secreto interno', estudiante_doc_numero: DNI } as CertificatePdfData, { verificationUrl: URL_OK }));
    assert.ok(text.includes('CERTIFICADO ANULADO'), 'banner'); assert.ok(text.includes('SIN VALIDEZ'));
    assert.ok(text.split('\n').includes('ANULADO'), 'marca de agua');
    assert.ok(text.includes('Estado al generar este documento: ANULADO'));
    assert.equal(text.includes('SUSTITUIDO POR OTRO'), sustituido);
    assert.ok(!/VIGENTE/.test(text.replace('El estado vigente', '')), 'no dice VIGENTE');
    assert.ok(!text.includes('secreto') && !text.includes(DNI), 'ni motivo ni DNI');
    assert.ok(text.includes(URL_OK), 'conserva el QR/URL para que la verificación pública diga «no válido»');
  }
  // Cualquier estado distinto de «vigente» se trata como anulado (falla cerrado).
  assert.ok(pdfContent(await renderCertificatePdf(data({ estado: 'desconocido' }), { verificationUrl: URL_OK })).text.includes('SIN VALIDEZ'));
});
test('PDF: nombres y cursos extremos o con caracteres fuera de WinAnsi no rompen el documento ni agregan páginas', async () => {
  const awkward = data({ estudiante_nombres: 'María José '.repeat(12), estudiante_apellidos: 'Ñandú Çelik 😀 ' + 'Pérez '.repeat(12), curso_titulo: 'Curso ✓ ' + 'muy largo '.repeat(40), convocatoria_nombre: 'Edición "especial" '.repeat(5), curso_duracion: '20 horas'.repeat(5) });
  for (const estado of ['vigente', 'anulado']) {
    const { text, pages } = pdfContent(await renderCertificatePdf({ ...awkward, estado }, { verificationUrl: URL_OK }));
    assert.equal(pages, 1); assert.ok(text.includes(CODE)); assert.ok(!text.includes('😀'));
  }
});
test('PDF: con nombre y curso de dos líneas (vigente, anulado y sustituido) las fechas no pisan la emisión y nada llega al marco inferior', async () => {
  const worst = data({ estudiante_nombres: 'María Guadalupe del Carmen Rosario', estudiante_apellidos: 'Fernández de la Cruz Alvarado Quispe',
    curso_titulo: 'Gestión avanzada de proyectos de ingeniería civil, infraestructura vial y obras hidráulicas urbanas', convocatoria_nombre: 'Edición 12 - Turno noche, sede principal', curso_duracion: '120 horas académicas' });
  for (const extra of [{}, { estado: 'anulado' }, { estado: 'anulado', sustituido: true }]) {
    const { raw } = pdfContent(await renderCertificatePdf({ ...worst, ...extra }, { verificationUrl: URL_OK }));
    // Líneas de texto: [tamaño de fuente, ordenada de la línea base en coordenadas PDF (crece hacia arriba)].
    const lines = [...raw.matchAll(/BT\n1 0 0 1 [\d.]+ ([\d.]+) Tm\n\/F\d (\d+(?:\.\d+)?) Tf/g)].map(m => ({ y: Number(m[1]), size: Number(m[2]) })).filter(l => l.size !== 130);
    const details = lines.filter(l => l.size === 11.5).map(l => l.y);
    const emitted = lines.find(l => l.size === 9.5)!;
    assert.equal(details.length, 3, 'edición, duración y fechas');
    // Base de la última línea de fechas menos la base de «Emitido el»: debe caber el descendente de una y el ascendente de la otra.
    assert.ok(Math.min(...details) - emitted.y >= 9, 'las fechas no pisan la emisión: ' + (Math.min(...details) - emitted.y));
    // El marco interior está a 29 pt del borde; la línea más baja (URL / etiqueta del QR) conserva al menos 10 pt de aire.
    assert.ok(Math.min(...lines.map(l => l.y)) >= 29 + 10, 'margen inferior: ' + Math.min(...lines.map(l => l.y)));
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Servicio: PDF administrativo
// ---------------------------------------------------------------------------------------------------------------------------------
const fullRow = (extra: Record<string, unknown> = {}) => ({ ...data(), estudiante_doc_numero: DNI, anulacion_motivo: 'secreto interno', anulado_por: 1, sustituido_por: null, ...extra }) as Record<string, any>;
function serviceWith(rows: Record<string, any>[]) {
  const selects: Array<Record<string, unknown>> = [];
  const prisma = { certificado: { findUnique: async ({ where, select }: any) => {
    selects.push(select);
    const row = rows.find(r => r.id === where.id);
    return row ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : null; // devuelve SOLO lo seleccionado, como Prisma
  } } };
  return { service: new CertificadosService(prisma as unknown as PrismaService), selects };
}

test('Servicio PDF: genera el documento con la URL configurada, sin pedir DNI ni motivo, y nombra el archivo con el código', async () => {
  const { service, selects } = serviceWith([fullRow({ id: 1 })]);
  const file = await service.pdf(1, ENV_OK, new Date('2026-12-05T20:00:00Z'));
  assert.equal(file.fileName, 'certificado-' + CODE + '.pdf');
  const { text, raw } = pdfContent(file.buffer);
  assert.ok(text.includes(URL_OK) && text.includes('Ana Quispe'));
  assert.ok(!text.includes(DNI) && !raw.includes(DNI) && !text.includes('secreto'));
  const selected = Object.keys(selects[0]);
  for (const forbidden of ['estudiante_doc_numero', 'estudiante_doc_tipo', 'estudiante_doc_pais', 'anulacion_motivo', 'anulado_por', 'emitido_por', 'matricula_id']) assert.ok(!selected.includes(forbidden), forbidden + ' no se consulta');
});
test('Servicio PDF: un anulado (o sustituido) sale como anulado; el estado se toma de la base al generar', async () => {
  const { service } = serviceWith([fullRow({ id: 2, estado: 'anulado' }), fullRow({ id: 3, estado: 'anulado', sustituido_por: { id: 9 } })]);
  assert.ok(pdfContent((await service.pdf(2, ENV_OK)).buffer).text.includes('CERTIFICADO ANULADO - SIN VALIDEZ'));
  assert.ok(pdfContent((await service.pdf(3, ENV_OK)).buffer).text.includes('SUSTITUIDO POR OTRO'));
});
test('Servicio PDF: errores controlados — 404 si no existe; 503 sin URL pública o con una URL insegura (nunca localhost ni la solicitud)', async () => {
  const { service } = serviceWith([fullRow({ id: 1 })]);
  await assert.rejects(service.pdf(99, ENV_OK), NotFoundException);
  for (const env of [{}, { [VERIFICATION_URL_ENV]: '' }, { [VERIFICATION_URL_ENV]: 'http://localhost:5173/verificar' }, { [VERIFICATION_URL_ENV]: 'https://127.0.0.1' }, { [VERIFICATION_URL_ENV]: 'http://horus.example.pe' }, { HOST: 'https://evil.example', ORIGIN: 'https://evil.example' }]) {
    await assert.rejects(service.pdf(1, env), (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException);
      const message = JSON.stringify(error.getResponse());
      assert.ok(!message.includes(VERIFICATION_URL_ENV) && !/localhost|127\.0\.0\.1|CERTIFICADOS/.test(message), 'el mensaje al usuario no expone configuración');
      return true;
    }, JSON.stringify(env));
  }
});
test('Servicio PDF: una base sin la estructura académica da 503 controlado, no un error interno', async () => {
  const prisma = { certificado: { findUnique: async () => { throw Object.assign(new Error('The table `certificados` does not exist'), { code: 'P2021', name: 'PrismaClientKnownRequestError' }); } } };
  await assert.rejects(new CertificadosService(prisma as unknown as PrismaService).pdf(1, ENV_OK), (error: unknown) => error instanceof ServiceUnavailableException || (error as { code?: string }).code === 'P2021');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Autorización
// ---------------------------------------------------------------------------------------------------------------------------------
test('Autorización: el PDF exige certificados:leer; emitir sigue siendo de Gerencia y Coordinación; anular y sustituir, solo Gerencia', () => {
  const access = (handler: Function) => Reflect.getMetadata(ACCESS_METADATA, handler);
  const proto = CertificadosController.prototype;
  assert.deepEqual(access(proto.pdf), { kind: 'permiso', permission: 'certificados:leer' });
  assert.deepEqual(access(proto.emit), { kind: 'permiso', permission: 'certificados:emitir' });
  assert.deepEqual(access(proto.annul), { kind: 'permiso', permission: 'certificados:anular' });
  assert.deepEqual(access(proto.substitute), { kind: 'permiso', permission: 'certificados:anular' });
  assert.deepEqual(access(CertificadosPublicController.prototype.verify), { kind: 'publica' });
  const G = 'GERENTE_GENERAL', C = 'COORDINADORA_INSTITUCIONAL', S = 'SECRETARIA';
  assert.deepEqual([can(G, 'certificados:leer'), can(C, 'certificados:leer'), can(S, 'certificados:leer'), can(null, 'certificados:leer')], [true, true, false, false]);
  assert.deepEqual([can(G, 'certificados:emitir'), can(C, 'certificados:emitir'), can(S, 'certificados:emitir')], [true, true, false]);
  assert.deepEqual([can(G, 'certificados:anular'), can(C, 'certificados:anular'), can(S, 'certificados:anular')], [true, false, false]);
  assert.deepEqual([can(G, 'matriculas:confirmar'), can(C, 'matriculas:confirmar'), can(S, 'matriculas:confirmar')], [true, true, false]);
  assert.ok(!Reflect.getMetadata('path', proto.pdf).includes('..'));
  assert.equal(Reflect.getMetadata('path', proto.pdf), ':id/pdf');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Verificación pública: límite de frecuencia
// ---------------------------------------------------------------------------------------------------------------------------------
function limiter() {
  const memory = memoryBuckets();
  const guard = new PublicRateLimitGuard(memory.prisma as never);
  const call = (method: string, path: string, ip = '203.0.113.1') => guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method, path, ip, socket: { remoteAddress: ip } }) }) } as never);
  const outcome = async (method: string, path: string, ip?: string) => { try { await call(method, path, ip); return 200; } catch (error) { if (error instanceof HttpException) return error.getStatus(); throw error; } };
  return { ...memory, outcome };
}
// El guard cuenta por minuto/hora natural: se fija el reloj para que una prueba no cruce el cambio de ventana.
async function withClock<T>(work: () => Promise<T>): Promise<T> {
  const real = Date.now, fixed = Math.floor(real() / 3_600_000) * 3_600_000 + 1_800_000;
  Date.now = () => fixed;
  try { return await work(); } finally { Date.now = real; }
}
const verify = (code: string) => '/api/certificados/verificar/' + code;

test('Frecuencia/verificación: 30 consultas por minuto por IP; la 31 recibe 429; otra IP conserva su cuota', () => withClock(async () => {
  const l = limiter();
  for (let i = 0; i < 30; i++) assert.equal(await l.outcome('GET', verify(CODE)), 200, 'consulta ' + (i + 1));
  assert.equal(await l.outcome('GET', verify(CODE)), 429);
  assert.equal(await l.outcome('GET', verify('OTROCODIGOCUALQUIERA')), 429, 'cambiar de código no evita el límite');
  assert.equal(await l.outcome('GET', verify(CODE), '198.51.100.77'), 200, 'otra IP (otra subred) tiene su cuota');
}));
test('Frecuencia/verificación: códigos válidos, inexistentes y mal formados gastan la misma cuota (el 429 no revela si el código existe)', () => withClock(async () => {
  const l = limiter();
  const codes = [CODE, 'ZZZZZZZZZZZZZZZZZZZZ', 'x', 'ABC%20DEF', "'%20OR%201=1", 'a'.repeat(300), CODE.toLowerCase()];
  for (let i = 0; i < 30; i++) assert.equal(await l.outcome('GET', verify(codes[i % codes.length])), 200);
  for (const code of codes) assert.equal(await l.outcome('GET', verify(code)), 429, code);
  assert.equal(l.total() > 0, true);
}));
test('Frecuencia/verificación: aplica con barra final, mayúsculas y sin el prefijo /api; las demás rutas GET y el resto de POST no cambian', () => withClock(async () => {
  const l = limiter();
  for (let i = 0; i < 10; i++) await l.outcome('GET', '/api/certificados/verificar/' + CODE + '/');
  for (let i = 0; i < 10; i++) await l.outcome('GET', '/API/CERTIFICADOS/VERIFICAR/' + CODE);
  for (let i = 0; i < 10; i++) await l.outcome('GET', '/certificados/verificar/' + CODE);
  assert.equal(await l.outcome('GET', verify(CODE)), 429, 'las tres formas comparten una sola cuota');
  const free = limiter();
  for (let i = 0; i < 100; i++) {
    assert.equal(await free.outcome('GET', '/api/admin/certificados/1/pdf'), 200);
    assert.equal(await free.outcome('GET', '/api/certificados/verificar'), 200, 'sin código no es esa ruta');
    assert.equal(await free.outcome('GET', '/api/certificados/verificar/a/b'), 200);
    assert.equal(await free.outcome('GET', '/api/cursos'), 200);
  }
  assert.equal(free.total(), 0, 'no se cuenta nada fuera de la verificación');
  const post = limiter();
  for (let i = 0; i < 5; i++) assert.equal(await post.outcome('POST', '/api/contacto'), 200);
  assert.equal(await post.outcome('POST', '/api/contacto'), 429, 'los formularios siguen con su límite de 5');
  assert.equal(await post.outcome('GET', verify(CODE)), 200, 'la verificación tiene su propio contador por ruta');
}));
test('Frecuencia/verificación: tope por subred (90/min), por hora (200) y global (600/min); una IP bloqueada no agota el global', () => withClock(async () => {
  // Subred /24: 90 por minuto en total aunque cada IP gaste menos de 30.
  const subnet = limiter();
  let admitted = 0;
  for (let host = 1; host <= 5; host++) for (let i = 0; i < 25; i++) if (await subnet.outcome('GET', verify(CODE), '203.0.113.' + host) === 200) admitted++;
  assert.equal(admitted, 90);
  // Por hora: una IP que respeta los 30/min igualmente se detiene a las 200 consultas de la hora.
  const fixed = Date.now, base = fixed();
  const hourly = limiter();
  let perHour = 0;
  try {
    for (let minute = 0; minute < 8; minute++) {
      Date.now = () => base + minute * 60_000;
      for (let i = 0; i < 30; i++) if (await hourly.outcome('GET', verify(CODE), '192.0.2.50') === 200) perHour++;
    }
  } finally { Date.now = fixed; }
  assert.equal(perHour, 200);
  // Global: 20 subredes distintas llenan 600/min; la 21 recibe 429.
  const global = limiter();
  let globalAdmitted = 0;
  for (let net = 1; net <= 21; net++) for (let i = 0; i < 30; i++) if (await global.outcome('GET', verify(CODE), '198.51.' + net + '.10') === 200) globalAdmitted++;
  assert.equal(globalAdmitted, 600);
  // Una IP que insiste tras bloquearse solo gasta su propio tope: no consume ni el global ni las cuotas ajenas.
  const own = limiter();
  for (let i = 0; i < 200; i++) await own.outcome('GET', verify(CODE), '192.0.2.1');
  assert.equal(own.total(), 4 * 30, 'IP, hora, subred y global: 30 admitidas en cada uno; los rechazos no suman');
  assert.equal(await own.outcome('GET', verify(CODE), '198.51.100.5'), 200);
}));
test('Frecuencia/verificación: la ventana por minuto se reinicia', async () => {
  const real = Date.now, start = Math.floor(real() / 3_600_000) * 3_600_000 + 600_000;
  try {
    Date.now = () => start;
    const l = limiter();
    for (let i = 0; i < 30; i++) await l.outcome('GET', verify(CODE));
    assert.equal(await l.outcome('GET', verify(CODE)), 429);
    Date.now = () => start + 61_000;
    assert.equal(await l.outcome('GET', verify(CODE)), 200);
  } finally { Date.now = real; }
});

// HTTP real: mismo 404 para códigos mal formados e inexistentes, y límite por visitante detrás de un proxy de confianza (como main.ts).
async function startPublic(trusted: string | undefined, rows: Record<string, any> = {}) {
  const calls: unknown[] = [];
  const prisma = { certificado: { findUnique: async ({ where }: any) => { calls.push(where.codigo_verificacion); return rows[where.codigo_verificacion] ?? null; } } };
  const service = new CertificadosService(prisma as unknown as PrismaService);
  @Module({ controllers: [CertificadosPublicController], providers: [{ provide: CertificadosService, useValue: service }, { provide: APP_GUARD, useClass: PublicRateLimitGuard }, { provide: PrismaService, useValue: memoryBuckets().prisma }] })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  app.set('trust proxy', trustedProxies(trusted));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  const get = (path: string, forwardedFor?: string) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path, headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {} }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
  return { get, calls, close: () => app.close() };
}
const stored = { estado: 'vigente', estudiante_nombres: 'Ana', estudiante_apellidos: 'Quispe', curso_titulo: 'Excel', curso_tipo: 'curso', curso_duracion: null, convocatoria_nombre: 'Ed 1', convocatoria_fecha_inicio: null, convocatoria_fecha_fin: null, emitido_at: new Date('2026-12-02T00:00:00Z'), sustituido_por: null };

test('Verificación HTTP: contrato intacto (200 con la vista pública) y el mismo 404 exacto para mal formado e inexistente', () => withClock(async () => {
  const server = await startPublic(undefined, { [CODE]: stored });
  try {
    const ok = await server.get('/api/certificados/verificar/' + CODE);
    assert.equal(ok.status, 200); assert.equal(ok.headers['cache-control'], 'no-store');
    const body = JSON.parse(ok.body);
    assert.deepEqual(Object.keys(body).sort(), ['convocatoria', 'curso', 'emitido', 'estado', 'estudiante', 'ok', 'sustituido', 'valido']);
    assert.ok(!ok.body.includes(DNI));
    const unknown = await server.get('/api/certificados/verificar/ZZZZZZZZZZZZZZZZZZZZ');
    const malformed = await server.get('/api/certificados/verificar/no-es-un-codigo');
    const injection = await server.get("/api/certificados/verificar/'%20OR%201=1--");
    const tooLong = await server.get('/api/certificados/verificar/' + 'A'.repeat(500));
    for (const miss of [unknown, malformed, injection, tooLong]) { assert.equal(miss.status, 404); assert.equal(miss.body, unknown.body); assert.equal(miss.headers['cache-control'], 'no-store'); }
    assert.match(unknown.body, /No se encontr/);
    assert.deepEqual(server.calls, [CODE, 'ZZZZZZZZZZZZZZZZZZZZ'], 'los formatos imposibles ni siquiera consultan la base');
  } finally { await server.close(); }
}));
test('Verificación HTTP: detrás de un proxy confiable cada visitante tiene su cuota y una X-Forwarded-For falsificada no evita el límite', () => withClock(async () => {
  const server = await startPublic('127.0.0.1/32');
  const A = '203.0.113.7', B = '198.51.100.9';
  try {
    for (let i = 0; i < 30; i++) assert.equal((await server.get('/api/certificados/verificar/ZZZZZZZZZZZZZZZZZZZ' + (i % 10), A)).status, 404);
    const blocked = await server.get('/api/certificados/verificar/' + CODE, A);
    assert.equal(blocked.status, 429);
    assert.ok(!blocked.body.includes(CODE) && !/existe|encontr/i.test(blocked.body), 'el 429 no dice nada del código');
    assert.equal((await server.get('/api/certificados/verificar/' + CODE, '9.9.9.9, 8.8.8.8, ' + A)).status, 429, 'los valores inventados a la izquierda no cambian la IP');
    assert.equal((await server.get('/api/certificados/verificar/' + CODE, B)).status, 404, 'otro visitante no hereda el bloqueo');
  } finally { await server.close(); }
}));
