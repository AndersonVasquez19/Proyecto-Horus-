// Navegación del panel por permisos (H-BACK-01, E3.4.3, fase 1) con API simulada: nada real (ni cuentas, ni datos, ni correo). Edge por DevTools.
// Cubre: menú e inicio de los tres roles en modo heredado y por_roles, backend antiguo, cuenta sin rol (heredado y por_roles), Biblioteca
// solo con items:leer, enlaces directos a secciones sin permiso (aviso, sin redirección y sin solicitudes a la API), «Roles y usuarios»
// solo para el gerente en por_roles, 401 frente a 403 (también en el cambio de contraseña), direcciones y navegación atrás/adelante conservadas.
// Las listas de permisos de cada rol se leen del código del backend (como hace el servidor real); el panel solo recibe la lista.
const fs = require('node:fs');
const path = require('node:path');
const { start, sleep, KEY } = require('./smoke-kit.cjs');

const backend = file => fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'src', 'permissions', file), 'utf8');
const literals = text => [...text.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map(match => match[1]);
const policy = backend('policy.ts');
const roleList = name => literals(policy.match(new RegExp('const ' + name + ': readonly Permission\\[\\] = \\[([\\s\\S]*?)\\];'))[1]);
const ALL = [...backend('permissions.ts').match(/RESOURCE_OPERATIONS = \{([\s\S]*?)\} as const/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .flatMap(([, resource, ops]) => [...ops.matchAll(/'([a-z_]+)'/g)].map(op => resource + ':' + op[1]));
const PERMS = { GERENTE_GENERAL: ALL, COORDINADORA_INSTITUCIONAL: roleList('COORDINADORA_INSTITUCIONAL'), SECRETARIA: roleList('SECRETARIA') };

// ---------- API simulada ----------
const account = (id, nombre, rol, permisos = rol ? PERMS[rol] : []) => ({ id, nombre, email: nombre.split(' ')[0].toLowerCase() + '@example.test', rol, permisos });
const ACCOUNTS = {
  'tk-gerente': account(1, 'Gloria Gerente', 'GERENTE_GENERAL'),
  'tk-coord': account(2, 'Carla Coordinadora', 'COORDINADORA_INSTITUCIONAL'),
  'tk-sec': account(3, 'Sofía Secretaria', 'SECRETARIA'),
  'tk-norol': account(4, 'Nora Sinrol', null),
  'tk-items': account(5, 'Irene Biblioteca', 'SECRETARIA', ['items:leer', 'mensajes:leer']),
};
const LOGIN = { gerente: 'tk-gerente', coord: 'tk-coord', sec: 'tk-sec' };
// Permiso de lectura que exige cada GET del panel (backend/src/permissions/route-inventory.ts). Sirve para vigilar que ninguna cuenta
// pida datos de una sección que no puede abrir.
const READ = [['stats', 'estadisticas:leer'], ['messages', 'mensajes:leer'], ['cotizaciones', 'cotizaciones:leer'], ['servicios', 'servicios:leer'], ['cursos', 'cursos:leer'],
  ['preguntas-frecuentes', 'preguntas_frecuentes:leer'], ['galeria', 'galeria:leer'], ['convenios', 'convenios:leer'], ['items', 'items:leer'], ['chatbot', 'chatbot_consultas:leer'],
  ['settings', 'configuracion:leer'], ['users', 'cuentas:leer'], ['contenido-original', 'contenido_original:leer'], ['seguimiento', 'seguimiento_mensajes:leer']];
const fresh = () => ({ mode: 'heredado', me: 'nuevo', status: {}, requests: [] });
let sim = fresh();
const shape = acc => {
  const user = { id: acc.id, nombre: acc.nombre, email: acc.email };
  return sim.me === 'antiguo' ? { user } : { user: { ...user, rol: acc.rol, permisos: acc.permisos }, acceso: { modo: sim.mode } };
};

const handler = async (req, res, { route, json, body }) => {
  if (route.startsWith('/__s/')) {
    const [, , key, value, extra] = route.split('/');
    if (key === 'clear') sim = fresh(); else if (key === 'status') sim.status[decodeURIComponent(value)] = Number(extra); else sim[key] = decodeURIComponent(value);
    return json({ ok: true }) || true;
  }
  if (route === '/__log') return json({ requests: sim.requests }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (route.startsWith('/api/admin/')) sim.requests.push({ method: req.method, route, token });
  if (!route.startsWith('/api/admin/')) return json({ ok: true, settings: {}, items: [], pagination: { page: 1, total: 0, pages: 1, limit: 12 } }) || true;
  if (route === '/api/admin/login' && req.method === 'POST') {
    const input = await body(); const who = String(input.email || '').split('@')[0];
    if (input.password !== 'clave-correcta' || !LOGIN[who]) return json({ ok: false, mensaje: 'Credenciales incorrectas.' }, 401) || true;
    return json({ ok: true, token: LOGIN[who], ...shape(ACCOUNTS[LOGIN[who]]) }) || true;
  }
  if (!ACCOUNTS[token]) return json({ message: 'Unauthorized' }, 401) || true;
  if (route === '/api/admin/me') return json({ ok: true, ...shape(ACCOUNTS[token]) }) || true;
  const sub = route.slice('/api/admin/'.length).split('/')[0];
  if (sim.status[sub]) return json({ ok: false, mensaje: 'Respuesta simulada.' }, sim.status[sub]) || true;
  if (sub === 'stats') return json({ ok: true, stats: { mensajes: { total: 0, nuevos: 0, enProceso: 0, atendidos: 0, archivados: 0 }, contenido: { total: 0 }, catalogo: {} }, actividadReciente: { mensajes: [] } }) || true;
  return json({ ok: true, items: [], messages: [], settings: [], sections: [], pagination: { page: 1, total: 0, pages: 1, limit: 20 }, metrics: {} }) || true;
};

const LEGACY_MENU = ['Resumen', 'Educación', 'Servicios tecnológicos', 'Galería de proyectos', 'Preguntas frecuentes', 'Biblioteca de contenido', 'Convenios', 'Mensajes', 'Cotizaciones', 'Consultas del chatbot', 'Información de empresa'];

(async () => {
  const k = await start({ prefix: 'permisos', handler });
  const { ck, open, closePages, origin } = k;
  const ctl = (...parts) => fetch(origin + '/__s/' + parts.map(encodeURIComponent).join('/'));
  const requests = async () => (await fetch(origin + '/__log').then(r => r.json())).requests;
  const clean = async () => { await closePages(); await ctl('clear'); const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.clear(); sessionStorage.clear(); 1'); await closePages(); };
  const PANEL = "/^\\/admin\\/(dashboard|messages)$/.test(location.pathname) && document.querySelector('.hp-sidebar')";
  const restore = async (token, route = '/admin/dashboard') => { const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(token) + '); 1'); await p.go(route); await p.wait(PANEL, 'panel (' + route + ')'); await sleep(700); return p; };
  const menu = p => p.evaluate('[...document.querySelectorAll("aside nav .hp-nav-item")].map(b => b.textContent.trim())');
  const bottom = p => p.evaluate('[...document.querySelectorAll(".hp-sidebar-bottom button, .hp-sidebar-bottom a")].map(b => b.textContent.trim())');
  const heading = p => p.text('main h1');
  const notice = p => p.evaluate('document.querySelector("[data-panel-access]")?.dataset.panelAccess || null');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // GET a datos de secciones que la cuenta no puede leer (según su lista de permisos).
  const forbiddenCalls = async (token, perms = ACCOUNTS[token].permisos) => (await requests()).filter(r => r.token === token && r.method === 'GET' && r.route !== '/api/admin/me')
    .filter(r => { const sub = r.route.slice('/api/admin/'.length).split(/[/?]/)[0]; const need = READ.find(([prefix]) => prefix === sub)?.[1]; return !need || !perms.includes(need); });
  const calls = async (token, prefix) => (await requests()).filter(r => r.token === token && r.route.startsWith('/api/admin/' + prefix));

  // ===== 1. Los tres roles en modo heredado y por_roles =====
  console.log('\n== MENÚ E INICIO DE CADA ROL');
  const expected = {
    'tk-gerente': { home: '/admin/dashboard', h1: 'Hola', menu: LEGACY_MENU },
    'tk-coord': { home: '/admin/dashboard', h1: 'Hola', menu: LEGACY_MENU.filter(item => item !== 'Biblioteca de contenido') },
    'tk-sec': { home: '/admin/messages', h1: 'Centro de consultas', menu: ['Educación', 'Mensajes', 'Consultas del chatbot', 'Información de empresa'] },
  };
  for (const mode of ['heredado', 'por_roles']) {
    for (const [token, want] of Object.entries(expected)) {
      await clean(); await ctl('mode', mode);
      const p = await restore(token); const who = ACCOUNTS[token].rol + ' (' + mode + ')';
      ck((await p.evaluate('location.pathname')) === want.home && (await heading(p)).includes(want.h1), who + ': inicio en ' + (want.home.endsWith('messages') ? 'la Bandeja de mensajes' : 'el Resumen'), { path: await p.path(), h1: await heading(p) });
      // «Roles y usuarios» solo existe con AccessGuard (por_roles) y cuentas:leer: hoy, solo para el gerente.
      const withRoles = mode === 'por_roles' && token === 'tk-gerente';
      ck(same(await menu(p), withRoles ? [...want.menu, 'Roles y usuarios'] : want.menu), who + ': el menú muestra solo sus secciones', await menu(p));
      const extra = await bottom(p);
      ck(extra.includes('Ajustes') && extra.some(t => t.includes('Cerrar sesión')) && (await p.text('aside')).includes('Roles y usuarios') === withRoles, who + ': conserva Ajustes y Cerrar sesión; «Roles y usuarios» ' + (withRoles ? 'aparece' : 'no aparece'), extra);
      const bad = await forbiddenCalls(token);
      ck(bad.length === 0, who + ': ninguna consulta a datos que no puede leer', bad);
    }
  }
  await clean();
  { const p = await restore('tk-sec');
    ck((await calls('tk-sec', 'stats')).length === 0, 'secretaria: el inicio no consulta /admin/stats (ni la actividad del resumen)');
    await p.go('/admin/dashboard?section=educacion'); await p.wait('document.querySelector(".hp-nav-sub")', 'submenú de Educación');
    const sub = await p.evaluate('[...document.querySelectorAll(".hp-nav-sub button")].map(b => b.textContent.trim())');
    ck(same(sub, ['Capacitaciones', 'Cursos']) && (await p.path()) === '/admin/dashboard?section=educacion' && (await p.text('main')).includes('Capacitaciones'), 'secretaria: Educación abre Capacitaciones y oculta Asesoramiento (es un servicio)', sub);
    ck((await calls('tk-sec', 'servicios')).length === 0 && (await calls('tk-sec', 'cursos')).length > 0, 'secretaria: lee cursos y no consulta servicios'); }

  // ===== 2. Biblioteca de contenido =====
  console.log('\n== BIBLIOTECA DE CONTENIDO (items:leer)');
  await clean();
  { const p = await restore('tk-items');
    ck((await menu(p)).includes('Biblioteca de contenido') && !(await menu(p)).includes('Resumen'), 'con items:leer aparece la Biblioteca (y sin estadisticas:leer no aparece el Resumen)', await menu(p));
    await p.click('aside nav .hp-nav-item', 'Biblioteca'); await p.wait('location.search.includes("section=contenido")', 'Biblioteca'); await sleep(500);
    ck((await calls('tk-items', 'items')).length > 0 && (await notice(p)) === null, 'la Biblioteca se abre y carga sus registros'); }
  await clean();
  { const p = await restore('tk-coord', '/admin/dashboard?section=contenido');
    ck((await notice(p)) === 'denegado' && (await calls('tk-coord', 'items')).length === 0, 'coordinadora: el enlace directo a la Biblioteca muestra el aviso y no consulta /admin/items'); }

  // ===== 3. Enlaces directos a secciones sin permiso =====
  console.log('\n== ENLACES DIRECTOS SIN PERMISO');
  await clean();
  { const p = await restore('tk-sec', '/admin/dashboard?section=cotizaciones');
    const text = await p.text('main');
    ck((await p.path()) === '/admin/dashboard?section=cotizaciones' && (await notice(p)) === 'denegado' && text.includes('No tienes acceso a esta sección'), 'secretaria → Cotizaciones: aviso claro, sin redirección (la dirección se conserva)', { path: await p.path(), text });
    ck((await calls('tk-sec', 'cotizaciones')).length === 0, 'y sin ninguna solicitud a /admin/cotizaciones (el componente no se monta)');
    ck((await p.evaluate('document.title')).startsWith('Acceso no autorizado') && !(await p.evaluate('!!document.querySelector("aside nav .is-active")')), 'el título lo indica y ninguna opción del menú queda marcada');
    await p.click('main a', 'Ir a mi inicio'); await p.wait("location.pathname === '/admin/messages' && !document.querySelector('[data-panel-access]')", 'inicio de la secretaria');
    ck((await heading(p)).includes('Centro de consultas'), '«Ir a mi inicio» lleva a la Bandeja de mensajes', await heading(p));
    await p.evaluate('history.back(); 1'); await p.wait('location.search.includes("section=cotizaciones")', 'atrás');
    ck((await notice(p)) === 'denegado', 'atrás vuelve al aviso (el historial se conserva, sin bucles)');
    await p.evaluate('history.forward(); 1'); await p.wait("location.pathname === '/admin/messages'", 'adelante');
    ck((await calls('tk-sec', 'cotizaciones')).length === 0, 'adelante vuelve a la bandeja; en ningún momento se consultaron cotizaciones'); }
  for (const [route, api, what] of [['/admin/dashboard?section=resumen', 'stats', 'Resumen'], ['/admin/dashboard?section=educacion&seccion=asesoramiento', 'servicios', 'Asesoramiento'], ['/admin/dashboard?section=servicios&seccion=camaras', 'servicios', 'Cámaras'], ['/admin/dashboard?section=convenios', 'convenios', 'Convenios'], ['/admin/dashboard?section=faq&crear=1', 'preguntas-frecuentes', 'crear pregunta']]) {
    await clean(); const p = await restore('tk-sec', route);
    ck((await notice(p)) === 'denegado' && (await calls('tk-sec', api)).length === 0 && !(await p.evaluate('!!document.querySelector("dialog[open], form.hp-form")')), 'secretaria → ' + what + ': aviso, sin formulario y sin consultar /admin/' + api, { notice: await notice(p), calls: await calls('tk-sec', api), path: await p.path() });
  }
  await clean();
  { const p = await restore('tk-gerente', '/admin/dashboard?section=cuentas');
    await p.wait('document.querySelector("[data-panel-access]")', 'aviso');
    ck((await notice(p)) === 'denegado' && (await calls('tk-gerente', 'users')).length === 0 && !(await p.text('aside')).includes('Roles y usuarios'), '?section=cuentas (gerente, heredado): sin AccessGuard no se ofrece «Roles y usuarios»; aviso y ninguna consulta a /admin/users'); }
  await clean(); await ctl('mode', 'por_roles');
  { const p = await restore('tk-gerente', '/admin/dashboard?section=cuentas');
    await p.wait('document.querySelector("main h1")?.textContent === "Roles y usuarios"', 'Roles y usuarios'); await sleep(300);
    ck(!(await notice(p)) && (await calls('tk-gerente', 'users')).length === 1, '?section=cuentas (gerente, por_roles): abre «Roles y usuarios» y consulta /admin/users una vez'); }
  await clean();
  { const p = await restore('tk-sec', '/admin/dashboard?section=desconocida');
    ck((await p.path()) === '/admin/messages' && (await calls('tk-sec', 'stats')).length === 0, 'secretaria con una sección desconocida: abre su inicio (la bandeja), nunca el Resumen'); }

  // ===== 4. Transición: backend antiguo y cuentas sin rol =====
  console.log('\n== BACKEND ANTIGUO Y CUENTAS SIN ROL');
  await clean(); await ctl('me', 'antiguo');
  { const p = await restore('tk-sec');
    ck((await p.path()) === '/admin/dashboard' && same(await menu(p), LEGACY_MENU) && !(await p.text('aside')).includes('Roles y usuarios'), 'backend antiguo: navegación heredada completa (no se inventan permisos) y sin «Roles y usuarios»', await menu(p)); }
  await clean();
  { const p = await restore('tk-norol');
    ck((await p.path()) === '/admin/dashboard' && same(await menu(p), LEGACY_MENU) && (await heading(p)).includes('Hola'), 'cuenta sin rol en modo heredado: conserva la navegación heredada', await menu(p)); }
  await clean(); await ctl('mode', 'por_roles');
  { const p = await restore('tk-norol');
    const text = await p.text('main');
    ck((await notice(p)) === 'sin-rol' && text.includes('no tiene un rol asignado') && (await menu(p)).length === 0, 'cuenta sin rol en por_roles: aviso de cuenta sin rol y ninguna sección de trabajo', { text, menu: await menu(p) });
    const bad = (await requests()).filter(r => r.token === 'tk-norol' && r.route !== '/api/admin/me');
    ck(bad.length === 0, 'sin ninguna consulta de datos', bad);
    await p.go('/admin/dashboard?section=mensajes', 'document.querySelector("[data-panel-access]")'); await sleep(500);
    ck((await notice(p)) === 'denegado' && (await calls('tk-norol', 'messages')).length === 0, 'por enlace directo tampoco abre la bandeja', { notice: await notice(p), calls: await calls('tk-norol', 'messages'), path: await p.path() });
    await p.click('.hp-sidebar-bottom button', 'Ajustes'); await p.wait('location.search.includes("section=configuracion")', 'Ajustes');
    ck((await p.text('main')).includes('Cambiar contraseña'), 'conserva el autoservicio: Ajustes y cambio de contraseña');
    await p.click('.hp-sidebar-bottom button', 'Cerrar sesión'); await p.wait("location.pathname === '/admin/login'", 'login');
    ck((await p.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')')) === null, 'y puede cerrar sesión'); }

  // ===== 5. Login: el inicio depende de la cuenta =====
  console.log('\n== INICIO TRAS EL LOGIN');
  for (const [who, home] of [['sec', '/admin/messages'], ['coord', '/admin/dashboard']]) {
    await clean(); const p = await open(); await p.go('/admin/login');
    await p.type('#email', 0, who + '@example.test'); await p.type('#password', 0, 'clave-correcta'); await p.evaluate("document.querySelector('.admin-auth__form').requestSubmit(); 1");
    await p.wait(PANEL, 'panel tras el login'); await sleep(500);
    ck((await p.evaluate('location.pathname')) === home && (await forbiddenCalls(LOGIN[who])).length === 0, who + ': tras iniciar sesión abre ' + home + ' sin consultas prohibidas', await p.path());
  }

  // ===== 6. 401 frente a 403 =====
  console.log('\n== 401 Y 403');
  await clean(); await ctl('status', 'stats', '403');
  { const p = await restore('tk-gerente');
    ck((await p.path()) === '/admin/dashboard' && (await p.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')')) === 'tk-gerente' && (await p.text('main')).includes('no están disponibles'), '403 en el Resumen: la sesión sigue abierta y se informa que los indicadores no están disponibles'); }
  await clean(); await ctl('status', 'password', '403');
  { const p = await restore('tk-sec', '/admin/dashboard?section=configuracion');
    await p.evaluate('(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }; const f = document.querySelectorAll(".hp-password-card input"); set(f[0], "actual-ficticia"); set(f[1], "nueva-ficticia-1"); set(f[2], "nueva-ficticia-1"); document.querySelector(".hp-password-card form").requestSubmit(); return 1 })()');
    await p.wait('document.querySelector("#password-error")', 'mensaje del cambio de contraseña'); const text = await p.text('#password-error');
    ck(text.includes('no tiene permiso') && !text.includes('sesión venció') && (await p.evaluate('location.pathname')) === '/admin/dashboard' && (await p.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')')) === 'tk-sec', '403 al cambiar la contraseña: «sin permiso» (no «Tu sesión venció») y la sesión sigue abierta', text); }
  await clean(); await ctl('status', 'messages', '401');
  { const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ", 'tk-sec'); 1"); await p.go('/admin/messages', 'document.body');
    await p.wait("location.pathname === '/admin/login'", 'login tras el 401');
    ck((await p.evaluate('localStorage.getItem(' + JSON.stringify(KEY) + ')')) === null && (await p.text()).includes('Tu sesión terminó'), '401 en la bandeja: la sesión se cierra como siempre'); }

  // ===== 7. Direcciones conservadas =====
  console.log('\n== DIRECCIONES Y NAVEGACIÓN CONSERVADAS');
  await clean();
  { const p = await restore('tk-gerente', '/admin/dashboard?section=cursos');
    ck((await p.text('main')).includes('Cursos') && (await notice(p)) === null, 'la dirección antigua ?section=cursos sigue abriendo Cursos');
    await p.go('/admin/dashboard?section=educacion'); await p.wait('document.querySelector(".hp-nav-sub")', 'Educación');
    ck((await p.text('.hp-nav-sub .is-active')) === 'Asesoramiento', 'gerente: Educación sigue abriendo Asesoramiento');
    await p.click('aside nav .hp-nav-item', 'Mensajes'); await p.wait("location.pathname === '/admin/messages'", 'bandeja');
    await p.click('aside nav .hp-nav-item', 'Cotizaciones'); await p.wait('location.search.includes("section=cotizaciones")', 'cotizaciones');
    await p.evaluate('history.back(); 1'); await p.wait("location.pathname === '/admin/messages'", 'atrás');
    await p.evaluate('history.back(); 1'); await p.wait('location.search.includes("section=educacion")', 'atrás 2');
    ck((await notice(p)) === null, 'atrás/adelante recorre las secciones como antes'); }

  k.finish('Navegación del panel por permisos');
})().catch(error => { console.error('FALLO DEL SMOKE:', error.message); process.exit(1); });
