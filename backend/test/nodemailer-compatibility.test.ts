import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as nodemailer from 'nodemailer';

test('Nodemailer compone mensajes y adjuntos en memoria, sin SMTP ni red', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const result = await transport.sendMail({
    from: 'Horus <noreply@example.test>', to: 'Destino <destino@example.test>',
    subject: 'Cotización y recuperación', text: 'Mensaje de prueba con tildes.',
    html: '<p>Mensaje de prueba con tildes.</p>',
    attachments: [{ filename: 'cotizacion.pdf', content: Buffer.from('%PDF-fixture'), contentType: 'application/pdf' }],
  });
  assert.deepEqual(result.envelope.to, ['destino@example.test']);
  const message = result.message.toString();
  assert.match(message, /multipart\/mixed/);
  assert.match(message, /multipart\/alternative/);
  assert.match(message, /application\/pdf/);
  assert.match(message, /cotizacion\.pdf/);
  transport.close();
});
