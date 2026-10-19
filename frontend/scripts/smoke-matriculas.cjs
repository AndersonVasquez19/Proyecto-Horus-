// API real únicamente desde el proceso MySQL desechable por IPC; sin destinos arbitrarios.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Se valida antes de cargar dependencias: el rechazo no depende de que exista backend/dist (job Frontend de CI).
if (process.env.MATRICULAS_API_URL) throw new Error('API real solo por IPC de la integración aislada.');
const { start } = require('./smoke-kit.cjs');
const { permissionsOf } = require('../../backend/dist/permissions/policy.js');
let role = 'GERENTE_GENERAL', live, kit, writes = 0, requests = 0, failList = false, failWrite = false, conflict = false;
const tokens = {}, now = new Date().toISOString();
const student = { id: 10, nombres: 'Persona 9', apellidos: 'Ficticia', doc_numero: '12345009', archivado_at: null };
const course = { id: 1, titulo: 'Curso Matrículas', tipo: 'curso', estado: 'publicado' };
let target = { id: 1, curso_id: 1, curso: course, nombre: 'Edición navegador', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', estado: 'abierta', archivado_at: null, capacidad: 3, ocupados: 0, disponibles: 3, revision: 2 };
let items = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, estudiante_id: 1, convocatoria_id: 1, estudiante: { ...student, id: 1, nombres: 'Estudiante ' + i, doc_numero: '12345678' }, convocatoria: target, estado: 'activa', cumplimiento: 'pendiente', revision: 1, createdAt: now, updatedAt: now }));
const history = {};
const session = () => ({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'g@matriculas.test', rol: role, permisos: permissionsOf(role) }, acceso: { modo: 'por_roles' } });
(async () => {
  if (process.env.HORUS_MATRICULAS_BROWSER_CHILD === 'true') {
    assert.equal(typeof process.send, 'function');
    const config = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Falta IPC de integración')), 5000); process.once('message', m => { clearTimeout(timer); resolve(m); }); process.send({ type: 'request-isolated-api' }); });
    assert.equal(config.type, 'isolated-api'); assert.match(config.base, /^http:\/\/127\.0\.0\.1:\d+\/api$/); assert.match(config.database, /^horus_matriculas_it_[0-9a-f]{24}$/);
    live = config.base;
    for (const [key, value] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]]) {
      const r = await fetch(live + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: key + '@matriculas.test', password: config.password }) }); assert.equal(r.status, 200); tokens[String(value)] = (await r.json()).token;
    }
    const call = async (route, method = 'GET', body) => { const r = await fetch(live + '/admin/' + route, { method, headers: { Authorization: 'Bearer ' + tokens.GERENTE_GENERAL, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.ok(r.ok, route + ' status ' + r.status); return r.json(); };
    Object.assign(student, (await call('estudiantes?search=12345009')).items[0]);
    const courseId = (await call('convocatorias/cursos')).items[0].id;
    let created = (await call('convocatorias', 'POST', { curso_id: courseId, nombre: 'Edición navegador', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 3 })).item;
    created = (await call('convocatorias/' + created.id + '/apertura', 'PUT', { revision: created.revision })).item;
    target = { ...created, ocupados: 0, disponibles: 3 };
  }
  kit = await start({ prefix: 'matriculas', handler: async (req, _res, { route, url, json, body }) => {
    if (!route.startsWith('/api/')) return false;
    if (route.startsWith('/api/admin/matriculas')) { requests++; if (req.method !== 'GET') writes++; }
    if (live) {
      const input = ['GET', 'HEAD'].includes(req.method) ? undefined : await body();
      const r = await fetch(live + route.slice(4) + url.search, { method: req.method, headers: { 'Content-Type': 'application/json', ...(req.headers.authorization ? { Authorization: 'Bearer ' + tokens[String(role)] } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) }); json(await r.json(), r.status); return true;
    }
    const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
    const list = rows => json({ ok: true, items: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) } });
    if (route === '/api/admin/me') { json(session()); return true; }
    if (route === '/api/admin/estudiantes') { list([student]); return true; }
    if (route === '/api/admin/convocatorias/cursos') { list([course]); return true; }
    if (route === '/api/admin/matriculas/ediciones') { list([target, { ...target, id: 2, nombre: 'Edición cerrada', estado: 'cerrada' }, { ...target, id: 3, nombre: 'Sin capacidad', capacidad: null, disponibles: null }]); return true; }
    const match = route.match(/^\/api\/admin\/matriculas(?:\/(\d+))?(?:\/(historial|anulacion|reactivacion))?$/);
    if (match) {
      const id = Number(match[1]), action = match[2];
      if (req.method === 'GET' && !id) {
        if (failList) { json({ message: 'Detalle técnico privado' }, 500); return true; }
        const search = (url.searchParams.get('search') || '').toLowerCase(), state = url.searchParams.get('estado');
        list(items.filter(i => (!search || (i.estudiante.nombres + ' ' + i.estudiante.apellidos + ' ' + i.estudiante.doc_numero + ' ' + i.convocatoria.nombre).toLowerCase().includes(search)) && (!state || i.estado === state))); return true;
      }
      if (action === 'historial') { list(history[id] || []); return true; }
      let item = items.find(i => i.id === id);
      if (req.method === 'GET') { json({ ok: true, item }); return true; }
      const input = await body(); await kit.sleep(100);
      if (failWrite) { json({ message: 'Detalle técnico privado' }, 500); return true; }
      if (conflict) { json({ message: 'La matrícula cambió. Consulta su versión actual.' }, 409); return true; }
      if (req.method === 'POST') { item = { id: items.length + 1, ...input, estudiante: student, convocatoria: target, estado: 'activa', cumplimiento: 'pendiente', revision: 1, createdAt: now, updatedAt: now }; items.unshift(item); }
      else { item.estado = action === 'anulacion' ? 'anulada' : 'activa'; item.revision++; }
      (history[item.id] ||= []).unshift({ id: item.revision, createdAt: now, operacion: req.method === 'POST' ? 'creacion' : action === 'anulacion' ? 'anulacion' : 'cambio_estado', actor_id: 1, actor_rol: role, estado_anterior: req.method === 'POST' ? null : action === 'anulacion' ? 'activa' : 'anulada', estado_nuevo: item.estado, motivo: input.motivo || null, revision: item.revision });
      json({ ok: true, item }, req.method === 'POST' ? 201 : 200); return true;
    }
    json({ ok: true, items: [], settings: {}, pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true;
  } });
  const { ck } = kit;
  const p = await kit.session('/admin/dashboard?section=matriculas', 1365);
  await p.wait('document.querySelector(".hm-enrollments .hs-table")', 'tabla');
  if (!live) { await p.click('.hp-pagination button', 'Siguiente'); await p.wait('document.querySelector(".hp-pagination")?.textContent.includes("Página 2")', 'paginación'); ck(await p.evaluate('document.querySelectorAll(".hs-table tbody tr").length === 3'), 'paginación real de la tabla'); await p.click('.hp-pagination button', 'Anterior'); }
  await p.click('button', 'Registrar matrícula'); await p.wait('document.querySelector("[data-enrollment-form]")', 'alta');
  const before = writes; await p.evaluate('document.querySelector("[data-enrollment-form]").requestSubmit();true');
  await p.wait('document.querySelector("dialog [role=alert]")', 'validación'); ck(writes === before, 'selección vacía no escribe');
  await p.wait('document.querySelectorAll("dialog select").length === 2 && [...document.querySelectorAll("dialog select")].every(s => !s.disabled)', 'opciones cargadas');
  if (!live) ck(await p.evaluate('[...document.querySelectorAll("dialog select")[1].options].filter(o => o.value && o.disabled).length === 2'), 'ediciones cerradas o sin capacidad no seleccionables');
  await p.type('dialog select', 0, String(student.id)); await p.type('dialog select', 1, String(target.id));
  await p.evaluate('(() => { const form=document.querySelector("[data-enrollment-form]");form.requestSubmit();form.requestSubmit();return true; })()');
  await p.wait('!document.querySelector("dialog[open]")', 'alta confirmada'); ck(writes === before + 1, 'doble envío registra una sola matrícula');
  await p.type('input[aria-label="Buscar matrículas"]', 0, '12345009'); await p.click('.hp-toolbar button', 'Buscar');
  await p.wait('document.querySelectorAll(".hs-table tbody tr").length === 1 && document.querySelector(".hs-table")?.textContent.includes("Persona 9")', 'búsqueda por DNI');
  await p.click('.hs-table button', 'Detalle e historial'); await p.wait('document.querySelector(".hm-history")?.textContent.includes("Registro de matrícula")', 'historial'); ck((await p.text('dialog')).includes('Responsable #'), 'historial con fecha, responsable y estado'); await p.click('dialog button', 'Cerrar ventana');
  for (const [action, motive, state] of [['Anular matrícula', 'Solicitud del estudiante', 'Anulada'], ['Reactivar matrícula', 'Retoma la inscripción', 'Activa']]) {
    await p.wait('!document.querySelector(".hp-card[aria-busy=true]")', 'lista disponible'); await p.click('.hs-table button', action); await p.wait('document.querySelector("[data-enrollment-operation]")', action);
    await p.label('Motivo', motive); const n = writes; await p.evaluate('(() => { const form=document.querySelector("[data-enrollment-operation]");form.requestSubmit();form.requestSubmit();return true; })()');
    await p.wait('!document.querySelector("dialog[open]")', 'cambio confirmado'); await p.wait('document.querySelector(".hs-table .hp-badge")?.textContent === ' + JSON.stringify(state), 'estado ' + state); ck(writes === n + 1, action + ' confirmada sin doble envío');
  }
  await p.click('.hs-table button', 'Detalle e historial'); await p.wait('document.querySelector(".hm-history")?.textContent.includes("Reactivación")', 'historial completo'); ck((await p.text('dialog')).includes('Solicitud del estudiante') && (await p.text('dialog')).includes('Retoma la inscripción'), 'motivos conservados'); await p.click('dialog button', 'Cerrar ventana');
  if (!live) {
    for (const kind of ['conflict', 'uncertain']) {
      await p.click('.hs-table button', 'Anular matrícula'); await p.wait('document.querySelector("[data-enrollment-operation]")', 'operación con error'); await p.label('Motivo', 'Borrador conservado');
      conflict = kind === 'conflict'; failWrite = kind === 'uncertain'; const n = writes; await p.click('dialog button', 'Confirmar'); await p.wait('document.querySelector("dialog [role=alert]")', 'error de escritura');
      ck(await p.evaluate('document.querySelector("dialog textarea").value === "Borrador conservado" && document.querySelector("dialog button[type=submit]").disabled && !document.querySelector("dialog").textContent.includes("Detalle técnico privado")'), kind + ': conserva borrador, bloquea envío y oculta detalles técnicos');
      await kit.sleep(250); ck(writes === n + 1, kind + ': sin reintento automático');
      await p.click('dialog button', 'Consultar versión actual'); await p.wait('document.querySelector(".hs-conflict")?.textContent.includes("Estado actual: Activa")', 'comprobación explícita');
      await p.click('dialog button', 'Volver'); await p.wait('document.querySelector(".hp-unsaved-dialog")', 'borrador protegido'); await p.click('.hp-unsaved-dialog button', 'Descartar cambios'); await p.wait('!document.querySelector("dialog[open]")', 'cierre'); conflict = false; failWrite = false;
      await p.wait('!document.querySelector(".hp-card[aria-busy=true]")', 'recarga');
    }
    failList = true; await p.click('button', 'Actualizar'); await p.wait('document.querySelector(".hp-empty [role=alert]")', 'error de lista'); ck(!(await p.text('.hp-empty')).includes('Detalle técnico privado'), 'error seguro'); failList = false; await p.click('.hp-empty button', 'Reintentar'); await p.wait('document.querySelector(".hs-table")', 'reintento');
    await p.type('input[aria-label="Buscar matrículas"]', 0, 'inexistente-xyz'); await p.click('.hp-toolbar button', 'Buscar'); await p.wait('document.querySelector(".hp-empty h3")', 'vacío'); ck(true, 'lista vacía');
    await p.type('input[aria-label="Buscar matrículas"]', 0, '12345009'); await p.click('.hp-toolbar button', 'Buscar'); await p.wait('document.querySelector(".hs-table")', 'tabla');
  }
  const capture = async (page, file) => { const dir = process.env.MATRICULAS_SCREENSHOTS_DIR; if (dir) { fs.mkdirSync(dir, { recursive: true }); const shot = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(dir, file), Buffer.from(shot.data, 'base64')); } };
  await capture(p, 'matriculas-escritorio.png'); await kit.closePages();
  const m = await kit.session('/admin/dashboard?section=matriculas', 390); await m.wait('document.querySelector(".hs-table")', 'móvil'); ck(await m.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'móvil sin desborde'); await capture(m, 'matriculas-movil.png');
  await m.click('button', 'Registrar matrícula'); await m.wait('document.querySelector("[data-enrollment-form]") && [...document.querySelectorAll("dialog select")].length === 2 && [...document.querySelectorAll("dialog select")].every(s => !s.disabled)', 'formulario móvil cargado'); ck(await m.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'formulario móvil sin desborde'); await capture(m, 'matriculas-formulario-movil.png'); await kit.closePages();
  role = 'SECRETARIA'; const s = await kit.session('/admin/dashboard?section=matriculas'); await s.wait('document.querySelector(".hs-table")', 'secretaría'); ck((await s.text('.hm-enrollments')).includes('Registrar matrícula') && !(await s.text('.hs-table')).includes('Anular matrícula') && !(await s.text('.hs-table')).includes('Reactivar matrícula'), 'secretaría consulta y registra sin anular/reactivar'); await kit.closePages();
  role = null; const n = requests; const b = await kit.session('/admin/dashboard?section=matriculas'); await b.wait('document.querySelector(".hp-access-notice") || document.querySelector("main")?.textContent.includes("permiso")', 'cuenta básica'); ck(requests === n, 'cuenta básica no monta ni consulta Matrículas'); await kit.closePages();
  kit.finish('Matrículas' + (live ? ' React ↔ NestJS ↔ MySQL' : ' con API simulada'));
})().catch(e => { console.error(e.message); kit?.cleanup(); process.exit(1); });
