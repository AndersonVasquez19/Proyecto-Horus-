import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { CotizacionesController } from '../src/cotizaciones/cotizaciones.module';
import { CotizacionesService } from '../src/cotizaciones/cotizaciones.service';
import { money, renderQuotePdf, type QuotePdfData } from '../src/cotizaciones/cotizaciones.pdf';
import { ACCESS_METADATA } from '../src/permissions/access.decorators';
import { ROUTE_INVENTORY } from '../src/permissions/route-inventory';
import { can } from '../src/permissions/policy';

// PDF de cotizaciones: aislado, sin MySQL, sin correo y sin red. Datos ficticios. La base es un doble en memoria que SOLO sabe leer:
// cualquier escritura (create, update, updateMany, delete, $transaction) lanza un error y hace fallar la prueba.

// Texto visible del PDF: descomprime los flujos y concatena las cadenas hexadecimales (WinAnsi) que pdfkit escribe con las fuentes estándar.
function pdfContent(buffer: Buffer): { raw: string; text: string; pages: number } {
  const latin = buffer.toString('latin1');
  let raw = latin;
  // pdfkit declara la longitud directa de sus flujos Flate. No recortar por saltos: el último byte
  // comprimido puede ser CR y confundirse con el delimitador LF que viene antes de endstream.
  for (const match of latin.matchAll(/\/Length\s+(\d+)\s+\/Filter \/FlateDecode\s*>>\r?\nstream\r?\n/g)) {
    const start = match.index + match[0].length;
    raw += '\n' + inflateSync(buffer.subarray(start, start + Number(match[1]))).toString('latin1');
  }
  const chunks = [...raw.matchAll(/\[((?:\s*<[0-9a-fA-F]*>\s*-?[\d.]*)+)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)];
  const text = chunks.map(m => [...(m[1] ?? m[2]).matchAll(/<([0-9a-fA-F]*)>/g)].map(h => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n');
  return { raw, text, pages: Number(/\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(raw)?.[1] ?? 0) };
}

const EMAIL = 'compras@andina.example', PHONE = '999 111 222';

test('PDF: el lector de prueba conserva el último byte CR de un flujo comprimido', () => {
  // Adler-32 acaba en 0x0d para este texto. El salto LF que lo sigue pertenece al PDF, no al flujo.
  const compressed = deflateSync(Buffer.from('[<41>] TJ\n%xxx ', 'latin1'));
  assert.equal(compressed.at(-1), 13, 'la fixture debe terminar en CR');
  for (const eol of ['\n', '\r\n']) {
    const buffer = Buffer.concat([
      Buffer.from('1 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream' + eol, 'latin1'),
      compressed, Buffer.from(eol + 'endstream\nendobj\n', 'latin1'),
    ]);
    assert.equal(pdfContent(buffer).text, 'A');
  }
});

const row = (extra: Record<string, unknown> = {}) => ({
  id: 17, numero: 'COT-2026-000017', estado: 'enviada', revision: 9, cliente: 'Constructora Andina Muñoz SAC', email: EMAIL, telefono: PHONE, documento: '20123456789',
  direccion: 'Av. Principal 123, Lima', emisor: 'Horus Group SRL', datos_emisor: 'RUC 20000000000 · Av. Ejemplo 100', moneda: 'PEN', validez: new Date('2099-11-30T00:00:00Z'),
  condiciones: 'Pago 50% adelanto. Capacitación en sede del cliente.', contacto_id: 42,
  conceptos: [{ descripcion: 'Capacitación in-house de gestión', cantidad: 2, precio: 1500.5, importe: 3001 }],
  subtotal: new Prisma.Decimal('3001.00'), descuento: new Prisma.Decimal('100.00'), tasa: new Prisma.Decimal('18.00'), impuesto: new Prisma.Decimal('522.18'), total: new Prisma.Decimal('3423.18'),
  historial: [{ accion: 'Creada como borrador', usuario: 3, fecha: '2026-10-22T15:04:05.000Z' }, { accion: 'NOTA-INTERNA-SECRETA', usuario: 3, fecha: '2026-10-22T15:10:00.000Z' }],
  idempotencia_clave: 'CLAVE-IDEMPOTENCIA-INTERNA', idempotencia_huella: 'HUELLA-INTERNA', createdAt: new Date('2026-10-22T15:04:05Z'), updatedAt: new Date('2026-10-22T15:04:05Z'), ...extra,
});

function fakeService(rows: Record<string, any>[]) {
  const reads: any[] = [];
  const forbidden = (name: string) => async () => { throw new Error('Escritura inesperada en la descarga del PDF: ' + name); };
  const cotizacion = {
    // Copia superficial: conserva las instancias Prisma.Decimal como las devuelve la base real.
    findUnique: async (args: any) => { reads.push(args); const found = rows.find(r => r.id === args.where.id); return found ? { ...found } : null; },
    create: forbidden('create'), update: forbidden('update'), updateMany: forbidden('updateMany'), upsert: forbidden('upsert'), delete: forbidden('delete'), deleteMany: forbidden('deleteMany'),
  };
  const prisma = { cotizacion, $transaction: forbidden('$transaction'), $executeRaw: forbidden('$executeRaw'), $queryRaw: forbidden('$queryRaw') };
  return { service: new CotizacionesService(prisma as unknown as PrismaService), reads, rows };
}

test('PDF: se descarga una cotización existente — documento válido, textos en español y contenido de la cotización', async () => {
  const { service } = fakeService([row()]);
  const file = await service.pdf(17);
  assert.equal(file.fileName, 'cotizacion-COT-2026-000017.pdf');
  assert.equal(file.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(file.buffer.subarray(-16).toString('latin1'), /%%EOF\s*$/);
  const { text, pages } = pdfContent(file.buffer);
  assert.equal(pages, 1);
  for (const expected of ['HORUS GROUP SRL', 'COTIZACIÓN', 'COT-2026-000017', 'ENVIADA', 'Constructora Andina Muñoz SAC', '20123456789', 'Av. Principal 123, Lima', 'Documento: 20123456789',
    'RUC 20000000000 · Av. Ejemplo 100', 'Capacitación in-house de gestión', 'Pago 50% adelanto. Capacitación en sede del cliente.', 'Condiciones y observaciones', 'Detalle de la propuesta']) {
    assert.ok(text.includes(expected), 'falta «' + expected + '» en el PDF');
  }
  assert.ok(file.buffer.toString('latin1').includes('/Lang (es-PE)'));
});

test('PDF: importes y fechas exactos — se muestran los valores guardados, sin recalcular ni inventar', async () => {
  const { service } = fakeService([row()]);
  const { text } = pdfContent((await service.pdf(17)).buffer);
  for (const expected of ['3,001.00', '1,500.50', '- 100.00', '522.18', 'S/ 3,423.18', 'Impuesto (tasa 18.00 %)', 'Soles (PEN)', '30 de noviembre de 2099']) assert.ok(text.includes(expected), expected);
  // createdAt es un instante UTC: 03:00 UTC del 22 de octubre es el 21 de octubre en Lima (UTC-5).
  const late = pdfContent((await fakeService([row({ createdAt: new Date('2026-10-22T03:00:00Z') })]).service.pdf(17)).buffer).text;
  assert.ok(late.includes('21 de octubre de 2026') && !late.includes('22 de octubre de 2026'));
  // El PDF toma el total guardado aunque no coincida con lo que se calcularía: no hay recálculo propio.
  const stored = pdfContent((await fakeService([row({ total: new Prisma.Decimal('9999.99') })]).service.pdf(17)).buffer).text;
  assert.ok(stored.includes('S/ 9,999.99') && !stored.includes('3,423.18'));
  // Sin descuento ni impuesto no se imprimen líneas que no existen; en dólares el símbolo cambia.
  const plain = pdfContent((await fakeService([row({ moneda: 'USD', descuento: new Prisma.Decimal('0.00'), tasa: new Prisma.Decimal('0.00'), impuesto: new Prisma.Decimal('0.00'), total: new Prisma.Decimal('3001.00') })]).service.pdf(17)).buffer).text;
  assert.ok(!plain.includes('Descuento') && !plain.includes('Impuesto') && plain.includes('US$ 3,001.00') && plain.includes('Dólares estadounidenses (USD)'));
});

test('PDF: money() formatea sin pasar por coma flotante y rechaza lo que no es un importe', () => {
  assert.equal(money('3423.18'), '3,423.18');
  assert.equal(money('0.5'), '0.50');
  assert.equal(money('1000000000.00'), '1,000,000,000.00');
  assert.equal(money(1500.5), '1,500.50');
  assert.equal(money('abc'), '—');
});

test('PDF: privacidad — no incluye correo ni teléfono del cliente, historial, revisión, claves internas ni el contacto de origen, y la lectura usa un select explícito', async () => {
  const { service, reads } = fakeService([row()]);
  const file = await service.pdf(17);
  const { text, raw } = pdfContent(file.buffer);
  for (const secret of [EMAIL, PHONE, 'NOTA-INTERNA-SECRETA', 'Creada como borrador', 'CLAVE-IDEMPOTENCIA-INTERNA', 'HUELLA-INTERNA', 'Revisión', 'revision']) {
    assert.ok(!text.includes(secret) && !raw.includes(secret), 'no debe aparecer «' + secret + '»');
  }
  const select = reads[0].select;
  assert.ok(select && !('historial' in select) && !('revision' in select) && !('email' in select) && !('telefono' in select) && !('idempotencia_clave' in select) && !('idempotencia_huella' in select) && !('contacto_id' in select));
  assert.equal(select.total, true);
});

test('PDF: 404 para un id inexistente o fuera de rango, sin consultar la base cuando el id no puede existir', async () => {
  const { service, reads } = fakeService([row()]);
  await assert.rejects(service.pdf(999), NotFoundException);
  for (const id of [0, -1, 1.5, 2147483648, Number.NaN]) await assert.rejects(service.pdf(id), NotFoundException, String(id));
  assert.equal(reads.length, 1, 'solo el 999 llegó a la base');
});

test('PDF: la descarga es de solo lectura — ninguna escritura y la cotización (estado, revisión, historial) queda idéntica', async () => {
  const rows = [row({ estado: 'borrador' }), row({ id: 18, numero: 'COT-2026-000018', estado: 'anulada' })];
  const before = JSON.stringify(rows);
  const { service, reads } = fakeService(rows);
  await service.pdf(17); await service.pdf(18); await service.pdf(17);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(reads.length, 3, 'una sola consulta findUnique por descarga');
  assert.ok(reads.every(args => Object.keys(args).sort().join() === 'select,where'));
});

test('PDF: el estado actual se ve — borrador y anulada con marca de agua y aviso; vencida lo dice; aceptada y rechazada se rotulan', async () => {
  const render = async (extra: Record<string, unknown>) => pdfContent((await fakeService([row(extra)]).service.pdf(17)).buffer);
  const draft = await render({ estado: 'borrador' });
  assert.ok(draft.text.includes('BORRADOR') && draft.text.includes('Esta cotización es un borrador: aún no ha sido emitida y su contenido puede cambiar.'));
  const annulled = await render({ estado: 'anulada' });
  assert.ok(annulled.text.includes('ANULADA') && annulled.text.includes('Esta cotización fue anulada y no tiene validez.'));
  const expired = await render({ estado: 'enviada', validez: new Date('2020-01-01T00:00:00Z') });
  assert.ok(expired.text.includes('ENVIADA - VIGENCIA VENCIDA') && expired.text.includes('1 de enero de 2020'));
  assert.ok((await render({ estado: 'aceptada' })).text.includes('ACEPTADA'));
  const rejected = await render({ estado: 'rechazada' });
  assert.ok(rejected.text.includes('RECHAZADA') && rejected.text.includes('Se registró que esta propuesta fue rechazada.'));
  const current = await render({ estado: 'enviada' });
  assert.ok(!current.text.includes('borrador') && !current.text.includes('anulada') && !current.text.includes('VENCIDA'));
});

test('PDF: texto fuera de WinAnsi o malicioso no rompe el documento ni se interpreta', async () => {
  const hostile = 'Cliente ' + String.fromCodePoint(0x1f600) + ' ' + String.fromCodePoint(0xff1d) + ' <script>alert(1)</script> %PDF) Tj (hack' + String.fromCharCode(0, 0x202e);
  const condiciones = 'Línea 1' + String.fromCharCode(13, 10) + 'Línea 2' + String.fromCharCode(9) + String.fromCharCode(0x2014, 32, 0x201c) + 'comillas' + String.fromCharCode(0x201d, 32, 0x20ac) + ' ñ';
  const japones = String.fromCodePoint(0x65e5, 0x672c, 0x8a9e);
  const { service } = fakeService([row({ cliente: hostile, condiciones, conceptos: [{ descripcion: japones, cantidad: 1, precio: 1, importe: 1 }, null, 'texto', { descripcion: 5, cantidad: 'x' }] })]);
  const { buffer } = await service.pdf(17);
  const { text, pages } = pdfContent(buffer);
  assert.ok(pages >= 1 && buffer.subarray(0, 5).toString('latin1') === '%PDF-');
  // WinAnsi en la salida: comillas curvas 0x93/0x94 y raya 0x97; el euro, 0x80.
  assert.ok(text.includes('<script>alert(1)</script>') && text.includes('Tj (hack?') && text.includes('Línea 2') && text.includes(String.fromCharCode(0x93) + 'comillas' + String.fromCharCode(0x94)) && text.includes(String.fromCharCode(0x80)) && text.includes('ñ'));
  assert.ok(!text.includes(String.fromCodePoint(0x1f600)) && !text.includes(japones), 'lo que no existe en WinAnsi se sustituye por ?');
  assert.ok(text.includes(String.fromCharCode(0x97)), 'los conceptos ilegibles se muestran como una raya, no se inventan');
});

test('PDF: una cotización larga (50 conceptos y 5000 caracteres de condiciones) ocupa varias páginas, con cabecera y pie en cada una', async () => {
  const conceptos = Array.from({ length: 50 }, (_, i) => ({ descripcion: 'Servicio ' + (i + 1) + ' — ' + 'descripción detallada de la prestación '.repeat(4), cantidad: i + 1, precio: 10.25, importe: Math.round((i + 1) * 1025) / 100 }));
  const condiciones = Array.from({ length: 50 }, (_, i) => 'Condición ' + (i + 1) + ': ' + 'texto de la condición comercial registrada. '.repeat(2)).join('\n').slice(0, 5000);
  const { service } = fakeService([row({ conceptos, condiciones })]);
  const { text, pages } = pdfContent((await service.pdf(17)).buffer);
  assert.ok(pages >= 3, 'páginas: ' + pages);
  assert.ok(text.split('HORUS GROUP SRL').length - 1 >= pages, 'la cabecera institucional se repite en cada página');
  for (let page = 1; page <= pages; page++) assert.ok(text.includes('Página ' + page + ' de ' + pages), 'pie de la página ' + page);
  assert.ok(text.includes('Servicio 50') && text.includes('Condición 1:'), 'el contenido llega completo al documento');
  assert.ok(text.includes('P. unitario') && text.split('P. unitario').length - 1 >= 2, 'el encabezado de la tabla se repite tras el salto de página');
});

test('PDF: no se escribe nada en disco durante la generación', async () => {
  const written: string[] = [];
  const originals = { writeFile: fs.writeFile, writeFileSync: fs.writeFileSync, createWriteStream: fs.createWriteStream, appendFileSync: fs.appendFileSync };
  (fs as any).writeFile = (...args: any[]) => { written.push(String(args[0])); return (originals.writeFile as any)(...args); };
  (fs as any).writeFileSync = (...args: any[]) => { written.push(String(args[0])); return (originals.writeFileSync as any)(...args); };
  (fs as any).createWriteStream = (...args: any[]) => { written.push(String(args[0])); return (originals.createWriteStream as any)(...args); };
  (fs as any).appendFileSync = (...args: any[]) => { written.push(String(args[0])); return (originals.appendFileSync as any)(...args); };
  try { await fakeService([row()]).service.pdf(17); } finally { Object.assign(fs, originals); }
  assert.deepEqual(written, []);
});

test('PDF: un renderizado directo respeta la fecha de generación recibida (pie en hora de Lima) y el servicio no envía correo', async () => {
  const data: QuotePdfData = { numero: 'COT-2026-000001', estado: 'aceptada', vencida: false, cliente: 'Ana', documento: '', direccion: '', emisor: 'Horus Group SRL', datos_emisor: '', moneda: 'PEN', validez: '2099-01-31',
    condiciones: '', conceptos: [], subtotal: '0.00', descuento: '0.00', tasa: '0.00', impuesto: '0.00', total: '0.00', createdAt: new Date('2026-01-05T15:00:00Z') };
  const { text } = pdfContent(await renderQuotePdf(data, { generatedAt: new Date('2026-12-31T04:30:00Z') }));
  assert.ok(text.includes('30/12/2026 23:30 (hora de Lima)'), 'el pie usa la hora de Lima');
  assert.ok(text.includes('No hay conceptos registrados.') && !text.includes('Documento:') && !text.includes('Condiciones y observaciones'));
  // Sin dependencia del correo: el servicio se construye únicamente con la base (fakeService no pasa MailService).
  assert.ok(!fs.readFileSync(path.join(__dirname, '../src/cotizaciones/cotizaciones.pdf.ts'), 'utf8').match(/MailService|nodemailer|resend/i));
});

test('Autorización: el PDF exige cotizaciones:leer (como el detalle), figura en el inventario y solo lo reciben Gerencia y Coordinación', () => {
  const access = (handler: Function) => Reflect.getMetadata(ACCESS_METADATA, handler);
  const proto = CotizacionesController.prototype;
  assert.deepEqual(access(proto.pdf), { kind: 'permiso', permission: 'cotizaciones:leer' });
  assert.deepEqual(access(proto.pdf), access(proto.detail));
  const headers = Reflect.getMetadata('__headers__', proto.pdf) as { name: string; value: string }[];
  assert.ok(headers.some(h => h.name === 'Cache-Control' && h.value === 'no-store'));
  const entry = ROUTE_INVENTORY.find(r => r.method === 'GET' && r.path === 'admin/cotizaciones/:id/pdf');
  assert.deepEqual(entry!.access, { kind: 'permiso', permission: 'cotizaciones:leer' });
  assert.ok(entry, 'falta la entrada en route-inventory.ts');
  const [G, C, S] = ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL', 'SECRETARIA'];
  assert.deepEqual([can(G, 'cotizaciones:leer'), can(C, 'cotizaciones:leer'), can(S, 'cotizaciones:leer'), can(null, 'cotizaciones:leer')], [true, true, false, false]);
});

test('Autorización: no existe restricción por registro en cotizaciones — el PDF no devuelve más que el detalle a quien tiene cotizaciones:leer', () => {
  // El detalle (`GET :id`) devuelve el registro completo a cualquier lector; el PDF usa el mismo permiso y un subconjunto estricto de columnas.
  const source = fs.readFileSync(path.join(__dirname, '../src/cotizaciones/cotizaciones.service.ts'), 'utf8');
  const pdfMethod = /async pdf\([\s\S]*?\r?\n  }\r?\n/.exec(source)![0];
  assert.ok(!/\b(create|update|updateMany|upsert|delete|deleteMany|\$transaction|\$executeRaw)\b/.test(pdfMethod));
  assert.ok(!/historial|revision|email|telefono|idempotencia|contacto_id/.test(pdfMethod.replace(/\/\/.*$/gm, '')));
});
