import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import type { MailOutcome } from '../src/mail/mail.service';
import { createValidationPipe } from '../src/common/validation';
import { AttentionService } from '../src/attention/attention.service';
import { AttentionDto } from '../src/attention/attention.dto';
import { MESSAGE_STATES, MESSAGE_TRANSITIONS, allowedTransitions, checkMessageChange, summarizeQuotes } from '../src/attention/attention-rules';
import { MessagesService } from '../src/admin/messages/messages.service';
import { MessageQueryDto } from '../src/admin/messages/dto/query-messages.dto';
import { PrismaAsistenteData } from '../src/asistente/asistente.data';
import { HORAS_MENSAJE_ANTIGUO } from '../src/asistente/asistente.rules';
import { operatingDay } from '../src/asistente/asistente.time';
import { StatsService } from '../src/admin/stats/stats.service';
import type { CatalogoService } from '../src/catalogo/catalogo.service';
import { can } from '../src/permissions/policy';
import { seguimientoPermission } from '../src/permissions/permissions';
import { ROUTE_INVENTORY } from '../src/permissions/route-inventory';

// Proceso de atención de consultas. Todo con dobles en memoria y datos ficticios: sin MySQL, sin correo real, sin red.
const VISITOR = 'visitante@example.test';
const SECRET_NOTE = 'Nota privada del equipo 8841';
const SECRET_REPLY = 'Texto de la respuesta 9917';
const config = { get: (key: string) => (key === 'MAIL_USER' ? 'interno@example.test' : undefined) } as unknown as ConfigService;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const status = (error: unknown) => (error as { getStatus?: () => number }).getStatus?.();

type Row = { id: number; recurso: string; registro_id: number; estado: string; responsable: string; notas: string; respuesta: string; historial: any[]; revision: number };
type Quote = { contacto_id: number; estado: string; validez: Date };

function fakeDb(initial: { estado?: string; quotes?: Quote[] } = {}) {
  const contact = { id: 1, nombre: 'Ana', email: VISITOR, telefono: '999111222', asunto: 'Consulta', mensaje: 'Hola', estado: initial.estado ?? 'nuevo' };
  const attention: Row[] = [], quotes: Quote[] = initial.quotes ?? [];
  let nextId = 1, writes = 0;
  const find = (where: any) => attention.find(r => r.recurso === where.recurso_registro_id.recurso && r.registro_id === where.recurso_registro_id.registro_id);
  const attentionRecord = {
    findUnique: async ({ where }: any) => { await tick(); const row = find(where); return row ? structuredClone(row) : null; },
    findUniqueOrThrow: async ({ where }: any) => { const row = find(where); if (!row) throw new Error('no existe'); return structuredClone(row); },
    updateMany: async ({ where, data }: any) => { writes++; const row = attention.find(r => r.id === where.id && r.revision === where.revision); if (!row) return { count: 0 }; Object.assign(row, structuredClone(data)); return { count: 1 }; },
    create: async ({ data }: any) => { writes++; const row = { id: nextId++, ...structuredClone(data) }; attention.push(row); return row; },
  };
  const isOpen = (q: Quote, today: Date) => q.estado === 'borrador' || (q.estado === 'enviada' && q.validez >= today);
  const cotizacion = {
    count: async ({ where }: any) => { const today = where.OR[1].validez.gte as Date; return quotes.filter(q => q.contacto_id === where.contacto_id && isOpen(q, today)).length; },
    groupBy: async ({ where }: any) => {
      const by = new Map<string, number>();
      for (const q of quotes.filter(q => q.contacto_id === where.contacto_id)) by.set(q.estado, (by.get(q.estado) ?? 0) + 1);
      return [...by].map(([estado, n]) => ({ estado, _count: { _all: n } }));
    },
  };
  const contacto = {
    findUnique: async () => ({ ...contact }),
    update: async ({ data }: any) => { contact.estado = data.estado; return { ...contact }; },
  };
  const tx = { attentionRecord, contacto, cotizacion, $queryRaw: async () => [{ id: 1 }] };
  const prisma = { attentionRecord, contacto, cotizacion, $transaction: async (fn: any) => fn(tx), $queryRaw: tx.$queryRaw } as unknown as PrismaService;
  return { prisma, attention, contact, quotes, writes: () => writes };
}
function fakeMail(outcome: () => MailOutcome = () => ({ status: 'accepted', providerId: 'prov_1' })) {
  const calls: string[] = [];
  return { calls, mail: { deliver: async (m: { to: string }) => { calls.push(m.to); return outcome(); } } as any };
}
const service = (db: ReturnType<typeof fakeDb>, mail: any = fakeMail().mail) => new AttentionService(db.prisma, mail, config);
const body = (revision: number, estado: string, extra: Partial<{ responsable: string; notas: string; respuesta: string }> = {}) => ({ revision, estado, responsable: '', notas: '', respuesta: '', ...extra });
const rejects = async (promise: Promise<unknown>, code: number) => { try { await promise; } catch (error) { assert.equal(status(error), code, String((error as Error).message)); return (error as Error).message; } assert.fail('debía rechazar con ' + code); };

// ---------------------------------------------------------------- reglas puras

test('reglas: la matriz cubre los cuatro estados y nunca vuelve a «nuevo»', () => {
  assert.deepEqual(Object.keys(MESSAGE_TRANSITIONS).sort(), [...MESSAGE_STATES].sort());
  for (const state of MESSAGE_STATES) assert.equal(allowedTransitions(state).includes('nuevo'), false, state + ' no vuelve a nuevo');
  assert.deepEqual(allowedTransitions('archivado'), ['en_proceso', 'atendido'], 'reabrir un caso archivado');
  assert.deepEqual(allowedTransitions('historico'), ['nuevo', 'en_proceso', 'atendido', 'archivado'], 'un estado anterior desconocido no atrapa al administrador');
  assert.equal(checkMessageChange({ from: 'nuevo', to: 'nuevo', respuesta: '', notas: '' }), null, 'quedarse en el mismo estado siempre es válido');
  assert.match(String(checkMessageChange({ from: 'atendido', to: 'nuevo', respuesta: 'x', notas: '' })), /no puede pasar/);
  assert.match(String(checkMessageChange({ from: 'en_proceso', to: 'atendido', respuesta: '  ', notas: ' ' })), /respuesta o una nota/);
  assert.equal(checkMessageChange({ from: 'en_proceso', to: 'atendido', respuesta: '', notas: 'Se llamó por teléfono' }), null);
  assert.deepEqual(summarizeQuotes([{ estado: 'borrador', _count: { _all: 2 } }, { estado: 'enviada', _count: { _all: 1 } }, { estado: 'aceptada', _count: { _all: 1 } }, { estado: 'otra', _count: { _all: 9 } }]),
    { total: 4, abiertas: 3, por_estado: { borrador: 2, enviada: 1, aceptada: 1, rechazada: 0, anulada: 0 } });
});

// ---------------------------------------------------------------- flujo de atención

test('flujo: recibida → en proceso → respuesta enviada → atendida → archivada, con historial sin contenido privado', async () => {
  const db = fakeDb(), { mail, calls } = fakeMail(), svc = service(db, mail);
  const first = await svc.get('messages', 1, true);
  assert.equal(first.item.estado, 'nuevo');
  assert.deepEqual(first.item.transiciones_permitidas, ['en_proceso', 'atendido', 'archivado']);
  assert.equal(first.item.cotizaciones?.total, 0);

  // Revisión y asignación: primer seguimiento.
  const reviewed = await svc.save('messages', 1, body(1, 'en_proceso', { responsable: 'Rosa', notas: SECRET_NOTE, respuesta: SECRET_REPLY }), 7);
  assert.equal(reviewed.item.estado, 'en_proceso');
  assert.equal(reviewed.item.revision, 2);
  assert.equal(db.contact.estado, 'en_proceso', 'Contacto y seguimiento se mantienen sincronizados');
  assert.deepEqual(reviewed.item.transiciones_permitidas, ['atendido', 'archivado']);
  const entry = reviewed.item.historial[0] as Record<string, unknown>;
  assert.equal(entry.accion, 'Seguimiento actualizado: en_proceso', 'el texto que ya muestra el panel se conserva');
  assert.equal(entry.estado_anterior, 'nuevo'); assert.equal(entry.estado_nuevo, 'en_proceso'); assert.equal(entry.usuario, 7);
  assert.deepEqual(entry.cambios, ['responsable', 'notas', 'respuesta'], 'solo nombres de campos');
  assert.equal(JSON.stringify(reviewed.item.historial).includes(SECRET_NOTE) || JSON.stringify(reviewed.item.historial).includes(SECRET_REPLY), false, 'el historial no copia notas ni respuestas');

  // Respuesta realmente enviada: solo existe evidencia tras el envío aceptado por el proveedor.
  assert.equal(reviewed.item.envios.respuesta, null, 'guardar la respuesta no es enviarla');
  const sent = await svc.send('messages', 1, reviewed.item.revision, 7);
  assert.equal(sent.envio, 'aceptado');
  assert.deepEqual(calls, [VISITOR]);
  const afterSend = await svc.get('messages', 1, true);
  assert.equal(afterSend.item.envios.respuesta?.estado, 'aceptado');
  assert.equal(afterSend.item.estado, 'en_proceso', 'enviar no cierra solo: el cierre es una decisión explícita');

  const closed = await svc.save('messages', 1, body(afterSend.item.revision, 'atendido', { responsable: 'Rosa', notas: SECRET_NOTE, respuesta: SECRET_REPLY }), 7);
  assert.equal(closed.item.estado, 'atendido'); assert.equal(db.contact.estado, 'atendido');
  const archived = await svc.save('messages', 1, body(closed.item.revision, 'archivado', { responsable: 'Rosa', notas: SECRET_NOTE, respuesta: SECRET_REPLY }), 7);
  assert.equal(archived.item.estado, 'archivado'); assert.equal(db.contact.estado, 'atendido', 'Contacto solo conoce tres estados');
  const history = archived.item.historial as any[];
  assert.equal(history.filter(h => h.correo).length, 2, 'el envío quedó en el mismo historial como intento (iniciado) y resultado (aceptado)');
  assert.deepEqual(history.filter(h => h.estado_nuevo).map(h => [h.estado_anterior, h.estado_nuevo]), [['nuevo', 'en_proceso'], ['en_proceso', 'atendido'], ['atendido', 'archivado']]);
  const reopened = await svc.save('messages', 1, body(archived.item.revision, 'en_proceso', { responsable: 'Rosa', notas: SECRET_NOTE, respuesta: SECRET_REPLY }), 8);
  assert.equal(reopened.item.estado, 'en_proceso', 'un caso archivado se puede reabrir');
});

test('un intento fallido o incierto queda registrado como tal: cerrar el caso no inventa una entrega', async () => {
  for (const [outcome, expected, code] of [[{ status: 'failed' as const, reason: 'x' }, 'fallido', 503], [{ status: 'uncertain' as const, reason: 'x' }, 'incierto', 502]] as const) {
    const db = fakeDb(), { mail } = fakeMail(() => outcome), svc = service(db, mail);
    const saved = await svc.save('messages', 1, body(1, 'en_proceso', { respuesta: SECRET_REPLY }), 1);
    await rejects(svc.send('messages', 1, saved.item.revision, 1), code);
    const current = await svc.get('messages', 1, true);
    assert.equal(current.item.envios.respuesta?.estado, expected);
    const closed = await svc.save('messages', 1, body(current.item.revision, 'atendido', { respuesta: SECRET_REPLY }), 1);
    assert.equal(closed.item.estado, 'atendido');
    assert.equal(closed.item.envios.respuesta?.estado, expected, 'el estado administrativo no oculta el resultado real del envío');
  }
});

test('no se envía una respuesta a una consulta archivada', async () => {
  const db = fakeDb(), { mail, calls } = fakeMail(), svc = service(db, mail);
  const saved = await svc.save('messages', 1, body(1, 'archivado', { respuesta: SECRET_REPLY }), 1);
  const message = await rejects(svc.send('messages', 1, saved.item.revision, 1), 400);
  assert.match(message, /archivada/);
  assert.deepEqual(calls, [], 'no se contactó al proveedor');
});

// ---------------------------------------------------------------- validaciones y errores

test('transiciones: se rechazan los saltos no permitidos y el cierre sin evidencia, sin escribir', async () => {
  const db = fakeDb(), svc = service(db);
  const s1 = await svc.save('messages', 1, body(1, 'en_proceso', { responsable: 'Rosa' }), 1);
  const before = JSON.stringify(db.attention);
  assert.match(await rejects(svc.save('messages', 1, body(s1.item.revision, 'nuevo', { responsable: 'Rosa' }), 1), 400), /no puede pasar/);
  assert.match(await rejects(svc.save('messages', 1, body(s1.item.revision, 'atendido', { responsable: 'Rosa' }), 1), 400), /respuesta o una nota/);
  assert.equal(JSON.stringify(db.attention), before, 'un rechazo no modifica el seguimiento');
  assert.equal(db.contact.estado, 'en_proceso');
  // Con una nota que explique cómo se atendió, sí.
  const ok = await svc.save('messages', 1, body(s1.item.revision, 'atendido', { responsable: 'Rosa', notas: 'Se atendió por llamada' }), 1);
  assert.equal(ok.item.estado, 'atendido');
  await rejects(svc.save('messages', 1, body(ok.item.revision, 'nuevo', { notas: 'Se atendió por llamada' }), 1), 400);
});

test('un caso ya cerrado o con datos anteriores no queda atrapado: se puede anotar sin cambiar de estado', async () => {
  const db = fakeDb({ estado: 'historico' }), svc = service(db);
  const saved = await svc.save('messages', 1, body(1, 'historico' as string, { notas: 'Nota' }), 1).catch(e => e);
  // El DTO real solo admite los cuatro estados, pero el servicio no atrapa un estado antiguo si no cambia.
  assert.equal(saved.item?.estado, 'historico');
  const moved = await svc.save('messages', 1, body(saved.item.revision, 'atendido', { notas: 'Nota' }), 1);
  assert.equal(moved.item.estado, 'atendido', 'desde un estado desconocido se puede pasar a los estados actuales');
});

test('DTO: estado desconocido, revisión inválida y campos ajenos se rechazan antes del servicio', async () => {
  const pipe = createValidationPipe(), meta = { type: 'body' as const, metatype: AttentionDto };
  const valid = { revision: 1, estado: 'en_proceso', responsable: ' Rosa ', notas: '', respuesta: '' };
  assert.equal(((await pipe.transform({ ...valid }, meta)) as AttentionDto).responsable, 'Rosa', 'se normalizan los espacios');
  for (const bad of [{ ...valid, estado: 'cerrado' }, { ...valid, revision: 0 }, { ...valid, revision: '1' }, { ...valid, responsable: 'x'.repeat(101) }, { ...valid, notas: 'x'.repeat(10001) }, { ...valid, usuario: 99 }, { ...valid, estado: undefined }]) {
    await assert.rejects(() => pipe.transform(bad, meta), (e: unknown) => status(e) === 400);
  }
  const query = { type: 'query' as const, metatype: MessageQueryDto };
  assert.equal(((await pipe.transform({ page: '2', vista: 'resumen', antiguas: 'si', responsable: ' Rosa ' }, query)) as MessageQueryDto).responsable, 'Rosa');
  for (const bad of [{ vista: 'todo' }, { antiguas: 'no' }, { responsable: 'x'.repeat(101) }, { limit: '101' }]) await assert.rejects(() => pipe.transform(bad, query), (e: unknown) => status(e) === 400);
});

test('un recurso desconocido y una consulta inexistente responden con error controlado', async () => {
  const db = fakeDb(), svc = service(db);
  await rejects(svc.get('otro', 1), 400);
  await rejects(svc.save('otro', 1, body(1, 'nuevo'), 1), 400);
  (db.prisma as any).contacto.findUnique = async () => null;
  await rejects(svc.get('messages', 404), 404);
  await rejects(svc.save('messages', 404, body(1, 'en_proceso'), 1), 404);
});

// ---------------------------------------------------------------- concurrencia e idempotencia

test('concurrencia: dos guardados con la misma revisión → uno gana y el otro recibe 409', async () => {
  const db = fakeDb(), svc = service(db);
  const first = await svc.save('messages', 1, body(1, 'en_proceso', { responsable: 'Rosa' }), 1);
  const results = await Promise.allSettled([
    svc.save('messages', 1, body(first.item.revision, 'en_proceso', { responsable: 'Rosa', notas: 'A' }), 1),
    svc.save('messages', 1, body(first.item.revision, 'en_proceso', { responsable: 'Rosa', notas: 'B' }), 2),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(status((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), 409);
  assert.equal(db.attention[0].historial.length, 2, 'ninguna entrada del historial se pierde ni se duplica');
});

test('idempotencia: repetir el mismo guardado no sube la revisión ni duplica el historial', async () => {
  const db = fakeDb(), svc = service(db);
  const first = await svc.save('messages', 1, body(1, 'en_proceso', { responsable: 'Rosa' }), 1);
  const writes = db.writes();
  const again = await svc.save('messages', 1, body(first.item.revision, 'en_proceso', { responsable: 'Rosa' }), 1);
  assert.equal(again.item.revision, first.item.revision);
  assert.equal((again.item.historial as unknown[]).length, 1);
  assert.equal(db.writes(), writes, 'no hubo escrituras');
  await rejects(svc.save('messages', 1, body(first.item.revision - 1, 'en_proceso', { responsable: 'Rosa' }), 1), 409);
});

test('un doble envío simultáneo de la respuesta contacta una sola vez al proveedor', async () => {
  const calls: string[] = [];
  const mail = { deliver: async (m: { to: string }) => { calls.push(m.to); await tick(); return { status: 'accepted' } as MailOutcome; } };
  const db = fakeDb(), svc = service(db, mail);
  const saved = await svc.save('messages', 1, body(1, 'en_proceso', { respuesta: SECRET_REPLY }), 1);
  const results = await Promise.allSettled([svc.send('messages', 1, saved.item.revision, 1), svc.send('messages', 1, saved.item.revision, 2)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------- consistencia con cotizaciones

test('cotizaciones: no se archiva una consulta con cotizaciones abiertas; sí con cotizaciones resueltas o vencidas', async () => {
  const future = new Date(Date.now() + 10 * 86_400_000), past = new Date(Date.now() - 10 * 86_400_000);
  for (const [open, quote] of [[true, { estado: 'borrador', validez: future }], [true, { estado: 'enviada', validez: future }], [false, { estado: 'enviada', validez: past }],
    [false, { estado: 'aceptada', validez: future }], [false, { estado: 'rechazada', validez: future }], [false, { estado: 'anulada', validez: future }]] as const) {
    const db = fakeDb({ quotes: [{ contacto_id: 1, ...quote }, { contacto_id: 99, estado: 'borrador', validez: future }] }), svc = service(db);
    const attempt = svc.save('messages', 1, body(1, 'archivado', { notas: 'Cierre' }), 1);
    if (open) { assert.match(await rejects(attempt, 400), /cotizaciones abiertas/); assert.equal(db.attention.length, 0); assert.equal(db.contact.estado, 'nuevo'); }
    else assert.equal((await attempt).item.estado, 'archivado', quote.estado + (quote.validez === past ? ' vencida' : ''));
  }
});

test('cotizaciones: marcar atendida una consulta con propuesta enviada sí se permite, y el detalle resume sus cotizaciones', async () => {
  const future = new Date(Date.now() + 10 * 86_400_000);
  const db = fakeDb({ quotes: [{ contacto_id: 1, estado: 'enviada', validez: future }, { contacto_id: 1, estado: 'rechazada', validez: future }] }), svc = service(db);
  const closed = await svc.save('messages', 1, body(1, 'atendido', { respuesta: SECRET_REPLY }), 1);
  assert.equal(closed.item.estado, 'atendido');
  const detail = await svc.get('messages', 1, true);
  assert.deepEqual(detail.item.cotizaciones, { total: 2, abiertas: 1, por_estado: { borrador: 0, enviada: 1, aceptada: 0, rechazada: 1, anulada: 0 } });
  assert.equal(JSON.stringify(detail.item.cotizaciones).includes('example'), false, 'solo conteos: ningún dato del cliente');
  assert.equal('cotizaciones' in (await svc.get('messages', 1)).item, false, 'las lecturas internas no pagan el resumen');
});

// ---------------------------------------------------------------- permisos

test('permisos: la secretaría atiende consultas pero no reclamaciones, cotizaciones, estadísticas ni borrados', () => {
  const S = 'SECRETARIA', C = 'COORDINADORA_INSTITUCIONAL', G = 'GERENTE_GENERAL';
  for (const operation of ['leer', 'editar', 'enviar'] as const) {
    for (const role of [S, C, G]) assert.equal(can(role, seguimientoPermission('messages', operation)), true, role + ' ' + operation);
    assert.equal(can(S, seguimientoPermission('reclamaciones', operation)), false, 'la secretaría no atiende reclamaciones');
    assert.equal(can(null, seguimientoPermission('messages', operation)), false, 'sin rol no hay acceso');
  }
  for (const denied of ['mensajes:eliminar', 'cotizaciones:leer', 'cotizaciones:crear', 'cotizaciones:anular', 'estadisticas:leer', 'reclamaciones:leer']) assert.equal(can(S, denied), false, 'secretaría: ' + denied);
  assert.equal(can(C, 'mensajes:eliminar'), false, 'borrar una consulta es solo del gerente');
  assert.equal(can(G, 'mensajes:eliminar'), true);
  assert.equal(seguimientoPermission('cotizaciones', 'editar'), null);
  // Las cuatro rutas de seguimiento y las de consultas existen en el inventario y ninguna es pública.
  const routes = ROUTE_INVENTORY.filter(route => route.path.startsWith('admin/seguimiento') || route.path.startsWith('admin/messages'));
  assert.equal(routes.length >= 9, true);
  assert.equal(routes.every(route => route.access.kind !== 'publica'), true);
});

// ---------------------------------------------------------------- listado, privacidad y asistente (SQL real sobre SQLite en memoria)

function listFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE contactos (id INTEGER, nombre TEXT, email TEXT, telefono TEXT, asunto TEXT, mensaje TEXT, estado TEXT, origen TEXT, createdAt TEXT, updatedAt TEXT);
    CREATE TABLE attention_records (recurso TEXT, registro_id INTEGER, estado TEXT, responsable TEXT);`);
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const rows = [
    [1, 'nuevo', hoursAgo(100), 'web', 'Consulta A ' + 'a'.repeat(300)], [2, 'nuevo', hoursAgo(2), 'chatbot', 'Consulta B'], [3, 'nuevo', hoursAgo(60), 'web', 'Consulta C'],
    [4, 'nuevo', hoursAgo(80), 'web', 'Consulta D'], [5, 'nuevo', hoursAgo(1), 'web', 'Consulta E'],
  ] as const;
  for (const [id, estado, createdAt, origen, mensaje] of rows) db.prepare('INSERT INTO contactos VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, 'Persona ' + id, 'p' + id + '@example.test', '99900000' + id, 'Asunto ' + id, mensaje, estado, origen, createdAt, createdAt);
  db.prepare('INSERT INTO attention_records VALUES (?,?,?,?)').run('messages', 1, 'en_proceso', 'Rosa');
  db.prepare('INSERT INTO attention_records VALUES (?,?,?,?)').run('messages', 3, 'atendido', 'Rosa');
  db.prepare('INSERT INTO attention_records VALUES (?,?,?,?)').run('messages', 4, 'en_proceso', 'Luis');
  const queries: Prisma.Sql[] = [];
  // node:sqlite no enlaza objetos Date: se envían como texto ISO, igual que están guardadas las fechas del fixture.
  const bind = (values: unknown[]) => values.map(v => (v instanceof Date ? v.toISOString() : v)) as SQLInputValue[];
  const prisma = { $queryRaw: async (q: Prisma.Sql) => { queries.push(q); assert.match(q.sql, /^\s*SELECT/i); return db.prepare(q.sql.replaceAll(' COLLATE utf8mb4_unicode_ci', '')).all(...bind(q.values)); } } as unknown as PrismaService;
  return { db, prisma, queries };
}

test('privacidad: la vista resumen no devuelve correo, teléfono ni el mensaje completo; la completa conserva el contrato', async () => {
  const f = listFixture();
  try {
    const messages = new MessagesService(f.prisma);
    const full = await messages.findAll({ page: 1, limit: 20 });
    assert.ok(full.messages.every(row => 'email' in row && 'telefono' in row && 'mensaje' in row), 'el contrato completo del panel actual no cambia');
    const summary = await messages.findAll({ page: 1, limit: 20, vista: 'resumen' });
    assert.equal(summary.messages.length, 5);
    for (const row of summary.messages) {
      for (const key of ['email', 'telefono', 'mensaje']) assert.equal(key in row, false, key + ' reservado al detalle');
      assert.equal(JSON.stringify(row).includes('example.test') || JSON.stringify(row).includes('99900000'), false);
      assert.equal(typeof row.vista_previa, 'string');
    }
    assert.equal(summary.messages.find(row => row.id === 1)?.vista_previa?.length, 160, 'la vista previa se acorta');
    assert.deepEqual(Object.keys(summary.messages[0]).sort(), ['asunto', 'createdAt', 'estado', 'id', 'nombre', 'origen', 'responsable', 'updatedAt', 'vista_previa']);
    // El detalle (mismo permiso mensajes:leer) conserva los datos completos aunque se pida la vista resumen.
    const detail = await messages.findOne(2);
    assert.equal(detail.message.email, 'p2@example.test'); assert.equal(detail.message.telefono, '999000002');
    assert.equal('email' in (await messages.findAll({ vista: 'resumen' })).messages[0], false, 'también sin paginar');
  } finally { f.db.close(); }
});

test('privacidad: la actividad reciente del resumen no incluye correos', async () => {
  const f = listFixture();
  try {
    const stats = new StatsService({ stats: async () => ({}) } as unknown as CatalogoService, {
      ...(f.prisma as object), reclamacion: { count: async () => 0, findMany: async () => [] }, adminItem: { count: async () => 0 }, adminUser: { count: async () => 1 },
    } as unknown as PrismaService);
    const result = await stats.getDashboardStats();
    assert.equal(result.actividadReciente.mensajes.length, 5);
    assert.equal(JSON.stringify(result.actividadReciente.mensajes).includes('example.test'), false);
    assert.deepEqual(Object.keys(result.actividadReciente.mensajes[0]).sort(), ['asunto', 'createdAt', 'estado', 'id', 'nombre']);
  } finally { f.db.close(); }
});

test('filtros: responsable y antiguas se aplican antes de paginar y coinciden con el conteo de HORUS Assistant', async () => {
  const f = listFixture();
  try {
    const messages = new MessagesService(f.prisma);
    const byOwner = await messages.findAll({ page: 1, limit: 1, responsable: 'Rosa', vista: 'resumen' });
    assert.ok('pagination' in byOwner && byOwner.pagination);
    assert.equal(byOwner.pagination.total, 2); assert.equal(byOwner.pagination.pages, 2); assert.equal(byOwner.messages.length, 1);
    assert.deepEqual(byOwner.metrics, { nuevo: 2, en_proceso: 2, atendido: 1, archivado: 0 }, 'las métricas siguen siendo globales');
    // «Antigua» = nueva o en proceso con más de 48 h: 1 (100 h, en_proceso), 4 (80 h, en_proceso). La 3 es de 60 h pero está atendida.
    const old = await messages.findAll({ page: 1, limit: 20, antiguas: 'si', vista: 'resumen' });
    assert.deepEqual(old.messages.map(row => row.id).sort(), [1, 4]);
    assert.equal(HORAS_MENSAJE_ANTIGUO, 48);
    // El asistente cuenta exactamente las mismas consultas con la misma regla.
    const data = new PrismaAsistenteData(f.prisma);
    const section = await data.read('atencion', operatingDay(new Date()), new Date());
    assert.equal(section?.antiguos, old.messages.length);
    assert.equal(section?.nuevos, 2); assert.equal(section?.enProceso, 2);
    // Parámetros siempre enlazados: un valor hostil no llega al SQL.
    const hostile = await messages.findAll({ page: 1, responsable: "' OR 1=1 --" });
    assert.deepEqual(hostile.messages, []);
    assert.equal(f.queries.every(q => !q.sql.includes('OR 1=1')), true);
  } finally { f.db.close(); }
});

test('HORUS Assistant: la lectura de atención es solo SELECT de conteos y no contiene datos de clientes', async () => {
  const f = listFixture();
  try {
    const data = new PrismaAsistenteData(f.prisma);
    const section = await data.read('atencion', operatingDay(new Date()), new Date());
    assert.ok(section);
    for (const value of Object.values(section)) assert.equal(typeof value, 'number', 'solo cifras');
    const sql = f.queries.map(q => q.sql).join('\n');
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\b/i);
    assert.doesNotMatch(sql, /SELECT\s+(?:DISTINCT\s+)?(?:m\.)?(nombre|email|telefono|mensaje|asunto)\b/i);
    assert.equal(JSON.stringify(section).includes('example.test'), false);
  } finally { f.db.close(); }
});
