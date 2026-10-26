// Fase 4C-B: «Mi Día» con React real, sesiones y API ficticias (sin MySQL, OpenAI ni correo). Usa smoke-kit: bloquea antes de enviarla
// cualquier petición que no sea del servidor simulado y cierra el árbol de Edge. Capturas en .artifacts/mi-dia/ (ignorado por Git).
const fs = require('node:fs');
const path = require('node:path');
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

// Matriz real del backend (no se define otra aquí).
const backend = (...parts) => fs.readFileSync(path.join(__dirname, '../../backend/src', ...parts), 'utf8');
const policy = backend('permissions', 'policy.ts');
const roleList = name => [...policy.match(new RegExp('const ' + name + ': readonly Permission\\[\\] = \\[([\\s\\S]*?)\\];'))[1].matchAll(/'([a-z_]+:[a-z_]+)'/g)].map(m => m[1]);
const all = [...backend('permissions', 'permissions.ts').match(/RESOURCE_OPERATIONS = \{([\s\S]*?)\} as const/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .flatMap(([, resource, ops]) => [...ops.matchAll(/'([a-z_]+)'/g)].map(m => resource + ':' + m[1]));
const PERMISOS = { GERENTE_GENERAL: all, COORDINADORA_INSTITUCIONAL: roleList('COORDINADORA_INSTITUCIONAL'), SECRETARIA: roleList('SECRETARIA') };
const SECTIONS = Object.fromEntries([...backend('asistente', 'asistente.rules.ts').match(/SECTION_PERMISSIONS[^=]*= Object\.freeze\(\{([\s\S]*?)\}\);/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .map(([, key, perms]) => [key, [...perms.matchAll(/'([a-z_:]+)'/g)].map(m => m[1])]));

const shots = path.resolve(__dirname, '../.artifacts/mi-dia');
fs.mkdirSync(shots, { recursive: true });

const PEND = [ // forma y reglas de asistente.rules.ts; cifras ficticias
  { id: 'mensajes_antiguos', area: 'atencion', severidad: 'alta', titulo: '2 mensajes sin cerrar desde hace más de 48 horas', cantidad: 2, detalle: 'Mensajes en estado nuevo o en proceso cuya fecha de recepción supera el plazo.', permiso: 'mensajes:editar' },
  { id: 'cotizaciones_vencidas', area: 'cotizaciones', severidad: 'alta', titulo: '1 cotización enviada con validez vencida', cantidad: 1, detalle: 'Enviadas, sin respuesta registrada y con la fecha de validez ya pasada.', permiso: 'cotizaciones:editar' },
  { id: 'ediciones_listas_para_abrir', area: 'aperturas', severidad: 'alta', titulo: '1 edición alcanzó el mínimo de preinscritos validados', cantidad: 1, detalle: 'La apertura no es automática: la confirma Gerencia o Coordinación.', permiso: 'convocatorias:editar' },
  { id: 'mensajes_nuevos', area: 'atencion', severidad: 'media', titulo: '4 mensajes nuevos sin atender', cantidad: 4, detalle: 'Mensajes sin seguimiento iniciado.', permiso: 'seguimiento_mensajes:editar' },
  { id: 'preinscripciones_por_revisar', area: 'preinscripciones', severidad: 'media', titulo: '6 preinscripciones recibidas por revisar', cantidad: 6, detalle: 'Solicitudes sin validar de ediciones planificadas o abiertas.', permiso: 'preinscripciones:editar' },
  { id: 'matriculas_por_confirmar', area: 'matriculas', severidad: 'media', titulo: '9 matrículas activas de ediciones cerradas sin confirmar cumplimiento', cantidad: 9, detalle: 'Requieren la confirmación administrativa de Gerencia o Coordinación.', permiso: 'matriculas:confirmar' },
  { id: 'mensajes_en_proceso', area: 'atencion', severidad: 'info', titulo: '7 mensajes en proceso', cantidad: 7, detalle: 'Con seguimiento iniciado y todavía sin cerrar.', permiso: 'seguimiento_mensajes:editar' },
];
const sim = { me: 'GERENTE_GENERAL', revoke: [], mode: 'ok', status: 200, hold: null, marker: 0 };
const asks = []; let meReads = 0;
const areasOf = role => Object.keys(SECTIONS).filter(key => SECTIONS[key].every(p => PERMISOS[role].includes(p)));
function summary(role, marker = 0) {
  const areas = areasOf(role);
  const pendientes = sim.mode === 'vacio' ? [] : PEND.filter(p => areas.includes(p.area) && !(sim.mode === 'parcial' && p.area === 'preinscripciones'))
    .map(p => ({ ...p, cantidad: p.cantidad + marker, puedeActuar: PERMISOS[role].includes(p.permiso) }));
  return {
    ok: true, generado_en: '2026-10-25T14:12:00.000Z', zona_horaria: 'America/Lima', fecha_operativa: '2026-10-25',
    ventana_hoy: { desde_utc: '2026-10-25T05:00:00.000Z', hasta_utc: '2026-10-26T05:00:00.000Z' },
    acceso: { rol: role, permisos_efectivos: PERMISOS[role].length, secciones_autorizadas: areas },
    resumen: { texto: 'TEXTO_BASICO_NO_MOSTRAR', pendientes_total: pendientes.length, pendientes_truncados: false, vacio: pendientes.length === 0 },
    pendientes,
    indicadores_atencion: { consultas_registradas: { hoy: 5, total: 40, pendientes: 11, nuevas: 4, en_proceso: 7, mas_de_48_horas_sin_cerrar: 2 }, personas_unicas: { hoy: 777, con_pendientes: 778, definicion: 'PERSONAS_NO_MOSTRAR' }, chatbot: { mensajes_hoy: 31, sin_resolver_hoy: 3, personas: null } },
    secciones: Object.fromEntries(areas.map(a => [a, sim.mode === 'parcial' && a === 'preinscripciones' ? { estado: 'error', motivo: 'No se pudo consultar esta área. Intenta de nuevo más tarde.' } : { estado: 'ok', consultado_en: '2026-10-25T14:12:00.000Z' }])),
    fuentes: areas.map(a => ({ seccion: a, tablas: ['TABLA_NO_MOSTRAR'] })), explicacion: { estado: 'no_solicitada' }, no_registrado: [], alcance: 'solo_lectura',
    extra_privado: 'persona.privada@example.test',
  };
}
const handler = async (req, res, { route, url, json }) => {
  if (!route.startsWith('/api/')) return false;
  if (route === '/api/settings') { json({ ok: true, settings: {} }); return true; }
  if (route === '/api/admin/me') {
    meReads++;
    if (sim.me === 'legacy') json({ ok: true, user: { id: 1, nombre: 'Persona Ficticia', email: 'p@example.test' } });
    else if (sim.me === 'sin-rol') json({ ok: true, user: { id: 1, nombre: 'Persona Ficticia', email: 'p@example.test', rol: null, permisos: [] }, acceso: { modo: 'por_roles' } });
    else json({ ok: true, user: { id: 1, nombre: 'Persona Ficticia', email: 'p@example.test', rol: sim.me, permisos: PERMISOS[sim.me].filter(p => !sim.revoke.includes(p)) }, acceso: { modo: 'por_roles' } });
    return true;
  }
  if (route.startsWith('/api/admin/asistente')) {
    asks.push({ method: req.method, path: route + url.search });
    const marker = sim.marker; // fijado al recibir la solicitud: la respuesta retenida conserva su cifra
    if (sim.hold) { const h = sim.hold; sim.hold = null; await h; }
    if (sim.status === 429) { json({ ok: false, codigo: 'limite_de_uso', mensaje: 'TEXTO_SERVIDOR_429', reintentar_en_segundos: 2 }, 429); return true; }
    if (sim.status !== 200) { json({ statusCode: sim.status, message: sim.status === 500 ? 'Internal server error SQL_SECRETO' : 'Prohibido' }, sim.status); return true; }
    if (sim.mode === 'malformado') { json({ ok: true, fecha_operativa: 'ayer', pendientes: 'muchos' }); return true; }
    json(summary(sim.me, marker)); return true;
  }
  json({ ok: true, items: [], messages: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true;
};

const MAIN = 'document.querySelector("main")';
const ready = 'document.querySelector(".hp-myday") && !document.querySelector(".hp-myday-queue[aria-busy=true]")';
const navItems = 'JSON.stringify([...document.querySelectorAll(".hp-nav-item")].map(b => b.textContent.trim()))';
const NAV = {
  GERENTE_GENERAL: ['Mi Día', 'Resumen', 'Estudiantes', 'Ediciones', 'Preinscripciones', 'Matrículas', 'Reportes', 'Importación académica CSV', 'Mensajes', 'Cotizaciones', 'Consultas del chatbot', 'Roles y usuarios', 'Mi cuenta'],
  COORDINADORA_INSTITUCIONAL: ['Mi Día', 'Resumen', 'Estudiantes', 'Ediciones', 'Preinscripciones', 'Matrículas', 'Reportes', 'Importación académica CSV', 'Mensajes', 'Cotizaciones', 'Consultas del chatbot', 'Mi cuenta'],
  SECRETARIA: ['Mi Día', 'Estudiantes', 'Ediciones', 'Preinscripciones', 'Matrículas', 'Mensajes', 'Consultas del chatbot', 'Mi cuenta'],
};
const reset = () => { Object.assign(sim, { revoke: [], mode: 'ok', status: 200, hold: null, marker: 0 }); };

(async () => {
  const k = await start({ prefix: 'my-day', handler });
  const { ck } = k;
  const shot = async (p, name) => { const { data } = await p.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(data, 'base64')); };
  try {
    // 1. Los tres roles: menú, inicio sin cambios, áreas, pendientes, accesos y ausencia de datos personales.
    for (const role of Object.keys(PERMISOS)) {
      reset(); sim.me = role; const homeAsks = asks.length;
      const home = await k.session('/admin/dashboard');
      await home.wait('document.querySelectorAll(".hp-nav-item").length > 3', 'menú ' + role);
      ck(JSON.stringify(JSON.parse(await home.evaluate(navItems))) === JSON.stringify(NAV[role]), role + ': menú con Mi Día y sin secciones ajenas', await home.evaluate(navItems));
      ck(await home.path() === (role === 'SECRETARIA' ? '/admin/messages' : '/admin/dashboard'), role + ': el inicio no cambia (' + await home.path() + ')');
      ck(asks.length === homeAsks, role + ': el inicio no consulta el asistente');
      await home.close();
      const before = asks.length;
      const p = await k.session('/admin/dashboard?section=mi-dia');
      await p.wait(ready, 'Mi Día ' + role);
      const areas = JSON.parse(await p.evaluate('JSON.stringify([...document.querySelectorAll("[data-myday-area]")].map(a => a.dataset.mydayArea))'));
      const expected = areasOf(role);
      ck(JSON.stringify(areas) === JSON.stringify(expected), role + ': solo las áreas autorizadas por el servidor', areas);
      const pending = JSON.parse(await p.evaluate('JSON.stringify([...document.querySelectorAll("[data-myday-pending]")].map(li => [li.dataset.mydayPending, li.textContent.includes("Solo informativo")]))'));
      const want = PEND.filter(x => expected.includes(x.area)).map(x => [x.id, !PERMISOS[role].includes(x.permiso)]);
      ck(JSON.stringify(pending) === JSON.stringify(want), role + ': pendientes en orden de prioridad y condición informativa o accionable', pending);
      const text = await p.text('main');
      ck(text.includes('Domingo, 25 de octubre de 2026') && text.includes('hora de Lima'), role + ': fecha operativa de Lima del servidor');
      ck(!/777|778|PERSONAS_NO_MOSTRAR|TEXTO_BASICO_NO_MOSTRAR|TABLA_NO_MOSTRAR|example\.test|@/.test(text), role + ': sin personas únicas, correos ni texto interno');
      if (role === 'SECRETARIA') {
        ck(!/[Cc]otizaci/.test(text) && !(await p.evaluate('!!document.querySelector("main a[href*=cotizaciones]")')), 'SECRETARIA: ni cifras, ni nombres ni accesos de Cotizaciones en el DOM');
        ck(text.includes('Solo informativo: tu cuenta no puede resolverlo'), 'SECRETARIA: aperturas y confirmaciones solo informativas');
      }
      const links = JSON.parse(await p.evaluate('JSON.stringify([...document.querySelectorAll("main a")].map(a => a.getAttribute("href")))'));
      ck(links.every(h => !/antiguas|vencida|crear=1&|explicar/.test(h)), role + ': enlaces sin filtros que el destino no interpreta', links);
      ck(links.includes('/admin/messages?crear=1') === PERMISOS[role].includes('mensajes:crear'), role + ': «Registrar consulta» según mensajes:crear');
      ck(asks.length === before + 1 && asks.every(a => a.method === 'GET' && a.path === '/api/admin/asistente/resumen'), role + ': un único GET sin explicar=true', asks.slice(before));
      await p.close();
    }

    // 2. Sin rol (por_roles) y modo heredado: sin entrada ni solicitudes, también por enlace directo.
    for (const kind of ['sin-rol', 'legacy']) {
      reset(); sim.me = kind; const before = asks.length;
      const p = await k.session('/admin/dashboard?section=mi-dia');
      await p.wait('document.querySelector("[data-panel-access], .hp-card, .hp-heading")', kind);
      await sleep(400);
      const items = JSON.parse(await p.evaluate(navItems));
      ck(!items.includes('Mi Día') && !(await p.evaluate('!!document.querySelector(".hp-myday")')), kind + ': sin Mi Día en el menú ni montado', items);
      ck((await p.text('main')).includes('permisos adicionales'), kind + ': enlace directo muestra el aviso de permisos');
      ck(asks.length === before, kind + ': ninguna solicitud al asistente');
      await p.close();
    }

    // 3. Estados: vacío, fallo parcial, malformado, 500, 403, 401 y 429.
    reset(); sim.me = 'GERENTE_GENERAL'; sim.mode = 'vacio';
    let p = await k.session('/admin/dashboard?section=mi-dia', 1280); await p.wait(ready, 'vacío');
    ck((await p.text('main')).includes('No tienes pendientes en tus áreas') && !(await p.evaluate('!!document.querySelector("[data-myday-pending]")')), 'sin pendientes: estado vacío explícito');
    await p.close();

    reset(); sim.me = 'COORDINADORA_INSTITUCIONAL'; sim.mode = 'parcial';
    p = await k.session('/admin/dashboard?section=mi-dia', 1280); await p.wait(ready, 'parcial');
    const partial = await p.text('[data-myday-area="preinscripciones"]');
    ck(partial.includes('—') && partial.includes('No se pudo consultar esta área') && !partial.includes('Puntos para revisar'), 'fallo de un área: «—» y su motivo, sin ceros', partial);
    ck(await p.evaluate('document.querySelectorAll("[data-myday-pending]").length') === 6, 'fallo de un área: el resto de pendientes se conserva');
    await shot(p, 'estado-fallo-parcial-1280');
    await p.close();

    reset(); sim.me = 'GERENTE_GENERAL'; sim.mode = 'malformado';
    p = await k.session('/admin/dashboard?section=mi-dia'); await p.wait(ready, 'malformado');
    ck((await p.text('main')).includes('formato inesperado') && !(await p.evaluate('!!document.querySelector("[data-myday-pending], [data-myday-area]")')), 'respuesta malformada: aviso y nada a medias');
    await p.close();

    reset(); sim.me = 'GERENTE_GENERAL'; sim.status = 500;
    p = await k.session('/admin/dashboard?section=mi-dia'); await p.wait(ready, '500');
    let txt = await p.text('main');
    ck(txt.includes('No se pudo cargar Mi Día') && !/SQL_SECRETO|Internal server error/i.test(txt) && txt.includes('Reintentar'), 'error general: aviso sin texto técnico y con Reintentar');
    sim.status = 200;
    await p.click('main button', 'Reintentar'); await p.wait(ready + ' && document.querySelector("[data-myday-pending]")', 'reintento');
    ck(true, 'Reintentar recupera el resumen');
    await shot(p, 'error-recuperado-1280');
    // Con datos ya cargados, un error conserva lo anterior.
    sim.status = 500;
    await p.click('.hp-myday-actions button', 'Actualizar'); await p.wait('document.querySelector(".hp-myday-alert")', 'error con datos');
    ck((await p.text('.hp-myday-alert')).includes('Se conserva la información') && await p.evaluate('document.querySelectorAll("[data-myday-pending]").length') === 7, 'error al actualizar: conserva el resumen anterior');
    await p.close();

    reset(); sim.me = 'GERENTE_GENERAL'; sim.status = 403;
    const meBefore = meReads;
    p = await k.session('/admin/dashboard?section=mi-dia'); await p.wait(ready, '403');
    await sleep(500);
    ck((await p.text('main')).includes('No puedes consultar Mi Día') && await p.path() === '/admin/dashboard?section=mi-dia', '403: aviso y la sesión sigue abierta');
    ck(meReads >= meBefore + 1, '403: la sesión se validó con /admin/me y no se cerró');
    await p.close();

    reset(); sim.me = 'GERENTE_GENERAL'; sim.status = 401;
    p = await k.session('/admin/dashboard?section=mi-dia');
    await p.wait('location.pathname === "/admin/login"', 'cierre por 401');
    ck(await p.evaluate('!localStorage.getItem("horus-admin-token")'), '401: la sesión se cierra y vuelve al login');
    await p.close();

    reset(); sim.me = 'GERENTE_GENERAL';
    p = await k.session('/admin/dashboard?section=mi-dia'); await p.wait(ready + ' && document.querySelector("[data-myday-pending]")', 'antes de 429');
    sim.status = 429;
    await p.click('.hp-myday-actions button', 'Actualizar'); await p.wait('document.querySelector(".hp-myday-alert.is-limit")', '429');
    txt = await p.text('.hp-myday-alert');
    ck(txt.includes('Podrás volver a hacerlo en 2 s') && !txt.includes('TEXTO_SERVIDOR_429') && await p.evaluate('document.querySelector(".hp-myday-actions button").disabled'), '429: aviso con espera, botón bloqueado y datos conservados');
    const after429 = asks.length;
    await p.evaluate('document.querySelector(".hp-myday-actions button").click(); 1'); await sleep(300);
    ck(asks.length === after429, '429: no se reintenta mientras dura la espera');
    sim.status = 200;
    await p.wait('!document.querySelector(".hp-myday-actions button").disabled', 'fin de la espera', 6000);
    ck(asks.length === after429, '429: tras la espera no hay reintento automático');
    await p.close();

    // 4. Actualización repetida, respuesta obsoleta/cancelación y revocación de permisos.
    reset(); sim.me = 'GERENTE_GENERAL';
    p = await k.session('/admin/dashboard?section=mi-dia'); await p.wait(ready + ' && document.querySelector("[data-myday-pending]")', 'repetida');
    let n = asks.length;
    await p.evaluate('(() => { const b = document.querySelector(".hp-myday-actions button"); for (let i = 0; i < 5; i++) b.click(); return 1 })()');
    await p.wait(ready, 'tras actualizar'); await sleep(300);
    ck(asks.length === n + 1, 'cinco clics seguidos en Actualizar = una sola solicitud', asks.length - n);
    // Solicitud lenta con otra cifra: se abandona la sección, se vuelve, y la respuesta tardía no pisa la nueva.
    let release; sim.hold = new Promise(r => { release = r; }); sim.marker = 100;
    await p.click('.hp-myday-actions button', 'Actualizar'); await sleep(200);
    // Hay que esperar a que Mi Día se desmonte: si se vuelve antes, React combina las dos navegaciones y la solicitud sigue siendo la vigente.
    await p.click('.hp-nav-item', 'Mensajes'); await p.wait('location.pathname === "/admin/messages" && !document.querySelector(".hp-myday")', 'salir');
    const held = asks.length;
    sim.marker = 0;
    await p.click('.hp-nav-item', 'Mi Día'); await p.wait(ready + ' && document.querySelector("[data-myday-pending]")', 'volver');
    release(); await sleep(600);
    const first = await p.text('[data-myday-pending="mensajes_antiguos"] .hp-myday-count');
    ck(first === '2' && asks.length === held + 1, 'cancelación al salir: la respuesta tardía (cifras +100) no pisa la nueva', { first, nuevas: asks.length - held });
    await p.close();

    reset(); sim.me = 'COORDINADORA_INSTITUCIONAL';
    p = await k.session('/admin/dashboard?section=mi-dia'); await p.wait(ready + ' && document.querySelector("[data-myday-area=cotizaciones]")', 'revocación');
    await sleep(5100); // intervalo real de revalidación tras 403 (sessionRefresh.ts); no se acelera el reloj
    sim.revoke = ['cotizaciones:leer'];
    await p.evaluate('window.dispatchEvent(new CustomEvent("horus:access-denied", { detail: { token: ' + JSON.stringify(TOKEN) + ' } })); 1');
    await p.wait('!document.querySelector("[data-myday-area=cotizaciones]")', 'retirada de cotizaciones');
    const rt = await p.text('main');
    ck(!/[Cc]otizaci/.test(rt) && !(await p.evaluate('!!document.querySelector("[data-myday-pending=cotizaciones_vencidas]")')), 'revocación: el área y sus pendientes desaparecen sin recargar');
    await p.close();

    // 5. Teclado y foco visible; Enter abre el destino real.
    reset(); sim.me = 'SECRETARIA';
    p = await k.session('/admin/dashboard?section=mi-dia'); await p.wait(ready + ' && document.querySelector(".hp-myday-go")', 'teclado');
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      found = await p.evaluate('document.activeElement?.closest?.("[data-myday-pending=mensajes_nuevos]") !== null && document.activeElement.classList.contains("hp-myday-go")');
    }
    ck(found, 'teclado: se llega con Tab al enlace de un pendiente');
    ck(await p.evaluate('getComputedStyle(document.activeElement).outlineStyle !== "none" && document.activeElement.matches(":focus-visible")'), 'teclado: foco visible');
    ck(await p.evaluate('document.activeElement.textContent.includes("Atender en Mensajes")'), 'el enlace tiene un nombre accesible completo');
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await p.wait('location.pathname + location.search === "/admin/messages?estado=nuevo"', 'destino');
    ck(true, 'Enter abre la bandeja filtrada por «nuevo»');
    await p.close();

    // 6. Resoluciones, sin desborde horizontal; capturas reales.
    for (const role of ['GERENTE_GENERAL', 'SECRETARIA']) for (const width of [1440, 1280, 820, 390, 320]) {
      reset(); sim.me = role;
      const q = await k.open(width, width <= 390 ? 2400 : 1500);
      await q.go('/__empty'); await q.evaluate('localStorage.setItem("horus-admin-token", ' + JSON.stringify(TOKEN) + '); 1');
      await q.go('/admin/dashboard?section=mi-dia'); await q.wait(ready + ' && document.querySelector("[data-myday-pending]")', 'Mi Día ' + width);
      const over = await q.evaluate('document.documentElement.scrollWidth - window.innerWidth');
      const clipped = await q.evaluate('[...document.querySelectorAll(".hp-myday *")].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).length');
      ck(over <= 0 && clipped === 0, role + ' ' + width + ' px: sin desplazamiento horizontal ni elementos fuera de pantalla', { over, clipped });
      // Fase 4C-C: tarjetas de área sin franjas vacías (la rejilla iguala la altura de cada fila) y menú sin etiquetas repetidas.
      const gaps = JSON.parse(await q.evaluate('JSON.stringify([...document.querySelectorAll("[data-myday-area]")].map(card => { const link = card.querySelector(".hp-myday-area-link"); const bottom = Math.max(...[...card.children].filter(c => c !== link).map(c => c.getBoundingClientRect().bottom)); return Math.round((link ? link.getBoundingClientRect().top : card.getBoundingClientRect().bottom) - bottom); }))'));
      const labels = JSON.parse(await q.evaluate(navItems));
      ck(Math.max(...gaps) <= 48 && new Set(labels).size === labels.length, role + ' ' + width + ' px: tarjetas sin huecos vacíos (máx. ' + Math.max(...gaps) + ' px) y menú sin duplicados', { gaps, labels });
      await shot(q, 'mi-dia-' + (role === 'SECRETARIA' ? 'secretaria' : 'gerencia') + '-' + width);
      if (width === 390 && role === 'SECRETARIA') {
        await q.click('.hp-menu-toggle', ''); await q.wait('document.querySelector(".hp-sidebar.is-open")', 'menú móvil'); await sleep(300);
        ck(JSON.parse(await q.evaluate(navItems))[0] === 'Mi Día', 'móvil: Mi Día en el menú');
        await shot(q, 'menu-movil-secretaria-390');
      }
      await q.close();
    }
    ck(asks.every(a => !a.path.includes('explicar')), 'ninguna solicitud con explicar (' + asks.length + ' al asistente)');
  } catch (error) {
    ck(false, 'ejecución', error.message);
  }
  k.finish('Smoke «Mi Día»');
})();
