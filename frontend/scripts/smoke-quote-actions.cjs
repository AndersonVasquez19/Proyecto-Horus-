// Cotizaciones › Fase 4D (filtro «Vencidas», «Duplicar cotización» y «Descargar PDF») con API simulada: nada real (ni MySQL, ni correo, ni servicios externos).
// Edge por DevTools con perfil temporal horus-*, bloqueo de toda petición que no sea del servidor local y cierre del árbol de procesos (smoke-kit.cjs).
// El servidor simulado imita los contratos reales del backend: GET cotizaciones?vencida=si, POST cotizaciones/:id/duplicar (Idempotency-Key opcional:
// la misma clave devuelve la misma copia) y GET cotizaciones/:id/pdf (application/pdf). Esto NO es una integración real con NestJS ni MySQL.
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

const STATES = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada'];
const fresh = () => ({ n: 12, perm: 'all', requests: [], quotes: null, copies: new Map(), pdf: 'ok', dup: 'ok', dupDelay: 0, pdfDelay: 0, nextId: 100 });
let sim = fresh();
const build = n => Array.from({ length: n }, (_, k) => {
  const id = k + 1, estado = STATES[(id + (id % 3)) % 5];
  return { id, numero: 'COT-' + String(id).padStart(4, '0'), cliente: 'Cliente Ficticio ' + id, estado, revision: 1, moneda: 'PEN', total: (100 + id * 10) + '.50',
    subtotal: '100.00', impuesto: '18.00', descuento: 0, tasa: 18, validez: '2030-01-10', vencida: estado === 'enviada' && id % 2 === 0,
    email: 'c' + id + '@example.test', telefono: '', documento: '', direccion: '', emisor: 'Horus Group', datos_emisor: '', condiciones: '', contacto_id: null,
    conceptos: [{ descripcion: 'Servicio de prueba', cantidad: 1, precio: 100, importe: 100 }], historial: [{ accion: 'creada', usuario: 1, fecha: '2026-10-01T10:00:00.000Z' }],
    createdAt: new Date(Date.UTC(2026, 9, 1) + id * 3600e3).toISOString() };
});
const quotes = () => sim.quotes || (sim.quotes = build(sim.n));
const ME = { all: { ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } },
  reader: { ok: true, user: { id: 5, nombre: 'Lucía Lectora', email: 'lucia@example.test', rol: 'COORDINADORA_INSTITUCIONAL', permisos: ['cotizaciones:leer'] }, acceso: { modo: 'por_roles' } },
  creator: { ok: true, user: { id: 6, nombre: 'Sara Secretaria', email: 'sara@example.test', rol: 'SECRETARIA', permisos: ['cotizaciones:leer', 'cotizaciones:crear'] }, acceso: { modo: 'por_roles' } } };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const handler = async (req, res, { route, url, json, body }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'clear') sim = fresh(); else { sim[key] = isNaN(Number(value)) ? decodeURIComponent(value) : Number(value); if (key === 'n') sim.quotes = null; } return json({ ok: true }) || true; }
  if (route === '/__state') return json({ requests: sim.requests, count: quotes().length }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (route === '/api/admin/me') return (token === TOKEN ? json(ME[sim.perm]) : json({}, 401)) || true;
  const sub = route.replace('/api/admin/', ''); let m;
  if (sub.startsWith('cotizaciones')) sim.requests.push({ method: req.method, route: sub, query: Object.fromEntries(url.searchParams), auth: token === TOKEN, key: req.headers['idempotency-key'] || null, urlHasToken: req.url.includes(TOKEN) });
  if (req.method === 'GET' && sub === 'cotizaciones') {
    const limit = Number(url.searchParams.get('limit') || 12), page = Number(url.searchParams.get('page') || 1), search = (url.searchParams.get('search') || '').toLowerCase();
    const estado = url.searchParams.get('estado') || '', overdue = url.searchParams.get('vencida') === 'si';
    const all = quotes().filter(q => (!estado || q.estado === estado) && (!overdue || q.vencida) && (!search || [q.numero, q.cliente].some(v => v.toLowerCase().includes(search)))).sort((a, b) => b.id - a.id);
    const items = all.slice((page - 1) * limit, page * limit).map(({ conceptos, historial, email, telefono, documento, direccion, condiciones, datos_emisor, ...row }) => row);
    return json({ ok: true, items, pagination: { total: all.length, pages: Math.ceil(all.length / limit), page } }) || true;
  }
  if (req.method === 'GET' && (m = sub.match(/^cotizaciones\/(\d+)$/))) { const q = quotes().find(x => x.id === +m[1]); return (q ? json({ ok: true, item: q }) : json({ message: 'Cotización no encontrada.' }, 404)) || true; }
  if (req.method === 'GET' && (m = sub.match(/^cotizaciones\/(\d+)\/pdf$/))) {
    if (sim.pdfDelay) await sleep(sim.pdfDelay);
    const q = quotes().find(x => x.id === +m[1]);
    if (sim.pdf === 'fail') return json({ message: 'Internal server error ER_SECRET_DETAIL' }, 500) || true;
    if (String(sim.pdf) === '404' || !q) return json({ message: 'Cotización no encontrada.' }, 404) || true;
    if (sim.pdf === 'badtype') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html></html>'); return true; }
    if (sim.pdf === 'empty') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="cotizacion-' + q.numero + '.pdf"', 'Content-Length': PDF.length }); res.end(PDF); return true;
  }
  if (req.method === 'POST' && (m = sub.match(/^cotizaciones\/(\d+)\/duplicar$/))) {
    if (sim.dupDelay) await sleep(sim.dupDelay);
    const key = req.headers['idempotency-key'], source = quotes().find(x => x.id === +m[1]);
    if (!source) return json({ message: 'Cotización no encontrada.' }, 404) || true;
    if (String(sim.dup) === '409') return json({ message: 'La cotización original tiene conceptos ilegibles y no se puede duplicar.' }, 409) || true;
    let copy = key && sim.copies.get(key);
    if (!copy) {
      const id = sim.nextId++; copy = { ...source, id, numero: 'COT-' + String(id).padStart(4, '0'), estado: 'borrador', revision: 1, vencida: false, historial: [{ accion: 'Creada como borrador (duplicada de ' + source.numero + ')', usuario: 1, fecha: new Date().toISOString() }] };
      quotes().push(copy); if (key) sim.copies.set(key, copy);
    }
    if (sim.dup === 'fail-once') { sim.dup = 'ok'; return json({ message: 'Internal server error ER_SECRET_DETAIL' }, 500) || true; } // la copia SÍ se creó; la respuesta se perdió
    return json({ ok: true, item: copy, requiere_nueva_vigencia: !!source.vencida }) || true;
  }
  if (sub === 'messages') return json({ ok: true, messages: [], pagination: { total: 0, page: 1, limit: 20, pages: 1 }, metrics: {} }) || true;
  return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'quote-actions', handler });
  const { ck, session } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + encodeURIComponent(value));
  const state = () => fetch(k.origin + '/__state').then(r => r.json());
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const ROUTE = '/admin/dashboard?section=cotizaciones';
  const tableReady = p => p.wait('document.querySelector(".hp-table")', 'tabla');
  const rows = p => p.evaluate('[...document.querySelectorAll(".hp-table tbody tr")].map(r => r.cells[0].textContent.trim())');
  const listCalls = async () => (await state()).requests.filter(r => r.method === 'GET' && r.route === 'cotizaciones');
  const num = id => 'COT-' + String(id).padStart(4, '0');
  const openQuote = async (p, id) => { await p.evaluate('(() => { const tr = [...document.querySelectorAll(".hp-table tbody tr")].find(r => r.cells[0].textContent.trim() === ' + JSON.stringify(num(id)) + '); tr.querySelector("button").click(); return 1; })()'); await p.wait('document.querySelector("dialog.hp-dialog[open]") && /Detalle de cotización/.test(document.querySelector("dialog.hp-dialog[open]").innerText)', 'detalle ' + num(id)); };
  const btn = (p, scope, text) => p.evaluate('[...document.querySelectorAll(' + JSON.stringify(scope + ' button') + ')].some(b => b.textContent.trim() === ' + JSON.stringify(text) + ')');
  const labels = p => p.evaluate('[...document.querySelectorAll("dialog[open] button")].map(b => b.textContent.trim())');
  const spyBlobs = p => p.evaluate('(() => { const o = URL.createObjectURL; window.__blobs = []; URL.createObjectURL = b => { window.__blobs.push({ size: b.size, type: b.type }); return o.call(URL, b); }; return 1; })()');
  const expiredIds = build(12).filter(q => q.vencida).map(q => q.numero).sort();
  const filterBtn = p => p.evaluate('(() => { const b = document.querySelector("[data-overdue-filter]"); return b ? { pressed: b.getAttribute("aria-pressed"), disabled: b.disabled, text: b.textContent.trim() } : null; })()');

  console.log('\n== FILTRO «VENCIDAS»');
  await clean();
  { const p = await session(ROUTE); await tableReady(p);
    ck(expiredIds.length > 0 && expiredIds.length < 12, 'la fixture tiene vencidas y no vencidas', expiredIds);
    ck((await filterBtn(p))?.pressed === 'false' && !(await p.evaluate('!!document.querySelector("[data-overdue-note]")')), 'el filtro es visible, está inactivo por defecto y la vista habitual no cambia');
    ck(!('vencida' in ((await listCalls()).at(-1).query)), 'sin filtro la consulta NO envía «vencida»', (await listCalls()).at(-1).query);
    await p.click('[data-overdue-filter]', 'Vencidas'); await p.wait('document.querySelector("[data-overdue-note]")', 'aviso de filtro'); await sleep(400);
    const call = (await listCalls()).at(-1).query, got = await rows(p);
    ck(call.vencida === 'si' && call.estado === '' && call.page === '1', 'activarlo envía vencida=si (sin estado y desde la página 1)', call);
    ck(JSON.stringify([...got].sort()) === JSON.stringify(expiredIds), 'la tabla lista solo las enviadas vencidas', { got, expiredIds });
    const f = await filterBtn(p);
    ck(f.pressed === 'true' && /Solo vencidas/.test(f.text), 'el estado activo se comunica con aria-pressed y con texto', f);
    ck(await p.evaluate('document.querySelector("select[aria-label=\\"Filtrar por estado\\"]").disabled'), 'el filtro por estado se desactiva mientras «Vencidas» está activo');
    ck(/Mostrando solo cotizaciones enviadas con la vigencia vencida/.test(await p.text('[data-overdue-note]')), 'un aviso en línea explica el filtro');
    await p.click('[data-overdue-note] button', 'Quitar filtro'); await p.wait('!document.querySelector("[data-overdue-note]")', 'filtro quitado'); await sleep(400);
    ck((await rows(p)).length === 12 && !('vencida' in ((await listCalls()).at(-1).query)), 'Quitar filtro recupera la vista habitual (12 filas, sin «vencida»)');
    ck((await filterBtn(p)).pressed === 'false' && !(await p.evaluate('document.querySelector("select[aria-label=\\"Filtrar por estado\\"]").disabled')), 'el filtro por estado vuelve a estar disponible');
    // Interacción con el tablero: ignora «vencidas» (su lote y sus indicadores son completos) y lo conserva al volver.
    await p.click('[data-overdue-filter]', 'Vencidas'); await sleep(400);
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tablero'); await p.wait('document.querySelector("[data-pipeline-board]")', 'tablero'); await sleep(400);
    const b = (await listCalls()).at(-1).query;
    ck(!('vencida' in b) && b.limit === '100' && (await filterBtn(p)).disabled && !(await p.evaluate('!!document.querySelector("[data-overdue-note]")')), 'en el tablero el lote es completo, el botón se desactiva y no hay aviso', b);
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tabla'); await tableReady(p); await sleep(400);
    ck((await filterBtn(p)).pressed === 'true' && (await listCalls()).at(-1).query.vencida === 'si', 'al volver a Tabla el filtro sigue activo y se vuelve a aplicar'); await p.close(); }
  await clean();
  { const p = await session(ROUTE); await tableReady(p);
    await p.type('input[type=search]', 0, 'COT-0001'); await p.evaluate('document.querySelector(".hp-toolbar").requestSubmit(); 1'); await sleep(400);
    await p.click('[data-overdue-filter]', 'Vencidas'); await p.wait('document.querySelector(".hp-empty h3")', 'estado vacío'); await sleep(300);
    const t = await p.text('.hp-empty'); ck(/No encontramos coincidencias/.test(t), 'vencidas + búsqueda sin resultados: estado vacío de coincidencias', t);
    await p.evaluate('(() => { const el = document.querySelector("input[type=search]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector(".hp-toolbar").requestSubmit(); return 1; })()'); await sleep(500);
    ck(JSON.stringify([...(await rows(p))].sort()) === JSON.stringify(expiredIds), 'al limpiar la búsqueda el filtro sigue activo y lista las vencidas'); await p.close(); }
  await clean();
  { await ctl('n', '4'); const p = await session(ROUTE); await tableReady(p); // con 4 cotizaciones no hay enviadas vencidas (la 2 es enviada no vencida)
    await p.click('[data-overdue-filter]', 'Vencidas'); await p.wait('document.querySelector(".hp-empty h3")', 'vacío'); await sleep(300);
    const t = await p.text('.hp-empty'); ck(/No hay cotizaciones vencidas/.test(t) && /Quita el filtro/.test(t), 'sin vencidas se muestra un vacío específico, no «Aún no hay cotizaciones»', t);
    await p.click('[data-overdue-note] button', 'Quitar filtro'); await tableReady(p); ck((await rows(p)).length === 4, 'quitar el filtro desde el vacío recupera la lista'); await p.close(); }

  console.log('\n== DESCARGAR PDF');
  await clean();
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3); await spyBlobs(p);
    ck(await btn(p, 'dialog[open]', 'Descargar PDF') && await btn(p, 'dialog[open]', 'Imprimir / guardar PDF'), 'el detalle ofrece «Descargar PDF» y conserva «Imprimir / guardar PDF»');
    await p.evaluate('(() => { const b = [...document.querySelectorAll("dialog[open] button")].find(x => x.textContent.trim() === "Descargar PDF"); b.click(); b.click(); return 1; })()');
    await p.wait('/PDF descargado/.test(document.querySelector("dialog[open]").innerText)', 'aviso de descarga'); await sleep(300);
    const reqs = (await state()).requests.filter(r => r.route === 'cotizaciones/3/pdf');
    ck(reqs.length === 1, 'un doble clic rápido pide el PDF una sola vez', reqs.length);
    ck(reqs[0].auth && !reqs[0].urlHasToken, 'el PDF se pide con el token en Authorization y nunca en la URL');
    const blobs = await p.evaluate('window.__blobs');
    ck(blobs.length === 1 && blobs[0].type === 'application/pdf' && blobs[0].size === PDF.length, 'el navegador recibe un archivo application/pdf con el contenido del servidor', blobs);
    ck(/PDF descargado: cotizacion-COT-0003\.pdf/.test(await p.text('dialog[open]')), 'el aviso confirma el nombre del archivo solo tras la respuesta');
    ck((await state()).requests.every(r => r.method === 'GET'), 'descargar el PDF no escribe nada (solo GET)'); await p.close(); }
  for (const [mode, expected] of [['fail', /No se pudo generar el PDF/], ['404', /Cotización no encontrada/], ['badtype', /archivo inesperado/], ['empty', /archivo vacío/]]) {
    await clean(); await ctl('pdf', mode);
    const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3); await spyBlobs(p);
    await p.click('dialog[open] button', 'Descargar PDF'); await p.wait('document.querySelector("dialog[open] .hp-error[role=alert]")', 'error de PDF (' + mode + ')');
    const t = await p.text('dialog[open] .hp-error'), blobs = await p.evaluate('window.__blobs.length');
    ck(expected.test(t) && !/ER_SECRET|Internal server error/.test(await p.text('body')) && blobs === 0, 'PDF ' + mode + ': mensaje claro en español, sin texto técnico y sin entregar archivo', t);
    ck(!(await p.evaluate('[...document.querySelectorAll("dialog[open] button")].find(b => b.textContent.trim() === "Descargar PDF").disabled')), 'PDF ' + mode + ': el botón se libera (sin estado de carga indefinido)'); await p.close(); }
  await clean(); await ctl('pdfDelay', '3000');
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3);
    await p.click('dialog[open] button', 'Descargar PDF'); await p.wait('[...document.querySelectorAll("dialog[open] button")].some(b => b.textContent.trim() === "Detener espera")', 'Detener espera');
    ck(await p.evaluate('[...document.querySelectorAll("dialog[open] button")].find(b => b.textContent.trim() === "Descargar PDF").disabled'), 'mientras se genera, «Descargar PDF» está bloqueado');
    await p.click('dialog[open] button', 'Detener espera'); await p.wait('/descarga se canceló/.test(document.querySelector("dialog[open]").innerText)', 'cancelación');
    ck(!(await p.evaluate('[...document.querySelectorAll("dialog[open] button")].find(b => b.textContent.trim() === "Descargar PDF").disabled')), 'tras cancelar, se puede volver a intentar'); await p.close(); }
  await clean(); await ctl('perm', 'reader');
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3);
    ck(await btn(p, 'dialog[open]', 'Descargar PDF'), 'una cuenta lectora (cotizaciones:leer) puede descargar el PDF'); await p.close(); }

  console.log('\n== DUPLICAR COTIZACIÓN');
  await clean();
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3);
    ck(await btn(p, 'dialog[open]', 'Duplicar cotización') && await btn(p, 'dialog[open]', 'Preparar copia'), 'el detalle ofrece «Duplicar cotización» y conserva «Preparar copia»');
    await p.click('dialog[open] button', 'Duplicar cotización'); await p.wait('document.querySelectorAll("dialog[open]").length === 2', 'confirmación');
    const t = await p.text('dialog.hq-void-confirm[open]');
    ck((await state()).requests.every(r => r.method === 'GET'), 'abrir la confirmación no escribe nada');
    ck(await p.evaluate('document.activeElement?.textContent.trim() === "Cancelar"'), 'el foco inicial está en la opción segura «Cancelar»');
    await p.click('dialog[open] [data-autofocus]', 'Cancelar'); await sleep(300);
    ck((await state()).requests.every(r => r.method === 'GET') && (await p.evaluate('document.querySelectorAll("dialog[open]").length')) === 1, 'cancelar no duplica nada y deja el detalle abierto', t);
    await p.click('dialog[open] button', 'Duplicar cotización'); await p.wait('document.querySelectorAll("dialog[open]").length === 2', 'confirmación');
    ck(/borrador/.test(await p.evaluate('document.querySelector("dialog.hq-void-confirm[open]").innerText')) && /original no cambia/.test(await p.evaluate('document.querySelector("dialog.hq-void-confirm[open]").innerText')), 'la confirmación explica que se crea un borrador y que la original no cambia');
    await p.evaluate('(() => { const b = document.querySelector("[data-confirm-duplicate]"); b.click(); b.click(); return 1; })()');
    await p.wait('/Detalle de cotización/.test(document.body.innerText) && document.querySelector("dialog[open]") && /COT-0100/.test(document.querySelector("dialog[open]").innerText)', 'detalle de la copia'); await sleep(400);
    const s = await state(), posts = s.requests.filter(r => r.method === 'POST');
    ck(posts.length === 1 && posts[0].route === 'cotizaciones/3/duplicar', 'un doble clic en «Duplicar» envía una única petición', posts);
    ck(/^[A-Za-z0-9._:-]{16,128}$/.test(posts[0].key || '') && posts[0].auth, 'la petición lleva Idempotency-Key válida y Authorization');
    ck(s.count === 13, 'se creó exactamente una cotización nueva', s.count);
    const detail = await p.text('dialog[open]');
    ck(/Borrador/i.test(detail) && /COT-0100/.test(detail), 'tras confirmar se abre el detalle de la copia, en borrador', detail.slice(0, 160));
    ck(await p.evaluate('document.querySelectorAll("dialog[open]").length') === 1, 'no quedan diálogos de confirmación abiertos');
    await p.click('dialog[open] button', 'Cerrar'); await sleep(500);
    ck((await rows(p)).includes('COT-0100'), 'el listado se actualiza y muestra la copia'); await p.close(); }
  await clean();
  { // Original vencida: la copia lo advierte.
    const p = await session(ROUTE); await tableReady(p); await openQuote(p, 10);
    await p.click('dialog[open] button', 'Duplicar cotización'); await p.wait('document.querySelectorAll("dialog[open]").length === 2', 'confirmación');
    ck(/vigencia vencida/.test(await p.evaluate('document.querySelector("dialog.hq-void-confirm[open]").innerText')), 'si la original está vencida, la confirmación avisa que habrá que fijar una vigencia nueva');
    await p.click('dialog[open] [data-confirm-duplicate]', 'Duplicar'); await p.wait('document.querySelector("dialog[open]") && /COT-0100/.test(document.querySelector("dialog[open]").innerText)', 'copia'); await sleep(300);
    ck(/vigencia nueva antes de enviarla/.test(await p.text('dialog[open]')), 'tras duplicar una vencida se avisa en línea que debe editarse la vigencia'); await p.close(); }
  await clean(); await ctl('dup', 'fail-once');
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3);
    await p.click('dialog[open] button', 'Duplicar cotización'); await p.wait('document.querySelectorAll("dialog[open]").length === 2', 'confirmación');
    await p.click('dialog[open] [data-confirm-duplicate]', 'Duplicar'); await p.wait('document.querySelector("dialog.hq-void-confirm[open] .hp-error[role=alert]")', 'resultado incierto');
    const t = await p.text('dialog.hq-void-confirm[open] .hp-error');
    ck(/No pudimos confirmar si la copia se creó/.test(t) && !/ER_SECRET|Internal server error/.test(await p.text('body')), 'un 500 se informa como resultado incierto, sin texto técnico', t);
    await sleep(500); ck((await state()).requests.filter(r => r.method === 'POST').length === 1, 'no se reintenta automáticamente');
    ck(!(await p.evaluate('document.querySelector("[data-confirm-duplicate]").disabled')), 'el botón se libera para un reintento manual consciente');
    await p.click('dialog[open] [data-confirm-duplicate]', 'Duplicar'); await p.wait('document.querySelector("dialog[open]") && /COT-0100/.test(document.querySelector("dialog[open]").innerText)', 'copia tras reintento'); await sleep(300);
    const s = await state(), posts = s.requests.filter(r => r.method === 'POST');
    ck(posts.length === 2 && posts[0].key === posts[1].key, 'el reintento manual reutiliza la misma Idempotency-Key', posts.map(x => x.key));
    ck(s.count === 13, 'tras un fallo incierto y un reintento solo existe UNA copia (no se duplicó)', s.count); await p.close(); }
  await clean(); await ctl('dup', '409');
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3);
    await p.click('dialog[open] button', 'Duplicar cotización'); await p.wait('document.querySelectorAll("dialog[open]").length === 2', 'confirmación');
    await p.click('dialog[open] [data-confirm-duplicate]', 'Duplicar'); await p.wait('document.querySelector("dialog.hq-void-confirm[open] .hp-error[role=alert]")', 'error 409');
    ck(/conceptos ilegibles/.test(await p.text('dialog.hq-void-confirm[open] .hp-error')), 'un rechazo del backend (409) conserva su mensaje en español en la propia confirmación');
    ck((await state()).count === 12 && !(await p.evaluate('document.querySelector("[data-confirm-duplicate]").disabled')), 'no se creó nada y el botón queda libre'); await p.close(); }
  await clean(); await ctl('dupDelay', '3000');
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3);
    await p.click('dialog[open] button', 'Duplicar cotización'); await p.wait('document.querySelectorAll("dialog[open]").length === 2', 'confirmación');
    await p.click('dialog[open] [data-confirm-duplicate]', 'Duplicar'); await p.wait('[...document.querySelectorAll("dialog[open] button")].some(b => b.textContent.trim() === "Detener espera")', 'Detener espera');
    ck(await p.evaluate('document.querySelector("[data-confirm-duplicate]").disabled && /Duplicando/.test(document.querySelector("[data-confirm-duplicate]").textContent)'), 'mientras espera, «Duplicar» está bloqueado y muestra «Duplicando…»');
    await p.click('dialog[open] button', 'Detener espera'); await p.wait('/No pudimos confirmar si la copia se creó/.test(document.body.innerText)', 'cancelación = incierto');
    ck(!(await p.evaluate('document.querySelector("[data-confirm-duplicate]").disabled')), 'cancelar la espera libera el botón y se informa como incierto (no como éxito)'); await p.close(); }

  console.log('\n== PERMISOS');
  await clean(); await ctl('perm', 'reader');
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3);
    const l = await labels(p);
    ck(!l.includes('Duplicar cotización') && !l.includes('Preparar copia') && l.includes('Descargar PDF'), 'una cuenta solo lectora no ve «Duplicar» pero sí «Descargar PDF»', l);
    ck((await state()).requests.every(r => r.method === 'GET'), 'una cuenta lectora no envía escrituras'); await p.close(); }
  await clean(); await ctl('perm', 'creator');
  { const p = await session(ROUTE); await tableReady(p); await openQuote(p, 3);
    const l = await labels(p);
    ck(l.includes('Duplicar cotización') && l.includes('Descargar PDF') && !l.some(x => /^Marcar |Enviar por correo/.test(x)), 'con cotizaciones:crear (sin enviar/anular) se ofrece Duplicar, no el envío ni las transiciones', l);
    await p.click('dialog[open] button', 'Duplicar cotización'); await p.wait('document.querySelectorAll("dialog[open]").length === 2', 'confirmación');
    await p.click('dialog[open] [data-confirm-duplicate]', 'Duplicar'); await p.wait('document.querySelector("dialog[open]") && /COT-0100/.test(document.querySelector("dialog[open]").innerText)', 'copia');
    ck((await state()).requests.filter(r => r.method === 'POST').length === 1, 'la cuenta con permiso de crear puede duplicar'); await p.close(); }

  console.log('\n== DISEÑO ADAPTABLE (1440, 1280, 820, 390 y 320 px)');
  const MEASURE = `(() => { const W = document.documentElement.clientWidth, out = {};
    const box = (el) => { if (!el) return { missing: true }; el.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), inside: r.width > 0 && r.left >= -0.5 && r.right <= W + 0.5, reachable: !!hit && (hit === el || el.contains(hit) || hit.contains(el)), clipped: el.scrollWidth > el.clientWidth + 1 }; };
    const f = document.querySelector('[data-overdue-filter]'); out.filter = box(f); out.page = document.documentElement.scrollWidth; out.W = W; return out; })()`;
  const MEASURE_DIALOG = sel => `(() => { const d = document.querySelector('${sel}'), W = document.documentElement.clientWidth, dr = d.getBoundingClientRect();
    const buttons = [...d.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), inside: r.left >= dr.left - 0.5 && r.right <= dr.right + 0.5 && r.right <= W + 0.5, clipped: b.scrollWidth > b.clientWidth + 1, h: Math.round(r.height) }; });
    return { W, dialogInside: dr.left >= -0.5 && dr.right <= W + 0.5, overflowX: d.scrollWidth > d.clientWidth + 1, page: document.documentElement.scrollWidth, buttons }; })()`;
  for (const width of [1440, 1280, 820, 390, 320]) {
    await clean();
    const p = await session(ROUTE, width); await tableReady(p); await sleep(250);
    const tag = width + ' px: ';
    const m = await p.evaluate(MEASURE);
    ck(!m.filter.missing && m.filter.inside && m.filter.reachable && !m.filter.clipped && m.filter.h >= 40, tag + 'el botón «Vencidas» está dentro del viewport, alcanzable, sin recortar y ≥ 40 px', m.filter);
    ck(m.page <= m.W + 1, tag + 'la página no se desborda horizontalmente', { page: m.page, W: m.W });
    await p.click('[data-overdue-filter]', 'Vencidas'); await p.wait('document.querySelector("[data-overdue-note]")', 'aviso'); await sleep(250);
    const m2 = await p.evaluate(MEASURE), note = await p.evaluate('(() => { const n = document.querySelector("[data-overdue-note]").getBoundingClientRect(); return n.left >= -0.5 && n.right <= document.documentElement.clientWidth + 0.5; })()');
    ck(m2.filter.inside && m2.filter.reachable && !m2.filter.clipped && note && m2.page <= m2.W + 1, tag + 'con el filtro activo el botón y el aviso caben sin desbordar', { f: m2.filter, note, page: m2.page });
    await p.click('[data-overdue-note] button', 'Quitar filtro'); await sleep(400);
    await openQuote(p, 10);
    const d1 = await p.evaluate(MEASURE_DIALOG('dialog[open]:not(.hq-void-confirm)'));
    ck(d1.dialogInside && !d1.overflowX && d1.page <= d1.W + 1 && d1.buttons.every(b => b.inside && !b.clipped && b.h >= 36), tag + 'el detalle con «Descargar PDF» y «Duplicar cotización» no se desborda ni recorta botones', d1);
    ck(d1.buttons.some(b => b.text === 'Descargar PDF') && d1.buttons.some(b => b.text === 'Duplicar cotización'), tag + 'ambos botones existen en el detalle');
    await p.click('dialog[open] button', 'Duplicar cotización'); await p.wait('document.querySelectorAll("dialog[open]").length === 2', 'confirmación');
    const d2 = await p.evaluate(MEASURE_DIALOG('dialog.hq-void-confirm[open]'));
    ck(d2.dialogInside && !d2.overflowX && d2.page <= d2.W + 1 && d2.buttons.every(b => b.inside && !b.clipped && b.h >= 36), tag + 'la confirmación de duplicado cabe en el viewport con sus botones completos', d2);
    await p.close();
  }

  k.finish('Cotizaciones › Fase 4D (vencidas, duplicar, PDF)');
})().catch(error => { console.error(error); process.exit(1); });
