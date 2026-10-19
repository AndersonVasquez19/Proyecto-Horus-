import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveContentSource } from '../config/api-config.js'
import { CONTENT_RESOURCES, contentResource, publicBaseFor } from '../src/contentSource.ts'

const NEST = '/api'
const LARAVEL = 'https://academico.example.com/api/contenido'

test('sin variables el contenido sigue en NestJS', () => {
  for (const provider of [undefined, '', '  ', 'nestjs', 'NestJS']) {
    assert.deepEqual(resolveContentSource(provider, undefined), { provider: 'nestjs', base: '' })
  }
  assert.deepEqual(resolveContentSource('nestjs', LARAVEL), { provider: 'nestjs', base: '' }, 'la URL sola no activa Laravel')
})

test('laravel exige una URL absoluta terminada en /api/contenido y HTTPS público en Vercel', () => {
  assert.deepEqual(resolveContentSource('laravel', LARAVEL + '/'), { provider: 'laravel', base: LARAVEL })
  assert.deepEqual(resolveContentSource('laravel', 'http://127.0.0.1:8000/api/contenido'), { provider: 'laravel', base: 'http://127.0.0.1:8000/api/contenido' })
  for (const value of [undefined, '', '/api/contenido', 'https://academico.example.com/api', 'https://academico.example.com/api/contenido?x=1',
    'https://u:p@academico.example.com/api/contenido', 'ftp://academico.example.com/api/contenido', 'javascript:alert(1)']) {
    assert.throws(() => resolveContentSource('laravel', value), undefined, String(value))
  }
  assert.throws(() => resolveContentSource('laravel', 'http://academico.example.com/api/contenido', true))
  assert.throws(() => resolveContentSource('laravel', 'https://localhost/api/contenido', true))
  assert.equal(resolveContentSource('laravel', LARAVEL, true).base, LARAVEL)
  assert.throws(() => resolveContentSource('otro', LARAVEL))
})

test('con NestJS todas las peticiones usan la API habitual', () => {
  for (const path of ['cursos?tipo=curso', 'convenios/3', 'settings', 'contacto', 'chatbot/consulta']) {
    assert.equal(publicBaseFor(path, undefined, NEST, 'nestjs', ''), NEST)
    assert.equal(publicBaseFor(path, 'GET', NEST, 'nestjs', LARAVEL), NEST)
  }
})

test('con Laravel solo las lecturas de los recursos de contenido cambian de origen', () => {
  for (const path of ['cursos?' + new URLSearchParams({ tipo: 'curso', page: '1' }), 'cursos/12', 'servicios?categoria=soporte', 'preguntas-frecuentes?page=1',
    'galeria?page=1&limit=4', 'convenios/3', 'settings']) {
    assert.equal(publicBaseFor(path, undefined, NEST, 'laravel', LARAVEL), LARAVEL, path)
    assert.equal(publicBaseFor(path, 'get', NEST, 'laravel', LARAVEL), LARAVEL, path)
  }
  // Escrituras, formularios públicos, sesión y recursos no migrados: siempre NestJS.
  for (const [path, method] of [['contacto', 'POST'], ['newsletter', 'POST'], ['newsletter/unsubscribe', 'POST'], ['reclamaciones', 'POST'],
    ['cursos', 'POST'], ['admin/login', 'POST'], ['admin/me', 'GET'], ['uploads/x.jpg', 'GET'], ['chatbot/consulta', 'GET'], ['cursos-extra', 'GET']]) {
    assert.equal(publicBaseFor(path, method, NEST, 'laravel', LARAVEL), NEST, method + ' ' + path)
  }
  // Configuración incompleta: no se cambia el origen.
  assert.equal(publicBaseFor('cursos', undefined, NEST, 'laravel', ''), NEST)
})

test('identifica el recurso aunque traiga barra inicial, consulta o fragmento', () => {
  assert.equal(contentResource('/cursos/1'), 'cursos')
  assert.equal(contentResource('preguntas-frecuentes?search=x'), 'preguntas-frecuentes')
  assert.equal(contentResource('galeria#x'), 'galeria')
  assert.deepEqual([...CONTENT_RESOURCES], ['cursos', 'servicios', 'preguntas-frecuentes', 'galeria', 'convenios', 'settings'])
})
