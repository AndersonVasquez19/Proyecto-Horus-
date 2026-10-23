// Chatbot con API simulada: nada real (ni datos, ni sesiones, ni correo, ni IA). Edge por DevTools.
// Widget público: saludo y conversación escrita, sin menú ni formularios. Panel: vista de solo lectura de preguntas sin respuesta.
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

const sim = { contact: 'ok', list: 'ok', chat: 'ok' };
const chatRequests = [];
let releaseChat = null;
const contacts = [];
const all = Array.from({ length: 25 }, (_, i) => ({ id: 25 - i, pregunta: 'Pregunta sin respuesta número ' + (25 - i), veces: 25 - i, createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-' + String(25 - i).padStart(2, '0') + 'T10:00:00.000Z' }));
const metrics = { dias: 30, interacciones: 40, resueltas: 31, sinRespuesta: 9, conIa: 12, conCatalogo: 28 };
const requests = [];

const handler = async (req, res, { route, url, json, body }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'release') releaseChat?.(); else if (key === 'clear') { releaseChat?.(); contacts.length = 0; requests.length = 0; chatRequests.length = 0; sim.contact = 'ok'; sim.list = 'ok'; sim.chat = 'ok'; } else sim[key] = value; return json({ ok: true }) || true; }
  if (route === '/__state') return json({ contacts, requests, chatRequests }) || true;
  if (!route.startsWith('/api/')) return false;
  if (req.method !== 'GET') requests.push(req.method + ' ' + route);
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (route === '/api/chatbot/message' && req.method === 'POST') { const data = await body(); chatRequests.push(data.message);
    if (sim.chat === 'error') return json({ message: 'Internal server error ER_SECRET' }, 500) || true;
    if (sim.chat === 'hold') await new Promise(resolve => { releaseChat = resolve; });
    return json({ ok: true, mode: 'catalogo', kind: 'respuesta', answer: 'Respuesta de prueba para: ' + data.message,
      sources: [{ id: 'servicio-4', title: 'Asesoramiento tecnológico', text: 'Orientación para elegir soluciones.', href: '/tecnologias/servicios/4' }, { id: 'faq-9', title: 'Fuente con enlace externo', text: 'No debe enlazarse.', href: 'https://evil.test/x' }],
      suggestions: ['Información sobre Asesoramiento tecnológico', '¿Cómo puedo contactar al equipo?'] }) || true; }
  if (route === '/api/chatbot/contact' && req.method === 'POST') { const data = await body(); contacts.push(data);
    return (sim.contact === 'error' ? json({ message: 'Internal server error ER_SECRET' }, 500) : json({ ok: true, id: 70 + contacts.length })) || true; }
  if (route === '/api/admin/me') return (token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({}, 401)) || true;
  if (route === '/api/admin/chatbot/sin-respuesta') {
    if (token !== TOKEN) return json({ message: 'Unauthorized' }, 401) || true;
    if (sim.list === 'error') return json({ message: 'Internal server error ER_SECRET' }, 500) || true;
    if (sim.list === 'malformed') return json({ ok: true, items: 'no es una lista' }) || true;
    const search = (url.searchParams.get('search') || '').toLowerCase(), page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
    const rows = all.filter(r => !search || r.pregunta.toLowerCase().includes(search));
    if (sim.list === 'empty') return json({ ok: true, items: [], pagination: { total: 0, page: 1, limit, pages: 0 }, metrics: { ...metrics, interacciones: 0, resueltas: 0, sinRespuesta: 0, conIa: 0, conCatalogo: 0 } }) || true;
    return json({ ok: true, items: rows.slice((page - 1) * limit, page * limit), pagination: { total: rows.length, page, limit, pages: Math.ceil(rows.length / limit) }, metrics }) || true;
  }
  return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'chatbot', handler });
  const { ck, session, open } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + value);
  const state = () => fetch(k.origin + '/__state').then(r => r.json());
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const openChat = async p => { await p.go('/quienes-somos', 'document.querySelector(".hc-launcher")'); await p.click('.hc-launcher', ''); await p.wait('document.querySelector("dialog.hc-dialog[open] .hc-assistant")', 'saludo del chat'); };
  console.log('\n== WIDGET PÚBLICO: SALUDO Y CONVERSACIÓN');
  const sent = async () => (await state()).chatRequests;
  await clean();
  for (const width of [1280, 390]) {
    const p = await open(width, 844); await openChat(p);
    await sleep(1200);
    ck(await p.evaluate('document.querySelectorAll(".hc-log article").length === 1 && !document.querySelector(".hc-guide, .hc-actions, .hc-followups, .hc-contact, .hc-toolbar")') && /¿En qué te puedo ayudar\?/.test(await p.text('.hc-assistant')), 'solo queda el saludo, sin menú ni accesos adicionales, a ' + width + ' px');
    ck((await state()).requests.length === 0 && await p.evaluate('!document.querySelector("#hc-question").disabled'), 'se puede escribir de inmediato y abrir no envía solicitudes');
    await p.click('.hc-close'); await p.wait('!document.querySelector(".hc-dialog[open]")', 'cierre');
    await p.click('.hc-launcher'); await p.wait('document.querySelector(".hc-dialog[open]")', 'reapertura');
    ck(await p.evaluate('document.querySelectorAll(".hc-assistant").length === 1'), 'reabrir conserva el saludo sin duplicarlo');
    await p.close();
  }
  await clean();
  { const p = await open(1280); await openChat(p);
    await p.type('#hc-question', 0, 'Quiero información');
    await p.evaluate('const q = document.querySelector("#hc-question"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); 1');
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8, text: '\r', unmodifiedText: '\r' });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 });
    ck(await p.evaluate('document.querySelector("#hc-question").value.includes("\\n")') && (await sent()).length === 0, 'Shift + Enter permite otra línea sin enviar');
    await p.type('#hc-question', 0, 'Quiero información\nsobre cursos');
    ck(await p.evaluate('document.querySelector("#hc-question-limit").textContent') === '31 / 1000', 'el contador muestra la longitud del mensaje');
    await p.evaluate('document.querySelector("#hc-question").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })); 1');
    ck((await sent()).length === 0, 'Enter durante la composición de texto no envía la consulta');
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await p.wait('document.querySelectorAll(".hc-assistant").length === 2', 'respuesta a consulta multilínea');
    ck((await sent()).join() === 'Quiero información\nsobre cursos' && await p.evaluate('document.querySelector("#hc-question-limit").textContent') === '0 / 1000', 'Enter envía el texto completo y reinicia el contador');
    await p.click('.hc-toolbar button', 'Nueva conversación');
    ck(await p.evaluate('document.querySelectorAll(".hc-log article").length === 1 && !document.querySelector(".hc-toolbar, .hc-guide")') && /¿En qué te puedo ayudar\?/.test(await p.text('.hc-assistant')), 'reiniciar vuelve a mostrar únicamente el saludo'); await p.close(); }
  await clean();
  { const p = await open(1280); await openChat(p);
    await p.type('#hc-question', 0, 'Servicios de asesoramiento');
    await p.evaluate('document.querySelector(".hc-compose form").requestSubmit(); 1');
    await p.wait('document.querySelectorAll(".hc-assistant").length === 2', 'respuesta');
    await p.evaluate('document.querySelector(".hc-sources summary").click(); 1');
    const links = await p.evaluate('[...document.querySelectorAll(".hc-sources a")].map(a => a.getAttribute("href"))');
    ck(links.join() === '/tecnologias/servicios/4', 'solo se enlaza la ruta propia del sitio; el enlace externo de una fuente se ignora', links);
    ck(await p.evaluate('!document.querySelector(".hc-followups, .hc-guide, .hc-actions")'), 'sin opciones adicionales al responder');
    await p.type('#hc-question', 0, 'Contacto');
    await p.evaluate('document.querySelector(".hc-compose form").requestSubmit(); 1');
    await p.wait('document.querySelectorAll(".hc-assistant").length === 3', 'segunda respuesta');
    ck((await sent()).join('|') === 'Servicios de asesoramiento|Contacto', 'las consultas se envían desde el campo de texto');
    ck(await p.evaluate('getComputedStyle(document.querySelector("dialog.hc-dialog")).animationName === "none"'), 'con movimiento reducido el diálogo no se anima'); await p.close(); }
  await clean();
  { const p = await open(1280); await openChat(p); await p.wait('document.querySelector("#hc-question")', 'campo');
    await ctl('chat', 'error'); await p.type('#hc-question', 0, 'curso de redes'); await p.evaluate('document.querySelector(".hc-compose form").requestSubmit(); 1'); await p.wait('document.querySelector(".hc-error")', 'error');
    const err = await p.text('.hc-error');
    ck(!/ER_SECRET|Internal/.test(err) && /Reintentar consulta/.test(err), 'un 500 muestra un aviso seguro y ofrece reintentar', err);
    ck(await p.evaluate('document.querySelector("#hc-question").value') === 'curso de redes' && (await sent()).length === 1, 'la pregunta vuelve al campo y no se reenvía sola');
    await ctl('chat', 'ok'); await p.click('.hc-retry', 'Reintentar'); await p.wait('document.querySelectorAll(".hc-assistant").length === 2', 'recuperación'); await sleep(200);
    ck((await sent()).length === 2 && !(await p.evaluate('!!document.querySelector(".hc-error")')), 'Reintentar envía una sola vez y limpia el error', await sent()); await p.close(); }
  await clean();
  { const p = await open(1280); await openChat(p); await p.wait('document.querySelector("#hc-question")', 'campo');
    await ctl('chat', 'hold'); await p.type('#hc-question', 0, 'asesoría'); await p.evaluate('const f = document.querySelector(".hc-compose form"); f.requestSubmit(); f.requestSubmit(); 1'); await p.wait('document.querySelector(".hc-thinking")', 'consultando'); await sleep(250);
    ck((await sent()).length === 1, 'un doble envío produce una sola petición', await sent());
    ck(await p.evaluate('document.querySelector(".hc-toolbar button").disabled && document.querySelector("#hc-question").disabled && document.querySelector(".hc-log").getAttribute("aria-busy") === "true"'), 'mientras responde no se puede reiniciar ni escribir, y el registro anuncia que está ocupado');
    await ctl('release'); await p.wait('document.querySelectorAll(".hc-assistant").length === 2', 'respuesta'); await sleep(200);
    ck(await p.evaluate('!document.querySelector(".hc-toolbar button").disabled && document.querySelector(".hc-log").getAttribute("aria-busy") === "false"'), 'al responder se rehabilita todo'); await p.close(); }
  await clean();
  { const p = await open(1280); await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'for (const key of ["localStorage","sessionStorage"]) Object.defineProperty(window, key, { get() { throw new DOMException("Storage blocked for test", "SecurityError"); } });' });
    await openChat(p); await p.type('#hc-question', 0, 'Convenios'); await p.evaluate('document.querySelector(".hc-compose form").requestSubmit(); 1'); await p.wait('document.querySelectorAll(".hc-assistant").length === 2', 'respuesta');
    ck((await sent()).join() === 'Convenios', 'con el almacenamiento del navegador bloqueado el chat funciona igual'); await p.close(); }
  await clean();
  { const p = await open(390, 700); await openChat(p);
    const box = await p.evaluate('(() => { const r = document.querySelector("dialog.hc-dialog").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, h: innerHeight, scroll: document.documentElement.scrollWidth }; })()');
    ck(box.left >= 0 && box.right <= box.w && box.top >= 0 && box.bottom <= box.h && box.scroll <= box.w, 'en móvil el chat cabe en pantalla sin desplazamiento horizontal', box);
    ck(await p.evaluate('(() => { const r = document.querySelector(".hc-compose form").getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })()'), 'el campo y el botón de envío quedan visibles');
    const small = await p.evaluate('[...document.querySelectorAll(".hc-dialog button, .hc-dialog textarea, .hc-dialog summary")].filter(el => el.offsetParent && el.getBoundingClientRect().height < 32).map(el => (el.className || el.tagName) + ":" + Math.round(el.getBoundingClientRect().height))');
    ck(small.length === 0, 'los controles tienen un tamaño táctil de al menos 32 px de alto', small);
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await p.wait('!document.querySelector("dialog.hc-dialog[open]")', 'cierre con Escape'); await sleep(200);
    ck(await p.evaluate('document.activeElement === document.querySelector(".hc-launcher")'), 'al cerrar con Escape el foco vuelve al botón del asistente'); await p.close(); }
  await clean();
  for (const [width, height] of [[320, 568], [844, 390]]) {
    const p = await open(width, height); await openChat(p);
    await p.type('#hc-question', 0, 'Quiero información sobre cursos');
    await p.evaluate('document.querySelector(".hc-compose form").requestSubmit(); 1');
    await p.wait('document.querySelectorAll(".hc-assistant").length === 2', 'respuesta en pantalla pequeña');
    const layout = await p.evaluate('(() => { const d = document.querySelector(".hc-dialog"), l = document.querySelector(".hc-log"), a = document.querySelector(".hc-compose form").getBoundingClientRect(); return { log: l.clientHeight, overflow: d.scrollWidth > d.clientWidth, actions: a.bottom <= innerHeight && a.top >= 0 }; })()');
    ck(layout.log >= 60 && !layout.overflow && layout.actions, 'la conversación conserva espacio y las acciones caben a ' + width + ' × ' + height, layout);
    await p.close();
  }
  await clean();
  console.log('\n== PANEL: CONSULTAS DEL CHATBOT (SOLO LECTURA)');
  await clean();
  { const p = await session('/admin/dashboard?section=chatbot'); await p.wait('document.querySelector(".hp-table tbody tr")', 'tabla');
    const values = await p.evaluate('[...document.querySelectorAll(".hw-insights article strong")].map(x => x.textContent)');
    ck(values.join() === '40,31,9,12', 'las métricas muestran los valores reales de la API', values);
    ck(await p.evaluate('document.querySelectorAll(".hp-table tbody tr").length === 20') && /25 preguntas distintas/.test(await p.text('.hp-card-heading')), 'se listan 20 de 25 preguntas, paginadas');
    ck(await p.evaluate('document.title.includes("Consultas del chatbot") && [...document.querySelectorAll("aside .hp-nav-item")].some(b => b.textContent.includes("Consultas del chatbot"))'), 'la sección tiene entrada de menú y título');
    const buttons = await p.evaluate('[...document.querySelectorAll("main button")].map(b => b.textContent.trim()).filter(Boolean)');
    ck(buttons.every(t => /^(Actualizar|Buscar|Anterior|Siguiente)$/.test(t)) && !(await p.evaluate('!!document.querySelector("main input:not([type=search])")')), 'solo lectura: sin botones de crear, editar ni eliminar y sin formularios de datos', buttons);
    await p.click('main .hp-pagination button', 'Siguiente'); await p.wait('document.querySelectorAll(".hp-table tbody tr").length === 5', 'página 2');
    ck(/Página 2 de 2/.test(await p.text('.hp-pagination')), 'la paginación funciona');
    await p.type('input[aria-label="Buscar preguntas"]', 0, 'número 7'); await p.evaluate('document.querySelector("main form.hp-toolbar").requestSubmit(); 1'); await p.wait('document.querySelectorAll(".hp-table tbody tr").length === 1', 'búsqueda');
    ck((await state()).requests.length === 0, 'la vista no envía ninguna escritura'); await p.close(); }
  await clean();
  { await ctl('list', 'error'); const p = await session('/admin/dashboard?section=chatbot'); await p.wait('document.querySelector(".hp-error[role=alert]")', 'error');
    const text = await p.text('main'); const values = await p.evaluate('[...document.querySelectorAll(".hw-insights article strong")].map(x => x.textContent)');
    ck(!/ER_SECRET|Internal/.test(text) && values.every(v => v === '—') && !/Todavía no hay preguntas/.test(text), 'un 500 muestra un aviso seguro, métricas «—» y no un falso «sin preguntas»', text.slice(0, 160));
    await ctl('list', 'ok'); await p.click('main .hp-empty button', 'Reintentar'); await p.wait('document.querySelector(".hp-table tbody tr")', 'recuperación'); ck(true, 'Reintentar recupera la lista'); await p.close(); }
  await clean();
  { await ctl('list', 'malformed'); const p = await session('/admin/dashboard?section=chatbot'); await p.wait('document.querySelector(".hp-error[role=alert]")', 'error');
    ck(/formato inesperado/.test(await p.text('main')) && !(await p.evaluate('!!document.querySelector(".hp-table")')) && !/No pudimos abrir esta página/.test(await p.text()), 'una respuesta con forma inesperada es un error de carga, no una lista vacía ni una página rota'); await p.close(); }
  await clean();
  { await ctl('list', 'empty'); const p = await session('/admin/dashboard?section=chatbot'); await p.wait('document.querySelector(".hp-empty h3")', 'vacío');
    ck(/Todavía no hay preguntas sin respuesta/.test(await p.text('main')) && (await p.evaluate('[...document.querySelectorAll(".hw-insights article strong")].map(x => x.textContent)')).join() === '0,0,0,0', 'el estado vacío real muestra ceros reales y un mensaje claro'); await p.close(); }

  k.finish('Chatbot y consultas sin respuesta (Fase F)');
})().catch(error => { console.error(error); process.exit(1); });
