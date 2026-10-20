// Sesión administrativa y contrato de roles (H-BACK-01, E3.4.2) con API simulada: nada real (ni cuentas, ni datos, ni correo). Edge por DevTools.
// Cubre: login y restauración de sesión con los tres roles, una cuenta sin rol, un backend antiguo (sin rol/permisos/acceso), contratos
// parciales, mal formados o incoherentes, roles manipulados en el almacenamiento local, 401 frente a 403 y sincronización entre pestañas.
// E3.4.4 (fase 1): revalidación con /admin/me al recuperar el foco y tras un 403 (intervalo mínimo, sin bucles), cambios y retirada de
// permisos con una sección abierta, errores temporales al revalidar, cambios entre pestañas y login correcto seguido de un fallo de /me.
// El estado se lee del contexto real de React (árbol de fibras) solo desde este script: la aplicación no expone nada para las pruebas.
const { start, sleep, KEY } = require('./smoke-kit.cjs');

// ---------- API simulada ----------
// Listas de permisos ficticias: solo sirven para comprobar que el panel copia lo que informa el backend (no hay matriz en React).
// Desde E3.4.3 el menú se filtra con ellas (lo cubre smoke-panel-access.cjs); aquí solo importa que existan Resumen o Mensajes.
const PERMS = { gerente: ['cuentas:leer', 'cursos:leer', 'estadisticas:leer', 'mensajes:crear', 'mensajes:eliminar', 'mensajes:leer'], coord: ['cursos:leer', 'estadisticas:leer', 'mensajes:crear', 'mensajes:leer'], sec: ['mensajes:crear', 'mensajes:leer'] };
const account = (id, nombre, email, rol, permisos) => ({ id, nombre, email, rol, permisos });
const SEC = account(3, 'Sofía Secretaria', 'sec@example.test', 'SECRETARIA', PERMS.sec);
const FORGED = 'e30.' + Buffer.from(JSON.stringify({ id: 1, rol: 'GERENTE_GENERAL', permisos: ['cuentas:crear'] })).toString('base64url') + '.forjado';
const ACCOUNTS = {
  'tk-gerente': account(1, 'Gloria Gerente', 'gerente@example.test', 'GERENTE_GENERAL', PERMS.gerente),
  'tk-coord': account(2, 'Carla Coordinadora', 'coord@example.test', 'COORDINADORA_INSTITUCIONAL', PERMS.coord),
  'tk-sec': SEC,
  'tk-norol': account(4, 'Nora Sinrol', 'norol@example.test', null, []),
  // La misma cuenta (id 2) antes y después de que le cambiaran el rol: el token anterior queda revocado (401) y el nuevo informa otro rol.
  'tk-coord-v1': account(2, 'Carla Coordinadora', 'coord@example.test', 'COORDINADORA_INSTITUCIONAL', PERMS.coord),
  'tk-coord-v2': account(2, 'Carla Coordinadora', 'coord@example.test', 'SECRETARIA', PERMS.sec),
  [FORGED]: SEC, // un JWT con rol de gerente en su contenido, pero el backend lo reconoce como la secretaria
};
const TOKEN_OF = { gerente: 'tk-gerente', coord: 'tk-coord', sec: 'tk-sec', norol: 'tk-norol' };
// perm: cambios de rol o permisos hechos «en el backend» con la sesión abierta (token → { rol?, permisos? }); modo: acceso.modo informado.
const fresh = () => ({ login: 'nuevo', me: 'nuevo', meDelay: 0, messages: 'ok', seguimiento: 'ok', modo: 'heredado', perm: {}, expired: new Set(), requests: [] });
const MESSAGE = { id: 71, nombre: 'Persona Ficticia', email: 'persona@example.test', telefono: '999999999', asunto: 'Consulta ficticia', mensaje: 'Mensaje ficticio.', estado: 'nuevo', createdAt: '2030-01-01T10:00:00.000Z' };
let sim = fresh();

// Distintas formas de la respuesta (login y /me comparten forma): contrato nuevo, backend antiguo, parcial, mal formado, incoherente.
const shape = (acc, mode) => {
  const user = { id: acc.id, nombre: acc.nombre, email: acc.email };
  if (mode === 'antiguo') return { user };
  if (mode === 'parcial') return { user: { ...user, rol: acc.rol } };
  if (mode === 'malformado') return { user: { ...user, rol: 'ROOT', permisos: ['cuentas:crear'] }, acceso: { modo: 'heredado' } };
  if (mode === 'incoherente') return { user: { ...user, rol: null, permisos: ['cuentas:crear'] }, acceso: { modo: 'heredado' } };
  return { user: { ...user, rol: acc.rol, permisos: acc.permisos }, acceso: { modo: sim.modo } };
};
const current = token => ACCOUNTS[token] && { ...ACCOUNTS[token], ...sim.perm[token] };

const handler = async (req, res, { route, url, json, body }) => {
  if (route.startsWith('/__s/')) {
    const [, , key, value, extra] = route.split('/');
    if (key === 'clear') sim = fresh(); else if (key === 'expire') sim.expired.add(decodeURIComponent(value)); else if (key === 'unexpire') sim.expired.delete(decodeURIComponent(value));
    else if (key === 'perm') sim.perm[decodeURIComponent(value)] = JSON.parse(decodeURIComponent(extra));
    else sim[key] = key === 'meDelay' ? Number(value) : decodeURIComponent(value);
    return json({ ok: true }) || true;
  }
  if (route === '/__log') return json({ requests: sim.requests }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route.startsWith('/api/admin/')) sim.requests.push({ method: req.method, route, token });
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (!route.startsWith('/api/admin/')) return json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 1, limit: 12 } }) || true;
  if (route === '/api/admin/login' && req.method === 'POST') {
    const input = await body(); const who = String(input.email || '').split('@')[0];
    if (input.password !== 'clave-correcta' || !TOKEN_OF[who]) return json({ ok: false, mensaje: 'Credenciales incorrectas.' }, 401) || true;
    return json({ ok: true, mensaje: 'Login correcto.', token: TOKEN_OF[who], ...shape(ACCOUNTS[TOKEN_OF[who]], sim.login) }) || true;
  }
  if (route === '/api/admin/me') {
    if (sim.meDelay) await sleep(sim.meDelay);
    if (!ACCOUNTS[token] || sim.expired.has(token)) return json({ message: 'Unauthorized' }, 401) || true;
    if (sim.me === '503') return json({ message: 'Internal server error ER_SECRET' }, 503) || true;
    if (sim.me === '403') return json({ ok: false, mensaje: 'Forbidden ER_SECRET' }, 403) || true;
    if (sim.me === '404') return json({ message: 'Cannot GET /api/admin/me ER_SECRET' }, 404) || true;
    if (sim.me === 'drop') { req.socket.destroy(); return true; } // red caída: sin respuesta
    return json({ ok: true, ...shape(current(token), sim.me) }) || true;
  }
  if (!ACCOUNTS[token] || sim.expired.has(token)) return json({ message: 'Unauthorized' }, 401) || true;
  const sub = route.slice('/api/admin/'.length);
  // Seguimiento de una consulta (la antigua prueba usaba Información de empresa, retirada del panel): el PUT puede responder 403.
  if (sub === 'seguimiento/messages/71' && req.method === 'PUT' && sim.seguimiento === '403') return json({ ok: false, mensaje: 'No tienes permiso para realizar esta operación. ER_SECRET' }, 403) || true;
  if (sub === 'seguimiento/messages/71' && req.method === 'GET') return json({ ok: true, item: { estado: 'nuevo', responsable: '', notas: '', respuesta: '', revision: 1, historial: [] } }) || true;
  if (sub === 'messages/71') return json({ ok: true, message: MESSAGE }) || true;
  if (sub === 'messages' && sim.messages === '403') return json({ ok: false, mensaje: 'No tienes permiso para realizar esta operación.' }, 403) || true;
  if (sub === 'messages' && sim.messages === '401') return json({ message: 'Unauthorized' }, 401) || true;
  if (sub === 'stats') return json({ ok: true, stats: { mensajes: { total: 0, nuevos: 0, enProceso: 0, atendidos: 0, archivados: 0 }, contenido: { total: 0 }, catalogo: {} }, actividadReciente: { mensajes: [] } }) || true;
  return json({ ok: true, items: [], messages: [], pagination: { page: 1, total: 0, pages: 1, limit: 20 }, metrics: {} }) || true;
};

// Lee el valor del contexto de autenticación del árbol de React vivo (fibra actual del Provider que tiene `isAuthenticated` y `access`).
const READ_CONTEXT = `(() => {
  const container = document.getElementById('root');
  const key = Object.keys(container).find(name => name.startsWith('__reactContainer$'));
  if (!key) return JSON.stringify(null);
  const stack = [container[key].stateNode.current];
  while (stack.length) {
    const fiber = stack.pop(); if (!fiber) continue;
    const value = fiber.memoizedProps && fiber.memoizedProps.value;
    if (value && typeof value === 'object' && 'isAuthenticated' in value && 'access' in value) {
      return JSON.stringify({ auth: value.isAuthenticated, checking: value.checking, access: value.access, user: value.user, token: value.token, sessionError: value.sessionError, endReason: value.endReason });
    }
    stack.push(fiber.sibling, fiber.child);
  }
  return JSON.stringify(null);
})()`;

(async () => {
  const k = await start({ prefix: 'acceso', handler });
  const { ck, open, closePages, origin } = k;
  const ctl = (key, value = '1') => fetch(origin + '/__s/' + key + '/' + encodeURIComponent(value));
  const requests = async () => (await fetch(origin + '/__log').then(r => r.json())).requests;
  const meCalls = async () => (await requests()).filter(r => r.route === '/api/admin/me');
  const ctx = async p => JSON.parse(await p.evaluate(READ_CONTEXT));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clean = async () => { await closePages(); await ctl('clear'); const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.clear(); sessionStorage.clear(); 1'); await closePages(); };
  const navLabels = p => p.evaluate('[...document.querySelectorAll("aside nav .hp-nav-item")].map(b => b.textContent.trim())');
  const SUBMIT = "document.querySelector('.admin-auth__form').requestSubmit(); 1";
  const submit = async (p, who) => { await p.type('#email', 0, who + '@example.test'); await p.type('#password', 0, 'clave-correcta'); await p.evaluate(SUBMIT); };
  // El inicio depende de los permisos (E3.4.3): Resumen en /admin/dashboard o la bandeja en /admin/messages.
  const PANEL = "/^\\/admin\\/(dashboard|messages)$/.test(location.pathname) && document.querySelector('.hp-sidebar')";
  const signIn = async (p, who) => { await p.go('/admin/login'); await submit(p, who); await p.wait(PANEL, 'panel tras iniciar sesión (' + who + ')'); };
  const restore = async (token, route = '/admin/dashboard', extra = '') => { const p = await open(); await p.go('/__empty'); await p.evaluate(extra + 'localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(token) + '); 1'); await p.go(route); return p; };
  const stored = p => p.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')');
  const alertText = p => p.evaluate('(document.querySelector("[role=alert]")?.innerText || "").replace(/\\s+/g, " ").trim()');
  const ROLE_WORDS = /GERENTE|COORDINADORA|SECRETARIA|permisos|cuentas:|mensajes:|cursos:/;

  // ===== 1. Login con contrato nuevo =====
  console.log('\n== LOGIN CON EL CONTRATO NUEVO (rol, permisos y modo en la respuesta)');
  const menus = {};
  for (const [who, token] of Object.entries(TOKEN_OF)) {
    await clean(); const acc = ACCOUNTS[token];
    const p = await open(); await signIn(p, who); const c = await ctx(p);
    ck(c.auth && c.access.contract === 'roles' && c.access.rol === acc.rol && same(c.access.permisos, acc.permisos) && c.access.mode === 'heredado',
      who + ': el panel recibe el rol (' + acc.rol + '), los permisos que informó el backend y el modo heredado', c.access);
    ck(same(c.user, { id: acc.id, nombre: acc.nombre, email: acc.email }), who + ': la identidad conserva sus campos de siempre', c.user);
    ck((await meCalls()).length === 0, who + ': con el contrato completo no hace falta otra consulta a /admin/me');
    const storage = JSON.parse(await p.evaluate('JSON.stringify({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), blob: JSON.stringify(localStorage) + JSON.stringify(sessionStorage) })'));
    ck(same(storage.local, [KEY]) && storage.session.length === 0 && !ROLE_WORDS.test(storage.blob), who + ': rol y permisos no se guardan en el almacenamiento del navegador (solo el token)', storage);
    menus[who] = await navLabels(p);
  }
  // El filtrado por rol se comprueba en smoke-panel-access.cjs; aquí, que la cuenta sin rol conserva el panel heredado completo.
  const first = menus.norol;
  ck(first.includes('Resumen') && first.includes('Estudiantes') && first.includes('Mensajes') && first.includes('Cotizaciones') && first.includes('Consultas del chatbot'),
    'modo heredado: la cuenta sin rol ve el panel completo de siempre, sin filtrar', menus);

  // ===== 2. Backend antiguo =====
  console.log('\n== BACKEND ANTIGUO (sin rol, permisos ni acceso)');
  await clean(); await ctl('login', 'antiguo'); await ctl('me', 'antiguo');
  { const p = await open(); await signIn(p, 'gerente'); const c = await ctx(p); const me = await meCalls();
    ck(me.length === 1 && me[0].token === 'tk-gerente', 'el login antiguo se valida con /admin/me antes de abrir el panel (1 consulta)', me.length);
    ck(c.auth && c.access.contract === 'antiguo' && c.access.mode === 'heredado' && c.access.rol === null && c.access.permisos.length === 0, 'sin datos de roles: modo heredado, sin rol ni permisos inventados', c.access);
    ck(same(await navLabels(p), first), 'el panel actual sigue completo con un backend antiguo'); }

  // ===== 3. Contrato parcial o inválido en el login: manda /admin/me =====
  console.log('\n== RESPUESTAS PARCIALES O MAL FORMADAS EN EL LOGIN');
  for (const mode of ['parcial', 'malformado', 'incoherente']) {
    await clean(); await ctl('login', mode);
    const p = await open(); await signIn(p, 'sec'); const c = await ctx(p); const me = await meCalls();
    ck(me.length === 1 && c.access.contract === 'roles' && c.access.rol === 'SECRETARIA' && same(c.access.permisos, PERMS.sec),
      'login «' + mode + '»: no se usa; el rol sale de /admin/me (SECRETARIA con sus permisos), nunca del login', { me: me.length, access: c.access });
  }
  await clean(); await ctl('login', 'malformado'); await ctl('me', 'malformado');
  { const p = await open(); await p.go('/admin/login'); await submit(p, 'gerente');
    await p.wait('document.querySelector("[role=alert]")', 'aviso de sesión no abierta'); const c = await ctx(p), text = await alertText(p);
    ck((await p.path()) === '/admin/login' && !c.auth && c.access === null && !(await p.evaluate('!!document.querySelector(".hp-sidebar")')), 'login y /admin/me mal formados: el panel no se abre y no se concede ningún acceso', c);
    ck(text.startsWith('No pudimos abrir tu sesión') && !/ROOT|cuentas|SQL|ER_SECRET|undefined/.test(text) && !(await p.evaluate('document.querySelector(".admin-auth__submit").disabled')), 'el formulario se libera con un aviso genérico (sin datos técnicos)', text);
    await ctl('me', 'nuevo'); await ctl('login', 'nuevo'); await p.evaluate(SUBMIT); await p.wait(PANEL, 'panel al reintentar'); const again = await ctx(p);
    ck(again.auth && again.access.rol === 'GERENTE_GENERAL', 'al reintentar con el backend ya correcto el panel abre con el acceso informado'); }

  // ===== 4. Restauración de sesión =====
  console.log('\n== RESTAURACIÓN DE LA SESIÓN (recarga de la página)');
  for (const [who, token] of Object.entries(TOKEN_OF)) {
    await clean(); const acc = ACCOUNTS[token]; const p = await restore(token); await p.wait(PANEL, 'panel restaurado'); const c = await ctx(p); const me = await meCalls();
    ck(me.length === 1 && me[0].token === token && c.auth && c.access.contract === 'roles' && c.access.rol === acc.rol && same(c.access.permisos, acc.permisos) && c.access.mode === 'heredado',
      who + ': la sesión guardada se revalida con /admin/me y recupera rol, permisos y modo', { me: me.length, access: c.access }); }
  await clean(); await ctl('meDelay', '1500');
  { const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'tk-sec'); 1");
    await p.send('Page.navigate', { url: origin + '/admin/dashboard' }); await sleep(600);
    const c = await ctx(p); const loading = await p.evaluate('({ sidebar: !!document.querySelector(".hp-sidebar"), nav: !!document.querySelector("aside nav"), text: document.body.innerText.includes("Cargando panel") })');
    ck(c && !c.auth && c.access === null && c.checking === true && !loading.sidebar && !loading.nav && loading.text, 'mientras se conoce el rol no aparece menú ni funciones: solo «Cargando panel…»', { c, loading });
    await p.wait(PANEL, 'panel tras la validación'); ck((await ctx(p)).access.rol === 'SECRETARIA', 'al terminar la validación el acceso queda disponible'); }
  await clean(); await ctl('me', 'antiguo');
  { const p = await restore('tk-sec'); await p.wait(PANEL, 'panel restaurado (antiguo)'); const c = await ctx(p);
    ck(c.access.contract === 'antiguo' && c.access.rol === null && c.access.permisos.length === 0 && c.access.mode === 'heredado', 'restauración con /admin/me antiguo: modo heredado, sin privilegios inventados', c.access);
    ck(same(await navLabels(p), first), 'y el panel actual sigue completo'); }
  await clean(); await ctl('me', 'malformado');
  { const p = await restore('tk-gerente', '/admin/dashboard'); await p.wait('document.querySelector("main.hp-empty")', 'pantalla de error');
    const c = await ctx(p), text = await p.text('main'); const sidebar = await p.evaluate('!!document.querySelector(".hp-sidebar")');
    ck(!c.auth && c.access === null && !sidebar && text.includes('no es compatible con este panel') && text.includes('Reintentar') && !/ROOT|cuentas|SQL|ER_SECRET/.test(text), '/admin/me mal formado: sin panel ni privilegios; mensaje claro con «Reintentar»', { c, text });
    ck((await stored(p)) === 'tk-gerente', 'la sesión guardada no se borra por una respuesta incompatible (no es un 401)');
    await ctl('me', 'nuevo'); await p.click('main button', 'Reintentar'); await p.wait(PANEL, 'panel tras reintentar');
    ck((await ctx(p)).access.rol === 'GERENTE_GENERAL', '«Reintentar» con el backend corregido abre el panel con el acceso informado'); }
  await clean(); await ctl('me', 'incoherente');
  { const p = await restore('tk-gerente'); await p.wait('document.querySelector("main.hp-empty")', 'pantalla de error (incoherente)'); const c = await ctx(p);
    ck(!c.auth && c.access === null, 'rol null con permisos (incoherente): se rechaza, no se concede nada', c); }
  await clean(); await ctl('me', '503');
  { const p = await restore('tk-gerente'); await p.wait('document.querySelector("main.hp-empty")', 'pantalla de error (503)'); const text = await p.text('main'); const c = await ctx(p);
    ck(!c.auth && c.access === null && text.includes('No pudimos validar tu sesión') && !text.includes('no es compatible') && !/ER_SECRET|Internal/.test(text) && (await stored(p)) === 'tk-gerente', 'fallo temporal del servidor: mensaje propio, sesión conservada y sin acceso hasta validar', text); }

  // ===== 5. Datos locales manipulados =====
  console.log('\n== ROL MANIPULADO EN LOS DATOS LOCALES');
  await clean();
  { const tampered = "localStorage.setItem('horus-admin-role', 'GERENTE_GENERAL'); localStorage.setItem('rol', 'GERENTE_GENERAL'); localStorage.setItem('permisos', '[\"cuentas:crear\"]'); localStorage.setItem('horus-admin-user', JSON.stringify({ id: 1, nombre: 'Gloria Gerente', email: 'gerente@example.test', rol: 'GERENTE_GENERAL', permisos: ['cuentas:crear'] })); sessionStorage.setItem('rol', 'GERENTE_GENERAL'); ";
    const p = await restore(FORGED, '/admin/dashboard', tampered); await p.wait(PANEL, 'panel con almacenamiento manipulado'); const c = await ctx(p);
    ck(c.access.rol === 'SECRETARIA' && same(c.access.permisos, PERMS.sec) && c.user.id === 3, 'ni las claves locales ni un JWT con «rol» en su contenido cambian el acceso: lo informa el backend (SECRETARIA)', c);
    const keys = await p.evaluate('Object.keys(localStorage).sort().join()');
    ck(keys === ['horus-admin-role', 'horus-admin-token', 'horus-admin-user', 'permisos', 'rol'].sort().join(), 'el panel no escribe rol ni permisos en el almacenamiento', keys); }

  // ===== 6. 401 frente a 403 =====
  console.log('\n== 401 CIERRA LA SESIÓN, 403 NO');
  await clean(); await ctl('messages', '403');
  { const p = await restore('tk-sec', '/admin/messages'); await p.wait(PANEL, 'panel'); await p.wait("location.pathname === '/admin/messages'", 'bandeja'); await sleep(1500);
    const c = await ctx(p); const hit = (await requests()).some(r => r.route === '/api/admin/messages' && r.token === 'tk-sec');
    ck(hit && (await p.path()).startsWith('/admin/messages') && c.auth && c.access.rol === 'SECRETARIA' && (await stored(p)) === 'tk-sec', 'un 403 de una petición no cierra la sesión: sigue autenticada, con su acceso y su token', { hit, path: await p.path(), auth: c.auth });
    ck(!/ER_SECRET|statusCode/.test(await p.text()), 'y no muestra texto técnico'); }
  await clean(); await ctl('messages', '401');
  { const p = await restore('tk-sec', '/admin/messages');
    await p.wait("location.pathname === '/admin/login'", 'login tras el 401'); const c = await ctx(p);
    ck(!c.auth && c.access === null && (await stored(p)) === null && c.endReason === 'expired', 'un 401 sí cierra la sesión: sin acceso, sin token guardado y con el aviso de sesión terminada', c);
    ck((await p.text()).includes('Tu sesión terminó'), 'el login informa que la sesión terminó'); }
  await clean(); await ctl('expire', 'tk-gerente');
  { const p = await restore('tk-gerente'); await p.wait('location.pathname === "/admin/login"', 'login por /admin/me 401'); const c = await ctx(p);
    ck(!c.auth && c.access === null && (await stored(p)) === null, '/admin/me con 401 (sesión revocada o cuenta desactivada): vuelve al login sin acceso'); }

  // ===== 7. Pestañas =====
  console.log('\n== SINCRONIZACIÓN ENTRE PESTAÑAS');
  await clean();
  { const a = await restore('tk-sec'); await a.wait(PANEL, 'pestaña A'); const b = await restore('tk-sec'); await b.wait(PANEL, 'pestaña B');
    ck((await ctx(b)).access.rol === 'SECRETARIA' && same((await ctx(b)).access.permisos, PERMS.sec), 'la segunda pestaña revalida la sesión y obtiene el mismo acceso');
    await b.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.includes('Cerrar sesión')).click(); 1");
    await a.wait("location.pathname === '/admin/login'", 'pestaña A tras el cierre en B'); const c = await ctx(a);
    ck(!c.auth && c.access === null, 'cerrar sesión en una pestaña deja a la otra sin acceso en memoria'); }
  await clean();
  { const a = await restore('tk-coord-v1'); await a.wait(PANEL, 'pestaña A (rol anterior)'); ck((await ctx(a)).access.rol === 'COORDINADORA_INSTITUCIONAL', 'pestaña A: sesión con el rol anterior');
    const b = await open(); await b.go('/__empty'); await b.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'tk-coord-v2'); 1");
    for (let i = 0; i < 40 && !(await meCalls()).some(r => r.token === 'tk-coord-v2'); i++) await sleep(100); // A valida en reserva el token nuevo de la misma cuenta
    ck((await ctx(a)).access.rol === 'COORDINADORA_INSTITUCIONAL' && (await ctx(a)).token === 'tk-coord-v1', 'el token nuevo no sustituye la sesión validada hasta que ésta falle (sigue con el rol anterior)');
    await ctl('expire', 'tk-coord-v1'); await a.click('aside nav .hp-nav-item', 'Mensajes');
    for (let i = 0; i < 40 && (await ctx(a)).token !== 'tk-coord-v2'; i++) await sleep(100); const c = await ctx(a);
    ck(c.auth && c.token === 'tk-coord-v2' && c.access.rol === 'SECRETARIA' && same(c.access.permisos, PERMS.sec) && (await a.path()).startsWith('/admin/') && (await stored(a)) === 'tk-coord-v2',
      'al caducar el token anterior (401) la pestaña pasa en silencio al nuevo y adopta el acceso nuevo ya validado', c); }
  await clean();
  { const a = await restore('tk-sec'); await a.wait(PANEL, 'pestaña A'); const b = await open(); await b.go('/__empty');
    await b.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'tk-gerente'); 1");
    for (let i = 0; i < 60 && (await ctx(a)).access?.rol !== 'GERENTE_GENERAL'; i++) await sleep(100); const c = await ctx(a);
    ck(c.auth && c.user.id === 1 && c.access.rol === 'GERENTE_GENERAL' && same(c.access.permisos, PERMS.gerente), 'otra cuenta iniciada en otra pestaña: esta pestaña adopta su identidad y su acceso, sin mezclar los de la anterior', c);
    await b.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'tk-ajeno'); 1"); await sleep(1500);
    const after = await ctx(a);
    ck(after.auth && after.access.rol === 'GERENTE_GENERAL' && (await stored(a)) === 'tk-gerente', 'un token que el backend rechaza no sustituye la sesión validada ni su acceso'); }

  // ===== 8. E3.4.4, fase 1: permisos que cambian con la sesión abierta =====
  // El intervalo mínimo entre revalidaciones (30 s con foco, 5 s tras un 403) se adelanta moviendo el reloj monótono SOLO de la página de
  // prueba (performance.now), sin esperar: la aplicación no expone nada para las pruebas.
  const skew = (p, ms) => p.evaluate('(() => { if (!window.__horusSkew) { const base = performance.now.bind(performance); window.__horusSkew = { ms: 0 }; performance.now = () => base() + window.__horusSkew.ms; } window.__horusSkew.ms += ' + ms + '; return 1 })()');
  const FOCUS = "window.dispatchEvent(new Event('focus')); 1";
  const later = async (p, ms = 31000) => { await skew(p, ms); await p.evaluate(FOCUS); };
  const perm = (token, value) => fetch(origin + '/__s/perm/' + encodeURIComponent(token) + '/' + encodeURIComponent(JSON.stringify(value)));
  const waitMe = async n => { for (let i = 0; i < 60 && (await meCalls()).length < n; i++) await sleep(100); return (await meCalls()).length; };
  const count = async route => (await requests()).filter(r => r.route === route).length;
  const DENIED = 'Tu cuenta no tiene permiso para realizar esta acción';
  const NO_RESUMEN = "document.querySelector('aside nav') && !document.querySelector('aside nav').innerText.includes('Resumen')";
  const inbox = async p => { await p.wait(PANEL, 'panel'); await p.wait("location.pathname === '/admin/messages' && document.querySelector('.hw-insights button')", 'bandeja'); };

  console.log('\n== PERMISOS QUE CAMBIAN CON LA SESIÓN ABIERTA (revalidación con /admin/me)');
  await clean();
  { const p = await restore('tk-coord', '/admin/messages'); await inbox(p); const before = await navLabels(p);
    for (let i = 0; i < 5; i++) await p.evaluate(FOCUS);
    await sleep(500);
    ck((await meCalls()).length === 1, 'recuperar el foco varias veces seguidas no repite /admin/me (intervalo mínimo)', (await meCalls()).length);
    await perm('tk-coord', { permisos: [...PERMS.coord].reverse() }); await later(p); await waitMe(2); await sleep(300);
    ck((await meCalls()).length === 2 && same(await navLabels(p), before), 'pasado el intervalo el foco revalida; los mismos permisos (en otro orden) no cambian el panel', (await meCalls()).length);
    await perm('tk-coord', { rol: 'SECRETARIA', permisos: PERMS.sec }); await later(p); await p.wait(NO_RESUMEN, 'menú con los permisos nuevos');
    const c = await ctx(p);
    ck(c.auth && c.token === 'tk-coord' && c.access.rol === 'SECRETARIA' && same(c.access.permisos, PERMS.sec) && (await stored(p)) === 'tk-coord' && (await p.path()) === '/admin/messages',
      'cambio de rol informado por el backend: se adopta sin cerrar la sesión ni salir de la sección abierta', c);
    ck(!(await navLabels(p)).includes('Resumen') && (await navLabels(p)).includes('Mensajes'), 'el menú se adapta a los permisos nuevos', await navLabels(p));
    await perm('tk-coord', { rol: 'SECRETARIA', permisos: ['mensajes:crear'] });
    await skew(p, 31000); await p.send('Page.bringToFront'); await p.evaluate("document.dispatchEvent(new Event('visibilitychange')); 1");
    await p.wait("document.querySelector('[data-panel-access=denegado]')", 'aviso de acceso no autorizado');
    const listed = await count('/api/admin/messages'); await sleep(1500); const after = await ctx(p);
    ck(await count('/api/admin/messages') === listed && after.auth && same(after.access.permisos, ['mensajes:crear']) && (await stored(p)) === 'tk-coord' && !(await p.evaluate("!!document.querySelector('.hw-insights')")),
      'permiso de lectura retirado con la bandeja abierta (al volver a la pestaña): la sección se desmonta, no hace más solicitudes y la sesión sigue abierta', after);
    ck(!/venció|terminó/.test(await p.text()), 'la retirada de un permiso no se presenta como una sesión vencida'); }

  console.log('\n== 403 EN UNA OPERACIÓN: MENSAJE CLARO, SESIÓN ABIERTA Y SIN BUCLES');
  await clean();
  { const p = await restore('tk-sec', '/admin/messages'); await inbox(p);
    await ctl('messages', '403'); await skew(p, 6000); const me0 = (await meCalls()).length;
    await p.evaluate("document.querySelectorAll('.hw-insights button')[1].click(); 1");
    await p.wait('document.body.innerText.includes(' + JSON.stringify(DENIED) + ')', 'mensaje de acceso denegado'); await sleep(1500);
    const c = await ctx(p), text = await p.text(), me1 = (await meCalls()).length, list1 = await count('/api/admin/messages');
    ck(c.auth && c.access.rol === 'SECRETARIA' && (await stored(p)) === 'tk-sec' && (await p.path()).startsWith('/admin/messages'), '403 en una operación: la sesión sigue abierta, con su acceso y en la misma sección', c);
    ck(!/venció|terminó|No tienes permiso para realizar esta operación|ER_SECRET|statusCode/.test(text), '403: mensaje uniforme del panel; ni «Tu sesión venció» ni el texto del servidor');
    ck(me1 === me0 + 1, 'el 403 provoca una sola revalidación de los permisos con /admin/me', { me0, me1 });
    await sleep(1500);
    ck((await meCalls()).length === me1 && await count('/api/admin/messages') === list1, 'tras el acceso denegado no hay reintentos automáticos ni consultas repetidas');
    await p.evaluate("document.querySelectorAll('.hw-insights button')[2].click(); 1"); await sleep(1000);
    ck((await meCalls()).length === me1 && await count('/api/admin/messages') === list1 + 1, 'un segundo 403 inmediato (acción de la persona) no vuelve a consultar /admin/me dentro del intervalo'); }
  await clean();
  { const p = await restore('tk-sec', '/admin/messages'); await inbox(p);
    await perm('tk-sec', { permisos: ['mensajes:crear'] }); await ctl('messages', '403'); await skew(p, 6000);
    await p.evaluate("document.querySelectorAll('.hw-insights button')[1].click(); 1");
    await p.wait("document.querySelector('[data-panel-access=denegado]')", 'aviso tras la revalidación'); const c = await ctx(p);
    ck(c.auth && same(c.access.permisos, ['mensajes:crear']) && (await stored(p)) === 'tk-sec', '403 cuya revalidación confirma la retirada del permiso: la sección se desmonta y la sesión sigue abierta', c); }
  await clean(); await ctl('seguimiento', '403');
  { // En el backend ya se retiró seguimiento_mensajes:editar, pero esta pestaña aún lo tenía: el guardado recibe 403.
    const FOLLOW = '.hw-inbox-detail form';
    const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'tk-coord'); 1");
    await perm('tk-coord', { permisos: [...PERMS.coord, 'seguimiento_mensajes:leer', 'seguimiento_mensajes:editar'] });
    await p.go('/admin/messages?id=71'); await p.wait("document.querySelector('" + FOLLOW + " fieldset:not(:disabled) textarea')", 'seguimiento editable');
    await perm('tk-coord', { permisos: [...PERMS.coord, 'seguimiento_mensajes:leer'] });
    await p.type(FOLLOW + ' textarea', 0, 'Nota en edición'); await skew(p, 6000); await p.click(FOLLOW + ' button', 'Guardar seguimiento');
    await p.wait("document.querySelector('.hw-inbox-detail [data-panel-readonly]')", 'modo consulta tras la revalidación');
    const state = await p.evaluate("({ value: document.querySelector('" + FOLLOW + " textarea').value, error: document.querySelector('" + FOLLOW + " .hp-error')?.innerText || '', disabled: document.querySelector('" + FOLLOW + " fieldset').disabled })");
    const c = await ctx(p);
    ck(state.value === 'Nota en edición' && state.error.startsWith(DENIED) && state.disabled && c.auth && (await stored(p)) === 'tk-coord',
      '403 al guardar: el borrador se conserva a la vista, se informa sin datos técnicos y, revalidado el permiso, la sección pasa a modo consulta', state);
    ck(!/ER_SECRET|venció/.test(await p.text()), 'sin texto del servidor ni «sesión vencida»'); }

  console.log('\n== ERRORES TEMPORALES O RESPUESTAS INESPERADAS AL REVALIDAR');
  await clean();
  { const p = await restore('tk-sec', '/admin/messages'); await inbox(p);
    await perm('tk-sec', { permisos: [...PERMS.sec, 'estadisticas:leer'] }); // el cambio no debe adoptarse a partir de una respuesta fallida
    // Llamadas de la aplicación a /admin/me, contadas dentro de la página: con la conexión cortada sin respuesta («drop») el propio navegador
    // repite la petición en otra conexión antes de dar el error a fetch, así que el registro del servidor no mide lo que hace el panel.
    await p.evaluate("(() => { const original = window.fetch; window.__horusMe = 0; window.fetch = (input, init) => { if (String(input && input.url || input).endsWith('/admin/me')) window.__horusMe++; return original(input, init); }; return 1 })()");
    const appMe = () => p.evaluate('window.__horusMe');
    for (const mode of ['503', 'drop', '403', '404', 'malformado']) {
      await ctl('me', mode); const n = (await meCalls()).length, a = await appMe(); await later(p); await waitMe(n + 1); await sleep(700);
      const c = await ctx(p); const sidebar = await p.evaluate('!!document.querySelector(".hp-sidebar") && !!document.querySelector(".hw-insights")');
      ck((await appMe()) === a + 1 && (mode === 'drop' || (await meCalls()).length === n + 1) && c.auth && c.access.rol === 'SECRETARIA' && same(c.access.permisos, PERMS.sec) && !c.sessionError && (await stored(p)) === 'tk-sec' && sidebar && (await p.path()) === '/admin/messages',
        '/admin/me «' + mode + '» al revalidar: una sola consulta; se conserva el acceso conocido, sin inventar permisos, sin cerrar la sesión y sin desmontar la sección', { mode, app: (await appMe()) - a, server: (await meCalls()).length - n, c });
    }
    const settled = (await meCalls()).length, settledApp = await appMe(); await sleep(2000);
    ck((await meCalls()).length === settled && (await appMe()) === settledApp, 'los fallos al revalidar (incluido un 403 de /admin/me) no generan reintentos ni bucles');
    await ctl('me', 'nuevo'); await later(p); await p.wait("document.querySelector('aside nav').innerText.includes('Resumen')", 'menú tras la recuperación');
    ck(same((await ctx(p)).access.permisos, [...PERMS.sec, 'estadisticas:leer']), 'recuperado el servidor, la siguiente revalidación adopta los permisos nuevos');
    await ctl('expire', 'tk-sec'); await later(p); await p.wait("location.pathname === '/admin/login'", 'login tras el 401 al revalidar'); const c = await ctx(p);
    ck(!c.auth && c.access === null && (await stored(p)) === null && c.endReason === 'expired' && (await p.text()).includes('Tu sesión terminó'), '401 al revalidar: se aplica el cierre de sesión de siempre', c); }

  console.log('\n== BACKEND ANTIGUO Y CUENTA SIN ROL AL REVALIDAR');
  await clean(); await ctl('me', 'antiguo');
  { const p = await restore('tk-sec'); await p.wait(PANEL, 'panel (antiguo)'); const before = await navLabels(p); await later(p); await waitMe(2); await sleep(300); const c = await ctx(p);
    ck((await meCalls()).length === 2 && c.access.contract === 'antiguo' && c.access.permisos.length === 0 && same(await navLabels(p), before) && same(before, first), 'backend antiguo: la revalidación mantiene el panel heredado completo, sin roles inventados', c.access); }
  await clean();
  { const p = await restore('tk-norol'); await p.wait(PANEL, 'panel (sin rol)'); const before = await navLabels(p); await later(p); await waitMe(2); await sleep(300);
    ck(same(await navLabels(p), before) && same(before, first), 'cuenta sin rol en modo heredado: la revalidación conserva el panel completo');
    await ctl('modo', 'por_roles'); await later(p); await p.wait("document.querySelector('[data-panel-access=sin-rol]')", 'aviso de cuenta sin rol'); const c = await ctx(p);
    ck(c.auth && c.access.mode === 'por_roles' && c.access.rol === null && !(await navLabels(p)).includes('Resumen'), 'si el backend pasa a por_roles, la cuenta sin rol deja de ver las secciones de trabajo (sesión abierta, aviso propio)', c.access); }

  console.log('\n== PERMISOS QUE CAMBIAN ENTRE PESTAÑAS');
  await clean();
  { const a = await restore('tk-coord'); await a.wait(PANEL, 'pestaña A'); const b = await restore('tk-coord'); await b.wait(PANEL, 'pestaña B');
    await perm('tk-coord', { rol: 'SECRETARIA', permisos: PERMS.sec });
    await later(b); await b.wait(NO_RESUMEN, 'pestaña B con los permisos nuevos');
    ck((await ctx(a)).access.rol === 'COORDINADORA_INSTITUCIONAL', 'la otra pestaña no recibe permisos por el almacenamiento: los obtiene del backend al revalidar');
    await later(a); await a.wait(NO_RESUMEN, 'pestaña A al volver a ella'); const c = await ctx(a);
    const blob = await a.evaluate('JSON.stringify(localStorage) + JSON.stringify(sessionStorage)');
    ck(c.auth && c.access.rol === 'SECRETARIA' && same(c.access.permisos, PERMS.sec) && c.token === 'tk-coord' && (await stored(a)) === 'tk-coord' && !ROLE_WORDS.test(blob),
      'al volver a la otra pestaña, ésta revalida y adopta el mismo acceso (la misma sesión, sin guardar rol ni permisos)', c); }

  console.log('\n== LOGIN CORRECTO SEGUIDO DE UN FALLO DE /admin/me');
  const AFTER_LOGIN = { '401': 'no la aceptó', '403': 'no permitió comprobar', '503': 'no respondió', drop: 'no respondió', malformado: 'no es compatible', '404': 'no es compatible' };
  for (const [mode, phrase] of Object.entries(AFTER_LOGIN)) {
    await clean(); await ctl('login', 'antiguo'); if (mode === '401') await ctl('expire', 'tk-gerente'); else await ctl('me', mode);
    const p = await open(); await p.go('/admin/login'); await submit(p, 'gerente');
    await p.wait('document.querySelector("#login-error")', 'aviso tras el fallo de /admin/me (' + mode + ')');
    const c = await ctx(p), text = await p.text('#login-error');
    const form = await p.evaluate('({ sidebar: !!document.querySelector(".hp-sidebar"), disabled: document.querySelector(".admin-auth__submit").disabled, email: document.querySelector("#email").value, password: document.querySelector("#password").value.length > 0 })');
    ck(text.startsWith('No pudimos abrir tu sesión') && text.includes(phrase) && !/ER_SECRET|Internal|Unauthorized|Forbidden|Cannot|ROOT/.test(text), 'login + /admin/me «' + mode + '»: motivo propio y sin datos técnicos', text);
    ck(!c.auth && c.access === null && c.token === null && (await stored(p)) === null && c.endReason !== 'expired' && !form.sidebar && !form.disabled && form.email && form.password,
      'login + /admin/me «' + mode + '»: sin sesión a medias (token descartado) y formulario libre con los datos ingresados', { c, form });
    await ctl('me', 'antiguo'); await ctl('unexpire', 'tk-gerente'); const n = (await meCalls()).length;
    await p.evaluate(SUBMIT); await p.wait(PANEL, 'panel al reintentar (' + mode + ')'); const again = await ctx(p);
    ck(again.auth && again.access.contract === 'antiguo' && (await stored(p)) === 'tk-gerente' && (await meCalls()).length === n + 1, 'login + /admin/me «' + mode + '»: al reintentar con el servidor disponible el panel abre (una sola validación)', again);
  }

  console.log('\n== LOGIN FALLIDO CON LA SESIÓN DE OTRA PESTAÑA GUARDADA');
  await clean(); await ctl('login', 'antiguo');
  { const x = await restore('tk-coord'); await x.wait(PANEL, 'pestaña con la sesión anterior');
    await ctl('me', '503'); const y = await open(); await y.go('/admin/login'); await y.wait('document.querySelector("#email") && !document.querySelector(".admin-auth__submit").disabled', 'formulario de login');
    await submit(y, 'gerente'); await y.wait('document.querySelector("#login-error")', 'aviso tras el fallo de /admin/me');
    const cy = await ctx(y), cx = await ctx(x);
    ck(!cy.auth && cy.access === null && cy.token === null && (await stored(y)) === 'tk-coord' && (await y.text('#login-error')).includes('no respondió'),
      'login fallido: el token nuevo se descarta, se restablece el guardado antes y esta pestaña NO lo adopta como sesión', cy);
    ck(cx.auth && cx.token === 'tk-coord' && cx.access.rol === 'COORDINADORA_INSTITUCIONAL' && cx.user.email === 'coord@example.test', 'la otra pestaña conserva su sesión y su acceso, sin mezclarse con la cuenta del login fallido', cx);
    // La sesión restablecida fue revocada en el servidor: al volver a la pestaña se valida con /admin/me y el 401 la descarta; nunca abre el panel.
    await ctl('me', 'nuevo'); await ctl('expire', 'tk-coord'); await later(y); await sleep(1000); const after = await ctx(y);
    ck(!after.auth && after.access === null && (await stored(y)) === null && !(await y.evaluate('!!document.querySelector(".hp-sidebar")')), 'una sesión anterior revocada no se recupera tras el login fallido (401 al validarla)', after); }

  k.finish('Sesión administrativa y contrato de roles');
})().catch(error => { console.error('FALLO DEL SMOKE:', error.message); process.exit(1); });
