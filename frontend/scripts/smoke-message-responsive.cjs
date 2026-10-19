// Centro de atención (D6.4): responsive y accesibilidad, con API simulada. Escritorio 1280 px y móvil 390 px.
// Comprueba lista → detalle en móvil, foco al abrir/volver, regiones en vivo, tabla accesible y que el borrador del seguimiento no se pierde.
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

const messages = Array.from({ length: 8 }, (_, i) => { const id = 8 - i; return { id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654' + String(id).padStart(3, '0'), asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: id % 2 ? 'nuevo' : 'en_proceso', createdAt: '2026-05-0' + id + 'T10:00:00.000Z', updatedAt: '2026-05-0' + id + 'T10:00:00.000Z' }; });
const writes = [];
const handler = async (req, res, { route, json, body }) => {
  if (route === '/__state') return json({ writes }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (route === '/api/admin/me') return (token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({}, 401)) || true;
  const sub = route.replace('/api/admin/', ''); let m;
  if (req.method !== 'GET') { writes.push(req.method + ' ' + sub); await body(); return json({ ok: true, item: {} }) || true; }
  if (sub === 'messages') return json({ ok: true, messages, pagination: { total: 8, page: 1, limit: 20, pages: 1 }, metrics: { nuevo: 4, en_proceso: 4, atendido: 0, archivado: 0 } }) || true;
  if ((m = sub.match(/^messages\/(\d+)$/))) return json({ ok: true, message: messages.find(x => x.id === +m[1]) }) || true;
  if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/))) return json({ ok: true, item: { estado: 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] } }) || true;
  return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'responsive', handler });
  const { ck, session } = k;
  const visible = (p, selector) => p.evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; })()');
  const activeInfo = p => p.evaluate('({ tag: document.activeElement?.tagName, text: (document.activeElement?.textContent || "").slice(0, 40), rowId: document.activeElement?.getAttribute("data-row-id") })');
  const listReady = p => p.wait('document.querySelectorAll(".hw-inbox-list [data-row-id]").length === 8', 'lista de consultas');
  const noHorizontalScroll = p => p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1');

  console.log('\n== MÓVIL 390 px: LISTA → DETALLE');
  { const p = await session('/admin/messages', 390); await listReady(p);
    ck(await visible(p, '.hw-inbox-list') && !(await visible(p, '.hw-inbox-detail')), 'sin consulta abierta se ve la lista y el detalle vacío no ocupa pantalla');
    ck(await noHorizontalScroll(p), 'sin desplazamiento horizontal de la página en 390 px');
    const columns = await p.evaluate('getComputedStyle(document.querySelector(".hw-insights")).gridTemplateColumns.split(" ").length');
    ck(columns === 2, 'los cuatro indicadores se muestran en 2×2 (no en una columna de tarjetas altas)', columns);
    await p.evaluate('document.querySelector("[data-row-id=\\"3\\"]").focus(); document.querySelector("[data-row-id=\\"3\\"]").click(); 1');
    await p.wait('document.querySelector(".hw-inbox-detail form")', 'detalle');
    ck(!(await visible(p, '.hw-inbox-list')) && await visible(p, '.hw-inbox-detail'), 'al abrir una consulta se ve solo el detalle');
    ck(await visible(p, '.hw-back') && /Volver a la lista/.test(await p.text('.hw-back')), 'aparece «Volver a la lista»');
    await sleep(150); const focus = await activeInfo(p);
    ck(focus.tag === 'H2' && /Asunto 3/.test(focus.text), 'el foco pasa al encabezado del detalle', focus);
    ck(await p.evaluate('document.querySelector(".hw-inbox").classList.contains("has-detail")') && (await p.path()) === '/admin/messages?id=3', 'la URL conserva ?id= (Atrás/Adelante siguen funcionando)');
    await p.type('.hw-inbox-detail form textarea', 0, 'Borrador de prueba móvil'); await sleep(150);
    await p.click('.hw-back', ''); await p.wait('document.querySelector("dialog.hp-unsaved-dialog[open]")', 'aviso de cambios sin guardar');
    ck(await p.evaluate('document.querySelector(".hw-inbox-detail form textarea").value') === 'Borrador de prueba móvil', 'volver con un borrador pide confirmar y no pierde lo escrito');
    await p.evaluate('document.querySelector("dialog.hp-unsaved-dialog[open] button").click(); 1'); await sleep(250);
    ck(!(await visible(p, '.hw-inbox-list')) && (await p.path()) === '/admin/messages?id=3', '«Seguir editando» conserva el detalle y la URL');
    await p.evaluate('document.querySelector(".hw-inbox-detail form textarea").value; 1'); await p.type('.hw-inbox-detail form textarea', 0, '');
    await sleep(150); await p.click('.hw-back', ''); await p.wait('!document.querySelector("dialog.hp-unsaved-dialog[open]") && document.querySelector(".hw-inbox-list [data-row-id]")', 'regreso a la lista');
    await p.wait('(document.querySelector(".hw-inbox-list") || {}).getClientRects().length > 0', 'lista visible'); await sleep(150);
    const back = await activeInfo(p);
    ck((await p.path()) === '/admin/messages' && back.rowId === '3', 'al volver, la lista reaparece y el foco regresa a la fila de la consulta', { url: await p.path(), back });
    ck((await k.sleep(0), (await fetch(k.origin + '/__state').then(r => r.json())).writes.length) === 0, 'ninguna escritura al navegar (el borrador no se guarda sin que se pida)');
    await p.close(); }

  console.log('\n== MÓVIL: DETALLE POR URL Y VISTA TABLA');
  { const p = await session('/admin/messages?id=5', 390); await p.wait('document.querySelector(".hw-inbox-detail form")', 'detalle directo');
    ck(await visible(p, '.hw-inbox-detail') && !(await visible(p, '.hw-inbox-list')), '?id= directo abre el detalle en móvil con «Volver a la lista»');
    await p.click('.hw-back', ''); await p.wait('document.querySelectorAll(".hw-inbox-list [data-row-id]").length === 8', 'lista');
    await p.click('.hw-tabs button', 'Tabla'); await p.wait('document.querySelector(".hw-inbox-table tbody tr")', 'tabla');
    ck(await noHorizontalScroll(p), 'la vista Tabla no desborda en 390 px');
    await p.evaluate('document.querySelector(".hw-inbox-table [data-row-id=\\"4\\"]").click(); 1'); await p.wait('document.querySelector(".hw-inbox-detail form")', 'detalle desde la tabla');
    ck(!(await visible(p, '.hw-inbox-table')) && await visible(p, '.hw-inbox-detail'), 'desde la vista Tabla también se alterna tabla → detalle');
    await p.click('.hw-back', ''); await p.wait('document.querySelector(".hw-inbox-table")?.getClientRects().length > 0', 'tabla visible'); await sleep(150);
    ck((await activeInfo(p)).rowId === '4', 'volver desde el detalle devuelve el foco al botón de la fila de la tabla'); await p.close(); }

  console.log('\n== ESCRITORIO 1280 px');
  { const p = await session('/admin/messages', 1280); await listReady(p);
    ck(await visible(p, '.hw-inbox-list') && await visible(p, '.hw-inbox-detail'), 'lista y detalle conviven a la vez');
    const columns = await p.evaluate('getComputedStyle(document.querySelector(".hw-insights")).gridTemplateColumns.split(" ").length');
    ck(columns === 4, 'los cuatro indicadores caben en una fila', columns);
    await p.evaluate('document.querySelector("[data-row-id=\\"2\\"]").focus(); document.querySelector("[data-row-id=\\"2\\"]").click(); 1'); await p.wait('document.querySelector(".hw-inbox-detail form")', 'detalle');
    await sleep(200);
    ck(!(await visible(p, '.hw-back')), 'en escritorio no se muestra «Volver a la lista»');
    ck((await activeInfo(p)).rowId === '2', 'en escritorio el foco se queda en la fila seleccionada (no se roba)', await activeInfo(p));
    ck(/Consulta #2 abierta: Asunto 2/.test(await p.evaluate('document.querySelector(".hp-sr[role=status]:not(:empty)")?.textContent || ""')), 'una región role=status anuncia la consulta abierta');
    ck(await p.evaluate('document.querySelector(".hw-inbox-list [data-row-id=\\"2\\"]").getAttribute("aria-pressed") === "true"'), 'la fila abierta lo expone con aria-pressed');
    ck(await p.evaluate('document.querySelector(".hp-card-heading p[role=status]")?.textContent.includes("8 consultas")'), 'el total de resultados es una región role=status');
    await p.click('.hw-tabs button', 'Tabla'); await p.wait('document.querySelector(".hw-inbox-table tbody tr")', 'tabla');
    ck(await p.evaluate('document.querySelector(".hw-inbox-table caption")?.textContent.length > 20 && document.querySelectorAll(".hw-inbox-table th[scope=col]").length >= 4'), 'la tabla tiene caption y cabeceras de columna con scope');
    ck(await p.evaluate('document.querySelectorAll(".hw-inbox-table tbody td[role=rowheader]").length === 8'), 'cada fila tiene su celda de encabezado de fila (asunto)');
    ck(await p.evaluate('[...document.querySelectorAll(".hw-inbox-table tbody button")].every(b => /^(Abrir consulta|Consulta abierta): /.test(b.getAttribute("aria-label")))'), 'los botones de la tabla tienen nombre accesible con asunto y persona');
    ck(await p.evaluate('document.querySelectorAll(".hw-inbox-detail form textarea").length >= 1 && document.querySelector(".hw-inbox-detail").getAttribute("aria-busy") === "false"'), 'el detalle mantiene el editor y declara aria-busy=false cuando no hay guardado pendiente');
    ck(await noHorizontalScroll(p), 'sin desplazamiento horizontal en 1280 px'); await p.close(); }

  k.finish('Centro de atención responsive y accesible (D6.4)');
})().catch(error => { console.error(error); process.exit(1); });
