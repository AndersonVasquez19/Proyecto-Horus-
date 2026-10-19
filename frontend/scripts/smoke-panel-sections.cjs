// Secciones del panel y formularios públicos con API simulada: nada real (ni datos, ni sesiones, ni correo). Edge por DevTools.
// Cubre: indicadores del resumen y su error, Centro de Atención ante errores 500/formato inesperado (conservando filtros e ?id=),
// retiro de Suscripciones y Reclamaciones del panel (menú, tarjetas y rutas directas) y los canales públicos que se conservan.
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

const sim = { stats: 'ok', list: 'ok', libro: 'ok', unsub: 'ok', activity: 'ok' };
const requests = [];
const zero = { total: 0, publicados: 0, borradores: 0, archivados: 0 };
const catalogo = { cursos: { total: 4, publicados: 3, borradores: 1, archivados: 0, por_tipo: { curso: { total: 3, publicados: 2, borradores: 1, archivados: 0 }, capacitacion: { total: 1, publicados: 1, borradores: 0, archivados: 0 } } }, servicios: { ...zero, total: 5, publicados: 5 }, 'preguntas-frecuentes': { ...zero, total: 2, publicados: 2 } };
const messages = Array.from({ length: 6 }, (_, i) => { const id = 6 - i; return { id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654' + String(id).padStart(3, '0'), asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: id % 2 ? 'nuevo' : 'en_proceso', createdAt: '2026-05-0' + id + 'T10:00:00.000Z', updatedAt: '2026-05-0' + id + 'T10:00:00.000Z' }; });
// Serie ficticia terminada hoy (UTC): día i → i % 4 mensajes, la mitad (redondeo hacia abajo) del chatbot.
const activity = dias => { const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const mensajes = Array.from({ length: dias }, (_, i) => { const total = i % 4; return { fecha: new Date(today - (dias - 1 - i) * 86400000).toISOString().slice(0, 10), total, chatbot: Math.floor(total / 2) }; });
  return { ok: true, dias, desde: mensajes[0].fecha, hasta: mensajes[dias - 1].fecha, mensajes, cotizaciones: { total: 4, porEstado: { borrador: 1, enviada: 2, aceptada: 1, rechazada: 0, anulada: 0 } } }; };
const attention = id => ({ ok: true, item: { estado: messages.find(m => m.id === id)?.estado || 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] } });

const handler = async (req, res, { route, url, json, body }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'clear') { requests.length = 0; Object.assign(sim, { stats: 'ok', list: 'ok', libro: 'ok', unsub: 'ok', activity: 'ok' }); } else sim[key] = value; return json({ ok: true }) || true; }
  if (route === '/__state') return json({ requests }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (req.method !== 'GET' || route.startsWith('/api/admin/')) requests.push(req.method + ' ' + route + url.search);
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  // Canales públicos que se conservan
  if (route === '/api/reclamaciones' && req.method === 'POST') { await body(); return (sim.libro === 'error' ? json({ ok: false, mensaje: 'ER_SECRET fallo interno' }, 500) : json({ ok: true, correo_enviado: true, numero_reclamo: 'HG-20260101-TEST', id: 1 })) || true; }
  if (route === '/api/newsletter/unsubscribe' && req.method === 'POST') { await body(); return (sim.unsub === 'error' ? json({ message: 'ER_SECRET' }, 500) : json({ ok: true })) || true; }
  if (!route.startsWith('/api/admin/')) return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1, limit: 12 } }) || true;
  if (route === '/api/admin/me') return (token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({ message: 'Unauthorized' }, 401)) || true;
  if (token !== TOKEN) return json({ message: 'Unauthorized' }, 401) || true;
  const sub = route.slice('/api/admin/'.length); let m;
  if (sub === 'stats/actividad') return (sim.activity === 'error' ? json({ message: 'Internal server error ER_SECRET' }, 500) : sim.activity === 'malformed' ? json({ ok: true, items: [] }) : json(activity(+url.searchParams.get('dias') || 30))) || true;
  if (sub === 'stats' && sim.stats === 'malformed') return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 } }) || true;
  if (sub === 'stats') return (sim.stats === 'error' ? json({ message: 'Internal server error ER_SECRET' }, 500) : json({ ok: true, stats: { catalogo, mensajes: { total: 6, nuevos: 3, enProceso: 3, atendidos: 0, archivados: 0 }, reclamaciones: { total: 9 }, contenido: { total: 0 }, administradores: { total: 1 } }, actividadReciente: { mensajes: messages.slice(0, 2).map(x => ({ id: x.id, nombre: x.nombre, asunto: x.asunto, estado: x.estado, createdAt: x.createdAt })), reclamaciones: [] } })) || true;
  if (sub === 'messages') {
    if (sim.list === 'error') return json({ message: 'Internal server error ER_SECRET' }, 500) || true;
    if (sim.list === 'malformed') return json({ ok: true, pagination: { total: 6, page: 1, limit: 20, pages: 1 }, metrics: {} }) || true;
    const estado = url.searchParams.get('estado'); const rows = messages.filter(x => !estado || x.estado === estado);
    return json({ ok: true, messages: rows, pagination: { total: rows.length, page: 1, limit: 20, pages: 1 }, metrics: { nuevo: 3, en_proceso: 3, atendido: 0, archivado: 0 } }) || true;
  }
  if ((m = sub.match(/^messages\/(\d+)$/))) { const row = messages.find(x => x.id === +m[1]); return (row ? json({ ok: true, message: row }) : json({ ok: false, mensaje: 'Mensaje no encontrado.' }, 404)) || true; }
  if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/))) return json(attention(+m[1])) || true;
  if (sub === 'cotizaciones') return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1, limit: 12 } }) || true;
  return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1, limit: 20 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'secciones', handler });
  const { ck, session, open } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + value);
  const state = () => fetch(k.origin + '/__state').then(r => r.json());
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const metricValues = p => p.evaluate('[...document.querySelectorAll(".hp-metrics article")].map(a => a.querySelector("strong").textContent)');
  const navLabels = p => p.evaluate('[...document.querySelectorAll("aside nav .hp-nav-item")].map(b => b.textContent.trim())');

  console.log('\n== RESUMEN: INDICADORES');
  await clean();
  { const p = await session('/admin/dashboard'); await p.wait('document.querySelector(".hp-metrics article strong") && document.querySelector(".hp-metrics article strong").textContent !== "…" && document.querySelector(".hw-work")', 'indicadores cargados');
    const values = await metricValues(p);
    ck(values.join() === '11,10,3,1', 'los indicadores muestran las cifras reales de la API (catálogo 11, publicados 10, mensajes nuevos 3, borradores 1)', values);
    ck(!(await p.evaluate('!!document.querySelector(".hp-error")')), 'sin aviso de error cuando la API responde');
    ck(await p.evaluate('!!document.querySelector(".hw-work")'), 'se muestra «Tu trabajo pendiente»');
    const labels = await navLabels(p);
    ck(!labels.some(l => /Suscripciones|Reclamaciones/.test(l)) && labels.includes('Mensajes') && labels.includes('Cotizaciones'), 'el menú ya no tiene Suscripciones ni Reclamaciones y conserva Mensajes y Cotizaciones', labels);
    const links = await p.evaluate('[...document.querySelectorAll(".hw-work a, .hp-main a")].map(a => a.getAttribute("href"))');
    ck(!links.some(h => /reclamaciones|newsletter/.test(h || '')) && !/reclamaciones registradas|Consultar suscripciones/.test(await p.text('main')), 'el resumen no enlaza ni menciona los módulos retirados', links);
    ck(links.some(h => /\/admin\/messages\?estado=nuevo/.test(h || '')), 'las tarjetas del Centro de Atención siguen enlazadas'); await p.close(); }

  console.log('\n== RESUMEN: ERROR DE ESTADÍSTICAS');
  await clean();
  { await ctl('stats', 'error'); const p = await session('/admin/dashboard'); await p.wait('document.querySelector(".hp-error[role=alert]")', 'aviso de error');
    const values = await metricValues(p); const text = await p.text('main');
    ck(values.every(v => v === '—'), 'con la API en error los indicadores muestran «—», no cero', values);
    ck(/Los indicadores no están disponibles/.test(text) && !/ER_SECRET/.test(text), 'aviso claro en español sin texto técnico del backend', text.slice(0, 160));
    ck(!(await p.evaluate('!!document.querySelector(".hw-work")')) && /No se pudo consultar la actividad/.test(text), 'no se presentan tarjetas de trabajo ni actividad inventadas');
    await ctl('stats', 'ok'); await p.click('.hp-heading .hp-btn', 'Actualizar'); await p.wait('!document.querySelector(".hp-error") && document.querySelector(".hp-metrics article strong")?.textContent === "11"', 'recuperación');
    ck(true, '«Actualizar resumen» se recupera del error'); await p.close(); }

  console.log('\n== RESUMEN: RESPUESTA DE ESTADÍSTICAS CON FORMA INESPERADA');
  await clean();
  { await ctl('stats', 'malformed'); const p = await session('/admin/dashboard'); await p.wait('document.querySelector(".hp-error[role=alert]")', 'aviso de error');
    const text = await p.text('main'); const values = await metricValues(p);
    ck(!/No pudimos abrir esta página/.test(await p.text()) && /formato inesperado/.test(text), 'un cuerpo con forma inesperada no rompe la página: se muestra el aviso de indicadores no disponibles', text.slice(0, 160));
    ck(values.every(v => v === '—') && !(await p.evaluate('!!document.querySelector(".hw-work")')), 'los indicadores muestran «—» (no ceros inventados) y no hay tarjetas de trabajo'); await p.close(); }

  console.log('\n== RESUMEN: GRÁFICO DE ACTIVIDAD');
  await clean();
  { const p = await session('/admin/dashboard'); await p.wait('document.querySelectorAll(".hp-chart title").length === 30', 'gráfico de 30 días');
    const expected = Array.from({ length: 30 }, (_, i) => i % 4).reduce((a, b) => a + b, 0);
    const summary = await p.evaluate('document.querySelector(".hp-chart-summary strong").textContent');
    ck(+summary === expected, 'el total del gráfico coincide con la suma de la serie de la API (' + expected + ')', summary);
    ck(await p.evaluate('document.querySelector(".hp-chart").getAttribute("role") === "img" && !!document.getElementById(document.querySelector(".hp-chart").getAttribute("aria-labelledby"))?.textContent.includes("mensajes")'), 'el gráfico tiene nombre accesible con un resumen en texto');
    ck(await p.evaluate('document.querySelectorAll(".hp-chart-data tbody tr").length === 30 && document.querySelector(".hp-chart-data").open === false'), 'los mismos datos están disponibles en una tabla plegada');
    ck(await p.evaluate('[...document.querySelectorAll(".hp-quotes-chart li")].map(li => li.querySelector("strong").textContent).join() === "1,2,1,0,0"'), 'cotizaciones por estado muestran los conteos de la API');
    await p.click('.hp-activity-card .hw-tabs button', '7 días'); await p.wait('document.querySelectorAll(".hp-chart title").length === 7 && document.querySelector(".hp-activity-card .hw-tabs button[aria-pressed=true]").textContent.startsWith("7")', 'cambio a 7 días');
    ck(true, 'el selector de periodo vuelve a consultar y dibuja 7 días'); await p.close(); }
  await clean();
  { await ctl('activity', 'error'); const p = await session('/admin/dashboard'); await p.wait('document.querySelector(".hp-activity-card [role=alert]")', 'error de actividad'); const text = await p.text('.hp-activity-card'); const values = await metricValues(p);
    ck(!/ER_SECRET/.test(text) && /No se pudo cargar la actividad/.test(text) && !(await p.evaluate('!!document.querySelector(".hp-chart")')), 'si falla la actividad se avisa sin texto técnico y no se dibuja un gráfico inventado', text.slice(0, 160));
    ck(values.join() === '11,10,3,1', 'los indicadores del resumen siguen disponibles aunque falle el gráfico', values);
    await ctl('activity', 'ok'); await p.click('.hp-activity-card [role=alert] .hp-btn', 'Reintentar'); await p.wait('document.querySelectorAll(".hp-chart title").length === 30', 'recuperación'); ck(true, '«Reintentar» recupera el gráfico'); await p.close(); }
  await clean();
  { await ctl('activity', 'malformed'); const p = await session('/admin/dashboard'); await p.wait('document.querySelector(".hp-activity-card [role=alert]")', 'formato inesperado');
    ck(/formato inesperado/.test(await p.text('.hp-activity-card')) && !(await p.evaluate('!!document.querySelector(".hp-chart")')), 'una respuesta con forma inesperada no se dibuja como «sin actividad»'); await p.close(); }

  console.log('\n== SECCIONES RETIRADAS: RUTAS DIRECTAS');
  await clean();
  for (const section of ['reclamaciones', 'newsletter']) {
    const p = await session('/admin/dashboard?section=' + section); await p.wait('document.querySelector(".hp-metrics")', 'resumen en la ruta retirada ' + section);
    await sleep(500);
    const text = await p.text('main'); const url = await p.path(); const s = await state();
    ck(/VISTA GENERAL/.test(text) && !(await p.evaluate('!!document.querySelector(".hp-table")')), '?section=' + section + ' abre el Resumen (sección inexistente), sin pantalla oculta', text.slice(0, 100));
    ck(url === '/admin/dashboard?section=' + section, '?section=' + section + ' no provoca redirecciones ni bucles', url);
    ck(!s.requests.some(r => /reclamaciones|newsletter|subscribers/.test(r)), '?section=' + section + ' no consulta los endpoints administrativos del módulo retirado', s.requests);
    await p.close(); await clean(); }

  console.log('\n== CENTRO DE ATENCIÓN');
  await clean();
  { const p = await session('/admin/messages?estado=nuevo&id=3'); await p.wait('document.querySelectorAll(".hw-inbox-list button").length > 0', 'lista');
    ck(await p.evaluate('document.querySelectorAll(".hw-inbox-list button").length === 3') && (await p.text('.hw-inbox-detail .hw-detail-heading small')) === 'Consulta #3', 'listado filtrado por estado y detalle ?id=3 cargados');
    await ctl('list', 'error'); await p.click('.hp-heading .hp-btn', 'Actualizar'); await p.wait('document.querySelector(".hw-inbox-list .hp-empty")?.innerText.includes("No se pudo consultar la bandeja")', 'error del listado');
    const text = await p.text('.hw-inbox-list');
    ck(!/ER_SECRET|Internal/.test(text) && !/No hay consultas/.test(text), 'error 500 del listado: aviso propio, ni texto técnico ni falso «sin consultas»', text.slice(0, 140));
    ck((await p.path()) === '/admin/messages?estado=nuevo&id=3' && (await p.text('.hw-inbox-detail .hw-detail-heading small')) === 'Consulta #3', 'el error conserva el filtro y el ?id= (el detalle sigue abierto)');
    await ctl('list', 'malformed'); await p.click('.hp-heading .hp-btn', 'Actualizar'); await p.wait('document.querySelector(".hw-inbox-list .hp-empty")?.innerText.includes("formato inesperado") || document.querySelector(".hw-inbox-list .hp-empty")?.innerText.includes("No se pudo consultar")', 'formato inesperado');
    ck(!/No hay consultas/.test(await p.text('.hw-inbox-list')), 'respuesta paginada malformada: se trata como error, no como lista vacía');
    await ctl('list', 'ok'); await p.evaluate('document.querySelector(".hw-inbox-list .hp-empty button")?.click(); 1'); await p.wait('document.querySelectorAll(".hw-inbox-list button").length === 3', 'recuperación');
    ck((await p.path()) === '/admin/messages?estado=nuevo&id=3', 'tras reintentar vuelve el listado con la misma URL (filtro e id)'); await p.close(); }

  console.log('\n== COTIZACIONES INTACTAS');
  await clean();
  { const p = await session('/admin/dashboard?section=cotizaciones'); await p.wait('document.querySelector("h1")?.textContent === "Cotizaciones"', 'cotizaciones');
    ck(/Nueva cotización|Cotizaci/.test(await p.text('main')), 'la sección Cotizaciones sigue disponible'); await p.close(); }

  console.log('\n== CANALES PÚBLICOS CONSERVADOS (API simulada)');
  await clean();
  { const p = await open(1280); await p.go('/libro-reclamaciones', 'document.querySelector("form.lb-form")');
    const fill = async () => {
      await p.type('#lb-nombres', 0, 'Ana'); await p.type('#lb-apellidos', 0, 'Prueba'); await p.type('#lb-tipoDoc', 0, 'dni'); await p.type('#lb-numDoc', 0, '12345678');
      await p.type('#lb-email', 0, 'ana@example.test'); await p.type('#lb-telefono', 0, '987654321'); await p.click('#lb-tipoRegistro-reclamo', ''); await p.type('#lb-area', 0, 'soporte');
      await p.type('#lb-fechaIncidente', 0, '2026-01-10'); await p.type('#lb-descripcionBien', 0, 'Servicio de prueba'); await p.type('#lb-detalleReclamo', 0, 'Detalle de prueba');
      await p.click('#lb-aceptaTerminos', ''); };
    await fill(); await ctl('libro', 'error');
    await p.evaluate('document.querySelector("form.lb-form").requestSubmit(); 1'); await p.wait('document.querySelector(".lb-alert")', 'error del formulario');
    const alert = await p.text('.lb-alert');
    ck(!/ER_SECRET/.test(alert) && (await p.evaluate('document.querySelector("#lb-nombres").value')) === 'Ana', 'Libro de Reclamaciones: un error 500 muestra un aviso sin texto técnico y conserva lo escrito', alert);
    await ctl('libro', 'ok'); await p.evaluate('document.querySelector("form.lb-form").requestSubmit(); 1'); await p.wait('document.querySelector(".lb-result")', 'constancia');
    const posts = (await state()).requests.filter(r => r === 'POST /api/reclamaciones');
    ck(/HG-20260101-TEST/.test(await p.text('.lb-result')) && posts.length === 2, 'Libro de Reclamaciones: el alta pública sigue funcionando (POST simulado, número mostrado)', posts); await p.close(); }
  await clean();
  { const p = await open(1280); await p.go('/newsletter/baja?token=abc.def', 'document.querySelector("h1")');
    await ctl('unsub', 'error'); await p.click('button', 'Dar de baja'); await p.wait('document.querySelector("[role=alert]")', 'error de la baja');
    ck(!/ER_SECRET/.test(await p.text('main')) && !/Tu suscripción fue cancelada/.test(await p.text('main')), 'Baja de suscripción: un 500 no se presenta como éxito ni muestra texto técnico');
    await ctl('unsub', 'ok'); await p.click('button', 'Dar de baja'); await p.wait('document.body.innerText.includes("Tu suscripción fue cancelada")', 'baja confirmada');
    ck((await state()).requests.filter(r => r === 'POST /api/newsletter/unsubscribe').length === 2, 'Baja de suscripción: el endpoint público sigue funcionando (un POST por intento)'); await p.close(); }

  k.finish('Secciones del panel y canales públicos');
})().catch(error => { console.error(error); process.exit(1); });
