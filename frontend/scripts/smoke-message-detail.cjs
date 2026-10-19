// Detalle independiente de la bandeja de Mensajes (D2), con API simulada: nada real (ni datos, ni sesiones, ni correo). Edge por DevTools.
// El detalle abierto (?id=) no depende de la página, la búsqueda ni el filtro del listado, y no se desmonta por cambios del listado.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../dist');
const edge = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';
const TOKEN = 'e30.' + Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') + '.d2';
const MARK = 'NOTA-D2-' + Date.now();

// ---------- API simulada ----------
const sim = { listMode: 'ok', detailMode: 'ok', putDelay: 0, detailDelay: {} };
const writes = [], detailGets = [];
let messages = [];
const reset = () => { messages = Array.from({ length: 45 }, (_, i) => { const id = 45 - i; return { id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654' + String(id).padStart(3, '0'), asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: id % 3 === 0 ? 'en_proceso' : 'nuevo', createdAt: '2026-01-' + String((id % 28) + 1).padStart(2, '0') + 'T10:00:00.000Z' }; }); };
reset();
const attention = {};
const effectiveMessages = () => messages.map(m => ({...m,estado:attention[m.id]?.estado || m.estado}));
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/');
      if (key === 'clear') { reset(); writes.length = 0; detailGets.length = 0; for (const k of Object.keys(attention)) delete attention[k]; Object.assign(sim, { listMode: 'ok', detailMode: 'ok', putDelay: 0, detailDelay: {} }); }
      else if (key === 'remove') { const ids = value.split(',').map(Number); messages = messages.filter(m => !ids.includes(m.id)); }
      else if (key === 'delay') { const [id, ms] = value.split(':'); sim.detailDelay[id] = Number(ms); }
      else if (key === 'putDelay') sim.putDelay = Number(value); else sim[key] = value;
      return json({ ok: true }); }
    if (route === '/__state') return json({ writes, detailGets });
    if (route.startsWith('/api/')) {
      if (route === '/api/settings') return json({ ok: true, settings: {} });
      if (route === '/api/admin/me') return token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({ message: 'Unauthorized' }, 401);
      if (route.startsWith('/api/admin/')) {
        if (token !== TOKEN) return json({ message: 'Unauthorized' }, 401);
        const sub = route.slice('/api/admin/'.length); let m;
        if (req.method !== 'GET') {
          const data = await body(); writes.push({ method: req.method, route: sub, data });
          if (sim.putDelay && sub.startsWith('seguimiento/')) await sleep(sim.putDelay);
          if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/)) && req.method === 'PUT') {
            const cur = attention[m[1]] || { estado: 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] };
            attention[m[1]] = { ...cur, ...data, revision: cur.revision + 1 }; const row = messages.find(x => x.id === +m[1]); if (row) row.estado = data.estado === 'archivado' ? 'atendido' : data.estado;
            return json({ ok: true, item: attention[m[1]] }); }
          return json({ ok: true, item: { id: 99, ...data } });
        }
        if (sub === 'messages') {
          if (sim.listMode === 'error') return json({ message: 'Internal server error ER_SECRET' }, 500);
          const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20), search = (url.searchParams.get('search') || '').toLowerCase(), estado = url.searchParams.get('estado') || '';
          const rows = effectiveMessages().filter(x => (!search || [x.nombre, x.email, x.asunto, x.mensaje].some(v => v.toLowerCase().includes(search))) && (!estado || x.estado === estado));
          return json({ ok: true, messages: rows.slice((page - 1) * limit, page * limit), pagination: { total: rows.length, page, limit, pages: Math.ceil(rows.length / limit) }, metrics: Object.fromEntries(['nuevo','en_proceso','atendido','archivado'].map(s=>[s,effectiveMessages().filter(m=>m.estado===s).length])) });
        }
        if ((m = sub.match(/^messages\/(\d+)$/))) {
          const id = +m[1]; detailGets.push(id);
          if (sim.detailDelay[id]) await sleep(sim.detailDelay[id]);
          if (sim.detailMode === 'hang') return; // sin respuesta: el cliente agota el tiempo
          if (sim.detailMode === '500') return json({ message: 'Internal server error ER_SECRET' }, 500);
          const row = effectiveMessages().find(x => x.id === id); return row ? json({ ok: true, message: row }) : json({ ok: false, mensaje: 'Mensaje no encontrado.' }, 404);
        }
        if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/))) return json({ ok: true, item: attention[m[1]] || { estado: messages.find(x => x.id === +m[1])?.estado || 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] } });
        return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} });
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
const SET = "(el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }";
function newestMtime(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); n = Math.max(n, e.isDirectory() ? newestMtime(f) : fs.statSync(f).mtimeMs); } return n; }

async function main() {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Falta dist/: ejecuta "npm run build".');
  if (newestMtime(path.resolve(__dirname, '../src')) > fs.statSync(path.join(root, 'index.html')).mtimeMs) throw new Error('dist/ está desactualizado respecto a src/: ejecuta "npm run build" antes del smoke.');
  if (!fs.existsSync(edge)) throw new Error('Configura SMOKE_BROWSER con una instalación de Edge/Chromium.');
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-detail-');
  const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' });
  const cleanup = require('./smoke-cleanup.cjs')(child,profile,server);
  let version; for (let i = 0; i < 100 && !version; i++) { await sleep(100); try { version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); } catch { /* arrancando */ } }
  const bc = connect(version.webSocketDebuggerUrl); await bc.ready;
  const jsErrors = [], blocked = [], pages = []; let fails = 0;
  const ck = (cond, name, detail = '') => { console.log((cond ? '  OK  ' : ' FALLA ') + name + (cond ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); if (!cond) fails++; };

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
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    p.wait = async (expression, what, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await p.evaluate('!!(' + expression + ')')) return true; } catch { /* navegando */ } await sleep(100); } let seen = ''; try { seen = await p.evaluate("location.pathname + location.search + ' :: ' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160)"); } catch { /* sin página */ } throw new Error('Tiempo agotado esperando: ' + what + ' [' + seen + ']'); };
    p.go = async (route, ready = 'document.querySelector(".hp-body, .admin-auth")') => { await p.send('Page.navigate', { url: origin + route }); await sleep(300); if (!route.startsWith('/__')) await p.wait(ready, 'la página ' + route); };
    p.path = () => p.evaluate('location.pathname + location.search');
    p.clickText = (selector, text) => p.evaluate('(() => { const el = [...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(x => (x.textContent + " " + (x.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").trim().includes(' + JSON.stringify(text) + ')); if (!el) throw new Error("sin elemento: " + ' + JSON.stringify(text) + '); el.click(); return 1 })()');
    p.type = (selector, index, value) => p.evaluate('(() => { const set = ' + SET + '; set(document.querySelectorAll(' + JSON.stringify(selector) + ')[' + index + '], ' + JSON.stringify(value) + '); return 1 })()');
    p.close = async () => { try { p.socket.close(); await bc.send('Target.closeTarget', { targetId }); } catch { /* ya cerrada */ } };
    pages.push(p); return p;
  }
  const ctl = (key, value = '1') => fetch(origin + '/__s/' + key + '/' + value);
  const state = () => fetch(origin + '/__state').then(r => r.json());
  async function clean() { await ctl('clear'); for (const q of pages.splice(0)) await q.close(); }
  const session = async (route, width) => { const p = await open(width); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN) + '); 1'); await p.go(route); return p; };
  const detailTitle = p => p.evaluate('document.querySelector(".hw-inbox-detail .hw-detail-heading small")?.textContent || ""');
  const waitDetail = (p, id, what = 'detalle #' + id) => p.wait('document.querySelector(".hw-inbox-detail .hw-detail-heading small")?.textContent === "Consulta #' + id + '"', what);
  const selectedRows = p => p.evaluate("[...document.querySelectorAll('.hw-inbox-list button.is-selected')].map(b => b.querySelector('.hw-inbox-subject')?.textContent)");
  const mark = async p => { await p.wait('document.querySelector(".hw-inbox-detail form textarea")', 'editor de seguimiento'); await p.evaluate('document.querySelector(".hw-inbox-detail form textarea").__keep = 1; 1'); };
  const editorInfo = p => p.evaluate('({ value: document.querySelector(".hw-inbox-detail form textarea")?.value ?? null, keep: document.querySelector(".hw-inbox-detail form textarea")?.__keep === 1 })');
  const outside = p => p.evaluate('!!document.querySelector("[data-testid=outside-list]")');
  const unsaved = p => p.evaluate('!!document.querySelector("dialog.hp-unsaved-dialog[open]")');
  const listReady = p => p.wait('document.querySelectorAll(".hw-inbox-list button").length > 0', 'lista de consultas');

  console.log('\n== DETALLE INDEPENDIENTE (D2)');
  await clean();
  { // detalle fuera de la página y acceso directo
    const p = await session('/admin/messages?id=3'); await waitDetail(p, 3, 'detalle fuera de la página');
    const s = await state(); const rows = await selectedRows(p);
    ck(s.detailGets.join(',') === '3' && (await detailTitle(p)) === 'Consulta #3', '?id= directo a una consulta que no está en la página 1: se carga por id (una sola petición) y se muestra', s.detailGets);
    ck(rows.length === 0 && await outside(p), 'ninguna fila aparece seleccionada y se indica con discreción que la consulta no está en la página actual', rows);
    ck(await p.evaluate('!!document.querySelector(".hw-inbox-detail form textarea")'), 'el seguimiento (editor) está disponible aunque la consulta no esté en el listado');
    await p.close(); }
  await clean();
  { // id dentro de la página: sin petición extra y una sola fila seleccionada
    const p = await session('/admin/messages?id=40'); await waitDetail(p, 40);
    const s = await state(); const rows = await selectedRows(p);
    ck(s.detailGets.length === 0 && rows.length === 1 && rows[0] === 'Asunto 40' && !(await outside(p)), '?id= de una consulta visible: sale del listado sin petición duplicada y solo esa fila queda seleccionada', { gets: s.detailGets, rows });
    for (const bad of ['abc', '-5', '0', '99999999999']) { await p.go('/admin/messages?id=' + bad); await listReady(p); await sleep(250);
      const t = await detailTitle(p); const url = await p.path();
      if (t !== '' || url !== '/admin/messages?id=' + bad) { ck(false, '?id= no válido (' + bad + ') se ignora sin redirigir', { t, url }); break; } }
    ck((await state()).detailGets.length === 0, '?id= no válido: se ignora, no pide nada ni redirige (sin bucles)'); await p.close(); }

  await clean();
  { // selección rápida: la respuesta antigua no reemplaza a la nueva
    await ctl('delay', '3:1500'); const p = await session('/admin/messages?id=3'); await p.wait('document.querySelector(".hw-inbox-list button")', 'lista');
    await p.clickText('.hw-inbox-list button', 'Asunto 45'); await waitDetail(p, 45);
    await sleep(2200);
    ck((await detailTitle(p)) === 'Consulta #45' && (await selectedRows(p)).join() === 'Asunto 45', 'selección rápida: la respuesta tardía de la consulta anterior (#3) no reemplaza a la nueva (#45)', await detailTitle(p)); await p.close(); }

  await clean();
  { // estado nuevo -> en_proceso con filtro "nuevo": la consulta sale del listado pero el detalle y lo escrito se conservan
    await ctl('putDelay', '900'); const p = await session('/admin/messages?id=44&estado=nuevo'); await waitDetail(p, 44); await mark(p);
    ck((await selectedRows(p)).join() === 'Asunto 44' && !(await outside(p)), 'con el filtro «Por atender» la consulta 44 aparece en el listado y seleccionada');
    await p.clickText('.hw-inbox-detail .hp-btn', 'Iniciar atención'); await sleep(250);
    await p.evaluate('document.querySelector(".hw-inbox-detail form textarea").focus(); 1'); await p.type('.hw-inbox-detail form textarea', 0, MARK + ' durante el PUT');
    await p.wait('!!document.querySelector("[data-testid=outside-list]")', 'la consulta sale del filtro', 9000); await sleep(600);
    const e = await editorInfo(p); const badge = await p.evaluate('document.querySelector(".hw-inbox-detail .hw-detail-heading .hp-badge")?.textContent');
    ck((await detailTitle(p)) === 'Consulta #44' && badge === 'En proceso', 'tras el PUT la consulta deja de cumplir el filtro, pero el detalle sigue abierto con su estado nuevo', { title: await detailTitle(p), badge });
    ck(e.value === MARK + ' durante el PUT' && e.keep, 'lo escrito mientras el PUT estaba pendiente se conserva y el editor no se recrea', e);
    ck(await p.evaluate('document.activeElement === document.querySelector(".hw-inbox-detail form textarea")'), 'no se pierde el foco al actualizarse el listado');
    ck((await state()).writes.filter(w => w.method === 'PUT').length === 1, 'no hay escrituras automáticas: solo el PUT de la acción rápida'); await p.close(); }

  await clean();
  { // fallo del listado con un editor abierto
    const p = await session('/admin/messages?id=44'); await waitDetail(p, 44); await mark(p);
    await ctl('listMode', 'error'); await p.clickText('.hp-heading .hp-btn', 'Actualizar'); await p.wait('document.querySelector(".hw-inbox-list .hp-empty")?.innerText.includes("No se pudo consultar la bandeja")', 'error del listado');
    await p.type('.hw-inbox-detail form textarea', 0, MARK + ' con el listado caído'); await sleep(250);
    const e = await editorInfo(p);
    ck(e.keep && e.value === MARK + ' con el listado caído' && (await detailTitle(p)) === 'Consulta #44', 'un error del listado no desmonta el editor: se puede seguir escribiendo');
    await ctl('listMode', 'ok'); await p.clickText('.hw-inbox-list button, .hw-inbox-list .hp-btn', 'Reintentar').catch(() => {}); await p.evaluate('document.querySelector(".hw-inbox-list .hp-empty button")?.click(); 1');
    await p.wait('document.querySelectorAll(".hw-inbox-list button.is-selected, .hw-inbox-list button").length > 3', 'listado recuperado'); await sleep(300);
    const after = await editorInfo(p); ck(after.keep && after.value === MARK + ' con el listado caído', 'al recuperarse el listado el borrador sigue intacto en el mismo editor'); await p.close(); }

  await clean();
  { // detalle 404 (eliminado) frente a error de red/500
    const p = await session('/admin/messages?id=999'); await p.wait('document.querySelector(".hw-inbox-detail [role=alert]")', 'detalle inexistente');
    const t = await p.evaluate('document.querySelector(".hw-inbox-detail [role=alert]").innerText');
    ck(/ya no está disponible/.test(t) && !/ER_SECRET|Internal/.test(t), 'consulta inexistente (404): se explica que ya no está disponible, sin texto técnico', t);
    await p.clickText('.hw-inbox-detail .hp-btn', 'Cerrar detalle'); await sleep(300);
    ck((await p.path()) === '/admin/messages' && (await detailTitle(p)) === '', '«Cerrar detalle» quita el id de la URL'); await p.close(); }
  await clean();
  { await ctl('detailMode', '500'); const p = await session('/admin/messages?id=3'); await p.wait('document.querySelector(".hw-inbox-detail [role=alert]")', 'fallo del detalle');
    const t = await p.evaluate('document.querySelector(".hw-inbox-detail [role=alert]").innerText');
    ck(/No pudimos cargar esta consulta/.test(t) && /no se ha eliminado/.test(t) && !/ER_SECRET|Internal/.test(t), 'error 500 del detalle: NO se trata como eliminada; mensaje propio sin texto técnico del backend', t);
    await ctl('detailMode', 'ok'); await p.clickText('.hw-inbox-detail .hp-btn', 'Reintentar'); await waitDetail(p, 3, 'detalle tras reintentar');
    ck(true, 'Reintentar carga el detalle'); await p.close(); }
  await clean();
  { await ctl('detailMode', 'hang'); const p = await session('/admin/messages?id=3'); await p.wait('document.querySelector(".hw-inbox-detail [role=alert]")', 'tiempo agotado del detalle', 20000);
    const t = await p.evaluate('document.querySelector(".hw-inbox-detail [role=alert]").innerText');
    ck(/No pudimos cargar esta consulta/.test(t) && /no se ha eliminado/.test(t), 'timeout del detalle (15 s): error recuperable, no «eliminada»');
    await ctl('detailMode', 'ok'); await p.clickText('.hw-inbox-detail .hp-btn', 'Reintentar'); await waitDetail(p, 3, 'detalle tras el timeout');
    ck((await state()).detailGets.length === 2, 'tras el timeout, Reintentar hace una sola petición nueva', (await state()).detailGets); await p.close(); }

  console.log('\n== PAGINACIÓN, FILTROS Y NAVEGACIÓN');
  await clean();
  { // última página que queda vacía
    const p = await session('/admin/messages'); await listReady(p);
    await p.clickText('.hp-pagination button', 'Siguiente'); await p.wait('document.querySelector(".hp-pagination span")?.textContent === "Página 2"', 'página 2'); await sleep(300);
    await p.clickText('.hp-pagination button', 'Siguiente'); await p.wait('document.querySelector(".hp-pagination span")?.textContent === "Página 3"', 'página 3'); await p.wait('document.querySelectorAll(".hw-inbox-list button").length === 5', 'última página (5)');
    await ctl('remove', '1,2,3,4,5'); await p.clickText('.hp-heading .hp-btn', 'Actualizar');
    await p.wait('document.querySelector(".hp-pagination span")?.textContent === "Página 2"', 'vuelta a la última página existente');
    await p.wait('document.querySelectorAll(".hw-inbox-list button").length === 20', 'registros de la página 2');
    ck(true, 'si la última página queda vacía se vuelve a la última que existe, con sus registros (sin inventar totales)');
    const total = await p.evaluate('document.querySelector(".hp-card-heading p")?.textContent'); ck(/40 consultas/.test(total), 'el total refleja los 40 registros reales', total); await p.close(); }
  await clean();
  { // un filtro sin resultados mantiene el detalle abierto
    const p = await session('/admin/messages?id=44'); await waitDetail(p, 44); await mark(p);
    await p.type('input[aria-label="Buscar consultas"]', 0, 'zzzz-sin-resultados'); await p.wait('document.querySelector(".hw-inbox-list .hp-empty")?.innerText.includes("No hay consultas con estos filtros")', 'sin resultados');
    ck((await detailTitle(p)) === 'Consulta #44' && (await editorInfo(p)).keep && await outside(p), 'un filtro con cero resultados deja el listado vacío pero el detalle abierto, con la indicación discreta');
    await p.type('input[aria-label="Buscar consultas"]', 0, ''); await p.wait('document.querySelectorAll(".hw-inbox-list button").length === 20', 'listado completo');
    ck((await selectedRows(p)).join() === 'Asunto 44' && !(await outside(p)), 'al quitar la búsqueda la fila vuelve a aparecer seleccionada y desaparece la indicación'); await p.close(); }
  await clean();
  { // Atrás y Adelante, y borrador sin guardar
    const p = await session('/admin/messages'); await listReady(p);
    await p.clickText('.hw-inbox-list button', 'Asunto 45'); await waitDetail(p, 45); await p.clickText('.hw-inbox-list button', 'Asunto 44'); await waitDetail(p, 44);
    await p.evaluate('history.back(); 1'); await waitDetail(p, 45, 'Atrás'); ck((await selectedRows(p)).join() === 'Asunto 45', 'Atrás vuelve a la consulta anterior y la selección coincide con la URL');
    await p.evaluate('history.forward(); 1'); await waitDetail(p, 44, 'Adelante'); ck((await p.path()) === '/admin/messages?id=44', 'Adelante vuelve a la siguiente');
    await p.wait('document.querySelector(".hw-inbox-detail form textarea")', 'editor de seguimiento'); await p.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150); await p.evaluate('history.back(); 1');
    await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso con borrador'); ck((await editorInfo(p)).value === MARK, 'Atrás con una nota sin guardar pide confirmar y no pierde el texto');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(300); ck(!(await unsaved(p)) && (await detailTitle(p)) === 'Consulta #44', 'Seguir editando conserva la consulta y la nota'); await p.close(); }
  await clean();
  { // alias heredado vista=tabla y acceso hacia cotizaciones (D6.3 fase A)
    const alias = '/admin/dashboard?section=mensajes&vista=tabla';
    const p = await session(alias, 1280); await p.wait('document.querySelector(".hw-inbox-table tbody tr")', 'vista Tabla de la bandeja');
    ck((await p.path()) === alias && (await p.evaluate('!!document.querySelector(".hw-inbox") && !document.querySelector(".hw-inbox-list > button")')), 'el alias vista=tabla abre la bandeja moderna en vista Tabla y conserva la URL (sin redirección)');
    await p.evaluate('document.querySelectorAll(".hw-tabs[aria-label=\\"Vista del listado\\"] button")[0].click(); 1'); await listReady(p);
    ck(await p.evaluate('document.querySelectorAll(".hw-inbox-list > button").length > 0 && !document.querySelector(".hw-inbox-table")'), 'desde la vista Tabla, el conmutador lleva a la Bandeja sin recargar');
    ck((await p.evaluate('!!document.querySelector("a[href*=\\"vista=tabla\\"]")')) === false, 'ya no existe el enlace heredado «Vista de registros»');
    await p.go('/admin/messages?id=3'); await waitDetail(p, 3);
    await p.clickText('.hw-inbox-detail a.hp-btn', 'Preparar cotización'); await p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'cotización');
    ck((await p.path()).includes('contacto=3') && (await p.evaluate('document.querySelector("dialog.hp-dialog[open] input").value')) === 'Persona 3', 'desde un detalle fuera de la página se prepara la cotización con los datos de esa consulta'); await p.close(); }
  await clean();
  { // sesión: dashboard -> bandeja directa
    const p = await session('/admin/dashboard'); await p.clickText('.hp-nav-item', 'Mensajes'); await listReady(p);
    ck((await p.path()) === '/admin/messages', 'acceso desde el menú del panel'); await p.close(); }

  const PUBLIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
  const leaks = blocked.filter(b => { try { return b.method !== 'GET' || !PUBLIC_ASSET_HOSTS.includes(new URL(b.url).hostname); } catch { return true; } });
  ck(leaks.length === 0, 'ninguna petición externa inesperada (' + blocked.length + ' recursos públicos de fuentes/iconos bloqueados antes de enviarse)', leaks.slice(0, 3));
  ck(jsErrors.length === 0, 'sin excepciones de JavaScript', jsErrors.slice(0, 3));
  console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\nDetalle de Mensajes: OK.');
  cleanup();
  process.exit(fails ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
