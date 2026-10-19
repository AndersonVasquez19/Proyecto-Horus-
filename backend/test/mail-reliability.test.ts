import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ConfigService } from '@nestjs/config';
import { classifyGmailError, type MailOutcome } from '../src/mail/mail.service';
import { attemptEntry, decideSend, fingerprint, lastAttempt, stateOfOutcome } from '../src/mail/mail-attempts';
import { AttentionService } from '../src/attention/attention.service';
import { CotizacionesService } from '../src/cotizaciones/cotizaciones.service';
import { RecoveryThrottle } from '../src/admin/auth/recovery-throttle';

// Todo con dobles en memoria: sin MySQL, sin Resend, sin Gmail, sin red.
const SECRET_TEXT = 'Texto privado de la respuesta 123';
const VISITOR = 'visitante@example.test';
const config = { get: (key: string) => (key === 'MAIL_USER' ? 'interno@example.test' : undefined) } as unknown as ConfigService;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

type Row = { id: number; recurso: string; registro_id: number; estado: string; responsable: string; notas: string; respuesta: string; historial: any[]; revision: number };
function fakeDb(options: { failFinish?: boolean } = {}) {
  const attention: Row[] = [], quotes: any[] = [];
  let nextId = 1, writes = 0;
  const attentionModel = {
    findUnique: async ({ where }: any) => { await tick(); const k = where.recurso_registro_id; const row = attention.find(r => r.recurso === k.recurso && r.registro_id === k.registro_id); return row ? structuredClone(row) : null; },
    findUniqueOrThrow: async ({ where }: any) => { const k = where.recurso_registro_id; const row = attention.find(r => r.recurso === k.recurso && r.registro_id === k.registro_id); if (!row) throw new Error('no existe'); return structuredClone(row); },
    updateMany: async ({ where, data }: any) => {
      writes++;
      // El segundo guardado (resultado) falla cuando se simula una caída de la base tras aceptar el proveedor.
      if (options.failFinish && writes > 1) throw new Error('base de datos no disponible');
      const row = attention.find(r => r.id === where.id && r.revision === where.revision); if (!row) return { count: 0 };
      Object.assign(row, structuredClone({ ...data, revision: data.revision })); return { count: 1 };
    },
    create: async ({ data }: any) => { const row = { id: nextId++, ...structuredClone(data) }; attention.push(row); return row; },
  };
  const quoteModel = {
    findUnique: async ({ where }: any) => { await tick(); const row = quotes.find(q => q.id === where.id); return row ? structuredClone(row) : null; },
    updateMany: async ({ where, data }: any) => {
      writes++;
      if (options.failFinish && writes > 1) throw new Error('base de datos no disponible');
      const row = quotes.find(q => q.id === where.id && q.revision === where.revision); if (!row) return { count: 0 };
      row.historial = structuredClone(data.historial); row.revision = where.revision + 1; return { count: 1 };
    },
  };
  const tx = { attentionRecord: attentionModel, cotizacion: quoteModel, $queryRaw: async () => [{ id: 1 }] };
  const prisma: any = {
    attentionRecord: attentionModel, cotizacion: quoteModel,
    contacto: { findUnique: async () => ({ id: 1, nombre: 'Ana', email: VISITOR, telefono: '', asunto: 'Consulta', mensaje: 'Hola', estado: 'nuevo' }) },
    reclamacion: { findUnique: async () => ({ id: 1, email: VISITOR, nombres: 'Ana', apellidos: 'Pérez', tipo_registro: 'reclamo', numero_reclamo: 'REC-1', area: 'x', detalle_reclamo: 'y' }) },
    $transaction: async (fn: any) => fn(tx), $queryRaw: tx.$queryRaw,
  };
  return { prisma, attention, quotes };
}
function fakeMail(outcome: () => MailOutcome | Promise<MailOutcome> = () => ({ status: 'accepted', providerId: 'prov_1' })) {
  const calls: string[] = [];
  const mail: any = {
    deliver: async (m: any) => { calls.push('respuesta:' + m.to); return outcome(); },
    deliverContactoConfirmacion: async (d: any) => { calls.push('confirmacion:' + d.email); return outcome(); },
    deliverContactoAviso: async () => { calls.push('AVISO_INTERNO'); return outcome(); },
    deliverReclamoConstancia: async (d: any) => { calls.push('constancia:' + d.email); return outcome(); },
  };
  return { mail, calls };
}
const seedAttention = (db: ReturnType<typeof fakeDb>, extra: Partial<Row> = {}) => { db.attention.push({ id: 1, recurso: 'messages', registro_id: 1, estado: 'en_proceso', responsable: '', notas: '', respuesta: SECRET_TEXT, historial: [], revision: 3, ...extra }); };
const status = (error: any) => ({ code: error.getStatus?.(), body: error.getResponse?.() });
const rejectsWith = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return status(error); } assert.fail('debía rechazar'); };

test('Gmail: errores de SMTP se clasifican sin tratar todo como fallo', () => {
  assert.equal(classifyGmailError({ code: 'EAUTH', responseCode: 535 }).status, 'failed');
  assert.equal(classifyGmailError({ code: 'EENVELOPE' }).status, 'failed');
  assert.equal(classifyGmailError({ code: 'ESOCKET', syscall: 'connect' }).status, 'failed');
  assert.equal(classifyGmailError({ responseCode: 550, command: 'RCPT TO' }).status, 'failed');
  assert.equal(classifyGmailError({ code: 'ETIMEDOUT', command: 'DATA' }).status, 'uncertain');
  assert.equal(classifyGmailError({ code: 'ECONNECTION', command: 'DATA' }).status, 'uncertain');
  assert.equal(classifyGmailError(new Error('algo inesperado')).status, 'uncertain');
  assert.equal(classifyGmailError(undefined).status, 'uncertain');
});

test('registro de intentos: huella, decisión y último estado', () => {
  const h = fingerprint('respuesta', 'messages', '1', VISITOR, 'a'), other = fingerprint('respuesta', 'messages', '1', VISITOR, 'b');
  assert.notEqual(h, other);
  const hist = [attemptEntry('respuesta', 'iniciado', 1, h, 'i1'), attemptEntry('respuesta', 'incierto', 1, h, 'i1')];
  assert.equal(lastAttempt(hist, 'respuesta', h)?.estado, 'incierto');
  assert.equal(lastAttempt(hist, 'respuesta', other), null);
  assert.equal(lastAttempt([{ accion: 'viejo' }, null, 'x'], 'respuesta', h), null, 'entradas antiguas se ignoran');
  assert.deepEqual(decideSend(null, false), { allow: true });
  assert.deepEqual(decideSend({ intento: 'i', estado: 'fallido', fecha: '' }, false), { allow: true });
  for (const [estado, motivo] of [['iniciado', 'en_curso'], ['aceptado', 'ya_aceptado'], ['incierto', 'incierto']] as const) {
    assert.equal(decideSend({ intento: 'i', estado, fecha: '2000-01-01' }, false).motivo, motivo, 'nunca se desbloquea por el tiempo transcurrido');
    assert.equal(decideSend({ intento: 'i', estado, fecha: '2000-01-01' }, true).allow, true);
  }
  assert.equal(stateOfOutcome({ status: 'accepted' }), 'aceptado');
  assert.ok(!JSON.stringify(attemptEntry('respuesta', 'aceptado', 1, h, 'i1', 'id con espacios <script>')).includes('script'), 'ids de proveedor con forma rara se descartan');
});

test('respuesta aceptada: reclama antes, registra después y no incluye datos sensibles', async () => {
  const db = fakeDb(); seedAttention(db);
  const { mail, calls } = fakeMail(); const service = new AttentionService(db.prisma, mail, config);
  const result: any = await service.send('messages', 1, 3, 7);
  assert.equal(result.envio, 'aceptado'); assert.equal(result.registrado, true); assert.equal(calls.length, 1);
  assert.deepEqual(db.attention[0].historial.map((e: any) => e.correo.estado), ['iniciado', 'aceptado']);
  assert.equal(db.attention[0].revision, 5, 'cada escritura sube la revisión');
  assert.equal(result.item.revision, 5); assert.equal(result.item.envios.respuesta.estado, 'aceptado');
  const stored = JSON.stringify(db.attention[0].historial);
  assert.ok(!stored.includes(VISITOR) && !stored.includes(SECRET_TEXT), 'el historial no guarda destinatarios ni texto');
  assert.match(result.mensaje, /no confirma/i);
});

test('respuesta fallida: 503 estructurado y se puede volver a intentar sin confirmar', async () => {
  const db = fakeDb(); seedAttention(db);
  let ok = false; const { mail, calls } = fakeMail(() => ok ? { status: 'accepted' } : { status: 'failed', reason: 'x' });
  const service = new AttentionService(db.prisma, mail, config);
  const first: any = await rejectsWith(service.send('messages', 1, 3, 7));
  assert.equal(first.code, 503); assert.equal(first.body.envio, 'fallido'); assert.equal(first.body.item.envios.respuesta.estado, 'fallido');
  ok = true;
  const again: any = await service.send('messages', 1, first.body.revision, 7);
  assert.equal(again.envio, 'aceptado'); assert.equal(calls.length, 2);
});

test('resultado incierto: 502, sin invitar a reenviar y con bloqueo hasta confirmar', async () => {
  const db = fakeDb(); seedAttention(db);
  let accept = false; const { mail, calls } = fakeMail(() => accept ? { status: 'accepted' } : { status: 'uncertain', reason: 'timeout' }); const service = new AttentionService(db.prisma, mail, config);
  const first: any = await rejectsWith(service.send('messages', 1, 3, 7));
  assert.equal(first.code, 502); assert.equal(first.body.envio, 'incierto');
  assert.ok(!/reintent|vuelve a intentar|no se envi/i.test(first.body.mensaje), 'no afirma que no se envió ni invita a reintentar');
  const blocked: any = await rejectsWith(service.send('messages', 1, first.body.revision, 7));
  assert.equal(blocked.code, 409); assert.equal(blocked.body.motivo, 'incierto'); assert.equal(blocked.body.requiere_confirmacion, true); assert.equal(calls.length, 1, 'el bloqueo no llega al proveedor');
  accept = true;
  const confirmed: any = await service.send('messages', 1, first.body.revision, 7, true);
  assert.equal(confirmed.envio, 'aceptado'); assert.equal(calls.length, 2);
});

test('doble clic y dos sesiones: solo una petición llega al proveedor', async () => {
  const db = fakeDb(); seedAttention(db);
  const { mail, calls } = fakeMail(async () => { await tick(); return { status: 'accepted' }; }); const service = new AttentionService(db.prisma, mail, config);
  const results = await Promise.allSettled([service.send('messages', 1, 3, 7), service.send('messages', 1, 3, 8), service.send('messages', 1, 3, 7)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(calls.length, 1);
  for (const r of results) if (r.status === 'rejected') assert.equal((r.reason as any).getStatus(), 409);
});

test('revisión obsoleta: 409 sin llegar al proveedor', async () => {
  const db = fakeDb(); seedAttention(db); const { mail, calls } = fakeMail(); const service = new AttentionService(db.prisma, mail, config);
  assert.equal((await rejectsWith(service.send('messages', 1, 2, 7))).code, 409); assert.equal(calls.length, 0);
});

test('intento iniciado sin resultado bloquea (no se desbloquea por tiempo) y ya aceptado exige confirmar', async () => {
  const db = fakeDb(); seedAttention(db); const { mail, calls } = fakeMail(); const service = new AttentionService(db.prisma, mail, config);
  const record: any = await service.get('messages', 1); void record;
  const huella = fingerprint('respuesta', 'messages', '1', VISITOR, SECRET_TEXT);
  const old = attemptEntry('respuesta', 'iniciado', 1, huella, 'viejo'); old.fecha = '2001-01-01T00:00:00.000Z';
  db.attention[0].historial.push(old);
  const blocked: any = await rejectsWith(service.send('messages', 1, 3, 7));
  assert.equal(blocked.body.motivo, 'en_curso'); assert.equal(calls.length, 0);
  db.attention[0].historial.push(attemptEntry('respuesta', 'aceptado', 1, huella, 'viejo'));
  assert.equal((await rejectsWith(service.send('messages', 1, 3, 7))).body.motivo, 'ya_aceptado');
});

test('contenido nuevo es otro envío lógico y no hereda el bloqueo', async () => {
  const db = fakeDb(); seedAttention(db); const { mail, calls } = fakeMail(); const service = new AttentionService(db.prisma, mail, config);
  await service.send('messages', 1, 3, 7);
  db.attention[0].respuesta = 'Otro texto distinto'; // edición guardada por otra vía
  const next: any = await service.send('messages', 1, db.attention[0].revision, 7);
  assert.equal(next.envio, 'aceptado'); assert.equal(calls.length, 2);
});

test('si el resultado no puede registrarse tras aceptar, se informa y el intento sigue bloqueando', async () => {
  const db = fakeDb({ failFinish: true }); seedAttention(db); const { mail, calls } = fakeMail(); const service = new AttentionService(db.prisma, mail, config);
  const result: any = await service.send('messages', 1, 3, 7);
  assert.equal(result.envio, 'aceptado'); assert.equal(result.registrado, false); assert.match(result.mensaje, /no pudo registrarse/);
  assert.equal(db.attention[0].historial.at(-1).correo.estado, 'iniciado');
  assert.equal((await rejectsWith(service.send('messages', 1, db.attention[0].revision, 7))).body.motivo, 'en_curso'); assert.equal(calls.length, 1);
});

test('una excepción inesperada del proveedor se trata como incierta', async () => {
  const db = fakeDb(); seedAttention(db); const { mail } = fakeMail(() => { throw new Error('boom ' + VISITOR); }); const service = new AttentionService(db.prisma, mail, config);
  const r: any = await rejectsWith(service.send('messages', 1, 3, 7));
  assert.equal(r.body.envio, 'incierto'); assert.ok(!JSON.stringify(r.body).includes('boom'));
});

test('reenviar constancia de contacto manda SOLO la confirmación a la persona (opción A)', async () => {
  const db = fakeDb(); const { mail, calls } = fakeMail(); const service = new AttentionService(db.prisma, mail, config);
  const result: any = await service.receipt('messages', 1, 7);
  assert.equal(result.envio, 'aceptado'); assert.deepEqual(calls, ['confirmacion:' + VISITOR]);
  assert.ok(!calls.includes('AVISO_INTERNO'), 'el aviso interno no se repite');
  assert.equal(db.attention[0].historial[0].correo.tipo, 'constancia');
  assert.equal((await rejectsWith(service.receipt('messages', 1, 7))).body.motivo, 'ya_aceptado'); assert.equal(calls.length, 1);
  assert.equal((await service.receipt('messages', 1, 7, true) as any).envio, 'aceptado'); assert.equal(calls.length, 2);
});

test('constancia de reclamación: un único correo, con el mismo control de duplicados', async () => {
  const db = fakeDb(); const { mail, calls } = fakeMail(() => ({ status: 'uncertain', reason: 'x' })); const service = new AttentionService(db.prisma, mail, config);
  assert.equal((await rejectsWith(service.receipt('reclamaciones', 1, 7))).body.envio, 'incierto');
  assert.equal((await rejectsWith(service.receipt('reclamaciones', 1, 7))).body.motivo, 'incierto'); assert.deepEqual(calls, ['constancia:' + VISITOR]);
});

test('la respuesta sin guardar o recurso inválido no llega al proveedor', async () => {
  const db = fakeDb(); seedAttention(db, { respuesta: '   ' }); const { mail, calls } = fakeMail(); const service = new AttentionService(db.prisma, mail, config);
  assert.equal((await rejectsWith(service.send('messages', 1, 3, 7))).code, 400);
  assert.equal((await rejectsWith(service.send('otro', 1, 3, 7))).code, 400); assert.equal(calls.length, 0);
});

function quote() {
  return { id: 5, numero: 'COT-1', cliente: 'ACME', email: 'cliente@example.test', estado: 'borrador', revision: 4, validez: new Date('2099-01-01T12:00:00Z'), emisor: 'Horus', datos_emisor: '', moneda: 'PEN',
    conceptos: [{ descripcion: 'Servicio', cantidad: 1, precio: 100, importe: 100 }], subtotal: 100, descuento: 0, impuesto: 18, tasa: 18, total: 118, condiciones: '', historial: [] as any[] };
}
test('cotización: aceptada, registrada, estado intacto y reenvío con confirmación', async () => {
  const db = fakeDb(); db.quotes.push(quote()); const { mail, calls } = fakeMail(); const service = new CotizacionesService(db.prisma, mail, config);
  const result: any = await service.email(5, 4, 7);
  assert.equal(result.envio, 'aceptado'); assert.equal(db.quotes[0].estado, 'borrador', 'no cambia borrador→enviada'); assert.equal(db.quotes[0].total, 118);
  assert.deepEqual(db.quotes[0].historial.map((e: any) => e.correo.estado), ['iniciado', 'aceptado']); assert.equal(db.quotes[0].revision, 6);
  assert.equal((await rejectsWith(service.email(5, 6, 7))).body.motivo, 'ya_aceptado'); assert.equal(calls.length, 1);
  assert.equal(((await service.email(5, 6, 7, true)) as any).envio, 'aceptado'); assert.equal(calls.length, 2);
});
test('cotización: incierta y fallida, concurrencia y sin correo configurado', async () => {
  const db = fakeDb(); db.quotes.push(quote()); let kind: MailOutcome = { status: 'uncertain', reason: 'x' };
  const { mail, calls } = fakeMail(async () => { await tick(); return kind; }); const service = new CotizacionesService(db.prisma, mail, config);
  const unsure = await rejectsWith(service.email(5, 4, 7)); assert.equal(unsure.code, 502); assert.equal(unsure.body.envio, 'incierto');
  assert.equal((await rejectsWith(service.email(5, unsure.body.revision, 7))).body.motivo, 'incierto');
  kind = { status: 'failed', reason: 'x' };
  assert.equal((await rejectsWith(service.email(5, unsure.body.revision, 7, true))).body.envio, 'fallido');
  assert.equal(((await rejectsWith(service.email(5, db.quotes[0].revision, 7))).body.envio), 'fallido', 'tras un fallo confirmado se puede reintentar');
  const racing = fakeDb(); racing.quotes.push(quote()); const race = fakeMail(async () => { await tick(); return { status: 'accepted' }; });
  const racer = new CotizacionesService(racing.prisma, race.mail, config);
  const settled = await Promise.allSettled([racer.email(5, 4, 1), racer.email(5, 4, 2)]);
  assert.equal(settled.filter(r => r.status === 'fulfilled').length, 1); assert.equal(race.calls.length, 1);
  const nomail = new CotizacionesService(racing.prisma, undefined, config);
  assert.equal((await rejectsWith(nomail.email(5, racing.quotes[0].revision, 1))).code, 503);
  assert.equal(calls.length >= 3, true);
});

test('limitador de recuperación por cuenta: tope, ventana, memoria acotada y claves no legibles', () => {
  let now = 1_000_000; const throttle = new RecoveryThrottle(3, 60_000, 5, () => now);
  assert.deepEqual([1, 2, 3, 4].map(() => throttle.allow('Admin@Example.test')), [true, true, true, false], 'mayúsculas no eluden el límite');
  assert.equal(throttle.allow('otra@example.test'), true, 'otra cuenta no se ve afectada');
  now += 61_000; assert.equal(throttle.allow('admin@example.test'), true, 'la ventana vence');
  for (let i = 0; i < 50; i++) throttle.allow('x' + i + '@example.test');
  assert.ok(throttle.size <= 5, 'memoria acotada');
  assert.ok(!JSON.stringify([...(throttle as any).hits.keys()]).includes('example.test'), 'no se guardan correos en claro');
});

test('recuperación: límite por cuenta omite el envío sin cambiar la respuesta ni distinguir cuentas inexistentes', async () => {
  const { JwtService } = await import('@nestjs/jwt'); const { AccountsService } = await import('../src/admin/auth/accounts.service');
  const secret = 'x'.repeat(40), user = { id: 1, email: 'admin@example.test', activo: true, password: 'hash' };
  const prisma: any = { adminUser: { findUnique: async ({ where }: any) => where.email === user.email ? user : null } };
  let sent = 0; const mail: any = { sendMail: async () => { sent++; return true; } };
  const accounts = new AccountsService(prisma, new JwtService({}), { get: () => undefined, getOrThrow: () => secret } as unknown as ConfigService, mail);
  const answers: unknown[] = [];
  for (let i = 0; i < 6; i++) answers.push(await accounts.forgot('admin@example.test'));
  const ghost = await accounts.forgot('nadie@example.test');
  await accounts.onModuleDestroy();
  assert.equal(sent, 3, 'solo 3 correos por cuenta en la ventana');
  assert.ok(answers.every(answer => JSON.stringify(answer) === JSON.stringify(ghost)), 'la respuesta es idéntica con límite, sin límite y con cuenta inexistente');
});

test('limitador de recuperación: las solicitudes bloqueadas no prolongan la ventana', () => {
  let now = 0; const throttle = new RecoveryThrottle(3, 15 * 60_000, 100, () => now);
  const ask = () => throttle.allow('admin@example.test');
  assert.deepEqual([ask(), ask(), ask()], [true, true, true], '1. tres solicitudes permitidas');
  now += 60_000; assert.equal(ask(), false, '2. la cuarta se bloquea');
  // 3. un tercero sigue insistiendo cada minuto: antes cada intento bloqueado renovaba la ventana y la cuenta nunca se liberaba
  for (let minute = 2; minute < 15; minute++) { now = minute * 60_000; assert.equal(ask(), false, 'bloqueada en el minuto ' + minute); }
  now = 15 * 60_000 + 1; // 4. vence la ventana de las tres permitidas (todas a t=0)
  assert.equal(ask(), true, '5. se permite una nueva solicitud aunque antes continuaran las bloqueadas');
  assert.equal(ask(), true); assert.equal(ask(), true); assert.equal(ask(), false, 'el límite sigue siendo 3 por ventana');
});
