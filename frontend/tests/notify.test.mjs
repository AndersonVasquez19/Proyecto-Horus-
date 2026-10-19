import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotifier, cleanNotifyText, NOTIFY_DURATION, MAX_NOTIFY_LENGTH } from '../src/panel/services/notifyCore.ts'

// Motor falso: registra lo que Sonner recibiría. Un id repetido REEMPLAZA el aviso (igual que Sonner), no lo apila.
function fixture() {
  const visible = new Map(), calls = []
  const engine = {
    show: (kind, message, options) => { calls.push({ kind, message, ...options }); visible.set(options.id, { kind, message, ...options }) },
    dismiss: id => { if (id === undefined) visible.clear(); else visible.delete(id) },
  }
  return { notify: createNotifier(engine), visible, calls }
}

test('éxito, error y advertencia usan su tipo y duración; el éxito caduca y el resultado incierto no', () => {
  const { notify, calls } = fixture()
  notify.success('Guardado.'); notify.error('No se pudo guardar.'); notify.warning('Revisa los datos.'); notify.info('Información.'); notify.uncertain('No pudimos confirmar el guardado.')
  assert.deepEqual(calls.map(c => c.kind), ['success', 'error', 'warning', 'info', 'warning'])
  assert.equal(calls[0].duration, NOTIFY_DURATION.success)
  assert.ok(Number.isFinite(calls[0].duration) && calls[0].duration < calls[1].duration)
  assert.equal(calls[4].duration, Infinity, 'el resultado incierto no caduca solo')
  assert.ok(calls[4].id.startsWith('uncertain:'))
})

test('peticiones concurrentes o dobles clics con el mismo aviso no apilan duplicados', () => {
  const { notify, visible, calls } = fixture()
  for (let i = 0; i < 5; i++) notify.success('Cambios guardados correctamente.')
  assert.equal(calls.length, 5)
  assert.equal(visible.size, 1, 'un solo aviso visible')
  notify.success('Cambios guardados correctamente.'); notify.error('Cambios guardados correctamente.')
  assert.equal(visible.size, 2, 'el mismo texto con otro tipo es otro aviso (un error no se oculta tras un éxito)')
})

test('operación en curso: el mismo id se actualiza de «cargando» a éxito o a error sin dejar dos avisos', () => {
  const { notify, visible } = fixture()
  notify.loading('Exportando…', { id: 'export' })
  assert.equal(visible.get('export').kind, 'loading'); assert.equal(visible.get('export').duration, Infinity)
  notify.success('Se exportaron 12 consultas.', { id: 'export' })
  assert.equal(visible.size, 1); assert.equal(visible.get('export').kind, 'success')
  notify.loading('Exportando…', { id: 'export' }); notify.error('No se pudo exportar.', { id: 'export' })
  assert.equal(visible.size, 1); assert.equal(visible.get('export').kind, 'error')
  notify.dismiss('export'); assert.equal(visible.size, 0)
})

test('los avisos vacíos no se muestran y el texto se normaliza y se acota', () => {
  const { notify, calls } = fixture()
  assert.equal(notify.success(''), ''); assert.equal(notify.error('   \n  '), ''); assert.equal(calls.length, 0)
  assert.equal(cleanNotifyText('  Dos\n\n líneas   y   espacios  '), 'Dos líneas y espacios')
  const long = cleanNotifyText('x'.repeat(1000)); assert.equal(long.length, MAX_NOTIFY_LENGTH); assert.ok(long.endsWith('…'))
  notify.success('Hecho', { description: 'y'.repeat(1000) }); assert.equal(calls[0].description.length, MAX_NOTIFY_LENGTH)
})

test('dismiss sin id retira todos los avisos (cierre de sesión o cambio de cuenta)', () => {
  const { notify, visible } = fixture()
  notify.success('A'); notify.warning('B'); notify.uncertain('C')
  assert.equal(visible.size, 3); notify.dismiss(); assert.equal(visible.size, 0)
})
