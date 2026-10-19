import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ReclamacionesService } from '../src/reclamaciones/reclamaciones.service';
import type { CreateReclamacionDto } from '../src/reclamaciones/dto/create-reclamacion.dto';

// El almacenamiento de una reclamación y la constancia por correo son cosas distintas. Dobles en memoria: sin MySQL ni correo real.
const dto = { nombres: 'Ana', apellidos: 'Prueba', email: 'ana@example.test', telefono: '999999999', tipo_registro: 'reclamo', area: 'Cursos', fecha_incidente: '2026-02-28',
  descripcion_bien: 'Curso ficticio', detalle_reclamo: 'Detalle ficticio', acepta_comunicaciones: true } as unknown as CreateReclamacionDto;
function service(options: { mail?: () => Promise<unknown>; failDb?: boolean } = {}) {
  const stored: Record<string, unknown>[] = []; let mails = 0;
  const prisma = { reclamacion: { create: async ({ data }: { data: Record<string, unknown> }) => { if (options.failDb) throw new Error('ER_SECRET conexión'); stored.push(data); return { id: stored.length }; } } };
  const mail = { sendReclamoConstancia: async () => { mails++; return options.mail ? options.mail() : true; } };
  return { svc: new ReclamacionesService(prisma as never, mail as never), stored, mails: () => mails };
}

test('reclamación: guardada y con constancia aceptada → correo_enviado true', async () => {
  const { svc, stored } = service();
  const result = await svc.create(dto);
  assert.equal(result.ok, true); assert.equal(result.correo_enviado, true); assert.equal(stored.length, 1); assert.match(result.numero_reclamo, /^HG-\d{8}-/);
});

test('reclamación: si el correo falla o es incierto, el registro sigue siendo un éxito con correo_enviado false (no se confunde con el almacenamiento)', async () => {
  for (const mail of [async () => false, async () => { throw new Error('SMTP caído'); }]) {
    const { svc, stored } = service({ mail });
    const result = await svc.create(dto);
    assert.equal(result.ok, true); assert.equal(result.correo_enviado, false); assert.equal(stored.length, 1, 'la reclamación quedó guardada'); assert.ok(result.id);
  }
});

test('reclamación: si no se puede guardar, responde 500 genérico sin detalles internos y no envía constancia', async () => {
  const { svc, mails } = service({ failDb: true });
  await assert.rejects(() => svc.create(dto), (error: any) => {
    assert.equal(error.getStatus(), 500); assert.ok(!JSON.stringify(error.getResponse()).includes('ER_SECRET')); return true;
  });
  assert.equal(mails(), 0, 'sin registro no hay constancia');
});
