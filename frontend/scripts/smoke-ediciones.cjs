// Navegador con fixture local; API real solo por IPC del test MySQL aislado.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./smoke-kit.cjs');
const { permissionsOf } = require('../../backend/dist/permissions/policy.js');
if (process.env.EDITIONS_API_URL) throw new Error('API real solo mediante IPC del proceso de integración aislada.');
let role = 'GERENTE_GENERAL', live, livePassword, failList = false, failWrite = false, writes = 0, requests = 0;
const tokens = {};
const now = new Date().toISOString();
const course = { id: 1, titulo: 'Excel Básico', tipo: 'curso', estado: 'publicado' };
let items = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, curso_id: 1, curso: course, nombre: 'Edición de prueba ' + i, fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20, estado: 'planificada', archivado_at: null, revision: 1, createdAt: now, updatedAt: now }));
Object.assign(items[0], { nombre: 'Edición anterior', fecha_inicio: null, fecha_fin: null, capacidad: null });
const session = () => ({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'g@ediciones.test', rol: role, permisos: permissionsOf(role) }, acceso: { modo: 'por_roles' } });
let kit;
(async () => {
  if (process.env.HORUS_EDITIONS_BROWSER_CHILD === 'true') {
    assert.equal(typeof process.send, 'function');
    const config = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Falta IPC de integración')), 5000); process.once('message', m => { clearTimeout(timer); resolve(m); }); process.send({ type: 'request-isolated-api' }); });
    assert.equal(config.type, 'isolated-api'); assert.match(config.base, /^http:\/\/127\.0\.0\.1:\d+\/api$/); assert.match(config.database, /^horus_ediciones_it_[0-9a-f]{24}$/);
    live = config.base; livePassword = config.password;
    for (const [key, value] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]]) {
      const r = await fetch(live + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: key + '@ediciones.test', password: livePassword }) });
      assert.equal(r.status, 200); tokens[String(value)] = (await r.json()).token;
    }
  }
  kit = await start({ prefix: 'ediciones', handler: async (req, _res, { route, url, json, body }) => {
    if (!route.startsWith('/api/')) return false;
    if (route.startsWith('/api/admin/convocatorias')) { requests++; if (req.method !== 'GET') writes++; }
    if (live) {
      const data = ['GET', 'HEAD'].includes(req.method) ? undefined : await body();
      const response = await fetch(live + route.slice(4) + url.search, { method: req.method, headers: { 'Content-Type': 'application/json', ...(req.headers.authorization ? { Authorization: 'Bearer ' + tokens[String(role)] } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
      json(await response.json(), response.status); return true;
    }
    if (route === '/api/admin/me') { json(session()); return true; }
    if (route === '/api/admin/convocatorias/cursos') { json({ ok: true, items: [course], pagination: { page: 1, limit: 20, total: 1, pages: 1 } }); return true; }
    const match = route.match(/^\/api\/admin\/convocatorias(?:\/(\d+))?(?:\/(apertura|cierre|archivo))?$/);
    if (match) {
      const id = Number(match[1]), action = match[2];
      if (req.method === 'GET' && !id) {
        if (failList) { json({ message: 'Error ficticio interno' }, 500); return true; }
        let filtered = items.filter(i => (!url.searchParams.get('search') || i.nombre.includes(url.searchParams.get('search')) || i.curso.titulo.includes(url.searchParams.get('search'))) && (!url.searchParams.get('estado') || i.estado === url.searchParams.get('estado')) && (url.searchParams.get('archivo') === 'todos' || (url.searchParams.get('archivo') === 'archivados' ? !!i.archivado_at : !i.archivado_at)));
        const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20), total = filtered.length;
        filtered = filtered.slice((page - 1) * limit, page * limit); json({ ok: true, items: filtered, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }); return true;
      }
      const item = items.find(i => i.id === id);
      if (req.method === 'GET') { json({ ok: true, item }); return true; }
      const input = await body(); await kit.sleep(100);
      if (failWrite) { json({ message: 'Detalle técnico que no debe mostrarse' }, 500); return true; }
      if (req.method === 'POST') { const created = { ...input, nombre: input.nombre.trim(), id: items.length + 1, curso: course, estado: 'planificada', revision: 1, archivado_at: null, createdAt: now, updatedAt: now }; items.unshift(created); json({ ok: true, item: created }, 201); return true; }
      if (!item) { json({ message: 'La edición no existe.' }, 404); return true; }
      if (input.revision !== item.revision) { json({ message: 'La edición cambió desde que la abriste.' }, 409); return true; }
      if (action === 'apertura') item.estado = 'abierta'; else if (action === 'cierre') item.estado = input.estado; else if (action === 'archivo') item.archivado_at = input.archivado ? now : null;
      else Object.assign(item, input);
      item.revision++; json({ ok: true, item }); return true;
    }
    json({ ok: true, items: [], settings: {}, pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true;
  } });
  const { ck } = kit;
  const page = await kit.session('/admin/dashboard?section=ediciones', 1365);
  await page.wait('document.querySelector(".he-editions .hs-table")', 'tabla de ediciones');
  if (!live) {
    ck((await page.text('.hp-pagination')).includes('23 ediciones'), 'listado y total paginado');
    await page.click('.hp-pagination button', 'Siguiente'); await page.wait('document.querySelector(".hp-pagination")?.textContent.includes("Página 2")', 'segunda página');
    ck(await page.evaluate('document.querySelectorAll(".hs-table tbody tr").length === 3'), 'paginación muestra la segunda página');
    await page.click('.hp-pagination button', 'Anterior');
  }
  await page.type('input[aria-label="Buscar ediciones"]', 0, 'Edición anterior'); await page.click('.hp-toolbar button', 'Buscar');
  await page.wait('document.querySelector(".hs-table")?.textContent.includes("Edición anterior")', 'edición anterior');
  await page.click('.hs-table button', 'Editar'); await page.wait('document.querySelector("[data-edition-form]")', 'editar anterior'); await page.label('Nombre de la edición', 'Edición anterior renombrada');
  await page.click('dialog button', 'Guardar cambios'); await page.wait('!document.querySelector("dialog[open]")', 'renombrada sin inventar capacidad');
  await page.wait('document.querySelector(".hs-table")?.textContent.includes("Edición anterior renombrada") && document.querySelector(".hs-table")?.textContent.includes("Sin definir")', 'legado conserva datos sin definir');
  ck(true, 'edición anterior se renombra sin inventar fechas ni capacidad'); const initialWrites = writes;
  await page.click('button', 'Crear edición'); await page.wait('document.querySelector("[data-edition-form]")', 'formulario de alta');
  await page.evaluate('document.querySelector("[data-edition-form]").requestSubmit();true');
  await page.wait('document.querySelector("[aria-invalid=true]")', 'validaciones'); ck(writes === initialWrites, 'formulario inválido no escribe');
  await page.wait('!document.querySelector("[data-edition-form] select").disabled', 'selector de cursos');
  await page.label('Curso asociado', '1'); await page.label('Nombre de la edición', 'Edición navegador'); await page.label('Fecha de inicio', '2026-12-01'); await page.label('Fecha de fin', '2026-12-31'); await page.label('Capacidad máxima', '30');
  await page.evaluate('const f=document.querySelector("[data-edition-form]");f.requestSubmit();f.requestSubmit();true');
  await page.wait('!document.querySelector("dialog[open]")', 'creación confirmada'); ck(writes === initialWrites + 1, 'doble envío crea una sola edición');
  await page.type('input[aria-label="Buscar ediciones"]', 0, 'Edición navegador'); await page.click('.hp-toolbar button', 'Buscar');
  await page.wait('document.querySelector(".hs-table")?.textContent.includes("Edición navegador") && document.querySelectorAll(".hs-table tbody tr").length === 1', 'búsqueda');
  await page.click('.hs-table button', 'Detalle'); await page.wait('document.querySelector("dialog[open]")?.textContent.includes("30")', 'detalle'); ck((await page.text('dialog')).includes('01/12/2026'), 'fechas de calendario en detalle'); await page.click('dialog button', 'Cerrar ventana');
  await page.click('.hs-table button', 'Editar'); await page.wait('document.querySelector("[data-edition-form]")', 'editar');
  await page.label('Capacidad máxima', '35'); await page.click('dialog button', 'Guardar cambios'); await page.wait('!document.querySelector("dialog[open]")', 'guardado'); await page.wait('document.querySelector(".hs-table")?.textContent.includes("35")', 'cupo actualizado'); ck(true, 'edición persistida y visible');
  if (!live) {
    await page.click('.hs-table button', 'Editar'); await page.wait('document.querySelector("[data-edition-form]")', 'conflicto');
    await page.label('Nombre de la edición', 'Borrador conservado');
    await page.click('dialog button', 'Cancelar'); await page.wait('document.querySelector(".hp-unsaved-dialog")', 'protección de borrador'); await page.click('.hp-unsaved-dialog button', 'Seguir editando');
    const item = items.find(i => i.nombre === 'Edición navegador'); item.revision++; item.capacidad = 40;
    await page.click('dialog button', 'Guardar cambios'); await page.wait('document.querySelector("dialog [role=alert]")', '409');
    ck(await page.evaluate('document.querySelector("input[name=nombre]").value === "Borrador conservado" && document.querySelector("[data-edition-form] button[type=submit]").disabled'), '409 conserva borrador y bloquea reenvío');
    await page.click('dialog button', 'Consultar versión actual'); await page.wait('document.querySelector(".hs-conflict")?.textContent.includes("40")', 'versión remota');
    await page.click('dialog button', 'Cancelar'); await page.wait('document.querySelector(".hp-unsaved-dialog")', 'descarte'); await page.click('.hp-unsaved-dialog button', 'Descartar cambios'); await page.wait('!document.querySelector("dialog[open]")', 'cierre');
    await page.wait('document.querySelector(".hs-table button") && !document.querySelector(".hp-card[aria-busy=true]")', 'lista tras conflicto');
    await page.click('.hs-table button', 'Editar'); await page.wait('document.querySelector("[data-edition-form]")', 'resultado incierto'); await page.label('Capacidad máxima', '45'); failWrite = true;
    const beforeWrites = writes; await page.click('dialog button', 'Guardar cambios'); await page.wait('document.querySelector("dialog [role=alert]")', '500');
    ck(await page.evaluate('document.querySelector("[data-edition-form] button[type=submit]").disabled && !document.querySelector("dialog").textContent.includes("Detalle técnico")'), '5xx bloquea reenvío y oculta detalle técnico');
    await kit.sleep(300); ck(writes === beforeWrites + 1, 'resultado incierto no se reintenta'); failWrite = false;
    await page.click('dialog button', 'Cancelar'); await page.wait('document.querySelector(".hp-unsaved-dialog")', 'descartar incierto'); await page.click('.hp-unsaved-dialog button', 'Descartar cambios'); await page.wait('!document.querySelector("dialog[open]")', 'cerrado');
  }
  for (const label of ['Abrir edición', 'Cerrar edición', 'Archivar edición']) {
    await page.wait('!document.querySelector(".hp-card[aria-busy=true]")', 'lista actualizada');
    await page.click('.hs-table button', label); await page.wait('document.querySelector("dialog[open]")', 'confirmación ' + label);
    ck((await page.text('dialog')).includes(label), label + ' exige confirmación'); await page.click('dialog button', 'Confirmar'); await page.wait('!document.querySelector("dialog[open]")', 'operación confirmada');
  }
  await page.type('select[aria-label="Archivo de ediciones"]', 0, 'archivados'); await page.wait('document.querySelector(".hs-table")?.textContent.includes("Archivada")', 'archivo');
  await page.click('.hs-table button', 'Restaurar edición'); await page.wait('document.querySelector("dialog[open]")', 'restaurar'); await page.click('dialog button', 'Confirmar'); await page.wait('!document.querySelector("dialog[open]")', 'restauración');
  await page.type('select[aria-label="Archivo de ediciones"]', 0, 'activos'); await page.wait('document.querySelector(".hs-table")?.textContent.includes("Cerrada")', 'estado terminal conservado');
  ck(!(await page.text('.hs-table')).includes('Editar'), 'cerradas no ofrecen edición ni reapertura');
  if (!live) {
    failList = true; await page.click('button', 'Actualizar'); await page.wait('document.querySelector(".hp-empty [role=alert]")', 'error de lista'); ck(!(await page.text('.hp-empty')).includes('Error ficticio interno'), 'error de lista sin detalle técnico');
    failList = false; await page.click('.hp-empty button', 'Reintentar'); await page.wait('document.querySelector(".hs-table")', 'reintento');
    await page.type('input[aria-label="Buscar ediciones"]', 0, 'inexistente-xyz'); await page.click('.hp-toolbar button', 'Buscar'); await page.wait('document.querySelector(".hp-empty h3")', 'vacío'); ck(true, 'estado vacío');
  }
  const screenshots = process.env.EDITIONS_SCREENSHOTS_DIR;
  const capture = async (p, filename) => { if (screenshots) { fs.mkdirSync(screenshots, { recursive: true }); const shot = await p.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(screenshots, filename), Buffer.from(shot.data, 'base64')); } };
  await page.type('input[aria-label="Buscar ediciones"]', 0, ''); await page.click('.hp-toolbar button', 'Buscar'); await page.wait('document.querySelector(".hs-table")', 'tabla escritorio'); await capture(page, 'ediciones-escritorio.png');
  await kit.closePages();
  const mobile = await kit.session('/admin/dashboard?section=ediciones', 390); await mobile.wait('document.querySelector(".hs-table")', 'móvil');
  ck(await mobile.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'móvil sin desborde de página'); await capture(mobile, 'ediciones-movil.png');
  await mobile.click('button', 'Crear edición'); await mobile.wait('document.querySelector("[data-edition-form]")', 'formulario móvil'); ck(await mobile.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'formulario móvil sin desborde'); await capture(mobile, 'ediciones-formulario-movil.png'); await kit.closePages();
  role = 'SECRETARIA'; const secretary = await kit.session('/admin/dashboard?section=ediciones'); await secretary.wait('document.querySelector(".hs-table")', 'secretaría'); ck(!(await secretary.text('.he-editions')).includes('Crear edición') && !(await secretary.text('.hs-table')).includes('Editar'), 'secretaría solo consulta'); await kit.closePages();
  role = null; const beforeRequests = requests, beforeWrites = writes;
  const basic = await kit.session('/admin/dashboard?section=ediciones'); await basic.wait('document.querySelector(".hp-access-notice") || document.querySelector("main")?.textContent.includes("permiso")', 'cuenta básica denegada');
  ck(requests === beforeRequests && writes === beforeWrites, 'cuenta básica no monta ni consulta Ediciones');
  await kit.closePages();
  kit.finish('Ediciones' + (live ? ' React ↔ NestJS ↔ MySQL' : ' con API simulada'));
})().catch(error => { console.error(error.message); kit?.cleanup(); process.exit(1); });
