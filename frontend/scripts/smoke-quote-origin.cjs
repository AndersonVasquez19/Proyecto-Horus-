// Mensajes ↔ Cotizaciones (D7) con API simulada: nada real. «Preparar cotización» desde el Centro de atención, precarga, retorno al origen,
// parámetro heredado ?contacto, vínculo contacto_id, y protección contra duplicados ante respuestas inciertas (sin reintento automático y con confirmación explícita; el POST envía `Idempotency-Key`, que el backend usa para no duplicar un reintento idéntico, pero este smoke usa un servidor simulado que no la aplica).
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

const sim = { post: 'ok', estado: '' };
let quotes = [], writes = [];
const messages = [3, 4].map(id => ({ id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654' + String(id).padStart(3, '0'), asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: 'nuevo', createdAt: '2026-05-0' + id + 'T10:00:00.000Z', updatedAt: '2026-05-0' + id + 'T10:00:00.000Z' }));
const makeQuote = body => ({ id: quotes.length + 1, numero: 'COT-' + String(quotes.length + 1).padStart(4, '0'), estado: sim.estado || 'borrador', revision: 1, subtotal: '100.00', impuesto: '18.00', total: '118.00', historial: [{ accion: 'creada', usuario: 1, fecha: new Date().toISOString() }], createdAt: new Date().toISOString(), ...body, conceptos: body.conceptos.map(c => ({ ...c, importe: c.cantidad * c.precio })) });

const handler = async (req, res, { route, url, json, body }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'clear') { quotes = []; writes = []; sim.post = 'ok'; sim.estado = ''; } else sim[key] = value; return json({ ok: true }) || true; }
  if (route === '/__state') return json({ writes, quotes }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (route === '/api/admin/me') return (token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({}, 401)) || true;
  const sub = route.replace('/api/admin/', ''); let m;
  if (req.method === 'POST' && sub === 'cotizaciones') {
    const data = await body(); writes.push({ route: sub, data, key: req.headers['idempotency-key'] });
    if (sim.post === 'bad') return json({ ok: false, message: 'Correo del cliente inválido.' }, 400) || true;
    if (sim.post === 'lost') { quotes.push(makeQuote(data)); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('respuesta ilegible'); return true; } // el servidor guarda, pero la respuesta es ilegible (sin cortar el socket: Edge puede repetir un POST cortado)
    if (sim.post === 'fail500') return json({ message: 'Internal server error ER_SECRET' }, 500) || true; // no guarda
    const quote = makeQuote(data); quotes.push(quote); return json({ ok: true, item: quote }) || true;
  }
  if (sub === 'cotizaciones') { const search = (url.searchParams.get('search') || '').toLowerCase(); const items = quotes.filter(q => !search || [q.numero, q.cliente, q.email].some(v => String(v).toLowerCase().includes(search))).map(({ conceptos, historial, ...rest }) => rest);
    return json({ ok: true, items, pagination: { total: items.length, pages: 1, page: 1 } }) || true; }
  if ((m = sub.match(/^cotizaciones\/(\d+)$/))) { const q = quotes.find(x => x.id === +m[1]); return (q ? json({ ok: true, item: q }) : json({ message: 'No encontrada' }, 404)) || true; }
  if (sub === 'messages') return json({ ok: true, messages, pagination: { total: 2, page: 1, limit: 20, pages: 1 }, metrics: { nuevo: 2, en_proceso: 0, atendido: 0, archivado: 0 } }) || true;
  if ((m = sub.match(/^messages\/(\d+)$/))) { const row = messages.find(x => x.id === +m[1]); return (row ? json({ ok: true, message: row }) : json({ ok: false, mensaje: 'Mensaje no encontrado.' }, 404)) || true; }
  if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/))) return json({ ok: true, item: { estado: 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] } }) || true;
  return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'cotiz', handler });
  const { ck, session } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + value);
  const state = () => fetch(k.origin + '/__state').then(r => r.json());
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const formReady = p => p.wait('document.querySelector("dialog.hp-dialog[open] form")', 'formulario de cotización');
  const fillMinimum = async p => { await p.label('Emisor de la propuesta', 'Horus Group'); await p.label('Descripción 1', 'Servicio de prueba'); await p.label('Precio', '100'); };
  const submit = p => p.evaluate('document.querySelector("dialog.hp-dialog[open] form").requestSubmit(); 1');
  const clienteValue = p => p.evaluate('[...document.querySelectorAll("dialog[open] label")].find(l => l.textContent.trim().startsWith("Cliente")).querySelector("input").value');
  const uncertain = p => p.evaluate('document.querySelector("[data-quote-uncertain]")?.dataset.quoteUncertain || ""');

  console.log('\n== APERTURA, PRECARGA Y CANCELACIÓN');
  await clean();
  { const p = await session('/admin/messages?estado=nuevo&id=3'); await p.wait('document.querySelector(".hw-inbox-detail form")', 'detalle');
    await p.click('.hw-inbox-detail a.hp-btn', 'Preparar cotización'); await formReady(p);
    ck((await p.path()) === '/admin/dashboard?section=cotizaciones&contacto=3', 'el enlace conserva el identificador de contacto de origen (parámetro heredado ?contacto=3)', await p.path());
    ck((await clienteValue(p)) === 'Persona 3', 'el formulario se precarga con los datos de la consulta #3 (cliente)');
    ck(await p.evaluate('[...document.querySelectorAll("dialog[open] label")].find(l => l.textContent.trim().startsWith("Correo")).querySelector("input").value') === 'p3@example.test', 'el correo se precarga');
    await p.click('dialog.hp-dialog[open] button', 'Cancelar'); await p.wait('document.querySelector(".hw-inbox-detail form")', 'regreso al Centro de atención');
    ck((await p.path()) === '/admin/messages?estado=nuevo&id=3', 'cancelar vuelve al Centro de atención con el mismo filtro y la misma consulta abierta', await p.path());
    ck((await state()).writes.length === 0, 'cancelar no envía nada'); await p.close(); }
  await clean();
  { const p = await session('/admin/dashboard?section=cotizaciones&contacto=3'); await formReady(p);
    ck((await clienteValue(p)) === 'Persona 3', 'acceso directo con ?contacto=3 (sin navegar desde la bandeja): se precarga igual');
    await p.click('dialog.hp-dialog[open] button', 'Cancelar'); await sleep(400);
    ck((await p.path()) === '/admin/dashboard?section=cotizaciones' && !(await p.evaluate('!!document.querySelector("dialog.hp-dialog[open]")')), 'sin origen conocido, cancelar se queda en Cotizaciones y retira ?contacto', await p.path()); await p.close(); }
  await clean();
  { const p = await session('/admin/dashboard?section=cotizaciones&contacto=999'); await p.wait('document.querySelector(".hp-error[role=alert]")', 'error de consulta inexistente');
    ck(!(await p.evaluate('!!document.querySelector("dialog.hp-dialog[open]")')), 'una consulta de origen inexistente no abre un formulario con datos inventados'); await p.close(); }

  console.log('\n== GUARDADO, VÍNCULO Y DOBLE ENVÍO');
  await clean();
  { const p = await session('/admin/dashboard?section=cotizaciones&contacto=3'); await formReady(p); await fillMinimum(p);
    await p.evaluate('const f = document.querySelector("dialog.hp-dialog[open] form"); f.requestSubmit(); f.requestSubmit(); 1');
    await p.wait('document.body.innerText.includes("Borrador guardado")', 'guardado'); await sleep(300);
    const s = await state();
    ck(s.writes.length === 1 && s.writes[0].data.contacto_id === 3, 'un doble envío rápido produce un único POST y conserva contacto_id=3', s.writes.map(w => w.data.contacto_id));
    ck(!(await p.path()).includes('contacto='), 'tras guardar se retira ?contacto de la URL', await p.path());
    await p.click('.hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog.hp-dialog[open] a[href*=\\"/admin/messages?id=3\\"]")', 'vínculo a la consulta de origen');
    ck(true, 'el detalle de la cotización enlaza con la consulta de origen (#3) por su identificador, no por nombre ni correo'); await p.close(); }
  { const p = await session('/admin/dashboard?section=cotizaciones&contacto=3'); await formReady(p); await p.wait('document.querySelector("[data-quote-related]")', 'aviso de cotización existente');
    ck(/COT-0001/.test(await p.text('[data-quote-related]')), 'si la consulta ya tiene una cotización, se avisa (por contacto_id) para evitar duplicados accidentales'); await p.close(); }
  await clean();
  { const p = await session('/admin/dashboard?section=cotizaciones&contacto=4'); await formReady(p); await p.wait('true', 'x'); await sleep(500);
    ck(!(await p.evaluate('!!document.querySelector("[data-quote-related]")')), 'una consulta sin cotizaciones no muestra el aviso'); await p.close(); }

  console.log('\n== ERROR DEFINITIVO (4xx) Y RESULTADO INCIERTO');
  await clean();
  { await ctl('post', 'bad'); const p = await session('/admin/dashboard?section=cotizaciones&contacto=3'); await formReady(p); await fillMinimum(p); await submit(p);
    await p.wait('document.querySelector("dialog.hp-dialog[open] .hp-error[role=alert]")', 'error 400');
    ck(!(await uncertain(p)) && /Correo del cliente inválido/.test(await p.text('dialog.hp-dialog[open] .hp-error')), 'un 400 es un fallo definitivo: se muestra el motivo y se puede corregir y reintentar');
    await ctl('post', 'ok'); await submit(p); await p.wait('document.body.innerText.includes("Borrador guardado")', 'guardado tras corregir');
    ck((await state()).writes.length === 2, 'tras un 400 el reintento es un nuevo POST (el primero no se aplicó)'); await p.close(); }
  await clean();
  { await ctl('post', 'lost'); const p = await session('/admin/dashboard?section=cotizaciones&contacto=3'); await formReady(p); await fillMinimum(p); await submit(p);
    await p.wait('document.querySelector("[data-quote-uncertain]")', 'resultado incierto');
    const draft = await p.evaluate('[...document.querySelectorAll("dialog[open] label")].find(l => l.textContent.trim().startsWith("Descripción 1")).querySelector("input").value');
    ck(draft === 'Servicio de prueba' && (await state()).writes.length === 1, 'respuesta perdida: se avisa del resultado incierto, el borrador se conserva y hay un solo POST');
    await submit(p); await sleep(400);
    ck((await uncertain(p)) === 'confirming' && (await state()).writes.length === 1, 'volver a guardar NO repite el POST: pide confirmación explícita con advertencia de duplicado', await uncertain(p));
    await p.click('dialog.hp-dialog[open] button', 'Volver'); await sleep(200);
    ck((await uncertain(p)) === 'uncertain' && (await state()).writes.length === 1, '«Volver» regresa al estado incierto sin enviar nada');
    await p.click('dialog.hp-dialog[open] button', 'Comprobar en la lista'); await p.wait('document.querySelector("[data-quote-matches]")', 'coincidencias');
    ck(/COT-0001/.test(await p.text('[data-quote-matches]')), 'la comprobación encuentra la cotización que el servidor sí guardó (por cliente y contacto_id, tras el intento)');
    await p.click('dialog.hp-dialog[open] button', 'Ya se guardó'); await sleep(500);
    ck(!(await p.evaluate('!!document.querySelector("dialog.hp-dialog[open]")')) && (await state()).writes.length === 1, '«Ya se guardó» cierra el formulario y actualiza la lista, sin un segundo POST'); await p.close(); }
  await clean();
  { await ctl('post', 'fail500'); const p = await session('/admin/dashboard?section=cotizaciones&contacto=3'); await formReady(p); await fillMinimum(p); await submit(p);
    await p.wait('document.querySelector("[data-quote-uncertain]")', 'incierto por 500');
    ck(!/ER_SECRET|Internal/.test(await p.text('dialog.hp-dialog[open]')), 'un 500 se trata como incierto y no muestra texto técnico del servidor');
    await p.click('dialog.hp-dialog[open] button', 'Comprobar en la lista'); await p.wait('document.querySelector("dialog.hp-dialog[open] [data-quote-uncertain]")?.innerText.includes("No encontramos")', 'sin coincidencias');
    ck(true, 'si no hay coincidencias se dice que eso no garantiza que no se haya creado');
    await ctl('post', 'ok'); await submit(p); await p.wait('document.querySelector("[data-quote-uncertain=confirming]")', 'confirmación'); await p.click('dialog.hp-dialog[open] button', 'Guardar de todos modos');
    await p.wait('document.body.innerText.includes("Borrador guardado")', 'guardado confirmado');
    const s = await state(); ck(s.writes.length === 2 && s.quotes.length === 1, 'solo con la confirmación explícita se envía el segundo POST', { writes: s.writes.length, quotes: s.quotes.length });
    ck(!!s.writes[0].key && s.writes[0].key === s.writes[1].key, 'el reintento idéntico reutiliza la misma Idempotency-Key (el backend no duplica)', s.writes.map(w => typeof w.key)); await p.close(); }

  console.log('\n== SOLO LECTURA (cotización ya enviada)');
  await clean();
  { await ctl('estado', 'enviada'); const p = await session('/admin/dashboard?section=cotizaciones&contacto=3'); await formReady(p); await fillMinimum(p); await submit(p);
    await p.wait('document.body.innerText.includes("Borrador guardado")', 'guardado'); await p.click('.hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog.hp-dialog[open]")', 'detalle');
    await p.click('dialog.hp-dialog[open] button', 'Ver datos del formulario'); await formReady(p);
    const info = await p.evaluate('({ title: document.querySelector("dialog[open] h2").textContent, disabled: [...document.querySelectorAll("dialog[open] form input, dialog[open] form textarea, dialog[open] form select")].every(x => x.matches(":disabled")), save: [...document.querySelectorAll("dialog[open] button")].some(b => /Guardar/.test(b.textContent)) })');
    ck(info.title === 'Datos de la cotización' && info.disabled && !info.save, 'una cotización no borrador se abre en modo solo lectura: campos deshabilitados y sin botón de guardar', info);
    await p.click('dialog.hp-dialog[open] button', 'Cerrar'); await sleep(300);
    ck(/Detalle de cotización/.test(await p.text('dialog.hp-dialog[open]')) && (await state()).writes.length === 1, 'cerrar la vista de solo lectura vuelve al detalle sin enviar nada'); await p.close(); }

  k.finish('Mensajes ↔ Cotizaciones (D7)');
})().catch(error => { console.error(error); process.exit(1); });
