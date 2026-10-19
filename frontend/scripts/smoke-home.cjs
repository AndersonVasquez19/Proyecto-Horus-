// Revisión de Home con fixtures HTTP y Edge; no usa MySQL, SMTP ni cuentas reales.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '../dist')
const browser = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const screenshots = process.env.SMOKE_SCREENSHOTS
const settings = {
  empresa_nombre: 'Empresa de prueba', ruc: '00000000000',
  direccion: 'Dirección de prueba 123', telefono_principal: '+51 900 000 001',
  horario_atencion: 'Lunes a viernes: 09:00–13:00\n15:00–18:00',
  whatsapp: '51900000001', email_contacto: 'contacto@example.com', facebook_url: 'https://example.com/facebook',
}

const fixturePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQxQAAAAASUVORK5CYII=', 'base64')
const convenioFixtures = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1, nombre: 'Entidad de prueba ' + (i + 1), sigla: 'TEST ' + (i + 1),
  descripcion_corta: 'Descripción corta de la entidad de prueba ' + (i + 1),
  descripcion_completa: i === 1 ? 'Descripción completa de prueba.\n' + 'Información extensa '.repeat(100) : '',
  informacion_adicional: i === 1 ? 'Información adicional de prueba.' : '', orden: i, visible: true,
  logo_url: i === 0 ? null : i === 1 ? '/fixture-broken.png' : '/fixture-photo.png',
  fotos: i >= 2 ? Array.from({ length: i === 2 ? 1 : 2 }, (_, j) => ({
    id: i * 10 + j, convenio_id: i + 1, imagen_url: '/fixture-photo.png?photo=' + i + '-' + j, orden: j, createdAt: '2026-10-02T00:00:00Z',
  })) : [],
}))
let convenioSequence = 100, photoSequence = 1000, uploadCount = 0, convenioSaveFailure = false, convenioSaveCount = 0, conveniosFailure = false, convenioDetailFailure = false
let convenioDetailDelay = 0
const convenioRequests = []

const courseRequests = []
let settingsRequests = 0, settingsSaves = 0, chatRequests = 0, settingsFailure = false
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }

    if (route === '/fixture-photo.png' || route.startsWith('/api/uploads/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(fixturePng)
    }
    if (route === '/fixture-portrait.svg' || route === '/fixture-landscape.svg') {
      const portrait = route.includes('portrait')
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="' + (portrait ? 240 : 640) + '" height="' + (portrait ? 480 : 360) + '"><rect width="100%" height="100%" fill="#1e4976"/><circle cx="120" cy="160" r="80" fill="#c9a961"/></svg>')
    }
    if (route === '/fixture-broken.png') { res.writeHead(404); return res.end() }
    if (route === '/api/admin/uploads') {
      let raw = ''; for await (const chunk of req) raw += chunk
      uploadCount++
      await new Promise(resolve => setTimeout(resolve, 150))
      if (raw.includes('filename=\"failure.png\"')) return json({ message: 'Fallo aislado de esta fotografía.' }, 503)
      if (raw.includes('filename=\"expired-association.png\"')) return json({ ok: true, path: '/uploads/session-expired.png' })
      return json({ ok: true, path: '/uploads/00000000-0000-0000-0000-' + String(uploadCount).padStart(12, '0') + '.png' })
    }
    if (/^\/api\/(?:admin\/)?convenios(?:\/|$)/.test(route)) {
      const adminRoute = route.startsWith('/api/admin/')
      if (adminRoute && !req.headers.authorization) return json({ message: 'Sin sesión' }, 401)
      const segments = route.replace(/^\/api\/(?:admin\/)?convenios\/?/, '').split('/').filter(Boolean)
      const id = segments.length ? Number(segments[0]) : null
      const item = convenioFixtures.find(row => row.id === id && (adminRoute || row.visible))
      if (req.method === 'GET') {
        convenioRequests.push(route + url.search)
        if (!adminRoute && ((id === null && conveniosFailure) || (id !== null && convenioDetailFailure))) return json({ message: 'Fallo aislado de convenios' }, 503)
        if (id !== null && !adminRoute && convenioDetailDelay) await new Promise(resolve => setTimeout(resolve, convenioDetailDelay))
        if (id !== null) return item ? json({ ok: true, item: { ...item, fotos: [...item.fotos].sort((a, b) => a.orden - b.orden || a.id - b.id) } }) : json({ message: 'Convenio no encontrado.' }, 404)
        const search = (url.searchParams.get('search') || '').toLowerCase(), estado = url.searchParams.get('estado')
        const all = convenioFixtures.filter(row => (adminRoute || row.visible) && (!adminRoute || !estado || row.visible === (estado === 'visible')) && row.nombre.toLowerCase().includes(search))
          .sort((a, b) => a.orden - b.orden || a.id - b.id)
        const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20)
        return json({ ok: true, items: all.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: all.length, pages: Math.ceil(all.length / limit) } })
      }
      let raw = ''; for await (const chunk of req) raw += chunk
      const body = raw ? JSON.parse(raw) : {}
      if (!adminRoute) return json({ message: 'No permitido' }, 405)
      if ((req.method === 'POST' && id === null) || (req.method === 'PUT' && segments.length === 1)) {
        convenioSaveCount++
        await new Promise(resolve => setTimeout(resolve, 150))
        if (convenioSaveFailure) return json({ message: 'Fallo aislado al guardar; los datos no se modificaron.' }, 503)
      }
      if (id === null && req.method === 'POST') {
        const created = { id: ++convenioSequence, ...body, fotos: [] }; convenioFixtures.push(created)
        return json({ ok: true, item: created }, 201)
      }
      if (!item) return json({ message: 'Convenio no encontrado.' }, 404)
      if (segments[1] === 'fotos') {
        if (segments[2] === 'orden') { for (const foto of body.fotos) Object.assign(item.fotos.find(f => f.id === foto.id), { orden: foto.orden }); return json({ ok: true }) }
        if (req.method === 'POST' && body.imagen_url.includes('/uploads/session-expired.png')) return json({ message: 'Sesión de prueba expirada.' }, 401)
        if (req.method === 'POST') { const foto = { id: ++photoSequence, convenio_id: id, ...body, createdAt: '2026-10-02T00:00:00Z' }; item.fotos.push(foto); return json({ ok: true, item: foto }, 201) }
        const photoId = Number(segments[2])
        if (req.method === 'DELETE') { item.fotos = item.fotos.filter(f => f.id !== photoId); return json({ ok: true }) }
        Object.assign(item.fotos.find(f => f.id === photoId), body); return json({ ok: true })
      }
      if (req.method === 'DELETE') { convenioFixtures.splice(convenioFixtures.indexOf(item), 1); return json({ ok: true }) }
      Object.assign(item, body); return json({ ok: true, item })
    }
    if (route === '/api/settings') {
      settingsRequests++
      return settingsFailure ? json({ message: 'Fallo aislado de prueba' }, 503) : json({ ok: true, settings })
    }
    if (route === '/api/admin/me') return json({ ok: true, user: { id: 1, nombre: 'Administrador de prueba', email: 'admin@example.com' } })
    if (route === '/api/admin/settings') {
      if (req.method === 'PUT') {
        let body = ''
        for await (const chunk of req) body += chunk
        Object.assign(settings, JSON.parse(body).ajustes)
        settingsSaves++
        return json({ ok: true, mensaje: 'Ajustes guardados correctamente.' })
      }
      return json({ ok: true, settings: Object.entries(settings).map(([clave, valor]) => ({ clave, valor, descripcion: clave, grupo: 'general' })) })
    }
    if (route === '/api/chatbot/message') {
      chatRequests++
      return json({ ok: true, answer: 'Respuesta de prueba del asistente.', sources: [], mode: 'catalogo' })
    }
    if (route === '/api/cursos') {
      const tipo = url.searchParams.get('tipo'), page = Number(url.searchParams.get('page') || 1)
      courseRequests.push(url.search)
      const title = (tipo === 'capacitacion' ? 'Capacitacion' : 'Curso') + ' de prueba pagina ' + page
      return json({ ok: true, items: [{ id: (tipo === 'capacitacion' ? 200 : 100) + page,
        titulo: title, descripcion: 'Contenido aislado de prueba.', tipo: tipo || 'curso',
        modalidad: 'presencial', duracion: '12 horas', fecha_inicio: null, imagen_url: null, temario: null,
      }], pagination: { page, limit: 12, total: 13, pages: 2 } })
    }
    if (route.startsWith('/api/')) return json({ ok: true, items: [], pagination: { page: 1, limit: 12, total: 0, pages: 0 } })
    let filename = path.resolve(root, '.' + decodeURIComponent(route))
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(root, 'index.html')
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' })
    res.end(fs.readFileSync(filename))
  } catch { res.writeHead(500); res.end('Fixture failure') }
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  assert.ok(fs.existsSync(browser), 'Configura SMOKE_BROWSER con Edge/Chromium.')
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Compila frontend antes de la revisión.')
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const reserve = http.createServer()
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve))
  const port = reserve.address().port
  await new Promise(resolve => reserve.close(resolve))
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-home-ui-')
  let child, connection, cleanup
  function connect(socketUrl) {
    const socket = new WebSocket(socketUrl), pending = new Map()
    const exceptions = []
    let sequence = 0
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text)
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') exceptions.push(message.params.args.map(arg => arg.value || arg.description || '').join(' '))
      if (message.id) {
        const request = pending.get(message.id)
        pending.delete(message.id)
        message.error ? request?.reject(new Error(message.error.message)) : request?.resolve(message.result)
      }
    }
    const ready = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + expression)
      return result.result.value
    }
    const wait = async expression => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(expression)) return
        await sleep(100)
      }
      throw new Error('No se cumplió: ' + expression)
    }
    return { socket, ready, send, evaluate, wait, exceptions }
  }
  try {
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' })
    cleanup = require('./smoke-cleanup.cjs')(child, profile, server)
    let target
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      await sleep(100)
      try { target = await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' }).then(response => response.json()) } catch {}
    }
    assert.ok(target?.webSocketDebuggerUrl, 'No se pudo iniciar el navegador.')
    connection = connect(target.webSocketDebuggerUrl)
    await connection.ready
    const { send, evaluate, wait } = connection
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Page.bringToFront')
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__homeWelcomeReview = { appearances: 0, start: null, end: null, duration: null }\nlet welcomeVisible = false\nnew MutationObserver(() => {\n  const element = document.querySelector('.home-welcome')\n  const record = window.__homeWelcomeReview\n  if (element && !welcomeVisible) {\n    record.appearances++\n    record.start = performance.now()\n    const style = getComputedStyle(element)\n    record.heroPaused = getComputedStyle(document.querySelector('#home-title')).animationPlayState\n    record.pointerEvents = style.pointerEvents\n    record.animation = style.animationName\n    record.bodyOverflow = document.body.style.overflow\n    record.greeting = element.textContent\n    record.bounds = { width: element.getBoundingClientRect().width, viewport: innerWidth }\n    welcomeVisible = true\n  } else if (!element && welcomeVisible) {\n    record.end = performance.now()\n    record.heroClock = document.querySelector('#home-title').getAnimations()[0]?.currentTime ?? 0\n    record.duration = record.end - record.start\n    welcomeVisible = false\n  }\n}).observe(document, { childList: true, subtree: true })\n" })
    const navigate = async route => {
      await send('Page.navigate', { url: origin + route })
      await wait('document.readyState === "complete"')
      await sleep(250)
    }
    const viewport = (width, height = 1000) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
    const key = key => send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 9, nativeVirtualKeyCode: key === 'Escape' ? 27 : 9 })
    const press = async (value, shift = false) => {
      const codes = { Enter: 13, Space: 32, Tab: 9, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }
      const params = { key: value === 'Space' ? ' ' : value, code: value, windowsVirtualKeyCode: codes[value], nativeVirtualKeyCode: codes[value], modifiers: shift ? 8 : 0 }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(value === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : value === 'Space' ? { text: ' ', unmodifiedText: ' ' } : {}) })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
    }
    const capture = async (name, selector) => {
      if (!screenshots) return
      await evaluate('document.querySelector(' + JSON.stringify(selector) + ').scrollIntoView({block:"start",behavior:"instant"})')
      await sleep(1100)
      const result = await send('Page.captureScreenshot', { format: 'png' })
      fs.mkdirSync(screenshots, { recursive: true })
      fs.writeFileSync(path.join(screenshots, name + '.png'), Buffer.from(result.data, 'base64'))
    }

    const assertSinglePageScroll = async () => {
      const scroll = await evaluate('(()=>{const roots=["body","#root","main",".home-layout",".home-page"].map(selector=>{const element=document.querySelector(selector),before=element.scrollTop;element.scrollTop=1;const innerScroll=element.scrollTop;element.scrollTop=before;return {selector,innerScroll}});return {document:document.scrollingElement===document.documentElement,range:document.scrollingElement.scrollHeight-innerHeight,roots}})()')
      assert.equal(scroll.document, true, 'El scroll pertenece al documento.')
      assert.ok(scroll.range > 0, 'El Home completo conserva desplazamiento vertical.')
      assert.deepEqual(scroll.roots.filter(root => root.innerScroll > 0), [], 'Los contenedores principales no crean un segundo scroll.')
    }

    await viewport(1440)
    await navigate('/')
    await wait('typeof window.__homeWelcomeReview?.end === "number"')
    const welcome = await evaluate('window.__homeWelcomeReview')
    assert.equal(welcome.appearances, 1, 'Una bienvenida al abrir Home inicialmente.')
    assert.equal(welcome.heroPaused, 'paused', 'Hero detenido durante la bienvenida.')
    assert.ok(welcome.heroClock < 100, 'Hero comienza al terminar la bienvenida.')
    assert.ok(welcome.duration >= 300 && welcome.duration < 1500, 'La bienvenida debe ser breve: ' + welcome.duration)
    assert.equal(welcome.pointerEvents, 'none', 'La bienvenida no intercepta la interacción.')
    assert.equal(welcome.bodyOverflow, '', 'La bienvenida no bloquea scroll.')
    assert.equal(welcome.greeting.includes('Te da la bienvenida'), true)
    assert.equal(welcome.bounds.width <= welcome.bounds.viewport, true)
    console.log('Home: bienvenida inicial breve, sin bloquear interacción ni scroll: OK.')
    await wait('document.querySelector(".home-loc-items").textContent.includes("Dirección de prueba 123")')
    await wait('document.querySelector(".home-slide.is-active img").naturalWidth > 0')
    await assertSinglePageScroll()
    assert.equal(settingsRequests, 1, 'Home debe reutilizar la petición de CompanySettingsProvider.')
    await wait('document.querySelectorAll(".home-conv-card").length === 5')
    assert.equal(await evaluate('document.querySelectorAll(".home-conv-card").length'), 5)
    assert.equal(await evaluate('document.querySelectorAll(".home-metric").length'), 4)
    // Diferenciales retirados de Inicio en 2e4c6a3: no deben reaparecer.
    assert.equal(await evaluate('document.querySelectorAll(".home-highlight").length'), 0)
    assert.equal(await evaluate('document.querySelectorAll(".home-svc-card").length'), 2)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav")).backgroundColor'), 'rgb(10, 37, 64)')
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#home-title")).fontFamily.includes("Manrope")'), true)
    const services = await evaluate('Array.from(document.querySelectorAll(".home-svc-links a"), link => link.getAttribute("href"))')
    assert.deepEqual(services, ['/tecnologias/cableado-estructurado', '/tecnologias/camaras-seguridad', '/tecnologias/soporte-mantenimiento', '/educacion/asesoramiento', '/educacion/capacitaciones', '/educacion/cursos'])
    assert.equal(await evaluate('(()=>{const text=document.querySelector(".home-hero-copy").getBoundingClientRect(),image=document.querySelector(".home-slides").getBoundingClientRect();return Math.abs((text.left+text.right-image.left-image.right)/2)<1&&text.top>=image.top&&text.bottom<=image.bottom})()'), true, 'Mensaje centrado sobre las fotografías.')
    assert.equal(await evaluate('document.querySelectorAll(".home-hero-thumbnails button").length'), 4, 'Se conservan las cuatro fotografías.')
    await wait('document.querySelector(".home-hero-progress-fill")?.getAnimations()[0]?.playState==="running"')
    await evaluate('document.querySelector(".home-carousel-pause").click()')
    await wait('document.querySelector(".home-carousel-pause").getAttribute("aria-pressed")==="true"')
    const activePhoto = () => evaluate('Number(document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo)')
    const frozenCamera = async reason => {
      await wait('document.querySelector(".home-slide.is-active .home-slide-image").getAnimations().every(animation=>animation.playState==="finished")')
      await wait('(()=>{const camera=document.querySelector(".home-slide.is-active img").getAnimations()[0],clock=document.querySelector(".home-hero-progress-fill").getAnimations()[0];return camera?.playState==="paused"&&!camera.pending&&clock?.playState==="paused"&&!clock.pending})()')
      const before = await evaluate('({camera:document.querySelector(".home-slide.is-active img").getAnimations()[0].currentTime,clock:document.querySelector(".home-hero-progress-fill").getAnimations()[0].currentTime})')
      await sleep(250)
      assert.deepEqual(await evaluate('({camera:document.querySelector(".home-slide.is-active img").getAnimations()[0].currentTime,clock:document.querySelector(".home-hero-progress-fill").getAnimations()[0].currentTime})'), before, reason)
    }
    await wait('["#home-title",".home-hero-actions"].every(s=>document.querySelector(s).getAnimations().every(animation=>animation.playState==="finished"))')
    await evaluate('document.fonts.ready.then(()=>true)')
    const copyBounds = await evaluate('["#home-title",".home-hero-actions"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})')
    for (let index = 0; index < 4; index++) {
      await evaluate('document.querySelectorAll(".home-hero-thumbnails button")[' + index + '].click()')
      await wait('document.querySelectorAll(".home-slide")[' + index + '].classList.contains("is-active") && document.querySelectorAll(".home-slide-photo")[' + index + '].naturalWidth>0')
      assert.equal(await activePhoto(), index)
      assert.equal(await evaluate('document.querySelectorAll(".home-slide[aria-hidden=false]").length'), 1)
      assert.deepEqual(await evaluate('["#home-title",".home-hero-actions"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})'), copyBounds, 'Cambiar de foto no mueve el mensaje ni los botones.')
      assert.equal(await evaluate('document.querySelector(".home-slide.is-active img").getAnimations()[0].playState'), 'paused', 'La pausa conserva el movimiento de cámara al cambiar manualmente.')
      if (index === 1) {
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-slide.is-active .home-slide-photo")).objectFit'), 'cover', 'La nueva foto horizontal cubre la portada.')
        assert.equal(await evaluate('(()=>{const image=document.querySelector(".home-slide.is-active img");return image.naturalWidth>image.naturalHeight&&image.src.includes("servicio-instalacion")})()'), true, 'Servicio técnico usa la imagen horizontal solicitada.')
        await capture('home-desktop-servicio-instalacion', '.home-hero')
      }
    }
    await evaluate('document.querySelector(".home-hero-thumbnails button").focus()')
    await press('ArrowLeft')
    await wait('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo === "3"')
    assert.equal(await evaluate('document.activeElement.dataset.photo'), '3', 'Las flechas mueven selección y foco.')
    await press('ArrowRight')
    await wait('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo === "0"')
    await press('End')
    await wait('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo === "3"')
    await press('Home')
    await wait('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo === "0"')
    await evaluate('document.querySelector("[aria-label=\\"Imagen siguiente\\"]").click()')
    await wait('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo === "1"')
    await evaluate('document.querySelector("[aria-label=\\"Imagen anterior\\"]").click()')
    await wait('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo === "0"')
    await evaluate('document.querySelector(".home-hero-actions a").focus()')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
    const selected = await activePhoto()
    await frozenCamera('La pausa congela el movimiento y el tiempo restante.')
    await evaluate('document.querySelector(".home-carousel-pause").click();document.activeElement.blur()')
    await wait('document.querySelector(".home-hero-progress-fill").getAnimations()[0].playState==="running"')
    await evaluate('window.__heroAutoplayStart=performance.now()')
    await sleep(5200)
    assert.equal(await activePhoto(), selected, 'La imagen permanece más de cinco segundos.')
    await wait('Number(document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo)===' + ((selected+1)%4))
    assert.ok(await evaluate('performance.now()-window.__heroAutoplayStart')>=11500, 'Cada foto dispone de unos doce segundos.')
    assert.equal(await evaluate('document.querySelector(".home-carousel-caption").getAttribute("aria-live")'), 'off', 'Los cambios automáticos no interrumpen al lector de pantalla.')
    await evaluate('document.querySelector(".home-hero-thumbnails button").focus()')
    await frozenCamera('El foco de teclado detiene movimiento y tiempo.')
    await evaluate('document.activeElement.blur()')
    await wait('document.querySelector(".home-hero-progress-fill").getAnimations()[0].playState==="running"')
    const hoverPoint = await evaluate('(()=>{const r=document.querySelector(".home-hero-thumbnails").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+20}})()')
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint})
    await frozenCamera('Leer las miniaturas pausa la presentación.')
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1})
    await wait('document.querySelector(".home-hero-progress-fill").getAnimations()[0].playState==="running"')
    await evaluate('Object.defineProperty(document,"hidden",{value:true,configurable:true});document.dispatchEvent(new Event("visibilitychange"))')
    await frozenCamera('Una pestaña oculta conserva el tiempo restante.')
    await evaluate('delete document.hidden;document.dispatchEvent(new Event("visibilitychange"))')
    await wait('document.querySelector(".home-hero-progress-fill").getAnimations()[0].playState==="running"')
    await evaluate('document.querySelector(".home-services").scrollIntoView({block:"center",behavior:"instant"})')
    await frozenCamera('Salir de la portada detiene la presentación.')
    await evaluate('window.scrollTo({top:0,behavior:"instant"})')
    await wait('document.querySelector(".home-hero-progress-fill").getAnimations()[0].playState==="running"')
    await evaluate('document.querySelector(".home-carousel-pause").click();document.querySelector(".home-hero-thumbnails button").click()')
    await wait('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo==="0"')
    await evaluate('window.__heroPhotoSource=document.querySelector(".home-slide-photo").src;document.querySelector(".home-slide-photo").src="/fixture-broken.png"')
    await wait('document.querySelector(".home-carousel-caption").textContent.includes("No se pudo cargar")')
    assert.equal(await evaluate('document.querySelector(".home-hero-actions a").getAttribute("href")'), '/contactos', 'Un fallo de imagen no bloquea el contacto.')
    await evaluate('document.querySelector(".home-slide-photo").src=window.__heroPhotoSource')
    await wait('document.querySelector(".home-carousel-caption").textContent.includes("Capacitaciones de Horus Group")')
    await evaluate('document.querySelectorAll(".home-hero-thumbnails button")[2].click();document.querySelectorAll(".home-hero-thumbnails button")[0].click()')
    await wait('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo === "0"')
    console.log('Hero: cuatro fotos, nueva instalación, doce segundos, pausa/reanudación, teclado, errores y mensaje estable: OK.')
    await capture('home-desktop-hero', '.home-hero')
    await evaluate('document.querySelector(".home-conv-card").focus();document.querySelector(".home-conv-card").click()')
    await wait('!!document.querySelector("#home-conv-center #convDesc")')
    assert.equal(await evaluate('!!document.querySelector("#convModal")'), false, 'Escritorio utiliza el centro, no un modal.')
    await capture('home-desktop-detalle-central', '#home-conv-center')
    // Sample right after the click, inside the 350ms leaving window, so a slow browser cannot outlast it between round trips.
    const leaving = await evaluate('(async()=>{document.querySelectorAll(".home-conv-card")[1].click();await new Promise(r=>setTimeout(r,0));return {expanded:document.querySelectorAll(".home-conv-card")[1].getAttribute("aria-expanded"),leaving:document.querySelector(".home-conv-content").classList.contains("is-leaving"),name:document.querySelector("#convNombre").textContent}})()')
    assert.equal(leaving.expanded, 'true')
    assert.equal(leaving.leaving, true)
    assert.equal(leaving.name, 'Entidad de prueba 1', 'El detalle anterior sale antes de reemplazarse.')
    await wait('document.querySelector("#convNombre")?.textContent === "Entidad de prueba 2" && !!document.querySelector("#convDesc")')
    await sleep(650) // Measure the final layout after the existing staggered entrance.
    assert.equal(await evaluate('(()=>{const c=document.querySelector("#home-conv-center");return c.scrollWidth<=c.clientWidth&&c.scrollHeight<=c.clientHeight+1})()'), true, 'Texto largo en el flujo natural, sin scroll adicional.')
    await capture('home-desktop-texto-largo', '#home-conv-center')
    await evaluate('document.querySelectorAll(".home-conv-card")[2].click();document.querySelectorAll(".home-conv-card")[0].click()')
    await wait('document.querySelector("#convNombre")?.textContent === "Entidad de prueba 1" && !document.querySelector(".home-conv-content.is-leaving")')
    await sleep(500)
    assert.equal(await evaluate('document.querySelector("#convNombre").textContent'), 'Entidad de prueba 1', 'Las selecciones rápidas conservan la última elección.')

    await key('Escape')
    await wait('!document.querySelector("#convDesc")')
    assert.equal(await evaluate('document.activeElement.classList.contains("home-conv-card")'), true)
    await capture('home-desktop-servicios', '.home-services')
    await capture('home-desktop-convenios', '.home-convenios')
    // «Lo que nos hace diferentes» (HomeHighlights) se retiró de Inicio a propósito en 2e4c6a3.
    assert.equal(await evaluate('!!document.querySelector(".home-highlights")'), false, 'Inicio ya no muestra la sección de diferenciales.')
    await capture('home-desktop-ubicacion', '.home-location')
    await capture('home-desktop-footer', '.footer')
    console.log('Home: contenido conservado, carrusel, diálogo/foco y composición de escritorio: OK.')

    // Motion regression: offscreen content remains pending, reveals once and never hides again.
    await wait('Array.from(document.querySelectorAll(".home-metric strong")).map(e=>e.textContent).join(",")==="5+,400+,5,98%"')
    const motionConfig = await evaluate('({layers:[".home-slides",".home-hero-copy > .home-eyebrow","#home-title",".home-hero-copy > p",".home-hero-actions",".home-hero-gallery"].map(s=>parseFloat(getComputedStyle(document.querySelector(s)).animationDelay)), crossfade:getComputedStyle(document.querySelector(".home-slide")).transitionDuration, fit:getComputedStyle(document.querySelector(".home-slide img")).objectFit})')
    assert.ok(motionConfig.layers.every((delay, index, list) => index === 0 || delay > list[index - 1]), 'Entrada escalonada del Hero.')
    assert.equal(motionConfig.crossfade, '0s', 'El barrido diagonal controla el cambio de foto.')
    assert.equal(motionConfig.fit, 'cover', 'Las fotografías horizontales llenan la portada.')
    // El bloque escalonado de referencia es ahora la ubicación (antes, los diferenciales retirados).
    await evaluate('document.querySelector(".home-location").scrollIntoView({block:"center",behavior:"instant"})')
    await wait('Array.from(document.querySelectorAll(".home-loc-item")).every(e=>e.classList.contains("visible"))')
    const delays = await evaluate('Array.from(document.querySelectorAll(".home-loc-item"),e=>{const delay=getComputedStyle(e).getPropertyValue("--reveal-delay").trim();return (parseFloat(delay)||0)*(delay.endsWith("ms")?1:1000)})')
    assert.deepEqual(delays, [0, 80, 160])
    await sleep(1100)
    await evaluate('window.scrollTo({top:0,behavior:"instant"})')
    await sleep(300)
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-loc-item")).every(e=>e.classList.contains("visible")&&getComputedStyle(e).opacity==="1")'), true, 'Reveal una sola vez.')
    await evaluate('document.querySelector(".home-services").scrollIntoView({block:"center",behavior:"instant"})')
    await wait('document.querySelector(".nav").classList.contains("scrolled")')
    // Wait for the 250ms transition to finish instead of a fixed delay, which raced under CPU load.
    await wait('getComputedStyle(document.querySelector(".nav")).transform === "matrix(1, 0, 0, 1, 0, -6)"')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav")).transform'), 'matrix(1, 0, 0, 1, 0, -6)')
    await evaluate('document.querySelector(".home-location").scrollIntoView({block:"center",behavior:"instant"})')
    await wait('Array.from(document.querySelectorAll(".home-loc-item")).every(e=>e.classList.contains("visible"))')
    await evaluate('document.querySelector(".footer").scrollIntoView({block:"center",behavior:"instant"})')
    await wait('Array.from(document.querySelectorAll(".ix-footer-top > .fade-up")).every(e=>e.classList.contains("visible"))')
    await evaluate('window.scrollTo({top:0,behavior:"instant"})')
    await sleep(300)
    console.log('Motion: capas del Hero, crossfade, object-fit, reveals únicos, stagger, navbar, ubicación y footer: OK.')

    // Counters start when visible, below the new photographic cover.
    await navigate('/')
    await evaluate('document.querySelector(".home-metrics").scrollIntoView({block:"center",behavior:"instant"})')
    await wait('document.querySelector(".home-metric:nth-child(2) strong")?.textContent !== "400+"')
    const midCount = await evaluate('Number(document.querySelector(".home-metric:nth-child(2) strong").textContent.replace("+",""))')
    assert.ok(midCount >= 0 && midCount < 400, 'El contador recorre valores reales intermedios.')
    assert.equal(await evaluate('document.querySelector(".home-metric:nth-child(2) strong").getAttribute("aria-label")'), '400+', 'Lectores de pantalla reciben el valor final.')
    await wait('document.querySelector(".home-metric:nth-child(2) strong").textContent === "400+"')
    assert.equal(await evaluate('document.querySelector(".home-location .fade-up").classList.contains("visible")'), false, 'No revelar bloques fuera del viewport.')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-location .fade-up")).opacity'), '0')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await wait('getComputedStyle(document.querySelector(".home-location .fade-up")).opacity === "1"')
    // The media query applies immediately; counters finish on their next render.
    await wait('!document.querySelector(".home-carousel-pause") && Array.from(document.querySelectorAll(".home-metric strong"),e=>e.textContent).join()==="5+,400+,5,98%" && document.querySelector(".home-slide.is-active img").getAnimations().length===0')
    const reduced = await evaluate('({animations:[".home-slide img","#home-title",".home-slides",".hc-launcher",".hc-launcher-orbit"].map(s=>getComputedStyle(document.querySelector(s)).animationName),transforms:[".home-slide.is-active img",".home-loc-item",".home-location-map"].map(s=>getComputedStyle(document.querySelector(s)).transform),counts:Array.from(document.querySelectorAll(".home-metric strong"),e=>e.textContent),pause:!!document.querySelector(".home-carousel-pause")})')
    assert.ok(reduced.animations.every(name=>name==="none"))
    assert.ok(reduced.transforms.every(transform=>transform==="none"))
    assert.deepEqual(reduced.counts,['5+','400+','5','98%'])
    assert.equal(reduced.pause,false)
    assert.equal(await evaluate('document.querySelector(".home-slide.is-active img").getAnimations().length'), 0, 'Las imágenes permanecen sin animaciones al reducir movimiento.')
    await evaluate('document.querySelector(".home-location").scrollIntoView({block:"center",behavior:"instant"})')
    await sleep(300)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav")).transform'), 'none', 'Navbar sin desplazamiento con movimiento reducido.')
    await evaluate('document.querySelector(".hc-launcher").click()')
    await wait('!!document.querySelector("#horus-chat[open]")')
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#horus-chat")).animationName'),'none')
    await key('Escape'); await wait('!document.querySelector("#horus-chat[open]")')
    await wait('document.activeElement===document.querySelector(".hc-launcher")') // let the chatbot finish returning focus before the next interaction
    await evaluate('document.querySelector(".home-conv-card").focus();document.querySelector(".home-conv-card").click()')
    await wait('!!document.querySelector("#convDesc")')
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#home-conv-center")).animationName'),'none')
    await wait('document.activeElement===document.querySelector("#convClose")')
    await key('Escape'); await wait('!document.querySelector("#convDesc")')
    await send('Emulation.setEmulatedMedia', { features: [] })
    await navigate('/')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await wait('document.querySelector(".home-metric:nth-child(2) strong")?.textContent === "400+"')
    await send('Emulation.setEmulatedMedia', { features: [] })
    await sleep(1400)
    assert.equal(await evaluate('document.querySelector(".home-metric:nth-child(2) strong").textContent'),'400+', 'Cambiar la preferencia durante el conteo no deja valores incompletos.')
    await evaluate('window.scrollTo({top:0,behavior:"instant"})')
    console.log('Motion: contadores intermedios/finales, accesibilidad y cambios de movimiento reducido: OK.')

    // Dropdowns remain usable with the keyboard and expose their expanded state.
    await evaluate('window.scrollTo({top:0,behavior:"instant"});document.querySelector(".nav-drop > button").focus()')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await wait('document.querySelector(".nav-drop > button").getAttribute("aria-expanded")==="true"')
    await key('Tab')
    assert.equal(await evaluate('document.activeElement.closest(".dropdown")!==null'),true)
    await evaluate('document.querySelector(".nav-drop > button").focus()')
    await key('Escape')
    await wait('document.querySelector(".nav-drop > button").getAttribute("aria-expanded")==="false"')
    console.log('Motion: dropdowns y navegación por teclado: OK.')

    // Una segunda pestaña guarda desde el panel real contra los fixtures aislados.
    await evaluate('localStorage.setItem("horus-admin-token","isolated-home-ui-token")')
    const adminTarget = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(origin + '/admin/dashboard?section=ajustes'), { method: 'PUT' }).then(response => response.json())
    const admin = connect(adminTarget.webSocketDebuggerUrl)
    await admin.ready
    try {
      await admin.wait('document.querySelectorAll(".hp-settings-card input").length > 0')
      await admin.evaluate('(()=>{for(const [name,value] of Object.entries({direccion:"Dirección actualizada desde el panel",telefono_principal:"+51 900 000 002",horario_atencion:"Martes: 10:00–14:00"})){const input=Array.from(document.querySelectorAll(".hp-settings-card label")).find(label=>label.textContent===name).querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}})()')
      await sleep(100)
      await admin.evaluate('document.querySelector(".hp-settings-card").closest("form").requestSubmit()')
      await admin.wait('document.body.innerText.includes("La información de la empresa se guardó correctamente.")')
      await wait('document.querySelector(".home-loc-items").textContent.includes("Dirección actualizada desde el panel")')
      assert.equal(settingsSaves, 1)
      assert.equal(await evaluate('document.querySelector(".home-loc-items").textContent.includes("Martes: 10:00–14:00")'), true)
      assert.equal(await evaluate('document.querySelector(".home-loc-items").textContent.includes("+51 900 000 002")'), true)
      assert.equal(await evaluate('document.querySelector(".footer").textContent.includes("Dirección actualizada desde el panel")'), true)
      assert.equal(await evaluate('document.querySelector(".footer").textContent.includes("+51 900 000 002")'), true)
    } finally { await admin.send('Page.close').catch(() => {}); admin.socket.close() }
    await send('Page.bringToFront')
    console.log('Home: edición de dirección, teléfono y horario desde otra pestaña del panel reflejada sin recargar: OK.')


    // Convenios: información completa, fotos, teclado y estados de API.

    const ax = await send('Accessibility.getFullAXTree')
    const cardNames = ax.nodes.filter(node => node.role?.value === 'button' && node.name?.value.includes('Entidad de prueba')).map(node => node.name.value)
    assert.equal(cardNames.length, 5)
    assert.ok(cardNames.every(name => !name.includes('Logo de') && !name.includes('Sin imagen disponible')), 'Logos y fallback no contaminan el nombre accesible de las tarjetas.')
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-conv-logo img")).every(img=>img.getAttribute("alt")==="")'), true)
    assert.equal(await evaluate('document.querySelector(".home-conv-card .home-conv-logo").textContent.includes("Sin imagen disponible")'), true, 'Fallback visual conservado.')
    convenioDetailDelay = 1800
    await evaluate('document.querySelectorAll(".home-conv-card")[2].focus();document.querySelectorAll(".home-conv-card")[2].click()')
    await wait('!!document.querySelector(".home-conv-loading-media")')
    const loadingHeight = await evaluate('document.querySelector("#home-conv-center").getBoundingClientRect().height')
    assert.ok(loadingHeight >= 350, 'La carga reserva espacio de medios y texto.')
    assert.equal(await evaluate('document.querySelector("#home-conv-center [role=status]").textContent.includes("Cargando")'), true)
    await capture('convenios-carga-reservada', '#home-conv-center')
    await wait('!!document.querySelector("#convDesc")')
    convenioDetailDelay = 0
    await sleep(650)
    const detailHeight = await evaluate('document.querySelector("#home-conv-center").getBoundingClientRect().height')
    assert.ok(Math.abs(detailHeight-loadingHeight)<130, 'Carga y detalle de una foto mantienen tamaños próximos.')
    assert.equal(await evaluate('!!document.querySelector(".home-conv-loading-media,.home-conv-loading-lines")'), false)
    await evaluate('document.querySelector(".home-conv-card.is-selected").scrollIntoView({block:"center",behavior:"instant"})')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
    await sleep(650)
    const rest = await evaluate('new DOMMatrix(getComputedStyle(document.querySelector(".home-conv-card.is-selected")).transform).m42')
    const selectedRect = await evaluate('(()=>{const r=document.querySelector(".home-conv-card.is-selected").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...selectedRect })
    await sleep(300)
    const hovered = await evaluate('new DOMMatrix(getComputedStyle(document.querySelector(".home-conv-card.is-selected")).transform).m42')
    const hoverState = await evaluate('(()=>{const b=document.querySelector(".home-conv-card.is-selected");return {className:b.className,hover:b.matches(":hover"),fine:matchMedia("(hover: hover) and (pointer: fine)").matches,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches,hit:document.elementFromPoint('+selectedRect.x+','+selectedRect.y+')?.outerHTML.slice(0,250)}})()')
    assert.ok(hovered < rest, 'La tarjeta seleccionada se eleva al entrar en hover: '+JSON.stringify({rest,hovered,rect:selectedRect,state:hoverState}))
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-conv-card.is-selected")).borderTopColor'), 'rgb(201, 169, 97)')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
    await key('Escape'); await wait('!!document.querySelector(".home-conv-identity")')

    const openConvenio = async index => {
      await evaluate('(()=>{const b=document.querySelectorAll(".home-conv-card")[' + index + '];b.focus();b.click()})()')
      await wait('!!document.querySelector("#convDesc")')
      assert.equal(await evaluate('Array.from((document.querySelector("#convModal")||document.querySelector("#home-conv-center")).querySelectorAll("h1,h2,h3,h4,h5,h6"))[0].id'), 'convNombre', 'El nombre precede a todo encabezado secundario.')
      const contrast = await evaluate('(()=>{const p=document.querySelector("#convDesc"),bg=document.querySelector("#convModal")||document.querySelector(".home-convenios");const luminance=color=>{const values=color.match(/\\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return values[0]*.2126+values[1]*.7152+values[2]*.0722};const a=luminance(getComputedStyle(p).color),b=luminance(getComputedStyle(bg).backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()')
      assert.ok(contrast >= 4.5, 'Descripción legible sobre el fondo del detalle, también en móvil.')
    }
    await openConvenio(0)
    assert.equal(await evaluate('document.querySelector("#convDesc").textContent.includes("Descripción corta")'), true)
    assert.equal(await evaluate('!!document.querySelector(".home-conv-gallery,.home-conv-additional")'), false)
    assert.equal(await evaluate('document.querySelector("#home-conv-center .home-conv-feature").textContent.includes("Sin imagen")'), true)
    await key('Escape'); await wait('!document.querySelector("#convDesc")')
    await openConvenio(1)
    assert.equal(await evaluate('document.querySelector("#convDesc").textContent.includes("Descripción completa")'), true)
    assert.equal(await evaluate('document.querySelector("#home-conv-center").textContent.includes("Descripción corta")'), false, 'El resumen no se repite al mostrar el texto completo.')
    assert.equal(await evaluate('document.querySelector("#convDesc").textContent'), convenioFixtures[1].descripcion_completa.trim(), 'Descripción completa sin truncar.')
    assert.equal(await evaluate('document.querySelector(".home-conv-additional").textContent.includes("Información adicional de prueba")'), true)
    await wait('document.querySelector("#home-conv-center .home-conv-feature").textContent.includes("Sin imagen")')
    await evaluate('document.querySelector("#convClose").click()'); await wait('!document.querySelector("#convDesc")')
    await openConvenio(2)
    assert.equal(await evaluate('!!document.querySelector(".home-conv-gallery")'), false, 'Una sola foto no muestra galería ni título de fotografías.')
    assert.equal(await evaluate('document.querySelectorAll("#home-conv-center .home-conv-feature img").length'), 1, 'Una única fotografía protagonista.')
    await key('Escape'); await wait('!document.querySelector("#convDesc")')
    await openConvenio(3)
    await evaluate('document.querySelector(".home-conv-gallery").scrollIntoView({block:"center"});document.querySelector(".home-conv-gallery").focus()')
    await wait('document.querySelector(".home-conv-photo img")?.naturalWidth > 0')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-conv-photo img")).objectFit'), 'contain')

    assert.equal(await evaluate('!!document.querySelector("#home-conv-center .home-conv-feature")'), false, 'El visor sustituye la protagonista, sin repetir la primera fotografía.')
    assert.equal(await evaluate('document.querySelectorAll(".home-conv-gallery-dots button").length'), 2)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-conv-photo")).backgroundColor'), 'rgb(7, 27, 46)', 'Visor integrado al fondo oscuro.')
    await sleep(750) // Finish the panel entrance before measuring the photo crossfade.
    const stageHeight = await evaluate('document.querySelector(".home-conv-photo-stage").getBoundingClientRect().height')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await wait('document.querySelector(".home-conv-photo-stage").classList.contains("is-crossfading")')
    await sleep(100)
    const blend = await evaluate('Array.from(document.querySelectorAll(".home-conv-photo-layer"),e=>({opacity:parseFloat(getComputedStyle(e).opacity),loaded:e.querySelector("img")?.naturalWidth>0}))')
    assert.equal(blend.length, 2, 'Dos fotografías superpuestas durante el crossfade.')
    assert.ok(blend.every(layer=>layer.loaded && layer.opacity>0 && layer.opacity<1), 'Ambas imágenes visibles durante la mezcla.')
    assert.equal(await evaluate('document.querySelector(".home-conv-photo-stage").getBoundingClientRect().height'), stageHeight, 'El crossfade no cambia la altura.')

    await wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía 2 de 2"')
    assert.equal(await evaluate('document.querySelector(".home-conv-photo figcaption").textContent'), 'Fotografía 2 de 2')
    await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Fotografía anterior").click()')
    await wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía 1 de 2"')
    assert.equal(await evaluate('document.querySelector(".home-conv-photo figcaption").textContent'), 'Fotografía 1 de 2')
    await evaluate('document.querySelectorAll(".home-conv-gallery-dots button")[1].click()')
    await wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía 2 de 2"')
    assert.equal(await evaluate('document.querySelectorAll(".home-conv-gallery-dots button")[1].getAttribute("aria-pressed")'), 'true')

    // Native keyboard activation must preserve focused controls throughout blending.
    const caption = index => wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía ' + index + ' de 2"')
    const focusControl = selector => evaluate('window.__focusedConvenioControl=document.querySelector(' + JSON.stringify(selector) + ');window.__focusedConvenioControl.focus()')
    const assertFocusWhileBusy = async () => {
      await wait('document.querySelector(".home-conv-photo-stage").getAttribute("aria-busy")==="true"')
      assert.equal(await evaluate('document.activeElement===window.__focusedConvenioControl && !document.activeElement.disabled && document.activeElement.getAttribute("aria-disabled")==="true"'), true, 'Foco conservado durante el crossfade.')
    }
    await evaluate('document.querySelector(".home-conv-gallery").focus()')
    await press('Tab')
    assert.equal(await evaluate('document.activeElement===document.querySelector(".home-conv-gallery-dots button")'), true)
    await focusControl('.home-conv-gallery-dots button')
    await press('Enter'); await assertFocusWhileBusy()
    await press('Space')
    await evaluate('document.querySelectorAll(".home-conv-gallery-dots button")[1].click()')
    await press('Tab')
    assert.equal(await evaluate('document.activeElement===document.querySelectorAll(".home-conv-gallery-dots button")[1]'), true, 'Tab funciona incluso mientras los indicadores están ocupados.')
    await press('Tab', true)
    assert.equal(await evaluate('document.activeElement===window.__focusedConvenioControl'), true, 'Shift+Tab vuelve al indicador.')
    await caption(1)
    await focusControl('[aria-label="Fotografía siguiente"]')
    await press('Space'); await assertFocusWhileBusy()
    await press('ArrowLeft') // Ignored while blending; the pending next photo must win.
    await caption(2)
    assert.equal(await evaluate('document.activeElement===window.__focusedConvenioControl'), true)
    await press('ArrowLeft'); await caption(1)
    await press('ArrowRight'); await caption(2)
    await focusControl('[aria-label="Fotografía anterior"]')
    await press('Enter'); await assertFocusWhileBusy()
    await press('Tab')
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Fotografía siguiente')
    await press('Tab', true)
    assert.equal(await evaluate('document.activeElement===window.__focusedConvenioControl'), true)
    await caption(1)

    await key('Tab')
    assert.equal(await evaluate('document.querySelector("#home-conv-center").contains(document.activeElement)'), true)
    await key('Escape'); await wait('!document.querySelector("#convDesc")')
    convenioDetailFailure = true
    await evaluate('document.querySelector(".home-conv-card").click()')
    // El texto técnico del servidor ("Fallo aislado de convenios") no llega al visitante: se muestra el mensaje fijo en español.
    await wait('document.querySelector("#home-conv-center [role=alert]")?.textContent.includes("Ocurrió un problema al cargar el contenido. Inténtalo más tarde.")')
    assert.equal(await evaluate('document.querySelector("#home-conv-center").textContent.includes("Fallo aislado")'), false)
    assert.equal(await evaluate('!!document.querySelector("#convDesc,.home-conv-gallery")'), false)
    convenioDetailFailure = false
    await evaluate('document.querySelector("#home-conv-center .home-button").click()')
    await wait('!!document.querySelector("#convDesc")')
    await key('Escape'); await wait('!document.querySelector("#convDesc")')
    conveniosFailure = true
    await evaluate('window.dispatchEvent(new CustomEvent("horus:content-updated",{detail:"convenios"}))')
    await wait('document.querySelector(".home-conv-notice")?.textContent.includes("Ocurrió un problema al cargar el contenido. Inténtalo más tarde.")')
    assert.equal(await evaluate('document.querySelector(".home-conv-notice").textContent.includes("Fallo aislado")'), false)
    assert.equal(await evaluate('document.querySelectorAll(".home-conv-card").length'), 0, 'Sin fallback estático')
    conveniosFailure = false
    await evaluate('document.querySelector(".home-conv-notice button").click()')
    await wait('document.querySelectorAll(".home-conv-card").length === 5')
    const fixtureCopy = structuredClone(convenioFixtures)
    for (const row of convenioFixtures) row.visible = false
    await evaluate('window.dispatchEvent(new CustomEvent("horus:content-updated",{detail:"convenios"}))')
    await wait('document.querySelector(".home-conv-notice")?.textContent.includes("No hay convenios visibles")')
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-metric")).find(e=>e.textContent.includes("Convenios activos")).querySelector("strong").textContent'), '0')
    convenioFixtures.splice(0, convenioFixtures.length, ...fixtureCopy)
    await evaluate('window.dispatchEvent(new CustomEvent("horus:content-updated",{detail:"convenios"}))')
    await wait('document.querySelectorAll(".home-conv-card").length === 5')
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-metric")).find(e=>e.textContent.includes("Convenios activos")).querySelector("strong").textContent'), '5')
    assert.equal(convenioRequests.some(route => /convenios\/\d+\/fotos/.test(route)), false, 'Detalle y fotos en una petición')
    console.log('Convenios: descripción corta/completa, información adicional, 0/1/varias fotos, imagen fallida, teclado, error/reintento, vacío y contador: OK.')

    // Public layout with six institutions and additional pages, never real data.
    const longName = 'Colegio Regional de Licenciados en Administración y Desarrollo Institucional de Cajamarca'
    const extra = { ...structuredClone(convenioFixtures[0]), id: 90, orden: 90,
      nombre: longName, sigla: 'TEST LARGO', descripcion_corta: longName.toLowerCase() + '.', logo_url: '/fixture-photo.png' }
    convenioFixtures.push(extra)
    const refreshConvenios = () => evaluate('window.dispatchEvent(new CustomEvent("horus:content-updated",{detail:"convenios"}))')
    await refreshConvenios()
    await wait('document.querySelectorAll(".home-conv-card").length === 6')
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".home-conv-side"),e=>e.children.length)'), [3,3], 'Seis convenios: tres por cada lado.')
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-conv-side")).every(side=>Array.from(side.children).every((card,i,cards)=>{const r=card.getBoundingClientRect(),s=side.getBoundingClientRect();return Math.abs(r.left-s.left)<1&&Math.abs(r.width-s.width)<1&&(!i||r.top>=cards[i-1].getBoundingClientRect().bottom)}))'), true, 'Tres tarjetas verticales dentro de cada columna lateral.')
    assert.equal(await evaluate('!!document.querySelector(".home-conv-description")'), false, 'Las tarjetas no presentan descripciones.')
    assert.equal(await evaluate('document.querySelectorAll(".home-conv-card")[5].querySelector(".home-conv-name").textContent'), longName)
    assert.equal(await evaluate('!!document.querySelector("#home-conv-center .home-conv-identity")'), true)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-conv-identity img")).opacity'), '0.08')
    await evaluate('document.querySelector(".home-convenios").scrollIntoView({block:"start"})')
    await sleep(700)
    const layout = await evaluate('(()=>{const sides=Array.from(document.querySelectorAll(".home-conv-side"),e=>e.getBoundingClientRect().width),c=document.querySelector("#home-conv-center").getBoundingClientRect();return {ratio:c.width/(c.width+sides[0]+sides[1]),heights:Array.from(document.querySelectorAll(".home-conv-side"),side=>Array.from(side.children,e=>e.getBoundingClientRect().height))}})()')
    assert.ok(layout.ratio > .50 && layout.ratio < .54, 'Centro con 50–54% del ancho útil.')
    assert.ok(layout.heights.every(side=>Math.max(...side)-Math.min(...side)<2), 'Altura equilibrada en ambas columnas.')
    await capture('convenios-seis-inicial', '.home-convenios')
    await evaluate('document.querySelectorAll(".home-conv-card")[5].focus();document.querySelectorAll(".home-conv-card")[5].click()')
    await wait('document.querySelector("#convNombre")?.textContent.includes("Desarrollo Institucional")')
    assert.equal(await evaluate('!!document.querySelector("#convDesc,.home-conv-additional,.home-conv-gallery")'), false, 'Resumen que repite nombre oculto, sin contenido inventado.')
    await key('Escape')
    await wait('!!document.querySelector(".home-conv-identity")')
    convenioFixtures.push({ ...structuredClone(extra), id: 91, orden: 91, nombre: 'Séptima institución dinámica', sigla: 'TEST 7', descripcion_corta: 'Resumen del convenio de la segunda página.' })
    await refreshConvenios()
    await wait('document.querySelector(".home-conv-pagination")?.textContent.includes("Página 1 de 2")')
    await evaluate('Array.from(document.querySelectorAll(".home-conv-pagination button")).find(b=>b.textContent==="Siguiente").click()')
    await wait('document.querySelector(".home-conv-card")?.textContent.includes("Séptima institución dinámica")')
    assert.equal(await evaluate('document.querySelectorAll(".home-conv-card").length'), 1)
    await evaluate('Array.from(document.querySelectorAll(".home-conv-pagination button")).find(b=>b.textContent==="Anterior").click()')
    await wait('document.querySelectorAll(".home-conv-card").length === 6')
    await viewport(1366)
    await openConvenio(3)
    await capture('convenios-dos-fotos-desktop', '.home-convenios')
    await key('Escape'); await wait('!!document.querySelector(".home-conv-identity")')
    await viewport(1920)
    await capture('convenios-seis-1920', '.home-convenios')
    // Validate photo proportions with isolated tall and wide image fixtures.
    const originalFotos = structuredClone(convenioFixtures[3].fotos)
    convenioFixtures[3].fotos[0].imagen_url = '/fixture-portrait.svg'
    convenioFixtures[3].fotos[1].imagen_url = '/fixture-landscape.svg'
    convenioFixtures[3].fotos.push({ ...originalFotos[0], id: 999, orden: 2 })
    await openConvenio(3)
    await wait('document.querySelector(".home-conv-photo img")?.naturalHeight === 480')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-conv-photo img")).objectFit'), 'contain')
    await evaluate('document.querySelectorAll(".home-conv-gallery-dots button")[1].click()')
    await wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía 2 de 3"')
    await wait('document.querySelector(".home-conv-photo img")?.naturalWidth === 640')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-conv-photo img")).objectFit'), 'contain')
    assert.equal(await evaluate('document.querySelectorAll(".home-conv-gallery-dots button").length'), 3)
    await evaluate('document.querySelectorAll(".home-conv-gallery-dots button")[2].click()')
    await wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía 3 de 3"')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await evaluate('document.querySelectorAll(".home-conv-gallery-dots button")[0].click()')
    await wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía 1 de 3"')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-conv-photo-layer")).transitionDuration'), '0s')
    await focusControl('.home-conv-gallery-dots button:nth-child(2)')
    await press('Space')
    await wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía 2 de 3"')
    assert.equal(await evaluate('document.activeElement===window.__focusedConvenioControl'), true, 'Indicador con foco conservado también con movimiento reducido.')
    await key('Escape'); await wait('!!document.querySelector(".home-conv-identity")')
    await send('Emulation.setEmulatedMedia', { features: [] })
    convenioFixtures[3].fotos = originalFotos
    for (const width of [320,375,768,1024,1366,1920]) {
      await viewport(width, width < 768 ? 844 : 1000)
      if (width <= 540) assert.equal(await evaluate('(()=>{const grid=document.querySelector(".home-conv-grid"),card=document.querySelector(".home-conv-card");return Math.abs(grid.getBoundingClientRect().width-card.getBoundingClientRect().width)<2})()'), true, 'Tarjetas móviles legibles a una columna: '+width)
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-conv-more")).every(hint=>{hint.scrollIntoView({block:"center",behavior:"instant"});let r=hint.getBoundingClientRect();window.scrollBy({top:r.top+r.height/2-(innerHeight-90),behavior:"instant"});r=hint.getBoundingClientRect();return [r.left+2,r.left+r.width/2,r.right-2].every(x=>hint.closest("button").contains(document.elementFromPoint(x,r.top+r.height/2)))} )'), true, 'El chatbot no tapa texto ni flecha de Convenios: '+width)
      await evaluate('document.querySelectorAll(".home-conv-card")[5].scrollIntoView({block:"center",behavior:"instant"});document.querySelectorAll(".home-conv-card")[5].focus();document.querySelectorAll(".home-conv-card")[5].click()')
      await wait('document.querySelector("#convNombre")?.textContent.includes("Desarrollo Institucional")')
      await sleep(650)
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'Convenios sin overflow a '+width)
      const bounds = await evaluate('(()=>{const e=document.querySelector("#convModal")||document.querySelector("#home-conv-center"),r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,client:e.clientWidth,scroll:e.scrollWidth}})()')
      assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.scroll <= bounds.client, 'Nombre largo dentro del detalle: '+width)
      assert.equal(await evaluate('!!document.querySelector("#convModal[open]")'), width <= 1024, 'Diálogo únicamente en tablet/móvil: '+width)
      await evaluate('document.querySelector("#convClose").scrollIntoView({block:"center",behavior:"instant"})')
      await sleep(50)
      assert.equal(await evaluate('(()=>{const b=document.querySelector("#convClose"),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()'), true, 'El chatbot no tapa el control de cierre: '+width)
      await capture('convenios-detalle-'+width, width <= 1024 ? '#convModal' : '#home-conv-center')
      await key('Escape')
      await wait('!document.querySelector("#convModal") && !!document.querySelector(".home-conv-identity")')
      assert.equal(await evaluate('document.body.style.overflow'), '', 'Cierre restaura scroll: '+width)
    }
    convenioFixtures.splice(-2)
    await refreshConvenios()
    await wait('document.querySelectorAll(".home-conv-card").length === 5')
    await viewport(1440)
    console.log('Convenios: tarjetas simples, marca de agua, nombres largos, 3+centro+3, paginación, visor único, indicadores y movimiento reducido: OK.')

    // CRUD mediante el panel real; los endpoints usan únicamente fixtures en memoria.
    const convenioAdminTarget = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(origin + '/admin/dashboard?section=convenios'), { method: 'PUT' }).then(response => response.json())
    const convenioAdmin = connect(convenioAdminTarget.webSocketDebuggerUrl)
    await convenioAdmin.ready
    const fillConvenio = async values => {
      await convenioAdmin.evaluate('(()=>{for(const [name,value] of Object.entries(' + JSON.stringify(values) + ')){const input=document.querySelector(".hp-convenio-form [name="+name+"]");const proto=input.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}})()')
      await sleep(50)
    }
    const photoUpload = async count => {
      await convenioAdmin.evaluate('(()=>{const input=document.querySelector(".hp-convenio-photos input[type=file]"),data=new DataTransfer();for(let i=0;i<' + count + ';i++)data.items.add(new File([Uint8Array.from(atob("' + fixturePng.toString('base64') + '"),c=>c.charCodeAt(0))],"test-"+i+".png",{type:"image/png"}));input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()')
    }

    const adminViewport = (width, height = 1000) => convenioAdmin.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
    const captureAdmin = async name => {
      if (!screenshots) return
      const result = await convenioAdmin.send('Page.captureScreenshot', { format: 'png' })
      fs.mkdirSync(screenshots, { recursive: true })
      fs.writeFileSync(path.join(screenshots, name + '.png'), Buffer.from(result.data, 'base64'))
    }
    const assertEditorScroll = async width => {
      const result = await convenioAdmin.evaluate('(()=>{const d=document.querySelector(".hp-convenio-dialog"),s=document.querySelector(".hp-convenio-editor-scroll"),r=d.getBoundingClientRect();s.scrollTop=s.scrollHeight;const h=d.querySelector("header").getBoundingClientRect(),f=d.querySelector("footer").getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,range:s.scrollHeight-s.clientHeight,overflow:getComputedStyle(s).overflowY,extra:[d,d.querySelector("form"),d.querySelector("header"),d.querySelector("footer")].filter(e=>e.scrollHeight>e.clientHeight+1).map(e=>e.tagName),fixed:h.top>=0&&f.bottom<=innerHeight,body:document.body.style.overflow,root:getComputedStyle(document.documentElement).overflowY,columns:Math.abs(d.querySelector("[name=nombre]").getBoundingClientRect().top-d.querySelector("[name=sigla]").getBoundingClientRect().top)<1?2:1,photosInForm:!!d.querySelector("form .hp-convenio-photos")}})()')
      assert.equal(result.fits, true, 'Modal dentro de pantalla: ' + width)
      assert.ok(result.range > 0, 'El contenido conserva scroll: ' + width)
      assert.equal(result.overflow, 'auto')
      assert.deepEqual(result.extra, [], 'Un único scroll interno: ' + width)
      assert.equal(result.fixed, true, 'Encabezado y acciones visibles al llegar al final: ' + width)
      assert.equal(result.body, 'hidden', 'El documento permanece bloqueado mientras se edita.')
      assert.equal(result.root, 'hidden', 'La barra del documento desaparece mientras el modal está abierto.')
      assert.equal(result.columns, width <= 900 ? 1 : 2)
      assert.equal(result.photosInForm, true)
    }

    try {
      await convenioAdmin.send('Runtime.enable')
      await convenioAdmin.send('Page.bringToFront')
      await adminViewport(1440)
      await convenioAdmin.wait('document.querySelectorAll(".hp-convenios tbody tr").length === 5')
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-heading button")).find(b=>b.textContent.includes("Nuevo convenio")).click()')
      await convenioAdmin.wait('!!document.querySelector(".hp-convenio-form")')
      await fillConvenio({ nombre: 'Alianza creada en prueba UI', sigla: 'UI', descripcion_corta: 'Descripción de la alianza de prueba', descripcion_completa: 'Información completa editada en el panel', informacion_adicional: 'Información adicional editada', orden: '0' })

      await assertEditorScroll(1440)
      await convenioAdmin.evaluate('document.querySelector(".hp-convenio-editor-scroll").scrollTop=0')
      await captureAdmin('panel-convenio-desktop-new')
      convenioSaveFailure = true
      const savesBefore = convenioSaveCount
      await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form").requestSubmit();document.querySelector(".hp-convenio-form").requestSubmit()')
      await convenioAdmin.wait('document.querySelector(".hp-convenio-feedback [role=alert]")?.textContent.includes("Fallo aislado") && !document.querySelector(".hp-convenio-dialog button[type=submit]").disabled')
      assert.equal(convenioSaveCount - savesBefore, 1, 'No hay doble envío.')
      assert.equal(await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form [name=nombre]").value'), 'Alianza creada en prueba UI', 'Se conserva el nombre tras un error.')
      assert.equal(await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form [name=informacion_adicional]").value'), 'Información adicional editada', 'Se conservan los textos tras un error.')
      assert.equal(convenioFixtures.length, 5)
      convenioSaveFailure = false
      await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form [name=visible]").click();document.querySelector(".hp-convenio-form").requestSubmit()')
      await convenioAdmin.wait('!!document.querySelector(".hp-convenio-photos input[type=file]")')
      await wait('document.querySelectorAll(".home-conv-card").length === 6')
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-metric")).find(e=>e.textContent.includes("Convenios activos")).querySelector("strong").textContent'), '6')
      const uploadsBefore = uploadCount
      await photoUpload(2)
      await convenioAdmin.wait('document.querySelectorAll(".hp-convenio-photo-grid li").length === 2 && !document.querySelector(".hp-convenio-dialog button[type=submit]").disabled')
      assert.equal(uploadCount - uploadsBefore, 2)
      const created = convenioFixtures.find(r => r.nombre === 'Alianza creada en prueba UI')
      assert.ok(created); assert.equal(created.fotos.length, 2)
      const firstPhoto = created.fotos[0].id
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Mover fotografía 1 después").click()')
      await convenioAdmin.wait('document.querySelector(".hp-convenio-photos [role=status]")?.textContent.includes("Orden")')
      assert.equal([...created.fotos].sort((a,b)=>a.orden-b.orden)[1].id, firstPhoto)
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Quitar fotografía 1").click()')
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-convenio-photo-grid button")).find(b=>b.textContent==="Confirmar retirada").click()')
      await convenioAdmin.wait('document.querySelectorAll(".hp-convenio-photo-grid li").length === 1 && !document.querySelector(".hp-convenio-dialog button[type=submit]").disabled')

      // Un lote contiene una foto demasiado grande, un fallo HTTP y dos válidas.
      const partialBefore = uploadCount
      await convenioAdmin.evaluate('(()=>{const input=document.querySelector(".hp-convenio-photos input[type=file]"),data=new DataTransfer(),png=Uint8Array.from(atob("PNG_BASE64"),c=>c.charCodeAt(0));data.items.add(new File([new Uint8Array(5*1024*1024+1)],"large.png",{type:"image/png"}));data.items.add(new File([png],"good-before.png",{type:"image/png"}));data.items.add(new File([png],"failure.png",{type:"image/png"}));data.items.add(new File([png],"good-after.png",{type:"image/png"}));input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()'.replace('PNG_BASE64', fixturePng.toString('base64')))
      await convenioAdmin.wait('document.querySelectorAll(".hp-convenio-photo-grid li").length === 3 && !document.querySelector(".hp-convenio-dialog button[type=submit]").disabled')
      assert.equal(uploadCount - partialBefore, 3, 'El archivo de más de 5 MB no llega al servidor.')
      assert.equal(created.fotos.length, 3, 'Fotos anteriores y cargas válidas conservadas.')
      assert.equal(await convenioAdmin.evaluate('document.querySelectorAll(".hp-upload-results .is-error").length'), 2)
      assert.equal(await convenioAdmin.evaluate('document.querySelector(".hp-upload-results").textContent.includes("large.png") && document.querySelector(".hp-upload-results").textContent.includes("5 MB") && document.querySelector(".hp-upload-results").textContent.includes("failure.png")'), true)
      await assertEditorScroll(1440)
      await captureAdmin('panel-convenio-desktop-photos-errors')
      await fillConvenio({ nombre: 'Alianza editada en prueba UI', orden: '100' })
      await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form").requestSubmit()')
      await convenioAdmin.wait('!document.querySelector(".hp-convenio-dialog button[type=submit]").disabled && document.querySelector(".hp-convenio-feedback [role=status]")?.textContent.includes("guardado")')
      await wait('Array.from(document.querySelectorAll(".home-conv-card")).some(e=>e.textContent.includes("Alianza editada en prueba UI"))')
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-convenio-dialog button")).find(b=>b.textContent==="Cerrar").click()')
      await convenioAdmin.wait('!document.querySelector(".hp-dialog")')
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-convenios tbody tr")).find(r=>r.textContent.includes("Alianza editada")).querySelectorAll("button")[1].click()')
      await wait('document.querySelectorAll(".home-conv-card").length === 5')
      await convenioAdmin.wait('Array.from(document.querySelectorAll(".hp-convenios tbody tr")).find(r=>r.textContent.includes("Alianza editada")).textContent.includes("Oculto")')
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-convenios tbody tr")).find(r=>r.textContent.includes("Alianza editada")).querySelectorAll("button")[1].click()')
      await wait('document.querySelectorAll(".home-conv-card").length === 6')
      await convenioAdmin.wait('!document.querySelector(".hp-convenios tbody tr button").disabled')
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Eliminar Alianza editada en prueba UI").click()')
      await convenioAdmin.wait('document.querySelector(".hp-dialog")?.textContent.includes("Eliminar convenio")')
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-dialog button")).find(b=>b.textContent==="Eliminar convenio").click()')
      await convenioAdmin.wait('!document.querySelector(".hp-dialog")')
      await wait('document.querySelectorAll(".home-conv-card").length === 5')
      assert.equal(convenioFixtures.some(r=>r.id===created.id), false)
      await captureAdmin('panel-convenios-table')
      // Verifica que el uploader del logo conserve selección simple.
      await convenioAdmin.evaluate('document.querySelector(".hp-heading button").click()')
      await convenioAdmin.wait('!!document.querySelector(".hp-convenio-form")')
      assert.equal(await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form input[type=file]").multiple'), false)
      await convenioAdmin.evaluate('(()=>{const input=document.querySelector(".hp-convenio-form input[type=file]"),data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob("' + fixturePng.toString('base64') + '"),c=>c.charCodeAt(0))],"logo.png",{type:"image/png"}));input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()')
      await convenioAdmin.wait('document.querySelector(".hp-convenio-form [name=logo_url]").value.includes("/api/uploads/") && !document.querySelector(".hp-convenio-dialog button[type=submit]").disabled')
      const oldLogo = await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form [name=logo_url]").value')
      assert.equal(await convenioAdmin.evaluate('document.querySelector(".hp-convenio-logo-controls").textContent.includes("Cambiar logo")'), true)
      await convenioAdmin.evaluate('(()=>{const input=document.querySelector(".hp-convenio-form input[type=file]"),data=new DataTransfer();data.items.add(new File([new Uint8Array(5*1024*1024+1)],"large-logo.png",{type:"image/png"}));input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()')
      await convenioAdmin.wait('document.querySelector(".hp-convenio-logo-controls [role=alert]")?.textContent.includes("5 MB")')
      assert.equal(await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form [name=logo_url]").value'), oldLogo, 'El logo anterior se conserva si falla el cambio.')
      await convenioAdmin.evaluate('(()=>{const input=document.querySelector(".hp-convenio-form input[type=file]"),data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob("PNG_BASE64"),c=>c.charCodeAt(0))],"changed-logo.png",{type:"image/png"}));input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()'.replace('PNG_BASE64', fixturePng.toString('base64')))
      await convenioAdmin.wait('!document.querySelector(".hp-convenio-dialog button[type=submit]").disabled')
      assert.notEqual(await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form [name=logo_url]").value'), oldLogo)
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-convenio-logo-controls button")).find(b=>b.textContent==="Quitar logo").click()')
      assert.equal(await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form [name=logo_url]").value'), '')
      await fillConvenio({ nombre: 'Texto conservado en móvil', descripcion_corta: 'Descripción de prueba para revisar el modal', descripcion_completa: 'Texto extenso '.repeat(200), informacion_adicional: 'Condiciones de prueba '.repeat(100) })
      for (const width of [768, 390, 320]) {
        await adminViewport(width, 844)
        await sleep(100)
        await assertEditorScroll(width)
        await captureAdmin('panel-convenio-' + width + '-photos')
        await convenioAdmin.evaluate('document.querySelector(".hp-convenio-editor-scroll").scrollTop=0')
        await captureAdmin('panel-convenio-' + width + '-header')
        assert.equal(await convenioAdmin.evaluate('document.querySelector(".hp-convenio-form [name=nombre]").value'), 'Texto conservado en móvil', 'Cambiar el tamaño no pierde campos.')
      }
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-convenio-dialog button")).find(b=>b.textContent==="Cerrar").click()')
      // El nombre editado en esta prueba no se guardó: cerrar pide confirmar el descarte (cambios sin guardar).
      await convenioAdmin.wait('!!document.querySelector("dialog.hp-unsaved-dialog[open]")')
      await convenioAdmin.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] .hp-btn-danger").click()')
      await convenioAdmin.wait('!document.querySelector(".hp-convenio-dialog")')
      assert.equal(await convenioAdmin.evaluate('document.body.style.overflow'), '')
      assert.equal(await convenioAdmin.evaluate('document.documentElement.style.overflow'), '')

      // La continuación de cargas parciales nunca continúa después de un 401 al asociar la foto.
      await adminViewport(1440)
      await convenioAdmin.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Editar Entidad de prueba 3").click()')
      await convenioAdmin.wait('!!document.querySelector(".hp-convenio-photos input[type=file]")')

      await adminViewport(390, 844)
      await assertEditorScroll(390)
      await captureAdmin('panel-convenio-390-existing-photos')
      assert.equal(await convenioAdmin.evaluate('Array.from(document.querySelectorAll(".hp-convenio-photo-grid li"),e=>e.getBoundingClientRect()).every(r=>r.left>=0&&r.right<=innerWidth)'), true, 'Miniaturas y acciones dentro del modal móvil.')
      await adminViewport(1440)
      const expiredBefore = uploadCount, photosBeforeExpiry = convenioFixtures.find(r=>r.id===3).fotos.length
      await convenioAdmin.evaluate('(()=>{const input=document.querySelector(".hp-convenio-photos input[type=file]"),data=new DataTransfer(),png=Uint8Array.from(atob("PNG_BASE64"),c=>c.charCodeAt(0));for(const name of ["expired-association.png","should-not-upload.png"])data.items.add(new File([png],name,{type:"image/png"}));input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()'.replace('PNG_BASE64', fixturePng.toString('base64')))
      await convenioAdmin.wait('location.pathname === "/admin/login"')
      await sleep(100)
      assert.equal(uploadCount - expiredBefore, 1, '401 detiene las fotos pendientes.')
      assert.equal(convenioFixtures.find(r=>r.id===3).fotos.length, photosBeforeExpiry)
      assert.equal(await convenioAdmin.evaluate('document.documentElement.style.overflow'), '')
      assert.equal(await convenioAdmin.evaluate('document.body.style.overflow'), '')
      assert.deepEqual(convenioAdmin.exceptions, [])
    } finally { await convenioAdmin.send('Page.close').catch(() => {}); convenioAdmin.socket.close() }
    await send('Page.bringToFront')
    console.log('Convenios panel: crear/editar, logo simple, uploads múltiples, ordenar/retirar fotos, publicar/ocultar, eliminar y actualización de Home entre pestañas: OK.')

    for (const width of [1920, 1366, 1280, 1024, 768, 540, 390, 375, 320]) {
      await viewport(width, width < 768 ? 844 : 1000)
      await evaluate('window.scrollTo(0,0)')
      await sleep(250)
      await assertSinglePageScroll()
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'Desbordamiento: ' + width)
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-conv-card,.home-metric,.home-svc-card,.home-loc-item,.home-hero-thumbnails button"),element=>element.getBoundingClientRect()).every(rect=>rect.left>=-1&&rect.right<=innerWidth+1)'), true, 'Tarjetas fuera de pantalla: ' + width)
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-page h2"),element=>parseFloat(getComputedStyle(element).fontSize)).every(size=>size>=27.2&&size<=40)'), true, 'Títulos fuera de escala: ' + width)
      assert.equal(await evaluate('parseFloat(getComputedStyle(document.querySelector("#home-title")).fontSize)<=80'), true)
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".home-hero-thumbnails button,.home-carousel-arrow")).every(button=>{button.scrollIntoView({block:"center",behavior:"instant"});let r=button.getBoundingClientRect();window.scrollBy({top:r.top+r.height/2-(innerHeight-54),behavior:"instant"});r=button.getBoundingClientRect();return [r.left+2,r.left+r.width/2,r.right-2].every(x=>button.contains(document.elementFromPoint(x,r.top+r.height/2)))} )'), true, 'El chatbot no tapa las miniaturas ni las flechas: '+width)
      if (width === 320) await capture('home-mobile-320-hero', '.home-hero')
      await evaluate('document.querySelector(".nav-toggle").getAttribute("aria-expanded")==="true"&&document.querySelector(".nav-toggle").click()')
      if (width === 1024) {
        await evaluate('document.querySelector(".home-conv-card").click()')
        await wait('!!document.querySelector("#convModal[open]") && !!document.querySelector("#convDesc")')
        await viewport(1366)
        await wait('!!document.querySelector("#home-conv-center #convDesc") && !document.querySelector("#convModal")')
        assert.equal(await evaluate('document.body.style.overflow'), '', 'Al pasar a escritorio se restaura el scroll del documento.')
        await evaluate('document.querySelector("#convClose").click()')
        await wait('!document.querySelector("#convDesc")')
        assert.equal(await evaluate('!!document.querySelector(".home-conv-identity")'), true, 'Cerrar restaura la identidad Horus.')
      }

    }
    await viewport(390, 844)
    await evaluate('window.scrollTo(0,0)')
    const touchPhotoBefore = await activePhoto()
    await send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 280, y: 330 }] })
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160, y: 334 }] })
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await wait('Number(document.querySelector(".home-hero-thumbnails [aria-pressed=true]").dataset.photo) === ' + ((touchPhotoBefore + 1) % 4))
    await send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await evaluate('document.querySelector(".home-hero-thumbnails button").click()')
    await capture('home-mobile-hero', '.home-hero')
    await capture('home-mobile-servicios', '.home-services')
    await capture('home-mobile-convenios', '.home-convenios')
    await capture('home-mobile-ubicacion', '.home-location')
    await capture('home-mobile-footer', '.footer')
    await evaluate('window.scrollTo(0,0);document.querySelector(".nav-toggle").click()')
    await wait('document.querySelector(".nav-toggle").getAttribute("aria-expanded")==="true"')
    await evaluate('document.querySelector(".nav-drop > button").click()')
    await wait('document.querySelector(".nav-drop > button").getAttribute("aria-expanded")==="true"')
    await sleep(220)
    await evaluate('document.querySelector(".dropdown a").focus()')
    await key('Escape')
    assert.equal(await evaluate('document.querySelector(".nav-drop > button").getAttribute("aria-expanded")'), 'false')
    assert.equal(await evaluate('document.querySelector(".dropdown").inert'), true, 'El dropdown cerrado deja de recibir foco inmediatamente.')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-drop.is-closing .dropdown")).position'), 'static', 'El cierre mantiene su espacio durante el fade.')
    assert.equal(await evaluate('document.activeElement===document.querySelector(".nav-drop > button")'), true)
    assert.equal(await evaluate('document.querySelector(".nav-toggle").getAttribute("aria-expanded")'), 'true', 'Escape cierra el dropdown antes que el menú.')
    await wait('!document.querySelector(".nav-drop.is-closing")')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".dropdown")).visibility'), 'hidden')
    console.log('Navbar móvil: cierre con fade, aria-expanded, inert y foco conservado: OK.')
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".nav-links")).boxShadow'), 'none', 'Abierto, el cajón del menú proyecta su sombra.')

    await key('Escape')
    await wait('document.querySelector(".nav-toggle").getAttribute("aria-expanded")==="false"')
    await wait('document.activeElement.classList.contains("nav-toggle")')
    assert.equal(await evaluate('document.activeElement.classList.contains("nav-toggle")'), true)
    await sleep(450)
    // Regresión: con el menú móvil cerrado no puede quedar sombra ni nada del cajón dentro de la pantalla (antes se colaba por el borde derecho).
    assert.deepEqual(JSON.parse(await evaluate('(()=>{const panel=document.querySelector(".nav-links");const style=getComputedStyle(panel);return JSON.stringify({shadow:style.boxShadow,outside:panel.getBoundingClientRect().left>=innerWidth,overflow:document.documentElement.scrollWidth<=innerWidth,inert:panel.inert})})()')), { shadow: 'none', outside: true, overflow: true, inert: true }, 'Menú móvil cerrado: sin sombra en el borde derecho, fuera de pantalla e inerte.')
    console.log('Navbar móvil: sin sombra residual con el menú cerrado: OK.')
    await evaluate('document.querySelector(".home-conv-card").click()')
    await wait('!!document.querySelector("#convModal[open]")')
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#convModal")).display'), 'block')
    await capture('home-mobile-convenio-dialog', '#convModal')
    assert.equal(await evaluate('(()=>{const rect=document.querySelector("#convModal").getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.height<=innerHeight})()'), true)
    await evaluate('document.querySelector("#convClose").click()')
    await wait('!document.querySelector("#convModal")')

    await evaluate('document.querySelector(".hc-launcher").focus();document.querySelector(".hc-launcher").click()')
    await wait('!!document.querySelector("#horus-chat[open]")')
    await evaluate('(()=>{const input=document.getElementById("hc-question");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Consulta de prueba");input.dispatchEvent(new Event("input",{bubbles:true}));})()')
    await sleep(100)
    await evaluate('document.getElementById("hc-question").form.requestSubmit()')
    await wait('document.querySelector(".hc-log").textContent.includes("Respuesta de prueba del asistente.")')
    assert.equal(chatRequests, 1)
    await key('Escape')
    await wait('!document.querySelector("#horus-chat[open]")')
    await wait('document.activeElement.classList.contains("hc-launcher")')
    assert.equal(await evaluate('document.activeElement.classList.contains("hc-launcher")'), true)

    await openConvenio(1)
    assert.equal(await evaluate('(()=>{const d=document.querySelector("#convModal");return d.scrollHeight>d.clientHeight&&d.getBoundingClientRect().height<=innerHeight&&d.scrollWidth<=d.clientWidth})()'), true, 'Texto largo desplazable dentro del diálogo móvil')
    await key('Escape'); await wait('!document.querySelector("#convModal")')
    await openConvenio(3)
    await evaluate('(()=>{const target=document.querySelector(".home-conv-gallery");target.scrollIntoView({block:"center"});const a=new Touch({identifier:1,target,clientX:240,clientY:200}),b=new Touch({identifier:1,target,clientX:100,clientY:205});target.dispatchEvent(new TouchEvent("touchstart",{touches:[a],changedTouches:[a],bubbles:true}));target.dispatchEvent(new TouchEvent("touchend",{touches:[],changedTouches:[b],bubbles:true}));})()')
    await wait('document.querySelector(".home-conv-photo figcaption").textContent === "Fotografía 2 de 2"')
    assert.equal(await evaluate('document.querySelector(".home-conv-photo figcaption").textContent'), 'Fotografía 2 de 2', 'Swipe móvil')
    await focusControl('[aria-label="Fotografía anterior"]')
    await press('Enter'); await assertFocusWhileBusy(); await caption(1)
    await press('Tab')
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Fotografía siguiente')
    await evaluate('(()=>{window.__focusedConvenioControl=document.activeElement})()')
    await press('Space'); await assertFocusWhileBusy(); await caption(2)
    await press('Tab', true)
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Fotografía anterior', 'Navegación entre flechas dentro del diálogo móvil.')
    await capture('home-mobile-galeria', '#convModal')
    await key('Escape'); await wait('!document.querySelector("#convModal")')
    await evaluate('document.querySelector(".home-conv-card").focus()')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    await wait('!!document.querySelector("#convDesc")')
    await key('Escape'); await wait('!document.querySelector("#convModal")')
    assert.equal(await evaluate('document.activeElement.classList.contains("home-conv-card")'), true)

    console.log('Home: tamaños 320–1920 px, menú móvil, diálogo y chatbot conectado a fixtures: OK.')

    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await wait('!document.querySelector(".home-carousel-pause")')
    await evaluate('document.querySelector(".home-hero-copy a").focus()')
    const imageBefore = await evaluate('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").getAttribute("aria-label")')
    await sleep(5200)
    assert.equal(await evaluate('document.querySelector(".home-hero-thumbnails [aria-pressed=true]").getAttribute("aria-label")'), imageBefore)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-slide")).transitionDuration'), '0s')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-loc-item")).opacity'), '1')

    await openConvenio(3)
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#convModal")).animationName'), 'none')
    await key('Escape'); await wait('!document.querySelector("#convModal")')

    await send('Emulation.setEmulatedMedia', { features: [] })
    await viewport(1440)
    await evaluate('document.querySelector(".nav-logo").click()')
    await wait('location.pathname === "/"')
    await evaluate('document.querySelector(".nav-links a[href=\\"/quienes-somos\\"]").click()')
    await wait('location.pathname === "/quienes-somos" && !document.querySelector(".home-layout") && !!document.querySelector(".site-layout")')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav")).height'), '78px', 'La navbar interior comparte la altura de Home.')
    await wait('getComputedStyle(document.querySelector(".nav")).backgroundColor === "rgb(10, 37, 64)"')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav")).backgroundColor'), 'rgb(10, 37, 64)')
    await evaluate('document.querySelector(".nav-logo").click()')
    await wait('!!document.querySelector(".home-layout")')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav")).height'), '78px')
    assert.equal(await evaluate('window.__homeWelcomeReview.appearances'), 1, 'La bienvenida no se repite en navegación interna.')
    await navigate('/educacion/cursos')
    await wait('document.querySelector(".edu-card")?.textContent.includes("Curso de prueba pagina 1")')
    await evaluate('Array.from(document.querySelectorAll(".tech-pagination button")).find(button=>button.textContent==="Siguiente").click()')
    await wait('document.querySelector(".edu-card")?.textContent.includes("Curso de prueba pagina 2")')
    assert.equal(courseRequests.some(query=>{const params=new URLSearchParams(query);return params.get("tipo")==="curso"&&params.get("page")==="2"}), true)
    await evaluate('document.querySelector(".nav-logo").click()')
    await wait('!!document.querySelector(".home-layout")')
    await sleep(800)
    assert.equal(await evaluate('window.__homeWelcomeReview.appearances'), 0, 'Entrar por una página interna no muestra bienvenida al volver a Home.')
    await navigate('/educacion/capacitaciones')
    await wait('document.querySelector(".edu-card")?.textContent.includes("Capacitacion de prueba pagina 1")')
    assert.equal(await evaluate('document.querySelector(".edu-grid").textContent.includes("Curso de prueba")'), false)
    await evaluate('Array.from(document.querySelectorAll(".tech-pagination button")).find(button=>button.textContent==="Siguiente").click()')
    await wait('document.querySelector(".edu-card")?.textContent.includes("Capacitacion de prueba pagina 2")')
    assert.equal(courseRequests.some(query=>{const params=new URLSearchParams(query);return params.get("tipo")==="capacitacion"&&params.get("page")==="2"}), true)
    console.log('CourseCatalog: filtros curso/capacitacion conservados en la paginacion: OK.')
    await evaluate('localStorage.removeItem("horus-admin-token")')
    await navigate('/admin/dashboard')
    await wait('location.pathname === "/admin/login"')
    assert.equal(await evaluate('!!document.querySelector(".home-layout")'), false)

    settingsFailure = true
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await viewport(320, 844)
    await navigate('/')
    await wait('typeof window.__homeWelcomeReview?.end === "number"')
    const reducedWelcome = await evaluate('window.__homeWelcomeReview')
    assert.equal(reducedWelcome.appearances, 1)
    assert.equal(reducedWelcome.animation, 'none')
    assert.ok(reducedWelcome.duration < 1000, 'Bienvenida estática breve incluso si falla la API.')
    await send('Emulation.setEmulatedMedia', { features: [] })
    console.log('Home: bienvenida reducida sin animación e independiente de errores de la API: OK.')

    await wait('document.querySelector(".home-loc-items").textContent.includes("Horario por confirmar")')
    assert.equal(await evaluate('document.querySelector(".footer").textContent.includes("Horus Group SRL")'), true)
    assert.equal(await evaluate('document.querySelectorAll(".home-conv-card").length'), 5)
    settingsFailure = false
    await evaluate('window.dispatchEvent(new CustomEvent("horus:content-updated",{detail:"settings"}))')
    await wait('document.querySelector(".home-loc-items").textContent.includes("Martes: 10:00–14:00")')
    assert.deepEqual(connection.exceptions, [], 'Errores JavaScript en la revisión.')
    console.log('Home: movimiento reducido, estilos aislados, React Router, guard administrativo y recuperación de ajustes: OK.')
    console.log('Revisión de Home terminada correctamente.')
  } finally {
    if (connection) connection.socket.close()
    cleanup?.()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close() })
