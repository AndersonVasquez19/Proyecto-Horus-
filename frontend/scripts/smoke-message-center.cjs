// Centro de atención (D6.1) con API simulada: registro manual dentro de la bandeja, ?crear=1 heredado y exportación CSV paginada.
// Nada real: ni datos, ni sesiones, ni correo. Edge por DevTools; las peticiones a otros orígenes se bloquean antes de enviarse.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../dist');
const edge = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';
const TOKEN = 'e30.' + Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') + '.d61';
const TOKEN2 = 'e30.' + Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') + '.d62'; // misma cuenta, sesión renovada
const TOTAL = 230; // 3 páginas de 100 al exportar

// ---------- API simulada ----------
const sim = { postMode: 'ok', postDelay: 0, failPage: 0, growAt: 0, pageDelay: 0, expired: 0, hangPage: 0, revokeA: 0, deleteMode: 'ok' };
const QUOTED = new Set([9]); // consulta con cotización vinculada (el id 7 tiene seguimiento)
let messages, attention, posts, listRequests, nextId, attempts, deletes;
const estadoOf = id => id % 5 === 0 ? 'archivado' : id % 3 === 0 ? 'atendido' : id % 2 === 0 ? 'en_proceso' : 'nuevo';
const build = id => ({ id, nombre: id === 3 ? '=cmd|x' : 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654321',
  asunto: id === 4 ? '+1' : id === 6 ? '-1' : id === 8 ? '@x' : (id % 7 === 0 ? '[Chatbot] ' : '') + 'Asunto ' + id + (id % 10 === 0 ? ' Especial' : ''),
  mensaje: 'Mensaje ' + id, estado: estadoOf(id), createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z' });
const reset = () => {
  messages = Array.from({ length: TOTAL }, (_, i) => build(TOTAL - i)); nextId = TOTAL + 1;
  attention = { 7: { estado: 'archivado', responsable: '', notas: 'NOTA PRIVADA', respuesta: 'RESPUESTA INTERNA', revision: 3, historial: [] } };
  posts = []; listRequests = []; attempts = 0; deletes = []; Object.assign(sim, { postMode: 'ok', postDelay: 0, failPage: 0, growAt: 0, pageDelay: 0, expired: 0, hangPage: 0, revokeA: 0, deleteMode: 'ok' });
};
reset();
const seg = id => attention[id] || { estado: messages.find(m => m.id === id)?.estado || 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (route === '/__clear') { reset(); return json({ ok: true }); }
    if (route === '/__set') { for (const [k, v] of url.searchParams) sim[k] = isNaN(Number(v)) ? v : Number(v); return json({ ok: true }); }
    if (route === '/__state') return json({ posts, listRequests, attention, attempts, deletes, total: messages.length, created: messages.filter(x => x.id > TOTAL).length });
    if (route.startsWith('/api/')) {
      if (route === '/api/settings') return json({ ok: true, settings: {} });
      if (route.startsWith('/api/admin/')) {
        if (req.method === 'POST' && route === '/api/admin/messages') attempts++; // intentos recibidos, aunque la sesión esté caducada
        if ((token !== TOKEN && token !== TOKEN2) || sim.expired || (token === TOKEN && sim.revokeA)) return json({ message: 'Unauthorized' }, 401);
        const sub = route.slice('/api/admin/'.length); let m;
        if (sub === 'me') return json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } });
        if (sub === 'messages' && req.method === 'POST') {
          const data = await body(); posts.push({ route: sub, data });
          if (sim.postDelay && sim.postMode !== 'slowCreated') await sleep(sim.postDelay);
          if (sim.postMode === 'reject') return json({ message: 'El correo electrónico no es válido.' }, 400);
          if (sim.postMode === 'error500') return json({ message: 'Internal server error' }, 500);
          const created = { ...build(nextId), nombre: data.nombre, email: data.email, telefono: data.telefono || '', asunto: data.asunto, mensaje: data.mensaje, estado: 'nuevo' }; nextId++; messages.unshift(created);
          if (sim.postMode === 'dropAfter') return req.socket.destroy(); // creada, pero la respuesta nunca llega
          if (sim.postMode === 'garbled') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>proxy</html>'); } // 200 con cuerpo ilegible
          if (sim.postMode === 'slowCreated') await sleep(sim.postDelay || 1500); // creada, pero responde cuando el navegador ya canceló
          return json({ ok: true, mensaje: 'Mensaje creado correctamente.', message: created }, 201);
        }
        if (sub === 'messages') {
          const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
          listRequests.push(url.search);
          if (sim.pageDelay && limit === 100) await sleep(sim.pageDelay);
          if (sim.hangPage && page === sim.hangPage && limit === 100) await sleep(2500); // una página tarda más que el tiempo de espera
          if (sim.failPage && page === sim.failPage && limit === 100) return json({ message: 'Internal server error ER_SECRET' }, 500);
          const estado = url.searchParams.get('estado'), search = (url.searchParams.get('search') || '').toLowerCase(), channel = url.searchParams.get('channel');
          const rows = messages.filter(x => (!estado || x.estado === estado) && (!search || [x.nombre, x.asunto, x.email, x.mensaje].some(v => v.toLowerCase().includes(search)))
            && (channel !== 'chatbot' || x.asunto.startsWith('[Chatbot]')) && (channel !== 'other' || !x.asunto.startsWith('[Chatbot]')));
          const metrics = Object.fromEntries(['nuevo', 'en_proceso', 'atendido', 'archivado'].map(s => [s, messages.filter(x => x.estado === s).length]));
          const answer = json({ ok: true, messages: rows.slice((page - 1) * limit, page * limit), pagination: { total: rows.length, page, limit, pages: Math.ceil(rows.length / limit) }, metrics });
          if (sim.growAt && page === sim.growAt - 1 && limit === 100) { messages.unshift(build(nextId++)); sim.growAt = 0; } // alguien registra una consulta durante la descarga
          return answer;
        }
        if ((m = sub.match(/^messages\/(\d+)$/)) && req.method === 'DELETE') {
          const id = +m[1]; deletes.push({ id }); const index = messages.findIndex(x => x.id === id);
          if (index < 0) return json({ message: 'Mensaje no encontrado.' }, 404);
          if (attention[id] || QUOTED.has(id)) return json({ message: 'El mensaje tiene cotizaciones vinculadas. Conserva su registro.' }, 409); // el backend usa este texto para ambas causas
          if (sim.deleteMode === 'error500') return json({ message: 'Internal server error ER_SECRET' }, 500);
          messages.splice(index, 1);
          if (sim.deleteMode === 'dropDeleted') return req.socket.destroy(); // borrada, pero la respuesta nunca llega
          if (sim.deleteMode === 'slowDeleted') await sleep(1500); // borrada, pero responde cuando el navegador ya canceló
          if (sim.deleteMode === 'slowOk') await sleep(600);
          return json({ ok: true, mensaje: 'Mensaje eliminado correctamente.' });
        }
        if ((m = sub.match(/^messages\/(\d+)$/))) { const one = messages.find(x => x.id === +m[1]); return one ? json({ ok: true, message: one }) : json({ message: 'No encontrado' }, 404); }
        if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/))) {
          const id = +m[1];
          if (req.method === 'GET') return json({ ok: true, item: { ...seg(id), envios: { respuesta: null, constancia: null } } });
          const data = await body(); posts.push({ route: sub, method: 'PUT', data }); attention[id] = { ...seg(id), ...data, revision: seg(id).revision + 1, historial: [] };
          return json({ ok: true, item: { ...attention[id], envios: { respuesta: null, constancia: null } } });
        }
        return json({ ok: true, items: [], messages: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} });
      }
      return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 } });
    }
    let file = path.resolve(root, '.' + decodeURIComponent(route));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.statusCode = 500; res.end('Fixture failure'); }
});

// ---------- DevTools ----------
function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let seq = 0;
  socket.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const r = pending.get(m.id); pending.delete(m.id); m.error ? r?.reject(new Error(m.error.message)) : r?.resolve(m.result); } };
  const ready = new Promise((a, b) => { socket.onopen = a; socket.onerror = b; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200)); return r.result.value; };
  return { socket, ready, send, evaluate };
}
function newestMtime(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); n = Math.max(n, e.isDirectory() ? newestMtime(f) : fs.statSync(f).mtimeMs); } return n; }

async function main() {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Falta dist/: ejecuta "npm run build".');
  if (newestMtime(path.resolve(__dirname, '../src')) > fs.statSync(path.join(root, 'index.html')).mtimeMs) throw new Error('dist/ está desactualizado respecto a src/: ejecuta "npm run build" antes del smoke.');
  if (!fs.existsSync(edge)) throw new Error('Configura SMOKE_BROWSER con una instalación de Edge/Chromium.');
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-center-');
  const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' });
  const cleanup = require('./smoke-cleanup.cjs')(child, profile, server);
  let version; for (let i = 0; i < 100 && !version; i++) { await sleep(100); try { version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); } catch { /* arrancando */ } }
  const bc = connect(version.webSocketDebuggerUrl); await bc.ready;
  const jsErrors = [], blocked = []; let fails = 0, page;
  const ck = (cond, name, detail = '') => { console.log((cond ? '  OK  ' : ' FALLA ') + name + (cond ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400))); if (!cond) fails++; };

  async function open(width = 1280, height = 900) {
    const { targetId } = await bc.send('Target.createTarget', { url: 'about:blank' });
    const target = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.id === targetId);
    const p = connect(target.webSocketDebuggerUrl); await p.ready; await p.send('Runtime.enable'); await p.send('Page.enable');
    p.socket.addEventListener('message', e => { const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') jsErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
      if (m.method === 'Fetch.requestPaused') { // todo lo que no sea el servidor simulado se bloquea antes de enviarse
        const { requestId, request } = m.params; let allowed = false;
        try { const u = new URL(request.url); allowed = u.origin === origin || u.protocol === 'data:' || u.protocol === 'blob:'; } catch { allowed = false; }
        if (allowed) p.send('Fetch.continueRequest', { requestId }).catch(() => {});
        else { blocked.push({ method: request.method, url: request.url.slice(0, 100) }); p.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); } } });
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
    p.wait = async (expression, what, timeout = 10000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await p.evaluate('!!(' + expression + ')')) return true; } catch { /* navegando */ } await sleep(100); } let seen = ''; try { seen = await p.evaluate("location.pathname + location.search + ' :: ' + document.body.innerText.slice(0, 160).replace(/\\s+/g, ' ')"); } catch { /* sin página */ } throw new Error('Tiempo agotado esperando ' + what + ' [' + seen + ']'); };
    p.go = async (route, ready = 'document.querySelector(".hp-body, .admin-auth")') => { await p.send('Page.navigate', { url: origin + route }); await sleep(300); if (!route.startsWith('/__')) await p.wait(ready, 'la página ' + route); };
    p.close = async () => { try { p.socket.close(); await bc.send('Target.closeTarget', { targetId }); } catch { /* ya cerrada */ } };
    return p;
  }
  const set = params => fetch(origin + '/__set?' + new URLSearchParams(params));
  const state = () => fetch(origin + '/__state').then(r => r.json());
  const D = 'dialog.hp-dialog[open]';
  const SETTER = "(el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }";
  const fill = (selector, value) => page.evaluate('(() => { const set = ' + SETTER + '; set(document.querySelector(' + JSON.stringify(selector) + '), ' + JSON.stringify(value) + '); return 1 })()');
  const fillForm = async (extra = {}) => { const v = { nombre: 'Persona manual', email: 'manual@example.test', asunto: 'Asunto manual', mensaje: 'Texto de la consulta manual', ...extra };
    for (const key of ['nombre', 'email', 'asunto', 'mensaje']) await fill('#manual-message-' + key, v[key]); };
  const clickBtn = (scope, text) => page.evaluate("(() => { const b = [...document.querySelectorAll(" + JSON.stringify(scope + ' button') + ")].find(x => x.textContent.trim().includes(" + JSON.stringify(text) + ") || x.getAttribute('aria-label') === " + JSON.stringify(text) + "); if (!b) throw new Error('sin botón ' + " + JSON.stringify(text) + "); b.click(); return 1 })()");
  const text = () => page.evaluate('document.body.innerText');
  const dialogOpen = () => page.evaluate("!!document.querySelector('" + D + " form')");
  const unsavedOpen = () => page.evaluate("!!document.querySelector('dialog.hp-unsaved-dialog[open]')");
  // `fast`: los tiempos de espera de 20 s (registro) y 15 s (páginas de exportación) se acortan en la página de prueba para no esperar de verdad.
  const FAST = "(() => { const st = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...a) => st(fn, ms === 20000 ? 300 : ms, ...a); const ts = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = ms => ts(ms === 15000 ? 400 : ms); const nativeFetch = window.fetch.bind(window); window.__postCalls = 0; window.fetch = (url, init) => { if (String(url).includes('/admin/messages') && init && init.method === 'POST') window.__postCalls++; return nativeFetch(url, init); }; })()";
  const session = async (route, width, fast = false) => { await fetch(origin + '/__clear'); if (page) await page.close(); page = await open(width); if (fast) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FAST }); await page.go('/__empty'); await page.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN) + '); 1'); await page.go(route); };
  const inbox = async (route = '/admin/messages', width, fast = false) => { await session(route, width, fast); await page.wait('document.querySelector(".hw-inbox-list button")', 'bandeja'); };
  // La descarga del CSV se intercepta en la página: se lee el Blob y NO se escribe ningún archivo en el equipo.
  const captureDownloads = () => page.evaluate("(() => { window.__dl = []; const original = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { const name = this.download; fetch(this.href).then(r => r.text()).then(t => window.__dl.push({ name, text: t })); return; } return original.call(this); }; return 1 })()");
  const downloads = () => page.evaluate('window.__dl');
  const csvLines = t => t.replace('\uFEFF', '').split('\r\n');
  const exportNow = async () => { await clickBtn('.hw-inbox ~ footer, section.hp-card', 'Exportar resultados'); };
  const pressKey = async (key, code, vk, extra = {}) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...extra }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); await sleep(120); };

  console.log('\n== CENTRO DE ATENCIÓN D6.1–D6.2 — REGISTRO MANUAL, EXPORTACIÓN, VISTA TABLA Y ELIMINACIÓN');
  { // 1 y 2. Apertura desde la bandeja; cancelación con formulario limpio
    await inbox(); await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo');
    const urlAfterOpen = await page.evaluate('location.pathname + location.search');
    ck(await dialogOpen() && urlAfterOpen === '/admin/messages', '1. «Registro manual» abre el formulario dentro de la bandeja, sin cambiar de página (URL intacta)', urlAfterOpen);
    ck(await page.evaluate("document.activeElement?.id === 'manual-message-nombre'"), '1. el foco inicial está en el primer campo');
    ck(await page.evaluate("!!document.querySelector('.hw-inbox')"), '1. la bandeja sigue montada debajo del diálogo');
    await clickBtn(D, 'Cancelar'); await sleep(150);
    ck(!(await dialogOpen()) && !(await unsavedOpen()) && (await state()).posts.length === 0, '2. cancelar con el formulario limpio cierra sin avisar y sin enviar nada'); }

  { // 3. Cancelación con borrador pendiente
    await inbox(); await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await fill('#manual-message-nombre', 'Borrador');
    await clickBtn(D, 'Cancelar'); await page.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso de cambios');
    await clickBtn('dialog.hp-unsaved-dialog[open]', 'Seguir editando'); await sleep(150);
    ck(await dialogOpen() && (await page.evaluate("document.querySelector('#manual-message-nombre').value")) === 'Borrador', '3. con borrador, «Seguir editando» conserva el formulario y lo escrito');
    await clickBtn(D, 'Cancelar'); await page.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso otra vez'); await clickBtn('dialog.hp-unsaved-dialog[open]', 'Descartar'); await sleep(200);
    ck(!(await dialogOpen()) && (await state()).posts.length === 0, '3. «Descartar» cierra sin enviar nada'); }

  { // 4. POST exitoso
    await inbox(); const before = (await state()).listRequests.length; await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await fillForm();
    await page.evaluate("document.querySelector('" + D + " form').requestSubmit(); 1"); await page.wait('document.body.innerText.includes("Consulta registrada")', 'confirmación');
    const s = await state();
    ck(!(await dialogOpen()) && s.posts.length === 1 && JSON.stringify(Object.keys(s.posts[0].data).sort()) === JSON.stringify(['asunto', 'email', 'mensaje', 'nombre']) && s.posts[0].data.nombre === 'Persona manual', '4. el POST lleva los datos escritos (teléfono vacío omitido) y el diálogo se cierra al confirmar', s.posts);
    await page.wait('document.querySelector(".hw-inbox-list button")?.innerText.includes("Persona manual")', 'lista actualizada');
    ck(s.listRequests.length > before && (await page.evaluate("document.querySelector('.hw-inbox-list button').innerText")).includes('Asunto manual'), '4. la bandeja se recarga y muestra la consulta nueva al inicio'); }

  { // 5. POST fallido: rechazo (4xx) y resultado incierto (5xx)
    await inbox(); await set({ postMode: 'reject' }); await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await fillForm();
    await page.evaluate("document.querySelector('" + D + " form').requestSubmit(); 1"); await page.wait('document.querySelector("' + D + ' [role=alert]")', 'error');
    let t = await page.evaluate("document.querySelector('" + D + " [role=alert]').innerText");
    ck(t.includes('no es válido') && await dialogOpen() && !(await text()).includes('Consulta registrada') && (await page.evaluate("document.querySelector('#manual-message-asunto').value")) === 'Asunto manual', '5. rechazo del servidor: mensaje claro, el diálogo sigue abierto y el borrador se conserva', t);
    await set({ postMode: 'error500' }); await page.evaluate("document.querySelector('" + D + " form').requestSubmit(); 1"); await page.wait('document.querySelector("' + D + ' [role=alert]")?.innerText.includes("No pudimos confirmar")', 'incierto');
    t = await page.evaluate("document.querySelector('" + D + " [role=alert]').innerText");
    ck(!/Internal server|ER_SECRET|Failed to fetch/.test(t) && await dialogOpen(), '5. un 5xx se presenta como incierto (revisar antes de reintentar), sin texto técnico', t); }

  { // 6. Doble clic / doble envío
    await inbox(); await set({ postDelay: 500 }); await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await fillForm();
    await page.evaluate("(() => { const f = document.querySelector('" + D + " form'); f.requestSubmit(); f.requestSubmit(); return 1 })()");
    await page.wait('document.body.innerText.includes("Consulta registrada")', 'confirmación'); await sleep(300);
    ck((await state()).posts.length === 1, '6. dos envíos seguidos producen una sola petición', (await state()).posts.length); }

  { // 7. Sesión caducada durante el envío
    await inbox(); await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await fillForm();
    await set({ expired: 1 }); await page.evaluate("document.querySelector('" + D + " form').requestSubmit(); 1");
    await page.wait('location.pathname.startsWith("/admin/login")', 'redirección al inicio de sesión');
    const storage = await page.evaluate('JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])');
    ck((await state()).attempts === 1 && (await state()).posts.length === 0 && !/Persona manual|manual@example|Texto de la consulta/.test(storage), '7. sesión caducada: se vuelve al inicio de sesión, sin reenviar y sin borradores en el almacenamiento', { posts: (await state()).posts.length, storage }); }

  { // 8. Refrescar sin cerrar el detalle ni perder el borrador de seguimiento
    await inbox('/admin/messages?id=5'); await page.wait('document.querySelector(".hw-inbox-detail fieldset textarea")', 'editor');
    await fill('.hw-inbox-detail fieldset textarea', 'Borrador de notas D2');
    await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await fillForm();
    await page.evaluate("document.querySelector('" + D + " form').requestSubmit(); 1"); await page.wait('document.body.innerText.includes("Consulta registrada")', 'confirmación'); await sleep(400);
    const kept = await page.evaluate("({ path: location.pathname + location.search, notes: document.querySelector('.hw-inbox-detail fieldset textarea').value, heading: document.querySelector('.hw-detail-heading small')?.innerText })");
    ck(kept.path === '/admin/messages?id=5' && kept.notes === 'Borrador de notas D2' && kept.heading === 'Consulta #5' && !(await state()).posts.some(p => p.method === 'PUT'), '8. tras registrar y recargar, el detalle abierto y el borrador de seguimiento siguen intactos', kept); }

  { // 9. URL heredada ?crear=1
    for (const route of ['/admin/messages?crear=1', '/admin/dashboard?section=mensajes&crear=1']) {
      await session('/__empty'); await page.go(route, 'document.querySelector("' + D + ' form")');
      ck(await page.evaluate("!!document.querySelector('.hw-inbox')") && await dialogOpen(), '9. ' + route + ' abre el registro manual dentro de la bandeja');
      await clickBtn(D, 'Cancelar'); await sleep(250);
      ck(!(await page.evaluate('location.search')).includes('crear') && !(await dialogOpen()), '9. al cerrar se retira «crear» de la URL', await page.evaluate('location.pathname + location.search'));
      await page.evaluate('history.back(); 1'); await sleep(400);
      ck((await page.evaluate('location.pathname')) === '/__empty' && !(await dialogOpen()), '9. Atrás sale de la pantalla (no reabre el diálogo: sin bucle de navegación)', await page.evaluate('location.pathname + location.search')); }
    await session('/admin/messages?id=3&crear=1'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo con id');
    await clickBtn(D, 'Cancelar'); await sleep(250);
    ck((await page.evaluate('location.pathname + location.search')) === '/admin/messages?id=3', '9. al cerrar se conservan los demás parámetros (?id=3)'); }

  { // 10. D6.3 fase A: todas las URL de mensajes abren la bandeja moderna, con sus parámetros intactos
    const probe = async route => {
      await session(route); await page.wait('document.querySelector(".hw-inbox-table tbody tr, .hw-inbox-list > button, .hw-inbox-list .hp-empty")', 'listado de ' + route);
      if (route.includes('crear=1')) await page.wait('document.querySelector("' + D + ' form")', 'registro manual en ' + route);
      await sleep(250);
      return page.evaluate('({ url: location.pathname + location.search, inbox: !!document.querySelector(".hw-inbox"), table: !!document.querySelector(".hw-inbox-table"), cards: document.querySelectorAll(".hw-inbox-list > button").length, dialog: !!document.querySelector("' + D + ' form"), detail: document.querySelector(".hw-detail-heading small")?.innerText || "", estado: document.querySelector("select[aria-label=\\"Estado de atención\\"]")?.value, legacy: !!document.querySelector(".hp-table:not(.hw-inbox-table)") })');
    };
    const cases = [
      ['/admin/messages', { table: false }], ['/admin/messages?id=221', { table: false, detail: 'Consulta #221' }], ['/admin/messages?estado=archivado', { table: false, estado: 'archivado' }],
      ['/admin/messages?vista=tabla', { table: true }], ['/admin/dashboard?section=mensajes', { table: false }], ['/admin/dashboard?section=mensajes&vista=tabla', { table: true }],
      ['/admin/dashboard?section=mensajes&crear=1', { table: false, dialog: true }], ['/admin/dashboard?section=mensajes&vista=tabla&crear=1', { table: true, dialog: true }],
      ['/admin/messages?vista=tabla&id=220&estado=archivado', { table: true, detail: 'Consulta #220', estado: 'archivado' }], ['/admin/messages?vista=tabla&crear=1&id=220', { table: true, dialog: true, detail: 'Consulta #220' }],
      ['/admin/messages?vista=tabla&id=abc', { table: true, detail: '' }], ['/admin/messages?listado=tabla', { table: true }],
    ];
    for (const [route, expected] of cases) {
      const got = await probe(route);
      const wrong = Object.entries({ inbox: true, legacy: false, dialog: false, detail: '', ...expected }).filter(([key, value]) => got[key] !== value);
      ck(wrong.length === 0 && got.url === route, '10. ' + route + ' abre la bandeja moderna (' + (expected.table ? 'vista Tabla' : 'vista Bandeja') + (expected.dialog ? ', con el registro manual' : '') + ') y conserva la URL', { got, wrong });
    }
    // Regla de alcance: vista= en otras secciones no abre la bandeja. Cursos y servicios ya no se gestionan en el panel: su dirección
    // antigua muestra el aviso de gestión retirada (separación del contenido institucional).
    await session('/admin/dashboard?section=cursos&seccion=cursos&vista=tabla'); await page.wait('document.querySelector("[data-panel-editorial-retired]")', 'cursos');
    ck(await page.evaluate('!document.querySelector(".hw-inbox")'), '10. vista=tabla en cursos no abre la bandeja (alias acotado a mensajes)');
    await session('/admin/dashboard?section=servicios&vista=tabla'); await page.wait('document.querySelector("[data-panel-editorial-retired]")', 'servicios');
    ck(await page.evaluate('!document.querySelector(".hw-inbox") && document.querySelector("h1").innerText !== "Centro de consultas"'), '10. vista=tabla en servicios no abre la bandeja de mensajes');
    // Atrás/Adelante con el alias: se conserva la URL de entrada y la vista; seleccionar añade una sola entrada
    const entry = '/admin/dashboard?section=mensajes&vista=tabla';
    await session(entry); await page.wait('document.querySelector(".hw-inbox-table tbody tr")', 'tabla'); const startHistory = await page.evaluate('history.length');
    await page.evaluate('document.querySelectorAll(".hw-inbox-table tbody tr button")[1].click(); 1'); await page.wait('location.search.includes("id=")', 'selección');
    const selectedUrl = await page.evaluate('location.pathname + location.search'), pushed = (await page.evaluate('history.length')) - startHistory;
    await page.evaluate('history.back(); 1'); await page.wait('!location.search.includes("id=")', 'Atrás');
    const back = await page.evaluate('({ url: location.pathname + location.search, table: !!document.querySelector(".hw-inbox-table") })');
    await page.evaluate('history.forward(); 1'); await page.wait('location.search.includes("id=")', 'Adelante');
    ck(pushed === 1 && back.url === entry && back.table && (await page.evaluate('location.pathname + location.search')) === selectedUrl, '10. con el alias, seleccionar añade una sola entrada al historial y Atrás/Adelante recorren la URL de entrada y la selección sin cambiar de vista', { pushed, back, selectedUrl }); }

  { // 11. Atrás y Adelante con el diálogo
    await inbox('/admin/messages?id=3'); await page.evaluate("document.querySelectorAll('.hw-inbox-list button')[1].click(); 1"); await sleep(250);
    const second = await page.evaluate('location.search');
    await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await clickBtn(D, 'Cancelar'); await sleep(200);
    ck((await page.evaluate('location.search')) === second, '11. abrir y cerrar el diálogo no añade entradas de historial');
    await page.evaluate('history.back(); 1'); await sleep(350); const back = await page.evaluate('location.search');
    await page.evaluate('history.forward(); 1'); await sleep(350);
    ck(back === '?id=3' && (await page.evaluate('location.search')) === second, '11. Atrás y Adelante recorren las consultas seleccionadas', { back, second }); }

  // ---------- Exportación
  { // 12. Más de una página, sin filtros
    await inbox(); await captureDownloads(); await set({}); await exportNow(); await page.wait('window.__dl.length === 1', 'descarga');
    const [file] = await downloads(), lines = csvLines(file.text), s = await state();
    const exportReq = s.listRequests.filter(q => q.includes('limit=100'));
    ck(lines.length === TOTAL + 1 && lines[0] === '"id","nombre","correo","telefono","asunto","origen","estado","fecha"' && /^consultas-\d{4}-\d{2}-\d{2}\.csv$/.test(file.name), '12. exporta las ' + TOTAL + ' consultas (3 páginas), con cabecera estable', { lines: lines.length, name: file.name });
    ck(exportReq.length === 3 && exportReq.every((q, i) => q.includes('page=' + (i + 1))) && s.listRequests.every(q => q.includes('page=')), '12. usa el endpoint paginado en lotes de 100, en serie y sin pedir el inventario completo', exportReq);
    ck(new Set(lines.slice(1).map(l => l.split(',')[0])).size === TOTAL, '12. sin registros repetidos');
    const row3 = lines.find(l => l.startsWith('"3",')), row4 = lines.find(l => l.startsWith('"4",')), row6 = lines.find(l => l.startsWith('"6",')), row8 = lines.find(l => l.startsWith('"8",'));
    ck(row3.includes(`"'=cmd|x"`) && row4.includes(`"'+1"`) && row6.includes(`"'-1"`) && row8.includes(`"'@x"`), '16. los valores que empiezan por =, +, - o @ se neutralizan', [row3, row4, row6, row8]);
    ck(lines.find(l => l.startsWith('"5",')).includes('"archivado"') && lines.find(l => l.startsWith('"7",')).includes('"Chatbot"'), '15. el estado archivado y el origen salen correctos');
    ck(!/NOTA PRIVADA|RESPUESTA INTERNA|historial/.test(file.text) && !s.listRequests.some(q => q.includes('seguimiento')), '19. no se exportan notas privadas, respuestas ni historial (ni se consulta el seguimiento)');
    ck(await page.evaluate("document.body.innerText.includes('Se exportaron " + TOTAL + " consultas.')"), '12. avisa del resultado solo cuando terminó'); }

  { // 13-15. Búsqueda, estado y origen
    await inbox(); await captureDownloads();
    await fill('input[aria-label="Buscar consultas"]', 'Especial'); await page.wait('document.body.innerText.includes("23 consultas coinciden")', 'búsqueda'); await exportNow(); await page.wait('window.__dl.length === 1', 'descarga');
    let lines = csvLines((await downloads())[0].text);
    ck(lines.length === 24 && lines.slice(1).every(l => l.includes('Especial')) && (await state()).listRequests.some(q => q.includes('search=Especial') && q.includes('limit=100')), '13. exporta solo lo que coincide con la búsqueda (23 filas), no la página visible', lines.length);
    await inbox(); await captureDownloads(); await page.evaluate("(() => { const set = " + SETTER + "; set(document.querySelector('select[aria-label=\"Estado de atención\"]'), 'archivado'); return 1 })()");
    await page.wait('document.body.innerText.includes("46 consultas coinciden")', 'filtro de estado'); await exportNow(); await page.wait('window.__dl.length === 1', 'descarga');
    lines = csvLines((await downloads())[0].text);
    ck(lines.length === 47 && lines.slice(1).every(l => l.includes('"archivado"')) && (await state()).listRequests.some(q => q.includes('estado=archivado') && q.includes('limit=100')), '14. exporta solo el estado filtrado (46 archivadas)', lines.length);
    await inbox(); await captureDownloads(); await page.evaluate("(() => { const set = " + SETTER + "; set(document.querySelector('select[aria-label=\"Origen de consulta\"]'), 'chatbot'); return 1 })()");
    await page.wait('document.body.innerText.includes("32 consultas coinciden")', 'filtro de origen'); await exportNow(); await page.wait('window.__dl.length === 1', 'descarga');
    lines = csvLines((await downloads())[0].text);
    ck(lines.length === 33 && lines.slice(1).every(l => l.includes('"Chatbot"')) && (await state()).listRequests.some(q => q.includes('channel=chatbot') && q.includes('limit=100')), '15b. exporta solo el origen filtrado (32 del chatbot)', lines.length); }

  { // 17-18. Error en una página intermedia / cambio durante la descarga
    await inbox(); await captureDownloads(); await set({ failPage: 2 }); await exportNow(); await page.wait('document.querySelector(".hp-card [role=alert]")', 'error de exportación'); await sleep(300);
    let t = await page.evaluate("document.querySelector('.hp-card [role=alert]').innerText");
    ck((await downloads()).length === 0 && /No se descargó ningún archivo/.test(t) && !/ER_SECRET|Internal/.test(t) && !(await text()).includes('Se exportaron'), '17-18. un fallo en la página 2 no descarga ningún archivo ni afirma éxito', t);
    await set({ failPage: 0 }); await exportNow(); await page.wait('window.__dl.length === 1', 'reintento manual');
    ck(csvLines((await downloads())[0].text).length === TOTAL + 1, '17. el reintento manual posterior sí completa la exportación');
    await inbox(); await captureDownloads(); await set({ growAt: 3 }); await exportNow(); await page.wait('document.querySelector(".hp-card [role=alert]")', 'cambio durante la descarga'); await sleep(300);
    t = await page.evaluate("document.querySelector('.hp-card [role=alert]').innerText");
    ck((await downloads()).length === 0 && /cambiaron mientras se exportaba/.test(t), '18. si los datos cambian durante la descarga se avisa y no se entrega un archivo inconsistente', t); }

  { // 18b. Cancelar; la interfaz sigue utilizable mientras se exporta
    await inbox(); await captureDownloads(); await set({ pageDelay: 700 }); await exportNow(); await page.wait('[...document.querySelectorAll(".hp-card button")].some(b => b.textContent.includes("Cancelar exportación"))', 'exportación en curso');
    ck(await page.evaluate("[...document.querySelectorAll('.hp-heading button')].find(b => b.textContent.includes('Registro manual')).disabled === false && !document.querySelector('.hw-inbox-list button').disabled"), '18b. mientras se exporta, el resto de la interfaz sigue activa');
    await clickBtn('.hp-card', 'Cancelar exportación'); await page.wait('document.querySelector(".hp-card [role=alert]")', 'cancelación'); await sleep(900);
    ck((await downloads()).length === 0 && /cancelada/.test(await page.evaluate("document.querySelector('.hp-card [role=alert]').innerText")), '18b. cancelar no descarga ningún archivo'); }

  { // 22. Móvil y teclado
    await inbox('/admin/messages', 390); await captureDownloads(); await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo móvil');
    const box = await page.evaluate("(() => { const r = document.querySelector('" + D + "').getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth, scroll: document.documentElement.scrollWidth } })()");
    ck(box.left >= 0 && box.right <= box.width + 1 && box.scroll <= box.width + 1, '22. en móvil (390 px) el diálogo cabe en la pantalla y no hay desplazamiento horizontal', box);
    ck(await page.evaluate("document.activeElement?.id === 'manual-message-nombre'"), '22. el foco inicial está en el primer campo');
    const order = []; for (let i = 0; i < 4; i++) { await pressKey('Tab', 'Tab', 9); order.push(await page.evaluate('document.activeElement?.id')); }
    ck(order.join() === 'manual-message-email,manual-message-telefono,manual-message-asunto,manual-message-mensaje', '22. Tab recorre los campos en orden', order);
    await fillForm(); await page.evaluate("document.getElementById('manual-message-email').focus(); 1"); await pressKey('Enter', 'Enter', 13, { text: '\r' });
    await page.wait('document.body.innerText.includes("Consulta registrada")', 'envío con Enter');
    ck((await state()).posts.length === 1, '22. Enter en un campo envía el formulario con el teclado');
    await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await pressKey('Escape', 'Escape', 27); await sleep(300);
    ck(!(await dialogOpen()) && await page.evaluate("document.activeElement?.textContent.includes('Registro manual')"), '22. Escape cierra el formulario limpio y devuelve el foco a «Registro manual»', await page.evaluate("document.activeElement?.tagName + ':' + document.activeElement?.textContent.slice(0, 30)")); }

  // ---------- Registro con resultado incierto (D6.1 ajustes)
  const openAndFill = async (extra = {}) => { await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await fillForm(extra); };
  const submitForm = () => page.evaluate("document.querySelector('" + D + " form').requestSubmit(); 1");
  const uncertainShown = () => page.wait('document.querySelector("' + D + ' [data-create-uncertain]")', 'aviso de resultado incierto');
  const draftKept = async () => (await page.evaluate("document.querySelector('#manual-message-nombre').value")) === 'Persona manual' && (await page.evaluate("document.querySelector('#manual-message-mensaje').value")) === 'Texto de la consulta manual';
  const focused = label => page.evaluate('document.activeElement?.tagName === "BUTTON" && document.activeElement.textContent.trim() === ' + JSON.stringify(label));
  const notice = () => page.evaluate("document.querySelector('" + D + " [data-create-uncertain]')?.innerText || ''");
  const focusedText = () => page.evaluate("(document.activeElement?.tagName || '') + ':' + (document.activeElement?.textContent || '').trim().slice(0, 40) + ':' + (document.activeElement?.dataset?.createUncertain || '')");

  { // 23-27. Timeout del registro (acortado a 300 ms): la consulta SÍ se creó, la respuesta llega tarde
    await inbox('/admin/messages', 1280, true); await set({ postMode: 'slowCreated', postDelay: 1500 }); await openAndFill(); await submitForm(); await uncertainShown();
    let s = await state(), n = await notice();
    ck(/No pudimos confirmar/.test(n) && !/no se registró|falló|error/i.test(n.replace('No pudimos confirmar si la consulta se registró', '')) && await dialogOpen() && await draftKept() && s.posts.length === 1, '23. timeout del registro: se avisa que el resultado es incierto, el diálogo sigue abierto y el borrador íntegro', n);
    ck(await page.evaluate("document.activeElement?.dataset?.createUncertain === 'uncertain'"), '23. el foco pasa al aviso', await focusedText());
    await sleep(1700); // llega la respuesta tardía de la consulta ya creada
    s = await state();
    ck(s.created === 1 && s.posts.length === 1 && !(await text()).includes('Consulta registrada') && await dialogOpen(), '24. la respuesta tardía (tras el timeout) no cierra el diálogo ni anuncia éxito; no hay un segundo POST automático', { created: s.created, posts: s.posts.length });
    await clickBtn(D, 'Comprobar en la bandeja'); await page.wait('document.querySelector("' + D + ' [data-create-matches] li")', 'comprobación');
    n = await notice();
    ck((await page.evaluate("document.querySelectorAll('" + D + " [data-create-matches] li').length")) === 1 && /Es posible que ya se haya registrado/.test(n) && /no podemos asegurar/.test(n) && (await state()).posts.length === 1, '25. «Comprobar en la bandeja» muestra la posible coincidencia como pista (no como prueba) sin enviar nada', n);
    await submitForm(); await page.wait('document.querySelector("' + D + ' [data-create-uncertain=confirming]")', 'confirmación');
    ck((await state()).posts.length === 1 && await focused('Volver') && /duplicad/.test(await notice()), '26. un segundo registro NO se envía: pide confirmación expresa, advierte del duplicado y enfoca «Volver»', { posts: (await state()).posts.length, focus: await focusedText() });
    await submitForm(); await sleep(150);
    ck((await state()).posts.length === 1, '26. repetir el envío (Enter) durante la confirmación tampoco envía');
    await clickBtn(D, 'Volver'); await sleep(150);
    ck(await dialogOpen() && await draftKept() && (await page.evaluate("document.activeElement?.dataset?.createUncertain === 'uncertain'")), '26. «Volver» mantiene el diálogo, el borrador y devuelve el foco al aviso', await focusedText());
    await clickBtn(D, 'Cancelar'); await page.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso de cambios'); await clickBtn('dialog.hp-unsaved-dialog[open]', 'Seguir editando'); await sleep(150);
    ck(await dialogOpen() && await draftKept(), '27. cancelar con duda y borrador pide confirmar; «Seguir editando» conserva todo');
    await set({ postMode: 'ok', postDelay: 0 }); await submitForm(); await page.wait('document.querySelector("' + D + ' [data-create-uncertain=confirming]")', 'confirmación');
    await clickBtn(D, 'Registrar de todos modos'); await page.wait('document.body.innerText.includes("Consulta registrada")', 'registro confirmado');
    s = await state();
    ck(s.posts.length === 2 && s.created === 2 && !(await dialogOpen()), '27. solo tras la confirmación explícita se envía el segundo POST (el duplicado es una decisión consciente)', { posts: s.posts.length, created: s.created }); }

  { // 28. Corte de red después de que el backend recibió y creó la consulta
    await inbox('/admin/messages', 1280, true); await set({ postMode: 'dropAfter' }); await openAndFill(); await submitForm(); await uncertainShown();
    const s = await state(), n = await notice();
    // Observación (no regla): con la conexión cortada sin respuesta, el servidor ficticio puede recibir más POST que las llamadas a fetch de la aplicación
    // (contador de fetch en la página). Las repeticiones se observaron en la capa de red de Edge y dependen de las condiciones de conexión; las reglas
    // exactas de reintento de Chromium no están verificadas. POST /admin/messages no garantiza idempotencia (ver AGENTS.md).
    const appCalls = await page.evaluate('window.__postCalls');
    console.log('  (info) llamadas de la aplicación: ' + appCalls + '; POST recibidos por el backend ficticio: ' + s.posts.length + '; consultas creadas: ' + s.created + (s.posts.length > appCalls ? ' — el servidor recibió más solicitudes que llamadas a fetch (capa de red de Edge; el backend no garantiza idempotencia)' : ''));
    ck(/No pudimos confirmar/.test(n) && !/Failed to fetch|NetworkError|TypeError/.test(n) && await dialogOpen() && await draftKept() && s.created >= 1 && appCalls === 1, '28. corte de red tras crear: resultado incierto, sin texto técnico y con el borrador íntegro', n);
    await clickBtn(D, 'Comprobar en la bandeja'); await page.wait('document.querySelector("' + D + ' [data-create-matches] li")', 'comprobación');
    ck((await page.evaluate("document.querySelectorAll('" + D + " [data-create-matches] li').length")) >= 1, '28. la comprobación muestra la consulta que el servidor sí creó'); }

  { // 29. 200 con cuerpo ilegible (p. ej. un proxy): la consulta se creó; NO es un rechazo definitivo
    await inbox(); await set({ postMode: 'garbled' }); await openAndFill(); await submitForm(); await uncertainShown();
    const n = await notice();
    ck(/No pudimos confirmar/.test(n) && !(await text()).includes('respuesta inválida') && (await state()).created === 1 && (await state()).posts.length === 1, '29. un 200 con cuerpo ilegible se trata como incierto (la consulta existe) y no como rechazo', n); }

  { // 30. Exportación: timeout de una página (acortado a 400 ms)
    await inbox('/admin/messages', 1280, true); await captureDownloads(); await set({ hangPage: 2 }); await exportNow();
    await page.wait('document.querySelector(".hp-card [role=alert]")', 'error por timeout'); await sleep(300);
    const t = await page.evaluate("document.querySelector('.hp-card [role=alert]').innerText");
    ck((await downloads()).length === 0 && /falló la página 2/.test(t) && /No se descargó ningún archivo/.test(t) && !(await text()).includes('Se exportaron'), '30. un timeout en la página 2 no descarga ningún archivo ni afirma éxito', t);
    await set({ hangPage: 0 }); await exportNow(); await page.wait('window.__dl.length === 1', 'reintento manual');
    ck(csvLines((await downloads())[0].text).length === TOTAL + 1, '30. tras el timeout, un reintento manual completa la exportación'); }

  { // 31. Exportación: la sesión cambia de token mientras se exporta (la cuenta renueva su sesión en otra pestaña)
    await inbox(); await captureDownloads(); await set({ pageDelay: 700 }); await exportNow();
    await page.wait('[...document.querySelectorAll(".hp-card button")].some(b => b.textContent.includes("Cancelar exportación"))', 'exportación en curso');
    const other = await open(); await other.go('/__empty'); await other.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN2) + '); 1'); await sleep(350); // la pestaña activa valida la sesión nueva en segundo plano
    await set({ revokeA: 1 }); // el token original deja de valer: la siguiente página de la exportación recibe 401
    await page.wait('document.querySelector(".hp-card [role=alert]")', 'exportación abortada', 12000); await sleep(400);
    const t = await page.evaluate("document.querySelector('.hp-card [role=alert]')?.innerText || ''");
    ck((await downloads()).length === 0 && /No se descargó ningún archivo/.test(t) && !(await text()).includes('Se exportaron'), '31. si el token cambia durante la exportación se aborta sin entregar un archivo', t);
    await other.close(); }

  // ---------- D6.2: vista Tabla integrada y eliminación protegida
  const viewTabs = '.hw-tabs[aria-label="Vista del listado"]';
  const switchView = name => page.evaluate('(() => { const b = [...document.querySelectorAll(' + JSON.stringify(viewTabs + ' button') + ')].find(x => x.textContent.trim() === ' + JSON.stringify(name) + '); b.click(); return 1 })()');
  const viewState = () => page.evaluate('({ table: !!document.querySelector(".hw-inbox-table"), cards: document.querySelectorAll(".hw-inbox-list > button").length, rows: document.querySelectorAll(".hw-inbox-table tbody tr").length, isTable: !!document.querySelector(".hw-inbox.is-table"), pressed: [...document.querySelectorAll(' + JSON.stringify(viewTabs + ' button') + ')].map(b => b.textContent.trim() + ":" + b.getAttribute("aria-pressed")).join() })');
  const subjects = () => page.evaluate('[...document.querySelectorAll(".hw-inbox-table tbody tr td strong, .hw-inbox-list > button .hw-inbox-subject")].map(x => x.innerText)');
  const detailId = () => page.evaluate('document.querySelector(".hw-detail-heading small")?.innerText || ""');
  const openRow = index => page.evaluate('document.querySelectorAll(".hw-inbox-table tbody tr button")[' + index + '].click(); 1');
  const selectEstado = value => page.evaluate('(() => { const set = ' + SETTER + '; set(document.querySelector(\'select[aria-label="Estado de atención"]\'), ' + JSON.stringify(value) + '); return 1 })()');
  const searchFor = async value => fill('input[aria-label="Buscar consultas"]', value);
  const metricArchivados = () => page.evaluate('Number([...document.querySelectorAll(".hw-insights button")].find(b => b.innerText.includes("Archivados")).querySelector("strong").innerText)');
  const waitText = (value, what) => page.wait('document.body.innerText.includes(' + JSON.stringify(value) + ')', what);
  const openDelete = async () => { await clickBtn('.hw-inbox-detail', 'Eliminar consulta'); await page.wait('document.querySelector("' + D + ' [data-autofocus]")', 'diálogo de eliminación'); };
  const delResult = () => page.wait('document.querySelector("' + D + ' [data-delete-result]")', 'resultado de la eliminación');
  const delText = () => page.evaluate('document.querySelector("' + D + ' [data-delete-result]")?.innerText || ""');
  const dialogOpen2 = () => page.evaluate('!!document.querySelector("' + D + '")');
  const activeInfo = () => page.evaluate('(document.activeElement?.tagName || "") + ":" + (document.activeElement?.textContent || "").trim().slice(0, 40) + ":" + (document.activeElement?.dataset?.deleteResult || "")');

  { // 32. Conmutador Bandeja ↔ Tabla (ratón y teclado)
    await inbox(); let v = await viewState();
    ck(!v.table && v.cards === 20 && !v.isTable && v.pressed === 'Bandeja:true,Tabla:false', '32. por defecto se muestra la Bandeja', v);
    await switchView('Tabla'); await page.wait('document.querySelector(".hw-inbox-table")', 'tabla'); v = await viewState();
    ck(v.table && v.rows === 20 && v.cards === 0 && v.isTable && v.pressed === 'Bandeja:false,Tabla:true', '32. «Tabla» muestra las mismas 20 consultas en una tabla y marca la vista activa (aria-pressed)', v);
    const heads = await page.evaluate('[...document.querySelectorAll(".hw-inbox-table thead th[scope=col]")].map(th => th.textContent.trim()).filter(Boolean).join()');
    ck(heads === 'Consulta,Estado,Origen,Fecha,Acción' && await page.evaluate('!!document.querySelector(".hw-inbox-table caption")'), '32. la tabla tiene encabezados semánticos (th scope=col) y título accesible', heads);
    await page.evaluate('document.querySelectorAll(' + JSON.stringify(viewTabs + ' button') + ')[0].focus(); 1'); await pressKey('Enter', 'Enter', 13, { text: '\r' }); v = await viewState();
    ck(!v.table && v.cards === 20, '32. teclado: Enter sobre «Bandeja» cambia de vista', v);
    await page.evaluate('document.querySelectorAll(' + JSON.stringify(viewTabs + ' button') + ')[1].focus(); 1'); await pressKey(' ', 'Space', 32, { text: ' ' }); v = await viewState();
    ck(v.table && await page.evaluate('document.activeElement?.textContent.trim() === "Tabla"'), '32. teclado: Espacio sobre «Tabla» cambia de vista y conserva el foco en el conmutador', v); }

  { // 33. Filtros y paginación compartidos
    await inbox(); await switchView('Tabla'); await page.wait('document.querySelector(".hw-inbox-table")', 'tabla');
    await searchFor('Especial'); await waitText('23 consultas coinciden', 'búsqueda');
    let v = await viewState(); ck(v.rows === 20, '33. la búsqueda se aplica a la tabla (20 de 23 en la primera página)', v);
    await clickBtn('.hp-pagination', 'Siguiente'); await page.wait('document.querySelectorAll(".hw-inbox-table tbody tr").length === 3', 'página 2');
    const tablePage2 = await subjects(); await switchView('Bandeja'); await page.wait('document.querySelectorAll(".hw-inbox-list > button").length === 3', 'bandeja página 2');
    const cardsPage2 = await subjects();
    ck(JSON.stringify(tablePage2) === JSON.stringify(cardsPage2) && (await text()).includes('Página 2') && (await page.evaluate('document.querySelector(\'input[aria-label="Buscar consultas"]\').value')) === 'Especial', '33. al alternar vista se conservan búsqueda, página y los mismos registros', { tablePage2, cardsPage2 });
    await selectEstado('nuevo'); await page.wait('/(^|\\D)0 consultas coinciden/.test(document.body.innerText)', 'estado sin coincidencias');
    await searchFor(''); await waitText('62 consultas coinciden', 'estado nuevo sin búsqueda'); await switchView('Tabla'); await page.wait('document.querySelector(".hw-inbox-table")', 'tabla con filtro');
    const states = await page.evaluate('[...document.querySelectorAll(".hw-inbox-table tbody .hp-badge")].map(b => b.innerText)');
    ck(states.length === 20 && states.every(x => x.toLowerCase() === 'nuevo'), '33. el filtro de estado también filtra la tabla', states.slice(0, 3)); }

  { // 34. Selección por fila, detalle con ?id= y Atrás/Adelante
    await inbox('/admin/messages?listado=tabla'); await page.wait('document.querySelector(".hw-inbox-table")', 'tabla inicial (?listado=tabla)');
    await openRow(1); await page.wait('document.querySelector(".hw-detail-heading")', 'detalle'); const first = await page.evaluate('location.search');
    ck(/id=229/.test(first) && (await detailId()) === 'Consulta #229' && await page.evaluate('!!document.querySelector(".hw-inbox-detail fieldset textarea") && !!document.querySelector(".hw-inbox-detail a[href*=\\"contacto=229\\"]")'), '34. seleccionar una fila abre el detalle existente (mismo AttentionEditor y acciones) con ?id=229', first);
    await openRow(2); await waitText('Consulta #228', 'otra fila'); await page.evaluate('history.back(); 1'); await waitText('Consulta #229', 'Atrás');
    const back = await detailId(); await page.evaluate('history.forward(); 1'); await waitText('Consulta #228', 'Adelante');
    ck(back === 'Consulta #229' && (await detailId()) === 'Consulta #228' && await page.evaluate('!!document.querySelector(".hw-inbox-table")'), '34. Atrás y Adelante recorren las filas seleccionadas sin salir de la tabla', back); }

  { // 35. Protección de borradores al alternar la vista y al cambiar de consulta
    await inbox('/admin/messages?id=5'); await page.wait('document.querySelector(".hw-inbox-detail fieldset textarea")', 'editor');
    await fill('.hw-inbox-detail fieldset textarea', 'Borrador D6.2');
    await switchView('Tabla'); await page.wait('document.querySelector(".hw-inbox-table")', 'tabla'); await sleep(200);
    const kept = await page.evaluate('({ notes: document.querySelector(".hw-inbox-detail fieldset textarea").value, unsaved: !!document.querySelector("dialog.hp-unsaved-dialog[open]"), path: location.pathname + location.search })');
    ck(kept.notes === 'Borrador D6.2' && !kept.unsaved && kept.path === '/admin/messages?id=5' && !(await state()).posts.some(p => p.method === 'PUT'), '35. alternar Bandeja/Tabla conserva el borrador del seguimiento sin avisos ni escrituras', kept);
    await switchView('Bandeja'); await page.wait('document.querySelectorAll(".hw-inbox-list > button").length > 0', 'bandeja'); await sleep(150);
    ck((await page.evaluate('document.querySelector(".hw-inbox-detail fieldset textarea").value')) === 'Borrador D6.2', '35. y al volver a la Bandeja el borrador sigue intacto');
    await switchView('Tabla'); await page.wait('document.querySelector(".hw-inbox-table")', 'tabla'); await openRow(0); await page.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso de cambios');
    await clickBtn('dialog.hp-unsaved-dialog[open]', 'Seguir editando'); await sleep(150);
    ck((await page.evaluate('location.search')) === '?id=5' && (await page.evaluate('document.querySelector(".hw-inbox-detail fieldset textarea").value')) === 'Borrador D6.2', '35. elegir otra fila con un borrador pendiente pide confirmar y «Seguir editando» no pierde nada'); }

  { // 36. Eliminación confirmada (vista Tabla, con filtros)
    await inbox('/admin/messages?listado=tabla'); await searchFor('Especial'); await waitText('23 consultas coinciden', 'búsqueda');
    const archivadosBefore = await metricArchivados();
    await page.evaluate('[...document.querySelectorAll(".hw-inbox-table tbody tr")].find(r => r.innerText.includes("Asunto 220")).querySelector("button").click(); 1'); await waitText('Consulta #220', 'detalle 220'); await page.wait('document.querySelector(".hw-inbox-detail fieldset textarea")', 'editor');
    await fill('.hw-inbox-detail fieldset textarea', 'Borrador de la consulta que se elimina');
    await openDelete(); const t = await text();
    ck(/seguimiento o cotizaciones vinculadas/.test(t) && /archívala/.test(t) && /Eliminar quita la consulta de forma definitiva/.test(t) && !(await page.evaluate('[...document.querySelectorAll("' + D + ' button")].some(b => b.textContent.includes("Archivar en su lugar"))')), '36. el diálogo explica que puede estar restringida, prioriza archivar y no ofrece archivar lo ya archivado', t.slice(0, 200));
    ck(/ya tiene el estado «archivado»/i.test(t) && /Es solo una pista/.test(t), '36. con actividad conocida muestra una pista preventiva sin presentarla como prueba');
    ck(await page.evaluate('document.activeElement?.textContent.trim() === "Cancelar"'), '36. el foco inicial está en la opción segura «Cancelar»', await activeInfo());
    await pressKey('Tab', 'Tab', 9); ck(await page.evaluate('document.activeElement?.textContent.includes("Eliminar definitivamente")'), '36. Tab avanza a «Eliminar definitivamente»', await activeInfo());
    await pressKey('Tab', 'Tab', 9, { modifiers: 8 }); ck(await page.evaluate('document.activeElement?.textContent.trim() === "Cancelar"'), '36. Shift+Tab vuelve a «Cancelar»');
    await clickBtn(D, 'Eliminar definitivamente'); await waitText('Consulta eliminada', 'eliminación');
    const s = await state();
    ck(s.deletes.length === 1 && s.deletes[0].id === 220 && s.total === TOTAL - 1, '36. DELETE confirmado: una sola solicitud, solo esa consulta', s.deletes);
    const after = await page.evaluate('({ path: location.pathname + location.search, search: document.querySelector(\'input[aria-label="Buscar consultas"]\').value, hasRow: [...document.querySelectorAll(".hw-inbox-table tbody tr")].some(r => r.innerText.includes("Asunto 220")), rows: document.querySelectorAll(".hw-inbox-table tbody tr").length, unsaved: !!document.querySelector("dialog.hp-unsaved-dialog[open]"), dialog: !!document.querySelector("dialog.hp-dialog[open]"), detail: !!document.querySelector(".hw-detail-heading") })');
    await waitText('22 consultas coinciden', 'listado actualizado');
    ck(after.path === '/admin/messages?listado=tabla' && after.search === 'Especial' && !after.hasRow && !after.unsaved && !after.dialog && !after.detail && !s.posts.some(p => p.method === 'PUT'), '36. tras eliminar: se limpia la selección y ?id=, se conservan filtros y vista, y el borrador de la consulta eliminada no bloquea la navegación', after);
    ck((await metricArchivados()) === archivadosBefore - 1, '36. las métricas se actualizan', { archivadosBefore, now: await metricArchivados() }); }

  { // 37. Cancelación del diálogo (botón y Escape)
    await inbox('/admin/messages?id=221'); await waitText('Consulta #221', 'detalle');
    await openDelete(); await clickBtn(D, 'Cancelar'); await sleep(200);
    ck(!(await dialogOpen2()) && (await state()).deletes.length === 0 && await page.evaluate('document.activeElement?.textContent.includes("Eliminar consulta")'), '37. «Cancelar» cierra sin enviar DELETE y devuelve el foco a «Eliminar consulta…»', await activeInfo());
    await openDelete(); await pressKey('Escape', 'Escape', 27); await sleep(250);
    ck(!(await page.evaluate('!!document.querySelector("' + D + '")')) && (await state()).deletes.length === 0, '37. Escape también cierra sin eliminar'); }

  { // 38. Doble DELETE
    await inbox('/admin/messages?id=222'); await waitText('Consulta #222', 'detalle'); await set({ deleteMode: 'slowOk' }); await openDelete();
    await page.evaluate('(() => { const b = [...document.querySelectorAll("' + D + ' button")].find(x => x.textContent.includes("Eliminar definitivamente")); b.click(); b.click(); return 1 })()');
    await waitText('Consulta eliminada', 'eliminación lenta'); await sleep(300);
    ck((await state()).deletes.length === 1, '38. dos clics seguidos producen un solo DELETE', (await state()).deletes); }

  { // 39. 409: seguimiento y cotización vinculados
    for (const [id, cause] of [[7, 'seguimiento'], [9, 'cotización']]) {
      await inbox('/admin/messages?id=' + id); await waitText('Consulta #' + id, 'detalle'); await openDelete();
      await clickBtn(D, 'Eliminar definitivamente'); await delResult(); const s = await state(), t = await delText();
      ck(/no permite eliminar/.test(t) && /seguimiento o cotizaciones vinculadas/.test(t) && !/Conserva su registro/.test(t) && s.total === TOTAL && await dialogOpen2() && (await activeInfo()).endsWith(':blocked'), '39. 409 con ' + cause + ': mensaje claro, nada eliminado, el diálogo sigue abierto y el aviso recibe el foco', { t, total: s.total, focus: await activeInfo() }); }
    await clickBtn(D, 'Archivar en su lugar'); await page.wait('document.body.innerText.includes("Consulta de Persona 9")', 'archivo');
    ck((await state()).posts.some(p => p.method === 'PUT' && p.route === 'seguimiento/messages/9' && p.data.estado === 'archivado') && (await state()).total === TOTAL, '39. «Archivar en su lugar» usa el flujo normal de seguimiento (PUT con revisión) y no elimina nada'); }

  { // 39b. 409 con un borrador de seguimiento SIN guardar: el borrador, la selección y ?id= sobreviven y no se repite el DELETE
    // El diálogo es modal y no pide guardar nada antes de eliminar (no hay bloqueo de navegación en juego: no se navega); el editor queda montado debajo.
    const DRAFT = 'Borrador 409 — línea 1\nlínea 2 «ñ» <b>no es HTML</b>';
    const behind = () => page.evaluate('({ draft: document.querySelector(".hw-inbox-detail fieldset textarea").value, path: location.pathname + location.search, heading: document.querySelector(".hw-detail-heading small")?.innerText, unsaved: !!document.querySelector("dialog.hp-unsaved-dialog[open]") })');
    await inbox('/admin/messages?id=7'); await waitText('Consulta #7', 'detalle'); await page.wait('document.querySelector(".hw-inbox-detail fieldset textarea")', 'editor');
    await fill('.hw-inbox-detail fieldset textarea', DRAFT);
    ck((await behind()).draft === DRAFT, '39b. (preparación) el borrador sin guardar está escrito en el editor');
    await openDelete(); await clickBtn(D, 'Eliminar definitivamente'); await delResult(); await sleep(700); // margen para detectar un segundo DELETE tardío
    let s = await state(), b = await behind();
    ck(/no permite eliminar/.test(await delText()) && s.total === TOTAL && s.deletes.length === 1 && s.deletes[0].id === 7, '39b. 409: la consulta sigue existiendo y se envió un único DELETE (sin repetición tardía)', { total: s.total, deletes: s.deletes });
    ck(b.draft === DRAFT && b.path === '/admin/messages?id=7' && b.heading === 'Consulta #7' && !b.unsaved, '39b. con el diálogo abierto, el borrador es EXACTAMENTE el anterior y no cambian la selección ni ?id=', b);
    await clickBtn(D, 'Cancelar'); await sleep(300); s = await state(); b = await behind();
    ck(!(await dialogOpen2()) && b.draft === DRAFT && b.path === '/admin/messages?id=7' && b.heading === 'Consulta #7' && s.deletes.length === 1 && !s.posts.some(p => p.method === 'PUT'), '39b. tras cerrar el diálogo el borrador sigue intacto, ?id=7 también, y no hubo más DELETE ni ninguna escritura de seguimiento', { b, deletes: s.deletes.length }); }

  { // 40. Resultado incierto de la eliminación (tiempos acortados)
    await inbox('/admin/messages?id=215', 1280, true); await waitText('Consulta #215', 'detalle'); await set({ deleteMode: 'slowDeleted' }); await openDelete();
    await clickBtn(D, 'Eliminar definitivamente'); await delResult(); let t = await delText(), s = await state();
    ck(/No pudimos confirmar si la consulta se eliminó/.test(t) && !/no se eliminó\./.test(t.replace('No pudimos confirmar si la consulta se eliminó', '')) && (await page.evaluate('!!document.querySelector("' + D + '")')) && s.total === TOTAL - 1, '40. timeout: se avisa que el resultado es incierto (el servidor sí la borró) sin afirmar que falló', t);
    await sleep(1500); await clickBtn(D, 'Comprobar si sigue existiendo'); await waitText('ya no existía', 'comprobación');
    ck(!(await page.evaluate('!!document.querySelector("' + D + '")')) && !(await page.evaluate('location.search')).includes('id='), '40. «Comprobar» detecta (404) que ya no existe, cierra y limpia la selección');
    await inbox('/admin/messages?id=216', 1280, true); await waitText('Consulta #216', 'detalle'); await set({ deleteMode: 'error500' }); await openDelete();
    await clickBtn(D, 'Eliminar definitivamente'); await delResult(); t = await delText();
    ck(/No pudimos confirmar/.test(t) && !/Internal server|ER_SECRET/.test(t), '40. un 5xx también es incierto y sin texto técnico', t);
    await clickBtn(D, 'Comprobar si sigue existiendo'); await page.wait('document.querySelector("' + D + ' [data-delete-result=still]")', 'sigue existiendo');
    await set({ deleteMode: 'ok' }); await clickBtn(D, 'Intentar eliminar de nuevo'); await waitText('Consulta eliminada', 'segundo intento');
    const retried = await state();
    ck(retried.deletes.length === 2 && retried.deletes.every(d => d.id === 216) && retried.total === TOTAL - 1 && !(await dialogOpen2()), '40. el reintento fue manual y explícito: el 5xx (sin borrar) y un único segundo DELETE; la consulta ya no existe y el diálogo se cerró', retried.deletes);
    await inbox('/admin/messages?id=217', 1280, true); await waitText('Consulta #217', 'detalle'); await set({ deleteMode: 'dropDeleted' }); await openDelete();
    await clickBtn(D, 'Eliminar definitivamente'); await page.wait('document.querySelector("' + D + ' [data-delete-result]") || document.body.innerText.includes("ya no existía") || document.body.innerText.includes("Consulta eliminada")', 'resultado tras el corte');
    await sleep(500); // deja llegar cualquier reintento del navegador antes de evaluar
    s = await state(); const stillOpen = await dialogOpen2(), body = await text();
    // El flujo real depende del transporte: si Edge reenvía el DELETE, el segundo recibe 404 y se informa «ya no existía»; si no, queda el resultado incierto.
    // Ambos caminos se comprueban con aserciones propias (nunca vacías) y se registra cuál ocurrió.
    console.log('  (info) DELETE recibidos tras cortar la conexión: ' + s.deletes.length + ' — camino: ' + (stillOpen ? 'resultado incierto (diálogo abierto)' : 'reintento del navegador con 404 («ya no existía»)'));
    if (stillOpen) {
      t = await delText();
      ck(/No pudimos confirmar si la consulta se eliminó/.test(t) && !/no se pudo eliminar|falló/i.test(t) && !body.includes('Consulta eliminada:'), '40. corte tras borrar (sin reintento visible): el diálogo sigue abierto con resultado incierto, sin éxito ni fallo definitivos', t);
      await clickBtn(D, 'Comprobar si sigue existiendo'); await waitText('ya no existía', 'comprobación tras el corte');
    } else {
      ck(body.includes('La consulta ya no existía') && !body.includes('Consulta eliminada:') && !/no se pudo eliminar|falló/i.test(body) && !(await page.evaluate('location.search')).includes('id='), '40. corte tras borrar (el navegador reintentó y obtuvo 404): se informa «ya no existía», sin anunciar un éxito propio ni un fallo, y se limpia ?id=', body.slice(0, 160));
    }
    await page.wait('!document.body.innerText.includes("Asunto 217")', 'lista sin la consulta 217'); s = await state();
    ck(s.total === TOTAL - 1 && s.deletes.length >= 1 && s.deletes.every(d => d.id === 217) && !(await dialogOpen2()), '40. estado final: la consulta 217 no existe en el servidor, la lista no la muestra y todos los DELETE fueron de esa consulta', { total: s.total, deletes: s.deletes }); }

  { // 41. Enlaces heredados retirados y crear=1 vigente
    await inbox(); ck(await page.evaluate('![...document.querySelectorAll("a")].some(a => (a.getAttribute("href") || "").includes("vista=tabla")) && !document.body.innerText.includes("Vista de registros")'), '41. la bandeja ya no ofrece el enlace heredado «Vista de registros» (lo sustituye el conmutador)');
    await session('/admin/messages?crear=1'); await page.wait('document.querySelector("' + D + ' form")', 'registro manual'); await clickBtn(D, 'Cancelar'); await sleep(200);
    ck(!(await page.evaluate('location.search')).includes('crear') && await page.evaluate('!!document.querySelector(' + JSON.stringify(viewTabs) + ')'), '41. crear=1 sigue abriendo el registro manual (D6.1) junto al conmutador'); }

  { // 42. D6.1 desde la vista Tabla: registro manual y exportación
    await inbox('/admin/messages?listado=tabla'); await captureDownloads(); await clickBtn('.hp-heading', 'Registro manual'); await page.wait('document.querySelector("' + D + ' form")', 'diálogo'); await fillForm();
    await page.evaluate("document.querySelector('" + D + " form').requestSubmit(); 1"); await waitText('Consulta registrada', 'registro');
    await page.wait('document.querySelector(".hw-inbox-table tbody tr td strong")?.innerText === "Asunto manual"', 'fila nueva en la tabla');
    ck(true, '42. el registro manual aparece al inicio de la tabla');
    await exportNow(); await page.wait('window.__dl.length === 1', 'descarga'); ck(csvLines((await downloads())[0].text).length === TOTAL + 2, '42. la exportación completa funciona desde la vista Tabla (' + (TOTAL + 1) + ' consultas)'); }

  const PUBLIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
  const leaks = blocked.filter(b => { try { return b.method !== 'GET' || !PUBLIC_ASSET_HOSTS.includes(new URL(b.url).hostname); } catch { return true; } });
  ck(leaks.length === 0, 'ninguna petición externa inesperada (' + blocked.length + ' recursos públicos bloqueados antes de enviarse)', leaks.slice(0, 3));
  ck(jsErrors.length === 0, 'sin excepciones de JavaScript', jsErrors.slice(0, 3));
  console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\nCentro de atención D6.1–D6.2: OK.');
  cleanup();
  process.exit(fails ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
