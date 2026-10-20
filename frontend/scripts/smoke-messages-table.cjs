// Vista Tabla de Mensajes en la bandeja moderna (MessageInbox) con API simulada: nada real (ni datos, ni sesiones, ni correo). Edge por DevTools.
// Cobertura heredada de la tabla antigua (D1, ResourceManager), migrada en D6.3 fase A: GET /admin/messages responde { messages, pagination, metrics }
// y una respuesta paginada SIN «messages» es un error de formato, no una lista vacía.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../dist'), browser = process.env.SMOKE_BROWSER || 'C:/Users/PCT40T/Documents/Proyecto-Horus-/../../../../Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const edge = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';
const TOKEN = 'e30.' + Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') + '.t1';

// ---------- API simulada ----------
const sim = { mode: 'ok' }; const writes = [];
const messages = Array.from({ length: 25 }, (_, i) => { const id = 25 - i; return { id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654' + String(id).padStart(3, '0'), asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: id % 5 === 0 ? 'en_proceso' : 'nuevo', createdAt: '2026-01-' + String(id).padStart(2, '0') + 'T10:00:00.000Z' }; });
// Textos con caracteres especiales para la seguridad del CSV
Object.assign(messages.find(m => m.id === 24), { nombre: '=HYPERLINK("http://x.test","clic")' });
Object.assign(messages.find(m => m.id === 23), { asunto: '@SUM(1+1)' });
Object.assign(messages.find(m => m.id === 22), { asunto: 'línea 1\nlínea 2, con "comillas"' });
Object.assign(messages.find(m => m.id === 21), { telefono: '+51 987 654 321' });
Object.assign(messages.find(m => m.id === 20), { nombre: '-cmd|calc' });
const cursos = [1, 2, 3].map(id => ({ id, titulo: 'Curso ' + id, slug: 'curso-' + id, tipo: 'curso', modalidad: 'virtual', duracion: '10 horas', descripcion: 'Descripción ' + id, estado: 'publicado', categoria: 'curso', fecha_inicio: '2099-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
const attention = {};
const effectiveMessages = () => messages.map(m => ({...m,estado:attention[m.id]?.estado || m.estado}));
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); sim[key] = value; if (key === 'clear') { writes.length = 0; sim.mode = 'ok'; } return json({ ok: true }); }
    if (route === '/__state') return json({ writes });
    if (route.startsWith('/api/')) {
      if (route === '/api/settings') return json({ ok: true, settings: {} });
      if (route === '/api/admin/me') return token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({ message: 'Unauthorized' }, 401);
      if (route.startsWith('/api/admin/')) {
        if (token !== TOKEN) return json({ message: 'Unauthorized' }, 401);
        const sub = route.slice('/api/admin/'.length); let m;
        if (req.method !== 'GET') { const data = await body(); writes.push({ method: req.method, route: sub, data }); if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/)) && req.method === 'PUT') { const cur = attention[m[1]] || { estado: 'nuevo', responsable: '', notas: 'nota previa', respuesta: '', revision: 1, historial: [] }; attention[m[1]] = { ...cur, ...data, revision: cur.revision + 1 }; return json({ ok: true, item: attention[m[1]] }); } return json({ ok: true, item: { id: 99, ...data } }); }
        if (sub === 'messages') {
          if (sim.mode === 'error') return json({ message: 'Internal server error ER_SECRET' }, 503);
          if (sim.mode === 'broken') return json({ ok: true, items: [], pagination: { total: 0, page: 1, limit: 8, pages: 0 } }); // formato inesperado: paginado pero sin "messages"
          const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20), search = (url.searchParams.get('search') || '').toLowerCase(), estado = url.searchParams.get('estado') || '';
          const rows = sim.mode === 'empty' ? [] : effectiveMessages().filter(x => (!search || [x.nombre, x.email, x.asunto, x.mensaje].some(v => v.toLowerCase().includes(search))) && (!estado || x.estado === estado));
          return json({ ok: true, messages: rows.slice((page - 1) * limit, page * limit), pagination: { total: rows.length, page, limit, pages: Math.ceil(rows.length / limit) }, metrics: Object.fromEntries(['nuevo','en_proceso','atendido','archivado'].map(s=>[s,effectiveMessages().filter(m=>m.estado===s).length])) });
        }
        if ((m = sub.match(/^messages\/(\d+)$/))) return json({ ok: true, message: effectiveMessages().find(x => x.id === +m[1]) });
        if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/))) return json({ ok: true, item: attention[m[1]] || { estado: messages.find(x => x.id === +m[1])?.estado || 'nuevo', responsable: '', notas: 'nota previa', respuesta: '', revision: 1, historial: [] } });
        if (sub === 'cursos') return json({ ok: true, items: cursos, pagination: { total: cursos.length, pages: 1 } });
        if ((m = sub.match(/^cursos\/(\d+)$/))) return json({ ok: true, item: cursos.find(x => x.id === +m[1]) });
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
const SET = "(el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }";
function newestMtime(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); n = Math.max(n, e.isDirectory() ? newestMtime(f) : fs.statSync(f).mtimeMs); } return n; }
function parseCsv(text) { // lector mínimo: comillas dobles, comas, saltos dentro de comillas y CRLF entre filas
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"') quoted = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; } else cell += c; }
  row.push(cell); rows.push(row); return rows;
}

async function main() {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Falta dist/: ejecuta "npm run build".');
  if (newestMtime(path.resolve(__dirname, '../src')) > fs.statSync(path.join(root, 'index.html')).mtimeMs) throw new Error('dist/ está desactualizado respecto a src/: ejecuta "npm run build" antes del smoke.');
  if (!fs.existsSync(edge)) throw new Error('Configura SMOKE_BROWSER con una instalación de Edge/Chromium.');
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-msgtable-');
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
    p.wait = async (expression, what, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await p.evaluate('!!(' + expression + ')')) return true; } catch { /* navegando */ } await sleep(100); } let seen = ''; try { seen = await p.evaluate("location.pathname + location.search + ' :: ' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 140)"); } catch { /* sin página */ } throw new Error('Tiempo agotado esperando: ' + what + ' [' + seen + ']'); };
    p.go = async (route, ready = 'document.querySelector(".hp-body, .admin-auth")') => { await p.send('Page.navigate', { url: origin + route }); await sleep(300); if (!route.startsWith('/__')) await p.wait(ready, 'la página ' + route); };
    p.path = () => p.evaluate('location.pathname + location.search');
    p.clickText = (selector, text) => p.evaluate('(() => { const el = [...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(x => (x.textContent + " " + (x.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").trim().includes(' + JSON.stringify(text) + ')); if (!el) throw new Error("sin elemento: " + ' + JSON.stringify(text) + '); el.click(); return 1 })()');
    p.type = (selector, index, value) => p.evaluate('(() => { const set = ' + SET + '; set(document.querySelectorAll(' + JSON.stringify(selector) + ')[' + index + '], ' + JSON.stringify(value) + '); return 1 })()');
    p.close = async () => { try { p.socket.close(); await bc.send('Target.closeTarget', { targetId }); } catch { /* ya cerrada */ } };
    pages.push(p); return p;
  }
  const ctl = (key, value = '1') => fetch(origin + '/__s/' + key + '/' + value);
  const state = () => fetch(origin + '/__state').then(r => r.json());
  const session = async (route, width) => { const p = await open(width); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN) + '); 1'); await p.go(route); return p; };
  const TABLE = '/admin/dashboard?section=mensajes&vista=tabla';
  const rowsOf = p => p.evaluate("[...document.querySelectorAll('.hw-inbox-table tbody tr td strong')].map(x => x.textContent)");
  const info = p => p.evaluate("({ count: document.querySelector('.hp-card-heading p')?.textContent || '', page: document.querySelector('.hp-pagination span')?.textContent || '', alert: document.querySelector('.hp-error[role=alert]')?.innerText || '', listError: document.querySelector('.hw-inbox-list .hp-empty')?.innerText || '', prevDisabled: [...document.querySelectorAll('.hp-pagination button')].find(b => b.textContent.trim() === 'Anterior')?.disabled, nextDisabled: [...document.querySelectorAll('.hp-pagination button')].find(b => b.textContent.trim() === 'Siguiente')?.disabled })");
  const subject = id => 'Asunto ' + id;
  const waitRows = (p, n, what) => p.wait('document.querySelectorAll(".hw-inbox-table tbody tr").length === ' + n, what);
  const refresh = p => p.evaluate("[...document.querySelectorAll('.hp-heading button')].find(b => b.textContent.includes('Actualizar')).click(); 1");

  console.log('\n== VISTA TABLA DE MENSAJES (D1, migrada a la bandeja moderna)');
  { const p = await session(TABLE); await waitRows(p, 20, 'primera página');
    const rows = await rowsOf(p), i = await info(p);
    ck(rows.length === 20 && rows[0] === subject(25) && rows[19] === subject(6), 'respuesta con «messages» y paginación: la tabla muestra los registros (antes quedaba vacía)', rows);
    ck(/^25 consultas coinciden/.test(i.count) && i.page === 'Página 1' && i.prevDisabled === true && i.nextDisabled === false, 'conserva el total real (25) y los botones de paginación', i);
    await p.clickText('.hp-pagination button', 'Siguiente'); await waitRows(p, 5, 'segunda página');
    const r2 = await rowsOf(p), i2 = await info(p);
    ck(r2[0] === subject(5) && r2[4] === subject(1) && i2.page === 'Página 2' && i2.prevDisabled === false && i2.nextDisabled === true, 'última página: quedan 5 registros (5 a 1), contador «Página 2» y «Siguiente» deshabilitado', { r2, i2 });
    await p.clickText('.hp-pagination button', 'Anterior'); await waitRows(p, 20, 'vuelta a la primera');
    ck((await info(p)).page === 'Página 1' && (await rowsOf(p))[0] === subject(25), 'página anterior: vuelve a la primera'); await p.close(); }

  { // filtros: búsqueda y estado (los mismos que la bandeja)
    const p = await session(TABLE); await waitRows(p, 20, 'tabla');
    const wantSearch = messages.filter(x => [x.nombre, x.email, x.asunto, x.mensaje].some(v => v.toLowerCase().includes('persona 2'))).length;
    await p.type('input[aria-label="Buscar consultas"]', 0, 'Persona 2'); await p.wait('document.querySelector(".hp-card-heading p")?.textContent.startsWith("' + wantSearch + ' consultas coinciden")', 'búsqueda');
    let i = await info(p); ck((await rowsOf(p)).length === Math.min(20, wantSearch), 'búsqueda: el total y las filas corresponden al filtro del servidor (' + wantSearch + ' resultados)', { i, wantSearch });
    await p.type('input[aria-label="Buscar consultas"]', 0, ''); await waitRows(p, 20, 'sin búsqueda');
    const wantState = messages.filter(x => x.estado === 'en_proceso').length;
    await p.type('select[aria-label="Estado de atención"]', 0, 'en_proceso'); await p.wait('document.querySelector(".hp-card-heading p")?.textContent.startsWith("' + wantState + ' consultas coinciden")', 'filtro por estado'); i = await info(p);
    ck((await rowsOf(p)).length === Math.min(20, wantState) && i.page === 'Página 1', 'filtro por estado: total y filas correctos (' + wantState + ' en proceso)', i);
    await p.close(); }

  { // vacío frente a error
    const p = await session(TABLE); await waitRows(p, 20, 'tabla');
    await ctl('mode', 'empty'); await refresh(p); await p.wait('document.querySelector(".hw-inbox-list .hp-empty")?.innerText.includes("No hay consultas con estos filtros")', 'lista vacía');
    let i = await info(p); ck(i.alert === '' && /^0 consultas coinciden/.test(i.count) && (await p.evaluate('document.querySelectorAll(".hw-inbox-table tbody tr").length')) === 0, 'lista vacía: se muestra como vacía (sin error) y el total es 0', i);
    await ctl('mode', 'error'); await refresh(p); await p.wait('document.querySelector(".hp-error[role=alert]")', 'error de carga'); i = await info(p);
    ck(/No se pudo consultar la bandeja/.test(i.listError) && /Reintentar/.test(i.listError) && /Datos no disponibles/.test(i.count) && (await p.evaluate('document.querySelectorAll(".hw-inbox-table tbody tr").length')) === 0, 'error HTTP: se distingue del vacío (alerta, «Datos no disponibles», sin filas y botón Reintentar)', i);
    await ctl('mode', 'broken'); await p.clickText('.hw-inbox-list .hp-empty button', 'Reintentar'); await p.wait('document.querySelector(".hp-error[role=alert]")?.innerText.includes("formato inesperado")', 'formato inesperado');
    ck(true, 'una respuesta paginada sin «messages» se trata como error de formato, no como lista vacía');
    await ctl('mode', 'ok'); await p.clickText('.hw-inbox-list .hp-empty button', 'Reintentar'); await waitRows(p, 20, 'recuperación');
    ck((await rowsOf(p))[0] === subject(25) && (await info(p)).alert === '', 'Reintentar recupera la lista'); await p.close(); }

  { // exportación CSV completa, con caracteres especiales (D6.1)
    const p = await session(TABLE); await waitRows(p, 20, 'tabla');
    await p.evaluate("window.__csv = null; const make = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { blob.arrayBuffer().then(buf => { window.__bom = [...new Uint8Array(buf).slice(0, 3)]; window.__csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf); }); return make(blob); }; HTMLAnchorElement.prototype.click = function () { window.__download = this.download; }; 1");
    await p.clickText('.hp-card-heading .hp-btn', 'Exportar resultados'); await p.wait('window.__csv', 'CSV generado');
    const csv = await p.evaluate('window.__csv'), name = await p.evaluate('window.__download'), bom = await p.evaluate('window.__bom'); const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
    ck(bom.join(',') === '239,187,191' && /^consultas-\d{4}-\d{2}-\d{2}\.csv$/.test(name), 'exporta con BOM y nombre consultas-AAAA-MM-DD.csv', name);
    ck(rows.length === 26 && rows[0].join('|') === 'id|nombre|correo|telefono|asunto|origen|estado|fecha' && rows[1][0] === '25', 'el CSV exporta TODOS los resultados (25, no solo la página visible) con cabecera estable', rows.map(r => r[0]));
    const byId = Object.fromEntries(rows.slice(1).map(r => [r[0], r]));
    ck(byId['24'][1] === "'=HYPERLINK(\"http://x.test\",\"clic\")" && byId['23'][4] === "'@SUM(1+1)" && byId['21'][3] === "'+51 987 654 321" && byId['20'][1] === "'-cmd|calc", 'las fórmulas (=, @, +, -) quedan neutralizadas y las comillas se conservan', { n24: byId['24'][1], a23: byId['23'][4], t21: byId['21'][3], n20: byId['20'][1] });
    ck(byId['22'][4] === 'línea 1\nlínea 2, con "comillas"', 'comas, comillas y saltos de línea se conservan sin romper las filas', byId['22'][4]);
    ck(!/nota previa|mensaje/i.test(rows[0].join('|')), 'el CSV no incluye notas ni el cuerpo del mensaje');
    await p.close(); }

  { // vista=tabla en otra sección no abre la tabla de mensajes. Cursos ya no se gestiona en el panel (separación del contenido
    // institucional): su dirección antigua muestra el aviso, sin tabla ni bandeja.
    const p = await session('/admin/dashboard?section=cursos&seccion=cursos&vista=tabla'); await p.wait('document.querySelector("[data-panel-editorial-retired]")', 'aviso de cursos retirados');
    ck(await p.evaluate('!document.querySelector(".hw-inbox") && !document.querySelector(".hp-table")'), 'cursos con vista=tabla: aviso de gestión retirada, sin tabla de registros ni bandeja de mensajes'); await p.close(); }

  console.log('\n== FUNCIONES CONSERVADAS');
  { const p = await session(TABLE); await waitRows(p, 20, 'tabla');
    ck((await p.evaluate('!![...document.querySelectorAll(".hw-tabs[aria-label=\\"Vista del listado\\"] button")].find(b => b.textContent.trim() === "Tabla" && b.getAttribute("aria-pressed") === "true")')), 'el alias vista=tabla abre la bandeja con la vista Tabla activa');
    await p.clickText('.hw-inbox-table button', 'Abrir consulta: Asunto 25'); await p.wait('document.querySelector(".hw-inbox-detail .hw-detail-heading")', 'detalle');
    ck((await p.evaluate('document.querySelector(".hw-inbox-detail").innerText')).includes('Persona 25') && (await p.path()).includes('id=25'), 'ver detalle de un registro: la fila abre el detalle de la bandeja (con ?id=25)');
    await p.clickText('.hw-inbox-table button', 'Abrir consulta: Asunto 24'); await p.wait('document.querySelector(".hw-inbox-detail form select")?.value && document.querySelector(".hw-detail-heading small")?.innerText === "Consulta #24"', 'cambio de estado');
    await p.type('.hw-inbox-detail form select', 0, 'atendido'); await p.clickText('.hw-inbox-detail form .hp-btn-primary', 'Guardar seguimiento'); await p.wait('document.body.innerText.includes("Seguimiento guardado.")', 'estado guardado');
    const w = (await state()).writes.find(x => x.route === 'seguimiento/messages/24' && x.method === 'PUT');
    ck(w && w.data.estado === 'atendido' && w.data.notas === 'nota previa' && w.data.revision === 1, 'cambio de estado mediante Seguimiento (conserva notas y revisión)', w);
    await p.clickText('.hw-inbox-table button', 'Abrir consulta: Asunto 19'); await p.wait('document.querySelector(".hw-detail-heading small")?.innerText === "Consulta #19"', 'consulta 19');
    await p.clickText('.hw-inbox-detail button', 'Eliminar consulta'); await p.wait('document.querySelector("dialog.hp-dialog[open] .hp-confirm")', 'confirmación');
    await p.clickText('dialog.hp-dialog[open] .hp-btn-danger', 'Eliminar definitivamente'); await p.wait('document.body.innerText.includes("Consulta eliminada")', 'eliminación');
    ck((await state()).writes.filter(x => x.method === 'DELETE').length === 1 && (await state()).writes.some(x => x.method === 'DELETE' && x.route === 'messages/19'), 'eliminar pide confirmación y envía un único DELETE al recurso');
    await p.close(); }
  { const p = await session('/admin/dashboard?section=mensajes&vista=tabla&crear=1'); await p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'registro manual');
    await p.wait('document.querySelector(".hw-inbox-table")', 'la tabla bajo el diálogo (el listado se carga en paralelo al diálogo)');
    ck(await p.evaluate('!!document.querySelector(".hw-inbox-table")'), 'el registro manual (crear=1) se abre sobre la vista Tabla');
    await p.type('#manual-message-nombre', 0, 'Persona manual'); await p.type('#manual-message-email', 0, 'manual@example.test'); await p.type('#manual-message-asunto', 0, 'Asunto manual'); await p.type('#manual-message-mensaje', 0, 'Texto de la consulta manual');
    await p.clickText('dialog.hp-dialog[open] .hp-btn', 'Cancelar'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'protección de cambios');
    ck(true, 'registro manual: cerrar con datos escritos pide confirmar (protección de cambios sin guardar)'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(200);
    await p.evaluate("document.querySelector('dialog.hp-dialog[open] form').requestSubmit(); 1"); await p.wait('document.body.innerText.includes("Consulta registrada")', 'creación');
    ck((await state()).writes.some(x => x.method === 'POST' && x.route === 'messages' && x.data.nombre === 'Persona manual'), 'registro manual de consultas: envía POST con los datos escritos'); await p.close(); }
  { const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.clear(); 1'); await p.go(TABLE, 'document.querySelector(".admin-auth")');
    ck((await p.path()) === '/admin/login', 'sin sesión administrativa la tabla no se muestra: redirige al login'); await p.close(); }

  const PUBLIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
  const leaks = blocked.filter(b => { try { return b.method !== 'GET' || !PUBLIC_ASSET_HOSTS.includes(new URL(b.url).hostname); } catch { return true; } });
  ck(leaks.length === 0, 'ninguna petición externa inesperada (' + blocked.length + ' recursos públicos de fuentes/iconos bloqueados antes de enviarse)', leaks.slice(0, 3));
  ck(jsErrors.length === 0, 'sin excepciones de JavaScript', jsErrors.slice(0, 3));
  console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\nTabla de Mensajes: OK.');
  cleanup();
  void browser; process.exit(fails ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
