// API simulada por defecto. El modo real solo recibe destino/credenciales por IPC del proceso de integración aislada.
const assert = require('node:assert/strict');
if (process.env.STUDENTS_API_URL) throw new Error('API real solo mediante el proceso de integración aislada; no se admite STUDENTS_API_URL.');
const { start } = require('./smoke-kit.cjs');
const { permissionsOf } = require('../../backend/dist/permissions/policy.js');
let live, livePassword;
const session = role => ({ ok: true, user: { id: 1, nombre: 'Cuenta de prueba', email: 'gerente@estudiantes.test', rol: role, permisos: permissionsOf(role) }, acceso: { modo: 'por_roles' } });
const now = new Date().toISOString();
let role = 'GERENTE_GENERAL', failList = false, delay = 0, writes = 0;
let items = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, nombres: 'Persona ' + i, apellidos: 'Prueba', doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: String(10000000 + i), email: null, telefono: null, archivado_at: null, revision: 1, createdAt: now, updatedAt: now }));
let kit;
(async () => {
  if (process.env.HORUS_STUDENTS_BROWSER_CHILD === 'true') {
    if (typeof process.send !== 'function') throw new Error('API real solo mediante el proceso de integración aislada.');
    const configuration = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Falta el canal de integración aislada.')), 5000);
      process.once('message', message => { clearTimeout(timer); resolve(message); });
      process.send({ type: 'request-isolated-api' });
    });
    assert.equal(configuration.type, 'isolated-api');
    assert.match(configuration.database, /^horus_estudiantes_it_[0-9a-f]{24}$/);
    assert.match(configuration.base, /^http:\/\/127\.0\.0\.1:\d+\/api$/);
    assert.ok(typeof configuration.password === 'string' && configuration.password.length > 12);
    live = configuration.base; livePassword = configuration.password;
  }
  kit = await start({ prefix: 'estudiantes', browserArgs: ['--disable-extensions'], handler: async (req, _res, { route, url, json, body }) => {
    if (!route.startsWith('/api/')) return false;
    if (/^\/api\/admin\/estudiantes/.test(route) && req.method !== 'GET') writes++;
    if (live) {
      const data = ['GET', 'HEAD'].includes(req.method) ? undefined : await body();
      const response = await fetch(live + route.slice(4) + url.search, { method: req.method, headers: { 'Content-Type': 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
      json(await response.json(), response.status); return true;
    }
    if (route === '/api/admin/me') { json(session(role)); return true; }
    if (route === '/api/settings') { json({ ok: true, settings: {} }); return true; }
    if (route === '/api/admin/estudiantes') {
      if (req.method === 'POST') { const data = await body(); const item = { ...items[0], ...data, id: 100, revision: 1, archivado_at: null }; items.push(item); json({ ok: true, item }, 201); return true; }
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (failList) { json({ message: 'Error simulado de carga' }, 503); return true; }
      const search = (url.searchParams.get('search') || '').toLowerCase(), state = url.searchParams.get('estado') || 'activos';
      const found = items.filter(s => (state === 'todos' || (state === 'archivados' ? !!s.archivado_at : !s.archivado_at)) && (s.nombres + ' ' + s.apellidos + ' ' + s.doc_numero).toLowerCase().includes(search));
      const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
      json({ ok: true, items: found.slice((page - 1) * limit, page * limit), pagination: { total: found.length, page, limit, pages: Math.ceil(found.length / limit) } }); return true;
    }
    const match = route.match(/^\/api\/admin\/estudiantes\/(\d+)(\/archivo)?$/);
    if (match) {
      const item = items.find(s => s.id === Number(match[1]));
      if (!item) { json({ message: 'El estudiante no existe.' }, 404); return true; }
      if (req.method === 'PUT') {
        const data = await body();
        if (data.revision !== item.revision) { json({ message: 'El estudiante cambió desde que lo abriste.' }, 409); return true; }
        if (match[2]) item.archivado_at = data.archivado ? now : null;
        else Object.assign(item, data);
        item.revision++; json({ ok: true, item }); return true;
      }
      json({ ok: true, item }); return true;
    }
    json({ ok: true, items: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true;
  } });
  const { ck } = kit;
  const authenticate = async (page, email = 'gerente@estudiantes.test') => {
    await page.go('/__empty');
    if (live) {
      const ok = await page.evaluate(`(async()=>{ const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(livePassword)}})});const d=await r.json();if(!r.ok||!d.token)return false;localStorage.setItem('horus-admin-token',d.token);return true;})()`);
      assert.ok(ok, 'sesión en base aislada');
    } else await page.evaluate(`localStorage.setItem('horus-admin-token',${JSON.stringify(require('./smoke-kit.cjs').TOKEN)});true`);
    await page.go('/admin/dashboard?section=estudiantes', 'document.querySelector(".hs-students")');
  };
  const page = await kit.open();
  await authenticate(page);
  await page.wait('document.querySelector(".hs-table tbody tr")', 'lista real de estudiantes');
  ck((await page.text('h1')) === 'Estudiantes', 'pantalla conectada al listado');
  const screenshot = async (p, filename) => {
    if (!process.env.STUDENTS_SCREENSHOTS_DIR) return;
    const fs = require('node:fs'), path = require('node:path');
    const directory = path.resolve(process.env.STUDENTS_SCREENSHOTS_DIR);
    fs.mkdirSync(directory, { recursive: true });
    const shot = await p.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(directory, filename), Buffer.from(shot.data, 'base64'));
  };
  await screenshot(page, 'estudiantes-escritorio.png');
  if (!live) {
    await page.click('button', 'Siguiente'); await page.wait('document.querySelector(".hp-pagination")?.textContent.includes("Página 2")', 'segunda página');
    ck(await page.evaluate('document.querySelectorAll(".hs-table tbody tr").length===3'), 'paginación muestra los registros restantes');
    await page.click('button', 'Anterior'); await page.wait('document.querySelectorAll(".hs-table tbody tr").length===20', 'primera página');
  }
  ck(await page.evaluate('!![...document.querySelectorAll("nav button")].find(x=>x.textContent.includes("Estudiantes"))'), 'navegación académica disponible');
  await page.click('button', 'Registrar estudiante'); await page.wait('document.querySelector("[data-student-form]")', 'formulario de alta');
  await page.evaluate('document.querySelector("[data-student-form]").requestSubmit();true');
  await page.wait('document.querySelector("[aria-invalid=true]")', 'validación obligatoria');
  ck(writes === 0, 'campos inválidos no envían escrituras');
  await page.label('Nombres', 'Navegador'); await page.label('Apellidos', 'Integración'); await page.label('DNI', '88776655'); await page.label('Correo electrónico', 'navegador@example.test');
  await page.evaluate('const f=document.querySelector("[data-student-form]");f.requestSubmit();f.requestSubmit();true');
  await page.wait('!document.querySelector("dialog[open]")', 'alta confirmada');
  ck(writes === 1, 'doble envío registra una sola vez');
  await page.type('input[type=search]', 0, '88776655'); await page.click('button', 'Buscar');
  await page.wait('document.querySelector(".hs-table")?.textContent.includes("Navegador")', 'búsqueda por DNI');
  ck((await page.text('.hp-pagination')).includes('1 estudiantes'), 'búsqueda paginada');
  await page.click('.hs-table button', 'Detalle'); await page.wait('document.querySelector("dialog[open]")?.textContent.includes("88776655")', 'detalle desde API');
  await page.click('dialog button', 'Cerrar ventana');
  await page.click('.hs-table button', 'Editar'); await page.wait('document.querySelector("[data-student-form]")', 'edición');
  await page.label('Nombres', 'Navegador editado'); await page.click('dialog button', 'Guardar cambios');
  await page.wait('!document.querySelector("dialog[open]")', 'edición guardada');
  await page.wait('document.querySelector(".hs-table")?.textContent.includes("Navegador editado")', 'datos editados en tabla');
  ck(true, 'edición persistida y mostrada');
  if (!live) {
    await page.click('.hs-table button', 'Editar'); await page.wait('document.querySelector("[data-student-form]")', 'edición para conflicto');
    await page.label('Nombres', 'Borrador que se conserva');
    await page.click('dialog button', 'Cancelar'); await page.wait('document.querySelector(".hp-unsaved-dialog")', 'aviso de cambios pendientes');
    await page.click('.hp-unsaved-dialog button', 'Seguir editando');
    ck(await page.evaluate('document.querySelector("input[name=nombres]").value === "Borrador que se conserva"'), 'cancelar la salida conserva el borrador');
    const item = items.find(s => s.doc_numero === '88776655'); item.revision++; item.nombres = 'Nombre remoto';
    await page.click('dialog button', 'Guardar cambios'); await page.wait('document.querySelector("dialog [role=alert]")', 'conflicto de revisión');
    ck(await page.evaluate('document.querySelector("input[name=nombres]").value === "Borrador que se conserva" && document.querySelector("[data-student-form] button[type=submit]").disabled'), '409 conserva borrador y bloquea el reenvío');
    ck(await page.evaluate('const input=document.querySelector("input[name=nombres]");input.focus();document.activeElement===input && input.readOnly && !input.disabled'), 'borrador bloqueado sigue accesible por teclado para copiarlo');
    await page.click('dialog button', 'Consultar versión actual'); await page.wait('document.querySelector(".hs-conflict")?.textContent.includes("Nombre remoto")', 'versión remota consultada sin fusionar');
    await page.click('dialog button', 'Cancelar'); await page.wait('document.querySelector(".hp-unsaved-dialog")', 'confirmar descarte');
    await page.click('.hp-unsaved-dialog button', 'Descartar cambios'); await page.wait('!document.querySelector("dialog[open]")', 'formulario cerrado');
    await page.wait('document.querySelector(".hs-table")?.textContent.includes("Nombre remoto")', 'lista actualizada');
  }
  await page.click('.hs-table button', 'Archivar'); await page.wait('document.querySelector("dialog[open]")', 'confirmación de archivo');
  ck((await page.text('dialog')).includes('se conservarán'), 'archivo informa conservación');
  await page.click('dialog button', 'Confirmar archivo'); await page.wait('!document.querySelector("dialog[open]")', 'archivo confirmado');
  await page.wait('document.querySelector(".hp-empty h3")', 'búsqueda sin activos');
  await page.type('select[aria-label="Estado de estudiantes"]', 0, 'archivados');
  await page.wait('document.querySelector(".hs-table")?.textContent.includes("Archivado")', 'registro archivado');
  await page.click('.hs-table button', 'Restaurar'); await page.wait('document.querySelector("dialog[open]")', 'confirmación de restauración');
  await page.click('dialog button', 'Confirmar restauración'); await page.wait('!document.querySelector("dialog[open]")', 'restauración');
  ck(true, 'archivo y restauración conservan el registro');
  await page.type('input[type=search]', 0, 'sin-coincidencias-xyz'); await page.click('button', 'Buscar');
  await page.wait('document.querySelector(".hp-empty h3")?.textContent.includes("coincidencias")', 'estado vacío');
  ck(true, 'estado sin resultados');

  if (!live) {
    failList = true; await page.click('button', 'Actualizar'); await page.wait('document.querySelector(".hs-students [role=alert]")', 'error de carga');
    ck(true, 'error de carga visible y con reintento');
    failList = false; delay = 600; await page.click('button', 'Reintentar');
    await page.wait('document.querySelector(".hp-loading")', 'carga visible'); ck(true, 'estado de carga'); delay = 0;
    await page.wait('!document.querySelector(".hp-loading")', 'fin de carga');
    role = 'SECRETARIA';
    const secretary = await kit.open(); await authenticate(secretary); await secretary.wait('document.querySelector(".hs-table")', 'lista de secretaria');
    ck(!await secretary.evaluate('[...document.querySelectorAll(".hs-table button")].some(x=>/Editar|Archivar/.test(x.textContent))'), 'secretaria consulta y registra; no edita ni archiva');
    role = null;
    const basic = await kit.open(); await basic.go('/__empty'); await basic.evaluate(`localStorage.setItem('horus-admin-token',${JSON.stringify(require('./smoke-kit.cjs').TOKEN)});true`); await basic.go('/admin/dashboard?section=estudiantes');
    await basic.wait('document.querySelector(".hp-body")', 'cuenta básica');
    ck(!await basic.evaluate('!!document.querySelector(".hs-students")'), 'cuenta básica no monta el módulo');
    role = 'GERENTE_GENERAL';
  }
  const mobile = await kit.open(390, 844); await authenticate(mobile);
  await mobile.wait('document.querySelector(".hs-table tbody tr")', 'tabla en móvil');
  ck(await mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), '390 px sin desbordamiento de página');
  ck(await mobile.evaluate('const t=document.querySelector(".hp-table-wrap");t.scrollWidth>t.clientWidth'), 'tabla móvil con desplazamiento contenido');
  await screenshot(mobile, 'estudiantes-movil.png');
  await mobile.click('button', 'Registrar estudiante');
  ck(await mobile.evaluate('const d=document.querySelector("dialog").getBoundingClientRect();d.left>=0&&d.right<=innerWidth'), 'formulario ajustado al móvil');
  await mobile.click('dialog button', 'Cancelar');
  await kit.closePages(); kit.finish(live ? 'Estudiantes: React → NestJS → MySQL real aislado' : 'Estudiantes: navegador con API simulada');
})().catch(error => { console.error(error.message); kit?.cleanup(); process.exitCode = 1; });
