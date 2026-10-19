import 'reflect-metadata';
import { CotizacionQueryDto } from '../src/cotizaciones/cotizacion.dto';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ConfigService } from '@nestjs/config';
import { createValidationPipe } from '../src/common/validation';
import { RegisterDto } from '../src/admin/auth/dto/register.dto';
import { LoginDto } from '../src/admin/auth/dto/login.dto';
import { AuthService } from '../src/admin/auth/auth.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { CreateItemDto } from '../src/admin/items/dto/create-item.dto';
import { UpdateItemDto } from '../src/admin/items/dto/update-item.dto';
import { ItemsService } from '../src/admin/items/items.service';
import { UpdateGaleriaDto } from '../src/galeria/dto/update-galeria.dto';
import { GaleriaService } from '../src/galeria/galeria.service';
import { CreateReclamacionDto } from '../src/reclamaciones/dto/create-reclamacion.dto';
import { ReclamacionesService } from '../src/reclamaciones/reclamaciones.service';
import { ContactoService } from '../src/contacto/contacto.service';
import { MessagesService } from '../src/admin/messages/messages.service';
import { NewsletterService } from '../src/newsletter/newsletter.service';
import { SubscribeNewsletterDto } from '../src/newsletter/dto/subscribe-newsletter.dto';
import { SettingsService } from '../src/settings/settings.service';
import { MailService } from '../src/mail/mail.service';
import { validateDeployment } from '../src/deployment.config';

const validate = (value: unknown, metatype: any) => createValidationPipe().transform(value, { type: 'body', metatype });
const account = { nombre: '  Alex Perez  ', email: ' ALEX@example.com ', password: '  password123  ' };

test('auth normalizes identity, preserves password spaces and rejects bcrypt truncation', async () => {
  const dto = await validate(account, RegisterDto);
  assert.equal(dto.nombre, 'Alex Perez'); assert.equal(dto.email, 'alex@example.com');
  assert.equal(dto.password, account.password);
  await validate({ email: account.email, password: account.password }, LoginDto);
  for (const patch of [{ nombre: '   ' }, { password: 12345678 }, { password: '\u00e9'.repeat(37) }, { password: 'x'.repeat(73) }]) {
    await assert.rejects(() => validate({ ...account, ...patch }, RegisterDto), BadRequestException);
  }
});

test('registration handles a unique-key race as 409', async () => {
  const client: any = { adminUser: { findFirst: async () => null, create: async () => { throw new PrismaClientKnownRequestError('Duplicate', { code: 'P2002', clientVersion: '6.19.0' }); } }, adminAuditoria: { create: async () => assert.fail('sin cuenta creada no hay auditoría') } };
  client.$transaction = async (run: (tx: any) => unknown) => run(client);
  const service = new AuthService(client, {} as any);
  await assert.rejects(() => service.register(account, 1), ConflictException);
});

test('JWT rejects malformed identities before querying the database', async () => {
  const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: 'x'.repeat(32) }), { adminUser: { findUnique: () => assert.fail('must not query') } } as any);
  for (const id of [undefined, null, '1', -1, 0, 1.2]) await assert.rejects(() => strategy.validate({ id, email: 'a@example.com' } as any), UnauthorizedException);
});

test('optional updates reject null; required text rejects whitespace', async () => {
  for (const value of [{ titulo: null }, { descripcion: null }, { estado: null }]) await assert.rejects(() => validate(value, UpdateItemDto));
  await assert.rejects(() => validate({ titulo: '   ', descripcion: 'hello' }, CreateItemDto));
});

test('boolean false stays false, strings cannot silently publish gallery entries', async () => {
  assert.equal((await validate({ activo: false }, UpdateGaleriaDto)).activo, false);
  for (const activo of ['false', 'true', 0, 1, null]) await assert.rejects(() => validate({ activo }, UpdateGaleriaDto));
  for (const imagen_url of ['javascript:alert(1)', '//untrusted.example/a', 'data:image/svg+xml,test']) await assert.rejects(() => validate({ imagen_url }, UpdateGaleriaDto));
  await validate({ imagen_url: '/galeria/imagen.jpg' }, UpdateGaleriaDto);
  await validate({ imagen_url: 'https://example.com/imagen.jpg' }, UpdateGaleriaDto);
});

test('gallery and items reject empty updates before database access', async () => {
  await assert.rejects(() => new ItemsService({ adminItem: {} } as any).update(1, {}), BadRequestException);
  await assert.rejects(() => new GaleriaService({ galeriaItem: {} } as any).update(1, {}), BadRequestException);
});

test('complaints validate calendar dates and communication consent', async () => {
  const dto = { nombres: 'Alex', apellidos: 'Perez', email: 'alex@example.com', telefono: '987654321', tipo_registro: 'reclamo', area: 'Soporte', fecha_incidente: '2026-02-28', descripcion_bien: 'Servicio de soporte', detalle_reclamo: 'Servicio incompleto', acepta_comunicaciones: false };
  assert.equal((await validate(dto, CreateReclamacionDto)).acepta_comunicaciones, false);
  for (const patch of [{ fecha_incidente: '2026-02-30' }, { fecha_incidente: 'texto' }, { acepta_comunicaciones: 'false' }, { nombres: ' ' }]) await assert.rejects(() => validate({ ...dto, ...patch }, CreateReclamacionDto));
});

test('admin messages without phone comply with the existing NOT NULL column', async () => {
  let saved: any;
  const service = new MessagesService({ contacto: { create: async ({ data: dto }: any) => (saved = dto) } } as any);
  await service.create({ nombre: 'Alex', email: 'alex@example.com', asunto: 'Consulta', mensaje: 'Mensaje de prueba' });
  assert.equal(saved.telefono, ''); assert.equal(saved.estado, 'nuevo');
});

test('public form errors do not disclose database internals', async () => {
  const model = { create: async () => { throw new Error('secret database query'); } } as any;
  for (const service of [new ContactoService({ contacto: model } as any, {} as any), new ReclamacionesService({ reclamacion: model } as any, {} as any)]) {
    try { await service.create({} as any); assert.fail('expected error'); }
    catch (error: unknown) {
      assert.ok(error instanceof InternalServerErrorException);
      assert.equal(error.getStatus(), 500);
      assert.ok(!JSON.stringify(error.getResponse()).includes('secret'));
    }
  }
});

test('complaint reference has a UUID instead of a four-digit collision space', async () => {
  const references: string[] = [];
  const service = new ReclamacionesService({ reclamacion: { create: async ({ data: dto }: any) => { references.push(dto.numero_reclamo); return { id: 1 }; } } } as any, { sendReclamoConstancia: async () => {} } as any);
  await service.create({} as any); await service.create({} as any);
  assert.notEqual(references[0], references[1]);
  assert.match(references[0], /^HG-\d{8}-[0-9a-f-]{36}$/);
});

test('newsletter reactivates subscriptions atomically and preserves existing interests', async () => {
  const existing = { email: 'alex@example.com', activo: false, interes: 'market' };
  const service = new NewsletterService({ newsletter: { upsert: async (options: any) => {
    assert.deepEqual(options.where, { email: existing.email });
    Object.assign(existing, options.update);
    return existing;
  } } } as any);
  assert.equal((await service.subscribe({ email: ' ALEX@example.com ' })).ok, true);
  assert.equal(existing.activo, true);
  assert.equal(existing.interes, 'market'); // dato histórico: no se recategoriza
  await service.subscribe({ email: existing.email, interes: 'cursos' });
  assert.equal(existing.interes, 'cursos');
});

test('new newsletter subscriptions default to "novedades" and keep an explicit interest such as "cursos"', async () => {
  const created: any[] = [];
  const service = new NewsletterService({ newsletter: { upsert: async (options: any) => { created.push(options); return { id: 1, ...options.create }; } } } as any);
  await service.subscribe({ email: 'Nuevo@Example.com' });
  await service.subscribe({ email: 'otro@example.com', interes: 'cursos' });
  assert.equal(created[0].create.interes, 'novedades');
  assert.equal(created[1].create.interes, 'cursos');
  assert.equal(created[0].create.email, 'nuevo@example.com');
  assert.equal('interes' in created[0].update, false, 'una suscripción sin interés no modifica el de un suscriptor existente');
  assert.ok(created.every(o => o.create.interes !== 'market'));
});

test('newsletter rejects the retired "market" interest (case/space-insensitive) without converting it', async () => {
  for (const interes of ['market', ' MARKET ', 'Market']) {
    await assert.rejects(() => validate({ email: 'a@example.com', interes, consentimiento: true }, SubscribeNewsletterDto), BadRequestException);
  }
  await validate({ email: 'a@example.com', consentimiento: true }, SubscribeNewsletterDto);
  await validate({ email: 'a@example.com', interes: 'cursos', consentimiento: true }, SubscribeNewsletterDto);
  await validate({ email: 'a@example.com', interes: 'marketing', consentimiento: true }, SubscribeNewsletterDto);

  // Nueva suscripción y reactivación de una existente: el servicio también rechaza y no escribe nada.
  const existing = { email: 'alex@example.com', activo: false, interes: 'market' };
  let writes = 0;
  const service = new NewsletterService({ newsletter: { upsert: async (options: any) => { writes++; Object.assign(existing, options.update); return existing; } } } as any);
  for (const interes of ['market', '  Market  ']) {
    await assert.rejects(() => service.subscribe({ email: 'nuevo@example.com', interes }), BadRequestException);
    await assert.rejects(() => service.subscribe({ email: existing.email, interes }), BadRequestException);
  }
  assert.equal(writes, 0);
  assert.equal(existing.activo, false);
  assert.equal(existing.interes, 'market'); // histórico intacto
  await service.subscribe({ email: existing.email }); // reactivar sin interés
  assert.equal(writes, 1);
  assert.equal(existing.activo, true);
  assert.equal(existing.interes, 'market');
});

test('settings reads never seed sample values or expose unknown keys', async () => {
  const service = new SettingsService({ setting: { findMany: async () => [{ clave: 'empresa_nombre', valor: 'Mi empresa' }, { clave: 'internal_key', valor: 'private' }] } } as any);
  const { settings } = await service.getPublicSettings();
  assert.equal(settings.empresa_nombre, 'Mi empresa'); assert.equal(settings.telefono_principal, '');
  assert.equal(settings.internal_key, undefined);
});

test('settings validate the whole payload before writing', async () => {
  const service = new SettingsService({ setting: {} } as any);
  for (const ajustes of [{ empresa_nombre: 'Valid', email_contacto: 'invalid' }, {}, { unknown: 'a' }, { empresa_nombre: {} }, { email_contacto: 'invalid' }, { facebook_url: 'javascript:alert(1)' }, { whatsapp: 'invalid' }]) {
    await assert.rejects(() => service.updateSettings({ ajustes } as any), BadRequestException);
  }
});

test('all settings writes share one transaction', async () => {
  const saved: any[] = [];
  const service = new SettingsService({ $transaction: async (fn: any) => fn({ setting: { upsert: async ({ create }: any) => { saved.push(create); } } }) } as any);
  const result = await service.updateSettings({ ajustes: { empresa_nombre: ' Empresa ', email_contacto: 'info@example.com' } });
  assert.equal(result.actualizados, 2); assert.equal(saved[0].valor, 'Empresa');
});

test('email templates escape user HTML without sending real mail', async () => {
  const service = new MailService(new ConfigService({})); const messages: any[] = [];
  service.sendMail = async (message: any) => { messages.push(message); return true; };
  await service.sendContactoNotificacion({ nombre: '<img src=x>', email: 'a@example.com', asunto: '<b>test</b>', mensaje: '<a href="bad">click</a>' });
  await service.sendReclamoConstancia({ email: 'a@example.com', nombres: '<img src=x>', apellidos: 'Perez', tipo_registro: 'reclamo', numero_reclamo: 'HG-test', area: '<b>test</b>', detalle_reclamo: '<script>bad</script>' });
  assert.equal(messages.length, 3);
  for (const message of messages) { assert.ok(!message.html.includes('<img src=x>')); assert.ok(message.html.includes('&lt;')); }
});

test('startup validates ports, flags and development JWT secrets', () => {
  const env = { JWT_SECRET: 'x'.repeat(32) };
  assert.equal(validateDeployment(env), env);
  for (const patch of [{ PORT: 'abc' }, { DB_PORT: '0' }, { PORT: '65536' }, { DB_SSL: 'yes' }, { DB_SYNC: 'TRUE' }, { JWT_SECRET: 'short' }]) assert.throws(() => validateDeployment({ ...env, ...patch }));
});

test('quote pagination converts query strings without coercing body booleans', async () => {
  const dto = await createValidationPipe().transform({ page: '2', limit: '10' }, { type: 'query', metatype: CotizacionQueryDto });
  assert.equal(dto.page, 2);
  assert.equal(dto.limit, 10);
  for (const limit of ['0', '101', '1.5', 'abc']) await assert.rejects(() => validate({ limit }, CotizacionQueryDto));
});

test('admin settings expose editable empty fields without seeding the database', async () => {
  const service = new SettingsService({ setting: { findMany: async () => [] } } as any);
  const result = await service.getAllSettingsAdmin();
  assert.ok(result.settings.some(row => row.clave === 'empresa_nombre'));
  assert.ok(result.settings.every(row => row.valor === ''));
});
