import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeAdminReturn } from '../src/panel/context/returnPath.ts'

test('internal panel routes are kept, with only harmless navigation parameters', () => {
  assert.equal(safeAdminReturn('/admin/dashboard'), '/admin/dashboard')
  assert.equal(safeAdminReturn('/admin/messages'), '/admin/messages')
  assert.equal(safeAdminReturn('/admin/dashboard?section=cursos&seccion=capacitaciones&vista=tabla'), '/admin/dashboard?section=cursos&seccion=capacitaciones&vista=tabla')
  assert.equal(safeAdminReturn('/admin/messages?estado=nuevo&id=12'), '/admin/messages?estado=nuevo&id=12')
})

test('sensitive or action parameters are dropped', () => {
  assert.equal(safeAdminReturn('/admin/dashboard?section=cotizaciones&contacto=7&crear=1&token=abc&email=a%40b.c'), '/admin/dashboard?section=cotizaciones')
  assert.equal(safeAdminReturn('/admin/dashboard?section=x&redirect=https://evil.test'), '/admin/dashboard?section=x')
  assert.equal(safeAdminReturn('/admin/dashboard?section=https://evil.test'), '/admin/dashboard', 'un valor con forma de URL no se conserva')
})

test('external, protocol-relative, auth and unknown routes fall back to null', () => {
  for (const value of ['https://evil.test/admin/dashboard', 'http://evil.test', '//evil.test/admin/dashboard', '/\\evil.test', '\\\\evil.test', 'javascript:alert(1)',
    '/admin/login', '/admin/register', '/admin/forgot-password', '/admin/reset-password?token=abc', '/admin/', '/admin', '/admin/dashboard/', '/admin/%2e%2e/login',
    '/educacion/cursos', '/', '', 'admin/dashboard', '/admin/dashboard\n/x', '/admin/dashboard' + 'a'.repeat(400), null, undefined, 42, {}]) {
    assert.equal(safeAdminReturn(value), null, String(value).slice(0, 40))
  }
})
