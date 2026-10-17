// «Roles y usuarios» con API simulada: nada real (cuentas ficticias en memoria, sin MySQL ni correo). Cubre: menú y acceso según permisos
// (gerente en por_roles, solo lectura con cuentas:leer, secretaria sin permiso, modo heredado), listado con cuentas pendientes resaltadas,
// búsqueda y filtros, diálogo de cambio de rol con confirmación y avisos, cuerpo enviado (rol y rol_actual), doble envío, cancelación,
// 409 con su mensaje, 500 como resultado incierto sin reintento, desactivación confirmada, propia cuenta protegida y móvil sin desborde.
// El kit bloquea antes de enviarla cualquier petición que no sea del servidor simulado y cierra el árbol de Edge.
const { start, sleep, KEY, TOKEN } = require('./smoke-kit.cjs');

const ALL = ['cuentas:leer', 'cuentas:crear', 'cuentas:editar', 'cuentas:asignar_rol', 'estadisticas:leer', 'configuracion:leer'];
const SESSIONS = {
  [TOKEN]: { id: 1, nombre: 'Gerente Ficticia', email: 'gerente@example.test', rol: 'GERENTE_GENERAL', permisos: ALL, modo: 'por_roles' },
  'tk-lectura': { id: 3, nombre: 'Coordinadora Ficticia', email: 'coord@example.test', rol: 'COORDINADORA_INSTITUCIONAL', permisos: ['cuentas:leer', 'configuracion:leer'], modo: 'por_roles' },
  'tk-sec': { id: 5, nombre: 'Secretaria Ficticia', email: 'sec@example.test', rol: 'SECRETARIA', permisos: ['mensajes:leer', 'configuracion:leer'], modo: 'por_roles' },
  'tk-heredado': { id: 1, nombre: 'Gerente Ficticia', email: 'gerente@example.test', rol: 'GERENTE_GENERAL', permisos: ALL, modo: 'heredado' },
};
const initialUsers = () => [
  { id: 1, nombre: 'Gerente Ficticia', email: 'gerente@example.test', activo: true, rol: 'GERENTE_GENERAL', createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 2, nombre: 'José Pendiente', email: 'jose@example.test', activo: true, rol: null, createdAt: '2026-10-16T10:00:00.000Z' },
  { id: 3, nombre: 'Coordinadora Ficticia', email: 'coord@example.test', activo: true, rol: 'COORDINADORA_INSTITUCIONAL', createdAt: '2026-10-02T10:00:00.000Z' },
  { id: 4, nombre: 'Ana Inactiva', email: 'ana@example.test', activo: false, rol: null, createdAt: '2026-10-03T10:00:00.000Z' },
  { id: 5, nombre: 'Secretaria Ficticia', email: 'sec@example.test', activo: true, rol: 'SECRETARIA', createdAt: '2026-10-04T10:00:00.000Z' },
];
const fresh = () => ({ users: initialUsers(), role: 'ok', roleDelay: 0, requests: [] });
let sim = fresh();

const handler = async (req, res, { route, json, body }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'clear') sim = fresh(); else sim[key] = key.endsWith('Delay') ? Number(value) : value; return json({ ok: true }) || true; }
  if (route === '/__state') return json({ requests: sim.requests, users: sim.users }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const data = req.method === 'PUT' || req.method === 'POST' ? await body() : undefined;
  sim.requests.push({ method: req.method, route, token, body: data });
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  const who = SESSIONS[token];
  if (route === '/api/admin/me') return (who ? json({ ok: true, user: { id: who.id, nombre: who.nombre, email: who.email, rol: who.rol, permisos: who.permisos }, acceso: { modo: who.modo } }) : json({ ok: false }, 401)) || true;
  if (!who) return json({ ok: false }, 401) || true;
  const has = permission => who.permisos.includes(permission);
  let m;
  if (route === '/api/admin/users' && req.method === 'GET') return (has('cuentas:leer') ? json({ ok: true, users: sim.users }) : json({ ok: false, mensaje: 'No tienes permiso.' }, 403)) || true;
  if ((m = route.match(/^\/api\/admin\/users\/(\d+)\/rol$/)) && req.method === 'PUT') {
    if (!has('cuentas:asignar_rol')) return json({ ok: false, mensaje: 'No tienes permiso.' }, 403) || true;
    if (sim.roleDelay) await sleep(sim.roleDelay);
    if (sim.role === '409') return json({ statusCode: 409, message: 'El rol de esta cuenta cambió mientras la consultabas. Actualiza la lista y vuelve a intentarlo.' }, 409) || true;
    if (sim.role === '500') return json({ statusCode: 500, message: 'Internal server error ER_SECRET_DETAIL' }, 500) || true;
    const user = sim.users.find(u => u.id === Number(m[1]));
    user.rol = data.rol;
    return json({ ok: true, mensaje: data.rol ? 'Rol actualizado. La cuenta deberá iniciar sesión de nuevo.' : 'Rol retirado.', user: { id: user.id, rol: user.rol } }) || true;
  }
  if ((m = route.match(/^\/api\/admin\/users\/(\d+)$/)) && req.method === 'PUT') {
    if (!has('cuentas:editar')) return json({ ok: false, mensaje: 'No tienes permiso.' }, 403) || true;
    const user = sim.users.find(u => u.id === Number(m[1])); user.activo = data.activo; user.rol = null;
    return json({ ok: true, mensaje: data.activo ? 'Cuenta activada sin rol.' : 'Cuenta desactivada, rol retirado y sesiones revocadas.' }) || true;
  }
  return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'roles', handler });
  const { ck, open } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + value);
  const state = () => fetch(k.origin + '/__state').then(r => r.json());
  const writes = async () => (await state()).requests.filter(r => r.method === 'PUT');
  const userGets = async token => (await state()).requests.filter(r => r.method === 'GET' && r.route === '/api/admin/users' && (!token || r.token === token));
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const as = async (token, route, width) => { const p = await open(width); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(token) + '); 1'); await p.go(route); return p; };
  const TABLE = 'document.querySelector("[data-accounts] tbody tr")';
  const rows = p => p.evaluate('[...document.querySelectorAll("[data-accounts] tbody tr")].map(tr => ({ name: tr.querySelector("strong")?.textContent, status: tr.dataset.accountStatus, text: tr.innerText.replace(/\\s+/g, " ") }))');
  const setSelect = (p, label, value) => p.evaluate('(() => { const el = document.querySelector(\'select[aria-label="' + label + '"]\'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ' + JSON.stringify(value) + '); el.dispatchEvent(new Event("change", { bubbles: true })); return 1 })()');
  const setSearch = (p, value) => p.evaluate('(() => { const el = document.querySelector("[data-accounts] input[type=search]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ' + JSON.stringify(value) + '); el.dispatchEvent(new Event("input", { bubbles: true })); return 1 })()');
  const pickRole = (p, text) => p.evaluate('(() => { const label = [...document.querySelectorAll("dialog[open] .hp-role-option")].find(l => l.innerText.includes(' + JSON.stringify(text) + ')); label.querySelector("input").click(); return 1 })()');
  const confirmBtn = 'document.querySelector("dialog[open] button[type=submit]")';

  console.log('\n== MENÚ, LISTADO Y CUENTAS PENDIENTES (GERENTE, por_roles)');
  await clean();
  { const p = await as(TOKEN, '/admin/dashboard?section=configuracion');
    await p.wait('document.querySelector("aside nav")', 'menú');
    ck((await p.text('aside nav')).includes('ADMINISTRACIÓN') && (await p.text('aside nav')).includes('Roles y usuarios'), 'el gerente ve «Roles y usuarios» en el grupo ADMINISTRACIÓN');
    await p.click('aside nav .hp-nav-item', 'Roles y usuarios'); await p.wait(TABLE, 'listado de cuentas');
    ck((await p.path()) === '/admin/dashboard?section=cuentas' && (await p.text('main h1')) === 'Roles y usuarios', 'abre /admin/dashboard?section=cuentas con el título «Roles y usuarios»');
    const list = await rows(p);
    ck(list.length === 5, 'lista las 5 cuentas que devuelve el servidor (sin datos fijos en el código)', list.length);
    const pending = list.find(r => r.name?.startsWith('José'));
    ck(pending?.status === 'pendiente' && pending.text.includes('Cuenta básica') && pending.text.includes('Asignar rol'), 'la cuenta activa sin rol aparece como «Cuenta básica» con «Asignar rol»', pending);
    ck(list.find(r => r.name?.startsWith('Ana'))?.status === 'inactiva', 'una cuenta desactivada no se cuenta como pendiente');
    const own = list.find(r => r.name?.startsWith('Gerente'));
    ck(own.text.includes('Tu cuenta') && !own.text.includes('Cambiar rol') && !own.text.includes('Desactivar'), 'la propia cuenta no ofrece cambiar su rol ni desactivarse', own.text);
    // La fila muestra la insignia «Sin rol»: lo que se comprueba son sus botones.
    ck(JSON.stringify(await p.evaluate('[...[...document.querySelectorAll("[data-accounts] tbody tr")].find(tr => tr.innerText.includes("Ana")).querySelectorAll("button")].map(b => b.textContent.trim())')) === '["Activar"]', 'una cuenta desactivada no ofrece cambiar el rol (solo activar)');
    ck((await p.text('.hw-insights')).replace(/\s+/g, ' ').includes('Básicas 1'), 'el resumen cuenta 1 cuenta básica (sin rol)');

    console.log('\n== BÚSQUEDA Y FILTROS');
    await setSearch(p, 'jose'); await sleep(100);
    ck((await rows(p)).length === 1, 'la búsqueda ignora tildes y mayúsculas (jose → José)');
    await setSearch(p, ''); await setSelect(p, 'Filtrar por rol', 'pendientes'); await sleep(100);
    ck(JSON.stringify((await rows(p)).map(r => r.status)) === '["pendiente"]', 'filtro «Cuentas básicas (sin rol)»');
    await setSelect(p, 'Filtrar por rol', 'todos'); await setSelect(p, 'Filtrar por estado', 'inactivas'); await sleep(100);
    ck(JSON.stringify((await rows(p)).map(r => r.status)) === '["inactiva"]', 'filtro por estado «Desactivadas»');
    await setSelect(p, 'Filtrar por estado', 'todas'); await setSelect(p, 'Filtrar por rol', 'SECRETARIA'); await sleep(100);
    ck((await rows(p)).length === 1 && (await rows(p))[0].name.startsWith('Secretaria'), 'filtro por rol «Secretaria»');
    await setSelect(p, 'Filtrar por rol', 'todos'); await setSearch(p, 'nadie-coincide'); await sleep(100);
    ck((await p.text('[data-accounts]')).includes('No encontramos coincidencias'), 'sin coincidencias muestra un estado vacío claro');
    await setSearch(p, ''); await sleep(100);
    ck((await writes()).length === 0, 'buscar y filtrar no envían escrituras');

    console.log('\n== CAMBIO DE ROL CON CONFIRMACIÓN');
    await p.click('[data-accounts] button', 'Cambiar el rol de José'); await p.wait('document.querySelector("dialog[open] .hp-role-option")', 'diálogo de rol');
    ck(await p.evaluate(confirmBtn + '.disabled'), 'sin elegir un rol distinto, «Confirmar cambio» está deshabilitado');
    await pickRole(p, 'Gerente general'); await sleep(80);
    ck((await p.text('[data-role-warning]')).includes('acceso completo'), 'elegir Gerente general avisa del acceso completo');
    await p.click('dialog[open] button', 'Cancelar'); await sleep(250);
    ck(!(await p.evaluate('!!document.querySelector("dialog[open]")')) && (await writes()).length === 0, 'Cancelar cierra el diálogo sin enviar nada');
    await ctl('roleDelay', '600');
    await p.click('[data-accounts] button', 'Cambiar el rol de José'); await p.wait('document.querySelector("dialog[open] .hp-role-option")', 'diálogo de rol');
    await pickRole(p, 'Secretaria'); await sleep(80);
    await p.evaluate('document.querySelector("dialog[open] form").requestSubmit(); 1'); await sleep(80);
    await p.evaluate('document.querySelector("dialog[open] form").requestSubmit(); 1'); await p.evaluate(confirmBtn + '.click(); 1');
    ck((await p.text('dialog[open]')).includes('Guardando'), 'mientras el servidor responde se muestra «Guardando…» y no se anuncia éxito');
    await p.wait('!document.querySelector("dialog[open]")', 'cierre tras guardar');
    const sent = await writes();
    ck(sent.length === 1, 'tres envíos rápidos producen una única solicitud', sent.length);
    ck(sent[0].route === '/api/admin/users/2/rol' && JSON.stringify(sent[0].body) === JSON.stringify({ rol: 'SECRETARIA', rol_actual: null }), 'PUT /admin/users/2/rol con { rol, rol_actual } y nada más', sent[0]);
    await p.wait('[...document.querySelectorAll("[data-accounts] tbody tr")].some(tr => tr.innerText.includes("José") && tr.dataset.accountStatus === "activa")', 'lista actualizada');
    ck((await userGets(TOKEN)).length >= 2, 'tras guardar se vuelve a pedir el listado (refleja el estado del servidor)');
    await p.wait('[...document.querySelectorAll("[data-sonner-toast]")].some(t => t.innerText.includes("Rol actualizado"))', 'aviso de éxito');
    ck(true, 'aviso de éxito solo tras la respuesta del servidor');

    console.log('\n== CONFLICTO 409 Y RESULTADO INCIERTO');
    await ctl('roleDelay', '0'); await ctl('role', '409');
    await p.click('[data-accounts] button', 'Cambiar el rol de Coordinadora'); await p.wait('document.querySelector("dialog[open] .hp-role-option")', 'diálogo de rol');
    await pickRole(p, 'Sin rol'); await sleep(80);
    ck((await p.text('[data-role-warning]')).includes('cuenta básica'), 'retirar el rol avisa de que quedará como cuenta básica');
    await p.evaluate(confirmBtn + '.click(); 1'); await p.wait('document.querySelector("dialog[open] .hp-error")', 'error 409');
    ck((await p.text('dialog[open] .hp-error')).includes('cambió mientras la consultabas') && (await p.evaluate('!!document.querySelector("dialog[open]")')), '409: el mensaje del servidor aparece en el diálogo, que sigue abierto');
    await ctl('role', '500'); const before = (await writes()).length;
    await p.evaluate(confirmBtn + '.click(); 1'); await p.wait('document.querySelector("dialog[open]")?.innerText.includes("No pudimos confirmar")', 'resultado incierto');
    const text = await p.text('dialog[open]');
    ck(!/ER_SECRET|Internal server/.test(text) && text.includes('Actualizar la lista') && !(await p.evaluate('!!' + confirmBtn)), '500: resultado incierto, sin texto técnico y sin botón para repetir', text.slice(0, 160));
    await sleep(400); ck((await writes()).length === before + 1, '500: sin reintento automático');
    const gets = (await userGets(TOKEN)).length;
    await p.click('dialog[open] button', 'Actualizar la lista'); await sleep(400);
    ck((await userGets(TOKEN)).length === gets + 1, '«Actualizar la lista» cierra el diálogo y vuelve a consultar las cuentas');

    console.log('\n== DESACTIVAR CON CONFIRMACIÓN');
    await ctl('role', 'ok');
    await p.click('[data-accounts] button', 'Desactivar Secretaria'); await p.wait('document.querySelector("dialog[open]")', 'diálogo de desactivación');
    ck((await p.text('dialog[open]')).includes('perderá su rol') && (await writes()).length === before + 1, 'el diálogo explica las consecuencias antes de enviar nada');
    await p.click('dialog[open] .hp-dialog-footer button', 'Desactivar'); await p.wait('!document.querySelector("dialog[open]")', 'cierre');
    const last = (await writes()).at(-1);
    ck(last.route === '/api/admin/users/5' && JSON.stringify(last.body) === '{"activo":false}', 'PUT /admin/users/5 con { activo: false }', last);
    await p.close(); }

  console.log('\n== PERMISOS: SOLO LECTURA, SIN PERMISO Y MODO HEREDADO');
  await clean();
  { const p = await as('tk-lectura', '/admin/dashboard?section=cuentas'); await p.wait(TABLE, 'listado (solo lectura)');
    ck(!(await p.evaluate('[...document.querySelectorAll("[data-accounts] button")].some(b => /rol|Desactivar|Activar/.test(b.textContent))')), 'con solo cuentas:leer no hay botones de cambiar rol ni de activar/desactivar');
    ck((await writes()).length === 0, 'ninguna escritura'); await p.close(); }
  { const p = await as('tk-sec', '/admin/dashboard?section=cuentas'); await p.wait('document.querySelector("[data-panel-access]")', 'aviso');
    ck((await p.evaluate('document.querySelector("[data-panel-access]").dataset.panelAccess')) === 'denegado' && (await userGets('tk-sec')).length === 0 && !(await p.text('aside')).includes('Roles y usuarios'), 'secretaria: sin «Roles y usuarios» en el menú, aviso de acceso y ninguna consulta de cuentas'); await p.close(); }
  { const p = await as('tk-heredado', '/admin/dashboard?section=cuentas'); await p.wait('document.querySelector("[data-panel-access], .hp-main")', 'panel heredado'); await sleep(400);
    ck((await userGets('tk-heredado')).length === 0 && !(await p.text('aside')).includes('Roles y usuarios'), 'modo heredado (sin AccessGuard): la sección no se ofrece ni se consulta, ni siquiera al gerente'); await p.close(); }

  console.log('\n== MÓVIL (390 px)');
  await clean();
  { const p = await as(TOKEN, '/admin/dashboard?section=cuentas', 390); await p.wait(TABLE, 'listado en móvil');
    ck(await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'la página no desborda horizontalmente (la tabla se desplaza dentro de su tarjeta)');
    await p.click('[data-accounts] button', 'Cambiar el rol de José'); await p.wait('document.querySelector("dialog[open] .hp-role-option")', 'diálogo en móvil');
    ck(await p.evaluate('(() => { const d = document.querySelector("dialog[open]").getBoundingClientRect(); return d.left >= 0 && d.right <= window.innerWidth + 1; })()'), 'el diálogo cabe en la pantalla');
    ck(await p.evaluate('document.activeElement?.textContent === "Cancelar"'), 'el foco inicial está en la acción segura (Cancelar)');
    await p.close(); }

  await k.closePages();
  k.finish('Roles y usuarios');
})().catch(error => { console.error('\nERROR DEL SMOKE: ' + (error && error.message ? error.message : String(error))); process.exit(1); });
