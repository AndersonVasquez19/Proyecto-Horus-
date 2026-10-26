import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createValidationPipe } from '../src/common/validation';
import { DescartePreinscripcionDto, DesistimientoPreinscripcionDto } from '../src/preinscripciones/preinscripciones.dto';
import { recordHistory } from '../src/preinscripciones/preinscripciones.history';
import { contactEvidence, namesMatch, nameTokens, normalizePhone, verifyExistingStudent, verifyNewStudent } from '../src/preinscripciones/preinscripciones.identity';
import { findPersonalData, SAFE_FIELD } from '../src/preinscripciones/preinscripciones.privacy';
import { PreinscripcionesService } from '../src/preinscripciones/preinscripciones.service';

// Datos FICTICIOS. Ninguna prueba usa personas, correos ni documentos reales.
const pipe = createValidationPipe();
const validate = (body: unknown, metatype: unknown) => pipe.transform(body, { type: 'body', metatype: metatype as never });
const ana = { nombres: 'Ana María', apellidos: 'Pérez Quispe', email: 'ana@example.test', telefono: '987 654 321' };

// ---- Reglas de identidad (puras) ------------------------------------------------------------------------------------------------
test('Identidad: los nombres son compatibles sin importar tildes, mayúsculas, partículas ni segundo nombre, pero no si cambian las personas', () => {
  assert.deepEqual(nameTokens('  María de la  CRUZ '), ['maria', 'cruz']);
  assert.equal(namesMatch(ana, { nombres: 'ANA MARIA', apellidos: 'perez quispe' }), true);
  assert.equal(namesMatch({ nombres: 'Ana', apellidos: 'Pérez' }, ana), true, 'la preinscripción trae solo el primer nombre y el primer apellido');
  assert.equal(namesMatch({ nombres: 'Rosa', apellidos: 'de la Cruz' }, { nombres: 'Rosa', apellidos: 'Cruz' }), true);
  for (const other of [{ nombres: 'Luisa', apellidos: 'Pérez Quispe' }, { nombres: 'Ana María', apellidos: 'Torres' }, { nombres: 'Pérez', apellidos: 'Ana María' }, { nombres: '', apellidos: 'Pérez' }, { nombres: '123', apellidos: '456' }])
    assert.equal(namesMatch(ana, other), false, JSON.stringify(other));
});

test('Identidad: el teléfono se compara por dígitos (ignora +51, espacios y guiones) y un correo se compara sin mayúsculas', () => {
  assert.equal(normalizePhone('+51 987-654-321'), '987654321'); assert.equal(normalizePhone('12345'), '', 'demasiado corto para comparar');
  assert.deepEqual(contactEvidence(ana, { ...ana, email: 'ANA@EXAMPLE.TEST', telefono: '+51987654321' }), { email: true, telefono: true, referencia: true });
  assert.deepEqual(contactEvidence(ana, { ...ana, email: 'otro@example.test', telefono: '900000000' }), { email: false, telefono: false, referencia: true });
  assert.deepEqual(contactEvidence(ana, { ...ana, email: null, telefono: null }), { email: false, telefono: false, referencia: false });
});

test('Identidad: estudiante registrado — coincidencia, discrepancia de nombres, discrepancia de contacto y estudiante sin contacto', () => {
  const ok = verifyExistingStudent(ana, { ...ana, email: 'ana@example.test', telefono: '900000000' });
  assert.equal(ok.ok, true); assert.deepEqual(ok.controles, ['control:dni_coincide', 'control:nombres_coinciden', 'control:contacto_email']);
  assert.deepEqual(verifyExistingStudent(ana, { ...ana, email: 'otro@example.test', telefono: '987654321' }).controles.slice(-1), ['control:contacto_telefono'], 'el teléfono también corrobora');
  const names = verifyExistingStudent(ana, { nombres: 'Carlos', apellidos: 'Rojas', email: 'ana@example.test', telefono: '987654321' });
  assert.equal(names.ok, false); assert.deepEqual(names.discrepancias, ['nombres'], 'un correo y teléfono iguales NO bastan si el nombre es de otra persona');
  const contact = verifyExistingStudent(ana, { ...ana, email: 'otro@example.test', telefono: '900000000' });
  assert.equal(contact.ok, false); assert.deepEqual(contact.discrepancias, ['contacto']);
  const both = verifyExistingStudent(ana, { nombres: 'Carlos', apellidos: 'Rojas', email: 'x@example.test', telefono: '911111111' });
  assert.deepEqual(both.discrepancias, ['nombres', 'contacto']);
  const noContact = verifyExistingStudent(ana, { ...ana, email: null, telefono: null });
  assert.equal(noContact.ok, true); assert.deepEqual(noContact.controles, ['control:dni_coincide', 'control:nombres_coinciden', 'control:contacto_sin_referencia']);
  // Los resultados son códigos: nunca los valores comparados.
  for (const verdict of [ok, names, contact, both, noContact]) assert.doesNotMatch(JSON.stringify(verdict), /ana@|Pérez|Quispe|Carlos|Rojas|9876|9000|9111/i);
  for (const control of [...ok.controles, ...both.controles]) assert.match(control, SAFE_FIELD);
});

test('Identidad: estudiante nuevo — bloquea el posible duplicado (mismo nombre y contacto con otro DNI) y permite el contacto compartido entre personas distintas', () => {
  assert.deepEqual(verifyNewStudent(ana, []), { ok: true, discrepancias: [], controles: ['control:dni_nuevo', 'control:sin_duplicado_aparente'] });
  assert.deepEqual(verifyNewStudent(ana, [{ nombres: 'Carlos', apellidos: 'Pérez Rojas', email: 'ana@example.test' }]), { ok: true, discrepancias: [], controles: ['control:dni_nuevo', 'control:contacto_compartido'] });
  const duplicate = verifyNewStudent(ana, [{ nombres: 'Carlos', apellidos: 'Rojas' }, { nombres: 'ana maria', apellidos: 'Perez', telefono: '987654321' }]);
  assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.discrepancias, ['posible_duplicado']);
});

// ---- Privacidad del historial ---------------------------------------------------------------------------------------------------
test('Privacidad: el motivo no admite correos, teléfonos, documentos ni credenciales, pero sí texto administrativo normal', () => {
  for (const bad of ['Escribió a ana@example.test', 'llamar al 987654321', 'DNI 12345678', 'dni: 1234 5678', 'cel +51 987-654-321', 'contraseña: abc', 'Password = x', 'token: zzz', 'api key: k', 'duplicada del carné 00123456'])
    assert.notEqual(findPersonalData(bad), null, bad);
  for (const good of ['Duplicada: ya existe otra solicitud', 'La persona desistió por horario', 'Se inscribió en la edición de noviembre', 'Pidió esperar a la edición 2027', 'Desiste el 12/10/2026', 'Pago de S/ 150 pendiente', 'La clave del curso es el horario'])
    assert.equal(findPersonalData(good), null, good);
});

test('Privacidad: descarte y desistimiento rechazan datos personales en el motivo con un mensaje que no repite el dato', async () => {
  for (const metatype of [DescartePreinscripcionDto, DesistimientoPreinscripcionDto]) {
    for (const motivo of ['Contactar a ana@example.test', 'Su DNI es 12345678', 'Su cel 987654321', 'password: x']) {
      const failure = await validate({ revision: 1, motivo }, metatype).then(() => null, error => error);
      assert.ok(failure instanceof BadRequestException, motivo);
      const body = JSON.stringify(failure.getResponse());
      assert.match(body, /sin datos personales/); assert.doesNotMatch(body, /ana@|12345678|987654321|password: x/, 'el error no devuelve el dato');
    }
    await validate({ revision: 1, motivo: 'Duplicada de otra solicitud' }, metatype);
  }
});

function historyTx() {
  const rows: Record<string, unknown>[] = [];
  return { rows, tx: { adminUser: { findUnique: async () => ({ rol: 'SECRETARIA' }) }, preinscripcionHistorial: { create: async ({ data }: { data: Record<string, unknown> }) => { rows.push(data); } } } as never };
}

test('Privacidad: recordHistory es la segunda barrera — rechaza valores personales en campos y motivo aunque el DTO se omita, y acepta nombres de campo y controles', async () => {
  const ok = historyTx();
  await recordHistory(ok.tx, 1, { operacion: 'conversion', revision: 2, actor_id: 1, campos: ['estado', 'estudiante_id', 'estudiante_existente', 'control:dni_coincide', 'control:contacto_email'], motivo: 'Duplicada' });
  assert.equal(ok.rows.length, 1);
  for (const campos of [['ana@example.test'], ['Pérez'], ['12345678'], ['control:Ana'], ['x'.repeat(80)], ['estado', 'nombre completo']]) {
    const bad = historyTx();
    await assert.rejects(recordHistory(bad.tx, 1, { operacion: 'correccion', revision: 2, actor_id: 1, campos }), /nombres de campo y códigos de control/, JSON.stringify(campos));
    assert.equal(bad.rows.length, 0);
  }
  for (const motivo of ['ana@example.test', 'dni 12345678', 'contraseña: x']) {
    const bad = historyTx();
    await assert.rejects(recordHistory(bad.tx, 1, { operacion: 'descarte', revision: 2, actor_id: 1, campos: ['estado'], motivo }), (error: unknown) => error instanceof BadRequestException && !/ana@|12345678|contraseña: x/.test(error.message));
    assert.equal(bad.rows.length, 0);
  }
});

// ---- Conversión (sin base de datos: el servicio real con un cliente simulado) ----------------------------------------------------
type StudentRow = { id: number; nombres: string; apellidos: string; email: string | null; telefono: string | null };
function conversionFixture(opts: { known?: StudentRow; byId?: boolean; shared?: StudentRow[]; revision?: number } = {}) {
  const log = { created: [] as Record<string, unknown>[], enrolled: 0, updates: [] as Record<string, unknown>[], history: [] as Record<string, unknown>[] };
  const row = { id: 1, convocatoria_id: 7, nombres: 'Ana María', apellidos: 'Pérez Quispe', email: 'ana@example.test', telefono: '987654321', estado: 'validada', revision: opts.revision ?? 3 };
  const edition = { id: 7, estado: 'abierta', archivado_at: null, revision: 1 };
  const tx = {
    preinscripcion: {
      findUnique: async () => ({ convocatoria_id: 7 }),
      findUniqueOrThrow: async (args: { include?: unknown }) => args.include ? { ...row, estado: 'matriculada', revision: row.revision + 1, convocatoria: { id: 7, fecha_inicio: null, fecha_fin: null } } : row,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { log.updates.push(data); return { count: 1 }; },
    },
    estudiante: { findUnique: async () => (opts.byId === false ? null : { id: opts.known?.id ?? 55 }) },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM preinscripciones')) return [{ id: 1 }];
      if (sql.includes('doc_numero =')) return opts.known ? [opts.known] : [];
      if (sql.includes('email =')) return opts.shared ?? [];
      throw new Error('SQL inesperado');
    },
    preinscripcionHistorial: { create: async ({ data }: { data: Record<string, unknown> }) => { log.history.push(data); } },
    adminUser: { findUnique: async () => ({ rol: 'SECRETARIA' }) },
  };
  const matriculas = { lockEdition: async () => edition, createInTransaction: async () => { log.enrolled++; return { item: { id: 99 } }; } };
  const students = { createInTransaction: async (_tx: unknown, data: Record<string, unknown>) => { log.created.push(data); return { id: 55 }; } };
  const service = new PreinscripcionesService({ $transaction: async (run: (t: unknown) => unknown) => run(tx) } as never, matriculas as never, students as never);
  return { service, log, row };
}
const known: StudentRow = { id: 12, nombres: 'Ana', apellidos: 'Pérez', email: 'ana@example.test', telefono: null };
const nothingWritten = (log: ReturnType<typeof conversionFixture>['log']) => assert.deepEqual([log.created.length, log.enrolled, log.updates.length, log.history.length], [0, 0, 0, 0], 'un bloqueo no escribe nada');
const conflictBody = (error: unknown) => (error as ConflictException).getResponse() as { codigo: string; discrepancias: string[]; message: string };

test('Conversión: estudiante existente con identidad coincidente — vincula, registra los controles y no copia datos personales al historial', async () => {
  const f = conversionFixture({ known });
  const done = await f.service.convert(1, { revision: 3, doc_numero: '12345678', estudiante_id: 12 }, 4);
  assert.equal(done.estudiante_creado, false); assert.equal(f.log.created.length, 0); assert.equal(f.log.enrolled, 1);
  assert.equal(f.log.updates[0].estudiante_id, 12);
  const entry = f.log.history[0];
  assert.equal(entry.operacion, 'conversion');
  assert.deepEqual(entry.campos, ['estado', 'estudiante_id', 'matricula_id', 'estudiante_existente', 'control:dni_coincide', 'control:nombres_coinciden', 'control:contacto_email']);
  assert.doesNotMatch(JSON.stringify(f.log.history), /ana@|Pérez|Quispe|12345678|987654321/i, 'ni correo, ni nombre, ni DNI, ni teléfono en el historial');
  assert.doesNotMatch(JSON.stringify(done), /12345678/, 'la respuesta no repite el DNI tecleado');
});

test('Conversión: estudiante existente por DNI sin indicar el id también se vincula (mismo contraste de identidad)', async () => {
  const f = conversionFixture({ known: { ...known, telefono: '+51 987 654 321', email: 'otro@example.test' } });
  assert.equal((await f.service.convert(1, { revision: 3, doc_numero: '12345678' }, 4)).estudiante_creado, false);
  assert.ok((f.log.history[0].campos as string[]).includes('control:contacto_telefono'));
});

test('Conversión: identidad discrepante — nombres distintos, contacto sin coincidencia o ambos — se bloquea sin escribir y sin datos personales en el error', async () => {
  const cases: Array<[StudentRow, string[]]> = [
    [{ ...known, nombres: 'Carlos', apellidos: 'Rojas' }, ['nombres']],
    [{ ...known, email: 'distinto@example.test', telefono: '911111111' }, ['contacto']],
    [{ ...known, nombres: 'Carlos', apellidos: 'Rojas', email: 'distinto@example.test', telefono: '911111111' }, ['nombres', 'contacto']],
  ];
  for (const [student, discrepancias] of cases) {
    for (const body of [{ revision: 3, doc_numero: '12345678' }, { revision: 3, doc_numero: '12345678', estudiante_id: 12 }]) {
      const f = conversionFixture({ known: student });
      const failure = await f.service.convert(1, body, 4).then(() => null, error => error);
      assert.ok(failure instanceof ConflictException, JSON.stringify(discrepancias));
      assert.deepEqual([conflictBody(failure).codigo, conflictBody(failure).discrepancias], ['IDENTIDAD_DISCREPANTE', discrepancias]);
      assert.doesNotMatch(JSON.stringify(failure.getResponse()), /ana@|Pérez|Quispe|Carlos|Rojas|12345678|987654321|distinto@|911111111/i, 'el error no filtra datos personales');
      nothingWritten(f.log);
    }
  }
});

test('Conversión: no se puede elegir otro estudiante — un estudiante_id que no es el del DNI se bloquea, y uno inexistente da 404', async () => {
  const other = conversionFixture({ known });
  const failure = await other.service.convert(1, { revision: 3, doc_numero: '12345678', estudiante_id: 13 }, 4).then(() => null, error => error);
  assert.ok(failure instanceof ConflictException); assert.deepEqual([conflictBody(failure).codigo, conflictBody(failure).discrepancias], ['DNI_NO_COINCIDE', ['dni']]); nothingWritten(other.log);
  const unknownDni = conversionFixture({});
  const second = await unknownDni.service.convert(1, { revision: 3, doc_numero: '12345678', estudiante_id: 13 }, 4).then(() => null, error => error);
  assert.equal(conflictBody(second).codigo, 'DNI_NO_COINCIDE', 'ese DNI no está registrado: no se vincula el estudiante elegido'); nothingWritten(unknownDni.log);
  const missing = conversionFixture({ byId: false });
  await assert.rejects(missing.service.convert(1, { revision: 3, doc_numero: '12345678', estudiante_id: 999 }, 4), NotFoundException); nothingWritten(missing.log);
});

test('Conversión: estudiante nuevo — se crea con los datos de la preinscripción y los controles; un posible duplicado bajo otro DNI se bloquea', async () => {
  const fresh = conversionFixture();
  const done = await fresh.service.convert(1, { revision: 3, doc_numero: '12345678' }, 4);
  assert.equal(done.estudiante_creado, true); assert.equal(fresh.log.created.length, 1); assert.equal(fresh.log.created[0].doc_numero, '12345678');
  assert.deepEqual(fresh.log.history[0].campos, ['estado', 'estudiante_id', 'matricula_id', 'estudiante_nuevo', 'control:dni_nuevo', 'control:sin_duplicado_aparente']);
  assert.doesNotMatch(JSON.stringify(fresh.log.history), /ana@|Pérez|12345678|987654321/i);
  const shared = conversionFixture({ shared: [{ id: 30, nombres: 'Carlos', apellidos: 'Rojas', email: 'ana@example.test', telefono: null }] });
  await shared.service.convert(1, { revision: 3, doc_numero: '12345678' }, 4);
  assert.ok((shared.log.history[0].campos as string[]).includes('control:contacto_compartido'), 'contacto compartido entre personas distintas: se permite y se anota');
  const duplicate = conversionFixture({ shared: [{ id: 31, nombres: 'Ana', apellidos: 'Pérez', email: 'ana@example.test', telefono: '987654321' }] });
  const failure = await duplicate.service.convert(1, { revision: 3, doc_numero: '87654321' }, 4).then(() => null, error => error);
  assert.ok(failure instanceof ConflictException); assert.deepEqual([conflictBody(failure).codigo, conflictBody(failure).discrepancias], ['POSIBLE_DUPLICADO', ['posible_duplicado']]);
  assert.doesNotMatch(JSON.stringify(failure.getResponse()), /ana@|Pérez|87654321|987654321/i); nothingWritten(duplicate.log);
});

test('Conversión: una revisión obsoleta (reintento o doble clic) se rechaza antes de comparar identidad y sin escribir', async () => {
  const stale = conversionFixture({ known, revision: 4 });
  await assert.rejects(stale.service.convert(1, { revision: 3, doc_numero: '12345678' }, 4), ConflictException); nothingWritten(stale.log);
});

test('Conversión: el servicio no ofrece ninguna excepción por parámetro y los mensajes de bloqueo son estáticos', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'preinscripciones', 'preinscripciones.service.ts'), 'utf8');
  assert.doesNotMatch(source, /forzar|force|override|omitir_identidad|confirmar_discrepancia/i);
  const block = source.slice(source.indexOf('const IDENTITY_BLOCKS'), source.indexOf('type Prepared'));
  assert.doesNotMatch(block, /\$\{/, 'los mensajes de bloqueo no interpolan valores');
});
