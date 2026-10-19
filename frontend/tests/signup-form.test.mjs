import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PASSWORD_MAX_BYTES, signupPayload, validateSignup } from '../src/panel/services/signupForm.ts'

// Reglas del formulario de registro público. Datos ficticios; sin red ni navegador.
const valid = { nombre: 'Persona Ficticia', email: 'persona@example.test', password: 'Contraseña 1', confirmPassword: 'Contraseña 1' }

test('un formulario completo y coherente se puede enviar', () => {
  assert.equal(validateSignup(valid), null)
  assert.equal(validateSignup({ ...valid, password: '12345678', confirmPassword: '12345678' }), null, '8 caracteres es el mínimo')
  const longest = 'ñ'.repeat(PASSWORD_MAX_BYTES / 2)
  assert.equal(validateSignup({ ...valid, password: longest, confirmPassword: longest }), null, '72 bytes UTF-8 es el máximo')
})

test('cada problema señala su campo, en el orden del formulario', () => {
  const cases = [
    [{ nombre: '   ' }, 'nombre'], [{ nombre: 'n'.repeat(101) }, 'nombre'],
    [{ email: '' }, 'email'], [{ email: 'sin-arroba' }, 'email'], [{ email: 'a b@example.test' }, 'email'], [{ email: 'a'.repeat(250) + '@example.test' }, 'email'],
    [{ password: '1234567', confirmPassword: '1234567' }, 'password'],
    [{ password: 'ñ'.repeat(37), confirmPassword: 'ñ'.repeat(37) }, 'password'], // 37 caracteres, 74 bytes
    [{ confirmPassword: 'Contraseña 2' }, 'confirmPassword'],
    [{ nombre: '', email: 'mal', password: '1' }, 'nombre'],
  ]
  for (const [patch, field] of cases) {
    const problem = validateSignup({ ...valid, ...patch })
    assert.equal(problem?.field, field, JSON.stringify(patch).slice(0, 60))
    assert.ok(problem.message.length > 0)
  }
})

test('el cuerpo enviado solo contiene los campos admitidos: nunca rol ni permisos, y la contraseña tal cual', () => {
  const payload = signupPayload({ ...valid, nombre: '  Persona Ficticia ', email: ' persona@example.test ', password: ' con espacios ', confirmPassword: ' con espacios ' })
  assert.deepEqual(payload, { nombre: 'Persona Ficticia', email: 'persona@example.test', password: ' con espacios ' })
  assert.deepEqual(Object.keys(signupPayload({ ...valid, rol: 'GERENTE_GENERAL', permisos: ['cuentas:crear'] })).sort(), ['email', 'nombre', 'password'])
  assert.equal(signupPayload(valid, 'https://spam.example.test').website, 'https://spam.example.test', 'el campo trampa solo viaja si se rellenó')
})
