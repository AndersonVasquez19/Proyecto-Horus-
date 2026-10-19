import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_ROLES, ROLE_UNCERTAIN, accountStatus, accountSummary, canChangeRole, filterAccounts, parseAccounts, roleChangeWarning, roleErrorMessage, rolePayload } from '../src/panel/services/accountRoles.ts'

// «Roles y usuarios»: lectura del listado, filtros y mensajes. Datos ficticios; sin red ni navegador.
const here = path.dirname(fileURLToPath(import.meta.url))
const accounts = [
  { id: 1, nombre: 'Gerente Ficticia', email: 'gerente@example.test', activo: true, rol: 'GERENTE_GENERAL' },
  { id: 2, nombre: 'José Pendiente', email: 'jose@example.test', activo: true, rol: null },
  { id: 3, nombre: 'Coordinadora Ficticia', email: 'coord@example.test', activo: true, rol: 'COORDINADORA_INSTITUCIONAL' },
  { id: 4, nombre: 'Secretaria Inactiva', email: 'sec@example.test', activo: false, rol: null },
]

test('los tres roles son exactamente los del backend', () => {
  const roles = fs.readFileSync(path.join(here, '..', '..', 'backend', 'src', 'permissions', 'roles.ts'), 'utf8')
  assert.deepEqual([...ACCOUNT_ROLES], [...roles.match(/ADMIN_ROLES = \[([^\]]+)\]/)[1].matchAll(/'([A-Z_]+)'/g)].map(m => m[1]))
})

test('parseAccounts: forma esperada, rol desconocido como «sin rol» y cualquier otra forma como error (nunca lista vacía)', () => {
  const parsed = parseAccounts({ ok: true, users: [...accounts.slice(0, 2), { id: 9, nombre: 'Rara', email: 'r@example.test', activo: true, rol: 'ADMINISTRADOR', password: 'x' }] })
  assert.deepEqual(parsed.map(a => a.rol), ['GERENTE_GENERAL', null, null])
  assert.equal('password' in parsed[2], false, 'solo se conservan los campos previstos')
  for (const bad of [null, {}, { users: null }, { users: [{ id: '1', nombre: 'x', email: 'x', activo: true }] }, { users: [{ id: 1, nombre: 'x', email: 'x', activo: 1 }] }]) assert.equal(parseAccounts(bad), null, JSON.stringify(bad))
  assert.deepEqual(parseAccounts({ users: [] }), [])
})

test('estado: pendiente es una cuenta activa sin rol; una desactivada no está pendiente', () => {
  assert.deepEqual(accounts.map(accountStatus), ['activa', 'pendiente', 'activa', 'inactiva'])
  assert.deepEqual(accountSummary(accounts), { total: 4, pendientes: 1, gerentes: 1 })
})

test('filtros: búsqueda sin tildes ni mayúsculas por nombre o correo, por rol, pendientes y estado', () => {
  const ids = list => list.map(a => a.id)
  assert.deepEqual(ids(filterAccounts(accounts, { search: 'jose' })), [2])
  assert.deepEqual(ids(filterAccounts(accounts, { search: 'COORD@' })), [3])
  assert.deepEqual(ids(filterAccounts(accounts, { rol: 'pendientes' })), [2])
  assert.deepEqual(ids(filterAccounts(accounts, { rol: 'GERENTE_GENERAL' })), [1])
  assert.deepEqual(ids(filterAccounts(accounts, { estado: 'inactivas' })), [4])
  assert.deepEqual(ids(filterAccounts(accounts, { estado: 'activas', rol: 'SECRETARIA' })), [])
  assert.deepEqual(ids(filterAccounts(accounts, {})), [1, 2, 3, 4])
})

test('cambiar rol: nunca la propia cuenta ni una desactivada, y solo con el permiso', () => {
  assert.equal(canChangeRole(accounts[1], 1, true), true)
  assert.equal(canChangeRole(accounts[0], 1, true), false, 'propia cuenta')
  assert.equal(canChangeRole(accounts[3], 1, true), false, 'desactivada')
  assert.equal(canChangeRole(accounts[1], 1, false), false, 'sin cuentas:asignar_rol')
  assert.deepEqual(rolePayload(accounts[2], 'SECRETARIA'), { rol: 'SECRETARIA', rol_actual: 'COORDINADORA_INSTITUCIONAL' })
  assert.deepEqual(rolePayload(accounts[1], null), { rol: null, rol_actual: null })
  assert.match(roleChangeWarning(accounts[1], 'GERENTE_GENERAL'), /acceso completo/)
  assert.match(roleChangeWarning(accounts[2], null), /cuenta básica/)
  assert.match(roleChangeWarning(accounts[0], 'SECRETARIA'), /Dejará de tener acceso completo/)
})

test('errores: rechazos deliberados con su texto; 5xx, red y timeout como resultado incierto sin detalles técnicos', () => {
  const error = (status, message = 'texto del servidor') => Object.assign(new Error(message), { status })
  assert.deepEqual(roleErrorMessage(error(409, 'No puedes cambiar tu propio rol.')), { message: 'No puedes cambiar tu propio rol.', uncertain: false })
  assert.equal(roleErrorMessage(error(404, 'Cuenta no encontrada.')).message, 'Cuenta no encontrada.')
  assert.match(roleErrorMessage(error(403)).message, /no tiene permiso/)
  assert.match(roleErrorMessage(error(400, 'property x should not exist')).message, /no es válido/)
  for (const uncertain of [error(500, 'Internal server error ER_SECRET'), error(502), error(504), new TypeError('Failed to fetch'), error(200)]) {
    assert.deepEqual(roleErrorMessage(uncertain), { message: ROLE_UNCERTAIN, uncertain: true })
  }
  assert.equal(roleErrorMessage(error(409, 'x'), true).uncertain, true, 'timeout')
})
