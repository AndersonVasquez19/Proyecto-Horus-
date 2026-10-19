import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateAdminMessageDto } from '../src/admin/messages/dto/create-message.dto';
import { ChatContactDto } from '../src/chatbot/chatbot.dto';
import { CreateCursoDto, CreatePreguntaFrecuenteDto } from '../src/catalogo/catalogo.dto';
import { CotizacionDto } from '../src/cotizaciones/cotizacion.dto';
import { CreateConvenioDto } from '../src/convenios/convenios.dto';
import { CreateContactoDto } from '../src/contacto/dto/create-contacto.dto';
import { RegisterDto } from '../src/admin/auth/dto/register.dto';

// Criterio único: obligatorio (no vacío), longitud máxima del esquema y formato. Sin mínimos de longitud inventados.
const errorsOf = (cls: new () => object, data: object) => validateSync(plainToInstance(cls, data) as object, { whitelist: true, forbidNonWhitelisted: true }).map(e => e.property);

test('mensajes administrativos: un carácter es válido; vacío, exceso y teléfono mal formado no', () => {
  const ok = { nombre: 'A', email: 'a@example.test', asunto: 'B', mensaje: 'C', telefono: '1' };
  assert.deepEqual(errorsOf(CreateAdminMessageDto, ok), []);
  assert.deepEqual(errorsOf(CreateAdminMessageDto, { ...ok, telefono: undefined }), [], 'el teléfono sigue siendo opcional');
  assert.ok(errorsOf(CreateAdminMessageDto, { ...ok, nombre: '' }).includes('nombre'));
  assert.ok(errorsOf(CreateAdminMessageDto, { ...ok, nombre: 'x'.repeat(101) }).includes('nombre'));
  assert.ok(errorsOf(CreateAdminMessageDto, { ...ok, mensaje: 'x'.repeat(5001) }).includes('mensaje'));
  assert.ok(errorsOf(CreateAdminMessageDto, { ...ok, telefono: 'abc' }).includes('telefono'), 'formato de teléfono');
  assert.ok(errorsOf(CreateAdminMessageDto, { ...ok, email: 'no-es-correo' }).includes('email'));
});

test('contacto del chatbot: mismos criterios y el consentimiento sigue siendo obligatorio', () => {
  const ok = { nombre: 'A', email: 'a@example.test', telefono: '1', asunto: 'B', mensaje: 'C', consentimiento: true };
  assert.deepEqual(errorsOf(ChatContactDto, ok), []);
  assert.ok(errorsOf(ChatContactDto, { ...ok, consentimiento: false }).includes('consentimiento'));
  assert.ok(errorsOf(ChatContactDto, { ...ok, telefono: '12 ab' }).includes('telefono'));
  assert.ok(errorsOf(ChatContactDto, { ...ok, asunto: 'x'.repeat(141) }).includes('asunto'));
  assert.ok(errorsOf(ChatContactDto, { ...ok, asunto: '   ' }).includes('asunto'));
});

test('catálogo: títulos, descripciones y duración de un carácter; el slug conserva su formato', () => {
  const course = { titulo: 'A', slug: 'a', descripcion: 'B', tipo: 'curso', modalidad: 'virtual', duracion: '1' };
  assert.deepEqual(errorsOf(CreateCursoDto, course), []);
  assert.ok(errorsOf(CreateCursoDto, { ...course, slug: 'No Valido' }).includes('slug'));
  assert.ok(errorsOf(CreateCursoDto, { ...course, titulo: '' }).includes('titulo'));
  assert.ok(errorsOf(CreateCursoDto, { ...course, titulo: 'x'.repeat(161) }).includes('titulo'));
  assert.deepEqual(errorsOf(CreatePreguntaFrecuenteDto, { pregunta: 'A', respuesta: 'B', categoria: 'C' }), []);
});

test('cotizaciones y convenios: cliente, emisor y descripciones de un carácter', () => {
  const quote = { cliente: 'A', email: '', telefono: '', documento: '', direccion: '', emisor: 'E', datos_emisor: '', moneda: 'PEN', validez: '2030-01-01', condiciones: '', conceptos: [{ descripcion: 'D', cantidad: 1, precio: 0 }], descuento: 0, tasa: 18 };
  assert.deepEqual(errorsOf(CotizacionDto, quote), []);
  assert.ok(errorsOf(CotizacionDto, { ...quote, cliente: '' }).includes('cliente'));
  assert.ok(errorsOf(CreateConvenioDto, { nombre: '', descripcion_corta: 'x' }).includes('nombre'));
  assert.deepEqual(errorsOf(CreateConvenioDto, { nombre: 'A', descripcion_corta: 'B' }), []);
});

test('mensajes administrativos: «solo espacios» cuenta como vacío y los valores se guardan recortados', () => {
  const blank = { nombre: '   ', email: 'a@example.test', asunto: '  ', mensaje: '\n\t ' };
  assert.deepEqual(errorsOf(CreateAdminMessageDto, blank).sort(), ['asunto', 'mensaje', 'nombre']);
  const dto = plainToInstance(CreateAdminMessageDto, { nombre: '  Ana ', email: ' a@example.test ', asunto: ' B ', mensaje: ' C ', telefono: ' 987 ' }) as CreateAdminMessageDto;
  assert.deepEqual([dto.nombre, dto.email, dto.asunto, dto.mensaje, dto.telefono], ['Ana', 'a@example.test', 'B', 'C', '987']);
  assert.deepEqual(validateSync(dto), []);
});

test('formato de teléfono: exige al menos un dígito, sin imponer una longitud mínima', () => {
  const base = { nombre: 'A', email: 'a@example.test', asunto: 'B', mensaje: 'C' };
  for (const telefono of ['1', '987654321', '+51 (076) 123-456', '987.654.321']) assert.deepEqual(errorsOf(CreateAdminMessageDto, { ...base, telefono }), [], telefono);
  for (const telefono of ['...', '()', '+', 'abc', '98a']) assert.ok(errorsOf(CreateAdminMessageDto, { ...base, telefono }).includes('telefono'), telefono);
});

test('contacto público y registro de administrador: sin mínimos inventados; las contraseñas conservan su mínimo de seguridad', () => {
  const contact = { nombre: 'A', email: 'a@example.test', telefono: '1', asunto: 'B', mensaje: 'C' };
  assert.deepEqual(errorsOf(CreateContactoDto, contact), []);
  for (const campo of ['nombre', 'asunto', 'mensaje', 'telefono']) assert.ok(errorsOf(CreateContactoDto, { ...contact, [campo]: '  ' }).includes(campo), campo + ' vacío');
  assert.ok(errorsOf(CreateContactoDto, { ...contact, telefono: '...' }).includes('telefono'));
  assert.ok(errorsOf(CreateContactoDto, { ...contact, telefono: 'x'.repeat(31) }).includes('telefono'));
  assert.ok(errorsOf(CreateContactoDto, { ...contact, mensaje: 'x'.repeat(5001) }).includes('mensaje'));
  assert.ok(errorsOf(CreateContactoDto, { ...contact, email: 'no-es-correo' }).includes('email'));
  const admin = { nombre: 'A', email: 'admin@example.test', password: '12345678' };
  assert.deepEqual(errorsOf(RegisterDto, admin), []);
  assert.ok(errorsOf(RegisterDto, { ...admin, nombre: ' ' }).includes('nombre'));
  assert.ok(errorsOf(RegisterDto, { ...admin, password: '1234567' }).includes('password'), 'la contraseña sigue exigiendo 8 caracteres');
  assert.ok(errorsOf(RegisterDto, { ...admin, password: 'x'.repeat(73) }).includes('password'));
});
