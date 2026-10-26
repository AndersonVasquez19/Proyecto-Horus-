import { test } from 'node:test';
import * as assert from 'node:assert/strict';
const { probeOptions } = require('../scripts/check-mysql-tls.cjs');

test('la sonda TLS rechaza configuraciones incompletas o inseguras antes de abrir la red', () => {
  const base = { DB_HOST: 'mysql.example.test', DB_PORT: '3306', DB_NAME: 'fixture', DB_USER: 'fixture',
    DB_PASS: 'fixture', DB_SSL: 'true', DB_SSL_CA: 'not-a-certificate',
    DB_EXPECTED_SERVER_UUID: '12345678-1234-1234-1234-123456789abc' };
  assert.throws(() => probeOptions({}), /Falta configurar/);
  assert.throws(() => probeOptions({ ...base, DB_SSL: 'false' }), /TLS verificado/);
  assert.throws(() => probeOptions({ ...base, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /TLS verificado/);
  assert.throws(() => probeOptions({ ...base, DB_PORT: '3306x' }), /DB_PORT/);
  assert.throws(() => probeOptions({ ...base, DB_PORT: '65536' }), /DB_PORT/);
  assert.throws(() => probeOptions({ ...base, DB_EXPECTED_SERVER_UUID: 'incorrecto' }), /UUID/);
  assert.throws(() => probeOptions(base), /certificado PEM/);
  assert.throws(() => probeOptions({ ...base, DB_SSL_CA: '-----BEGIN PRIVATE KEY-----' }), /certificado PEM/);
});
