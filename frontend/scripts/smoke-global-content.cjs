// Comprueba sesiones de navegador aisladas; los datos HTTP son fixtures, nunca la base real.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path')
const assert = require('node:assert/strict'), { spawn } = require('node:child_process')
const ts = require('typescript')
const root = path.resolve(__dirname, '../dist')
const browser = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const image = '/api/uploads/00000000-0000-4000-8000-000000000000.png'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQxQAAAAASUVORK5CYII=', 'base64')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const requests = [], users = { 'fixture-token-a': { id: 1, nombre: 'Admin A', email: 'a@example.com' }, 'fixture-token-b': { id: 2, nombre: 'Admin B', email: 'b@example.com' } }
let convenio = null
const catalog = {
  cursos: [{ id: 1, titulo: 'Curso global de prueba', slug: 'curso-global', tipo: 'curso', descripcion: 'Descripción global', modalidad: 'virtual', duracion: '20 horas', estado: 'publicado', imagen_url: 'http://localhost:5173' + image }],
  servicios: [{ id: 1, titulo: 'Servicio global de prueba', slug: 'servicio-global', descripcion: 'Descripción global', categoria: 'cableado', estado: 'publicado', imagen_url: 'http://localhost:5173' + image }],
  galeria: [{ id: 1, titulo: 'Foto global de prueba', descripcion: 'Descripción global', categoria: 'general', activo: true, imagen_url: 'http://localhost:5173' + image }],
  'preguntas-frecuentes': [{ id: 1, pregunta: 'Pregunta global de prueba', respuesta: 'Respuesta global', categoria: 'general', estado: 'publicado' }],
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
    const token = req.headers.authorization?.replace(/^Bearer /, ''), user = users[token]
    if (route === image) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png) }
    if (route.startsWith('/api/')) {
      requests.push({ route, method: req.method, user: user?.id ?? null })
      let raw = ''; for await (const chunk of req) raw += chunk
      if (route === '/api/admin/login') {
        const body = JSON.parse(raw), token = body.email === 'a@example.com' ? 'fixture-token-a' : body.email === 'b@example.com' ? 'fixture-token-b' : null
        return token ? json({ ok: true, token }) : json({ message: 'Credenciales de prueba inválidas' }, 401)
      }
      if (route.startsWith('/api/admin/') && !user) return json({ message: 'Sin sesión' }, 401)
      if (route === '/api/admin/me') return json({ ok: true, user })
      if (route === '/api/admin/uploads') return json({ ok: true, path: image.slice(4) }, 201)
      if (route === '/api/settings') return json({ ok: true, settings: { empresa_nombre: 'Empresa global de prueba' } })
      if (route === '/api/admin/stats') return json({ ok: true, stats: { catalogo: {}, mensajes: { total: 0, nuevos: 0, enProceso: 0 }, reclamaciones: { total: 0 } }, actividadReciente: { mensajes: [], reclamaciones: [] } })
      if (route.startsWith('/api/admin/convenios') && req.method !== 'GET') {
        const body = JSON.parse(raw)
        convenio = { id: 1, fotos: [], ...convenio, ...body }
        return json({ ok: true, item: convenio }, req.method === 'POST' ? 201 : 200)
      }
      if (route === '/api/admin/convenios/1' || route === '/api/convenios/1') return json({ ok: true, item: convenio })
      const resource = route.replace(/^\/api\/(?:admin\/)?/, '')
      const rows = resource === 'convenios' ? convenio ? [convenio] : [] : catalog[resource] || []
      return json({ ok: true, items: rows, pagination: { page: 1, total: rows.length, pages: rows.length ? 1 : 0 }, categorias: ['general'] })
    }
    let file = path.resolve(root, '.' + decodeURIComponent(route))
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream')
    res.end(fs.readFileSync(file))
  } catch { res.writeHead(500); res.end('Fixture failure') }
})
function testImages() {
  const source = fs.readFileSync(path.join(__dirname, '../src/contentImages.ts'), 'utf8')
  const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const base of ['/api', 'https://api.example.com/api']) {
    const exports = {}
    new Function('require', 'exports', emitted)(name => { assert.equal(name, './apiBase'); return { API_BASE: base } }, exports)
    const target = base + image.slice(4)
    for (const value of [image, 'http://localhost:5173' + image, 'http://127.0.0.1:3000' + image, 'http://[::1]:3000' + image]) assert.equal(exports.resolveContentImage(value), target)
    for (const value of ['https://images.example.com/logo.png', '/site-original/logo.png', 'http://localhost:5173/other.png', 'https://external.example.com' + image]) assert.equal(exports.resolveContentImage(value), value)
    const body = { item: { nombre: image, logo_url: 'http://localhost:5173' + image, fotos: [{ imagen_url: image }] }, mensaje: image }
    const resolved = exports.resolveContentImages(body)
    assert.equal(resolved.item.logo_url, target); assert.equal(resolved.item.fotos[0].imagen_url, target)
    assert.equal(resolved.item.nombre, image); assert.equal(resolved.mensaje, image)
    assert.equal(body.item.logo_url, 'http://localhost:5173' + image, 'No modifica el objeto de respuesta original')
  }
  console.log('Imágenes: proxy local, API remota, URLs heredadas de localhost y enlaces externos: OK.')
}
function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = []
  let sequence = 0
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value || arg.description).join(' '))
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id)
      message.error ? request?.reject(new Error(message.error.message)) : request?.resolve(message.result)
    }
  }
  const ready = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + expression)
    return result.result.value
  }
  const wait = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(100) }
    throw new Error('No se cumplió: ' + expression)
  }
  return { socket, ready, send, evaluate, wait, errors }
}
async function main() {
  testImages()
  assert.ok(fs.existsSync(browser)); assert.ok(fs.existsSync(path.join(root, 'index.html')))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const reserve = http.createServer()
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve))
  const port = reserve.address().port
  await new Promise(resolve => reserve.close(resolve))
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-global-ui-'), pages = []
  let child, browserConnection, cleanup
  try {
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' })
    cleanup = require('./smoke-cleanup.cjs')(child, profile, server)
    let version
    for (let i = 0; i < 100 && !version; i++) { await sleep(100); try { version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()) } catch {} }
    assert.ok(version?.webSocketDebuggerUrl)
    browserConnection = connect(version.webSocketDebuggerUrl); await browserConnection.ready
    const newPage = async blocked => {
      const { browserContextId } = await browserConnection.send('Target.createBrowserContext')
      const { targetId } = await browserConnection.send('Target.createTarget', { url: 'about:blank', browserContextId })
      const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())
      const page = connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl); await page.ready
      pages.push(page); await page.send('Page.enable'); await page.send('Runtime.enable')
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
      if (blocked) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'for(const key of ["localStorage","sessionStorage"])Object.defineProperty(window,key,{get(){throw new DOMException("Storage blocked for test","SecurityError")}});window.BroadcastChannel=class{constructor(){throw new Error("BroadcastChannel blocked for test")}};' })
      return page
    }
    const navigate = async (page, route) => { await page.send('Page.navigate', { url: origin + route }); await page.wait('document.readyState==="complete"') }
    const fill = async (page, selector, values) => {
      await page.evaluate('(()=>{for(const [name,value] of Object.entries(' + JSON.stringify(values) + ')){const input=document.querySelector(' + JSON.stringify(selector) + '+" [name="+name+"]"),proto=input.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}})()')
      await sleep(50)
    }
    const login = async (page, email) => {
      await navigate(page, '/admin/login'); await page.wait('!!document.getElementById("email")')
      assert.equal(await page.evaluate('localStorage.getItem("horus-admin-token")'), null)
      await fill(page, '.admin-auth__form', { email, password: 'Fixture-password-123!' })
      await page.evaluate('document.querySelector(".admin-auth__form").requestSubmit()')
      await page.wait('location.pathname==="/admin/dashboard"')
      await navigate(page, '/admin/dashboard?section=convenios'); await page.wait('!!document.querySelector("[data-panel-editorial-retired]")')
    }
    const first = await newPage(false)
    await login(first, 'a@example.com')
    const second = await newPage(false)
    await login(second, 'b@example.com')
    for (const page of [first, second]) {
      assert.equal(await page.evaluate('!!document.querySelector("main form, .hp-convenios")'), false)
      assert.equal(await page.evaluate('document.querySelector("main").textContent.includes("se retiró del panel")'), true)
    }
    assert.equal(requests.some(r => r.route.startsWith('/api/admin/convenios')), false, 'Sin solicitudes al gestor editorial desde ninguna sesión')
    convenio = { id: 1, nombre: 'Convenio conservado', descripcion_corta: 'Descripción pública de prueba', descripcion_completa: '', informacion_adicional: '', sigla: 'CP', logo_url: null, orden: 1, visible: true, fotos: [] }
    console.log('Panel: dos sesiones aisladas sin gestores ni solicitudes editoriales: OK.')
    // El visitante lee el contenido institucional versionado (src/institutional): ninguna petición editorial a la API.
    const editorial = /^\/api\/(cursos|servicios|galeria|convenios|preguntas-frecuentes|settings)(\/|\?|$)/
    const before = requests.filter(r => editorial.test(r.route)).length
    const visitor = await newPage(true)
    await navigate(visitor, '/')
    await visitor.wait('document.querySelector("[data-agreement-toggle]")?.textContent.includes("Colegio Regional de Licenciados")')
    await visitor.evaluate('document.querySelector("[data-agreement-toggle]").scrollIntoView()')
    await visitor.wait('document.querySelector("[data-agreement-toggle] img")?.naturalWidth > 0')
    assert.match(await visitor.evaluate('document.querySelector("[data-agreement-toggle] img").getAttribute("src")'), /^\/contenido\/[a-f0-9-]{36}\.(jpg|png|webp)$/)
    assert.equal(await visitor.evaluate('!!document.querySelector("[role=alert]")'), false)
    for (const [route, text] of [['/educacion/capacitaciones', 'Capacitaciones Empresariales'], ['/tecnologias/cableado-estructurado', 'Cableado Básico'], ['/galeria', 'Nuestro trabajo'], ['/preguntas-frecuentes', 'Preguntas']]) {
      await navigate(visitor, route); await visitor.wait('document.body.innerText.includes(' + JSON.stringify(text) + ')')
      assert.equal(await visitor.evaluate('!!document.querySelector("[role=alert]")'), false, route)
    }
    assert.equal(requests.filter(r => editorial.test(r.route)).length, before, 'El visitante no pide contenido editorial a la API')
    for (const page of pages) assert.deepEqual(page.errors, [], 'Sin errores JavaScript en el flujo')
    console.log('Visitante: Home, cursos, servicios, galería y FAQ sin sesión, con storage y BroadcastChannel bloqueados: OK.')
  } finally {
    if (browserConnection) browserConnection.socket.close()
    pages.forEach(page => page.socket.close()); cleanup?.()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close() })
