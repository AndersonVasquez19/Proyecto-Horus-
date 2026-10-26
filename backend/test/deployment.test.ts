import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { corsOrigins, listenHost, validateDeployment } from '../src/deployment.config';
test('development supports local frontend origins', () => {
 assert.ok(corsOrigins({}).includes('http://localhost:5173'));
});

test('validateDeployment conserva CIDRs, admite un salto explícito y rechaza mezclas o valores inválidos', () => {
 assert.equal(validateDeployment({ TRUSTED_PROXY_HOPS: '1' }).TRUSTED_PROXY_HOPS, '1');
 assert.equal(validateDeployment({ TRUSTED_PROXY_CIDRS: '10.0.0.0/8' }).TRUSTED_PROXY_CIDRS, '10.0.0.0/8');
 assert.throws(() => validateDeployment({ TRUSTED_PROXY_HOPS: '2' }), /TRUSTED_PROXY_HOPS/);
 assert.throws(() => validateDeployment({ TRUSTED_PROXY_HOPS: '1', TRUSTED_PROXY_CIDRS: '10.0.0.0/8' }), /mutuamente excluyentes/);
});
test('production requires exact HTTPS origins', () => {
 for (const origin of ['', '*', 'https://web.example.com/path', 'https://web.example.com/', 'http://web.example.com']) {
  assert.throws(() => corsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: origin }));
 }
 assert.deepEqual(corsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://web.example.com, https://preview.example.com' }), ['https://web.example.com', 'https://preview.example.com']);
});
test('hosted configuration rejects missing secrets, local DB and schema sync', () => {
 const env = { VERCEL: '1', CORS_ORIGINS: 'https://web.example.com', DB_HOST: 'mysql.example.com', DB_NAME: 'horus', DB_USER: 'horus', DB_PASS: 'test-value', JWT_SECRET: 'x'.repeat(32), DB_SYNC: 'false' };
 assert.equal(validateDeployment(env), env);
 for (const patch of [{ DB_HOST: 'localhost' }, { DB_PASS: '' }, { JWT_SECRET: 'short' }, { DB_SYNC: 'true' }]) {
  assert.throws(() => validateDeployment({ ...env, ...patch }));
 }
});
test('HOST es opcional y solo admite direcciones IP', () => {
 assert.equal(listenHost({}), undefined);
 assert.equal(listenHost({ HOST: '' }), undefined);
 assert.equal(listenHost({ HOST: '  ' }), undefined);
 assert.equal(listenHost({ HOST: '127.0.0.1' }), '127.0.0.1');
 assert.equal(listenHost({ HOST: ' 0.0.0.0 ' }), '0.0.0.0');
 assert.equal(listenHost({ HOST: '::1' }), '::1');
 for (const host of ['localhost', 'example.com', '0.0.0.0/0', '127.0.0.1:3000', '*', '256.1.1.1', 'http://127.0.0.1']) {
  assert.throws(() => listenHost({ HOST: host }), /HOST/);
 }
 assert.throws(() => listenHost({ HOST: 80 }), /HOST/);
});
test('validateDeployment valida HOST sin alterar la configuración anterior', () => {
 const env = { VERCEL: '1', CORS_ORIGINS: 'https://web.example.com', DB_HOST: 'mysql.example.com', DB_NAME: 'horus', DB_USER: 'horus', DB_PASS: 'test-value', JWT_SECRET: 'x'.repeat(32), DB_SYNC: 'false' };
 assert.equal(validateDeployment(env), env);
 for (const HOST of ['127.0.0.1', '0.0.0.0', '']) assert.equal(validateDeployment({ ...env, HOST }).HOST, HOST);
 assert.throws(() => validateDeployment({ ...env, HOST: 'localhost' }), /HOST/);
});
