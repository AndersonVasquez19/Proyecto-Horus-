import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { Controller, Module, Post, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from '../src/admin/auth/auth.controller';
import { AuthService } from '../src/admin/auth/auth.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { PrismaService } from '../src/database/prisma.service';
import { ChatbotGuard } from '../src/chatbot/chatbot.guard';
import { trustedProxies } from '../src/common/trusted-proxies';
import { rsaPublicKey } from '../src/database/connection-security';
import { createValidationPipe } from '../src/common/validation';

const secret = 'isolated-test-secret-at-least-32-characters';

test('pinned MySQL RSA key accepts escaped PEM and rejects paths, private keys and other algorithms', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.equal(rsaPublicKey(pem), pem);
  assert.equal(rsaPublicKey(pem.replace(/\n/g, '\\n')), pem);
  assert.equal(rsaPublicKey(undefined), undefined);
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' });
  for (const invalid of ['/tmp/key.pem', 'invalid', privateKey.export({type:'pkcs8',format:'pem'}), ec]) {
    assert.throws(() => rsaPublicKey(invalid), /DB_RSA_PUBLIC_KEY/);
  }
});

test('proxy configuration requires explicit addresses, not wildcard or hop counts', () => {
  assert.equal(trustedProxies(undefined), false);
  assert.deepEqual(trustedProxies('127.0.0.1/32, ::1/128'), ['127.0.0.1/32', '::1/128']);
  for (const invalid of ['true', '*', '1', '0.0.0.0/0', '::/0', '10.0.0.1/33', '::1/129', 'host.example', '10.0.0.1/24/extra']) {
    assert.throws(() => trustedProxies(invalid));
  }
});

test('admin registration requires a valid session, validates input and never hands out a token', async () => {
  let writes = 0;
  @Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [AuthController],
    providers: [JwtStrategy,
      { provide: ConfigService, useValue: { get: (key: string) => key === 'JWT_SECRET' ? secret : undefined } },
      { provide: PrismaService, useValue: { adminUser: { findUnique: async ({where}: {where: {id: number}}) => where.id === 1 ? {id:1,nombre:'Test',email:'admin@example.test',activo:true,session_version:1} : where.id === 3 ? {id:3,nombre:'Off',email:'off@example.test',activo:false,session_version:1} : null } } },
      // The service stub issues a token on purpose: the controller must not pass it to the caller.
      { provide: AuthService, useValue: { register: async () => { writes++; return {ok:true, token:'must-not-leak'}; } } },
    ],
  })
  class RegistrationTestModule {}
  const app = await NestFactory.create(RegistrationTestModule, { logger: false });
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const jwt = new JwtService({ secret, signOptions: { issuer: 'horus-api', audience: 'horus-panel' } });
  const url = await app.getUrl();
  const valid = { nombre: 'Nuevo Admin', email: 'new@example.test', password: 'Password-for-test-123' };
  const post = (body: object, token?: string) => fetch(url + '/admin/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  const me = (token?: string) => fetch(url + '/admin/me', {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  try {
    // Without a valid session nothing is written, whatever the body says.
    const forged = { id: 1, version: 1 };
    for (const token of [undefined, 'invalid', jwt.sign({id:1},{expiresIn:-1}), jwt.sign({id:2}), jwt.sign({id:3}), jwt.sign({...forged, version: 7}),
      new JwtService({ secret: 'another-secret-with-at-least-32-characters', signOptions: { issuer: 'horus-api', audience: 'horus-panel' } }).sign({id:1}),
      new JwtService({ secret, signOptions: { issuer: 'horus-api', audience: 'other-audience' } }).sign({id:1})]) {
      assert.equal((await post(valid, token)).status, 401);
    }
    assert.equal(writes, 0);
    // With a valid session, input is still validated and extra fields (role, active flag...) are rejected.
    const session = jwt.sign({id:1, version: 1});
    for (const body of [{}, { ...valid, nombre: ' ' }, { ...valid, email: 'invalid' }, { ...valid, password: 'short' }, { ...valid, role: 'admin' }, { ...valid, rol: 'super' }, { ...valid, activo: true }, { ...valid, id: 99 }, { ...valid, session_version: 5 }]) {
      assert.equal((await post(body, session)).status, 400);
    }
    assert.equal(writes, 0);
    const registered = await post(valid, session);
    assert.equal(registered.status, 201);
    assert.deepEqual(await registered.json(), { ok: true });
    assert.equal(writes, 1);
    for (const token of [undefined, 'invalid', jwt.sign({id:1},{expiresIn:-1}), jwt.sign({id:2})]) {
      assert.equal((await me(token)).status, 401);
    }
    assert.equal((await me(jwt.sign({id:1}))).status, 200);
    assert.equal(writes, 1);
  } finally { await app.close(); }
});

test('HTTP quota separates visitors behind a trusted proxy and ignores forged untrusted forwarding', async () => {
  @Controller('chatbot')
  @UseGuards(ChatbotGuard)
  class QuotaController { @Post('message') message() { return {ok:true}; } }
  @Module({controllers:[QuotaController],providers:[ChatbotGuard]})
  class QuotaModule {}
  for (const trust of [false, trustedProxies('127.0.0.1/32')]) {
    const app = await NestFactory.create<NestExpressApplication>(QuotaModule, {logger:false});
    app.set('trust proxy', trust);
    await app.listen(0,'127.0.0.1');
    const url = await app.getUrl();
    const post = (ip: string) => fetch(url+'/chatbot/message',{method:'POST',headers:{'X-Forwarded-For':ip}});
    try {
      for(let i=0;i<20;i++) assert.equal((await post(`198.51.100.${i+1}, 203.0.113.9`)).status,201);
      assert.equal((await post('198.51.100.250, 203.0.113.9')).status,429);
      assert.equal((await post('203.0.113.10')).status,trust ? 201 : 429);
    } finally { await app.close(); }
  }
});
