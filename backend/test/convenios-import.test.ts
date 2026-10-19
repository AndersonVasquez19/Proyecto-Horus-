import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { importConvenios } from '../src/convenios/convenios.import';

test('explicit importer is idempotent and preserves edits; tests use an isolated fake inventory', async () => {
  const rows = [{ origen_local: 'test-only', nombre: 'Entidad de prueba', sigla: 'TEST', logoFile: 'fake-logo.png',
    descripcion_corta: 'Descripción de prueba', descripcion_completa: '', informacion_adicional: '', orden: 0, visible: true }];
  let writes = 0, uploads = 0;
  const records = new Map<string, object>();
  const client = { convenio: {
    findUnique: async ({ where }: { where: { origen_local: string } }) => records.get(where.origen_local) || null,
    create: async ({ data }: { data: { origen_local: string } }) => { writes++; records.set(data.origen_local, data); return data; },
  } } as unknown as Pick<PrismaClient, 'convenio'>;
  const upload = async () => { uploads++; return 'https://example.com/upload.png'; };
  assert.deepEqual(await importConvenios(client, upload, rows), { created: 1, skipped: 0 });
  const edited = { nombre: 'Editado', visible: false }; records.set('test-only', edited);
  assert.deepEqual(await importConvenios(client, upload, rows), { created: 0, skipped: 1 });
  assert.equal(records.get('test-only'), edited); assert.equal(writes, 1); assert.equal(uploads, 1);
});

test('import failures do not fabricate success or overwrite existing content', async () => {
  const rows = [{ origen_local: 'test-only', nombre: 'Entidad de prueba', sigla: 'TEST', logoFile: 'fake-logo.png',
    descripcion_corta: 'Descripción de prueba', descripcion_completa: '', informacion_adicional: '', orden: 0, visible: true }];
  let writes = 0;
  const client = { convenio: { findUnique: async () => null, create: async () => { writes++; } } } as unknown as Pick<PrismaClient, 'convenio'>;
  await assert.rejects(() => importConvenios(client, async () => { throw new Error('Upload failure'); }, rows));
  assert.equal(writes, 0);
});
