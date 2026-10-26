// Guardado del seguimiento en el Centro de atención (D6.3, preparación): resultado incierto tras un timeout, comprobación explícita del servidor y
// protección del editor mientras hay un PUT pendiente. API simulada: nada real (ni datos, ni sesiones, ni correo). Edge por DevTools; las peticiones
// a otros orígenes se bloquean antes de enviarse.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../dist');
const edge = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';
const TOKEN = 'e30.' + Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') + '.d63';
const TOTAL = 30;

// ---------- API simulada ----------
const sim = { putMode: 'ok', putDelay: 0, getMode: 'ok' };
let messages, attn, attnR, writes, held, gets;
const blank = (id, resource = 'messages') => ({ estado: resource === 'messages' ? messages.find(m => m.id === id)?.estado || 'nuevo' : 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] });
const storeOf = resource => resource === 'reclamaciones' ? attnR : attn;
const cur = (id, resource = 'messages') => storeOf(resource)[id] || blank(id, resource);
const complaints = [1, 2, 3].map(id => ({ id, numero_reclamo: 'HG-00' + id, nombres: 'Nombre' + id, apellidos: 'Apellido' + id, tipo_doc: 'DNI', num_doc: '1234567' + id, email: 'r' + id + '@example.test', telefono: '987654321', direccion: 'Calle ' + id, tipo_registro: 'reclamo', area: 'Cursos', fecha_incidente: '2026-01-01', descripcion_bien: 'Bien ' + id, detalle_reclamo: 'Detalle ' + id, acepta_comunicaciones: true, createdAt: '2026-01-0' + id + 'T10:00:00.000Z' }));
const reset = () => {
  messages = Array.from({ length: TOTAL }, (_, i) => { const id = TOTAL - i; return { id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654321', asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: 'nuevo', createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z' }; });
  attn = {}; attnR = {}; writes = []; held = []; gets = 0; Object.assign(sim, { putMode: 'ok', putDelay: 0, getMode: 'ok' });
};
reset();
const apply = (id, data, resource = 'messages') => {
  const now = cur(id, resource);
  storeOf(resource)[id] = { ...now, estado: data.estado, responsable: data.responsable, notas: data.notas, respuesta: data.respuesta, revision: now.revision + 1, historial: [...now.historial, { accion: 'Seguimiento actualizado: ' + data.estado, usuario: 1, fecha: new Date().toISOString() }] };
  const message = resource === 'messages' ? messages.find(m => m.id === id) : null; if (message) message.estado = data.estado;
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (route === '/__clear') { for (const release of held) release(); reset(); return json({ ok: true }); }
    if (route === '/__set') { for (const [k, v] of url.searchParams) sim[k] = isNaN(Number(v)) ? v : Number(v); return json({ ok: true }); }
    if (route === '/__release') { for (const release of held.splice(0)) release(); return json({ ok: true }); }
    if (route === '/__remote') { // otro administrador guarda: sube la revisión y cambia solo los campos indicados
      const id = Number(url.searchParams.get('id')), resource = url.searchParams.get('resource') || 'messages', now = cur(id, resource), changes = {};
      for (const f of ['estado', 'responsable', 'notas', 'respuesta']) if (url.searchParams.has(f)) changes[f] = url.searchParams.get(f);
      storeOf(resource)[id] = { ...now, ...changes, revision: now.revision + 1, historial: [...now.historial, { accion: 'Cambio de otro administrador', usuario: 2, fecha: new Date().toISOString() }] };
      return json({ ok: true, revision: storeOf(resource)[id].revision });
    }
    if (route === '/__state') return json({ writes, attn, attnR, held: held.length, gets });
    if (route.startsWith('/api/')) {
      if (route === '/api/settings') return json({ ok: true, settings: {} });
      if (route.startsWith('/api/admin/')) {
        if (token !== TOKEN) return json({ message: 'Unauthorized' }, 401);
        const sub = route.slice('/api/admin/'.length); let m;
        if (sub === 'me') return json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } });
        if (sub === 'messages') {
          const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
          const metrics = Object.fromEntries(['nuevo', 'en_proceso', 'atendido', 'archivado'].map(s => [s, messages.filter(x => x.estado === s).length]));
          return json({ ok: true, messages: messages.slice((page - 1) * limit, page * limit), pagination: { total: messages.length, page, limit, pages: Math.ceil(messages.length / limit) }, metrics });
        }
        if ((m = sub.match(/^messages\/(\d+)$/))) { const one = messages.find(x => x.id === +m[1]); return one ? json({ ok: true, message: one }) : json({ message: 'No encontrado' }, 404); }
        if (sub === 'reclamaciones') return json({ ok: true, reclamaciones: complaints, pagination: { total: complaints.length, page: 1, limit: 10, pages: 1 }, metrics: { total: complaints.length, reclamo: complaints.length, queja: 0 } });
        if ((m = sub.match(/^seguimiento\/(messages|reclamaciones)\/(\d+)$/))) {
          const resource = m[1], id = +m[2];
          if (req.method === 'GET') { gets++; if (sim.getMode === 'fail') return json({ message: 'Internal server error ER_SECRET' }, 500); return json({ ok: true, item: { ...cur(id, resource), envios: { respuesta: null, constancia: null } } }); }
          const data = await body(); const entry = { id, resource, data, applied: false }; writes.push(entry);
          const reply = () => json({ ok: true, item: { ...cur(id, resource), envios: { respuesta: null, constancia: null } } });
          if (sim.putMode === 'fail500') return json({ message: 'Internal server error ER_SECRET' }, 500);
          if (sim.putMode === 'fail400') return json({ message: 'El responsable no es válido.' }, 400);
          if (sim.putMode === 'hold') await new Promise(resolve => held.push(resolve)); // la respuesta se retiene hasta /__release
          if (sim.putMode === 'lateApply') await sleep(sim.putDelay || 1200);     // el servidor tarda y APLICA el guardado después de que el navegador se rindió
          if (sim.putMode === 'neverApply') { await sleep(sim.putDelay || 1500); return res.end(); } // el servidor no llega a aplicarlo
          if (data.revision !== cur(id, resource).revision) return json({ message: 'El seguimiento cambió en otra sesión. Recarga el caso.' }, 409);
          apply(id, data, resource); entry.applied = true;
          if (sim.putMode === 'applyThenSlow') await sleep(sim.putDelay || 1500);   // aplicado, pero la respuesta llega cuando el navegador ya canceló
          return reply();
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
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-save-');
  const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' });
  const cleanup = require('./smoke-cleanup.cjs')(child, profile, server);
  let version; for (let i = 0; i < 100 && !version; i++) { await sleep(100); try { version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); } catch { /* arrancando */ } }
  const bc = connect(version.webSocketDebuggerUrl); await bc.ready;
  const jsErrors = [], blocked = []; let fails = 0, page;
  const ck = (cond, name, detail = '') => { console.log((cond ? '  OK  ' : ' FALLA ') + name + (cond ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500))); if (!cond) fails++; };

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
  const release = () => fetch(origin + '/__release');
  const remote = (id, changes, resource = 'messages') => fetch(origin + '/__remote?' + new URLSearchParams({ id: String(id), resource, ...changes }));
  const SETTER = "(el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }";
  // Los tiempos de espera de 15 s (guardado, comprobación, listados) se acortan solo en la página de prueba para no esperar de verdad.
  const FAST = "(() => { const st = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...a) => st(fn, ms === 15000 ? 400 : ms, ...a); })()";
  const session = async (route, fast = false) => { await fetch(origin + '/__clear'); if (page) await page.close(); page = await open(); if (fast) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FAST }); await page.go('/__empty'); await page.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN) + '); 1'); await page.go(route); };
  const F = '.hw-inbox-detail form.hp-form';
  const editor = async (route, fast) => { await session(route, fast); await page.wait('document.querySelector("' + F + ' fieldset textarea")', 'editor de seguimiento'); };
  const fill = (selector, value) => page.evaluate('(() => { const set = ' + SETTER + '; set(document.querySelector(' + JSON.stringify(selector) + '), ' + JSON.stringify(value) + '); return 1 })()');
  const typeNotes = value => fill(F + ' fieldset textarea', value);
  const notesValue = () => page.evaluate('document.querySelector("' + F + ' fieldset textarea").value');
  const submit = () => page.evaluate('document.querySelector("' + F + '").requestSubmit(); 1');
  const clickBtn = (scope, label) => page.evaluate('(() => { const b = [...document.querySelectorAll(' + JSON.stringify(scope + ' button') + ')].find(x => x.textContent.trim().includes(' + JSON.stringify(label) + ')); if (!b) throw new Error("sin botón " + ' + JSON.stringify(label) + '); b.click(); return 1 })()');
  const btn = label => page.evaluate('(() => { const b = [...document.querySelectorAll(".hw-inbox-detail button")].find(x => x.textContent.trim().includes(' + JSON.stringify(label) + ')); return b ? { disabled: b.disabled } : null })()');
  const bodyText = () => page.evaluate('document.body.innerText');
  const waitText = (value, what, timeout) => page.wait('document.body.innerText.includes(' + JSON.stringify(value) + ')', what, timeout);
  const waitWrites = async n => { const end = Date.now() + 8000; while (Date.now() < end) { if ((await state()).writes.length >= n) return; await sleep(50); } throw new Error('El PUT no llegó al servidor'); };
  const doubt = () => page.evaluate('(() => { const d = document.querySelector("' + F + ' [data-save-uncertain]"); return d ? { phase: d.dataset.saveUncertain, text: d.innerText } : null })()');
  const waitDoubt = () => page.wait('document.querySelector("' + F + ' [data-save-uncertain]")', 'aviso de resultado incierto');
  const cards = () => page.evaluate('({ total: document.querySelectorAll(".hw-inbox-list > button").length, disabled: [...document.querySelectorAll(".hw-inbox-list > button")].every(b => b.disabled), anyEnabled: [...document.querySelectorAll(".hw-inbox-list > button")].some(b => !b.disabled) })');
  const viewButtons = () => page.evaluate('[...document.querySelectorAll(".hw-tabs[aria-label=\\"Vista del listado\\"] button")].map(b => b.textContent.trim() + ":" + b.disabled + ":" + b.getAttribute("aria-pressed")).join()');
  const heading = () => page.evaluate('document.querySelector(".hw-detail-heading small")?.innerText || ""');
  const url = () => page.evaluate('location.pathname + location.search');
  const unsavedDialog = () => page.evaluate('(() => { const d = document.querySelector("dialog.hp-unsaved-dialog[open]"); return d ? d.innerText : null })()');
  const pressKey = async (key, code, vk, extra = {}) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...extra }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); await sleep(120); };

  console.log('\n== GUARDADO DEL SEGUIMIENTO — RESULTADO INCIERTO Y GUARDADO PENDIENTE');
  { // 1. Guardado normal
    await editor('/admin/messages?id=3'); await typeNotes('Nota S1'); await submit(); await waitText('Seguimiento guardado.', 'guardado');
    const s = await state(), c = await cards();
    ck(s.writes.length === 1 && s.writes[0].data.revision === 1 && s.writes[0].data.notas === 'Nota S1' && s.writes[0].applied && s.attn[3].revision === 2 && !(await doubt()) && c.anyEnabled && !(await bodyText()).includes('Tienes cambios sin guardar'), '1. guardado normal: un PUT con la revisión vigente, editor limpio, sin aviso incierto y la lista vuelve a estar disponible', { writes: s.writes.length, doubt: await doubt() }); }

  { // 2, 3 y 12. Timeout: el servidor aplica el guardado pero la respuesta llega tarde
    await editor('/admin/messages?id=3', true); await set({ putMode: 'applyThenSlow', putDelay: 1500 });
    const DRAFT = 'Borrador del timeout\nlínea 2 «ñ» <i>no es HTML</i>';
    await typeNotes(DRAFT); await submit(); await waitDoubt(); const d = await doubt(), s1 = await state();
    ck(/No pudimos confirmar si el seguimiento se guardó/.test(d.text) && !(await bodyText()).includes('Seguimiento guardado.') && s1.writes.length === 1, '2. timeout: aviso de resultado incierto, sin anunciar éxito ni fracaso definitivo y con un único PUT', d);
    ck((await notesValue()) === DRAFT, '3. el borrador se conserva exactamente tras el timeout');
    ck(await page.evaluate('document.activeElement?.dataset?.saveUncertain === "none"') , '2. el foco pasa al aviso', await page.evaluate('document.activeElement?.tagName + ":" + (document.activeElement?.dataset?.saveUncertain || "")'));
    const saveBtn = await btn('Guardar seguimiento'), mailBtns = [await btn('Enviar respuesta guardada'), await btn('Reenviar constancia'), await btn('Marcar atendido'), await btn('Eliminar consulta')];
    ck(saveBtn.disabled && mailBtns.every(b => b && b.disabled), '12. con el resultado incierto quedan bloqueados guardar, correo, constancia, cambio rápido de estado y eliminación', { saveBtn, mailBtns });
    await submit(); await submit(); await sleep(300);
    ck((await state()).writes.length === 1, '12. un segundo guardado (envío repetido del formulario) no genera otro PUT mientras el resultado sigue incierto');
    await sleep(1700); // llega la respuesta tardía del servidor
    const late = await state();
    ck(late.writes.length === 1 && late.attn[3].revision === 2 && !!(await doubt()) && (await notesValue()) === DRAFT && !(await bodyText()).includes('Seguimiento guardado.'), '7. la respuesta tardía no cambia la interfaz: sigue incierto, sin éxito anunciado, con el borrador y sin reintento automático', { writes: late.writes.length, doubt: !!(await doubt()) });
    // 4. comprobación explícita: el servidor muestra EXACTAMENTE lo enviado en la revisión siguiente
    const getsBefore = late.gets; await clickBtn(F, 'Comprobar estado del servidor'); await waitText('El servidor muestra exactamente los valores que enviaste', 'conciliación');
    const after = await state();
    ck(after.gets === getsBefore + 1 && after.writes.length === 1 && !(await doubt()) && (await notesValue()) === DRAFT && !(await btn('Guardar seguimiento')).disabled && !(await bodyText()).includes('Tienes cambios sin guardar'), '4. «Comprobar» usa un GET, confirma por coincidencia exacta (revisión +1), limpia la incertidumbre sin enviar nada y deja el editor sin cambios pendientes', { gets: after.gets - getsBefore, writes: after.writes.length });
    // 11. reanudación: un nuevo guardado explícito funciona con la revisión nueva
    await typeNotes(DRAFT + ' (2)'); await submit(); await waitText('Seguimiento guardado.', 'segundo guardado');
    ck((await state()).writes.length === 2 && (await state()).writes[1].data.revision === 2, '11. tras resolver la incertidumbre se puede guardar de nuevo, con la revisión reconciliada'); }

  { // 5a. El GET no permite concluir: el servidor sigue en la revisión anterior
    await editor('/admin/messages?id=4', true); await set({ putMode: 'neverApply', putDelay: 1500 }); await typeNotes('Nota S5'); await submit(); await waitDoubt();
    await clickBtn(F, 'Comprobar estado del servidor'); await page.wait('document.querySelector("' + F + ' [data-save-uncertain=unchanged]")', 'sin cambios en el servidor');
    const d = await doubt();
    ck(/sigue en la revisión 1/.test(d.text) && /todavía podría llegar/.test(d.text) && (await btn('Guardar seguimiento')).disabled && (await state()).writes.length === 1 && (await notesValue()) === 'Nota S5', '5. si el servidor no cambió no se concluye: sigue incierto, guardar sigue bloqueado y el borrador se conserva', d);
    await set({ getMode: 'fail' }); await clickBtn(F, 'Comprobar estado del servidor'); await page.wait('document.querySelector("' + F + ' [data-save-uncertain=failed]")', 'comprobación fallida');
    ck(/No pudimos consultar el servidor/.test((await doubt()).text) && !/ER_SECRET|Internal/.test(await bodyText()) && (await btn('Guardar seguimiento')).disabled, '5. si el GET falla tampoco se concluye ni se muestra texto técnico, y guardar sigue bloqueado');
    await set({ getMode: 'ok' }); await clickBtn(F, 'Comprobar estado del servidor'); await page.wait('document.querySelector("' + F + ' [data-save-uncertain=unchanged]")', 'otra vez sin cambios');
    await clickBtn(F, 'Permitir un nuevo guardado'); await sleep(150);
    ck(!(await doubt()) && !(await btn('Guardar seguimiento')).disabled && (await state()).writes.length === 1, '5. «Permitir un nuevo guardado» es una decisión explícita de la persona y no envía nada por sí sola');
    await set({ putMode: 'ok' }); await submit(); await waitText('Seguimiento guardado.', 'guardado explícito');
    ck((await state()).writes.length === 2 && (await state()).writes[1].data.revision === 1, '5. el nuevo guardado explícito lleva la misma revisión vigente (si el primero llegara tarde, el servidor lo rechazaría con 409)'); }

  { // 7b. El servidor aplica el guardado DESPUÉS de que el navegador se rindió: primero «sin cambios», luego confirmado
    await editor('/admin/messages?id=5', true); await set({ putMode: 'lateApply', putDelay: 1200 }); await typeNotes('Nota S7b'); await submit(); await waitDoubt();
    await clickBtn(F, 'Comprobar estado del servidor'); await page.wait('document.querySelector("' + F + ' [data-save-uncertain=unchanged]")', 'aún sin aplicar');
    const early = await state(); await sleep(1300); await clickBtn(F, 'Comprobar estado del servidor'); await waitText('El servidor muestra exactamente los valores que enviaste', 'aplicado tarde');
    const late = await state();
    ck(early.attn[5] === undefined && late.attn[5].revision === 2 && late.writes.length === 1 && !(await doubt()), '7. si el guardado se aplica tarde, la primera comprobación no concluye y la segunda lo confirma; nunca hubo un segundo PUT', { early: early.attn[5], writes: late.writes.length }); }

  { // 6. 409 durante el guardado (D3): fusión y conservación del borrador, sin resultado incierto
    await editor('/admin/messages?id=6');
    await page.evaluate('(() => { const set = ' + SETTER + '; set(document.querySelectorAll("' + F + ' fieldset textarea")[1], "Respuesta local D3"); return 1 })()');
    await remote(6, { notas: 'Nota remota D3' }); await submit();
    await page.wait('document.querySelector("' + F + ' .hp-conflict-banner.is-merged")', 'fusión segura tras el 409'); await sleep(700);
    const s = await state(), values = await page.evaluate('({ notas: document.querySelectorAll("' + F + ' fieldset textarea")[0].value, respuesta: document.querySelectorAll("' + F + ' fieldset textarea")[1].value })');
    ck(s.writes.length === 1 && !s.writes[0].applied && !(await doubt()) && values.notas === 'Nota remota D3' && values.respuesta === 'Respuesta local D3', '6. un 409 sigue el flujo D3: el PUT rechazado no se repite, se fusionan los campos distintos y el borrador se conserva (sin estado incierto)', { writes: s.writes.length, values });
    await submit(); await waitText('Seguimiento guardado.', 'guardado tras fusionar');
    ck((await state()).writes[1].data.revision === 2 && (await state()).attn[6].respuesta === 'Respuesta local D3' && (await state()).attn[6].notas === 'Nota remota D3', '13. el segundo guardado usa la revisión reconciliada y conserva ambos cambios'); }

  { // 8, 9, 11. Guardado pendiente: no se cambia de consulta, de filtro de estado ni de vista
    await editor('/admin/messages?id=5'); await set({ putMode: 'hold' }); await typeNotes('Nota pendiente'); await submit(); await waitWrites(1);
    await page.wait('document.body.innerText.includes("Guardando el seguimiento")', 'aviso de guardado pendiente');
    const c = await cards();
    ck(c.total > 0 && c.disabled, '8. mientras el PUT está pendiente, las consultas del listado están deshabilitadas', c);
    ck(await page.evaluate('document.querySelector("' + F + '").getAttribute("aria-busy") === "true" && [...document.querySelectorAll("[role=status]")].some(e => e.textContent.includes("Guardando el seguimiento"))'), '8. la operación pendiente se anuncia de forma accesible (aria-busy y región de estado)');
    await page.evaluate('document.querySelectorAll(".hw-inbox-list > button")[2].click(); 1'); await sleep(250);
    ck((await url()) === '/admin/messages?id=5' && (await heading()) === 'Consulta #5' && (await notesValue()) === 'Nota pendiente' && !(await unsavedDialog()), '8. un clic forzado sobre otra consulta no cambia la selección, ?id= ni el borrador', { url: await url(), heading: await heading() });
    const vb = await viewButtons();
    await page.evaluate('document.querySelectorAll(".hw-tabs[aria-label=\\"Vista del listado\\"] button")[1].click(); 1'); await sleep(250);
    ck(/Bandeja:true:true/.test(vb) && /Tabla:true:false/.test(vb) && (await viewButtons()) === vb && !(await page.evaluate('!!document.querySelector(".hw-inbox-table")')), '9. el cambio de vista está bloqueado mientras guarda', vb);
    ck(await page.evaluate('document.querySelector("select[aria-label=\\"Estado de atención\\"]").disabled && [...document.querySelectorAll(".hw-insights button")].every(b => b.disabled)'), '8. el filtro de estado (que limpiaría ?id=) también está bloqueado');
    ck((await btn('Marcar atendido')).disabled && (await btn('Eliminar consulta')).disabled && await page.evaluate('document.querySelector(".hw-inbox-detail a[href*=\\"cotizaciones\\"]").getAttribute("aria-disabled") === "true"'), '8. también quedan bloqueados el cambio rápido de estado, la eliminación y el enlace a cotizaciones');
    await release(); await waitText('Seguimiento guardado.', 'respuesta del PUT'); await sleep(200);
    const done = await cards(), vb2 = await viewButtons();
    ck(done.anyEnabled && /Bandeja:false:true/.test(vb2) && !(await bodyText()).includes('Guardando el seguimiento'), '11. al llegar la respuesta definitiva se libera todo (listado y vista)', { done, vb2 });
    await page.evaluate('document.querySelectorAll(".hw-inbox-list > button")[2].click(); 1'); await page.wait('location.search !== "?id=5"', 'cambio de consulta'); await sleep(200);
    ck(!(await unsavedDialog()) && /^Consulta #\d+$/.test(await heading()) && (await heading()) !== 'Consulta #5', '11. después de guardar se puede cambiar de consulta sin avisos', await url()); }

  { // 10. Atrás con un guardado pendiente
    await editor('/admin/messages?id=6'); await page.evaluate('document.querySelectorAll(".hw-inbox-list > button")[4].click(); 1'); await page.wait('location.search !== "?id=6"', 'segunda consulta'); await page.wait('document.querySelector("' + F + ' fieldset textarea")', 'editor');
    const second = await url(); await set({ putMode: 'hold' }); await typeNotes('Nota Atrás'); await submit(); await waitWrites(1);
    await page.evaluate('history.back(); 1'); await page.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al volver atrás');
    const text = await unsavedDialog();
    ck(/operación en curso/.test(text) && /Seguir editando/.test(text), '10. Atrás con un guardado pendiente pasa por el aviso de cambios sin guardar, que nombra la operación en curso', text);
    await page.evaluate('[...document.querySelectorAll("dialog.hp-unsaved-dialog[open] button")].find(b => b.textContent.includes("Seguir editando")).click(); 1'); await sleep(250);
    ck((await url()) === second && (await notesValue()) === 'Nota Atrás' && (await state()).held === 1, '10. «Seguir editando» mantiene la selección, ?id=, el borrador y el PUT pendiente', { url: await url(), held: (await state()).held });
    await release(); await waitText('Seguimiento guardado.', 'respuesta del PUT'); await sleep(200);
    await page.evaluate('history.back(); 1'); await page.wait('location.search === "?id=6"', 'Atrás sin cambios pendientes'); await page.evaluate('history.forward(); 1'); await page.wait('location.search === ' + JSON.stringify(second.replace('/admin/messages', '')), 'Adelante');
    ck(!(await unsavedDialog()), '10. una vez guardado, Atrás y Adelante navegan sin avisos'); }

  { // 14. D4: archivado y estados
    await editor('/admin/messages?id=8'); await page.evaluate('(() => { const set = ' + SETTER + '; set(document.querySelector("' + F + ' fieldset select"), "archivado"); return 1 })()');
    await submit(); await waitText('Seguimiento guardado.', 'archivado'); await page.wait('[...document.querySelectorAll(".hw-inbox-detail button")].some(b => b.textContent.includes("Reabrir"))', 'acciones de reapertura');
    const s = await state();
    ck(s.writes.length === 1 && s.writes[0].data.estado === 'archivado' && s.attn[8].estado === 'archivado' && (await page.evaluate('document.querySelector(".hw-detail-heading .hp-badge")?.innerText.toLowerCase()')) === 'archivado', '14. archivar desde el editor sigue funcionando: un PUT con el estado, insignia actualizada y acciones de reapertura disponibles'); }

  { // 15. Rechazo definitivo (400): sin estado incierto
    await editor('/admin/messages?id=9'); await set({ putMode: 'fail400' }); await typeNotes('Nota rechazada'); await submit(); await page.wait('document.querySelector("' + F + ' [role=alert]")', 'error');
    ck(!(await doubt()) && (await bodyText()).includes('El responsable no es válido.') && !(await btn('Guardar seguimiento')).disabled && (await notesValue()) === 'Nota rechazada', '15. un 400 es un rechazo definitivo: mensaje del servidor, sin estado incierto, borrador conservado y se puede corregir'); }

  { // 16. 5xx durante el guardado: incierto (el servidor pudo procesarlo)
    await editor('/admin/messages?id=10'); await set({ putMode: 'fail500' }); await typeNotes('Nota 5xx'); await submit(); await waitDoubt();
    ck(!/ER_SECRET|Internal/.test(await bodyText()) && (await state()).writes.length === 1 && (await notesValue()) === 'Nota 5xx', '16. un 5xx se trata como resultado incierto (sin texto técnico, sin reintento y con el borrador)'); }

  { // 18. Invalidación de sesión con un PUT pendiente (equivale a la antigua suite de cierre del diálogo de estado, ya retirada)
    await editor('/admin/messages?id=11'); await set({ putMode: 'hold' }); await typeNotes('Nota de la sesión anterior'); await submit(); await waitWrites(1);
    await page.evaluate('window.dispatchEvent(new CustomEvent("horus:session-expired", { detail: { token: localStorage.getItem(' + JSON.stringify(KEY) + ') } })); 1');
    await page.wait('location.pathname === "/admin/login"', 'invalidación obligatoria durante el PUT');
    ck(!(await unsavedDialog()) && (await page.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')')) === null, '18. la invalidación de la sesión desmonta el editor con el PUT en vuelo sin retener la sesión ni pedir confirmar el descarte');
    await page.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN) + '); window.dispatchEvent(new StorageEvent("storage", { key: ' + JSON.stringify(KEY) + ', newValue: ' + JSON.stringify(TOKEN) + ' })); 1');
    // La sesión revalidada vuelve a la misma consulta (ruta de retorno): se monta un editor NUEVO para el mismo id mientras el PUT anterior sigue retenido.
    await page.wait('location.pathname === "/admin/messages" && document.querySelector("' + F + ' fieldset textarea")', 'editor nuevo de la misma consulta'); await waitText('Consulta #11', 'misma consulta');
    await typeNotes('Borrador del editor nuevo'); await release(); await sleep(600); // llega la respuesta del PUT del editor anterior
    ck((await notesValue()) === 'Borrador del editor nuevo' && !(await bodyText()).includes('Seguimiento guardado.'), '18. la respuesta de un editor anterior de la MISMA consulta no cambia ni limpia el borrador del editor nuevo');
    await page.evaluate('document.querySelectorAll(".hw-inbox-list > button")[3].click(); 1'); await page.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'borrador nuevo protegido');
    ck(true, '18. y el borrador nuevo sigue protegido (el callback antiguo no limpia el aviso de cambios sin guardar)'); }


  const PUBLIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'www.google.com'];
  const leaks = blocked.filter(b => { try { return b.method !== 'GET' || !PUBLIC_ASSET_HOSTS.includes(new URL(b.url).hostname); } catch { return true; } });
  ck(leaks.length === 0, 'ninguna petición externa inesperada (' + blocked.length + ' recursos públicos bloqueados antes de enviarse)', leaks.slice(0, 3));
  ck(jsErrors.length === 0, 'sin excepciones de JavaScript', jsErrors.slice(0, 3));
  console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\nGuardado del seguimiento: OK.');
  cleanup();
  process.exit(fails ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
