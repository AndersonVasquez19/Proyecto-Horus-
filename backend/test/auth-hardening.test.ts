import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { BadRequestException, ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { AuthService } from '../src/admin/auth/auth.service';
import { AccountsService } from '../src/admin/auth/accounts.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { BCRYPT_COST, DUMMY_PASSWORD_HASH } from '../src/admin/auth/password-security';
import { PublicRateLimitGuard } from '../src/common/public-rate-limit.guard';
import { memoryBuckets } from './fixtures/rate-limit-memory';

// Todo es ficticio: persistencia en memoria, correo falso y secretos de prueba. Se ejecuta con test/isolate-env.cjs (npm test).
const SECRET = 'secreto-ficticio-de-pruebas-0123456789abcdef';
const cfg = (values: Record<string, string>) => ({ get: (key: string) => values[key], getOrThrow: (key: string) => { if (values[key] === undefined) throw new Error(key); return values[key]; } }) as unknown as ConfigService;
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '8h', issuer: 'horus-api', audience: 'horus-panel' } });
const PASSWORD = 'Contraseña-ficticia-1';
const realHash = bcrypt.hashSync(PASSWORD, BCRYPT_COST);

type Row = { id: number; nombre: string; email: string; password: string; activo: boolean; session_version: number };
function database(rows: Row[]) {
  return { rows, client: { adminUser: {
    findFirst: async ({ where }: any) => { const row = rows.find(item => item.email === where.email); return row ? { ...row } : null; }, // copia: como una fila leída de la base real
    findUnique: async ({ where }: any) => { const row = rows.find(item => (where.id !== undefined ? item.id === where.id : item.email === where.email)); return row ? { ...row } : null; },
    updateMany: async ({ where, data }: any) => {
      const row = rows.find(item => item.id === where.id && item.password === where.password && item.activo === where.activo);
      if (!row) return { count: 0 };
      row.password = data.password; row.session_version += data.session_version.increment; return { count: 1 };
    },
  } } as any };
}
const account = (patch: Partial<Row> = {}): Row => ({ id: 1, nombre: 'Persona Ficticia', email: 'persona@example.test', password: realHash, activo: true, session_version: 1, ...patch });

// Cuenta las llamadas a bcrypt sin cambiar su comportamiento.
function spyBcrypt() {
  const target = bcrypt as any, original = { compare: target.compare, genSalt: target.genSalt, genSaltSync: target.genSaltSync }; const calls = { compare: [] as string[], salts: 0 }; // generar un hash nuevo siempre pasa por genSalt
  target.compare = (password: string, hash: string, ...rest: any[]) => { calls.compare.push(hash); return original.compare(password, hash, ...rest); };
  target.genSalt = (...args: any[]) => { calls.salts++; return original.genSalt(...args); };
  target.genSaltSync = (...args: any[]) => { calls.salts++; return original.genSaltSync(...args); };
  return { calls, restore: () => Object.assign(target, original) };
}

test('the dummy hash is a real bcrypt hash with the same cost as real passwords', async () => {
  assert.equal(BCRYPT_COST, 12);
  assert.equal(bcrypt.getRounds(DUMMY_PASSWORD_HASH), BCRYPT_COST);
  assert.equal(bcrypt.getRounds(realHash), BCRYPT_COST);
  assert.equal(await bcrypt.compare('cualquier-texto', DUMMY_PASSWORD_HASH), false);
});

test('login always runs bcrypt and answers the same way for unknown, inactive and wrong-password accounts', async () => {
  const db = database([account(), account({ id: 2, email: 'inactiva@example.test', activo: false })]);
  const service = new AuthService(db.client, jwt);
  const spy = spyBcrypt();
  try {
    const failures: unknown[] = [];
    for (const [email, password, expectedHash] of [
      ['nadie@example.test', PASSWORD, DUMMY_PASSWORD_HASH], // no existe: hash ficticio
      ['inactiva@example.test', PASSWORD, realHash], // inactiva con la contraseña correcta: se compara la real y se rechaza igual
      ['persona@example.test', 'Contraseña-equivocada-1', realHash],
    ] as const) {
      const started = Date.now();
      const error = await service.login({ email, password }).then(() => null, (caught: unknown) => caught);
      const elapsed = Date.now() - started;
      assert.ok(error instanceof UnauthorizedException, email + ' debe rechazarse');
      failures.push((error as UnauthorizedException).getResponse());
      assert.equal(spy.calls.compare.at(-1), expectedHash, 'hash comparado para ' + email.split('@')[0]);
      assert.ok(elapsed >= 40, 'bcrypt realmente se ejecutó para ' + email.split('@')[0] + ' (' + elapsed + ' ms)'); // coste 12: lejos de una respuesta inmediata
    }
    assert.deepEqual(failures[0], { ok: false, mensaje: 'Credenciales incorrectas.' });
    assert.deepEqual(failures[1], failures[0]); assert.deepEqual(failures[2], failures[0]);
    assert.equal(spy.calls.compare.length, 3); assert.equal(spy.calls.salts, 0, 'no se generan hashes por petición');
    const ok = await service.login({ email: 'persona@example.test', password: PASSWORD });
    assert.equal(ok.ok, true); assert.ok(ok.token); assert.deepEqual(ok.user, { id: 1, nombre: 'Persona Ficticia', email: 'persona@example.test', rol: null, permisos: [] }); // cuenta sin rol (E3.4.1)
    assert.equal(spy.calls.salts, 0);
  } finally { spy.restore(); }
});

test('jwt: signature, issuer, audience, expiry and session revocation are still enforced', async () => {
  const db = database([account(), account({ id: 2, email: 'inactiva@example.test', activo: false })]);
  const strategy = new JwtStrategy(cfg({ JWT_SECRET: SECRET }), db.client);
  const options = (strategy as any)._verifOpts;
  assert.equal(options.issuer, 'horus-api'); assert.equal(options.audience, 'horus-panel'); assert.equal(options.ignoreExpiration, false);
  assert.deepEqual(await strategy.validate({ id: 1, email: 'persona@example.test', version: 1 }), { id: 1, nombre: 'Persona Ficticia', email: 'persona@example.test', rol: null });
  for (const payload of [{ id: 1, email: 'x', version: 2 }, { id: 2, email: 'x', version: 1 }, { id: 99, email: 'x', version: 1 }, { id: -1, email: 'x' }, { id: 'a' as unknown as number, email: 'x' }]) {
    await assert.rejects(() => strategy.validate(payload), UnauthorizedException);
  }
  const issued = jwt.sign({ id: 1, email: 'persona@example.test', version: 1 });
  assert.ok(jwt.verify(issued, { issuer: 'horus-api', audience: 'horus-panel' }));
  assert.throws(() => jwt.verify(issued, { audience: 'otra-audiencia' }));
  assert.throws(() => jwt.verify(issued, { secret: 'otro-secreto-ficticio-0123456789abcdefghij' }));
  const expiredToken = jwt.sign({ id: 1 }, { expiresIn: '-10s' });
  assert.throws(() => jwt.verify(expiredToken, { issuer: 'horus-api', audience: 'horus-panel' }), /expired/);
});

// ---- Recuperación ----
function recovery(rows: Row[], sendMail: (message: any) => Promise<boolean>, env: Record<string, string> = {}) {
  const db = database(rows), sent: any[] = [];
  const mail = { sendMail: (message: any) => { sent.push(message); return sendMail(message); } } as any;
  const service = new AccountsService(db.client, jwt, cfg({ JWT_SECRET: SECRET, MAIL_USER: 'remitente@example.test', ...env }), mail);
  const logged: string[] = []; const logger = (service as any).logger;
  logger.error = (message: string) => { logged.push(String(message)); }; logger.warn = logger.error;
  return { service, db, sent, logged };
}
const GENERIC = { ok: true, mensaje: 'Si el correo corresponde a una cuenta activa, recibirá un enlace de recuperación.' };
async function withOrigin<T>(run: () => Promise<T>) {
  const before = process.env.CORS_ORIGINS; process.env.CORS_ORIGINS = 'https://panel.example.test';
  try { return await run(); } finally { if (before === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = before; }
}
const deferred = () => { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(r => { resolve = r; }); return { promise, resolve }; };

test('recovery answers without waiting for the mail provider and only sends to active accounts', () => withOrigin(async () => {
  const slow = deferred();
  const r = recovery([account(), account({ id: 2, email: 'inactiva@example.test', activo: false })], () => slow.promise);
  // Cuenta activa: la respuesta llega aunque el proveedor siga pendiente, y se pidió exactamente un envío.
  const answer = await Promise.race([r.service.forgot('persona@example.test'), new Promise(resolve => setTimeout(() => resolve('esperó al proveedor'), 500))]);
  assert.deepEqual(answer, GENERIC); assert.equal(r.sent.length, 1);
  assert.equal((r.service as any).pending.size, 1, 'el envío queda seguido mientras está en curso');
  assert.deepEqual(r.sent[0].to, 'persona@example.test'); assert.match(r.sent[0].text, /\/admin\/reset-password\?token=/); assert.match(r.sent[0].text, /30 minutos/);
  slow.resolve(true); await new Promise(resolve => setImmediate(resolve));
  assert.equal((r.service as any).pending.size, 0, 'el envío terminado deja de seguirse');
  // Inexistente e inactiva: misma respuesta y ningún correo.
  assert.deepEqual(await r.service.forgot('nadie@example.test'), GENERIC);
  assert.deepEqual(await r.service.forgot('inactiva@example.test'), GENERIC);
  assert.equal(r.sent.length, 1, 'no se envía correo a cuentas inexistentes ni inactivas');
}));

test('a failing mail provider never changes the answer, leaks details or leaves an unhandled rejection', () => withOrigin(async () => {
  const rejections: unknown[] = []; const listener = (reason: unknown) => { rejections.push(reason); }; process.on('unhandledRejection', listener);
  try {
    for (const failing of [() => Promise.resolve(false), () => Promise.reject(new Error('RESEND_CLAVE_SECRETA persona@example.test'))]) {
      const r = recovery([account()], failing);
      assert.deepEqual(await r.service.forgot('persona@example.test'), GENERIC);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal((r.service as any).pending.size, 0);
      const everything = r.logged.join(' | ');
      assert.ok(!/SECRETA|persona@example|token=/.test(everything), 'los registros no incluyen correo, token ni el error del proveedor');
    }
    assert.deepEqual(rejections, []);
  } finally { process.off('unhandledRejection', listener); }
}));

test('background mail is bounded, drained on shutdown and awaited on serverless hosts', () => withOrigin(async () => {
  const pendingSends: Array<() => void> = [];
  // Cuentas distintas: el límite por cuenta (3 / 15 min) no debe ocultar el tope global de envíos simultáneos que se prueba aquí.
  const rows = Array.from({ length: AccountsService.MAX_PENDING_MAIL + 5 }, (_unused, i) => account({ id: i + 1, email: 'persona' + i + '@example.test' }));
  const r = recovery(rows, () => new Promise<boolean>(resolve => { pendingSends.push(() => resolve(true)); }));
  for (const row of rows) assert.deepEqual(await r.service.forgot(row.email), GENERIC);
  assert.equal(r.sent.length, AccountsService.MAX_PENDING_MAIL, 'nunca hay más envíos simultáneos que el máximo');
  assert.ok(r.logged.some(line => /Demasiados envíos/.test(line)));
  let drained = false; const closing = r.service.onModuleDestroy().then(() => { drained = true; });
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(drained, false, 'al apagar se espera a los envíos en curso');
  pendingSends.forEach(finish => finish()); await closing; assert.equal(drained, true);

  const slow = deferred(); const serverless = recovery([account()], () => slow.promise, { VERCEL: '1' });
  let answered = false; const pending = serverless.service.forgot('persona@example.test').then(value => { answered = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(answered, false, 'en serverless se espera el envío (no hay ejecución tras responder)');
  slow.resolve(true); assert.deepEqual(await pending, GENERIC);
}));

test('reset links are single-use, expire, and concurrent attempts cannot both succeed', () => withOrigin(async () => {
  const r = recovery([account()], async () => true);
  await r.service.forgot('persona@example.test');
  const token = new URL(String(r.sent[0].text).match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
  // Dos restablecimientos simultáneos con el mismo enlace: exactamente uno se aplica.
  const results = await Promise.allSettled([r.service.reset({ token, password: 'Nueva-contraseña-1' }), r.service.reset({ token, password: 'Otra-contraseña-22' })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find(item => item.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ConflictException);
  assert.equal(r.db.rows[0].session_version, 2, 'las sesiones anteriores quedan invalidadas');
  // Reutilizar el enlace después: ya no es válido (el secreto depende de la contraseña anterior).
  await assert.rejects(() => r.service.reset({ token, password: 'Tercera-contraseña-3' }), BadRequestException);
  // Enlace vencido y enlace manipulado.
  const secret = require('node:crypto').createHmac('sha256', SECRET).update('reset:' + r.db.rows[0].password).digest('hex');
  const stale = jwt.sign({ id: 1 }, { secret, expiresIn: '-1s', audience: 'horus-password-reset' });
  await assert.rejects(() => r.service.reset({ token: stale, password: 'Cuarta-contraseña-4' }), BadRequestException);
  await assert.rejects(() => r.service.reset({ token: token + 'x', password: 'Quinta-contraseña-5' }), BadRequestException);
}));

test('changing the password still needs the current password and revokes sessions', async () => {
  const r = recovery([account()], async () => true);
  await assert.rejects(() => r.service.password(1, { current_password: 'incorrecta-123', password: 'Nueva-contraseña-1' }), BadRequestException);
  assert.equal(r.db.rows[0].session_version, 1);
  const result = await r.service.password(1, { current_password: PASSWORD, password: 'Nueva-contraseña-1' });
  assert.equal(result.ok, true); assert.equal(r.db.rows[0].session_version, 2);
  assert.equal(bcrypt.getRounds(r.db.rows[0].password), BCRYPT_COST);
  assert.ok(await bcrypt.compare('Nueva-contraseña-1', r.db.rows[0].password));
});

// ---- Límites de solicitudes ----
function limiter() {
  const { buckets, prisma } = memoryBuckets();
  const guard = new PublicRateLimitGuard(prisma);
  const call = (path: string, ip = '203.0.113.1', method = 'POST') => guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method, path, ip, socket: { remoteAddress: ip } }) }) } as any);
  return { call, buckets };
}
test('rate limits cover login, recovery, reset and password change per IP, and cannot be dodged by path variants', async () => {
  for (const [path, limit] of [['/api/admin/login', 10], ['/api/admin/forgot-password', 5], ['/api/admin/reset-password', 5], ['/api/admin/password', 5]] as const) {
    const l = limiter();
    for (let i = 0; i < limit; i++) assert.equal(await l.call(path), true, path + ' #' + (i + 1));
    await assert.rejects(() => l.call(path), (error: unknown) => error instanceof HttpException && error.getStatus() === 429, path + ' supera el límite');
    await assert.rejects(() => l.call(path.toUpperCase() + '/'), (error: unknown) => error instanceof HttpException && error.getStatus() === 429, 'mayúsculas y barra final comparten cubo');
    assert.equal(await l.call(path, '203.0.113.99'), true, 'otra IP tiene su propio cubo');
    assert.equal(await l.call(path, '203.0.113.1', 'GET'), true, 'solo se limitan los POST');
  }
  const l = limiter(); // la cuota global (200/min) protege a todo el tráfico público
  let blocked = 0;
  for (let i = 0; i < 205; i++) { try { await l.call('/api/contacto', '198.51.100.' + (i % 250)); } catch { blocked++; } }
  assert.equal(blocked, 5);
  // El tráfico público agotado no bloquea el inicio de sesión, que conserva su propio tope por IP y global.
  assert.equal(await l.call('/api/admin/login', '192.0.2.50'), true);
  for (let i = 0; i < 200; i++) { try { await l.call('/api/admin/login', '192.0.2.' + (i % 200)); } catch { /* cuota propia */ } }
  await assert.rejects(() => l.call('/api/admin/login', '192.0.2.250'), (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
});
test('a burst on another admin route cannot exhaust the global quota of /admin/login', async () => {
  const l = limiter();
  for (const path of ['/api/admin/forgot-password', '/api/admin/reset-password', '/api/admin/password', '/api/admin/register']) {
    for (let i = 0; i < 300; i++) { try { await l.call(path, '198.51.100.' + (i % 250)); } catch { /* cuota de esa ruta */ } }
    await assert.rejects(() => l.call(path, '198.51.100.251'), (error: unknown) => error instanceof HttpException && error.getStatus() === 429, path + ' agotó su propia cuota');
  }
  for (let i = 0; i < 10; i++) assert.equal(await l.call('/api/admin/login', '203.0.113.7'), true, 'login #' + (i + 1));
  await assert.rejects(() => l.call('/api/admin/login', '203.0.113.7'), (error: unknown) => error instanceof HttpException && error.getStatus() === 429, 'el tope por IP del login se conserva');
  assert.equal(await l.call('/api/admin/login', '203.0.113.8'), true, 'otra IP sigue pudiendo entrar');
});
