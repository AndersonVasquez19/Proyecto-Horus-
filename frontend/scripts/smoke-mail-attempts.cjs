// Fiabilidad de correos (D5) con API simulada: no se contacta a Resend, Gmail ni a ningún servicio real. Edge por DevTools.
// El servidor de pruebas imita el registro de intentos del backend (aceptado/fallido/incierto/bloqueado) y puede cortar el socket tras "aceptar".
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../dist');
const edge = process.env.SMOKE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'horus-admin-token';
const TOKEN = 'e30.' + Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') + '.d5';

// ---------- API simulada ----------
const sim = { mode: 'accepted', delay: 0, qmode: 'accepted' };
let posts = [], attention, message, qhist = [], qrev = 1;
const quoteBase = { id: 1, numero: 'COT-PRUEBA', cliente: 'Cliente de prueba', email: 'cliente@example.test', telefono: '', documento: '', direccion: '', emisor: 'Emisor de prueba', datos_emisor: '', moneda: 'PEN', validez: '2099-12-31', condiciones: 'Condiciones de prueba', conceptos: [{ descripcion: 'Servicio', cantidad: 1, precio: 100, importe: 100 }], subtotal: '100.00', descuento: 0, tasa: 18, impuesto: '18.00', total: '118.00', estado: 'borrador' };
const quoteView = () => ({ ...quoteBase, revision: qrev, historial: [{ accion: 'Creada como borrador', usuario: 1, fecha: '2026-01-01T00:00:00Z' }, ...qhist] });
const qlast = () => qhist.length ? qhist[qhist.length - 1].correo.estado : null;
const reset = () => {
  message = { id: 1, nombre: 'Persona 1', email: 'p1@example.test', telefono: '987654321', asunto: 'Asunto 1', mensaje: 'Mensaje 1', estado: 'nuevo', createdAt: '2026-01-01T10:00:00.000Z' };
  attention = { estado: 'nuevo', responsable: '', notas: '', respuesta: 'Respuesta guardada de prueba', revision: 1, historial: [] };
  posts = []; qhist = []; qrev = 1; Object.assign(sim, { mode: 'accepted', delay: 0, qmode: 'accepted' });
};
reset();
const lastOf = kind => [...attention.historial].reverse().find(h => h.correo?.tipo === kind);
const envios = () => ({ respuesta: lastOf('respuesta') ? { estado: lastOf('respuesta').correo.estado, fecha: lastOf('respuesta').fecha, intento: 'x' } : null, constancia: lastOf('constancia') ? { estado: lastOf('constancia').correo.estado, fecha: lastOf('constancia').fecha, intento: 'y' } : null });
const view = () => ({ ...JSON.parse(JSON.stringify(attention)), envios: envios() });
const push = (kind, estado) => { attention.historial.push({ accion: kind + ': ' + estado, usuario: 1, fecha: new Date().toISOString(), correo: { tipo: kind, estado, intento: 'i' } }); attention.revision++; };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = async () => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw); } catch { return {}; } };
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (route === '/__empty') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (route === '/__clear') { reset(); return json({ ok: true }); }
    if (route === '/__set') { for (const [k, v] of url.searchParams) sim[k] = isNaN(Number(v)) ? v : Number(v); return json({ ok: true }); }
    if (route === '/__state') return json({ posts, attention });
    if (route.startsWith('/api/')) {
      if (route === '/api/settings') return json({ ok: true, settings: {} });
      if (route === '/api/admin/me') return token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({ message: 'Unauthorized' }, 401);
      if (route.startsWith('/api/admin/')) {
        if (token !== TOKEN) return json({ message: 'Unauthorized' }, 401);
        const sub = route.slice('/api/admin/'.length); let m;
        if ((m = sub.match(/^seguimiento\/messages\/1(\/(correo|constancia))?$/))) {
          if (req.method === 'GET') return json({ ok: true, item: view() });
          const data = await body(), kind = m[2] === 'correo' ? 'respuesta' : 'constancia';
          posts.push({ route: sub, data });
          if (sim.delay) await sleep(sim.delay);
          if (kind === 'respuesta' && data.revision !== attention.revision) return json({ ok: false, message: 'La respuesta cambió. Recarga el caso antes de enviarla.' }, 409);
          const last = lastOf(kind)?.correo.estado;
          if (['iniciado', 'aceptado', 'incierto'].includes(last) && !data.confirmar_reenvio) {
            const texto = { iniciado: 'Hay un envío iniciado que todavía no tiene resultado.', aceptado: 'El proveedor ya aceptó este contenido. Confirma si de verdad quieres enviarlo otra vez.', incierto: 'No pudimos confirmar si el proveedor aceptó el envío anterior. Revisa el historial antes de reenviarlo.' }[last];
            return json({ ok: false, envio: 'bloqueado', motivo: last, requiere_confirmacion: true, mensaje: texto }, 409);
          }
          if (sim.mode === 'network') { push(kind, 'aceptado'); return req.socket.destroy(); } // el servidor y el proveedor aceptaron, pero la respuesta nunca llega
          if (sim.mode === 'accepted') { push(kind, 'aceptado'); return json({ ok: true, envio: 'aceptado', mensaje: 'El proveedor aceptó el correo. Esto no confirma que ya esté en la bandeja del destinatario.', item: view(), revision: attention.revision }); }
          if (sim.mode === 'failed') { push(kind, 'fallido'); return json({ ok: false, envio: 'fallido', mensaje: 'No se pudo enviar el correo. La respuesta sigue guardada y puedes volver a intentarlo.', item: view(), revision: attention.revision }, 503); }
          if (sim.mode === 'proxy504') { push(kind, 'aceptado'); res.writeHead(504, { 'Content-Type': 'text/html' }); return res.end('<html>Gateway Time-out ER_SECRET</html>'); }
          push(kind, 'incierto'); return json({ ok: false, envio: 'incierto', mensaje: 'No pudimos confirmar si el proveedor aceptó el correo. Es posible que el destinatario lo reciba. Revisa el historial antes de reenviarlo.', item: view(), revision: attention.revision }, 502);
        }
        if (sub === 'cotizaciones') return json({ ok: true, items: [quoteView()], pagination: { total: 1, pages: 1 } });
        if ((m = sub.match(/^cotizaciones\/1(\/correo)?$/))) {
          if (req.method === 'GET') return json({ ok: true, item: quoteView() });
          const data = await body(); posts.push({ route: sub, data });
          if (sim.qmode === 'vencida') return json({ statusCode: 409, message: 'La propuesta está vencida.', error: 'Conflict' }, 409);
          if (data.revision !== qrev) return json({ statusCode: 409, message: 'La cotización cambió. Recárgala antes de enviar.', error: 'Conflict' }, 409);
          if (['iniciado', 'aceptado', 'incierto'].includes(qlast()) && !data.confirmar_reenvio) return json({ ok: false, envio: 'bloqueado', motivo: qlast(), requiere_confirmacion: true, mensaje: 'Esta cotización ya tiene un envío registrado. Confirma si de verdad quieres enviarla otra vez.' }, 409);
          const estado = sim.qmode === 'uncertain' ? 'incierto' : 'aceptado'; qhist.push({ accion: 'Correo de cotización: ' + estado, usuario: 1, fecha: new Date().toISOString(), correo: { tipo: 'cotizacion', estado, intento: 'q' } }); qrev++;
          return estado === 'aceptado' ? json({ ok: true, envio: 'aceptado', mensaje: 'El proveedor aceptó el correo con la cotización. Esto no confirma que ya esté en la bandeja del cliente.', item: quoteView(), revision: qrev }) : json({ ok: false, envio: 'incierto', mensaje: 'No pudimos confirmar si el proveedor aceptó el correo. Es posible que el cliente lo reciba. Revisa el historial antes de reenviarlo.', item: quoteView(), revision: qrev }, 502);
        }
        if (sub === 'messages') return json({ ok: true, messages: [message], pagination: { total: 1, page: 1, limit: 20, pages: 1 }, metrics: { nuevo: 1, en_proceso: 0, atendido: 0, archivado: 0 } });
        if ((m = sub.match(/^messages\/(\d+)$/))) return json({ ok: true, message });
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
  const profile = require('./smoke-cleanup.cjs').createProfile('horus-mail-');
  const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' });
  const cleanup = require('./smoke-cleanup.cjs')(child, profile, server);
  let version; for (let i = 0; i < 100 && !version; i++) { await sleep(100); try { version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); } catch { /* arrancando */ } }
  const bc = connect(version.webSocketDebuggerUrl); await bc.ready;
  const jsErrors = [], blocked = []; let fails = 0, page;
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
    p.wait = async (expression, what, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await p.evaluate('!!(' + expression + ')')) return true; } catch { /* navegando */ } await sleep(100); } throw new Error('Tiempo agotado esperando ' + what); };
    p.go = async route => { await p.send('Page.navigate', { url: origin + route }); await sleep(300); if (!route.startsWith('/__')) await p.wait('document.querySelector(".hp-body, .admin-auth")', 'la página ' + route); };
    p.close = async () => { try { p.socket.close(); await bc.send('Target.closeTarget', { targetId }); } catch { /* ya cerrada */ } };
    return p;
  }
  const F = '.hw-inbox-detail form.hp-form';
  const set = params => fetch(origin + '/__set?' + new URLSearchParams(params));
  const state = () => fetch(origin + '/__state').then(r => r.json());
  const click = text => page.evaluate("(() => { const b = [...document.querySelectorAll('" + F + " button')].find(x => x.textContent.includes(" + JSON.stringify(text) + ")); if (!b) throw new Error('sin botón ' + " + JSON.stringify(text) + "); b.click(); return 1 })()");
  const result = () => page.evaluate("(() => { const r = document.querySelector('" + F + " [data-mail-result]'); return r ? { kind: r.dataset.mailResult, text: r.innerText, role: r.getAttribute('role'), confirm: [...r.querySelectorAll('button')].map(b => b.textContent) } : null })()");
  const waitResult = async kind => { try { await page.wait("document.querySelector('" + F + " [data-mail-result=\"" + kind + "\"]')", 'resultado ' + kind); } catch (error) { console.log('  (visto: ' + JSON.stringify(await result()) + ' · ' + JSON.stringify((await state()).posts.length) + ' POST)'); throw error; } return result(); };
  const reopen = async (width) => { await fetch(origin + '/__clear'); if (page) await page.close(); page = await open(width); await page.go('/__empty'); await page.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(TOKEN) + '); 1'); await page.go('/admin/messages?id=1'); await page.wait('document.querySelector("' + F + ' fieldset textarea")', 'editor de seguimiento'); };
  const activeLabel = () => page.evaluate("(document.activeElement?.tagName || '') + ':' + (document.activeElement?.textContent || document.activeElement?.dataset?.mailResult || '').slice(0, 40)");
  const focused = text => page.evaluate('document.activeElement?.tagName === "BUTTON" && document.activeElement.textContent.trim() === ' + JSON.stringify(text));
  const onResult = () => page.evaluate('!!document.activeElement?.dataset?.mailResult');
  const key = async (shift) => { await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }); await sleep(80); };
  const RAW = /Failed to fetch|ER_SECRET|Gateway|NetworkError|TypeError/i;

  console.log('\n== FIABILIDAD DE CORREOS (D5)');
  await reopen();
  { // 1. aceptado
    await click('Enviar respuesta guardada'); const r = await waitResult('aceptado');
    ck(r.role === 'status' && /no confirma/i.test(r.text), '1. aceptado: se comunica como «aceptado», no como entregado', r);
    await page.wait('document.querySelector("' + F + ' [data-mail-state=respuesta]")?.innerText.includes("aceptado")', 'estado del último envío');
    ck((await state()).posts.length === 1, '1. un solo POST al enviar'); }

  await reopen();
  { // 2. fallido -> se puede reintentar sin confirmación
    await set({ mode: 'failed' }); await click('Enviar respuesta guardada'); let r = await waitResult('fallido');
    ck(r.role === 'alert' && r.confirm.length === 0, '2. fallido confirmado: aviso claro y sin diálogo de confirmación', r);
    await set({ mode: 'accepted' }); await click('Enviar respuesta guardada'); await waitResult('aceptado');
    const s = await state(); ck(s.posts.length === 2 && !s.posts[1].data.confirmar_reenvio, '2. tras un fallo confirmado el reintento no exige confirmar'); }

  await reopen();
  { // 3. incierto -> no invita a reintentar; el siguiente intento exige confirmación explícita
    await set({ mode: 'uncertain' }); await click('Enviar respuesta guardada'); let r = await waitResult('incierto');
    ck(/No pudimos confirmar/.test(r.text) && !/reintent|vuelve a intentar|no se (pudo )?envi/i.test(r.text) && r.confirm.length === 0, '3. incierto: no afirma que no se envió ni invita a reintentar', r);
    await page.wait('document.querySelector("' + F + ' [data-mail-state=respuesta]")?.innerText.includes("no se pudo confirmar")', 'estado incierto en el historial visible');
    await set({ mode: 'accepted' }); await click('Enviar respuesta guardada'); r = await waitResult('bloqueado');
    ck(r.confirm.includes('Enviar de todos modos') && r.confirm.includes('No enviar') && (await state()).posts.length === 2, '3. el segundo envío se bloquea y pide confirmación explícita', r);
    ck(await focused("No enviar"), '3. el foco real está en la opción segura «No enviar»', await activeLabel());
    await click('No enviar'); ck((await result()) === null && (await state()).posts.length === 2, '3. «No enviar» descarta sin llamar al servidor');
    await click('Enviar respuesta guardada'); await waitResult('bloqueado'); await click('Enviar de todos modos'); await waitResult('aceptado');
    const s = await state(); ck(s.posts.length === 4 && s.posts[3].data.confirmar_reenvio === true && s.posts[2].data.confirmar_reenvio === undefined, '3. solo la confirmación explícita envía confirmar_reenvio'); }

  await reopen();
  { // 4. regresión: red cortada tras aceptar. El comportamiento anterior mostraba el error crudo del navegador e invitaba a reenviar.
    await set({ mode: 'network' }); await click('Enviar respuesta guardada'); await page.wait('document.querySelector("' + F + ' [data-mail-result=incierto], ' + F + ' [data-mail-result=obsoleto]")', 'resultado tras el corte'); const r = await result(); // Edge puede repetir solo el POST de una conexión cortada: la revisión obsoleta lo frena (409)
    ck(!RAW.test(r.text) && /(No pudimos confirmar|pudo haber salido)/.test(r.text) && !/reintent|vuelve a intentar/i.test(r.text) && (await state()).posts.length <= 2 && (await state()).attention.historial.length === 1, '4. corte de red: mensaje de «incierto/pudo haber salido», sin texto técnico, sin duplicar el envío', { r, historial: (await state()).attention.historial.length });
    await set({ mode: 'accepted' }); await page.wait('document.querySelector("' + F + ' [data-mail-state=respuesta]")?.innerText.includes("aceptado")', 'historial sincronizado tras el corte');
    const before = (await state()).posts.length; await click('Enviar respuesta guardada'); const b = await waitResult('bloqueado');
    ck(b.confirm.includes('Enviar de todos modos') && (await state()).posts.length === before + 1 && (await state()).attention.historial.length === 1, '4. el reenvío tras un corte exige confirmar (el servidor ya había aceptado)', b); }

  await reopen();
  { // 5. 504 de un proxy con HTML: incierto, sin filtrar el cuerpo
    await set({ mode: 'proxy504' }); await click('Enviar respuesta guardada'); const r = await waitResult('incierto');
    ck(!RAW.test(r.text), '5. 504 de proxy: incierto y sin texto técnico', r); }

  await reopen();
  { // 6. doble clic: una sola petición
    await set({ delay: 400 });
    await page.evaluate("(() => { const b = [...document.querySelectorAll('" + F + " button')].find(x => x.textContent.includes('Enviar respuesta guardada')); b.click(); b.click(); return 1 })()");
    await waitResult('aceptado'); ck((await state()).posts.length === 1, '6. doble clic: una sola petición al servidor', (await state()).posts.length); }

  await reopen();
  { // 7. constancia: se bloquea la repetición hasta confirmar
    await click('Reenviar constancia'); await waitResult('aceptado');
    await click('Reenviar constancia'); const r = await waitResult('bloqueado');
    ck(r.confirm.includes('Enviar de todos modos') && (await state()).posts.length === 2 && (await state()).posts.every(p => p.route.endsWith('/constancia')), '7. constancia aceptada: reenviar exige confirmación', r);
    await click('Enviar de todos modos'); await waitResult('aceptado'); ck((await state()).posts[2].data.confirmar_reenvio === true, '7. la constancia confirmada lleva confirmar_reenvio'); }

  for (const [label, width] of [['escritorio', 1280], ['móvil', 390]]) { // 9. foco de la confirmación
    await reopen(width); await set({ mode: 'uncertain' }); await click('Enviar respuesta guardada'); await waitResult('incierto');
    ck(await onResult(), '9 (' + label + '). tras un resultado el foco pasa al aviso (no cae al <body>)', await activeLabel());
    await set({ mode: 'accepted' }); await click('Enviar respuesta guardada'); await waitResult('bloqueado');
    ck(await focused('No enviar'), '9 (' + label + '). al abrir la confirmación el foco está en «No enviar»', await activeLabel());
    ck((await state()).posts.length === 2, '9 (' + label + '). mostrar la confirmación no envía nada');
    await key(false); ck(!(await focused('No enviar')) && (await page.evaluate('document.activeElement !== document.body')), '9 (' + label + '). Tab avanza sin perder el foco', await activeLabel());
    await key(true); ck(await focused('No enviar'), '9 (' + label + '). Shift+Tab vuelve a «No enviar»', await activeLabel());
    await key(true); ck(await focused('Enviar de todos modos'), '9 (' + label + '). Shift+Tab llega a «Enviar de todos modos»', await activeLabel());
    await key(false); await page.evaluate('document.activeElement.click(); 1'); // «No enviar» con el teclado
    await page.wait('!document.querySelector("' + F + ' [data-mail-result]")', 'confirmación cerrada');
    await sleep(100); ck(await focused('Enviar respuesta guardada') && (await state()).posts.length === 2, '9 (' + label + '). al cancelar el foco vuelve al botón que la originó, sin enviar', await activeLabel());
    await click('Enviar respuesta guardada'); await waitResult('bloqueado'); await click('Enviar de todos modos'); await waitResult('aceptado');
    ck(await onResult() && (await state()).posts.length === 4, '9 (' + label + '). tras confirmar, el foco no se pierde al deshabilitarse los botones', await activeLabel());
  }

  { // 10. cotizaciones: 409 de negocio, incierto, bloqueado y foco
    const QD = 'dialog[open] ';
    const qresult = () => page.evaluate("(() => { const r = document.querySelector('dialog[open] [data-mail-result]'); return r ? { kind: r.dataset.mailResult, text: r.innerText } : null })()");
    const qwait = kind => page.wait("document.querySelector('" + QD + "[data-mail-result=\"" + kind + "\"]')", 'cotización ' + kind);
    const qclick = text => page.evaluate("(() => { const b = [...document.querySelectorAll('dialog[open] button')].find(x => x.textContent.trim() === " + JSON.stringify(text) + "); if (!b) throw new Error('sin botón ' + " + JSON.stringify(text) + "); b.click(); return 1 })()");
    await reopen(1280); await page.go('/admin/dashboard?section=cotizaciones');
    await page.wait('[...document.querySelectorAll("button")].some(x => x.textContent.trim() === "Ver propuesta" && !x.disabled)', 'lista de cotizaciones');
    await page.evaluate('[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Ver propuesta").click(); 1'); await page.wait('document.querySelector(".hq-document")', 'detalle');
    await set({ qmode: 'vencida' }); await qclick('Enviar por correo'); await qwait('conflicto'); let q = await qresult();
    ck(q.text.includes('La propuesta está vencida.') && !/cambió mientras se enviaba/.test(q.text), '10. cotización vencida: se conserva el mensaje de negocio (no se presenta como revisión obsoleta)', q);
    await set({ qmode: 'uncertain' }); await qclick('Enviar por correo'); await qwait('incierto');
    ck(/No pudimos confirmar/.test((await qresult()).text) && !/reintent/i.test((await qresult()).text), '10. cotización incierta: sin invitar a reintentar');
    await set({ qmode: 'accepted' }); await qclick('Enviar por correo'); await qwait('bloqueado');
    ck(await focused('No enviar'), '10. cotización: la confirmación enfoca «No enviar»', await activeLabel());
    await qclick('No enviar'); await sleep(100);
    ck(await focused('Enviar por correo') && (await state()).posts.length === 3, '10. cotización: al cancelar el foco vuelve a «Enviar por correo» sin enviar', await activeLabel());
    await qclick('Enviar por correo'); await qwait('bloqueado'); await qclick('Enviar de todos modos'); await qwait('aceptado');
    const posts = (await state()).posts;
    ck(posts.length === 5 && posts[4].data.confirmar_reenvio === true && posts[3].data.confirmar_reenvio === undefined && await onResult(), '10. cotización: solo la confirmación explícita envía confirmar_reenvio', posts.map(p => p.data)); }

  const storage = await page.evaluate("JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)])");
  ck(!/respuesta|borrador|password|token=/i.test(storage.replace(KEY, '')), 'sin borradores ni datos de correo en el almacenamiento del navegador', storage);
  const PUBLIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
  const leaks = blocked.filter(b => { try { return b.method !== 'GET' || !PUBLIC_ASSET_HOSTS.includes(new URL(b.url).hostname); } catch { return true; } });
  ck(leaks.length === 0, 'ninguna petición externa inesperada (' + blocked.length + ' recursos públicos bloqueados antes de enviarse)', leaks.slice(0, 3));
  ck(jsErrors.length === 0, 'sin excepciones de JavaScript', jsErrors.slice(0, 3));
  console.log(fails ? '\nHAY ' + fails + ' FALLA(S)' : '\nFiabilidad de correos: OK.');
  cleanup();
  process.exit(fails ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
