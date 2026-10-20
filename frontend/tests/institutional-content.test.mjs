import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('fuente institucional local: listas, filtros, detalle, paginación e imágenes sin backend ni sesión', async () => {
  const entry = new URL('../src/institutional/read.ts', import.meta.url)
  assert.ok(fs.existsSync(entry), 'falta el adaptador institucional local')
  const { createInstitutionalReader } = await import(entry.href)
  const { institutionalCatalog } = await import('../src/institutional/catalog.ts')
  const read = createInstitutionalReader(institutionalCatalog)
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('La fuente estática no debe usar red') }
  try {
    const gallery = read('galeria?page=1&limit=100')
    assert.equal(gallery.pagination.total, 61)
    assert.equal(gallery.items.length, 61)
    assert.ok(gallery.categorias.includes('capacitaciones'), 'categorías para los filtros de galería')
    for (const photo of gallery.items) assert.ok(fs.existsSync(new URL('../public' + photo.imagen_url, import.meta.url)), photo.imagen_url)
    const first = read('servicios?categoria=cableado&page=1&limit=2')
    assert.equal(first.items.length, 2)
    assert.equal(read('servicios?search=zzzz-sin-coincidencias').items.length, 0)
    assert.ok(read('servicios?search=optica').items.some(item => item.titulo.includes('Óptica')))
    assert.ok(first.items.every(item => item.categoria === 'cableado'))
    assert.notEqual(first.items[0].id, read('servicios?categoria=cableado&page=2&limit=2').items[0].id)
    assert.equal(read('servicios/' + first.items[0].id).item.slug, first.items[0].slug)
    assert.equal(read('servicios/' + first.items[0].slug).item.id, first.items[0].id)
    assert.equal(read('cursos?tipo=capacitacion&page=1&limit=100').pagination.total, 4)
    assert.equal(read('cursos?tipo=curso&page=1&limit=100').items.length, 0, 'sin cursos inventados')
    assert.equal(read('preguntas-frecuentes?page=1').items.length, 0, 'sin FAQ inventadas')
    const convenio = read('convenios?page=1&limit=10').items[0]
    assert.equal(read('convenios/' + convenio.id).item.nombre, convenio.nombre)
    assert.deepEqual(read('convenios/' + convenio.id).item.fotos, [])
    const hidden = createInstitutionalReader({ ...institutionalCatalog, convenios: institutionalCatalog.convenios.map(item => ({ ...item, visible: false })) })
    assert.equal(hidden('convenios?visible=false').items.length, 0)
    assert.throws(() => hidden('convenios/' + convenio.id), e => e.status === 404)
    assert.equal(read('settings').settings.empresa_nombre, 'Horus Group SRL')
    for (const path of ['admin/users', 'contacto', 'chatbot/message', 'newsletter', 'reclamaciones', 'https://example.test/servicios']) assert.throws(() => read(path), e => e.status === 404, path)
    assert.throws(() => read('servicios/inexistente'), e => e.status === 404)
    assert.throws(() => read('galeria?page=0'), e => e.status === 400)
    assert.throws(() => read('servicios?page=1&limit=1000'), e => e.status === 400)
  } finally { globalThis.fetch = originalFetch }
})
