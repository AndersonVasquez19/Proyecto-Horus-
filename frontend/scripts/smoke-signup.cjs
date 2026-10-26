// Registro público y espacio básico de la cuenta nueva con API simulada: nada real (sin MySQL, sin correo, datos ficticios).
// Cubre: enlace «Crear cuenta» desde el login, formulario (validación local sin solicitudes, campo trampa oculto), cuerpo enviado sin rol,
// éxito solo tras la respuesta del servidor, doble envío, 409/400/429/500/502/503 con mensajes propios (nunca texto del servidor),
// móvil sin desborde, login de una cuenta sin rol (espacio básico «Mi espacio», sin bloqueo, ninguna solicitud de secciones) y login
// con 401/503. El kit bloquea antes de enviarla cualquier petición que no sea del servidor simulado y cierra el árbol de Edge.
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

const fresh = () => ({ signup: 'ok', signupDelay: 0, login: 'sinrol', requests: [] });
let sim = fresh();
const PASSWORD = 'Clave-ficticia-1';
const NEW_USER = { id: 41, nombre: 'Visitante Ficticia', email: 'visitante@example.test' };

const handler = async (req, res, { route, json, body }) => {
  if (route.startsWith('/__s/')) { const [, , key, value] = route.split('/'); if (key === 'clear') sim = fresh(); else sim[key] = key.endsWith('Delay') ? Number(value) : value; return json({ ok: true }) || true; }
  if (route === '/__state') return json({ requests: sim.requests }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const data = req.method === 'POST' || req.method === 'PUT' ? await body() : undefined;
  sim.requests.push({ method: req.method, route, token, body: data });
  if (route === '/api/settings') return json({ ok: true, settings: {} }) || true;
  if (route === '/api/admin/signup' && req.method === 'POST') {
    if (sim.signupDelay) await sleep(sim.signupDelay);
    if (sim.signup === 'ok') return json({ ok: true, mensaje: 'Cuenta creada. El acceso al panel requiere la autorización de la gerencia.' }, 201) || true;
    if (sim.signup === 'dup') return json({ ok: false, mensaje: 'Ya existe una cuenta con ese correo.' }, 409) || true;
    if (sim.signup === 'bad') return json({ statusCode: 400, message: ['property rol should not exist'], error: 'Bad Request' }, 400) || true;
    if (sim.signup === 'many') return json({ ok: false, mensaje: 'Has enviado varias solicitudes.' }, 429) || true;
    if (sim.signup === 'down') return json({ ok: false, mensaje: 'no disponible' }, 503) || true;
    if (sim.signup === 'gateway') return json({ message: 'Bad gateway' }, 502) || true;
    return json({ statusCode: 500, message: 'Internal server error ER_SECRET_DETAIL' }, 500) || true;
  }
  if (route === '/api/admin/login' && req.method === 'POST') {
    if (sim.login === 'wrong') return json({ ok: false, mensaje: 'Credenciales incorrectas.' }, 401) || true;
    if (sim.login === 'down') return json({ ok: false, mensaje: 'El acceso al panel no está disponible temporalmente.' }, 503) || true;
    return json({ ok: true, mensaje: 'Login correcto.', token: TOKEN, user: { ...NEW_USER, rol: null, permisos: [] }, acceso: { modo: 'por_roles' } }) || true;
  }
  if (route === '/api/admin/me') return (token === TOKEN ? json({ ok: true, user: { ...NEW_USER, rol: null, permisos: [] }, acceso: { modo: 'por_roles' } }) : json({ ok: false }, 401)) || true;
  // Una cuenta sin rol no debería pedir nada más: cualquier otra ruta administrativa responde 403 como AccessGuard y queda registrada.
  return json({ ok: false, mensaje: 'Tu cuenta no tiene un rol asignado.' }, 403) || true;
};

(async () => {
  const k = await start({ prefix: 'signup', handler });
  const { ck, open } = k;
  const ctl = (key, value = '1') => fetch(k.origin + '/__s/' + key + '/' + value);
  const requests = () => fetch(k.origin + '/__state').then(r => r.json()).then(s => s.requests);
  const signups = async () => (await requests()).filter(r => r.route === '/api/admin/signup');
  const clean = async () => { await ctl('clear'); await k.closePages(); };
  const fill = async (p, values) => { for (const [id, value] of Object.entries(values)) await p.evaluate('(() => { const el = document.getElementById(' + JSON.stringify(id) + '); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ' + JSON.stringify(value) + '); el.dispatchEvent(new Event("input", { bubbles: true })); return 1 })()'); };
  const valid = { nombre: NEW_USER.nombre, email: NEW_USER.email, password: PASSWORD, confirmPassword: PASSWORD };
  const submit = p => p.evaluate('document.querySelector(".admin-auth__form").requestSubmit(); 1');
  const error = p => p.text('#register-error');
  const REGISTER = 'document.querySelector("h1")?.textContent === "Crea tu cuenta"';

  console.log('\n== ENLACE «CREAR CUENTA» DESDE EL LOGIN Y FORMULARIO');
  await clean();
  { const p = await open(1280); await p.go('/admin/login');
    ck(await p.evaluate('!!document.querySelector(\'.admin-auth__switch a[href="/admin/register"]\') && document.querySelector(".admin-auth__switch").innerText.includes("Crear cuenta")'), 'el login muestra el enlace visible «Crear cuenta»');
    ck(await p.evaluate('!!document.querySelector(\'.admin-auth__navigation a[href="/admin/register"]\')'), 'la navegación de acceso incluye «Crear cuenta»');
    await p.click('.admin-auth__switch a', 'Crear cuenta'); await p.wait(REGISTER, 'pantalla de registro');
    ck((await p.path()) === '/admin/register', 'la ruta pública /admin/register abre el formulario (sin redirigir al login)', await p.path());
    ck(await p.evaluate('document.querySelector(\'.admin-auth__navigation a[href="/admin/register"]\').getAttribute("aria-current") === "page"'), 'la pestaña «Crear cuenta» se marca como página actual');
    ck(await p.evaluate('["nombre", "email", "password", "confirmPassword"].every(id => document.getElementById(id) && document.querySelector(\'label[for="\' + id + \'"]\'))'), 'nombre, correo, contraseña y confirmación con su etiqueta');
    { const notice = await p.text('[data-register-authorization]');
      ck(notice.includes('iniciar sesión en cuanto crees tu cuenta') && notice.includes('permisos adicionales') && !notice.includes('pendiente de autorización'), 'el formulario explica que se entra de inmediato y que administrar requiere permisos adicionales', notice); }
    // El input conserva su tamaño propio: lo oculta su contenedor de 1 px con overflow:hidden y clip-path, que es lo que se mide.
    ck(await p.evaluate('(() => { const t = document.getElementById("website"); const box = t.closest(".admin-auth__sr-only"); const r = box?.getBoundingClientRect(); const s = box && getComputedStyle(box); return t.tabIndex === -1 && t.closest("[aria-hidden=true]") !== null && !!r && r.width <= 1 && r.height <= 1 && s.overflow === "hidden"; })()'), 'el campo trampa está oculto (contenedor de 1 px recortado), fuera del orden de tabulación y de los lectores de pantalla');
    ck((await requests()).every(r => r.route === '/api/settings'), 'abrir el formulario no hace solicitudes de cuentas', await requests());

    await fill(p, { ...valid, confirmPassword: 'Otra-clave-1' }); await submit(p); await p.wait('document.getElementById("register-error")', 'error local');
    ck((await error(p)).includes('no coinciden') && (await signups()).length === 0, 'confirmación distinta: aviso local y ninguna solicitud');
    ck(await p.evaluate('document.getElementById("confirmPassword").getAttribute("aria-invalid") === "true" && document.activeElement?.id === "register-error"'), 'el campo se marca como inválido y el aviso recibe el foco');
    await fill(p, { password: 'corta', confirmPassword: 'corta' }); await submit(p); await sleep(150);
    ck((await error(p)).includes('al menos 8') && (await signups()).length === 0, 'contraseña corta: aviso local y ninguna solicitud');
    await fill(p, { ...valid, email: 'sin-arroba' }); await submit(p); await sleep(150);
    ck((await error(p)).includes('correo electrónico válido') && (await signups()).length === 0, 'correo inválido: aviso local y ninguna solicitud');
    await p.close(); }

  console.log('\n== ÉXITO CONFIRMADO, CUERPO SIN ROL Y DOBLE ENVÍO');
  await clean();
  { await ctl('signupDelay', '700'); const p = await open(1280); await p.go('/admin/register'); await p.wait(REGISTER, 'registro');
    await fill(p, valid); await submit(p); await sleep(120); await submit(p); await submit(p);
    ck((await p.path()) === '/admin/register' && await p.evaluate('document.querySelector(".admin-auth__submit").disabled'), 'mientras el servidor no responde no se anuncia éxito y el botón queda bloqueado');
    await p.wait('location.pathname === "/admin/login" && document.querySelector("[data-register-done]")', 'login con aviso de cuenta creada');
    const sent = await signups();
    ck(sent.length === 1, 'tres envíos rápidos producen una única solicitud', sent.length);
    ck(JSON.stringify(Object.keys(sent[0].body).sort()) === JSON.stringify(['email', 'nombre', 'password']) && sent[0].token === '', 'el cuerpo solo trae nombre, correo y contraseña (sin rol, permisos ni trampa) y sin sesión', sent[0]);
    ck((await p.text('[data-register-done]')).includes('requiere la autorización'), 'el login confirma la cuenta y recuerda que el acceso requiere autorización');
    ck(!(await p.evaluate('Object.keys(localStorage).some(key => /token|password|clave/i.test(key + localStorage.getItem(key)))')), 'el registro no deja token ni contraseña en el almacenamiento local');
    await p.close(); }

  console.log('\n== ERRORES DEL SERVIDOR CON MENSAJES PROPIOS');
  for (const [mode, expected, what] of [
    ['dup', 'Ya existe una cuenta con ese correo', '409 correo duplicado'], ['bad', 'Revisa los datos', '400 datos rechazados por el servidor'],
    ['many', 'Demasiados intentos', '429 límite de frecuencia'], ['down', 'no está disponible temporalmente', '503 servicio no disponible'],
    ['error', 'El servidor no pudo completar', '500 sin texto técnico'], ['gateway', 'No pudimos confirmar si tu cuenta se creó', '502: resultado incierto'],
  ]) {
    await clean(); await ctl('signup', mode);
    const p = await open(1280); await p.go('/admin/register'); await p.wait(REGISTER, 'registro');
    await fill(p, valid); await submit(p); await p.wait('document.getElementById("register-error")', 'error ' + mode);
    const text = await error(p);
    ck(text.includes(expected) && !/ER_SECRET|property rol|Bad gateway|Internal server/i.test(await p.text()), what + ': «' + expected + '…» sin texto del servidor', text);
    ck((await p.path()) === '/admin/register' && await p.evaluate('document.getElementById("email").value === ' + JSON.stringify(valid.email) + ' && document.getElementById("password").value === ' + JSON.stringify(PASSWORD)), what + ': los datos se conservan y no se navega');
    if (mode === 'dup') ck(await p.evaluate('document.getElementById("email").getAttribute("aria-invalid") === "true"'), '409: el correo se marca como inválido');
    await sleep(500); ck((await signups()).length === 1, what + ': sin reintento automático');
    await p.close();
  }

  console.log('\n== MÓVIL (390 px)');
  await clean();
  { const p = await open(390, 844); await p.go('/admin/register'); await p.wait(REGISTER, 'registro en móvil');
    ck(await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'sin desborde horizontal');
    ck(await p.evaluate('(() => { const b = document.querySelector(".admin-auth__submit").getBoundingClientRect(); return b.width > 200 && b.left >= 0 && b.right <= window.innerWidth; })()'), 'el botón «Crear cuenta» cabe en la pantalla');
    await fill(p, valid); await submit(p); await p.wait('location.pathname === "/admin/login"', 'login tras registrarse en móvil');
    ck(await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'el login con el aviso tampoco desborda'); await p.close(); }

  console.log('\n== CUENTA SIN ROL: ESPACIO BÁSICO TRAS EL LOGIN');
  await clean();
  { const p = await open(1280); await p.go('/admin/login');
    await fill(p, { email: NEW_USER.email, password: PASSWORD }); await submit(p);
    await p.wait('document.querySelector("[data-panel-access]")', 'espacio básico');
    const text = await p.text('main');
    ck((await p.evaluate('location.pathname + location.search')) === '/admin/dashboard', 'tras el login la cuenta nueva entra directamente a /admin/dashboard', await p.evaluate('location.pathname + location.search'));
    ck((await p.evaluate('document.querySelector("[data-panel-access]").dataset.panelAccess')) === 'sin-rol' && text.includes('Cuenta básica') && text.includes('permisos adicionales') && !text.includes('pendiente de autorización'), 'el panel muestra el espacio básico, sin pantalla de autorización pendiente', text.slice(0, 200));
    ck(JSON.stringify(await p.evaluate('[...document.querySelectorAll("aside nav .hp-nav-item")].map(b => b.textContent.trim())')) === '["Mi espacio","Mi cuenta"]', 'el menú ofrece Mi espacio y Mi cuenta, sin secciones administrativas');
    ck(await p.evaluate('!!document.querySelector(\'main a[href="/admin/dashboard?section=configuracion"]\')'), 'el espacio básico lleva a los Ajustes de la propia cuenta');
    ck(await p.evaluate('[...document.querySelectorAll(".hp-sidebar-bottom button")].some(b => b.textContent.includes("Cerrar sesión"))'), 'se puede cerrar sesión');
    const extra = (await requests()).filter(r => r.route.startsWith('/api/admin/') && !['/api/admin/login', '/api/admin/me'].includes(r.route));
    ck(extra.length === 0, 'la cuenta sin rol no solicita ninguna sección administrativa', extra);
    await p.go('/admin/register', 'document.querySelector("[data-panel-access], .admin-auth")'); await p.wait('location.pathname === "/admin/dashboard"', 'redirección al panel');
    ck(true, 'con la sesión abierta, /admin/register lleva al panel en vez de mostrar el formulario');
    await p.click('.hp-sidebar-bottom button', 'Cerrar sesión'); await p.wait('location.pathname === "/admin/login"', 'login tras cerrar sesión');
    await p.close(); }

  console.log('\n== LOGIN: CREDENCIALES INCORRECTAS Y SERVICIO NO DISPONIBLE');
  for (const [mode, expected] of [['wrong', 'Revisa tu correo y contraseña'], ['down', 'no está disponible temporalmente']]) {
    await clean(); await ctl('login', mode);
    const p = await open(1280); await p.go('/admin/login');
    await fill(p, { email: NEW_USER.email, password: PASSWORD }); await submit(p); await p.wait('document.getElementById("login-error")', 'error de login ' + mode);
    const text = await p.text('#login-error');
    ck(text.includes(expected) && (await p.path()) === '/admin/login', 'login ' + (mode === 'wrong' ? '401' : '503') + ': «' + expected + '…»', text);
    await p.close();
  }

  await k.closePages();
  k.finish('Registro público y espacio básico de la cuenta nueva');
})().catch(error => { console.error('\nERROR DEL SMOKE: ' + (error && error.message ? error.message : String(error))); process.exit(1); });
