// Notificaciones del panel (Sonner) con API simulada: nada real. Un único Toaster en el panel autenticado, éxito solo tras confirmar,
// errores HTTP sin falso éxito, resultado incierto sin reintentos, sin duplicados y sin tocar borradores.
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

const sim = { settingsPut: 'ok', settingsDelay: 0, seguimientoPut: 'ok' };
let writes = [];
const messages = Array.from({ length: 4 }, (_, i) => { const id = 4 - i; return { id, nombre: 'Persona ' + id, email: 'p' + id + '@example.test', telefono: '987654' + String(id).padStart(3, '0'), asunto: 'Asunto ' + id, mensaje: 'Mensaje ' + id, estado: 'nuevo', createdAt: '2026-05-0' + id + 'T10:00:00.000Z', updatedAt: '2026-05-0' + id + 'T10:00:00.000Z' }; });
const handler = async (req, res, { route, json, body }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'clear') { writes = []; Object.assign(sim, { settingsPut: 'ok', settingsDelay: 0, seguimientoPut: 'ok' }); } else sim[key] = key.endsWith('Delay') ? Number(value) : value; return json({ ok: true }) || true; }
  if (route === '/__state') return json({ writes }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (route === '/api/admin/me') return (token === TOKEN ? json({ ok: true, user: { id: 1, nombre: 'Ana Administradora', email: 'ana@example.test' } }) : json({}, 401)) || true;
  const sub = route.replace('/api/admin/', ''); let m;
  if (sub === 'settings' && req.method === 'GET') return json({ ok: true, settings: [{ clave: 'telefono', valor: '987654321', grupo: 'contacto', descripcion: 'Teléfono' }, { clave: 'correo', valor: 'info@example.test', grupo: 'contacto', descripcion: 'Correo' }] }) || true;
  if (sub === 'settings' && req.method === 'PUT') { await body(); writes.push('PUT settings'); if (sim.settingsDelay) await sleep(sim.settingsDelay); return (sim.settingsPut === 'error' ? json({ message: 'Internal server error ER_SECRET' }, 500) : json({ ok: true })) || true; }
  if (req.method !== 'GET') { const data = await body(); writes.push(req.method + ' ' + sub); if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/)) && req.method === 'PUT') {
      if (sim.seguimientoPut === '500') return json({ message: 'Internal server error ER_SECRET' }, 500) || true;
      if (sim.seguimientoPut === '409') return json({ message: 'La revisión cambió.' }, 409) || true;
      return json({ ok: true, item: { estado: data.estado || 'nuevo', responsable: '', notas: data.notas || '', respuesta: '', revision: 2, historial: [] } }) || true; }
    return json({ ok: true, item: {} }) || true; }
  if (sub === 'messages') return json({ ok: true, messages, pagination: { total: 4, page: 1, limit: 20, pages: 1 }, metrics: { nuevo: 4, en_proceso: 0, atendido: 0, archivado: 0 } }) || true;
  if ((m = sub.match(/^messages\/(\d+)$/))) return json({ ok: true, message: messages.find(x => x.id === +m[1]) }) || true;
  if ((m = sub.match(/^seguimiento\/messages\/(\d+)$/))) return json({ ok: true, item: { estado: 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] } }) || true;
  return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'toasts', handler });
  const { ck, session, open } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + value);
  const state = () => fetch(k.origin + '/__state').then(r => r.json());
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const toasts = p => p.evaluate('[...document.querySelectorAll("[data-sonner-toast]")].map(t => ({ type: t.getAttribute("data-type"), text: t.innerText.replace(/\\s+/g, " ").trim() }))');
  const toasters = p => p.evaluate('document.querySelectorAll("section[aria-label^=Notificaciones]").length'); // Sonner solo crea la lista [data-sonner-toaster] cuando hay avisos; el contenedor vivo siempre existe
  const waitToast = (p, type, what) => p.wait('[...document.querySelectorAll("[data-sonner-toast]")].some(t => t.getAttribute("data-type") === ' + JSON.stringify(type) + ')', what);
  const submitSettings = p => p.evaluate('document.querySelector("main form").requestSubmit(); 1');

  console.log('\n== UN ÚNICO TOASTER, SOLO EN EL PANEL AUTENTICADO');
  await clean();
  { const p = await open(1280); await p.go('/', 'document.querySelector("main, #root > *")'); await sleep(500);
    ck((await toasters(p)) === 0, 'las páginas públicas no montan Toaster (sin notificaciones del panel)');
    await p.go('/admin/login'); await sleep(400); ck((await toasters(p)) === 0, 'la pantalla de acceso no monta Toaster'); await p.close(); }
  { const p = await session('/admin/dashboard?section=ajustes'); await p.wait('document.querySelector("main form")', 'ajustes');
    await p.wait('document.querySelector("section[aria-label^=Notificaciones]")', 'contenedor de notificaciones'); ck((await toasters(p)) === 1, 'el panel autenticado monta exactamente un Toaster');
    await p.go('/admin/dashboard?section=resumen', 'document.querySelector(".hp-metrics")'); await p.wait('document.querySelector("section[aria-label^=Notificaciones]")', 'contenedor de notificaciones'); ck((await toasters(p)) === 1, 'cambiar de sección no duplica el Toaster');
    await p.wait('document.querySelector("section[aria-label^=Notificaciones]")?.getAttribute("aria-live") === "polite"', 'contenedor en vivo'); ck(true, 'el contenedor es una región en vivo educada con nombre accesible en español («Notificaciones»)'); await p.close(); }

  console.log('\n== ÉXITO SOLO TRAS CONFIRMAR, ERROR HTTP Y DUPLICADOS');
  await clean();
  { await ctl('settingsDelay', '900'); const p = await session('/admin/dashboard?section=ajustes'); await p.wait('document.querySelector("main form")', 'ajustes');
    await submitSettings(p); await sleep(350);
    ck((await toasts(p)).length === 0 && (await state()).writes.length === 1, 'mientras el PUT sigue pendiente NO hay aviso de éxito');
    await submitSettings(p); await submitSettings(p);
    await waitToast(p, 'success', 'éxito confirmado'); await sleep(300);
    const list = await toasts(p);
    ck(list.length === 1 && /se guardó correctamente/.test(list[0].text), 'tras la respuesta 200 aparece un único aviso de éxito', list);
    ck((await state()).writes.length === 1, 'los envíos repetidos mientras había un PUT en curso no crearon más peticiones (ni más avisos)', await state()); await p.close(); }
  await clean();
  { await ctl('settingsPut', 'error'); const p = await session('/admin/dashboard?section=ajustes'); await p.wait('document.querySelector("main form")', 'ajustes');
    await submitSettings(p); await p.wait('document.querySelector("main .hp-error[role=alert]")', 'error');
    const list = await toasts(p); const text = await p.text('main');
    ck(!list.some(t => t.type === 'success'), 'un error HTTP 500 nunca se presenta como éxito', list);
    ck(!/ER_SECRET|Internal/.test(text + JSON.stringify(list)) && /no pudo completar/.test(text), 'el error muestra un texto saneado, sin detalles técnicos del servidor', text.slice(0, 160)); await p.close(); }

  console.log('\n== RESULTADO INCIERTO, 409, BORRADORES Y SESIÓN');
  await clean();
  { await ctl('seguimientoPut', '500'); const p = await session('/admin/messages?id=3'); await p.wait('document.querySelector(".hw-inbox-detail form textarea")', 'detalle');
    const DRAFT = 'Nota que no debe perderse';
    await p.type('.hw-inbox-detail form textarea', 0, DRAFT); await sleep(150); await p.evaluate('document.querySelector(".hw-inbox-detail form").requestSubmit(); 1');
    await p.wait('document.querySelector("[data-save-uncertain]")', 'resultado incierto'); await waitToast(p, 'warning', 'aviso de resultado incierto');
    const list = await toasts(p);
    ck(list.some(t => t.type === 'warning' && /No pudimos confirmar/.test(t.text)) && !list.some(t => t.type === 'success') && !/ER_SECRET/.test(JSON.stringify(list)), 'un 5xx se avisa como resultado incierto (advertencia), no como éxito ni con texto técnico', list);
    await sleep(6500);
    ck((await toasts(p)).some(t => t.type === 'warning'), 'el aviso de resultado incierto no caduca solo');
    const writes = (await state()).writes.filter(w => w.startsWith('PUT seguimiento'));
    ck(writes.length === 1, 'no hay reintento automático tras el resultado incierto', writes);
    ck((await p.evaluate('document.querySelector(".hw-inbox-detail form textarea").value')) === DRAFT && await p.evaluate('!!document.querySelector("[data-save-uncertain]")'), 'el borrador y el aviso en línea (con sus controles) siguen disponibles: el toast no los sustituye');
    ck(await p.evaluate('[...document.querySelectorAll("[data-sonner-toast] button")].some(b => /Cerrar notificación/.test(b.getAttribute("aria-label") || ""))'), 'el aviso se puede cerrar con un botón de nombre accesible en español'); await p.close(); }
  await clean();
  { await ctl('seguimientoPut', '409'); const p = await session('/admin/messages?id=3'); await p.wait('document.querySelector(".hw-inbox-detail form textarea")', 'detalle');
    await p.type('.hw-inbox-detail form textarea', 0, 'Mi nota'); await sleep(150); await p.evaluate('document.querySelector(".hw-inbox-detail form").requestSubmit(); 1'); await sleep(1200);
    ck(!(await toasts(p)).some(t => t.type === 'success') && (await p.evaluate('document.querySelector(".hw-inbox-detail form textarea").value')) === 'Mi nota', 'un 409 no anuncia éxito y conserva el borrador local'); await p.close(); }
  await clean();
  { const p = await session('/admin/messages?id=3'); await p.wait('document.querySelector(".hw-inbox-detail form textarea")', 'detalle'); await p.wait('document.querySelectorAll(".hw-inbox-list button").length === 4', 'lista');
    await p.type('.hw-inbox-detail form textarea', 0, 'Borrador durante la exportación'); await sleep(150);
    await p.click('.hw-card-heading .hp-btn, .hp-card-heading .hp-btn', 'Exportar resultados'); await waitToast(p, 'success', 'exportación');
    const list = await toasts(p);
    ck(list.some(t => /Se exportaron 4 consultas/.test(t.text)), 'la exportación anuncia su resultado real (4 consultas) cuando termina', list);
    ck((await p.evaluate('document.querySelector(".hw-inbox-detail form textarea").value')) === 'Borrador durante la exportación', 'mostrar un toast no borra el borrador del editor');
    await p.click('aside .hp-sidebar-bottom button', 'Cerrar sesión').catch(() => {});
    await p.evaluate('[...document.querySelectorAll("aside button")].find(b => b.textContent.includes("Cerrar sesión"))?.click(); 1'); await sleep(500);
    if (await p.evaluate('!!document.querySelector("dialog.hp-unsaved-dialog[open]")')) await p.evaluate('[...document.querySelectorAll("dialog.hp-unsaved-dialog[open] button")].find(b => /Salir|Descartar|Cerrar sesión/i.test(b.textContent))?.click(); 1');
    await p.wait('location.pathname === "/admin/login"', 'pantalla de acceso'); await sleep(400);
    ck((await toasters(p)) === 0 && (await toasts(p)).length === 0, 'al cerrar sesión no queda ningún aviso ni Toaster (otra cuenta no los verá)'); await p.close(); }

  k.finish('Notificaciones del panel (Sonner)');
})().catch(error => { console.error(error); process.exit(1); });
