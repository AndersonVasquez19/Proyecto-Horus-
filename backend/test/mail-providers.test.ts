import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MailService, parseMailbox } from '../src/mail/mail.service';
import { AccountsService } from '../src/admin/auth/accounts.service';
import { validateDeployment } from '../src/deployment.config';

// Ningún test se conecta a servicios externos: `fetch` y el transporte SMTP se sustituyen por dobles.
const KEY = 're_clave_de_prueba_no_real';
const RESEND = { MAIL_PROVIDER: 'resend', RESEND_API_KEY: KEY, RESEND_FROM: 'Horus Group <noreply@horus.example>' };
const GMAIL = { MAIL_PROVIDER: 'gmail', MAIL_USER: 'cuenta@example.test', MAIL_PASS: 'clave-app-no-real' };

type Call = { url: string; init: any };
function harness(env: Record<string, string>, respond: (call: Call) => Promise<Response> | Response = () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })) {
  const calls: Call[] = [], logs: string[] = [], smtp: any[] = [];
  const service = new MailService(cfg(env));
  const logger = (service as any).logger;
  for (const level of ['log', 'error']) logger[level] = (message: string) => { logs.push(String(message)); };
  (service as any).gmail = { sendMail: async (options: any) => { smtp.push(options); return {}; } };
  globalThis.fetch = (async (url: any, init: any) => { const call = { url: String(url), init }; calls.push(call); return respond(call); }) as typeof fetch;
  return { service, calls, logs, smtp, restore: () => { globalThis.fetch = blocked; } };
}
// Configuración aislada: un ConfigService real también lee process.env y mezclaría valores del entorno local con los de la prueba.
const cfg = (values: Record<string, string>) => ({ get: (key: string) => values[key], getOrThrow: (key: string) => { if (values[key] === undefined) throw new Error(key); return values[key]; } }) as unknown as ConfigService;
// Red bloqueada por defecto: cualquier envío que no pase por un doble de la prueba la rompe en vez de salir a internet.
const blocked = (async () => { throw new Error('petición externa bloqueada en pruebas'); }) as typeof fetch;
globalThis.fetch = blocked;
const body = (call: Call) => JSON.parse(call.init.body);

test('tests run with an isolated environment and no external network', async () => {
  // assert.ok con mensaje fijo: un fallo nunca imprime valores del entorno.
  for (const key of ['RESEND_API_KEY', 'RESEND_FROM', 'MAIL_PROVIDER', 'MAIL_USER', 'MAIL_PASS', 'MAIL_NOTIFY_TO', 'JWT_SECRET', 'DB_PASS']) {
    assert.ok(!(key in process.env), 'El entorno de pruebas heredó ' + key + ' (revisa test/isolate-env.cjs)');
  }
  await assert.rejects(() => fetch('https://api.resend.com/emails'), /bloqueada/);
});

test('provider selection is explicit, defaults to gmail and never falls back', async () => {
  for (const [env, expected] of [[{}, 'gmail'], [{ MAIL_PROVIDER: 'resend' }, 'resend'], [{ MAIL_PROVIDER: ' Resend ' }, 'resend'], [{ MAIL_PROVIDER: 'gmail' }, 'gmail'], [{ MAIL_PROVIDER: 'sendgrid' }, undefined]] as const) {
    assert.equal(new MailService(cfg({ ...env })).provider(), expected);
  }
  const bad = harness({ ...GMAIL, ...RESEND, MAIL_PROVIDER: 'otro' });
  try {
    assert.equal(await bad.service.sendMail({ to: 'a@example.test', subject: 's', text: 't' }), false);
    assert.equal(bad.calls.length + bad.smtp.length, 0, 'un proveedor inválido no envía por ninguno');
  } finally { bad.restore(); }
  const failing = harness({ ...GMAIL, ...RESEND }, () => new Response('{}', { status: 500 }));
  try {
    assert.equal(await failing.service.sendMail({ to: 'a@example.test', subject: 's', text: 't' }), false);
    assert.equal(failing.smtp.length, 0, 'si Resend falla no se usa Gmail aunque sus credenciales existan');
  } finally { failing.restore(); }
});

test('required variables are checked per provider without leaking values', async () => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ MAIL_PROVIDER: 'resend', RESEND_FROM: RESEND.RESEND_FROM }, /RESEND_API_KEY/],
    [{ MAIL_PROVIDER: 'resend', RESEND_API_KEY: KEY }, /RESEND_FROM/],
    [{ MAIL_PROVIDER: 'resend', RESEND_API_KEY: KEY, RESEND_FROM: 'no es un correo' }, /RESEND_FROM/],
    [{ MAIL_PROVIDER: 'gmail', MAIL_USER: 'cuenta@example.test' }, /MAIL_PASS/],
  ];
  for (const [env, expected] of cases) {
    const h = harness(env);
    try {
      const outcome = await h.service.deliver({ to: 'a@example.test', subject: 's', text: 't' });
      assert.equal(outcome.status, 'failed'); assert.match(outcome.reason!, expected);
      assert.equal(h.calls.length + h.smtp.length, 0);
      assert.ok(!JSON.stringify(outcome).includes(KEY));
    } finally { h.restore(); }
  }
  // Con Resend no se exigen las credenciales de Gmail.
  const h = harness(RESEND);
  try { assert.equal(await h.service.sendMail({ to: 'a@example.test', subject: 's', text: 't' }), true); } finally { h.restore(); }
});

test('resend carries html, text, reply-to, cc, bcc, attachments and the visible sender name', async () => {
  const h = harness(RESEND);
  try {
    const ok = await h.service.sendMail({
      from: '"Horus Group - Reclamaciones" <otro@dominio-ajeno.test>', to: ['a@example.test', 'Persona <b@example.test>'], cc: 'c@example.test', bcc: ['d@example.test'], replyTo: 'r@example.test',
      subject: 'Asunto', html: '<p>Hola</p>', text: 'Hola', attachments: [{ filename: 'constancia.txt', content: 'contenido' }],
    });
    assert.equal(ok, true); assert.equal(h.calls.length, 1);
    const call = h.calls[0];
    assert.equal(call.url, 'https://api.resend.com/emails'); assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, 'Bearer ' + KEY);
    assert.deepEqual(body(call), {
      from: '"Horus Group - Reclamaciones" <noreply@horus.example>', to: ['a@example.test', 'b@example.test'], cc: ['c@example.test'], bcc: ['d@example.test'], reply_to: ['r@example.test'],
      subject: 'Asunto', html: '<p>Hola</p>', text: 'Hola', attachments: [{ filename: 'constancia.txt', content: Buffer.from('contenido').toString('base64') }],
    });
    assert.ok(call.init.signal instanceof AbortSignal, 'la petición puede cancelarse por tiempo');
    const logged = h.logs.join(' | ');
    assert.ok(!/Bearer|Authorization/i.test(logged) && !logged.includes(KEY), 'ni siquiera un envío correcto registra la clave ni cabeceras');
  } finally { h.restore(); }
  const unsupported = harness(RESEND);
  try {
    const outcome = await unsupported.service.deliver({ to: 'a@example.test', subject: 's', text: 't', attachments: [{ filename: 'a.pdf', path: '/tmp/a.pdf' }] });
    assert.equal(outcome.status, 'failed'); assert.equal(unsupported.calls.length, 0, 'un adjunto no equivalente se rechaza en vez de enviarse incompleto');
  } finally { unsupported.restore(); }
});

test('gmail keeps passing the options through unchanged', async () => {
  const h = harness(GMAIL);
  try {
    const options = { from: GMAIL.MAIL_USER, to: 'a@example.test', subject: 's', text: 't', html: '<b>x</b>', bcc: 'z@example.test' };
    assert.equal(await h.service.sendMail(options), true);
    assert.deepEqual(h.smtp, [options]); assert.equal(h.calls.length, 0);
  } finally { h.restore(); }
});

test('module templates keep recipients and formats with either provider', async () => {
  const resend = harness({ ...RESEND, MAIL_NOTIFY_TO: 'equipo@horus.example' });
  try {
    assert.equal(await resend.service.sendContactoNotificacion({ nombre: 'Ana', email: 'ana@example.test', asunto: 'Hola', mensaje: 'Texto' }), true);
    assert.equal(resend.calls.length, 2);
    assert.deepEqual(body(resend.calls[0]).to, ['equipo@horus.example']); assert.match(body(resend.calls[0]).from, /^"Web Horus Group" </);
    assert.deepEqual(body(resend.calls[1]).to, ['ana@example.test']); assert.equal(body(resend.calls[1]).subject, 'Recibimos tu mensaje - Horus Group SRL');
    assert.equal(await resend.service.sendReclamoConstancia({ email: 'r@example.test', nombres: 'R', apellidos: 'P', tipo_registro: 'reclamo', numero_reclamo: 'HG-1', area: 'A', detalle_reclamo: 'D' }), true);
    const constancia = body(resend.calls[2]);
    assert.deepEqual(constancia.to, ['r@example.test']); assert.deepEqual(constancia.bcc, ['equipo@horus.example']);
    assert.equal(constancia.subject, 'Constancia de Registro de RECLAMO - HG-1'); assert.match(constancia.html, /HG-1/);
  } finally { resend.restore(); }
  // Sin MAIL_NOTIFY_TO se conserva el comportamiento histórico: el aviso interno va al remitente.
  const legacy = harness(RESEND);
  try { await legacy.service.sendContactoNotificacion({ nombre: 'Ana', email: 'ana@example.test', asunto: 'Hola', mensaje: 'Texto' }); assert.deepEqual(body(legacy.calls[0]).to, ['noreply@horus.example']); } finally { legacy.restore(); }
  const gmail = harness(GMAIL);
  try {
    await gmail.service.sendContactoNotificacion({ nombre: 'Ana', email: 'ana@example.test', asunto: 'Hola', mensaje: 'Texto' });
    await gmail.service.sendReclamoConstancia({ email: 'r@example.test', nombres: 'R', apellidos: 'P', tipo_registro: 'queja', numero_reclamo: 'HG-2', area: 'A', detalle_reclamo: 'D' });
    assert.equal(gmail.smtp[0].to, GMAIL.MAIL_USER); assert.equal(gmail.smtp[0].from, '"Web Horus Group" <' + GMAIL.MAIL_USER + '>');
    assert.equal(gmail.smtp[2].bcc, GMAIL.MAIL_USER); assert.equal(gmail.smtp[2].from, '"Horus Group - Reclamaciones" <' + GMAIL.MAIL_USER + '>');
  } finally { gmail.restore(); }
});

test('resend errors are classified, never retried and never leak secrets or provider text', async () => {
  const leak = 'DETALLE INTERNO DE RESEND con ' + KEY;
  const table: [number, string, 'failed' | 'uncertain', RegExp][] = [
    [401, 'API key is invalid', 'failed', /RESEND_API_KEY inválida/], [403, 'The domain is not verified', 'failed', /dominio .* no verificado/],
    [403, 'You can only send testing emails to your own email address', 'failed', /modo de prueba/], [422, 'Invalid `from` field', 'failed', /remitente/],
    [429, 'Too many requests', 'failed', /límite/], [500, leak, 'uncertain', /500/], [503, leak, 'uncertain', /503/], [408, leak, 'uncertain', /408/], [504, leak, 'uncertain', /504/], [502, leak, 'uncertain', /502/],
  ];
  for (const [status, message, kind, reason] of table) {
    const h = harness(RESEND, () => new Response(JSON.stringify({ name: 'x', message: message + ' ' + leak }), { status }));
    try {
      assert.equal(await h.service.sendMail({ to: 'persona@example.test', subject: 's', text: 't' }), false, 'HTTP ' + status);
      assert.equal(h.calls.length, 1, 'sin reintentos automáticos (HTTP ' + status + ')');
      const all = h.logs.join('\n');
      assert.ok(!all.includes(KEY) && !all.includes('INTERNO') && !all.includes('persona@example.test') && !/Bearer|Authorization/i.test(all), 'los registros no contienen secretos, texto del proveedor ni correos');
      assert.match(all, reason);
      if (kind === 'uncertain') assert.match(all, /No se pudo confirmar/);
    } finally { h.restore(); }
  }
});

test('timeouts, network failures and unreadable answers are uncertain and not retried', async () => {
  const scenarios: [string, (call: Call) => Promise<Response> | Response, RegExp][] = [
    ['timeout', call => new Promise<Response>((_resolve, reject) => call.init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), /tiempo de espera/],
    ['red caída', () => Promise.reject(new TypeError('fetch failed')), /red caída/],
    ['200 sin id', () => new Response('<html>proxy</html>', { status: 200 }), /ilegible/],
  ];
  for (const [name, respond, reason] of scenarios) {
    const h = harness(RESEND, respond);
    const realSet = globalThis.setTimeout;
    // Acelera solo el temporizador de 10 s del envío para no esperar de verdad.
    globalThis.setTimeout = ((fn: any, ms?: number, ...args: any[]) => realSet(fn, ms === 10_000 ? 5 : ms, ...args)) as typeof setTimeout;
    try {
      const outcome = await h.service.deliver({ to: 'a@example.test', subject: 's', text: 't' });
      assert.equal(outcome.status, 'uncertain', name); assert.match(outcome.reason!, reason);
      assert.equal(h.calls.length, 1, name + ': un solo intento');
      assert.equal(await h.service.sendMail({ to: 'a@example.test', subject: 's', text: 't' }), false);
      assert.equal(h.calls.length, 2, 'cada sendMail hace exactamente un intento');
    } finally { globalThis.setTimeout = realSet; h.restore(); }
  }
});

test('password recovery keeps its generic answer when the email cannot be sent', async () => {
  const secret = 'x'.repeat(40), user = { id: 1, email: 'admin@example.test', activo: true, password: 'hash' };
  const prisma: any = { adminUser: { findUnique: async () => user } };
  for (const respond of [() => new Response(JSON.stringify({ message: 'secreto interno' }), { status: 403 }), () => Promise.reject(new TypeError('fetch failed')), () => new Response(JSON.stringify({ id: 'msg_9' }), { status: 200 })]) {
    const h = harness({ ...RESEND, JWT_SECRET: secret }, respond);
    try {
      const accounts = new AccountsService(prisma, new JwtService({}), cfg({ JWT_SECRET: secret, MAIL_PROVIDER: 'resend' }), h.service);
      const answer = await accounts.forgot('admin@example.test');
      assert.deepEqual(answer, { ok: true, mensaje: 'Si el correo corresponde a una cuenta activa, recibirá un enlace de recuperación.' });
      assert.equal(h.calls.length, 1, 'un solo intento de envío');
      const message = body(h.calls[0]);
      assert.deepEqual(message.to, ['admin@example.test']); assert.equal(message.subject, 'Restablecer contraseña de Horus'); assert.equal(message.from, '"Horus Group" <noreply@horus.example>');
      assert.match(message.text, /vence en 30 minutos y solo puede utilizarse una vez/); assert.match(message.text, /\/admin\/reset-password\?token=/);
      assert.ok(!h.logs.join('\n').includes('secreto interno'));
    } finally { h.restore(); }
  }
});

test('the startup check rejects an unknown MAIL_PROVIDER', () => {
  const env = { JWT_SECRET: 'x'.repeat(32) };
  for (const MAIL_PROVIDER of ['resend', 'gmail', 'RESEND']) assert.doesNotThrow(() => validateDeployment({ ...env, MAIL_PROVIDER }));
  assert.throws(() => validateDeployment({ ...env, MAIL_PROVIDER: 'sendgrid' }), /MAIL_PROVIDER/);
});

test('mailbox parsing accepts plain, named and object forms', () => {
  assert.deepEqual(parseMailbox('a@b.co'), { name: undefined, address: 'a@b.co' });
  assert.deepEqual(parseMailbox('"Horus Group" <a@b.co>'), { name: 'Horus Group', address: 'a@b.co' });
  assert.deepEqual(parseMailbox({ name: 'X', address: 'a@b.co' }), { name: 'X', address: 'a@b.co' });
  for (const invalid of [undefined, '', 'sin arroba', '"Nombre" <roto>']) assert.equal(parseMailbox(invalid), undefined);
});
