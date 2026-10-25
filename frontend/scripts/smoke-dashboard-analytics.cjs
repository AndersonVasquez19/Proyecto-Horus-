// Resumen analítico (Fase 2A) con API simulada: nada real (ni MySQL, ni correo, ni sesiones). Edge por DevTools con perfil temporal horus-*.
// Cubre: indicadores y preinscripciones (distribución por estado, bloque null/ausente/incoherente/vacío), origen de las consultas, métricas del
// chatbot (petición con limit=1 solo con permiso), cotizaciones, estadísticas vacías sin cifras inventadas, fallos parciales independientes,
// permisos insuficientes (sin permiso no hay tarjeta ni petición), actualizar el resumen, teclado, movimiento reducido y responsive a 390, 820 y 1280 px.
const fs = require('node:fs'), path = require('node:path');
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');
const permissionSource = fs.readFileSync(path.join(__dirname, '../../backend/src/permissions/permissions.ts'), 'utf8');
const managerPermissions = [...permissionSource.match(/RESOURCE_OPERATIONS = \{([\s\S]*?)\} as const/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .flatMap(([, resource, ops]) => [...ops.matchAll(/'([a-z_]+)'/g)].map(op => resource + ':' + op[1]));
const ACCOUNTS = {
  gerente: managerPermissions,
  'solo-estadisticas': ['estadisticas:leer'],
  'sin-chatbot': managerPermissions.filter(x => x !== 'chatbot_consultas:leer'),
  'sin-preinscripciones': managerPermissions.filter(x => x !== 'preinscripciones:leer'),
  'sin-mensajes': managerPermissions.filter(x => x !== 'mensajes:leer'),
};

const DEFAULTS = { account: 'gerente', stats: 'ok', prereg: 'ok', chatbot: 'ok', activity: 'ok', empty: 'no' };
const sim = { ...DEFAULTS };
const requests = [];
// Preinscripciones: estados excluyentes 4 + 2 + 1 + 2 + 1 = 10; vigentes = 4 + 2 + 1 = 7; 3 por revisar.
const PREREG = { total: 10, vigentes: 7, recibidas: 4, pendientesRevision: 3, validadas: 2, convertidas: 1, descartadas: 2, desistidas: 1 };
const PREREG_ZERO = { total: 0, vigentes: 0, recibidas: 0, pendientesRevision: 0, validadas: 0, convertidas: 0, descartadas: 0, desistidas: 0 };
const isEmpty = () => sim.empty === 'si';
const statsBody = () => ({
  ok: true,
  stats: {
    academico: isEmpty() ? { estudiantes: 0, edicionesActivas: 0, matriculasRegistradas: 0, matriculasVigentes: 0 } : { estudiantes: 12, edicionesActivas: 2, matriculasRegistradas: 9, matriculasVigentes: 7 },
    mensajes: isEmpty() ? { total: 0, nuevos: 0, enProceso: 0, atendidos: 0, archivados: 0, pendientes: 0 } : { total: 6, nuevos: 3, enProceso: 3, atendidos: 0, archivados: 0, pendientes: 6 },
    ...(sim.prereg === 'absent' ? {} : { preinscripciones: isEmpty() || sim.prereg === 'zero' ? PREREG_ZERO : sim.prereg === 'null' ? null : sim.prereg === 'inconsistent' ? { ...PREREG, total: 11 } : PREREG }),
  },
  actividadReciente: { mensajes: [] },
});
const chatbotBody = () => ({
  ok: true, items: [{ id: 1, pregunta: 'PREGUNTA_PRIVADA_NO_MOSTRAR', veces: 2, createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-02T10:00:00.000Z' }],
  pagination: { total: 1, page: 1, limit: 1, pages: 1 },
  metrics: sim.chatbot === 'malformed' ? {} : isEmpty() ? { dias: 30, interacciones: 0, resueltas: 0, sinRespuesta: 0, conIa: 0, conCatalogo: 0 } : { dias: 30, interacciones: 10, resueltas: 7, sinRespuesta: 3, conIa: 4, conCatalogo: 6 },
});
// Serie ficticia terminada hoy (UTC): día i → i % 4 mensajes y la mitad (redondeo hacia abajo) del chatbot. En 30 días: 43 mensajes, 14 del chatbot; en 7 días: 9 y 3.
const activityBody = dias => {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const mensajes = Array.from({ length: dias }, (_, i) => { const total = isEmpty() ? 0 : i % 4; return { fecha: new Date(today - (dias - 1 - i) * 86400000).toISOString().slice(0, 10), total, chatbot: Math.floor(total / 2) }; });
  return { ok: true, dias, desde: mensajes[0].fecha, hasta: mensajes[dias - 1].fecha, mensajes, cotizaciones: isEmpty() ? { total: 0, porEstado: { borrador: 0, enviada: 0, aceptada: 0, rechazada: 0, anulada: 0 } } : { total: 4, porEstado: { borrador: 1, enviada: 2, aceptada: 1, rechazada: 0, anulada: 0 } } };
};

const handler = async (req, res, { route, url, json }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'clear') { requests.length = 0; Object.assign(sim, DEFAULTS); } else sim[key] = value; return json({ ok: true }) || true; }
  if (route === '/__state') return json({ requests }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route.startsWith('/api/admin/')) requests.push(req.method + ' ' + route.slice('/api/admin/'.length) + url.search);
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (!route.startsWith('/api/admin/')) return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1, limit: 12 } }) || true;
  if (route === '/api/admin/me') return (token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test', rol: 'GERENTE_GENERAL', permisos: ACCOUNTS[sim.account] }, acceso: { modo: 'por_roles' } }) : json({ message: 'Unauthorized' }, 401)) || true;
  if (token !== TOKEN) return json({ message: 'Unauthorized' }, 401) || true;
  const sub = route.slice('/api/admin/'.length);
  if (sub === 'stats') return (sim.stats === 'error' ? json({ message: 'Internal server error ER_SECRET' }, 500) : json(statsBody())) || true;
  if (sub === 'stats/actividad') return (sim.activity === 'error' ? json({ message: 'Internal server error ER_SECRET' }, 500) : json(activityBody(+url.searchParams.get('dias') || 30))) || true;
  if (sub === 'chatbot/sin-respuesta') return (sim.chatbot === 'error' ? json({ message: 'Internal server error ER_SECRET' }, 500) : json(chatbotBody())) || true;
  return json({ ok: true, items: [], messages: [], pagination: { page: 1, total: 0, pages: 1, limit: 20 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'analitica', handler });
  const { ck, session, open } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + value);
  const log = () => fetch(k.origin + '/__state').then(r => r.json()).then(s => s.requests);
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const set = async (values) => { await ctl('clear'); for (const [key, value] of Object.entries(values)) await ctl(key, value); };
  const settled = p => p.wait('document.querySelector(".hp-operational-overview") && !document.querySelector(".hp-operational-overview [aria-busy=true]") && ![...document.querySelectorAll(".hp-kpi strong")].some(s => s.textContent === "…")', 'resumen cargado', 10000);
  const kpis = p => p.evaluate('[...document.querySelectorAll(".hp-metrics .hp-kpi strong")].map(s => s.textContent)');
  const open_ = async (values = {}, width = 1280, route = '/admin/dashboard') => { await set(values); const p = await session(route, width); await settled(p); return p; };
  const find = (p, title) => p.evaluate('(() => { const el = [...document.querySelectorAll(".hp-operational-overview .hp-card")].find(c => c.querySelector("h2")?.textContent.includes(' + JSON.stringify(title) + ')); return el ? el.innerText.replace(/\\s+/g, " ").trim() : null; })()');
  const press = async (p, key, code, vk, text) => { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); };
  const capture = async (p, name) => {
    const dir = path.resolve(__dirname, '../.artifacts/dashboard-analitico'); fs.mkdirSync(dir, { recursive: true });
    await p.evaluate('document.fonts.ready.then(() => true)');
    const shot = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const count = (list, text) => list.filter(r => r.includes(text)).length;

  console.log('\n== INDICADORES Y PREINSCRIPCIONES (datos reales simulados)');
  { const p = await open_();
    ck((await kpis(p)).join() === '12,2,9,7,3,6', 'seis indicadores: estudiantes, ediciones abiertas, matrículas registradas y vigentes, preinscripciones por revisar y consultas pendientes', await kpis(p));
    const titles = await p.evaluate('[...document.querySelectorAll(".hp-metrics .hp-kpi .hp-metric-label")].map(s => s.textContent)');
    ck(titles.includes('Ediciones abiertas') && titles.includes('Preinscripciones por revisar'), 'los títulos son «Ediciones abiertas» y «Preinscripciones por revisar»', titles);
    ck(!(await p.evaluate('!!document.querySelector(".hp-kpi polyline, .hp-kpi canvas, .hp-kpi [data-trend]")')) && !/[+-]\d+([.,]\d+)?\s?%/.test(await p.text('.hp-metrics')), 'sin tendencias, porcentajes de variación ni sparklines: no hay serie real que los respalde');
    const card = await find(p, 'Preinscripciones por estado');
    ck(!!card && /Recibidas/.test(card) && /Validadas/.test(card) && /Convertidas/.test(card) && /Descartadas/.test(card) && /Desistidas/.test(card), 'distribución de preinscripciones con sus cinco estados', card);
    const rows = await p.evaluate('[...document.querySelectorAll(".hp-state-list li")].map(li => [li.querySelector("strong").textContent, li.querySelector(".hp-state-value").textContent, li.querySelector(".hp-state-percent").textContent])');
    ck(JSON.stringify(rows) === JSON.stringify([['Recibidas', '4', '40 %'], ['Validadas', '2', '20 %'], ['Convertidas', '1', '10 %'], ['Descartadas', '2', '20 %'], ['Desistidas', '1', '10 %']]), 'valores y porcentajes calculados sobre el total (4/2/1/2/1 de 10)', rows);
    ck(rows.reduce((sum, row) => sum + +row[1], 0) === 10 && /10 solicitudes en total/.test(card), 'los estados excluyentes suman el total del servidor (no se suman estados superpuestos)', card);
    ck(!/matriculadas/i.test(card) && /3 solicitudes por revisar/.test(card), '«Convertidas» no se rebautiza «matriculadas» y las 3 por revisar salen de pendientesRevision', card);
    ck(!/embudo|conversión/i.test(card), 'no se presenta como embudo ni tasa de conversión (los estados no son acumulativos)', card);
    ck(await p.evaluate('document.querySelectorAll(".hp-stack > span").length === 5 && document.querySelector(".hp-stack").getAttribute("aria-hidden") === "true"'), 'la barra apilada es decorativa (aria-hidden) y la lista lleva los datos');
    await p.close(); }

  console.log('\n== PREINSCRIPCIONES: NULL, AUSENTE, INCOHERENTE, CERO REAL');
  for (const [mode, label] of [['null', 'bloque null (módulo no disponible)'], ['absent', 'bloque ausente (backend anterior)'], ['inconsistent', 'bloque incoherente (total ≠ suma de estados)']]) {
    const p = await open_({ prereg: mode });
    const values = await kpis(p), card = await find(p, 'Preinscripciones por estado');
    ck(values.join() === '12,2,9,7,—,6', label + ': la tarjeta muestra «—» (no 0) y los demás indicadores siguen', values);
    ck(/No disponible/.test(card) && !/\d\s?%/.test(card) && !(await p.evaluate('!!document.querySelector(".hp-state-list")')), label + ': el bloque dice «No disponible» sin cifras ni porcentajes', card);
    ck(/No disponible/.test(await p.text('.hp-metrics')), label + ': el indicador explica «No disponible»'); await p.close(); }
  { const p = await open_({ prereg: 'zero' }); const card = await find(p, 'Preinscripciones por estado');
    ck((await kpis(p))[4] === '0' && /Aún no hay preinscripciones/.test(card) && !/\d\s?%/.test(card), 'cero real: el indicador es 0 y el bloque dice que aún no hay solicitudes, sin porcentajes', card); await p.close(); }

  console.log('\n== ORIGEN DE LAS CONSULTAS, CHATBOT Y COTIZACIONES');
  { const p = await open_();
    const split = await p.evaluate('[...document.querySelectorAll(".hp-channel-split li strong")].map(s => s.textContent)');
    const total = await p.evaluate('document.querySelector(".hp-chart-summary strong").textContent');
    ck(split.join() === '14,29' && +split[0] + +split[1] === +total && total === '43', 'origen: chatbot 14 + resto 29 = 43 consultas del gráfico (partición completa, sin duplicar)', { split, total });
    const labels = await p.evaluate('[...document.querySelectorAll(".hp-channel-split li > span:first-child")].map(s => s.textContent)');
    ck(labels.join('|') === 'Chatbot|Formulario web y registro manual' && /Consultas recibidas por origen/.test(await p.text('.hp-channel-split')), 'título y etiquetas descriptivas (no «tráfico web» ni «visitantes»)', labels);
    ck(!/tráfico|visitantes|tiempo real|en vivo|sin intervención|automátic/i.test(await p.text('.hp-operational-overview')), 'el Resumen no afirma tráfico web, visitantes únicos, atención automática ni tiempo real');
    await p.click('.hp-activity-card .hw-tabs button', '7 días'); await p.wait('document.querySelectorAll(".hp-chart title").length === 7 && [...document.querySelectorAll(".hp-channel-split li strong")].map(s => s.textContent).join() === "3,6"', 'origen a 7 días');
    ck(true, 'al cambiar a 7 días el origen se recalcula con la misma serie (3 + 6 = 9)');
    ck(await p.evaluate('[...document.querySelectorAll(".hp-quotes-chart li")].map(li => li.querySelector("strong").textContent).join() === "1,2,1,0,0" && [...document.querySelectorAll(".hp-quote-percent")].map(s => s.textContent).join() === "25 %,50 %,25 %,0 %,0 %"'), 'cotizaciones por estado: conteos y porcentajes de la API');
    const bot = await find(p, 'Respuestas del chatbot');
    ck(/70 % con respuesta/.test(bot) && /Conversaciones 10/.test(bot) && /Con respuesta 7/.test(bot) && /Sin respuesta 3/.test(bot), 'chatbot: 7 de 10 con respuesta = 70 %', bot);
    ck(/No mide si la persona quedó conforme/.test(bot) && !/PREGUNTA_PRIVADA_NO_MOSTRAR/.test(await p.text('main')), 'el texto aclara el alcance de la métrica y no se muestran preguntas de usuarios');
    const chatbotRequests = (await log()).filter(r => r.includes('chatbot/sin-respuesta'));
    ck(chatbotRequests.length === 1 && chatbotRequests[0] === 'GET chatbot/sin-respuesta?limit=1', 'una sola petición al chatbot, con limit=1 y sin búsqueda ni página', chatbotRequests);
    await p.close(); }

  console.log('\n== ESTADÍSTICAS VACÍAS: SIN CIFRAS INVENTADAS');
  { const p = await open_({ empty: 'si' });
    const text = await p.text('.hp-operational-overview');
    ck((await kpis(p)).join() === '0,0,0,0,0,0', 'con la base vacía los indicadores reales son 0', await kpis(p));
    ck(/Aún no hay preinscripciones/.test(text) && /Aún no hay conversaciones/.test(text) && /No hay consultas en este periodo/.test(text) && /Aún no hay cotizaciones registradas/.test(text), 'cada bloque explica que aún no hay datos', text.slice(0, 200));
    ck(!/NaN|Infinity|undefined|null/.test(text) && !/\d\s?%/.test(await p.text('.hp-analytics-grid')) && !/\d\s?%/.test(await p.text('.hp-activity-aside')), 'sin NaN ni porcentajes calculados sobre cero');
    await p.close(); }

  console.log('\n== FALLOS PARCIALES INDEPENDIENTES');
  { const p = await open_({ chatbot: 'error' });
    const card = await p.evaluate('document.querySelector("#hp-chatbot-title").closest(".hp-card").innerText.replace(/\\s+/g, " ")');
    ck(/No se pudieron cargar las métricas del chatbot/.test(card) && !/ER_SECRET|Internal/.test(card) && !/\d\s?%/.test(card), 'error del chatbot: aviso propio sin texto técnico ni porcentajes', card);
    ck((await kpis(p)).join() === '12,2,9,7,3,6' && !!(await find(p, 'Preinscripciones por estado')) && await p.evaluate('document.querySelectorAll(".hp-chart title").length === 30'), 'indicadores, preinscripciones y gráfico siguen disponibles');
    await ctl('chatbot', 'ok'); await p.click('.hp-analytics-card [role=alert] .hp-btn', 'Reintentar'); await p.wait('document.querySelector(".hp-split-bar")', 'chatbot recuperado');
    ck(true, '«Reintentar» recupera solo el chatbot'); await p.close(); }
  { const p = await open_({ chatbot: 'malformed' }); const card = await p.evaluate('document.querySelector("#hp-chatbot-title").closest(".hp-card").innerText.replace(/\\s+/g, " ")');
    ck(/formato inesperado/.test(card) && !/\d\s?%/.test(card), 'métricas con forma inesperada: error, no «0 conversaciones»', card); await p.close(); }
  { const p = await open_({ stats: 'error' }); const prereg = await find(p, 'Preinscripciones por estado');
    ck((await kpis(p)).every(v => v === '—') && /No se pudieron consultar las preinscripciones/.test(prereg) && !!(await find(p, 'Respuestas del chatbot')) && /70 %/.test(await find(p, 'Respuestas del chatbot')), 'si fallan las estadísticas: «—», preinscripciones con aviso y el chatbot sigue con sus datos', { values: await kpis(p), prereg });
    ck(!/ER_SECRET|Internal/.test(await p.text('main')), 'sin texto técnico del servidor'); await p.close(); }
  { const p = await open_({ activity: 'error' });
    ck(await p.evaluate('!!document.querySelector(".hp-activity-card [role=alert]") && !document.querySelector(".hp-channel-split") && !document.querySelector(".hp-chart")'), 'si falla la actividad no se dibuja ni el gráfico ni el origen de las consultas');
    ck((await kpis(p)).join() === '12,2,9,7,3,6' && /70 %/.test(await find(p, 'Respuestas del chatbot')), 'los demás bloques siguen disponibles'); await p.close(); }

  console.log('\n== PERMISOS INSUFICIENTES');
  { const p = await open_({ account: 'solo-estadisticas' }); const list = await log();
    ck(await p.evaluate('document.querySelectorAll(".hp-kpi").length === 0 && !document.querySelector(".hp-analytics-grid") && !document.querySelector(".hp-activity-card")'), 'solo estadísticas: sin indicadores de secciones vedadas, sin preinscripciones, chatbot ni actividad');
    ck(count(list, 'chatbot/sin-respuesta') === 0 && count(list, 'stats/actividad') === 0 && count(list, 'stats?vista=operativa') === 1, 'solo estadísticas: ni una petición al chatbot ni a la actividad', list); await p.close(); }
  { const p = await open_({ account: 'sin-chatbot' }); const list = await log();
    ck(!(await find(p, 'Respuestas del chatbot')) && !!(await find(p, 'Preinscripciones por estado')) && count(list, 'chatbot/sin-respuesta') === 0, 'sin chatbot_consultas:leer: no hay tarjeta ni petición al chatbot, y las preinscripciones se conservan', list); await p.close(); }
  { const p = await open_({ account: 'sin-preinscripciones' });
    ck(!(await find(p, 'Preinscripciones por estado')) && (await kpis(p)).join() === '12,2,9,7,6' && !!(await find(p, 'Respuestas del chatbot')), 'sin preinscripciones:leer: ni tarjeta ni indicador (los demás siguen)', await kpis(p)); await p.close(); }
  { const p = await open_({ account: 'sin-mensajes' }); const list = await log();
    ck(!(await p.evaluate('!!document.querySelector(".hp-activity-card")')) && count(list, 'stats/actividad') === 0 && (await kpis(p)).join() === '12,2,9,7,3', 'sin mensajes:leer: no se monta la actividad ni se consulta, y no hay indicador de consultas', { list, values: await kpis(p) });
    ck(!!(await find(p, 'Preinscripciones por estado')) && !!(await find(p, 'Respuestas del chatbot')), 'preinscripciones y chatbot se muestran según sus propios permisos'); await p.close(); }

  console.log('\n== ACTUALIZAR RESUMEN, NAVEGACIÓN Y TECLADO');
  { const p = await open_(); const before = await log();
    await p.click('.hp-heading .hp-btn', 'Actualizar resumen'); await sleep(300); await settled(p); const after = await log();
    ck(count(after, 'stats?vista=operativa') === count(before, 'stats?vista=operativa') + 1 && count(after, 'chatbot/sin-respuesta') === count(before, 'chatbot/sin-respuesta') + 1 && count(after, 'stats/actividad') === count(before, 'stats/actividad') + 1, '«Actualizar resumen» vuelve a consultar indicadores, chatbot y actividad (una vez cada uno)', { before: before.length, after: after.length });
    let reached = false; for (let i = 0; i < 60 && !reached; i++) { await press(p, 'Tab', 'Tab', 9); reached = await p.evaluate('document.activeElement?.classList.contains("hp-kpi-link")'); }
    const outline = await p.evaluate('(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + " " + s.outlineWidth; })()');
    ck(reached && !/^none/.test(outline) && !/ 0px$/.test(outline), 'el teclado llega al enlace de un indicador y muestra el foco', outline);
    await press(p, 'Enter', 'Enter', 13, '\r'); await p.wait('location.search === "?section=estudiantes"', 'navegación por Enter');
    ck((await p.path()) === '/admin/dashboard?section=estudiantes', 'Enter en «Ver estudiantes» abre la sección mediante go()', await p.path()); await p.close(); }
  { const p = await open_(); await p.click('.hp-kpi-link', 'Ver consultas'); await p.wait('location.pathname === "/admin/messages"', 'bandeja');
    ck(true, '«Ver consultas» abre la bandeja en su dirección propia'); await p.close(); }
  { const p = await open_(); const motion = await p.evaluate('getComputedStyle(document.querySelector(".hp-kpi")).transitionDuration');
    ck(/^0s(, 0s)*$/.test(motion), 'con prefers-reduced-motion los indicadores no usan transiciones', motion); await p.close(); }

  console.log('\n== RESPONSIVE (390, 820 y 1280 px)');
  for (const [width, columns] of [[1280, 3], [820, 2], [390, 1]]) {
    const p = await open_({}, width);
    const l = await p.evaluate(`(() => { const root = document.querySelector('.hp-operational-overview'), w = innerWidth;
      const bad = [...root.querySelectorAll('*')].filter(el => { if (el.closest('.hp-sr, .hp-chart-data')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > w + 1 || r.left < -1); }).map(el => el.className.toString().slice(0, 40) || el.tagName);
      const cols = new Set([...document.querySelectorAll('.hp-metrics .hp-kpi')].map(el => Math.round(el.getBoundingClientRect().left))).size;
      const clipped = [...document.querySelectorAll('.hp-kpi, .hp-analytics-card')].filter(el => el.scrollWidth > el.clientWidth + 1).length;
      return { scroll: document.documentElement.scrollWidth <= w, bad, cols, clipped, analytics: new Set([...document.querySelectorAll('.hp-analytics-grid > .hp-card')].map(el => Math.round(el.getBoundingClientRect().left))).size }; })()`);
    ck(l.scroll && l.bad.length === 0 && l.clipped === 0, width + ' px: sin desbordamiento horizontal ni recortes', l);
    ck(l.cols === columns, width + ' px: indicadores en ' + columns + ' columna(s)', l.cols);
    if (width === 1280) ck(l.analytics === 2, '1280 px: preinscripciones y chatbot lado a lado', l.analytics); else if (width === 390) ck(l.analytics === 1, '390 px: bloques de analítica apilados', l.analytics);
    if (width === 390) {
      const targets = await p.evaluate('[...document.querySelectorAll(".hp-kpi-link, .hp-activity-card .hw-tabs button, .hp-analytics-card .hp-text-btn, .hp-activity-aside .hp-text-btn")].map(el => Math.round(el.getBoundingClientRect().height))');
      ck(targets.length >= 8 && targets.every(h => h >= 44), '390 px: objetivos táctiles de al menos 44 px', targets); }
    await capture(p, 'resumen-' + width); await p.close(); }
  { const p = await open_({}, 390);
    await p.click('.hp-menu-toggle', 'Abrir menú'); await p.wait('document.querySelector(".hp-sidebar.is-open")', 'menú móvil');
    ck(await p.evaluate('document.querySelector(".hp-body").inert && document.querySelector(".hp-sidebar").contains(document.activeElement)'), 'el menú móvil sigue aislando el contenido y recibiendo el foco'); await p.close(); }

  await clean();
  k.finish('Resumen analítico (Fase 2A)');
})().catch(error => { console.error('FALLO DEL SMOKE:', error.message); process.exit(1); });
