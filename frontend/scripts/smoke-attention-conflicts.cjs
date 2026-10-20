// Concurrencia en el seguimiento (D3) con API simulada: nada real (ni datos, ni sesiones, ni correo). Edge por DevTools.
// El navegador es el administrador A; el endpoint /__remote edita el mismo seguimiento como administrador B.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../dist');
const edge = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';
const TOKEN = 'e30.' + Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') + '.d3';

// ---------- API simulada ----------
const sim = { putMode: 'ok', getMode: 'ok', nextGetDelay: 0 };
const writes = [], gets = [];
const heldPuts = new Map();
const releasePuts = () => { sim.holdPut = 0; for (const release of heldPuts.values()) release(); heldPuts.clear(); };
let messages = [], reclamaciones = [], attention = {};
const fresh = (resource, id) => ({ estado: resource === 'messages' ? messages.find(m => m.id === id)?.estado || 'nuevo' : 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] });
const reset = () => {
  messages = [1, 2, 3, 4, 5].map(id => ({ id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654321', asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: 'nuevo', createdAt: '2026-01-0' + id + 'T10:00:00.000Z' }));
  reclamaciones = [1, 2, 3].map(id => ({ id, numero_reclamo: 'HG-00' + id, nombres: 'Nombre' + id, apellidos: 'Apellido' + id, tipo_doc: 'DNI', num_doc: '1234567' + id, email: 'r' + id + '@example.test', telefono: '987654321', direccion: 'Calle ' + id, tipo_registro: 'reclamo', area: 'Cursos', fecha_incidente: '2026-01-01', descripcion_bien: 'Bien ' + id, detalle_reclamo: 'Detalle ' + id, acepta_comunicaciones: true, createdAt: '2026-01-0' + id + 'T10:00:00.000Z' }));
  attention = {};
};
reset();
const keyOf = (resource, id) => resource + ':' + id;
const current = (resource, id) => attention[keyOf(resource, id)] || fresh(resource, id);
const effectiveMessages = () => messages.map(m => ({ ...m, estado: current('messages',m.id).estado }));
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (route === '/__clear') { releasePuts(); reset(); writes.length = 0; gets.length = 0; Object.assign(sim, { putMode: 'ok', getMode: 'ok', nextGetDelay: 0 }); expired = false; return json({ ok: true }); }
    if (route === '/__release') { releasePuts(); return json({ ok: true }); }
    if (route === '/__set') { for (const [k, v] of url.searchParams) sim[k] = isNaN(Number(v)) ? v : Number(v); if (url.searchParams.get('expire')) expired = true; return json({ ok: true }); }
    if (route === '/__remote') { // el administrador B guarda cambios: sube la revisión y aplica solo los campos indicados
      const resource = url.searchParams.get('resource') || 'messages', id = Number(url.searchParams.get('id')); const cur = current(resource, id);
      const changes = {}; for (const f of ['estado', 'responsable', 'notas', 'respuesta']) if (url.searchParams.has(f)) changes[f] = url.searchParams.get(f);
      attention[keyOf(resource, id)] = { ...cur, ...changes, revision: cur.revision + 1, historial: [...cur.historial, { accion: 'Cambio de otro administrador', usuario: 2, fecha: new Date().toISOString() }] };
      if (resource === 'messages' && changes.estado) messages.find(m => m.id === id).estado = changes.estado === 'archivado' ? 'atendido' : changes.estado;
      return json({ ok: true, revision: attention[keyOf(resource, id)].revision }); }
    if (route === '/__state') return json({ writes, gets, attention, contacts: messages, heldPuts: heldPuts.size });
    if (route.startsWith('/api/')) {
      if (route === '/api/settings') return json({ ok: true, settings: {} });
      if (route === '/api/admin/me') return token === TOKEN && !expired ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({ message: 'Unauthorized' }, 401);
      if (route.startsWith('/api/admin/')) {
        if (token !== TOKEN || expired) return json({ message: 'Unauthorized' }, 401);
        const sub = route.slice('/api/admin/'.length); let m;
        if ((m = sub.match(/^seguimiento\/(messages|reclamaciones)\/(\d+)(\/(correo|constancia))?$/))) {
          const resource = m[1], id = Number(m[2]);
          if (req.method === 'GET') {
            gets.push(keyOf(resource, id)); if (sim.getMode === 'error') return json({ message: 'Internal server error ER_SECRET' }, 500);
            const snapshot = JSON.parse(JSON.stringify(current(resource, id))); const delay = sim.nextGetDelay; sim.nextGetDelay = 0; if (delay) await sleep(delay); // la copia se toma al recibir la petición: si tarda, llega "vieja"
            return json({ ok: true, item: snapshot }); }
          const data = await body(); const cur = current(resource, id);
          if (m[4] === 'correo') { writes.push({ method: 'POST', route: sub, data }); return data.revision !== cur.revision ? json({ message: 'La respuesta cambió. Recarga el caso antes de enviarla.' }, 409) : json({ ok: true, mensaje: 'Respuesta enviada por correo.' }); }
          if (req.method === 'PUT') {
            writes.push({ method: 'PUT', route: sub, data, applied: false }); const entry = writes[writes.length - 1];
            // Retiene la respuesta después del commit simulado: salir no deshace una escritura enviada.
            const reply = async (value, status = 200) => { if (sim.holdPut) await new Promise(resolve => heldPuts.set(entry, resolve)); json(value, status); };
            if (sim.putMode === 'fail') return reply({ message: 'Internal server error ER_SECRET' }, 500);
            if (data.revision !== cur.revision) return reply({ message: 'El seguimiento cambió en otra sesión. Recarga el caso.' }, 409);
            attention[keyOf(resource, id)] = { ...cur, estado: data.estado, responsable: data.responsable, notas: data.notas, respuesta: data.respuesta, revision: cur.revision + 1, historial: [...cur.historial, { accion: 'Seguimiento actualizado: ' + data.estado, usuario: 1, fecha: new Date().toISOString() }] };
            if (resource === 'messages') messages.find(x => x.id === id).estado = data.estado === 'archivado' ? 'atendido' : data.estado; entry.applied = true;
            return reply({ ok: true, item: attention[keyOf(resource, id)] }); }
          return json({ ok: true, mensaje: 'Notificación enviada.' });
        }
        if (sub === 'messages') {
          const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
          const all = effectiveMessages(), estado = url.searchParams.get('estado'), search = (url.searchParams.get('search') || '').toLowerCase();
          const rows = all.filter(m => (!estado || m.estado === estado) && (!search || [m.nombre,m.asunto,m.email,m.mensaje].some(v=>v.toLowerCase().includes(search))));
          const metrics = Object.fromEntries(['nuevo','en_proceso','atendido','archivado'].map(s=>[s,all.filter(m=>m.estado===s).length]));
          return json({ ok: true, messages: rows.slice((page - 1) * limit, page * limit), pagination: { total: rows.length, page, limit, pages: Math.ceil(rows.length / limit) }, metrics });
        }
        if ((m = sub.match(/^messages\/(\d+)$/))) return json({ ok: true, message: effectiveMessages().find(x => x.id === +m[1]) });
        if (sub === 'stats') {
          const all = effectiveMessages(), count = s => all.filter(m=>m.estado===s).length;
          // Contrato de GET /admin/stats?vista=operativa (Resumen académico y de atención).
          return json({ok:true,stats:{academico:{estudiantes:0,edicionesActivas:0,matriculasRegistradas:0,matriculasVigentes:0},mensajes:{total:all.length,nuevos:count('nuevo'),enProceso:count('en_proceso'),atendidos:count('atendido'),archivados:count('archivado'),pendientes:count('nuevo')+count('en_proceso')}},actividadReciente:{mensajes:all.map(x=>({id:x.id,nombre:x.nombre,asunto:x.asunto,estado:x.estado,createdAt:x.createdAt}))}});
        }
        if (sub === 'reclamaciones') return json({ ok: true, reclamaciones, pagination: { total: reclamaciones.length, page: 1, limit: 10, pages: 1 }, metrics: { reclamo: reclamaciones.length, queja: 0 } });
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
let expired = false;

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
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-conflict-');
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
    p.press = (key, code, vk, text) => p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }).then(() => p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }));
    p.close = async () => { try { p.socket.close(); await bc.send('Target.closeTarget', { targetId }); } catch { /* ya cerrada */ } };
    pages.push(p); return p;
  }
  const set = params => fetch(origin + '/__set?' + new URLSearchParams(params));
  const remote = (resource, id, changes) => fetch(origin + '/__remote?' + new URLSearchParams({ resource, id: String(id), ...changes })).then(r => r.json());
  const state = () => fetch(origin + '/__state').then(r => r.json());
  async function clean() { await fetch(origin + '/__clear'); for (const q of pages.splice(0)) await q.close(); }
  const session = async (route, width) => { const p = await open(width); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN) + '); 1'); await p.go(route); return p; };

  // Selector del editor de mensajes (panel de detalle)
  const R = { messages: '.hw-inbox-detail form.hp-form' };
  const editorReady = (p, root) => p.wait('document.querySelector("' + root + ' fieldset textarea")', 'editor de seguimiento');
  const openMessage = async (id) => { const p = await session('/admin/messages?id=' + id); await editorReady(p, R.messages); return p; };
  const view = (p, root) => p.evaluate("(() => { const f = document.querySelector('" + root + "'); const t = f.querySelectorAll('fieldset textarea'); const banner = f.querySelector('.hp-conflict-banner'); const save = [...f.querySelectorAll('.hp-actions button')].find(b => b.textContent.includes('Guardar seguimiento')); return { estado: f.querySelector('fieldset select').value, responsable: f.querySelector('fieldset input').value, notas: t[0].value, respuesta: t[1].value, banner: banner ? banner.className.replace('hp-conflict-banner ', '') : null, bannerRole: banner?.getAttribute('role') || null, bannerText: banner?.innerText || '', conflicts: [...f.querySelectorAll('.hp-conflict-field')].map(c => ({ field: c.querySelector('h5').textContent, mine: c.querySelectorAll('pre')[0].textContent, theirs: c.querySelectorAll('pre')[1].textContent })), saveDisabled: save.disabled, notice: f.querySelector('.hp-notice')?.innerText || '', alert: f.querySelector('.hp-error')?.innerText || '' }; })()");
  const typeNotes = (p, root, value, index = 0) => p.type(root + ' fieldset textarea', index, value);
  const save = (p, root) => p.evaluate("[...document.querySelectorAll('" + root + " .hp-actions button')].find(b => b.textContent.includes('Guardar seguimiento')).click(); 1");
  const choose = (p, field, text) => p.evaluate("(() => { const box = [...document.querySelectorAll('.hp-conflict-field')].find(c => c.querySelector('h5').textContent === " + JSON.stringify(field) + "); [...box.querySelectorAll('button')].find(b => b.textContent.includes(" + JSON.stringify(text) + ")).click(); return 1 })()");
  const putsOf = async (resource, id) => (await state()).writes.filter(w => w.method === 'PUT' && w.route === 'seguimiento/' + resource + '/' + id);
  const TECH = /ER_SECRET|Internal server error|cambió en otra sesión/;
  const waitBanner = (p, kind, what) => p.wait('document.querySelector("' + R.messages + ' .hp-conflict-banner.is-' + kind + '")', what);

  if (!process.argv.includes('--editor-race-only')) {
  console.log('\n== CONCURRENCIA DEL SEGUIMIENTO (D3)');
  await clean();
  { // 1. Campos distintos: fusión segura; nada ajeno se pisa
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Nota de A');
    await remote('messages', 1, { respuesta: 'Respuesta de B', estado: 'en_proceso' });
    await save(p, R.messages); await waitBanner(p, 'merged', 'fusión segura');
    let v = await view(p, R.messages);
    ck(v.notas === 'Nota de A' && v.respuesta === 'Respuesta de B' && v.estado === 'en_proceso' && v.conflicts.length === 0 && !v.saveDisabled && !TECH.test(v.bannerText + v.alert), '1. campos distintos: el 409 se resuelve comparando; se conservan la nota de A y la respuesta y el estado de B, sin conflicto ni texto técnico del backend', v);
    ck((await putsOf('messages', 1)).length === 1 && (await putsOf('messages', 1))[0].applied === false, '1. el PUT rechazado (409) no se repite solo', (await putsOf('messages', 1)).length);
    await save(p, R.messages); await p.wait('document.querySelector("' + R.messages + ' .hp-notice")?.innerText.includes("Seguimiento guardado")', 'guardado');
    const server = (await state()).attention['messages:1']; const puts = await putsOf('messages', 1);
    ck(server.notas === 'Nota de A' && server.respuesta === 'Respuesta de B' && server.estado === 'en_proceso' && puts.length === 2 && puts[1].data.revision === 2, '1. el guardado posterior usa la revisión fresca y conserva ambos cambios en el servidor', server);
    await p.close(); }

  await clean();
  { // 2. Misma nota con valores distintos: conflicto, elección «mía»
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Versión de A'); await remote('messages', 1, { notas: 'Versión de B' });
    await save(p, R.messages); await waitBanner(p, 'conflict', 'conflicto');
    let v = await view(p, R.messages);
    ck(v.conflicts.length === 1 && v.conflicts[0].field === 'Notas internas' && v.conflicts[0].mine === 'Versión de A' && v.conflicts[0].theirs === 'Versión de B' && v.bannerRole === 'alert' && v.saveDisabled, '2. mismas notas con valores distintos: se muestra el campo, la versión local y la del servidor, y no se puede guardar todavía', v);
    ck(v.notas === 'Versión de A' && (await state()).attention['messages:1'].notas === 'Versión de B', '2. el borrador sigue intacto y el servidor conserva la nota de B (no se pisó)');
    ck(await p.evaluate("document.activeElement?.classList.contains('hp-conflict-banner')"), '2. el foco pasa al aviso de conflicto');
    await choose(p, 'Notas internas', 'Conservar mi versión'); await sleep(250); v = await view(p, R.messages);
    ck(v.conflicts.length === 0 && !v.saveDisabled && v.notas === 'Versión de A', '2. al elegir «Conservar mi versión» se habilita el guardado con el borrador de A');
    ck(await p.evaluate("document.activeElement?.textContent.includes('Guardar seguimiento')"), '2. al resolver el último conflicto el foco pasa a «Guardar seguimiento»');
    await save(p, R.messages); await p.wait('document.querySelector("' + R.messages + ' .hp-notice")?.innerText.includes("Seguimiento guardado")', 'guardado tras resolver');
    const puts = await putsOf('messages', 1); ck((await state()).attention['messages:1'].notas === 'Versión de A' && puts[1].data.revision === 2, '2. guardado después de resolver: se escribe la versión elegida con la revisión fresca'); await p.close(); }

  await clean();
  { // 2b. Elección «servidor»
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Versión de A'); await remote('messages', 1, { notas: 'Versión de B' });
    await save(p, R.messages); await waitBanner(p, 'conflict', 'conflicto'); await choose(p, 'Notas internas', 'Usar la del servidor'); await sleep(250);
    const v = await view(p, R.messages);
    ck(v.notas === 'Versión de B' && v.conflicts.length === 0, '2b. «Usar la del servidor» sustituye el borrador por la versión remota');
    ck(!(await p.evaluate("!!document.querySelector('dialog.hp-unsaved-dialog[open]')")) && (await p.evaluate("(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })()")) === false, '2b. sin diferencias con el servidor ya no hay cambios pendientes (no avisa al salir)'); await p.close(); }

  await clean();
  { // 3. Respuesta y estado en conflicto a la vez
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Respuesta de A', 1); await p.type(R.messages + ' fieldset select', 0, 'atendido');
    await remote('messages', 1, { respuesta: 'Respuesta de B', estado: 'en_proceso' }); await save(p, R.messages); await waitBanner(p, 'conflict', 'conflictos');
    let v = await view(p, R.messages); ck(v.conflicts.map(c => c.field).sort().join() === 'Estado,Respuesta al cliente' && v.saveDisabled, '3. respuesta y estado en conflicto: ambos se listan y el guardado queda bloqueado', v.conflicts);
    await choose(p, 'Estado', 'Usar la del servidor'); await sleep(200); v = await view(p, R.messages); ck(v.conflicts.length === 1 && v.saveDisabled, '3. con un conflicto pendiente sigue sin poder guardarse');
    await choose(p, 'Respuesta al cliente', 'Conservar mi versión'); await sleep(200); v = await view(p, R.messages); ck(v.conflicts.length === 0 && !v.saveDisabled && v.estado === 'en_proceso' && v.respuesta === 'Respuesta de A', '3. al resolver ambos se habilita el guardado con las elecciones hechas'); await p.close(); }

  await clean();
  { // 4. Ambos llegan al mismo valor
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Texto idéntico'); await remote('messages', 1, { notas: 'Texto idéntico' });
    await save(p, R.messages); await waitBanner(p, 'merged', 'sin conflicto'); const v = await view(p, R.messages);
    ck(v.conflicts.length === 0 && v.notas === 'Texto idéntico' && !v.saveDisabled, '4. ambos escribieron lo mismo: no se presenta un conflicto innecesario', v); await p.close(); }

  await clean();
  { // 5. Revisión nueva sin cambios en los campos editables
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Solo mi borrador'); await remote('messages', 1, {});
    await save(p, R.messages); await waitBanner(p, 'merged', 'revisión sin cambios'); let v = await view(p, R.messages);
    ck(v.conflicts.length === 0 && v.notas === 'Solo mi borrador', '5. revisión nueva sin cambio en campos editables: se acepta la revisión y se conserva el borrador');
    await save(p, R.messages); await p.wait('document.querySelector("' + R.messages + ' .hp-notice")?.innerText.includes("Seguimiento guardado")', 'guardado'); ck((await state()).attention['messages:1'].notas === 'Solo mi borrador', '5. y el guardado siguiente funciona'); await p.close(); }

  await clean();
  { // 6. Solo cambió el servidor (acción rápida de A mientras B editó las notas)
    const p = await session('/admin/messages?id=1'); await editorReady(p, R.messages); await remote('messages', 1, { notas: 'Notas de B', responsable: 'Beto' });
    await p.clickText('.hw-inbox-detail .hp-btn', 'Iniciar atención'); await p.wait('document.querySelector("' + R.messages + ' fieldset textarea").value === "Notas de B"', 'cambio remoto incorporado');
    const v = await view(p, R.messages); const puts = await putsOf('messages', 1);
    ck(v.notas === 'Notas de B' && v.responsable === 'Beto' && v.estado === 'en_proceso' && puts.length === 1 && puts[0].data.notas === 'Notas de B', '6. solo cambió el servidor: la acción rápida no pisa lo ajeno (reenvía los valores del servidor) y el editor los incorpora', { v, put: puts[0]?.data });
    await p.close(); }

  await clean();
  { // 7. Cambio de estado concurrente: la acción rápida no se aplica a ciegas
    const p = await session('/admin/messages?id=1'); await editorReady(p, R.messages); await remote('messages', 1, { estado: 'atendido' });
    await p.clickText('.hw-inbox-detail .hp-btn', 'Iniciar atención'); await p.wait('document.querySelector("[role=alert]")?.innerText.includes("Otro administrador cambió el estado")', 'aviso de estado concurrente');
    const t = await p.evaluate('document.querySelector("[role=alert]").innerText'); await sleep(500); const v = await view(p, R.messages);
    ck((await putsOf('messages', 1)).length === 0 && !TECH.test(t) && v.estado === 'atendido', '7. si otro administrador cambió el estado, la acción rápida NO escribe: avisa con un texto propio y el editor muestra el estado remoto', { t, estado: v.estado }); await p.close(); }

  await clean();
  { // 8. Error al cargar la versión remota
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Mi borrador'); await remote('messages', 1, { notas: 'Notas de B' }); await set({ getMode: 'error' });
    await save(p, R.messages); await waitBanner(p, 'compare-error', 'no se pudo comparar'); let v = await view(p, R.messages);
    ck(v.notas === 'Mi borrador' && v.saveDisabled && v.bannerRole === 'alert' && !TECH.test(v.bannerText), '8. si falla la carga de la versión remota se conserva el borrador, no se puede guardar y el mensaje no es técnico', v);
    await set({ getMode: 'ok' }); await p.evaluate("[...document.querySelectorAll('" + R.messages + " .hp-conflict-banner button')].find(b => b.textContent.includes('Reintentar comparación')).click(); 1");
    await p.wait('document.querySelector("' + R.messages + ' .hp-conflict-banner.is-conflict")', 'comparación tras reintentar'); v = await view(p, R.messages);
    ck(v.conflicts.length === 1 && v.conflicts[0].theirs === 'Notas de B', '8. «Reintentar comparación» recupera la versión remota y muestra el conflicto'); await p.close(); }

  await clean();
  { // 9. GET remoto fuera de orden
    await remote('messages', 1, { respuesta: 'R0' }); // ya hay una respuesta guardada: «Enviar respuesta guardada» está habilitado
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Nota de A'); await remote('messages', 1, { respuesta: 'R1' }); await set({ nextGetDelay: 1500 });
    await save(p, R.messages); await sleep(250); await remote('messages', 1, { respuesta: 'R2' });
    await p.evaluate("[...document.querySelectorAll('" + R.messages + " .hp-actions button')].find(b => b.textContent.includes('Enviar respuesta guardada')).click(); 1");
    await p.wait('document.querySelector("' + R.messages + ' fieldset textarea:nth-of-type(1)") && [...document.querySelectorAll("' + R.messages + ' fieldset textarea")][1].value === "R2"', 'versión más reciente (R2)'); await sleep(1800);
    const v = await view(p, R.messages); ck(v.respuesta === 'R2' && v.notas === 'Nota de A' && !v.saveDisabled, '9. la respuesta GET antigua (R1) que llega tarde no sustituye a la más reciente (R2)', v);
    await save(p, R.messages); await p.wait('document.querySelector("' + R.messages + ' .hp-notice")?.innerText.includes("Seguimiento guardado")', 'guardado'); const puts = await putsOf('messages', 1);
    ck(puts.at(-1).data.revision === 4 && (await state()).attention['messages:1'].respuesta === 'R2', '9. el guardado usa la revisión más reciente (4) y no pisa R2'); await p.close(); }

  await clean();
  { // 10. Guardado fallido tras resolver conflictos, luego correcto; doble envío
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Versión de A'); await remote('messages', 1, { notas: 'Versión de B' });
    await save(p, R.messages); await waitBanner(p, 'conflict', 'conflicto'); await choose(p, 'Notas internas', 'Conservar mi versión'); await sleep(250); await set({ putMode: 'fail' }); const putsBeforeFail = (await putsOf('messages', 1)).length;
    await save(p, R.messages); await p.wait('document.querySelector("' + R.messages + ' .hp-error")', 'error de guardado'); let v = await view(p, R.messages);
    // D6.3: un 5xx del editor completo es un resultado INCIERTO (no se afirma "falló"): el borrador y la elección se conservan, guardar queda bloqueado
    // y no hay texto técnico. Para continuar hay que comprobar el servidor y permitir un nuevo guardado de forma explícita.
    ck(v.notas === 'Versión de A' && v.conflicts.length === 0 && /No pudimos confirmar/.test(v.alert) && !/ER_SECRET|Internal/.test(v.alert) && v.saveDisabled && (await putsOf('messages', 1)).length === putsBeforeFail + 1, '10. guardado fallido tras resolver: el borrador y la elección se conservan', v);
    await set({ putMode: 'ok' });
    await p.evaluate("[...document.querySelectorAll('" + R.messages + " button')].find(b => b.textContent.includes('Comprobar estado del servidor')).click(); 1"); await p.wait('document.querySelector("' + R.messages + ' [data-save-uncertain=unchanged]")', 'servidor sin cambios');
    await p.evaluate("[...document.querySelectorAll('" + R.messages + " button')].find(b => b.textContent.includes('Permitir un nuevo guardado')).click(); 1");
    const before = (await putsOf('messages', 1)).length;
    await p.evaluate("(() => { const f = document.querySelector('" + R.messages + "'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); return 1 })()"); await p.wait('document.querySelector("' + R.messages + ' .hp-notice")?.innerText.includes("Seguimiento guardado")', 'guardado correcto');
    ck((await putsOf('messages', 1)).length === before + 1, '10. doble envío: una sola petición PUT'); await p.close(); }

  console.log('\n== NAVEGACIÓN Y SESIÓN');

  await clean();
  { // 12. Navegación con conflictos pendientes
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Versión de A'); await remote('messages', 1, { notas: 'Versión de B' }); await save(p, R.messages); await waitBanner(p, 'conflict', 'conflicto');
    await p.clickText('.hw-inbox-list button', 'Asunto 2'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al cambiar de consulta');
    ck(/consulta #1 \(con conflictos\)/.test(await p.evaluate("document.querySelector('dialog.hp-unsaved-dialog[open]').innerText")), '12. con conflictos pendientes, cambiar de consulta pide confirmar y lo indica');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(300);
    const v = await view(p, R.messages); ck(v.conflicts.length === 1 && v.notas === 'Versión de A', '12. Seguir editando conserva el conflicto y el borrador'); await p.close(); }

  await clean();
  { // 13. Sesión caducada durante la resolución
    const p = await openMessage(1); await typeNotes(p, R.messages, 'Versión de A'); await remote('messages', 1, { notas: 'Versión de B' }); await save(p, R.messages); await waitBanner(p, 'conflict', 'conflicto');
    await set({ expire: 1 }); await choose(p, 'Notas internas', 'Conservar mi versión'); await sleep(200); await save(p, R.messages); await p.wait('location.pathname === "/admin/login"', 'cierre por 401', 8000);
    ck(!(await p.evaluate("!!document.querySelector('dialog.hp-unsaved-dialog[open]')")) && (await p.evaluate('JSON.stringify([...Object.values(localStorage), ...Object.values(sessionStorage)])')).indexOf('Versión de A') < 0, '13. con la sesión caducada el cierre es forzoso (sin aviso) y el borrador no se guarda en ningún almacenamiento'); await p.close(); }

  console.log('\n== ACCESIBILIDAD Y RESPONSIVE DEL AVISO');
  await clean();
  { const p = await openMessage(1); await typeNotes(p, R.messages, 'Versión de A'); await remote('messages', 1, { notas: 'Versión de B' }); await save(p, R.messages); await waitBanner(p, 'conflict', 'conflicto');
    const a11y = await p.evaluate("(() => { const f = document.querySelector('" + R.messages + "'); const group = f.querySelector('.hp-conflict-field'); const region = f.querySelector('.hp-conflicts'); const ta = f.querySelector('fieldset textarea'); return { regionLabel: region.getAttribute('aria-labelledby') && document.getElementById(region.getAttribute('aria-labelledby')).textContent, groupRole: group.getAttribute('role'), groupLabel: document.getElementById(group.getAttribute('aria-labelledby')).textContent, invalid: ta.getAttribute('aria-invalid'), describedby: ta.getAttribute('aria-describedby') === region.getAttribute('aria-labelledby'), buttonsReachable: [...group.querySelectorAll('button')].every(b => b.tabIndex >= 0), saveReason: document.getElementById([...f.querySelectorAll('.hp-actions button')].find(b => b.textContent.includes('Guardar')).getAttribute('aria-describedby'))?.textContent }; })()");
    ck(/Resuelve el conflicto/.test(a11y.regionLabel) && a11y.groupRole === 'group' && a11y.groupLabel === 'Notas internas' && a11y.invalid === 'true' && a11y.describedby && /Elige una versión/.test(a11y.saveReason), 'el aviso es accesible: región y grupos con nombre, campo marcado aria-invalid y motivo del guardado bloqueado enlazado', a11y);
    await p.evaluate("document.querySelector('.hp-conflict-field button').focus(); 1"); await p.press('Enter', 'Enter', 13, '\r'); await sleep(300);
    ck((await view(p, R.messages)).conflicts.length === 0, 'el conflicto se resuelve solo con el teclado (foco en el botón + Enter)'); await p.close(); }
  for (const width of [320, 375, 768, 1024, 1366, 1920]) {
    await clean(); const p = await session('/admin/messages?id=1', width); await editorReady(p, R.messages);
    await typeNotes(p, R.messages, 'Versión de A con un texto bastante largo '.repeat(6)); await remote('messages', 1, { notas: 'Versión de B con otro texto largo '.repeat(6) }); await save(p, R.messages); await waitBanner(p, 'conflict', 'conflicto');
    const m = await p.evaluate("(() => { const box = document.querySelector('.hp-conflict-field'); const r = box.getBoundingClientRect(); const cols = [...box.querySelectorAll('.hp-conflict-versions > div')].map(d => d.getBoundingClientRect()); const buttons = [...box.querySelectorAll('button')].map(b => b.getBoundingClientRect()); return { over: document.documentElement.scrollWidth > innerWidth, inside: r.left >= 0 && r.right <= innerWidth + 1, buttons: buttons.every(b => b.left >= 0 && b.right <= innerWidth + 1 && b.width > 40), stacked: cols[1].top > cols[0].top, sideBySide: cols[1].left > cols[0].left }; })()");
    ck(!m.over && m.inside && m.buttons && (width <= 640 ? m.stacked : m.sideBySide), width + ' px: el aviso de conflicto cabe en pantalla, sin desbordamiento (' + (width <= 640 ? 'versiones apiladas' : 'versiones en columnas') + ') y con botones alcanzables', m); await p.close(); }

  console.log('\n== D4: ESTADOS EFECTIVOS Y ARCHIVO');
  {
    await clean(); await remote('messages',1,{estado:'atendido'});
    const p = await session('/admin/messages?id=1&estado=atendido'); await editorReady(p,R.messages);
    await typeNotes(p,R.messages,'Nota D4 conservada'); await p.type(R.messages+' fieldset select',0,'archivado'); await save(p,R.messages);
    await p.wait('document.querySelector(".hw-detail-heading .hp-badge")?.textContent === "Archivado" && document.querySelector("[data-testid=outside-list]")','archivo fuera del filtro');
    const s = await state();
    ck(s.contacts.find(m=>m.id===1).estado==='atendido' && s.attention['messages:1'].estado==='archivado','D4: fixture conserva separados Contacto atendido y seguimiento archivado');
    ck((await view(p,R.messages)).notas==='Nota D4 conservada' && (await p.evaluate('document.querySelector(".hw-inbox-detail h2")?.textContent'))==='Asunto 1','D4: archivar no desmonta detalle por ?id ni pierde notas al salir del filtro');
    ck((await p.evaluate('[...document.querySelectorAll(".hw-insights button strong")].map(e=>e.textContent).join(",")'))==='4,0,0,1','D4: métricas globales separan atendidos y archivados'); await p.close();
  }
  {
    await clean(); await remote('messages',1,{estado:'atendido'}); const p=await openMessage(1);
    await remote('messages',1,{estado:'archivado',notas:'Nota remota D4'});
    await p.clickText('.hw-inbox-detail .hp-btn','Iniciar atención');
    await p.wait('document.querySelector("[role=alert]")?.innerText.includes("Otro administrador cambió el estado")','archivo concurrente detectado');
    await p.wait('document.querySelector("'+R.messages+' fieldset select")?.value === "archivado"','editor sincronizado');
    ck((await putsOf('messages',1)).length===0,'D4: atendido -> archivado concurrente no se equipara ni escribe');
    await p.clickText('.hw-inbox-detail .hp-btn','Reabrir: En proceso');
    await p.wait('document.querySelector(".hw-detail-heading .hp-badge")?.textContent === "En proceso"','reapertura explícita');
    const s=await state(); ck(s.attention['messages:1'].estado==='en_proceso' && s.attention['messages:1'].notas==='Nota remota D4','D4: reapertura explícita conserva datos remotos'); await p.close();
  }
  // D6.3 fase A: `vista=tabla` abre la vista Tabla de la bandeja (MessageInbox). Estos casos antes usaban la tabla antigua con un diálogo de solo estado.
  const TABLE='/admin/messages?vista=tabla';
  {
    await clean(); await remote('messages',1,{estado:'archivado'});
    const p=await session(TABLE+'&estado=archivado&id=1',375);
    await p.wait('document.querySelectorAll(".hw-inbox-table tbody tr").length === 1','tabla filtrada por archivado');
    ck((await p.evaluate('document.querySelector(".hw-inbox-table .hp-badge")?.textContent'))==='Archivado','D4: la vista Tabla muestra y filtra archivado (375 px)');
    await editorReady(p,R.messages);
    await p.wait('document.querySelector("'+R.messages+' fieldset select")?.value === "archivado"','formulario archivado');
    await save(p,R.messages);
    await p.wait('document.querySelector("'+R.messages+' .hp-notice")?.innerText.includes("Seguimiento guardado")','guardar sin cambios');
    const puts=await putsOf('messages',1);
    // El editor completo escribe aunque no haya cambios (la tabla antigua con stateOnly no lo hacía); la invariante de D4 es que NO reabre el caso.
    ck(puts.length===1 && puts[0].data.estado==='archivado' && (await state()).attention['messages:1'].estado==='archivado','D4: guardar sin cambios no desarchiva (el PUT conserva «archivado»)'); await p.close();
  }
  {
    await clean(); await remote('messages',1,{estado:'atendido'}); const p=await session(TABLE+'&id=1');
    await editorReady(p,R.messages);
    await p.wait('document.querySelector("'+R.messages+' fieldset select")?.value === "atendido"','estado base de la vista Tabla');
    await p.type(R.messages+' fieldset select',0,'en_proceso');
    await remote('messages',1,{estado:'archivado',notas:'Nota remota de tabla'});
    await save(p,R.messages);
    await p.wait('document.querySelector("'+R.messages+' .hp-conflict-field")','conflicto explícito en la vista Tabla');
    ck((await p.evaluate('document.querySelector("'+R.messages+' fieldset select").value'))==='en_proceso' && (await state()).attention['messages:1'].estado==='archivado','D4: 409 en la vista Tabla conserva el borrador y no sustituye el archivo remoto');
    await p.evaluate('document.querySelector(".hw-inbox-table tbody tr button").click(); 1');
    await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")','borrador protegido en la vista Tabla');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1');
    await choose(p,'Estado','Conservar mi versión');
    await save(p,R.messages);
    await p.wait('document.querySelector("'+R.messages+' .hp-notice")?.innerText.includes("Seguimiento guardado")','reapertura decidida desde la vista Tabla');
    const s=await state(); ck(s.attention['messages:1'].estado==='en_proceso' && s.attention['messages:1'].notas==='Nota remota de tabla','D4: la vista Tabla reutiliza la fusión D3 y reabre solo tras elección explícita'); await p.close();
  }
  {
    await clean(); await remote('messages',1,{estado:'archivado'}); const p=await session('/admin/dashboard');
    await p.wait(`document.querySelector('a[href="/admin/messages?estado=archivado"]')`,'contador de archivados en dashboard');
    ck((await p.evaluate(`document.querySelector('a[href="/admin/messages?estado=archivado"]').innerText`)).includes('1 consultas archivadas') && (await p.evaluate('document.querySelector(".hp-activity .hp-badge")?.textContent'))==='Archivado','D4: dashboard y actividad reciente muestran archivo coherente'); await p.close();
  }
  }
  const PUBLIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
  const leaks = blocked.filter(b => { try { return b.method !== 'GET' || !PUBLIC_ASSET_HOSTS.includes(new URL(b.url).hostname); } catch { return true; } });
  ck(leaks.length === 0, 'ninguna petición externa inesperada (' + blocked.length + ' recursos públicos de fuentes/iconos bloqueados antes de enviarse)', leaks.slice(0, 3));
  ck(jsErrors.length === 0, 'sin excepciones de JavaScript', jsErrors.slice(0, 3));
  console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\nConflictos de seguimiento: OK.');
  cleanup();
  process.exit(fails ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
