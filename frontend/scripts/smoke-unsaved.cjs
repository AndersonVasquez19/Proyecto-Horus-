// Protección de cambios sin guardar en el panel, con API simulada (nada real: ni datos, ni sesiones, ni correo). Edge por DevTools.
// Comprueba que ninguna escritura llega a un servidor real: todas las peticiones van al servidor local de esta prueba.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../dist'), browser = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwtLike = (id, tag) => 'e30.' + b64({ id }) + '.' + tag; // el cliente solo lee el id como pista; /admin/me confirma
const TOK = { A1: jwtLike(1, 'a1'), A2: jwtLike(1, 'a2'), B: jwtLike(2, 'b'), F: jwtLike(1, 'forged') }; // F: el JWT dice id 1, pero el servidor la asocia a la cuenta 2
const MARK = 'NOTA-SENSIBLE-' + Date.now(); // texto único para comprobar que nunca llega a ningún almacenamiento

// ---------- API simulada ----------
const accounts = { 1: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' }, 2: { id: 2, nombre: 'Beto Administrador', email: 'beto@example.test' } };
const known = new Set(Object.values(TOK));
const sim = { meMode: 'ok', writeMode: 'ok', expired: new Set() };
const writes = [], me = [];
const messages = [1, 2, 3].map(id => ({ id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654321', asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: 'nuevo', createdAt: '2026-01-0' + id + 'T10:00:00.000Z' }));
const attention = Object.fromEntries(messages.map(m => [m.id, { estado: 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] }]));
const settings = [{ clave: 'empresa_nombre', valor: 'Horus Group', descripcion: 'Nombre de la empresa', grupo: 'general' }, { clave: 'email_contacto', valor: 'info@example.test', descripcion: 'Correo de contacto', grupo: 'general' }];
const cursos = [1, 2].map(id => ({ id, titulo: 'Curso ' + id, slug: 'curso-' + id, tipo: 'curso', modalidad: 'virtual', duracion: '10 horas', descripcion: 'Descripción ' + id, estado: 'publicado', categoria: 'curso', fecha_inicio: '2099-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
const convenio = { id: 1, nombre: 'Convenio de prueba', sigla: 'CDP', logo_url: null, descripcion_corta: 'Resumen', descripcion_completa: '', informacion_adicional: '', orden: 1, visible: true, fotos: [] };
const zero = { total: 0, publicados: 0, borradores: 0, archivados: 0 };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'expire') sim.expired.add(value); else if (key === 'bump') attention[value].revision++; else if (key === 'clear') { sim.meMode = 'ok'; sim.writeMode = 'ok'; sim.putDelay = 0; sim.expired.clear(); writes.length = 0; me.length = 0; for (const m of messages) { m.estado = 'nuevo'; } for (const id of Object.keys(attention)) attention[id] = { estado: 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] }; } else sim[key] = value; return json({ ok: true }); }
    if (route === '/__state') return json({ writes, me, expired: [...sim.expired] });
    if (route.startsWith('/api/')) {
      if (route === '/api/settings') return json({ ok: true, settings: {} });
      if (route === '/api/admin/me') {
        me.push(token);
        if (sim.meMode === '503') return json({ message: 'no disponible' }, 503);
        const id = known.has(token) && !sim.expired.has(token) ? (token === TOK.F ? 2 : JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).id) : 0;
        return id ? json({ ok: true, user: accounts[id] }) : json({ message: 'Unauthorized' }, 401);
      }
      if (route === '/api/admin/login') return json({ ok: false }, 401);
      if (route.startsWith('/api/admin/')) {
        if (!known.has(token) || sim.expired.has(token)) return json({ message: 'Unauthorized' }, 401);
        const sub = route.slice('/api/admin/'.length);
        if (req.method !== 'GET') {
          const data = await body(); writes.push({ method: req.method, route: sub, data });
          if (sim.putDelay && sub.startsWith('seguimiento/')) await sleep(Number(sim.putDelay)); // PUT retrasado: permite escribir mientras está pendiente
          if (sim.writeMode === 'fail') return json({ message: 'Fallo simulado interno' }, 500);
          let m;
          if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/)) && req.method === 'PUT') {
            const current = attention[m[1]]; if (data.revision !== current.revision) return json({ message: 'La respuesta cambió. Recarga el caso.' }, 409);
            attention[m[1]] = { ...current, ...data, revision: current.revision + 1 }; messages.find(x => x.id === +m[1]).estado = data.estado;
            return json({ ok: true, item: attention[m[1]] });
          }
          if (sub === 'settings') { for (const [clave, valor] of Object.entries(data.ajustes || {})) { const s = settings.find(x => x.clave === clave); if (s) s.valor = valor; } return json({ ok: true }); }
          if (sub === 'cotizaciones') return json({ ok: true, item: { id: 1 } });
          if (/^cursos\/\d+$/.test(sub)) return json({ ok: true, item: { ...cursos[0], ...data } });
          if (/^convenios/.test(sub)) return json({ ok: true, item: { ...convenio, ...data } });
          return json({ ok: true });
        }
        let m;
        if (sub === 'stats') return json({ ok: true, stats: { mensajes: { total: 3, nuevos: 3, enProceso: 0, atendidos: 0 }, reclamaciones: { total: 0 }, contenido: { total: 0 }, catalogo: { cursos: { ...zero, por_tipo: { curso: { ...zero }, capacitacion: { ...zero } } }, servicios: zero, 'preguntas-frecuentes': zero } }, actividadReciente: { mensajes: [], reclamaciones: [] } });
        if (sub === 'messages') {
          const search = (url.searchParams.get('search') || '').toLowerCase();
          const rows = messages.filter(x => !search || x.nombre.toLowerCase().includes(search));
          return json({ ok: true, messages: rows, pagination: { total: rows.length, pages: 1 }, metrics: { nuevo: rows.filter(x => x.estado === 'nuevo').length, en_proceso: 0, atendido: 0 } });
        }
        if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/))) return json({ ok: true, item: attention[m[1]] });
        if (sub === 'settings') return json({ ok: true, settings });
        if (sub === 'cotizaciones') return json({ ok: true, items: [], pagination: { total: 0, pages: 0 } });
        if ((m = sub.match(/^messages\/(\d+)$/))) return json({ ok: true, message: messages.find(x => x.id === +m[1]) });
        if (sub === 'cursos') return json({ ok: true, items: cursos, pagination: { total: cursos.length, pages: 1 } });
        if ((m = sub.match(/^cursos\/(\d+)$/))) return json({ ok: true, item: cursos.find(x => x.id === +m[1]) });
        if (sub === 'convenios') return json({ ok: true, items: [convenio], pagination: { page: 1, total: 1, pages: 1 } });
        if (sub === 'convenios/1') return json({ ok: true, item: convenio });
        return json({ ok: true, items: [], messages: [], users: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} });
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

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}
async function main() {
  // El smoke sirve dist/: si el código fuente es más reciente, probaría una versión antigua. (npm run smoke:unsaved compila antes, en local y sin red.)
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Falta dist/: ejecuta "npm run build".');
  const builtAt = fs.statSync(path.join(root, 'index.html')).mtimeMs, changedAt = Math.max(newestMtime(path.resolve(__dirname, '../src')), fs.statSync(path.resolve(__dirname, '../index.html')).mtimeMs);
  if (changedAt > builtAt) throw new Error('dist/ está desactualizado respecto a src/: ejecuta "npm run build" antes del smoke.');
  if (!fs.existsSync(browser)) throw new Error('Configura SMOKE_BROWSER con una instalación de Edge/Chromium.');
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-unsaved-');
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' });
  const cleanup = require('./smoke-cleanup.cjs')(child,profile,server);
  let version; for (let i = 0; i < 100 && !version; i++) { await sleep(100); try { version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); } catch { /* arrancando */ } }
  const bc = connect(version.webSocketDebuggerUrl); await bc.ready;
  const jsErrors = [], blocked = []; const pages = []; let fails = 0;
  const ck = (cond, name, detail = '') => { console.log((cond ? '  OK  ' : ' FALLA ') + name + (cond ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); if (!cond) fails++; };

  async function open(width = 1280, height = 900) {
    const { targetId } = await bc.send('Target.createTarget', { url: 'about:blank' });
    const target = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.id === targetId);
    const p = connect(target.webSocketDebuggerUrl); await p.ready; await p.send('Runtime.enable'); await p.send('Page.enable');
    p.socket.addEventListener('message', e => { const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') jsErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
      // Aislamiento: toda petición cuyo origen real no sea el servidor simulado se BLOQUEA antes de enviarse y se anota.
      if (m.method === 'Fetch.requestPaused') {
        const { requestId, request } = m.params; let allowed = false;
        try { const u = new URL(request.url); allowed = u.origin === origin || u.protocol === 'data:' || u.protocol === 'blob:'; } catch { allowed = false; }
        if (allowed) p.send('Fetch.continueRequest', { requestId }).catch(() => {});
        else { blocked.push({ method: request.method, url: request.url.slice(0, 100) }); p.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
      } });
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    p.wait = async (expression, what, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await p.evaluate('!!(' + expression + ')')) return true; } catch { /* navegando */ } await sleep(100); } let seen = ''; try { seen = await p.evaluate("location.pathname + location.search + ' :: ' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 140)"); } catch { /* sin página */ } throw new Error('Tiempo agotado esperando: ' + what + ' [' + seen + ']'); };
    p.go = async (route, ready = 'document.querySelector(".hp-body, .admin-auth")') => { await p.send('Page.navigate', { url: origin + route }); await sleep(300); if (!route.startsWith('/__')) await p.wait(ready, 'la página ' + route); };
    p.path = () => p.evaluate('location.pathname + location.search');
    p.clickText = (selector, text) => p.evaluate('(() => { const el = [...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(x => x.textContent.replace(/\\s+/g, " ").trim().includes(' + JSON.stringify(text) + ')); if (!el) throw new Error("sin elemento: " + ' + JSON.stringify(text) + '); el.click(); return 1 })()');
    p.type = (selector, index, value) => p.evaluate('(() => { const set = ' + SET + '; set(document.querySelectorAll(' + JSON.stringify(selector) + ')[' + index + '], ' + JSON.stringify(value) + '); return 1 })()');
    p.dialog = () => p.evaluate("(() => { const d = document.querySelector('dialog.hp-unsaved-dialog[open]'); return d ? { text: d.innerText.replace(/\\s+/g, ' '), focus: document.activeElement?.textContent.trim() } : null })()");
    p.close = async () => { try { p.socket.close(); await bc.send('Target.closeTarget', { targetId }); } catch { /* ya cerrada */ } };
    pages.push(p); return p;
  }
  const ctl = (key, value = '1') => fetch(origin + '/__s/' + key + '/' + value);
  const state = () => fetch(origin + '/__state').then(r => r.json());
  async function clean() { await ctl('clear'); for (const q of pages.splice(0)) await q.close(); const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.clear(); sessionStorage.clear(); 1'); await p.close(); pages.length = 0; }
  const withSession = async (token, route, width) => { const p = await open(width); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(token) + '); 1'); await p.go(route); return p; };
  const inbox = p => p.wait('document.querySelector(".hw-inbox-list button")', 'bandeja de consultas');
  const select = async (p, n) => { await p.evaluate('document.querySelectorAll(".hw-inbox-list button")[' + (n - 1) + '].click(); 1'); };
  const editor = (p, id) => p.wait('document.querySelector(".hw-inbox-detail form textarea")&&document.querySelector(".hw-inbox-detail h2")?.textContent.includes("Asunto ' + id + '")', 'editor de la consulta ' + id);
  const field = (p, i) => p.evaluate('document.querySelectorAll(".hw-inbox-detail form textarea")[' + i + ']?.value');
  const storageText = p => p.evaluate('JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)])');
  const noteSetup = async (id = 1) => { const p = await withSession(TOK.A1, '/admin/messages'); await inbox(p); await select(p, id); await editor(p, id); return p; };

  // ===== 0. Aislamiento de red =====
  console.log('\n== AISLAMIENTO');
  { const p = await open(); await p.go('/__empty');
    const probes = await p.evaluate("Promise.all([fetch('https://api.resend.com/emails', { method: 'POST', body: '{}' }).then(() => 'permitida', () => 'bloqueada'), fetch('http://localhost:3000/api/admin/messages').then(() => 'permitida', () => 'bloqueada'), fetch(location.origin + '/__empty').then(() => 'permitida', () => 'bloqueada')])");
    ck(probes[0] === 'bloqueada' && probes[1] === 'bloqueada' && probes[2] === 'permitida', 'un destino externo deliberado (Resend, API local en otro puerto) se bloquea antes de enviarse; el servidor simulado sí se permite', probes);
    ck(blocked.some(b => b.method === 'POST' && b.url.startsWith('https://api.resend.com/')) && blocked.some(b => b.url.startsWith('http://localhost:3000/')), 'el bloqueo queda anotado con método y destino');
    for (const mine of ['https://api.resend.com/emails', 'http://localhost:3000/api/admin/messages']) { const at = blocked.findIndex(b => b.url === mine); if (at >= 0) blocked.splice(at, 1); } // sondas deliberadas: no cuentan como fugas
    await p.close(); }

  // ===== 1. Mensajes y seguimiento =====
  console.log('\n== MENSAJES Y SEGUIMIENTO');
  await clean();
  { const p = await noteSetup(1);
    await p.clickText('.hp-nav-item', 'Cotizaciones'); await p.wait('location.search.includes("cotizaciones")', 'cambio de sección sin cambios'); await sleep(300);
    ck(!(await p.dialog()), 'navegar sin cambios no muestra ningún aviso', await p.path()); await p.close(); }
  await clean();
  { const p = await noteSetup(1);
    ck(!(await p.evaluate('(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })()')), 'sin cambios, recargar o cerrar la pestaña no avisa');
    ck(!(await p.dialog()), 'cargar el editor no lo marca como modificado');
    await p.type('.hw-inbox-detail form textarea', 0, MARK + ' nota'); await sleep(200);
    ck(await p.evaluate('(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })()'), 'con cambios, recargar o cerrar la pestaña muestra el aviso del navegador (beforeunload)');
    await select(p, 2); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al cambiar de consulta');
    let d = await p.dialog();
    ck(/Cambios sin guardar/.test(d.text) && /consulta #1/.test(d.text) && d.focus === 'Seguir editando', 'cambiar de consulta con notas pendientes avisa, nombra el formulario y enfoca «Seguir editando»', d);
    ck(!/NOTA-SENSIBLE/.test(d.text), 'el aviso no repite el contenido escrito');
    await p.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1");
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(300);
    ck((await p.path()).includes('id=1') === true || !(await p.path()).includes('id=2'), 'Seguir editando conserva la consulta abierta', await p.path());
    ck((await field(p, 0)) === MARK + ' nota', 'Seguir editando conserva el texto escrito intacto');
    ck(!(await p.dialog()), 'el aviso se cierra al seguir editando');
    await select(p, 2); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'segundo aviso');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] .hp-btn-danger").click(); 1'); await editor(p, 2);
    ck((await field(p, 0)) === '' && (await state()).writes.length === 0, 'Descartar cambios abre la otra consulta con su propio contenido y no escribe nada', await state());
    await p.close(); }
  await clean();
  { const p = await noteSetup(1);
    await p.type('.hw-inbox-detail form textarea', 1, MARK + ' respuesta'); await sleep(150);
    await p.clickText('.hw-inbox-detail .hp-btn', 'Iniciar atención'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso en acción rápida');
    ck((await state()).writes.length === 0, 'la acción rápida con respuesta sin guardar se detiene y avisa antes de escribir');
    await p.evaluate('[...document.querySelectorAll("dialog.hp-unsaved-dialog[open] button")].find(b => b.textContent.includes("Seguir")).click(); 1'); await sleep(250);
    ck((await field(p, 1)) === MARK + ' respuesta' && (await state()).writes.length === 0, 'Seguir editando mantiene la respuesta y no cambia el estado');
    await p.clickText('.hw-inbox-detail .hp-btn', 'Iniciar atención'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'segundo aviso');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] .hp-btn-danger").click(); 1');
    await p.wait('document.body.innerText.includes("en proceso")', 'estado actualizado'); await sleep(500);
    const s = await state();
    ck(s.writes.length === 1 && s.writes[0].data.estado === 'en_proceso' && s.writes[0].data.respuesta === '', 'confirmar descarte aplica solo el estado (con lo último guardado en el servidor)', s.writes);
    await p.type('.hw-inbox-detail form textarea', 0, 'nota posterior'); await p.clickText('.hw-inbox-detail .hp-btn', 'Guardar seguimiento'); await p.wait('document.body.innerText.includes("Seguimiento guardado")', 'guardado tras acción rápida');
    ck((await state()).writes.length === 2, 'tras el cambio de estado el editor se recarga con la revisión al día: guardar ya no choca (sin error 409)'); await p.close(); }
  await clean();
  { const p = await noteSetup(1);
    await p.type('.hw-inbox-detail form textarea', 0, MARK); await ctl('writeMode', 'fail'); await p.clickText('.hw-inbox-detail .hp-btn', 'Guardar seguimiento'); await p.wait('document.querySelector(".hw-inbox-detail [role=alert]")', 'error de guardado'); await sleep(200);
    ck((await field(p, 0)) === MARK, 'guardado fallido: el texto se conserva');
    await select(p, 2); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'sigue habiendo cambios tras un guardado fallido');
    ck(true, 'un guardado fallido no se considera exitoso: sigue avisando');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await ctl('writeMode', 'ok');
    // D6.3: un 5xx del editor completo es un resultado INCIERTO. Para guardar de nuevo hay que comprobar el servidor y permitirlo de forma explícita.
    await p.clickText('.hw-inbox-detail .hp-btn', 'Comprobar estado del servidor'); await p.wait('document.querySelector(".hw-inbox-detail [data-save-uncertain=unchanged]")', 'servidor sin cambios'); await p.clickText('.hw-inbox-detail .hp-btn', 'Permitir un nuevo guardado');
    await p.clickText('.hw-inbox-detail .hp-btn', 'Guardar seguimiento'); await p.wait('document.body.innerText.includes("Seguimiento guardado")', 'guardado correcto'); await sleep(900);
    await p.wait('document.querySelector(".hw-inbox-list button")', 'bandeja'); await select(p, 2); await editor(p, 2); await sleep(300);
    ck(!(await p.dialog()), 'tras guardar bien ya no hay cambios pendientes: navegar no avisa'); await p.close(); }
  await clean();
  { const p = await noteSetup(1);
    await p.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150);
    await p.type('input[aria-label="Buscar consultas"]', 0, 'Persona 2'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al buscar');
    ck((await p.evaluate('document.querySelector("input[aria-label=\\"Buscar consultas\\"]").value')) === '', 'buscar con cambios pendientes avisa y no aplica la búsqueda hasta confirmar');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(200);
    await p.clickText('.hp-heading .hp-btn', 'Actualizar'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al actualizar');
    ck(true, 'Actualizar la bandeja con cambios pendientes avisa'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(200);
    await p.type('select[aria-label="Origen de consulta"]', 0, 'chatbot'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al filtrar');
    ck(true, 'cambiar el filtro con cambios pendientes avisa'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(200);
    await p.clickText('.hw-inbox-detail .hp-btn', 'Recargar seguimiento'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al recargar seguimiento');
    ck((await field(p, 0)) === MARK, '«Recargar seguimiento» no borra el texto sin confirmar'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1');
    ck(!/NOTA-SENSIBLE/.test(await storageText(p)), 'el texto escrito no se guarda en localStorage ni sessionStorage'); await p.close(); }
  await clean();
  { const p = await withSession(TOK.A1, '/admin/dashboard'); await p.clickText('.hp-nav-item', 'Mensajes'); await inbox(p); await select(p, 1); await editor(p, 1);
    await p.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150);
    await p.evaluate('history.back(); 1'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al pulsar Atrás');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(400);
    ck((await p.path()).includes('/admin/messages') && (await field(p, 0)) === MARK, 'el botón Atrás del navegador también avisa y, al seguir editando, no pierde nada', await p.path());
    await p.evaluate('history.back(); 1'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'segundo aviso'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] .hp-btn-danger").click(); 1');
    await p.wait('!location.pathname.includes("messages") || !location.search.includes("id=1")', 'salida confirmada'); ck(true, 'descartar permite salir con Atrás (la navegación nunca queda bloqueada)'); await p.close(); }

  // ===== 2. Otros formularios =====
  console.log('\n== OTROS FORMULARIOS');
  await clean();
  { const p = await withSession(TOK.A1, '/admin/dashboard?section=cotizaciones');
    await p.wait('document.querySelector(".hp-heading .hp-btn-primary")', 'cotizaciones'); await p.clickText('.hp-heading .hp-btn', 'Nueva cotización'); await p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'formulario');
    await p.clickText('dialog.hp-dialog[open] .hp-btn', 'Cancelar'); await sleep(300);
    ck(!(await p.evaluate('!!document.querySelector("dialog.hp-dialog[open]")')), 'cotización sin cambios: Cancelar cierra sin avisar');
    await p.clickText('.hp-heading .hp-btn', 'Nueva cotización'); await p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'formulario');
    await p.type('dialog.hp-dialog[open] input', 0, 'Cliente ' + MARK); await sleep(150);
    await p.clickText('dialog.hp-dialog[open] .hp-btn', 'Cancelar'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al cancelar');
    ck(true, 'cotización con cambios: Cancelar avisa'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(300);
    ck((await p.evaluate('document.querySelector("dialog.hp-dialog[open] input").value')).includes('Cliente'), 'Seguir editando conserva el formulario de la cotización');
    await p.evaluate("document.querySelector('dialog.hp-dialog[open]').dispatchEvent(new Event('cancel', { cancelable: true })); 1"); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al pulsar Escape');
    ck(true, 'Escape sobre el formulario también avisa'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] .hp-btn-danger").click(); 1'); await sleep(400);
    ck(!(await p.evaluate('!!document.querySelector("dialog.hp-dialog[open]")')), 'Descartar cierra el formulario de la cotización');
    // Guardado correcto y fallido
    await p.clickText('.hp-heading .hp-btn', 'Nueva cotización'); await p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'formulario');
    const fill = () => p.evaluate("(() => { const set = " + SET + "; const f = document.querySelector('dialog.hp-dialog[open] form'); const inputs = [...f.querySelectorAll('input[required]')]; set(f.querySelector('input'), 'Cliente de prueba'); const em = [...f.querySelectorAll('input')].find(x => x.maxLength === 160 && x !== f.querySelector('input')); if (em) set(em, 'Emisor de prueba'); inputs.filter(x => x.type === 'text' && !x.value).forEach(x => set(x, 'Texto de prueba')); return 1 })()");
    await fill(); await ctl('writeMode', 'fail'); await p.evaluate("document.querySelector('dialog.hp-dialog[open] form').requestSubmit(); 1"); await p.wait('document.querySelector("dialog.hp-dialog[open] [role=alert]")', 'error de guardado de cotización');
    ck(await p.evaluate('!!document.querySelector("dialog.hp-dialog[open] form")'), 'guardado fallido de la cotización: el formulario sigue abierto con sus datos');
    await p.clickText('dialog.hp-dialog[open] .hp-btn', 'Cancelar'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'sigue avisando tras fallo');
    ck(true, 'tras un guardado fallido la cotización sigue contando como no guardada'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await ctl('writeMode', 'ok'); await sleep(200);
    // D7: un 500 al CREAR es un resultado incierto (el servidor pudo guardar): el reintento exige confirmar de forma explícita.
    await p.evaluate("document.querySelector('dialog.hp-dialog[open] form').requestSubmit(); 1"); await p.wait('document.querySelector("dialog.hp-dialog[open] [data-quote-uncertain=confirming]")', 'confirmación tras el resultado incierto'); await p.clickText('dialog.hp-dialog[open] .hp-btn', 'Guardar de todos modos'); await sleep(900);
    ck(!(await p.evaluate('!!document.querySelector("dialog.hp-dialog[open]")')) && !(await p.dialog()), 'guardado correcto: el formulario se cierra sin pedir confirmación', await state()); await p.close(); }
  await clean();
  // Información de empresa, el editor de cursos y el de convenios se retiraron del panel (separación del contenido institucional).
  // La protección se comprueba ahora en «Mi cuenta»; los editores académicos (Cancelar → aviso → Seguir editando/Descartar) la cubren
  // en smoke-estudiantes, smoke-ediciones y smoke-matriculas.
  { const PWD = '.hp-password-card input';
    const p = await withSession(TOK.A1, '/admin/dashboard?section=configuracion');
    await p.wait('document.querySelector("' + PWD + '")', 'Mi cuenta'); await p.clickText('.hp-nav-item', 'Mensajes'); await sleep(500);
    ck(!(await p.dialog()) && (await p.path()).includes('/admin/messages'), 'Mi cuenta sin cambios: navegar no avisa', await p.path());
    await p.evaluate('history.back(); 1'); await p.wait('document.querySelector("' + PWD + '")', 'volver a Mi cuenta');
    await p.type(PWD, 0, 'Clave-ficticia-1'); await p.clickText('.hp-nav-item', 'Mensajes'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso en Mi cuenta');
    ck(/cambio de contraseña/.test((await p.dialog()).text), 'Mi cuenta con una contraseña escrita: el menú avisa'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(200);
    ck((await p.evaluate('document.querySelector("' + PWD + '").value')) === 'Clave-ficticia-1' && (await p.path()).includes('section=configuracion'), 'Seguir editando conserva lo escrito y la sección');
    await p.clickText('.hp-nav-item', 'Mensajes'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso de nuevo');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] .hp-btn-danger").click(); 1'); await p.wait('location.pathname === "/admin/messages"', 'descartar y navegar');
    ck(!/Clave-ficticia/.test(await storageText(p)) && (await state()).writes.length === 0, 'Descartar navega sin guardar la contraseña en el almacenamiento ni enviar nada', await state()); await p.close(); }

  // ===== 3. Sesión =====
  console.log('\n== SESIÓN CADUCADA, MISMA CUENTA Y OTRA CUENTA');
  await clean();
  { const p = await noteSetup(1); await p.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150);
    await p.evaluate('window.dispatchEvent(new CustomEvent("horus:session-expired", { detail: { token: localStorage.getItem(' + JSON.stringify(KEY) + ') } })); 1');
    await p.wait('location.pathname === "/admin/login"', 'cierre forzoso');
    ck(!(await p.dialog()), 'la sesión invalidada por el servidor cierra sin que el aviso de cambios la retenga');
    const notice = await p.evaluate('document.querySelector(".admin-auth__notice")?.innerText || ""');
    ck(/Tu sesión terminó/.test(notice) && /no se conservaron/.test(notice), 'el login explica que los cambios sin guardar no se conservaron', notice);
    const stored = await storageText(p); ck(!/NOTA-SENSIBLE/.test(stored) && (await p.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')')) === null, 'ni el borrador ni el token quedan en el almacenamiento tras expirar');
    await p.evaluate("(() => { const set = " + SET + "; set(document.querySelector('#email'), 'ana@example.test'); set(document.querySelector('#password'), 'x'); return 1 })()"); await p.close(); }
  await clean();
  { const p = await open(); await p.go('/__empty'); await p.go('/admin/messages?estado=nuevo&id=2&contacto=7&token=zzz', 'document.querySelector(".admin-auth")');
    ck((await p.path()) === '/admin/login', 'sin sesión, abrir el panel redirige al login', await p.path());
    // Inicia sesión simulando el resultado de login (la API simulada rechaza /admin/login): se guarda un token y la ruta guardada debe seguir siendo segura.
    const target = await p.evaluate('JSON.stringify(history.state?.usr ?? null)');
    ck(/"from":"\/admin\/messages\?estado=nuevo&id=2"/.test(target) && !/zzz|contacto/.test(target), 'solo se conserva la ruta interna y sus parámetros de navegación (sin tokens ni datos)', target);
    await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOK.A1) + '); 1'); await p.go('/admin/login', 'document.querySelector(".admin-auth, .hp-body")');
    await p.close(); }
  await clean();
  { const p = await open(); await p.go('/__empty');
    await p.evaluate("history.replaceState({ usr: { from: '//evil.test/admin/dashboard', expired: true }, key: 'k1', idx: 0 }, '', '/admin/login'); 1");
    await p.send('Page.reload'); await p.wait('document.querySelector(".admin-auth")', 'login con ruta maliciosa');
    await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOK.A1) + '); 1'); await p.send('Page.reload');
    await p.wait('location.pathname.startsWith("/admin/") && location.pathname !== "/admin/login"', 'entra al panel'); await sleep(300);
    ck((await p.evaluate('location.origin')) === origin && (await p.path()).startsWith('/admin/dashboard'), 'una ruta externa guardada (//evil.test) nunca se sigue: se usa /admin/dashboard', await p.path()); await p.close(); }
  await clean();
  { const p = await noteSetup(1); await p.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(100);
    await p.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Cerrar sesión')).click(); 1"); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso al cerrar sesión');
    ck(true, 'cerrar sesión a propósito con cambios pendientes avisa'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] .hp-btn-danger").click(); 1');
    await p.wait('location.pathname === "/admin/login"', 'login tras cerrar sesión'); await sleep(300);
    ck(!(await p.evaluate('!!document.querySelector(".admin-auth__notice")')) && !/"from":"/.test(await p.evaluate('JSON.stringify(history.state?.usr ?? null)')), 'un cierre voluntario no conserva ruta ni muestra el aviso de sesión terminada', await p.evaluate('JSON.stringify(history.state?.usr ?? null)')); await p.close(); }
  // --- Token sustituto: el de otra pestaña solo vale tras validarlo con el backend (el contenido del JWT no es una prueba) ---
  const expireEvent = token => "window.dispatchEvent(new CustomEvent('horus:session-expired', { detail: { token: " + JSON.stringify(token) + " } })); 1";
  const setStored = (page, token) => page.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(token) + '); 1');
  const mark = page => page.evaluate('document.querySelector(".hw-inbox-detail form textarea").__keep = 1; 1');
  const probeEditor = page => page.evaluate('({ value: document.querySelector(".hw-inbox-detail form textarea")?.value ?? null, keep: document.querySelector(".hw-inbox-detail form textarea")?.__keep === 1, path: location.pathname })');
  await clean();
  { const a = await noteSetup(1); await mark(a); await a.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150);
    const b = await open(); await b.go('/__empty'); await setStored(b, TOK.A2); await sleep(1500);
    const mid = await probeEditor(a);
    ck(mid.value === MARK && mid.keep && (await state()).me.includes(TOK.A2), 'misma cuenta con un token nuevo en otra pestaña: se valida con el backend en segundo plano y el panel sigue montado, con lo escrito', mid);
    await ctl('expire', TOK.A1); await a.evaluate(expireEvent(TOK.A1)); await sleep(1500);
    const after = await probeEditor(a);
    ck(after.path === '/admin/messages' && after.value === MARK && after.keep, 'si el token actual falla con 401 se pasa en silencio al token ya validado: sin desmontar el panel ni perder lo escrito', after);
    await a.close(); await b.close(); }
  await clean();
  { const a = await noteSetup(1); await a.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150);
    await ctl('meMode', '503'); const b = await open(); await b.go('/__empty'); await setStored(b, TOK.A2); await sleep(1200);
    await ctl('expire', TOK.A1); await a.evaluate(expireEvent(TOK.A1));
    await a.wait('document.querySelector("main.hp-empty [role=alert]")', 'estado recuperable', 8000);
    const st = await a.evaluate('({ text: document.querySelector("main.hp-empty")?.innerText, panel: !!document.querySelector(".hp-body"), editor: !!document.querySelector(".hw-inbox-detail form") })');
    ck(/No pudimos validar tu sesión/.test(st.text) && !st.panel && !st.editor && (await state()).me.includes(TOK.A2), 'token A1 → 401 → token A2 con el mismo id declarado y /admin/me devuelve 503: el panel NO sigue autenticado con A2; queda un estado recuperable', st);
    await ctl('meMode', 'ok'); await a.clickText('main.hp-empty button', 'Reintentar'); await a.wait('document.querySelector(".hp-body")', 'panel tras reintentar');
    ck(true, 'Reintentar valida el token y vuelve a abrir el panel');
    await a.close(); await b.close(); }
  await clean();
  { const a = await noteSetup(1); await a.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150);
    const b = await open(); await b.go('/__empty'); await setStored(b, TOK.F);
    await a.wait('document.body.innerText.includes("Beto")', 'identidad confirmada por el backend');
    const t = await a.evaluate('document.body.innerText');
    ck(!t.includes('Ana') && !t.includes(MARK), 'un token que DECLARA el id 1 pero que el backend asocia a otra cuenta sustituye la identidad: el payload del JWT no se usa como prueba');
    await a.close(); await b.close(); }
  await clean();
  { const a = await noteSetup(1); await a.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150);
    const b = await open(); await b.go('/__empty'); await setStored(b, TOK.B);
    await a.wait('document.body.innerText.includes("Beto")', 'identidad de la otra cuenta'); await sleep(600);
    const swapped = await a.evaluate('({ text: document.body.innerText, note: document.querySelector(".hw-inbox-detail form textarea")?.value ?? null, dialog: !!document.querySelector("dialog.hp-unsaved-dialog[open]") })');
    ck(!swapped.text.includes('Ana') && !swapped.text.includes(MARK) && swapped.note !== MARK && !swapped.dialog, 'otra cuenta en otra pestaña: se limpia el editor, no queda ningún dato escrito por la cuenta anterior y no se pide confirmar', { note: swapped.note, dialog: swapped.dialog });
    await a.close(); await b.close(); }

  // ===== 3b. Correcciones tras la auditoría independiente =====
  console.log('\n== CORRECCIONES TRAS AUDITORÍA');
  await clean();
  { // P1: escribir mientras una acción rápida está pendiente no pierde lo escrito
    const p = await noteSetup(1); await ctl('putDelay', '1500'); await mark(p);
    await p.clickText('.hw-inbox-detail .hp-btn', 'Iniciar atención'); await sleep(300);
    ck(!(await p.dialog()), 'sin cambios pendientes la acción rápida se ejecuta sin aviso (comportamiento conservado)');
    await p.evaluate('document.querySelector(".hw-inbox-detail form textarea").focus(); 1'); await p.type('.hw-inbox-detail form textarea', 0, MARK + ' durante la espera'); await sleep(150);
    await p.wait('document.body.innerText.includes("en proceso")', 'el PUT terminó y el estado se actualizó', 8000); await sleep(1200);
    const st = await p.evaluate('({ value: document.querySelector(".hw-inbox-detail form textarea")?.value, keep: document.querySelector(".hw-inbox-detail form textarea")?.__keep === 1, focus: document.activeElement === document.querySelector(".hw-inbox-detail form textarea") })');
    ck(st.value === MARK + ' durante la espera', 'P1: las notas escritas mientras el PUT estaba pendiente siguen ahí cuando termina', st);
    ck(st.keep && st.focus, 'P1: el editor no se reconstruye y no pierde el foco');
    await ctl('putDelay', '0'); await select(p, 2); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'sigue contando como cambio');
    ck(true, 'P1: lo escrito durante la espera sigue protegido por el aviso'); await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(200);
    const before = (await state()).writes.length; await p.clickText('.hw-inbox-detail .hp-btn', 'Guardar seguimiento'); await p.wait('document.body.innerText.includes("Seguimiento guardado")', 'guardado', 6000);
    const w = (await state()).writes;
    ck(w.length === before + 1 && w.at(-1).data.notas === MARK + ' durante la espera' && w.at(-1).data.estado === 'en_proceso', 'P1: guardar después usa la revisión al día (sin 409) y envía las notas y el estado nuevo', w.at(-1)); await p.close(); }
  await clean();
  { // 409: un conflicto de revisión conserva notas y respuesta
    const p = await noteSetup(1); await p.type('.hw-inbox-detail form textarea', 0, MARK + ' notas'); await p.type('.hw-inbox-detail form textarea', 1, MARK + ' respuesta'); await sleep(150);
    await ctl('bump', '1'); await p.clickText('.hw-inbox-detail .hp-btn', 'Guardar seguimiento'); await p.wait('document.querySelector(".hw-inbox-detail .hp-conflict-banner.is-merged")', 'conflicto de revisión resuelto sin pisar nada');
    ck((await field(p, 0)) === MARK + ' notas' && (await field(p, 1)) === MARK + ' respuesta', 'un 409 preserva notas y respuesta');
    await select(p, 2); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'sigue protegido tras el 409'); ck(true, 'tras el 409 el borrador sigue protegido'); await p.close(); }
  await clean();
  { // Guardar con la sesión vencida: el cierre obligatorio no lo bloquea el aviso
    const p = await noteSetup(1); await p.type('.hw-inbox-detail form textarea', 0, MARK); await sleep(150); await ctl('expire', TOK.A1);
    await p.clickText('.hw-inbox-detail .hp-btn', 'Guardar seguimiento'); await p.wait('location.pathname === "/admin/login"', 'cierre por 401 al guardar', 6000);
    ck(!(await p.dialog()) && !/NOTA-SENSIBLE/.test(await storageText(p)), 'un 401 real al guardar cierra la sesión sin que el aviso lo bloquee y sin dejar el borrador en el almacenamiento'); await p.close(); }
  await clean();
  { // Misma URL: no hay nada que avisar
    const p = await withSession(TOK.A1, '/admin/dashboard?section=configuracion'); await p.wait('document.querySelector(".hp-password-card input")', 'Mi cuenta');
    await p.type('.hp-password-card input', 0, 'Clave-ficticia-1'); await sleep(150);
    await p.clickText('.hp-nav-item', 'Mi cuenta'); await sleep(400);
    ck(!(await p.dialog()) && (await p.evaluate('document.querySelector(".hp-password-card input").value')) === 'Clave-ficticia-1', 'ir exactamente a la misma URL (la sección en la que ya estás) no avisa ni toca lo escrito'); await p.close(); }
  const fillQuote = page => page.evaluate("(() => { const set = " + SET + "; const f = document.querySelector('dialog.hp-dialog[open] form'); [...f.querySelectorAll('input[required]')].filter(x => (x.type === 'text' || x.type === 'email') && !x.value).forEach(x => set(x, x.type === 'email' ? 'cliente@example.test' : 'Texto de prueba')); return 1 })()");
  await clean();
  { // P3: guardar una cotización abierta desde una URL con "contacto"
    const p = await withSession(TOK.A1, '/admin/dashboard?section=cotizaciones&contacto=2'); await p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'cotización precargada');
    ck((await p.evaluate('document.querySelector("dialog.hp-dialog[open] input").value')) === 'Persona 2', 'la cotización se precarga desde la consulta indicada en la URL');
    await fillQuote(p); await sleep(150); await p.evaluate("document.querySelector('dialog.hp-dialog[open] form').requestSubmit(); 1");
    await p.wait('!document.querySelector("dialog[open]")', 'el formulario se cierra'); await sleep(400);
    const url = await p.path(); const w = (await state()).writes;
    ck(!(await p.dialog()) && !url.includes('contacto') && w.some(x => x.route === 'cotizaciones' && x.method === 'POST'), 'P3: tras guardar desde una URL con «contacto», la URL se limpia sin mostrar «Descartar cambios»', { url, writes: w.length });
    await ctl('writeMode', 'fail'); await p.go('/admin/dashboard?section=cotizaciones&contacto=2'); await p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'segunda apertura');
    await fillQuote(p); await sleep(150); await p.evaluate("document.querySelector('dialog.hp-dialog[open] form').requestSubmit(); 1"); await p.wait('document.querySelector("dialog.hp-dialog[open] [role=alert]")', 'error de guardado');
    await p.clickText('dialog.hp-dialog[open] .hp-btn', 'Cancelar'); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'el borrador fallido sigue protegido');
    ck(true, 'P3: un guardado fallido conserva el borrador y su protección'); await p.close(); }
  await clean();
  { // P4: identificadores y nombres accesibles de diálogos superpuestos
    const press = (page, key, code, vk, text) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }));
    const p = await withSession(TOK.A1, '/admin/dashboard?section=cotizaciones'); await p.wait('document.querySelector(".hp-heading .hp-btn-primary")', 'cotizaciones');
    await p.clickText('.hp-heading .hp-btn', 'Nueva cotización'); await p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'formulario');
    await p.type('dialog.hp-dialog[open] input', 0, 'Cliente'); await sleep(150);
    await p.evaluate("[...document.querySelectorAll('dialog.hp-dialog[open] button')].find(b => b.textContent.trim() === 'Cancelar').focus(); 1"); await press(p, 'Enter', 'Enter', 13, '\r');
    await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso sobre el formulario');
    const info = await p.evaluate("[...document.querySelectorAll('dialog[open]')].map(d => { const id = d.getAttribute('aria-labelledby'); const el = id ? document.getElementById(id) : null; return { id, title: el ? el.textContent : null, unique: id ? document.querySelectorAll('[id=\"' + id + '\"]').length : 0, inside: el ? d.contains(el) : false }; })");
    ck(info.length === 2 && info[0].id !== info[1].id && info.every(i => i.unique === 1 && i.inside), 'P4: dos diálogos superpuestos tienen identificadores de título distintos y únicos', info);
    ck(info.map(i => i.title).join('|') === 'Nueva cotización|Cambios sin guardar', 'P4: cada diálogo se nombra con su propio título (aria-labelledby)', info.map(i => i.title));
    const trapped = []; for (let i = 0; i < 8; i++) { await press(p, 'Tab', 'Tab', 9); trapped.push(await p.evaluate("document.activeElement === document.body || !!document.activeElement?.closest('dialog.hp-unsaved-dialog[open]')")); }
    ck(trapped.every(Boolean), 'P4: con Tab el foco queda en el aviso superior (o sale del documento, como en cualquier diálogo modal) y nunca llega a los controles del formulario inferior', trapped);
    await press(p, 'Escape', 'Escape', 27); await sleep(400);
    const after = await p.evaluate("({ prompt: !!document.querySelector('dialog.hp-unsaved-dialog[open]'), editor: !!document.querySelector('dialog.hp-dialog[open] form'), focus: document.activeElement?.textContent.trim() })");
    ck(!after.prompt && after.editor && after.focus === 'Cancelar', 'P4: Escape cierra solo el aviso superior y el foco vuelve al botón que lo abrió', after); await p.close(); }

  // ===== 4. Responsive =====
  console.log('\n== RESPONSIVE (aviso abierto)');
  for (const width of [320, 375, 768, 1024, 1366, 1920]) {
    await clean(); const p = await withSession(TOK.A1, '/admin/messages', width); await inbox(p); await select(p, 1); await editor(p, 1);
    await p.type('.hw-inbox-detail form textarea', 0, 'texto'); await p.evaluate('document.querySelector(".hp-nav-item, .hp-menu-toggle")?.click(); 1');
    await p.evaluate('window.history.back(); 1'); await sleep(200);
    await p.evaluate('document.querySelector(".hw-inbox-list button:nth-of-type(2)")?.click(); 1');
    await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso a ' + width + ' px', 5000).catch(() => null);
    const m = await p.evaluate("(() => { const d = document.querySelector('dialog.hp-unsaved-dialog[open]'); if (!d) return null; const r = d.getBoundingClientRect(); const buttons = [...d.querySelectorAll('.hp-dialog-footer button')].map(b => b.getBoundingClientRect()); return { inside: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, buttons: buttons.every(b => b.left >= r.left - 1 && b.right <= r.right + 1 && b.width > 40), over: document.documentElement.scrollWidth > innerWidth } })()");
    ck(!!m && m.inside && m.buttons && !m.over, width + ' px: el aviso cabe en pantalla, sus botones son alcanzables y no hay desbordamiento', m); await p.close(); }

  const s = await state();
  // Únicos destinos externos tolerados: hojas de estilo, fuentes e iconos públicos que la propia página pide con GET. Se bloquean igualmente
  // (la prueba no depende de ellos); cualquier otro destino o cualquier método distinto de GET es una fuga y falla.
  const PUBLIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
  const leaks = blocked.filter(b => { try { return b.method !== 'GET' || !PUBLIC_ASSET_HOSTS.includes(new URL(b.url).hostname); } catch { return true; } });
  ck(leaks.length === 0, 'ninguna petición externa inesperada (' + blocked.length + ' recursos estáticos públicos de fuentes/iconos bloqueados antes de enviarse)', leaks.slice(0, 4));
  ck(jsErrors.length === 0, 'sin excepciones de JavaScript en toda la prueba', jsErrors.slice(0, 3));
  console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\nCambios sin guardar del panel: OK.');
  cleanup();
  void s; process.exit(fails ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
