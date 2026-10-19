// Autenticación administrativa con API simulada (nada real: ni credenciales, ni sesiones, ni correo). Edge por DevTools.
// Cubre: login/logout, sincronización entre pestañas, 401 de sesiones antiguas, /admin/me lento o desordenado,
// timeouts y cancelación, recuperación y cambio de contraseña (incluido el resultado incierto) y doble envío.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../dist'), browser = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';

// ---------- API simulada ----------
const users = { 'token-A': { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' }, 'token-B': { id: 2, nombre: 'Beto Administrador', email: 'beto@example.test' } };
const expired = new Set(); const meDelay = {}; let messagesDelay = 0;
const modes = { login: 'ok', forgot: 'ok', reset: 'ok', password: 'ok' };
const log = { me: [], login: 0, forgot: 0, reset: 0, password: 0, messages: [], closed: [] };
const zero = { total: 0, publicados: 0, borradores: 0, archivados: 0 };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'messagesDelay') messagesDelay = Number(value); else if (key === 'expire') expired.add(value); else if (key === 'meDelay') meDelay[value.split(':')[0]] = Number(value.split(':')[1]); else if (key === 'clear') { expired.clear(); for (const k of Object.keys(meDelay)) delete meDelay[k]; messagesDelay = 0; log.me.length = 0; log.messages.length = 0; log.closed.length = 0; Object.assign(log, { login: 0, forgot: 0, reset: 0, password: 0 }); Object.assign(modes, { login: 'ok', forgot: 'ok', reset: 'ok', password: 'ok' }); } else modes[key] = value; return json({ ok: true }); }
    if (route === '/__log') return json({ ...log, expired: [...expired] });
    if (route.startsWith('/api/')) {
      const closeLog = () => res.on('close', () => { if (!res.writableEnded) log.closed.push(route); });
      if (route === '/api/settings') return json({ ok: true, settings: {} });
      if (route === '/api/admin/me') {
        log.me.push(token); if (meDelay[token]) await sleep(meDelay[token]);
        if (expired.has(token) || !users[token]) return json({ message: 'Unauthorized SQL ER_SECRET', statusCode: 401 }, 401);
        return json({ ok: true, user: users[token] });
      }
      if (route === '/api/admin/login' && req.method === 'POST') {
        const input = await body(); log.login++; closeLog(); const mode = modes.login;
        if (mode === 'hang') return;
        if (mode === 'drop') return req.socket.destroy();
        if (mode === 'slow') await sleep(1200);
        if (['500', '429', '503'].includes(mode)) return json({ message: 'Internal server error ER_SECRET' }, Number(mode));
        const good = input.password === 'clave-correcta' && /^(ana|beto)@/.test(input.email || '');
        if (!good) return json({ ok: false, mensaje: 'Credenciales incorrectas. SQL ER_SECRET' }, 401);
        const t = input.email.startsWith('ana') ? 'token-A' : 'token-B';
        return json({ ok: true, token: t, user: users[t] });
      }
      if (route === '/api/admin/forgot-password' && req.method === 'POST') {
        await body(); log.forgot++; const mode = modes.forgot;
        if (mode === 'drop') return req.socket.destroy(); if (mode === 'slow') await sleep(1000);
        if (['500', '429'].includes(mode)) return json({ message: 'Internal server error ER_SECRET' }, Number(mode));
        return json({ ok: true, mensaje: 'Texto del servidor que no debe mostrarse' });
      }
      if (route === '/api/admin/reset-password' && req.method === 'POST') {
        await body(); log.reset++; closeLog(); const mode = modes.reset;
        if (mode === 'hang') return; if (mode === 'drop') return req.socket.destroy(); if (mode === 'slow') await sleep(1000);
        if (mode === 'invalid') return json({ message: 'Enlace inválido o vencido.' }, 400);
        if (mode === 'used') return json({ message: 'El enlace ya fue utilizado. Solicita otro.' }, 409);
        if (mode === '500') return json({ message: 'Internal server error ER_SECRET' }, 500);
        return json({ ok: true, mensaje: 'Contraseña actualizada. Inicia sesión nuevamente.' });
      }
      if (route === '/api/admin/password' && req.method === 'POST') {
        await body(); log.password++; const mode = modes.password;
        if (mode === 'drop') return req.socket.destroy(); if (mode === 'slow') await sleep(1000);
        if (mode === 'wrong') return json({ message: 'La contraseña actual no coincide.' }, 400);
        if (mode === '500') return json({ message: 'Internal server error ER_SECRET' }, 500);
        return json({ ok: true, mensaje: 'Contraseña actualizada.' });
      }
      if (route.startsWith('/api/admin/')) {
        if (route === '/api/admin/messages') { log.messages.push(token); if (messagesDelay) await sleep(messagesDelay); }
        if (expired.has(token) || !users[token]) return json({ message: 'Unauthorized' }, 401);
        if (route === '/api/admin/stats') return json({ ok: true, stats: { mensajes: { total: 0, nuevos: 0, enProceso: 0, atendidos: 0 }, reclamaciones: { total: 0 }, contenido: { total: 0 }, catalogo: { cursos: { ...zero, por_tipo: { curso: { ...zero }, capacitacion: { ...zero } } }, servicios: zero, 'preguntas-frecuentes': zero } }, actividadReciente: { mensajes: [], reclamaciones: [] } });
        return json({ ok: true, items: [], messages: [], users: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: { total: 0 } });
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
const SET = "(el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }";

async function main() {
  if (!fs.existsSync(browser)) throw new Error('Configura SMOKE_BROWSER con una instalación de Edge/Chromium.');
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-auth-');
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' });
  const cleanup = require('./smoke-cleanup.cjs')(child,profile,server);
  let version; for (let i = 0; i < 100 && !version; i++) { await sleep(100); try { version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); } catch { /* arrancando */ } }
  const bc = connect(version.webSocketDebuggerUrl); await bc.ready;
  const jsErrors = []; const pages = []; let fails = 0;
  const ck = (cond, name, detail = '') => { console.log((cond ? '  OK  ' : ' FALLA ') + name + (cond ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); if (!cond) fails++; };

  async function open(width = 1280, height = 800, init) {
    const { targetId } = await bc.send('Target.createTarget', { url: 'about:blank' });
    const target = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.id === targetId);
    const p = connect(target.webSocketDebuggerUrl); await p.ready; await p.send('Runtime.enable'); await p.send('Page.enable');
    p.socket.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') jsErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
      if (m.method === 'Fetch.requestPaused') {
        const {requestId,request}=m.params;
        let allowed=false;
        try { const u=new URL(request.url); allowed=u.origin===origin || u.protocol==='data:' || u.protocol==='blob:'; } catch { /* bloquear */ }
        p.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...(allowed?{}:{errorReason:'BlockedByClient'})}).catch(()=>{});
      }
    });
    await p.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    if (init) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
    p.wait = async (expression, what, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await p.evaluate('!!(' + expression + ')')) return true; } catch { /* navegando */ } await sleep(100); } let seen = ''; try { seen = await p.evaluate("location.pathname + ' :: ' + document.body.innerText.replace(/\s+/g, ' ').slice(0, 160)"); } catch { /* sin página */ } throw new Error('Tiempo agotado esperando: ' + what + ' [' + seen + ']'); };
    // Navega y espera a que la aplicación pinte (salvo en rutas auxiliares /__*, que no son la aplicación).
    p.go = async (route, ms = 300) => { await p.send('Page.navigate', { url: origin + route }); await sleep(ms); if (!route.startsWith('/__')) await p.wait("document.querySelector('.admin-auth, .hp-body')", 'la página ' + route); };
    p.fill = (selector, value) => p.evaluate('(() => { const set = ' + SET + '; set(document.querySelector(' + JSON.stringify(selector) + '), ' + JSON.stringify(value) + '); return 1 })()');
    p.path = () => p.evaluate('location.pathname');
    p.close = async () => { try { p.socket.close(); await bc.send('Target.closeTarget', { targetId }); } catch { /* ya cerrada */ } };
    pages.push(p); return p;
  }
  const ctl = (key, value) => fetch(origin + '/__s/' + key + '/' + value);
  const state = () => fetch(origin + '/__log').then(r => r.json());
  const storage = p => p.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')');
  // Parte de un estado limpio: sin sesión guardada ni contadores del servidor.
  async function clean() { await ctl('clear', '1'); const p = await open(); await p.go('/__empty', 100); await p.evaluate('localStorage.clear()'); await p.close(); for (const q of pages.splice(0)) await q.close(); }
  // Cuenta los POST que la propia página intenta (el navegador puede reintentar por su cuenta una conexión cortada: no es la aplicación).
  const instrument = p => p.evaluate("window.__posts = 0; const of = window.fetch; window.fetch = (u, o) => { if (o && o.method === 'POST') window.__posts++; return of(u, o) }; 1");
  const posts = p => p.evaluate('window.__posts');
  const signIn = async (p, who = 'ana') => { await p.go('/admin/login'); await p.fill('#email', who + '@example.test'); await p.fill('#password', 'clave-correcta'); await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await p.wait("location.pathname === '/admin/dashboard'", 'panel tras iniciar sesión'); };
  const TECH = /SQL|ER_SECRET|Internal server|Unauthorized|statusCode|Failed to fetch|undefined|\[object|Credenciales incorrectas/i;
  const alertOf = p => p.evaluate("(() => { const a = document.querySelector('[role=alert]'); return a ? { text: a.innerText.replace(/\\s+/g, ' ').trim(), focused: document.activeElement === a } : null })()");

  // ===== 1. Login =====
  const onlyOld401 = process.argv.includes('--old-401');
  if (!onlyOld401) {
  console.log('\n== LOGIN');
  await clean();
  { const p = await open(); await p.go('/admin/login'); const navCurrent = await p.evaluate("document.querySelector('.admin-auth__navigation a').getAttribute('aria-current')");
    ck(navCurrent === 'page', 'en el login el enlace «Iniciar sesión» marca aria-current', navCurrent);
    await p.fill('#email', 'ana@example.test'); await p.fill('#password', 'mala'); await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await p.wait("document.querySelector('[role=alert]')", 'error de login');
    let a = await alertOf(p); const attrs = await p.evaluate("({ invalid: document.querySelector('#email').getAttribute('aria-invalid'), invalidPass: document.querySelector('#password').getAttribute('aria-invalid'), described: document.querySelector('#email').getAttribute('aria-describedby'), enabled: !document.querySelector('#email').matches(':disabled'), main: document.querySelectorAll('main').length, h1: document.querySelectorAll('h1').length, toast: !!document.querySelector('[data-sonner-toast]') })");
    ck(a.text === 'Revisa tu correo y contraseña e inténtalo nuevamente.' && !TECH.test(a.text), 'credenciales incorrectas: mensaje genérico en español, sin texto del servidor', a);
    ck(a.focused && attrs.invalid === 'true' && attrs.invalidPass === 'true' && attrs.described === 'login-error' && attrs.enabled && attrs.main === 1 && attrs.h1 === 1 && !attrs.toast, 'el error recibe el foco, enlaza los campos (aria-invalid/describedby), no duplica toast y el formulario sigue usable', attrs);
    for (const [mode, expected] of [['500', 'El servidor no pudo completar la operación'], ['429', 'Demasiados intentos'], ['drop', 'No se pudo conectar con el servidor']]) {
      await ctl('login', mode); await p.fill('#password', 'otra-' + mode); await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await sleep(900); a = await alertOf(p);
      ck(a && a.text.startsWith(expected) && !TECH.test(a.text), 'login con ' + mode + ' → «' + (a ? a.text.slice(0, 45) : '') + '…»', a); }
    ck((await storage(p)) === null, 'ningún fallo deja una sesión guardada'); await p.close(); }

  await clean();
  { const p = await open(); await p.go('/admin/login'); await ctl('login', 'slow'); await p.fill('#email', 'ana@example.test'); await p.fill('#password', 'clave-correcta'); await instrument(p);
    await p.evaluate("(() => { const f = document.querySelector('.admin-auth__form'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); f.querySelector('button[type=submit]').click(); return 1 })()");
    await p.wait("location.pathname === '/admin/dashboard'", 'panel'); const s = await state();
    ck((await posts(p)) === 1 && s.login === 1, 'doble clic + Enter + requestSubmit repetidos = una sola petición de login', { page: await posts(p), server: s.login });
    ck((await storage(p)) === 'token-A', 'login correcto guarda la sesión y abre el panel'); await p.close(); }

  // ===== 2. Pestañas =====
  console.log('\n== SINCRONIZACIÓN ENTRE PESTAÑAS');
  await clean();
  { const a = await open(); await signIn(a, 'ana'); const b = await open(); await b.go('/admin/dashboard', 1200);
    ck((await b.path()) === '/admin/dashboard' && (await b.evaluate("document.body.innerText.includes('Ana')")), 'la segunda pestaña reutiliza la sesión y la revalida con /admin/me', (await state()).me);
    await b.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.includes('Cerrar sesión')).click(); 1");
    await a.wait("location.pathname === '/admin/login'", 'pestaña A deja de estar autenticada tras el logout en B');
    ck(true, 'logout en una pestaña → la otra vuelve al login'); await sleep(1000); ck((await a.path()) === '/admin/login' && (await b.path()) === '/admin/login', 'sin bucles de redirección tras el logout', [await a.path(), await b.path()]);
    const meBefore = (await state()).me.length;
    await b.fill('#email', 'ana@example.test'); await b.fill('#password', 'clave-correcta'); await b.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1");
    await a.wait("location.pathname === '/admin/dashboard'", 'pestaña A detecta el login de B'); await sleep(500);
    const after = await state();
    ck(after.me.length > meBefore && after.me[after.me.length - 1] === 'token-A', 'login en una pestaña → la otra lo detecta y revalida la identidad con /admin/me', after.me);
    await a.close(); await b.close(); }

  await clean();
  { const a = await open(); await signIn(a, 'ana'); const b = await open(); await b.go('/__empty', 100);
    await b.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'token-B'); 1");
    await a.wait("document.body.innerText.includes('Beto')", 'identidad de Beto'); await sleep(400);
    const text = await a.evaluate('document.body.innerText'); const log2 = await state();
    ck(!/Hola, Ana|Ana Administradora/.test(text) && log2.me.includes('token-B'), 'cambio de administrador → la otra pestaña no sigue con la identidad anterior y revalida el token nuevo', log2.me);
    await b.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'token-ajeno'); 1");
    await sleep(1800); // el token desconocido se valida con el backend; al ser rechazado no autentica nada y se restablece el último válido
    ck((await a.path()) === '/admin/dashboard' && (await storage(a)) === 'token-B' && (await a.evaluate("document.body.innerText.includes('Beto')")), 'un token de otra pestaña que el backend rechaza no sustituye la sesión validada: se restablece el último token válido');
    await a.close(); await b.close(); }

  }
  // ===== 3. 401 =====
  console.log('\n== 401 DE SESIONES ANTIGUAS Y ACTUALES');
  await clean();
  { const a = await open(); await signIn(a, 'ana'); await ctl('messagesDelay', '1500');
    await a.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Mensajes').click(); 1");
    for (let i = 0; i < 50 && !(await state()).messages.includes('token-A'); i++) await sleep(100); // la petición con el token A ya está en vuelo
    if (!(await state()).messages.includes('token-A')) throw new Error('El fixture no inició la petición antigua con A.');
    // Caduca DESPUÉS de iniciarse el GET: antes, /admin/me podía cerrar A durante la navegación y el caso nunca existía.
    await ctl('expire', 'token-A');
    const b = await open(); await b.go('/__empty', 100); await b.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'token-B'); 1");
    await a.wait("document.body.innerText.includes('Beto')", 'sesión B activa en la pestaña A'); await sleep(2800);
    const s = await state();
    ck(s.messages[0] === 'token-A', 'la petición antigua se hizo con el token A', s.messages);
    ck((await a.path()).startsWith('/admin/') && (await a.path()) !== '/admin/login' && (await storage(a)) === 'token-B' && (await a.evaluate("document.body.innerText.includes('Beto')")), 'token A inicia petición → entra la sesión B → la petición antigua devuelve 401 → la sesión B sigue válida', { path: await a.path(), token: await storage(a) });
    await a.close(); await b.close(); }

  await clean();
  if (!onlyOld401) {
  { const a = await open(); await signIn(a, 'beto'); await ctl('expire', 'token-B');
    await a.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Mensajes').click(); 1");
    await a.wait("location.pathname === '/admin/login'", 'cierre por 401 de la sesión vigente'); ck((await storage(a)) === null, '401 de la sesión actual sí cierra la sesión y limpia el almacenamiento'); await a.close(); }

  await clean();
  { const a = await open(); await a.go('/__empty', 100); await a.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'token-caducado'); 1");
    await a.go('/admin/dashboard', 1200); ck((await a.path()) === '/admin/login' && (await storage(a)) === null, 'token caducado al abrir el panel → login y almacenamiento limpio', [await a.path(), await storage(a)]); await a.close(); }

  await clean();
  { await ctl('meDelay', 'token-A:1500'); const a = await open(); await a.go('/__empty', 100); await a.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'token-A'); 1");
    await a.go('/admin/dashboard', 300); const b = await open(); await b.go('/__empty', 100); await b.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'token-B'); 1");
    await a.wait("document.body.innerText.includes('Beto')", 'identidad B'); await sleep(2200);
    const text = await a.evaluate('document.body.innerText');
    ck(/Beto/.test(text) && !/Ana Administradora|Hola, Ana/.test(text), '/admin/me lento de la sesión anterior no sobrescribe la identidad actual', text.slice(0, 80)); await a.close(); await b.close(); }

  // ===== 4. Timeouts y cancelación =====
  console.log('\n== CANCELACIÓN Y TIMEOUTS');
  await clean();
  { const p = await open(); await p.go('/admin/login'); await ctl('login', 'hang'); await p.fill('#email', 'ana@example.test'); await p.fill('#password', 'clave-correcta');
    await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await sleep(300);
    await p.evaluate("document.querySelector('.admin-auth__forgot a').click(); 1"); await sleep(1200); const s = await state();
    ck((await p.path()) === '/admin/forgot-password' && (await storage(p)) === null && s.closed.includes('/api/admin/login'), 'abandonar la pantalla cancela el login pendiente (el servidor ve la conexión cerrada) y no autentica', { path: await p.path(), closed: s.closed });
    await p.close(); }
  await clean();
  { const p = await open(); await p.go('/admin/login'); await ctl('login', 'slow'); await p.fill('#email', 'ana@example.test'); await p.fill('#password', 'clave-correcta');
    await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await sleep(200); await p.evaluate("document.querySelector('.admin-auth__forgot a').click(); 1"); await sleep(2000);
    ck((await p.path()) === '/admin/forgot-password' && (await storage(p)) === null, 'un login tardío no autentica después de salir de la pantalla', [await p.path(), await storage(p)]); await p.close(); }
  await clean();
  { const p = await open(); await p.go('/admin/login'); await ctl('login', 'hang'); await p.fill('#email', 'ana@example.test'); await p.fill('#password', 'clave-correcta'); await instrument(p);
    await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await sleep(19000);
    const early = await p.evaluate("document.querySelector('#email').matches(':disabled')"); await sleep(2500); const a = await alertOf(p);
    ck(early === true && a && a.text.startsWith('El servidor tardó demasiado') && (await p.evaluate("!document.querySelector('#email').matches(':disabled')")) && (await posts(p)) === 1, 'timeout de 20 s: espera, avisa en español, deja el formulario usable y no reintenta', { early, a, posts: await posts(p) });
    await ctl('login', 'ok'); await p.fill('#password', 'clave-correcta'); await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await p.wait("location.pathname === '/admin/dashboard'", 'login tras el timeout');
    ck(true, 'tras el timeout se puede iniciar sesión normalmente'); await p.close(); }

  // ===== 5. Recuperación =====
  console.log('\n== RECUPERACIÓN Y RESTABLECIMIENTO');
  await clean();
  { const p = await open(); await p.go('/admin/forgot-password');
    const nav = await p.evaluate("document.querySelector('.admin-auth__navigation a').getAttribute('aria-current')");
    ck(nav === null, 'en recuperación el enlace «Iniciar sesión» ya no marca aria-current="page"', nav);
    await p.fill('input[type=email]', 'persona@example.test'); await instrument(p);
    await ctl('forgot', 'slow'); await p.evaluate("(() => { const f = document.querySelector('.admin-auth__form'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); return 1 })()"); await p.wait("document.querySelector('[role=status]')", 'confirmación'); const s = await state();
    const view = await p.evaluate("(() => { const st = document.querySelector('[role=status]'); return { text: st.innerText, focused: document.activeElement === st, form: !!document.querySelector('form'), login: [...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/admin/login' && a.textContent.includes('inicio de sesión')) } })()");
    ck((await posts(p)) === 1 && s.forgot === 1, 'solicitud de enlace: doble envío = una petición', { page: await posts(p), server: s.forgot });
    ck(view.text.startsWith('Si el correo corresponde a una cuenta activa') && !view.text.includes('servidor que no debe') && view.focused && !view.form && view.login, 'respuesta genérica fija (no revela si existe la cuenta), con foco y enlace al login', view); await p.close(); }
  for (const [mode, expected] of [['500', 'El servidor no pudo completar'], ['429', 'Demasiados intentos'], ['drop', 'No pudimos confirmar si la solicitud se registró']]) {
    await clean(); const p = await open(); await p.go('/admin/forgot-password'); await ctl('forgot', mode); await p.fill('input[type=email]', 'persona@example.test'); await instrument(p);
    await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await sleep(1200); const a = await alertOf(p); const usable = await p.evaluate("!!document.querySelector('input[type=email]') && !document.querySelector('input[type=email]').matches(':disabled')");
    ck(a && a.text.startsWith(expected) && !TECH.test(a.text) && usable && (await posts(p)) === 1, 'recuperación con ' + mode + ' → «' + (a ? a.text.slice(0, 45) : '') + '…», formulario usable, sin reintento automático', { a, posts: await posts(p) }); await p.close(); }
  await clean();
  { const p = await open(); await p.go('/admin/reset-password'); const v = await p.evaluate("({ alert: document.querySelector('[role=alert]')?.innerText, link: document.querySelector('a.admin-auth__submit')?.getAttribute('href'), inputs: document.querySelectorAll('input').length })");
    ck(/Falta el enlace/.test(v.alert) && v.link === '/admin/forgot-password' && v.inputs === 0, 'restablecer sin token: aviso claro, sin formulario y con enlace para pedir uno nuevo', v); await p.close(); }
  { await clean(); const p = await open(); await p.go('/admin/reset-password?token=falso'); await ctl('reset', 'invalid'); await p.fill('input[autocomplete=new-password]', 'Nueva-clave-123');
    await p.evaluate("(() => { const set = " + SET + "; const i = document.querySelectorAll('input[type=password]'); set(i[0], 'Nueva-clave-123'); set(i[1], 'Nueva-clave-123'); document.querySelector('form').requestSubmit(); return 1 })()"); await p.wait("document.querySelector('[role=alert]')", 'enlace inválido');
    const v = await p.evaluate("({ alert: document.querySelector('[role=alert]').innerText, inputs: document.querySelectorAll('input').length, link: document.querySelector('a.admin-auth__submit')?.getAttribute('href') })");
    ck(v.alert.includes('no es válido o ya venció') && !TECH.test(v.alert) && v.inputs === 0 && v.link === '/admin/forgot-password', 'token de recuperación inválido: mensaje claro, formulario retirado y enlace a solicitar otro', v); await p.close(); }
  { await clean(); const p = await open(); await p.go('/admin/reset-password?token=valido'); await instrument(p);
    await p.evaluate("(() => { const set = " + SET + "; const i = document.querySelectorAll('input[type=password]'); set(i[0], 'Nueva-clave-123'); set(i[1], 'Otra-distinta-1'); document.querySelector('form').requestSubmit(); return 1 })()"); await sleep(400);
    const v = await p.evaluate("({ alert: document.querySelector('[role=alert]')?.innerText, invalid: document.querySelectorAll('input')[1].getAttribute('aria-invalid'), focus: document.activeElement === document.querySelectorAll('input')[1] })");
    ck(v.alert === 'Las contraseñas no coinciden.' && v.invalid === 'true' && v.focus && (await posts(p)) === 0, 'contraseñas distintas: aria-invalid, foco en la confirmación y ninguna petición', v);
    await ctl('reset', 'slow'); await p.evaluate("(() => { const set = " + SET + "; const i = document.querySelectorAll('input[type=password]'); set(i[1], 'Nueva-clave-123'); const f = document.querySelector('form'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); return 1 })()");
    await p.wait("document.querySelector('[role=status]')", 'restablecimiento'); const s = await state();
    const done = await p.evaluate("({ text: document.querySelector('[role=status]').innerText, focused: document.activeElement === document.querySelector('[role=status]'), inputs: document.querySelectorAll('input').length, link: document.querySelector('a.admin-auth__submit')?.getAttribute('href') })");
    ck(s.reset === 1 && (await posts(p)) === 1, 'restablecimiento: doble envío = una sola petición', { server: s.reset, page: await posts(p) });
    ck(done.text.startsWith('Tu contraseña fue actualizada') && done.focused && done.inputs === 0 && done.link === '/admin/login', 'restablecimiento correcto: no queda un formulario con el token consumido y hay un enlace claro al login', done); await p.close(); }
  { await clean(); const p = await open(); await p.go('/admin/reset-password?token=valido'); await ctl('reset', 'drop'); await instrument(p);
    await p.evaluate("(() => { const set = " + SET + "; const i = document.querySelectorAll('input[type=password]'); set(i[0], 'Nueva-clave-123'); set(i[1], 'Nueva-clave-123'); document.querySelector('form').requestSubmit(); return 1 })()"); await sleep(1500);
    const a = await alertOf(p); const form = await p.evaluate("document.querySelectorAll('input[type=password]').length");
    ck(a && a.text.startsWith('No pudimos confirmar si tu contraseña se actualizó') && !/no se (cambió|actualizó)\.|sigue igual/i.test(a.text) && form === 2 && (await posts(p)) === 1, 'restablecimiento con resultado incierto: recomienda verificar, no afirma que no cambió y no reintenta', { a, posts: await posts(p) }); await p.close(); }
  { await clean(); const p = await open(); await p.go('/admin/reset-password?token=valido'); await ctl('reset', 'hang'); await instrument(p);
    await p.evaluate("(() => { const set = " + SET + "; const i = document.querySelectorAll('input[type=password]'); set(i[0], 'Nueva-clave-123'); set(i[1], 'Nueva-clave-123'); document.querySelector('form').requestSubmit(); return 1 })()"); await sleep(19000);
    const early = await p.evaluate("document.querySelector('form').getAttribute('aria-busy')"); await sleep(2500); const a = await alertOf(p);
    ck(early === 'true' && a && a.text.startsWith('No pudimos confirmar si tu contraseña se actualizó') && (await posts(p)) === 1, 'timeout al restablecer: resultado incierto, sin reintento automático', { early, a }); await p.close(); }

  // ===== 6. Cambio de contraseña =====
  console.log('\n== CAMBIO DE CONTRASEÑA');
  await clean();
  { const p = await open(); await signIn(p, 'ana'); await p.go('/admin/dashboard?section=configuracion', 1200); await instrument(p);
    const fillPw = (a, b, c) => p.evaluate("(() => { const set = " + SET + "; const i = document.querySelectorAll('.hp-password-card input'); set(i[0], " + JSON.stringify(a) + "); set(i[1], " + JSON.stringify(b) + "); set(i[2], " + JSON.stringify(c) + "); return 1 })()");
    const submitPw = () => p.evaluate("document.querySelector('.hp-password-card form').requestSubmit(); 1");
    await fillPw('clave-actual', 'Nueva-clave-123', 'Distinta-1234'); await submitPw(); await sleep(300);
    let v = await p.evaluate("({ alert: document.querySelector('.hp-password-card [role=alert]')?.innerText, invalid: document.querySelectorAll('.hp-password-card input')[2].getAttribute('aria-invalid'), focus: document.activeElement === document.querySelectorAll('.hp-password-card input')[2] })");
    ck(v.alert === 'Las contraseñas no coinciden.' && v.invalid === 'true' && v.focus && (await posts(p)) === 0, 'cambio con confirmación distinta: aria-invalid, foco y ninguna petición', v);
    await ctl('password', 'wrong'); await fillPw('mala', 'Nueva-clave-123', 'Nueva-clave-123'); await submitPw(); await sleep(900);
    let a = await alertOf(p); ck(a && a.text === 'La contraseña actual no es correcta.' && a.focused, 'contraseña actual incorrecta: mensaje claro, con foco', a);
    await ctl('password', 'drop'); await submitPw(); await sleep(1500); a = await alertOf(p);
    ck(a && a.text.startsWith('No pudimos confirmar si tu contraseña se actualizó') && (await p.path()) === '/admin/dashboard' && (await storage(p)) === 'token-A', 'cambio con resultado incierto: advierte, no cierra la sesión por su cuenta ni afirma que no cambió', a);
    ck((await posts(p)) === 2, 'solo hubo un intento por cada envío manual (sin reintentos automáticos)', await posts(p));
    await ctl('password', 'slow'); const before = (await state()).password; await p.evaluate("(() => { const f = document.querySelector('.hp-password-card form'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); return 1 })()"); await p.wait("location.pathname === '/admin/login'", 'logout tras el cambio'); const after = (await state()).password;
    ck(after - before === 1, 'cambio de contraseña: doble envío = una sola petición y se cierra la sesión', after - before); await p.close(); }

  // Contrato del aviso de 401: lleva el token de la petición y solo cierra la sesión si sigue siendo la activa.
  await clean();
  { const a = await open(); await signIn(a, 'ana'); const b = await open(); await b.go('/__empty', 100); await b.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'token-B'); 1");
    await a.wait("document.body.innerText.includes('Beto')", 'sesión B activa en la pestaña A'); const emit = detail => a.evaluate("window.dispatchEvent(new CustomEvent('horus:session-expired', { detail: " + JSON.stringify(detail) + ' })); 1');
    const alive = async () => (await a.path()) === '/admin/dashboard' && (await storage(a)) === 'token-B' && (await a.evaluate("document.body.innerText.includes('Beto')"));
    await emit({ token: 'token-A' }); await sleep(600); ck(await alive(), '401 de una petición hecha con el token A mientras la sesión activa es B: se ignora');
    await emit({ token: null }); await sleep(600); ck(await alive(), '401 de una petición sin sesión: se ignora');
    const meBefore = (await state()).me.length; await a.evaluate("window.dispatchEvent(new Event('horus:session-expired')); 1"); await sleep(900);
    ck(await alive() && (await state()).me.length > meBefore, 'aviso sin sesión de origen: no cierra a ciegas, revalida la identidad con /admin/me');
    await ctl('expire', 'token-B'); await emit({ token: 'token-B' }); await a.wait("location.pathname === '/admin/login'", 'cierre por 401 de la sesión vigente'); ck((await storage(a)) === null, '401 de la sesión vigente (token B): sí cierra la sesión');
    await a.close(); await b.close(); }

  // ===== 7. Modo en memoria =====
  console.log('\n== localStorage NO DISPONIBLE (modo en memoria)');
  await clean();
  { const p = await open(1280, 800, "Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado') } })"); await p.go('/admin/login'); await p.fill('#email', 'ana@example.test'); await p.fill('#password', 'clave-correcta');
    await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await p.wait("location.pathname === '/admin/dashboard'", 'panel en memoria');
    ck(await p.evaluate("document.body.innerText.includes('Ana')"), 'sin localStorage el login funciona en memoria (sin sincronización entre pestañas)'); await p.close(); }

  // ===== 8. Responsive =====
  console.log('\n== RESPONSIVE');
  for (const width of [320, 375, 768, 1024, 1366, 1920]) {
    const bad = []; await clean();
    { const p = await open(width, 800); await p.go('/admin/login'); await p.fill('#email', 'ana@example.test'); await p.fill('#password', 'mala'); await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1"); await sleep(900);
      const m = await p.evaluate("({ over: document.documentElement.scrollWidth > innerWidth, alert: !!document.querySelector('[role=alert]'), inside: (r => r.left >= 0 && r.right <= innerWidth + 1)(document.querySelector('[role=alert]').getBoundingClientRect()) })"); if (m.over || !m.alert || !m.inside) bad.push('login ' + JSON.stringify(m)); await p.close(); }
    { const p = await open(width, 800); await p.go('/admin/reset-password?token=valido'); await ctl('reset', 'invalid'); await p.evaluate("(() => { const set = " + SET + "; const i = document.querySelectorAll('input[type=password]'); set(i[0], 'Nueva-clave-123'); set(i[1], 'Otra-distinta-1'); document.querySelector('form').requestSubmit(); return 1 })()"); await sleep(300);
      const m1 = await p.evaluate("({ over: document.documentElement.scrollWidth > innerWidth, alert: !!document.querySelector('[role=alert]') })"); if (m1.over || !m1.alert) bad.push('reset (no coinciden) ' + JSON.stringify(m1));
      await p.evaluate("(() => { const set = " + SET + "; const i = document.querySelectorAll('input[type=password]'); set(i[1], 'Nueva-clave-123'); document.querySelector('form').requestSubmit(); return 1 })()"); await sleep(900);
      const m2 = await p.evaluate("({ over: document.documentElement.scrollWidth > innerWidth, link: (el => el && el.getBoundingClientRect().right <= innerWidth + 1)(document.querySelector('a.admin-auth__submit')) })"); if (m2.over || !m2.link) bad.push('reset (enlace inválido) ' + JSON.stringify(m2)); await p.close(); }
    ck(bad.length === 0, width + ' px: login, restablecimiento y mensajes sin desbordamiento', bad); }

  }
  ck(jsErrors.length === 0, 'sin excepciones de JavaScript en toda la prueba', jsErrors.slice(0, 3));
  console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\nAutenticación administrativa: OK.');
  cleanup();
  process.exit(fails ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
