import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Proceso separado: una regresión de GHSA-27r3-jxmh-p828 no debe tumbar el runner.
// Solo HTTP de bucle local, sin AppModule, MySQL, credenciales ni servicios externos.
test('el parser de Express sobrevive a bytes posteriores a un cuerpo comprimido', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { gzipSync } = require('node:zlib');
    const http = require('node:http');
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.post('/', (req, res) => res.json(req.body));
    app.get('/health', (req, res) => res.send('ok'));
    app.use((err, req, res, next) => res.sendStatus(400));
    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      function post(body) {
        return new Promise((resolve, reject) => {
          const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', agent: false,
            headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': body.length } }, res => {
            let text = ''; res.on('data', data => { text += data; });
            res.on('end', () => resolve({ status: res.statusCode, text }));
          });
          req.on('error', reject); req.end(body);
        });
      }
      try {
        const valid = gzipSync(JSON.stringify({ mensaje: 'prueba' }));
        const normal = await post(valid);
        assert.equal(normal.status, 200);
        assert.equal(JSON.parse(normal.text).mensaje, 'prueba');
        await post(Buffer.concat([valid, Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]));
        await new Promise(resolve => setTimeout(resolve, 100));
        const response = await fetch('http://127.0.0.1:' + port + '/health');
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'ok');
        console.log('survived');
      } catch { process.exitCode = 1; }
      finally { server.close(); server.closeAllConnections(); }
    });
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(child.status, 0, 'El proceso HTTP debe seguir vivo tras la solicitud malformada. ' + child.stderr);
  assert.match(child.stdout, /survived/);
});
