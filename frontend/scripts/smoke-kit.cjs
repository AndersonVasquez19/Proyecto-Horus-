// Utilidades compartidas por los smokes nuevos (secciones del panel, notificaciones). Mismo patrón que los smokes existentes:
// servidor local simulado que sirve dist/, Edge por DevTools con perfil temporal horus-*, bloqueo de toda petición que no sea
// del servidor local ANTES de enviarla y cierre del árbol completo de procesos del navegador.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const registerCleanup = require('./smoke-cleanup.cjs');

const root = path.resolve(__dirname, '../dist');
const edge = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';
const TOKEN = 'e30.' + Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') + '.kit';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const SET = "(el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }";

function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let seq = 0;
  socket.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const r = pending.get(m.id); pending.delete(m.id); m.error ? r?.reject(new Error(m.error.message)) : r?.resolve(m.result); } };
  const ready = new Promise((a, b) => { socket.onopen = a; socket.onerror = b; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200)); return r.result.value; };
  return { socket, ready, send, evaluate };
}
function newestMtime(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); n = Math.max(n, e.isDirectory() ? newestMtime(f) : fs.statSync(f).mtimeMs); } return n; }

// handler(req, res, { route, url, json, body }) devuelve true si atendió la petición; si no, se sirve dist/ (SPA).
async function start({ prefix, handler, browserArgs = [] }) {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Falta dist/: ejecuta "npm run build".');
  if (newestMtime(path.resolve(__dirname, '../src')) > fs.statSync(path.join(root, 'index.html')).mtimeMs) throw new Error('dist/ está desactualizado respecto a src/: ejecuta "npm run build" antes del smoke.');
  if (!fs.existsSync(edge)) throw new Error('Configura SMOKE_BROWSER con una instalación de Edge/Chromium.');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), route = url.pathname;
      const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
      if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
      if (await handler(req, res, { route, url, json, body })) return;
      let file = path.resolve(root, '.' + decodeURIComponent(route));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch { res.statusCode = 500; res.end('Fixture failure'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-' + prefix + '-');
  const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', ...browserArgs, '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' });
  const cleanup = registerCleanup(child, profile, server);
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
      if (m.method === 'Fetch.requestPaused') { // lo que no sea el servidor simulado se bloquea antes de enviarse
        const { requestId, request } = m.params; let allowed = false;
        try { const u = new URL(request.url); allowed = u.origin === origin || u.protocol === 'data:' || u.protocol === 'blob:'; } catch { allowed = false; }
        if (allowed) p.send('Fetch.continueRequest', { requestId }).catch(() => {});
        else { blocked.push({ method: request.method, url: request.url.slice(0, 100) }); p.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); } } });
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    p.wait = async (expression, what, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await p.evaluate('!!(' + expression + ')')) return true; } catch { /* navegando */ } await sleep(100); } let seen = ''; try { seen = (await p.evaluate('document.body.innerText')).replace(/\s+/g, ' ').slice(0, 220); } catch { /* sin página */ } throw new Error('Tiempo agotado esperando ' + what + '. Texto visible: ' + seen); };
    p.go = async (route, ready = 'document.querySelector(".hp-body, .admin-auth, main")') => { await p.send('Page.navigate', { url: origin + route }); await sleep(300); if (!route.startsWith('/__')) await p.wait(ready, 'la página ' + route); };
    p.path = () => p.evaluate('location.pathname + location.search');
    p.text = (selector = 'body') => p.evaluate('(document.querySelector(' + JSON.stringify(selector) + ')?.innerText || "").replace(/\\s+/g, " ").trim()');
    p.click = (selector, text) => p.evaluate('(() => { const el = [...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(x => (x.textContent + " " + (x.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").trim().includes(' + JSON.stringify(text || '') + ')); if (!el) return false; el.click(); return true; })()');
    p.type = (selector, index, value) => p.evaluate('(() => { const set = ' + SET + '; set(document.querySelectorAll(' + JSON.stringify(selector) + ')[' + index + '], ' + JSON.stringify(value) + '); return 1 })()');
    // Rellena un campo de un diálogo abierto por el texto de su etiqueta (los formularios del panel envuelven el control en <label>).
    p.label = (text, value) => p.evaluate('(() => { const set = ' + SET + '; const el = [...document.querySelectorAll("dialog[open] label")].find(l => l.textContent.trim().startsWith(' + JSON.stringify(text) + '))?.querySelector("input, textarea, select"); if (!el) return false; set(el, ' + JSON.stringify(value) + '); return true; })()');
    p.close = async () => { try { p.socket.close(); await bc.send('Target.closeTarget', { targetId }); } catch { /* ya cerrada */ } };
    pages.push(p); return p;
  }
  const session = async (route, width) => { const p = await open(width); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN) + '); 1'); await p.go(route); return p; };
  async function closePages() { for (const q of pages.splice(0)) await q.close(); }
  function finish(title) {
    const PUBLIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'www.google.com'];
    const leaks = blocked.filter(b => { try { return b.method !== 'GET' || !PUBLIC_ASSET_HOSTS.includes(new URL(b.url).hostname); } catch { return true; } });
    ck(leaks.length === 0, 'ninguna petición externa inesperada (' + blocked.length + ' recursos públicos de fuentes/iconos bloqueados antes de enviarse)', leaks.slice(0, 3));
    ck(jsErrors.length === 0, 'sin excepciones de JavaScript', jsErrors.slice(0, 3));
    console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\n' + title + ': OK.');
    cleanup();
    process.exit(fails ? 1 : 0);
  }
  return { origin, open, session, closePages, ck, finish, sleep, cleanup };
}
module.exports = { start, sleep, KEY, TOKEN };
