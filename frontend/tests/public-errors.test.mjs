import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PUBLIC_ERROR_TEXTS, RETRYABLE_ERRORS, WRITE_UNCERTAIN_TEXT, classifyPublicError, classifyWriteError, publicErrorMessage, writeErrorMessage } from '../src/publicErrors.ts'

// Mismo contrato que PublicApiError: un Error con `status`.
const api = (status, message = 'Internal server error') => Object.assign(new Error(message), { status })

test('each HTTP status maps to its own kind of failure', () => {
  const table = [[400, 'badRequest'], [422, 'badRequest'], [401, 'forbidden'], [403, 'forbidden'], [404, 'notFound'], [410, 'notFound'], [408, 'timeout'], [504, 'timeout'],
    [429, 'tooMany'], [500, 'server'], [502, 'server'], [503, 'server'], [599, 'server'], [200, 'server'], [409, 'unknown'], [418, 'unknown']]
  for (const [status, kind] of table) assert.equal(classifyPublicError(api(status)), kind, 'HTTP ' + status)
})

test('network failures, timeouts and unknown errors are told apart from a missing resource', () => {
  assert.equal(classifyPublicError(new TypeError('Failed to fetch')), 'network')
  assert.equal(classifyPublicError(new TypeError('NetworkError when attempting to fetch resource.')), 'network')
  assert.equal(classifyPublicError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), 'timeout')
  assert.equal(classifyPublicError(new Error('boom'), true), 'timeout')
  assert.equal(classifyPublicError(new Error('boom')), 'unknown')
  assert.equal(classifyPublicError(undefined), 'unknown')
  assert.equal(classifyPublicError(null), 'unknown')
  assert.notEqual(classifyPublicError(new TypeError('Failed to fetch')), 'notFound', 'una red caída no es un recurso inexistente')
})

test('visitors never see the original technical text, only the fixed Spanish message', () => {
  const technical = ['Failed to fetch', 'NetworkError', 'Internal Server Error', 'Request failed', 'Cannot GET /api/cursos/9', 'PrismaClientKnownRequestError: ER_NO_SUCH_TABLE', "select * from cursos where id = '1'", 'Bad Request', 'Service Unavailable']
  for (const text of technical) for (const error of [api(400, text), api(404, text), api(500, text), api(503, text), new TypeError(text), new Error(text)]) {
    const message = publicErrorMessage(error)
    assert.ok(!message.includes(text), 'no repite «' + text + '»')
    assert.ok(Object.values(PUBLIC_ERROR_TEXTS).includes(message))
  }
  for (const message of Object.values(PUBLIC_ERROR_TEXTS)) assert.ok(!/fetch|network|internal|request|cannot|sql|prisma|error\b/i.test(message), message)
})

test('the messages are the agreed ones and only transient failures offer a retry', () => {
  assert.equal(PUBLIC_ERROR_TEXTS.network, 'No pudimos conectarnos con el servidor. Comprueba tu conexión e inténtalo nuevamente.')
  assert.equal(PUBLIC_ERROR_TEXTS.server, 'Ocurrió un problema al cargar el contenido. Inténtalo más tarde.')
  assert.equal(PUBLIC_ERROR_TEXTS.notFound, 'El contenido que buscas no está disponible.')
  assert.equal(PUBLIC_ERROR_TEXTS.unknown, 'No pudimos cargar esta información en este momento.')
  assert.deepEqual([...RETRYABLE_ERRORS].sort(), ['network', 'server', 'timeout', 'tooMany', 'unknown'])
  for (const kind of ['notFound', 'forbidden', 'badRequest']) assert.ok(!RETRYABLE_ERRORS.includes(kind), kind + ' no se reintenta')
})

test('a write with an uncertain result warns before resending and never leaks technical text', () => {
  const uncertain = [writeErrorMessage(new TypeError('Failed to fetch')), writeErrorMessage(new DOMException('x', 'AbortError'), true), writeErrorMessage(api(200, 'Unexpected token')), writeErrorMessage(api(502)), writeErrorMessage(api(504)), writeErrorMessage(api(408))]
  for (const message of uncertain) assert.equal(message, WRITE_UNCERTAIN_TEXT)
  assert.equal(classifyWriteError(api(500)).uncertain, false)
  for (const status of [400, 401, 403, 404, 422, 429, 500, 503]) {
    const message = writeErrorMessage(api(status, 'ER_NO_SUCH_TABLE Cannot POST'))
    assert.notEqual(message, WRITE_UNCERTAIN_TEXT, 'HTTP ' + status)
    assert.doesNotMatch(message, /ER_NO|Cannot|fetch|Internal/i)
  }
  assert.match(WRITE_UNCERTAIN_TEXT, /Consulta con el equipo antes de enviarla nuevamente/)
})
