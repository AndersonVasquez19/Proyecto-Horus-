// Cotizaciones › vista «Tablero» (Pipeline Kanban) con API simulada: nada real (ni MySQL, ni correo, ni servicios externos).
// Edge por DevTools con perfil temporal horus-*, bloqueo de toda petición que no sea del servidor local y cierre del árbol de procesos (smoke-kit.cjs).
// Cubre: tabla como vista predeterminada, alternancia y ?vista=tablero, columnas por estado real, tarjetas con datos reales, indicadores,
// lote de 100 («Mostrando 100 de N»), estados vacío y de error, apertura del detalle existente, cambio de estado desde ese detalle,
// permisos de solo lectura, accesibilidad básica y diseño adaptable. El filtro de estado de Tabla sobrevive a Tablero → Tabla.
// Diseño adaptable (1280, 1024, 820, 768, 390, 360 y 320 px, en Tabla y en Tablero): cada control principal (Actualizar, Nueva cotización,
// selector Tabla/Tablero, búsqueda, filtro) debe estar dentro del viewport, ser alcanzable (elementFromPoint) y tener su texto sin recortar;
// las tarjetas e indicadores no pueden tener contenido recortado; indicadores 2×2 en teléfono. Capturas opcionales: SMOKE_SHOTS=<carpeta existente>.
const fs = require('node:fs'), path = require('node:path');
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

const STATES = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada'];
const fresh = () => ({ n: 12, list: 'ok', perm: 'all', requests: [], writes: [], quotes: null, detailDelay: 0 });
let sim = fresh();

const build = n => Array.from({ length: n }, (_, k) => {
  const id = k + 1, estado = STATES[(id + (id % 3)) % 5];
  return { id, numero: 'COT-' + String(id).padStart(4, '0'), cliente: 'Cliente Ficticio ' + id, estado, revision: 1, moneda: id % 4 === 0 ? 'USD' : 'PEN', total: (100 + id * 10) + '.50',
    subtotal: '100.00', impuesto: '18.00', descuento: 0, tasa: 18, validez: '2030-01-' + String(1 + (id % 27)).padStart(2, '0'), vencida: estado === 'enviada' && id % 5 === 0,
    email: 'c' + id + '@example.test', telefono: '', documento: '', direccion: '', emisor: 'Horus Group', datos_emisor: '', condiciones: '', contacto_id: null,
    conceptos: [{ descripcion: 'Servicio de prueba', cantidad: 1, precio: 100, importe: 100 }], historial: [{ accion: 'creada', usuario: 1, fecha: '2026-10-01T10:00:00.000Z' }],
    createdAt: new Date(Date.UTC(2026, 9, 1) + id * 3600e3).toISOString() };
});
const quotes = () => sim.quotes || (sim.quotes = build(sim.n));
const ME_ALL = { ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } };
const ME_READER = { ok: true, user: { id: 5, nombre: 'Lucía Lectora', email: 'lucia@example.test', rol: 'COORDINADORA_INSTITUCIONAL', permisos: ['cotizaciones:leer'] }, acceso: { modo: 'por_roles' } };

const handler = async (req, res, { route, url, json, body }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'clear') sim = fresh(); else { sim[key] = isNaN(Number(value)) ? decodeURIComponent(value) : Number(value); if (key === 'n') sim.quotes = null; } return json({ ok: true }) || true; }
  if (route === '/__state') return json({ requests: sim.requests, writes: sim.writes, quotes: quotes().map(q => ({ id: q.id, estado: q.estado, revision: q.revision })) }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (route === '/api/admin/me') return (token === TOKEN ? json(sim.perm === 'reader' ? ME_READER : ME_ALL) : json({}, 401)) || true;
  const sub = route.replace('/api/admin/', ''); let m;
  if (sub.startsWith('cotizaciones') || sub.startsWith('messages')) sim.requests.push({ method: req.method, route: sub, query: Object.fromEntries(url.searchParams) });
  if (req.method === 'GET' && sub === 'cotizaciones') {
    if (sim.list === 'fail') return json({ message: 'Internal server error ER_SECRET_DETAIL' }, 500) || true;
    const limit = Number(url.searchParams.get('limit') || 12), page = Number(url.searchParams.get('page') || 1), search = (url.searchParams.get('search') || '').toLowerCase(), estado = url.searchParams.get('estado') || '';
    const all = quotes().filter(q => (!estado || q.estado === estado) && (!search || [q.numero, q.cliente].some(v => v.toLowerCase().includes(search)))).sort((a, b) => b.id - a.id);
    const items = all.slice((page - 1) * limit, page * limit).map(({ conceptos, historial, email, telefono, documento, direccion, condiciones, datos_emisor, ...row }) => row);
    return json({ ok: true, items, pagination: { total: all.length, pages: Math.ceil(all.length / limit), page } }) || true;
  }
  if (req.method === 'GET' && (m = sub.match(/^cotizaciones\/(\d+)$/))) { if (sim.detailDelay) await sleep(sim.detailDelay); const q = quotes().find(x => x.id === +m[1]); return (q ? json({ ok: true, item: q }) : json({ message: 'No encontrada' }, 404)) || true; }
  if (req.method === 'POST' && (m = sub.match(/^cotizaciones\/(\d+)\/estado$/))) {
    const data = await body(), q = quotes().find(x => x.id === +m[1]); sim.writes.push({ route: sub, data });
    if (!q || data.revision !== q.revision) return json({ message: 'La cotización cambió.' }, 409) || true;
    q.estado = data.estado; q.revision += 1; q.historial.push({ accion: 'estado:' + data.estado, usuario: 1, fecha: new Date().toISOString() }); return json({ ok: true, item: q }) || true;
  }
  if (sub === 'messages') return json({ ok: true, messages: [], pagination: { total: 0, page: 1, limit: 20, pages: 1 }, metrics: {} }) || true;
  if ((m = sub.match(/^messages\/(\d+)$/))) return json({ ok: false, mensaje: 'Mensaje no encontrado.' }, 404) || true;
  return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'pipeline', handler });
  const { ck, session } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + encodeURIComponent(value));
  const state = () => fetch(k.origin + '/__state').then(r => r.json());
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const ROUTE = '/admin/dashboard?section=cotizaciones';
  const boardReady = p => p.wait('document.querySelector("[data-pipeline-board]")', 'tablero');
  const tableReady = p => p.wait('document.querySelector(".hp-table")', 'tabla');
  const counts = p => p.evaluate('Object.fromEntries([...document.querySelectorAll("[data-pipeline-board] [data-state]")].map(s => [s.dataset.state, s.querySelectorAll("article").length]))');
  const pressed = (p, name) => p.evaluate('[...document.querySelectorAll("[aria-label=\\"Vista de cotizaciones\\"] button")].find(b => b.textContent.trim() === ' + JSON.stringify(name) + ')?.getAttribute("aria-pressed")');
  const listCalls = async () => (await state()).requests.filter(r => r.method === 'GET' && r.route === 'cotizaciones');
  const shot = async (p, name) => { const dir = process.env.SMOKE_SHOTS; if (!dir || !fs.existsSync(dir)) return; await sleep(250); const { data } = await p.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(data, 'base64')); };
  const expected = () => { const c = Object.fromEntries(STATES.map(s => [s, 0])); for (const q of build(12)) c[q.estado]++; return c; };

  console.log('\n== VISTA PREDETERMINADA Y ALTERNANCIA');
  await clean();
  { const p = await session(ROUTE); await tableReady(p);
    ck(!(await p.evaluate('!!document.querySelector("[data-pipeline-board]")')) && (await pressed(p, 'Tabla')) === 'true' && (await pressed(p, 'Tablero')) === 'false', 'la tabla sigue siendo la vista predeterminada (Tabla seleccionada, sin tablero)');
    ck((await listCalls()).at(-1)?.query.limit === '12', 'la tabla conserva su consulta de 12 por página', (await listCalls()).at(-1)?.query);
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tablero'); await boardReady(p); await p.wait('document.querySelector("[data-pipeline-kpis]")', 'indicadores');
    const path1 = await p.path();
    ck(path1.includes('section=cotizaciones') && path1.includes('vista=tablero'), 'alternar a Tablero escribe ?vista=tablero y conserva section', path1);
    ck((await pressed(p, 'Tablero')) === 'true' && (await pressed(p, 'Tabla')) === 'false', 'los botones de vista reflejan la selección con aria-pressed');
    const call = (await listCalls()).at(-1)?.query;
    ck(call.limit === '100' && call.page === '1' && call.estado === '', 'el tablero pide un único lote de 100 con todos los estados', call);
    ck(!(await p.evaluate('!!document.querySelector(".hp-table")')) && !(await p.evaluate('!![...document.querySelectorAll(".hp-pagination-bar button")].length')), 'en el tablero no hay tabla ni botones de paginación');
    await shot(p, 'tablero-escritorio');
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tabla'); await tableReady(p);
    ck(!(await p.path()).includes('vista='), 'volver a Tabla retira ?vista y deja la tabla visible', await p.path()); await p.close(); }
  { const p = await session(ROUTE + '&vista=tablero'); await boardReady(p);
    ck((await pressed(p, 'Tablero')) === 'true', 'acceso directo con ?vista=tablero abre el tablero'); await p.close(); }

  console.log('\n== COLUMNAS, TARJETAS E INDICADORES (datos reales)');
  await clean();
  { const p = await session(ROUTE + '&vista=tablero'); await boardReady(p);
    const heads = await p.evaluate('[...document.querySelectorAll("[data-pipeline-board] section h3")].map(h => h.textContent.trim())');
    ck(JSON.stringify(heads) === JSON.stringify(['Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Anulada']), 'cinco columnas con los estados reales y en orden', heads);
    ck(JSON.stringify(await counts(p)) === JSON.stringify(expected()), 'cada cotización está en la columna de su estado', await counts(p));
    const labelled = await p.evaluate('[...document.querySelectorAll("[data-pipeline-board] section")].every(s => { const h = document.getElementById(s.getAttribute("aria-labelledby")); return !!h && h.textContent.trim().length > 0; })');
    ck(labelled, 'cada columna está nombrada por su encabezado (aria-labelledby)');
    const card = await p.text('article[data-quote-id="12"]');
    ck(/COT-0012/.test(card) && /Cliente Ficticio 12/.test(card) && /Enviada|Borrador|Aceptada|Rechazada|Anulada/.test(card), 'la tarjeta muestra número, cliente y estado en texto', card);
    ck(/220\.50 USD/.test(card) && /Válida hasta/.test(card) && /Creada/.test(card), 'muestra importe con su moneda, fecha de creación y validez', card);
    const text = await p.text('[data-pipeline-board]');
    ck(!/Urgente|Asesor|WhatsApp|Bot\b|Aprobado|Pago|Gerencia|Asignado/.test(text), 'no aparece información inventada (asesores, urgencia, canales, pagos, aprobaciones)', text.slice(0, 200));
    const kpi = await p.text('[data-pipeline-kpis]');
    ck(/Cotizaciones del lote\s*12/i.test(kpi) && /12 cotizaciones en total/i.test(kpi), 'indicador de cotizaciones del lote', kpi.slice(0, 160));
    ck(/PEN/.test(await p.text('[data-kpi="en-curso"]')) && /USD/.test(await p.text('[data-kpi="en-curso"]')) && /sin convertir/.test(await p.text('[data-kpi="en-curso"]')), 'el importe en curso separa PEN y USD y no los convierte', await p.text('[data-kpi="en-curso"]'));
    const acc = expected().aceptada;
    ck(new RegExp('Aceptadas\\s*' + acc + '\\b', 'i').test(await p.text('[data-kpi="aceptadas"]')), 'indicador de aceptadas coincide con la columna', await p.text('[data-kpi="aceptadas"]'));
    ck(/Tasa de aceptación/i.test(kpi) && /\d+(,\d)? %|Sin datos suficientes/i.test(await p.text('[data-kpi="tasa"]')), 'la tasa se muestra con su base o se declara sin datos suficientes', await p.text('[data-kpi="tasa"]'));
    ck(!(await p.evaluate('!!document.querySelector("[data-pipeline-truncated]")')), 'con menos de 100 cotizaciones no aparece el aviso de lote parcial');
    ck(/vencida/i.test(await p.text('[data-pipeline-board]')), 'una enviada vencida (dato del backend) se rotula como vencida con texto'); await p.close(); }

  console.log('\n== LOTE DE 100, VACÍO Y ERROR');
  await clean();
  { await ctl('n', '130'); const p = await session(ROUTE + '&vista=tablero'); await boardReady(p); await p.wait('document.querySelector("[data-pipeline-truncated]")', 'aviso de lote parcial');
    const total = Object.values(await counts(p)).reduce((a, b) => a + b, 0);
    ck(total === 100, 'con 130 cotizaciones el tablero muestra exactamente las 100 más recientes', total);
    ck(/Mostrando 100 de 130/.test(await p.text('[data-pipeline-truncated]')), 'el aviso dice «Mostrando 100 de 130»', await p.text('[data-pipeline-truncated]'));
    ck(/solo a las 100 cotizaciones más recientes cargadas, no al total de 130/.test(await p.text('[data-pipeline-kpis]')), 'los indicadores se rotulan como del lote cargado, no globales', await p.text('[data-pipeline-kpis]'));
    ck(/Mostrando 100 de 130 cotizaciones/.test(await p.text('.hp-pagination-bar')), 'el pie también indica 100 de 130');
    ck(await p.evaluate('!!document.querySelector("article[data-quote-id=\\"130\\"]") && !document.querySelector("article[data-quote-id=\\"30\\"]")'), 'el lote son las más recientes (la 130 está; la 30 queda fuera)'); await p.close(); }
  await clean();
  { await ctl('n', '0'); const p = await session(ROUTE + '&vista=tablero'); await p.wait('document.querySelector(".hp-empty h3")', 'estado vacío');
    ck(/Aún no hay cotizaciones/.test(await p.text('.hp-empty')) && !(await p.evaluate('!!document.querySelector("[data-pipeline-board]")')), 'sin cotizaciones se muestra el estado vacío existente (sin tablero ni indicadores falsos)'); await p.close(); }
  await clean();
  { await ctl('list', 'fail'); const p = await session(ROUTE + '&vista=tablero'); await p.wait('document.querySelector(".hp-empty button")', 'error con reintento');
    const t = await p.text('.hp-card');
    ck(/No se pudieron cargar las cotizaciones/.test(t) && !/ER_SECRET|Internal server error/.test(await p.text('body')), 'un 500 muestra un mensaje neutro (sin texto técnico) y ofrece reintentar', t.slice(0, 160));
    await ctl('list', 'ok'); await p.click('.hp-empty button', 'Reintentar'); await boardReady(p);
    ck(await p.evaluate('document.querySelectorAll("[data-pipeline-board] article").length') > 0, 'Reintentar recupera el tablero'); await p.close(); }

  console.log('\n== FILTROS, DETALLE Y CAMBIO DE ESTADO');
  await clean();
  { const p = await session(ROUTE); await tableReady(p);
    await p.type('input[type=search]', 0, 'COT-0003'); await p.evaluate('document.querySelector(".hp-toolbar").requestSubmit(); 1'); await sleep(500);
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tablero'); await boardReady(p); await sleep(400);
    const ids = await p.evaluate('[...document.querySelectorAll("[data-pipeline-board] article")].map(a => a.dataset.quoteId)');
    ck(JSON.stringify(ids) === '["3"]' && (await listCalls()).at(-1).query.search === 'COT-0003', 'la búsqueda se conserva al pasar a Tablero y se aplica al lote', { ids, q: (await listCalls()).at(-1).query });
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tabla'); await tableReady(p);
    ck(await p.evaluate('document.querySelector("input[type=search]").value') === 'COT-0003', 'al volver a Tabla el texto de búsqueda sigue ahí'); await p.close(); }
  await clean();
  { const p = await session(ROUTE); await tableReady(p);
    const SEL = 'select[aria-label="Filtrar por estado"]', rows = () => p.evaluate('[...document.querySelectorAll(".hp-table tbody tr")].map(r => r.cells[0].textContent.trim())');
    const calls0 = (await listCalls()).length;
    await p.evaluate('(() => { const el = document.querySelector(' + JSON.stringify(SEL) + '); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "enviada"); el.dispatchEvent(new Event("change", { bubbles: true })); return 1; })()');
    await p.wait('document.querySelector(' + JSON.stringify(SEL) + ').value === "enviada"', 'filtro Enviada'); await sleep(500);
    const filtered = await rows(), enviadas = build(12).filter(q => q.estado === 'enviada').map(q => q.numero).sort();
    ck((await listCalls()).at(-1).query.estado === 'enviada' && filtered.length > 0 && JSON.stringify([...filtered].sort()) === JSON.stringify(enviadas), 'paso 1: en Tabla el filtro «Enviada» se aplica y solo lista cotizaciones enviadas', { filtered, enviadas });
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tablero'); await boardReady(p); await sleep(300);
    ck(await p.evaluate('document.querySelector(' + JSON.stringify(SEL) + ').disabled') && (await listCalls()).at(-1).query.estado === '' && (await listCalls()).at(-1).query.limit === '100', 'paso 2: en Tablero el filtro se desactiva y el lote trae todos los estados');
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tabla'); await tableReady(p); await sleep(500);
    const back = await rows(), call = (await listCalls()).at(-1).query;
    ck(await p.evaluate('document.querySelector(' + JSON.stringify(SEL) + ').value') === 'enviada' && !(await p.evaluate('document.querySelector(' + JSON.stringify(SEL) + ').disabled')), 'paso 3: al volver a Tabla el filtro «Enviada» sigue seleccionado y habilitado');
    ck(call.estado === 'enviada' && call.limit === '12' && JSON.stringify([...back].sort()) === JSON.stringify(enviadas), 'paso 4: el filtro conservado sigue funcionando (consulta con estado=enviada y mismas filas)', { call, back });
    ck((await listCalls()).length > calls0, 'el filtro se probó contra el servidor simulado, no contra datos fijos');
    await p.evaluate('(() => { const el = document.querySelector(' + JSON.stringify(SEL) + '); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "aceptada"); el.dispatchEvent(new Event("change", { bubbles: true })); return 1; })()'); await sleep(500);
    const accepted = await rows();
    ck(accepted.length > 0 && JSON.stringify([...accepted].sort()) === JSON.stringify(build(12).filter(q => q.estado === 'aceptada').map(q => q.numero).sort()), 'tras volver, cambiar el filtro a «Aceptada» también funciona', accepted); await p.close(); }
  await clean();
  { const p = await session(ROUTE + '&vista=tablero'); await boardReady(p);
    ck(await p.evaluate('document.querySelector("select[aria-label=\\"Filtrar por estado\\"]").disabled'), 'en el tablero el filtro por estado se desactiva (se muestran todos los estados)');
    const target = (await state()).quotes.find(q => q.estado === 'borrador'), num = 'COT-' + String(target.id).padStart(4, '0'), nextState = 'enviada';
    await p.click('[data-pipeline-board] button', 'Ver propuesta ' + num); await p.wait('document.querySelector("dialog.hp-dialog[open]")', 'detalle');
    ck(/Detalle de cotización/.test(await p.text('dialog.hp-dialog[open]')) && new RegExp(num).test(await p.text('dialog.hp-dialog[open]')), 'una tarjeta abre el diálogo de detalle existente de esa cotización (' + num + ')');
    const labelOf = 'Marcar ' + nextState;
    ck(await p.evaluate('[...document.querySelectorAll("dialog[open] button")].some(b => b.textContent.trim() === ' + JSON.stringify(labelOf) + ')'), 'el detalle ofrece las transiciones de siempre (' + labelOf + ')');
    await p.click('dialog.hp-dialog[open] button', labelOf); await p.wait('document.body.innerText.includes("Estado actualizado")', 'estado actualizado');
    const s = await state(); ck(s.writes.length === 1 && s.writes[0].data.estado === nextState && s.writes[0].data.revision === 1, 'el cambio usa el POST de estado con la revisión actual (validaciones del backend intactas)', s.writes);
    await p.click('dialog.hp-dialog[open] button', 'Cerrar'); await sleep(500);
    const col = await p.evaluate('document.querySelector("article[data-quote-id=\\"' + target.id + '\\"]")?.closest("[data-state]")?.dataset.state');
    ck(col === nextState, 'tras el cambio la tarjeta aparece en la columna «' + nextState + '» (el tablero se relee)', col); await p.close(); }
  await clean();
  { await ctl('detailDelay', '400'); const p = await session(ROUTE + '&vista=tablero'); await boardReady(p);
    await p.evaluate('(() => { const b = document.querySelector("article[data-quote-id=\\"2\\"] button"); b.click(); b.click(); return 1; })()'); await p.wait('document.querySelector("dialog.hp-dialog[open]")', 'detalle'); await sleep(300);
    const n = (await state()).requests.filter(r => r.route === 'cotizaciones/2').length;
    ck(n === 1, 'un doble clic rápido en una tarjeta pide el detalle una sola vez (bloqueo existente)', n); await p.close(); }
  await clean();
  { const p = await session('/admin/dashboard?section=cotizaciones&contacto=999'); await p.wait('document.querySelector(".hp-error[role=alert]")', 'error de consulta inexistente');
    await p.click('[aria-label="Vista de cotizaciones"] button', 'Tablero'); await boardReady(p); await sleep(300);
    const s = await state();
    ck((await p.path()).includes('contacto=999') && (await p.path()).includes('vista=tablero'), 'alternar vista conserva el parámetro ?contacto', await p.path());
    ck(s.requests.filter(r => r.route === 'messages/999').length === 1, 'cambiar de vista no vuelve a consultar el contacto de origen', s.requests.filter(r => r.route === 'messages/999').length); await p.close(); }

  console.log('\n== PERMISOS (cuenta solo lectora)');
  await clean();
  { await ctl('perm', 'reader'); const p = await session(ROUTE + '&vista=tablero'); await boardReady(p);
    const buttons = await p.evaluate('[...document.querySelectorAll("[data-pipeline-board] article")].every(a => a.querySelectorAll("button").length === 1)');
    ck(buttons, 'cada tarjeta ofrece solo «Ver propuesta»: el tablero nunca cambia estados por sí mismo');
    ck(!(await p.evaluate('[...document.querySelectorAll("button")].some(b => /Nueva cotización/.test(b.textContent))')), 'sin permiso de crear no hay «Nueva cotización»');
    await p.click('[data-pipeline-board] button', 'Ver propuesta COT-0002'); await p.wait('document.querySelector("dialog.hp-dialog[open]")', 'detalle');
    const labels = await p.evaluate('[...document.querySelectorAll("dialog[open] button")].map(b => b.textContent.trim())');
    ck(!labels.some(x => /^Marcar |Enviar por correo|Editar borrador|Preparar copia/.test(x)), 'el detalle no ofrece transiciones, envío, edición ni copia sin permisos', labels);
    ck((await state()).writes.length === 0, 'una cuenta lectora no envía ninguna escritura'); await p.close(); }

  console.log('\n== ACCESIBILIDAD Y DISEÑO ADAPTABLE');
  await clean();
  { const p = await session(ROUTE + '&vista=tablero', 1280); await boardReady(p);
    const a11y = await p.evaluate('({ group: document.querySelector("[aria-label=\\"Vista de cotizaciones\\"]")?.getAttribute("role"), region: document.querySelector("[data-pipeline-board]").getAttribute("role"), tab: document.querySelector("[data-pipeline-board]").tabIndex, name: document.querySelector("[data-pipeline-board]").getAttribute("aria-label"), small: [...document.querySelectorAll("[data-pipeline-board] article button, [aria-label=\\"Vista de cotizaciones\\"] button")].filter(b => b.getBoundingClientRect().height < 40).length, unlabeled: [...document.querySelectorAll("[data-pipeline-board] article button")].filter(b => !/^Ver propuesta COT-\\d+ de /.test(b.getAttribute("aria-label") || "")).length, kpiName: document.querySelector("[data-pipeline-kpis]").getAttribute("aria-label") })');
    ck(a11y.group === 'group' && a11y.region === 'region' && a11y.tab === 0 && !!a11y.name && !!a11y.kpiName, 'grupo de vistas, región desplazable con foco de teclado y secciones con nombre accesible', a11y);
    ck(a11y.small === 0 && a11y.unlabeled === 0, 'botones táctiles de al menos 40 px y con etiqueta única por tarjeta', a11y);
    await p.evaluate('document.querySelector("article[data-quote-id=\\"2\\"] button").focus(); 1');
    ck(await p.evaluate('document.activeElement === document.querySelector("article[data-quote-id=\\"2\\"] button") && getComputedStyle(document.activeElement).outlineStyle !== "none"'), 'el botón de tarjeta recibe foco visible por teclado');
    await p.evaluate('document.activeElement.click(); 1'); await p.wait('document.querySelector("dialog.hp-dialog[open]")', 'detalle'); await p.click('dialog.hp-dialog[open] button', 'Cerrar'); await sleep(400);
    ck(await p.evaluate('document.activeElement?.closest("article")?.dataset.quoteId') === '2', 'al cerrar el detalle el foco vuelve a la tarjeta que lo abrió'); await p.close(); }
  { const p = await session(ROUTE + '&vista=tablero', 820); await boardReady(p);
    const m = await p.evaluate('({ page: document.documentElement.scrollWidth, view: window.innerWidth, inner: document.querySelector(".hqp-scroll").scrollWidth, box: document.querySelector(".hqp-scroll").clientWidth })');
    ck(m.page <= m.view + 1 && m.inner > m.box, 'tablet: la página no se desborda y el tablero se desplaza dentro de su región', m); await p.close(); }
  { const p = await session(ROUTE + '&vista=tablero', 390); await boardReady(p);
    const m = await p.evaluate('(() => { const cols = [...document.querySelectorAll(".hqp-column")].map(c => c.getBoundingClientRect()); return { page: document.documentElement.scrollWidth, view: window.innerWidth, stacked: cols.every((r, i) => i === 0 || r.top > cols[i - 1].top), sameLeft: new Set(cols.map(r => Math.round(r.left))).size === 1, fits: cols.every(r => r.right <= window.innerWidth + 1) }; })()');
    ck(m.page <= m.view + 1 && m.stacked && m.sameLeft && m.fits, 'móvil: columnas apiladas, sin desplazamiento horizontal de la página', m); await p.close(); }

  // La ausencia de desbordamiento del documento NO basta: un contenedor con overflow oculto o una fila sin envolver puede dejar un botón fuera
  // del área visible sin que la página tenga barra horizontal (la regresión que ocurrió con el selector Tabla/Tablero junto a «Actualizar»).
  // Por eso cada control principal se mide: rectángulo dentro del viewport, alcanzable (elementFromPoint) y con su texto sin recortar.
  console.log('\n== ENCABEZADO Y CONTROLES DENTRO DEL VIEWPORT (escritorio, tablet y móvil)');
  const MEASURE = `(() => {
    const W = document.documentElement.clientWidth;
    const byText = (scope, text) => [...document.querySelectorAll(scope)].find(b => b.textContent.replace(/\\s+/g, ' ').trim() === text);
    const box = el => { if (!el) return { missing: true }; el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height),
        inside: r.width > 0 && r.height > 0 && r.left >= -0.5 && r.right <= W + 0.5, reachable: !!hit && (hit === el || el.contains(hit) || hit.contains(el)),
        textClipped: el.scrollWidth > el.clientWidth + 1 }; };
    const group = document.querySelector('.hqp-views'), g = group && group.getBoundingClientRect();
    const tabs = group ? [...group.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), within: r.left >= g.left - 0.5 && r.right <= g.right + 0.5 && r.width > 0, height: Math.round(r.height) }; }) : [];
    const h = document.querySelector('.hp-heading'), hr = h.getBoundingClientRect();
    window.scrollTo(0, 0);
    return { W, page: document.documentElement.scrollWidth,
      refresh: box(byText('.hp-heading button', 'Actualizar')), create: box(byText('.hp-heading button', 'Nueva cotización')),
      views: Object.assign(box(group), { groupClipped: group ? group.scrollWidth > group.clientWidth + 1 : true, tabs }),
      title: box(document.querySelector('.hp-heading h1')), search: box(document.querySelector('.hp-toolbar input[type=search]')),
      searchBtn: box(byText('.hp-toolbar button', 'Buscar')), state: box(document.querySelector('.hp-toolbar select')),
      headingOverflow: h.scrollWidth > h.clientWidth + 1 };
  })()`;
  const CLIPPING = `(() => {
    const bad = [];
    for (const card of document.querySelectorAll('.hqp-card, .hqp-kpi')) {
      const cr = card.getBoundingClientRect(), name = (card.dataset.kpi || card.dataset.quoteId || '?');
      if (card.scrollWidth > card.clientWidth + 1) bad.push(name + ': contenido más ancho que la tarjeta');
      for (const el of card.querySelectorAll('*')) {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (r.right > cr.right + 1 || r.left < cr.left - 1) bad.push(name + ': <' + el.tagName.toLowerCase() + '> fuera de la tarjeta (' + Math.round(r.left - cr.left) + ',' + Math.round(cr.right - r.right) + ')');
        else if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) bad.push(name + ': <' + el.tagName.toLowerCase() + '> con texto recortado');
        const cs = getComputedStyle(el); if (cs.textOverflow === 'ellipsis' || (cs.overflow === 'hidden' && el.scrollHeight > el.clientHeight + 1)) bad.push(name + ': <' + el.tagName.toLowerCase() + '> truncado');
      }
    }
    return bad.slice(0, 6);
  })()`;
  const KPI_GRID = `(() => { const k = [...document.querySelectorAll('.hqp-kpi')].map(e => e.getBoundingClientRect());
    return { n: k.length, cols: new Set(k.map(r => Math.round(r.left))).size, rows: new Set(k.map(r => Math.round(r.top))).size,
      sameSize: new Set(k.map(r => Math.round(r.width))).size === 1,
      amounts: [...document.querySelectorAll('[data-kpi=en-curso] .hqp-amounts li')].map(li => { const r = li.getBoundingClientRect(); return { text: li.textContent.trim(), top: Math.round(r.top) }; }),
      // Distancia visible: desde el borde inferior del control más bajo de la barra (no de su caja, que incluye relleno) hasta el primer indicador.
      gapToToolbar: Math.round(k[0].top - Math.max(...[...document.querySelector('.hp-toolbar').children].map(c => c.getBoundingClientRect().bottom))),
      valueFont: Math.min(...[...document.querySelectorAll('.hqp-kpi strong')].map(s => parseFloat(getComputedStyle(s).fontSize))),
      labelFont: Math.min(...[...document.querySelectorAll('.hqp-kpi h3, .hqp-kpi p')].map(s => parseFloat(getComputedStyle(s).fontSize))) }; })()`;
  const VIEWPORTS = [['escritorio', 1280], ['escritorio-compacto', 1024], ['tablet', 820], ['tablet-estrecha', 768], ['movil', 390], ['movil-360', 360], ['movil-estrecho', 320]];
  const report = {};
  for (const [name, width] of VIEWPORTS) {
    for (const view of ['tabla', 'tablero']) {
      await clean();
      const p = await session(ROUTE + (view === 'tablero' ? '&vista=tablero' : ''), width); await (view === 'tablero' ? boardReady(p) : tableReady(p)); await sleep(250);
      const m = await p.evaluate(MEASURE), tag = name + ' ' + width + ' px · ' + view + ': ';
      report[name + ':' + view] = { refresh: m.refresh, views: { left: m.views.left, right: m.views.right, width: m.views.width }, create: m.create };
      const controls = { 'Actualizar': m.refresh, 'Nueva cotización': m.create, 'selector Tabla/Tablero': m.views, 'título': m.title, 'campo de búsqueda': m.search, 'botón Buscar': m.searchBtn, 'filtro de estado': m.state };
      for (const [what, c] of Object.entries(controls)) ck(!c.missing && c.inside && c.reachable && !c.textClipped, tag + what + ' dentro del viewport, alcanzable y sin recortar', { ...c, W: m.W });
      ck(m.views.tabs.length === 2 && m.views.tabs.every(t => t.within && t.height >= 40) && !m.views.groupClipped, tag + 'el selector Tabla/Tablero se ve completo (ambos botones dentro de su grupo, sin recorte, ≥ 40 px de alto)', m.views);
      ck(m.page <= m.W + 1 && !m.headingOverflow, tag + 'el documento y el encabezado no se desbordan horizontalmente', { page: m.page, W: m.W });
      if (view === 'tablero') {
        const clip = await p.evaluate(CLIPPING); ck(clip.length === 0, tag + 'ninguna tarjeta ni indicador tiene contenido esencial recortado', clip);
        const first = await p.evaluate('(() => { const r = document.querySelector(".hqp-column:first-child .hqp-card").getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth + 1 && r.width >= 200; })()');
        ck(first, tag + 'las tarjetas de la primera columna caben en el viewport y conservan un ancho legible');
        const g = await p.evaluate(KPI_GRID);
        ck(g.n === 4 && g.sameSize, tag + 'los cuatro indicadores existen y tienen el mismo ancho', g);
        if (width >= 1100) ck(g.cols === 4 && g.rows === 1, tag + 'escritorio: cuatro indicadores en una fila', g);
        else if (width >= 360) ck(g.cols === 2 && g.rows === 2, tag + 'cuadrícula 2×2 de indicadores', g);
        else ck(g.cols === 1 || (g.cols === 2 && g.rows === 2), tag + 'en un ancho muy estrecho: una columna (o 2×2 si cabe) sin sacrificar legibilidad', g);
        ck(g.amounts.length === 2 && g.amounts[0].top !== g.amounts[1].top, tag + 'las monedas del importe en curso se muestran separadas, una por línea', g.amounts);
        ck(g.valueFont >= 16 && g.labelFont >= 11, tag + 'tamaños legibles (valores ≥ 16 px, etiquetas ≥ 11 px)', { value: g.valueFont, label: g.labelFont });
        ck(g.gapToToolbar >= 12 && g.gapToToolbar <= 32, tag + 'separación equilibrada entre la barra de búsqueda y los indicadores (12–32 px)', g.gapToToolbar);
        await shot(p, 'tablero-' + name);
      } else await shot(p, 'tabla-' + name);
      await p.close();
    }
  }
  console.log('  MEDICIONES (px, borde izquierdo/derecho dentro de un viewport de W):');
  for (const [name, width] of VIEWPORTS) { const t = report[name + ':tablero']; console.log('   ' + String(width).padStart(4) + ' · Actualizar ' + t.refresh.left + '–' + t.refresh.right + ' · Nueva ' + t.create.left + '–' + t.create.right + ' · Tabla/Tablero ' + t.views.left + '–' + t.views.right); }

  k.finish('Cotizaciones › Tablero (Pipeline Kanban)');
})().catch(error => { console.error(error); process.exit(1); });
