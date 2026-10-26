// Horarios de las ediciones con API simulada: nada real (sin backend, MySQL ni correo). Cubre: lectura, varios tramos el mismo día,
// validación local sin escribir, cuerpo del PUT (revisión y números reales), doble envío, 422 con tramos señalados, 409 que conserva el
// borrador y bloquea el reenvío (consultar y adoptar la versión actual), 5xx como resultado incierto sin reintento, respuesta ilegible,
// modo consulta (secretaría y edición archivada), reintento tras un fallo de lectura y móvil sin desborde.
const assert = require('node:assert/strict');
const { start } = require('./smoke-kit.cjs');

const READ = ['convocatorias:leer', 'configuracion:leer'];
const PERMISSIONS = { GERENTE_GENERAL: [...READ, 'convocatorias:crear', 'convocatorias:editar', 'convocatorias:cerrar', 'convocatorias:archivar'], SECRETARIA: READ };
let role = 'GERENTE_GENERAL', failRead = false, malformedRead = false, failWrite = false, force422 = false, writes = 0, readCount = 0, lastPut = null;
const now = new Date().toISOString();
const course = { id: 1, titulo: 'Excel Básico', tipo: 'curso', estado: 'publicado' };
const edition = (id, nombre, extra = {}) => ({ id, curso_id: 1, curso: course, nombre, fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', capacidad: 20, estado: 'abierta', archivado_at: null, revision: 4, createdAt: now, updatedAt: now, ...extra });
const editions = [edition(1, 'Edición con horarios'), edition(2, 'Edición archivada', { archivado_at: now, estado: 'cerrada' })];
const DAYS = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' };
const store = { 1: { revision: 4, items: [{ dia_semana: 1, hora_inicio: '19:00', hora_fin: '21:00' }] }, 2: { revision: 4, items: [{ dia_semana: 3, hora_inicio: '18:00', hora_fin: '20:00' }] } };
let ids = 100;
const view = id => { const e = editions.find(x => x.id === id); return { ok: true, convocatoria: { id, nombre: e.nombre, estado: e.estado, archivada: !!e.archivado_at, revision: store[id].revision, modificable: !e.archivado_at && e.estado !== 'cancelada' }, zona_horaria: 'America/Lima', items: store[id].items.map(i => ({ id: i.id ?? ++ids, dia: DAYS[i.dia_semana], ...i })) }; };
const session = () => ({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'g@horarios.test', rol: role, permisos: PERMISSIONS[role] }, acceso: { modo: 'por_roles' } });
let kit;
(async () => {
  kit = await start({ prefix: 'horarios', handler: async (req, _res, { route, url, json, body }) => {
    if (!route.startsWith('/api/')) return false;
    if (route === '/api/admin/me') { json(session()); return true; }
    if (route === '/api/admin/convocatorias/cursos') { json({ ok: true, items: [course], pagination: { page: 1, limit: 20, total: 1, pages: 1 } }); return true; }
    const schedule = route.match(/^\/api\/admin\/convocatorias\/(\d+)\/horarios$/);
    if (schedule) {
      const id = Number(schedule[1]);
      if (req.method === 'GET') {
        readCount++;
        if (failRead) { json({ message: 'Error ficticio interno' }, 500); return true; }
        if (malformedRead) { json({ ok: true, convocatoria: {}, items: 'no' }); return true; }
        json(view(id)); return true;
      }
      writes++; const input = await body(); lastPut = input; await kit.sleep(100);
      if (failWrite) { json({ message: 'Detalle técnico que no debe mostrarse' }, 500); return true; }
      if (force422) { json({ statusCode: 422, error: 'Unprocessable Entity', codigo: 'HORARIO_SOLAPADO', message: 'Hay horarios que se solapan el mismo día.', conflictos: [{ tipo: 'solapamiento', primero: input.horarios[0], segundo: input.horarios[1] }] }, 422); return true; }
      if (input.revision !== store[id].revision) { json({ statusCode: 409, message: 'Los horarios cambiaron desde que los abriste.', error: 'Conflict' }, 409); return true; }
      store[id] = { revision: store[id].revision + 1, items: input.horarios }; json({ ...view(id), cambios: true }); return true;
    }
    if (route === '/api/admin/convocatorias') {
      const filtered = editions.filter(e => url.searchParams.get('archivo') === 'todos' || (url.searchParams.get('archivo') === 'archivados' ? !!e.archivado_at : !e.archivado_at));
      json({ ok: true, items: filtered.map(e => ({ ...e, revision: store[e.id].revision })), pagination: { page: 1, limit: 20, total: filtered.length, pages: 1 } }); return true;
    }
    json({ ok: true, items: [], settings: {}, pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true;
  } });
  const { ck } = kit;
  const overflow = 'document.documentElement.scrollWidth <= innerWidth';
  const slots = () => 'document.querySelectorAll("dialog[open] .he-schedule-row").length';
  const open = async (page, name) => { await page.wait('document.querySelector(".hs-table") && !document.querySelector(".hp-card[aria-busy=true]")', 'lista de ediciones estable'); await page.click('.hs-table button', 'Horarios de ' + name); await page.wait('document.querySelector("dialog[open] [data-schedule-form]")', 'diálogo de horarios'); await page.wait('!document.querySelector("dialog[open] .hp-loading")', 'horarios cargados'); };
  const page = await kit.session('/admin/dashboard?section=ediciones', 1365);
  await page.wait('document.querySelector(".he-editions .hs-table")', 'tabla de ediciones');

  // Lectura y alta de varios tramos
  await open(page, 'Edición con horarios');
  ck(await page.evaluate(slots() + ' === 1 && document.querySelector("dialog[open] select[name=dia_semana]").value === "1"'), 'carga el horario guardado');
  ck(await page.evaluate('document.querySelector("dialog[open] button[type=submit]").disabled'), 'sin cambios no se puede guardar');
  await page.click('dialog button', 'Agregar horario'); await page.click('dialog button', 'Agregar horario');
  await page.wait(slots() + ' === 3', 'dos filas nuevas');
  await page.type('dialog[open] select[name=dia_semana]', 1, '6'); await page.type('dialog[open] input[name=hora_inicio]', 1, '09:00'); await page.type('dialog[open] input[name=hora_fin]', 1, '12:00');
  await page.type('dialog[open] select[name=dia_semana]', 2, '6'); await page.type('dialog[open] input[name=hora_inicio]', 2, '11:00'); await page.type('dialog[open] input[name=hora_fin]', 2, '14:00');
  const before = writes;
  await page.click('dialog button', 'Guardar horarios'); await page.wait('document.querySelector("dialog[open] .he-schedule-row.has-error")', 'solapamiento local');
  ck(writes === before && (await page.text('dialog')).includes('Se solapa'), 'el solapamiento se señala sin enviar nada');
  await page.type('dialog[open] input[name=hora_inicio]', 2, '12:00'); await page.type('dialog[open] input[name=hora_fin]', 2, '14:00');
  await page.evaluate('const f=document.querySelector("[data-schedule-form]");f.requestSubmit();f.requestSubmit();true');
  await page.wait('!document.querySelector("dialog[open]")', 'guardado confirmado');
  ck(writes === before + 1, 'doble envío escribe una sola vez');
  ck(lastPut.revision === 4 && lastPut.horarios.length === 3 && lastPut.horarios.every(h => Number.isInteger(h.dia_semana) && !('id' in h)), 'cuerpo con la revisión y el conjunto completo sin ids', lastPut);
  ck(store[1].revision === 5, 'la revisión de la edición sube');
  await open(page, 'Edición con horarios');
  ck(await page.evaluate(slots() + ' === 3'), 'tramos contiguos y varios en un día se conservan');
  ck(await page.evaluate(overflow), 'escritorio sin desborde'); await page.click('dialog button', 'Cancelar'); await page.wait('!document.querySelector("dialog[open]")', 'cierre');

  // 422 del servidor: tramos señalados y borrador intacto
  await open(page, 'Edición con horarios'); await page.type('dialog[open] input[name=hora_fin]', 0, '22:00');
  force422 = true; await page.click('dialog button', 'Guardar horarios'); await page.wait('document.querySelector("dialog[open] [role=alert]")', '422');
  ck(await page.evaluate('document.querySelectorAll("dialog[open] .he-schedule-row.has-error").length === 2 && !document.querySelector("dialog[open] button[type=submit]").disabled'), '422 señala los tramos y permite corregir');
  ck((await page.text('dialog')).includes('se solapan'), 'muestra el mensaje del servidor'); force422 = false;
  await page.click('dialog button', 'Cancelar'); await page.wait('document.querySelector(".hp-unsaved-dialog")', 'protección de borrador'); await page.click('.hp-unsaved-dialog button', 'Descartar cambios'); await page.wait('!document.querySelector("dialog[open]")', 'cierre');

  // 409: otro usuario cambió la edición
  await open(page, 'Edición con horarios'); await page.type('dialog[open] input[name=hora_fin]', 0, '20:30');
  store[1] = { revision: 9, items: [{ dia_semana: 2, hora_inicio: '08:00', hora_fin: '09:00' }] };
  await page.click('dialog button', 'Guardar horarios'); await page.wait('document.querySelector("dialog[open] .hs-conflict")', '409');
  ck(await page.evaluate('document.querySelector("dialog[open] input[name=hora_fin]").value === "20:30" && document.querySelector("dialog[open] button[type=submit]").disabled'), '409 conserva el borrador y bloquea el reenvío');
  const afterConflict = writes; await kit.sleep(300); ck(writes === afterConflict, '409 no se reintenta solo');
  await page.click('dialog button', 'Consultar versión actual'); await page.wait('document.querySelector("dialog[open] .hs-conflict")?.textContent.includes("revisión 9")', 'versión remota');
  await page.click('dialog button', 'Usar la versión actual'); await page.wait(slots() + ' === 1 && !document.querySelector("dialog[open] .hs-conflict")', 'versión adoptada');
  await page.type('dialog[open] input[name=hora_fin]', 0, '10:00'); await page.click('dialog button', 'Guardar horarios'); await page.wait('!document.querySelector("dialog[open]")', 'guardado con la revisión nueva');
  ck(store[1].revision === 10 && lastPut.revision === 9, 'tras adoptar la versión actual se guarda con su revisión');

  // 5xx: resultado incierto
  await open(page, 'Edición con horarios'); await page.type('dialog[open] input[name=hora_fin]', 0, '11:00'); failWrite = true;
  const beforeFail = writes; await page.click('dialog button', 'Guardar horarios'); await page.wait('document.querySelector("dialog[open] [role=alert]")', '500');
  ck(await page.evaluate('document.querySelector("dialog[open] button[type=submit]").disabled && !document.querySelector("dialog").textContent.includes("Detalle técnico")'), '5xx bloquea el reenvío y oculta el detalle técnico');
  await kit.sleep(300); ck(writes === beforeFail + 1, 'resultado incierto no se reintenta'); failWrite = false;
  await page.click('dialog button', 'Cancelar'); await page.wait('document.querySelector(".hp-unsaved-dialog")', 'descartar'); await page.click('.hp-unsaved-dialog button', 'Descartar cambios'); await page.wait('!document.querySelector("dialog[open]")', 'cierre');

  // Lectura fallida y respuesta ilegible
  failRead = true; await page.click('.hs-table button', 'Horarios de Edición con horarios'); await page.wait('document.querySelector("dialog[open] .hp-empty [role=alert]")', 'error de lectura');
  ck(!(await page.text('dialog')).includes('Error ficticio interno'), 'error de lectura sin detalle técnico');
  failRead = false; malformedRead = true; await page.click('dialog button', 'Reintentar'); await page.wait('document.querySelector("dialog[open] .hp-empty [role=alert]")', 'respuesta ilegible');
  ck(!(await page.evaluate('!!document.querySelector("dialog[open] .he-schedule-list")')), 'una respuesta fuera de contrato no se muestra a medias');
  malformedRead = false; await page.click('dialog button', 'Reintentar'); await page.wait('document.querySelector("dialog[open] .he-schedule-list")', 'reintento correcto'); await page.click('dialog button', 'Cerrar'); await page.wait('!document.querySelector("dialog[open]")', 'cierre');

  // Edición archivada: consulta
  await page.type('select[aria-label="Archivo de ediciones"]', 0, 'archivados'); await page.wait('document.querySelector(".hs-table")?.textContent.includes("Edición archivada")', 'archivadas');
  await open(page, 'Edición archivada');
  ck(await page.evaluate('!document.querySelector("dialog[open] button[type=submit]") && !document.querySelector("dialog[open] select")') && (await page.text('dialog')).includes('solo se pueden consultar'), 'edición archivada: solo consulta');
  await page.click('dialog button', 'Cerrar'); await kit.closePages();

  // Móvil
  const mobile = await kit.session('/admin/dashboard?section=ediciones', 390); await mobile.wait('document.querySelector(".hs-table")', 'móvil');
  await open(mobile, 'Edición con horarios'); await mobile.click('dialog button', 'Agregar horario'); await mobile.wait(slots() + ' === 2', 'fila en móvil');
  ck(await mobile.evaluate(overflow), 'móvil sin desborde de página');
  ck(await mobile.evaluate('(() => { const d = document.querySelector("dialog[open]").getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth; })()'), 'el diálogo cabe en la pantalla'); await kit.closePages();

  // Secretaría: consulta, sin escritura
  role = 'SECRETARIA'; const secretary = await kit.session('/admin/dashboard?section=ediciones'); await secretary.wait('document.querySelector(".hs-table")', 'secretaría');
  const beforeSecretary = writes; await open(secretary, 'Edición con horarios');
  ck(await secretary.evaluate('!document.querySelector("dialog[open] button[type=submit]") && !document.querySelector("dialog[open] select") && document.querySelector("dialog[open]").textContent.includes("no modificarlos")'), 'secretaría consulta sin controles de edición');
  ck(writes === beforeSecretary && readCount > 0, 'ninguna escritura sin permiso');
  assert.ok(true); await kit.closePages();
  kit.finish('Horarios con API simulada');
})().catch(error => { console.error(error.message); kit?.cleanup(); process.exit(1); });
