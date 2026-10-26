// Preinscripciones del panel con API simulada: nada real (sin backend, MySQL ni correo). Cubre: lista, filtros, detalle con historial y
// duplicados, validar con doble envío, motivo sin datos personales (no escribe), descartar, convertir (DNI inválido sin escribir, 409 de
// identidad sin «forzar», reintento deliberado), 409 de revisión y 5xx como resultado incierto sin reintento, corrección con solo los campos
// que cambiaron, avance por edición (mínimo de apertura) y recepción, permisos (solo lectura, secretaría, cuenta sin rol) y móvil.
const { start } = require('./smoke-kit.cjs');

const PERMS = {
  gerente: ['preinscripciones:leer', 'preinscripciones:editar', 'preinscripciones:convertir', 'preinscripciones:exportar', 'convocatorias:leer', 'convocatorias:editar', 'configuracion:leer'],
  secretaria: ['preinscripciones:leer', 'preinscripciones:editar', 'preinscripciones:convertir', 'convocatorias:leer', 'configuracion:leer'],
  lectura: ['preinscripciones:leer', 'configuracion:leer'],
  basica: [],
};
let who = 'gerente', failWrite = false, conflict = false, identity409 = 0, writes = 0, requests = 0, listFilters = [], lastBody = null, lastPath = '';
const now = new Date().toISOString();
const edition = { id: 3, nombre: 'Excel — Noviembre', estado: 'planificada', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', archivado_at: null, preinscripcion_estado: 'cerrada', minimo_apertura: 10, capacidad: 20, revision: 2, curso: { id: 1, titulo: 'Excel Básico', tipo: 'curso' } };
const person = (id, nombres, apellidos, estado, canal = 'formulario') => ({ id, convocatoria_id: 3, convocatoria: edition, nombres, apellidos, email: nombres.toLowerCase() + '@ejemplo.test', telefono: '+51 999 000 00' + id, canal, estado, consentimiento_at: now, aviso_version: 'v1', estudiante_id: null, matricula_id: null, convertida_at: null, revision: 1, createdAt: now, updatedAt: now });
const items = [person(1, 'Ana', 'Pérez', 'recibida'), person(2, 'Luis', 'Gómez', 'validada'), person(3, 'Rosa', 'Díaz', 'recibida', 'chatbot'), person(4, 'Iván', 'Soto', 'recibida')];
const history = [{ id: 1, createdAt: now, operacion: 'creacion', canal: 'formulario', actor_id: null, actor_rol: null, estado_anterior: null, estado_nuevo: 'recibida', campos: null, revision: 1, motivo: null }];
const session = () => ({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'g@preinscripciones.test', rol: who === 'basica' ? null : who === 'gerente' ? 'GERENTE_GENERAL' : who === 'secretaria' ? 'SECRETARIA' : 'COORDINADORA_INSTITUCIONAL', permisos: PERMS[who] }, acceso: { modo: 'por_roles' } });
const page1 = (list, total = list.length) => ({ page: 1, limit: 20, total, pages: Math.max(1, Math.ceil(total / 20)) });
let kit;
(async () => {
  kit = await start({ prefix: 'preinscripciones', handler: async (req, _res, { route, url, json, body }) => {
    if (!route.startsWith('/api/')) return false;
    if (route === '/api/admin/me') { json(session()); return true; }
    if (route.startsWith('/api/admin/preinscripciones') || route.startsWith('/api/admin/convocatorias/')) { requests++; if (req.method !== 'GET') writes++; }
    if (route === '/api/admin/preinscripciones/resumen') {
      const conteo = { recibida: 3, validada: 1, matriculada: 0, desistida: 0, descartada: 0, total: 4 };
      json({ ok: true, items: [{ convocatoria: edition, conteo, apertura: { minimo: 10, contadas: 1, faltan: 9, cumple_minimo: false }, cupos: { capacidad: 20, ocupados: 0, disponibles: 20 } }], pagination: page1([1]) }); return true;
    }
    if (route === '/api/admin/preinscripciones' && req.method === 'GET') {
      const q = url.searchParams; listFilters.push(url.search);
      const list = items.filter(i => (!q.get('estado') || i.estado === q.get('estado')) && (!q.get('canal') || i.canal === q.get('canal')) && (!q.get('convocatoria_id') || String(i.convocatoria_id) === q.get('convocatoria_id')) && (!q.get('search') || (i.nombres + ' ' + i.apellidos + i.email).toLowerCase().includes(q.get('search').toLowerCase())));
      json({ ok: true, items: list, pagination: page1(list) }); return true;
    }
    const match = route.match(/^\/api\/admin\/preinscripciones\/(\d+)(?:\/(historial|validacion|descarte|desistimiento|conversion))?$/);
    if (match) {
      const item = items.find(i => i.id === Number(match[1])), action = match[2];
      if (req.method === 'GET' && !action) { json({ ok: true, item, matricula: item.matricula_id ? { id: item.matricula_id, estado: 'activa' } : null, estudiante: null, coincidencias: item.id === 1 ? [{ id: 4, estado: 'recibida', canal: 'chatbot', createdAt: now, coincide: ['email'] }] : [] }); return true; }
      if (req.method === 'GET' && action === 'historial') { json({ ok: true, items: history, pagination: page1(history) }); return true; }
      const input = await body(); lastBody = input; lastPath = req.method + ' ' + action; await kit.sleep(100);
      if (failWrite) { json({ message: 'Detalle técnico que no debe mostrarse' }, 500); return true; }
      if (conflict) { json({ statusCode: 409, message: 'La preinscripción cambió desde que la abriste.', error: 'Conflict' }, 409); return true; }
      if (input.revision !== item.revision) { json({ statusCode: 409, message: 'La preinscripción cambió desde que la abriste.', error: 'Conflict' }, 409); return true; }
      if (action === 'conversion' && identity409 > 0) { identity409--; json({ statusCode: 409, error: 'Conflict', codigo: 'IDENTIDAD_DISCREPANTE', message: 'Los datos no coinciden.', discrepancias: ['nombres', 'contacto'] }, 409); return true; }
      if (action === 'validacion') item.estado = 'validada'; else if (action === 'descarte') item.estado = 'descartada'; else if (action === 'desistimiento') item.estado = 'desistida';
      else if (action === 'conversion') { item.estado = 'matriculada'; item.matricula_id = 50; item.estudiante_id = 60; }
      else Object.assign(item, input, { revision: undefined });
      item.revision = input.revision + 1;
      json(action === 'conversion' ? { ok: true, item, matricula: { id: 50 }, estudiante_creado: true } : { ok: true, item }, action === 'conversion' ? 201 : 200); return true;
    }
    if (route === '/api/admin/convocatorias/3/preinscripcion') {
      const input = await body(); lastBody = input; lastPath = 'PUT recepcion'; await kit.sleep(80);
      if (input.revision !== edition.revision) { json({ statusCode: 409, message: 'La edición cambió.', error: 'Conflict' }, 409); return true; }
      edition.preinscripcion_estado = input.estado; edition.revision++; json({ ok: true, item: { id: 3, revision: edition.revision, preinscripcion_estado: input.estado } }); return true;
    }
    json({ ok: true, items: [], settings: {}, pagination: page1([]) }); return true;
  } });
  const { ck } = kit;
  const overflow = 'document.documentElement.scrollWidth <= innerWidth';
  const settled = 'document.querySelector(".hs-table") && !document.querySelector(".hp-card[aria-busy=true]")';
  const act = async (p, who_, label) => { await p.wait(settled, 'lista estable'); const ok = await p.click('.hs-table button', label + ': ' + who_); if (!ok) throw new Error('No hay botón «' + label + '» para ' + who_); await p.wait('document.querySelector("dialog[open]")', 'diálogo ' + label); await p.wait('!document.querySelector("dialog[open] .hp-loading")', 'diálogo listo'); };
  const closeDialog = async p => { await p.click('dialog button', 'Volver'); await p.wait('!document.querySelector("dialog[open]") || document.querySelector(".hp-unsaved-dialog")', 'cierre'); if (await p.evaluate('!!document.querySelector(".hp-unsaved-dialog")')) { await p.click('.hp-unsaved-dialog button', 'Descartar cambios'); await p.wait('!document.querySelector("dialog[open]")', 'cierre confirmado'); } };
  const page = await kit.session('/admin/dashboard?section=preinscripciones', 1365);
  await page.wait(settled, 'tabla de preinscripciones');
  ck(await page.evaluate('document.querySelectorAll(".hs-table tbody tr").length === 4'), 'lista las solicitudes');
  await page.type('select[aria-label="Estado de la solicitud"]', 0, 'validada'); await page.wait('document.querySelectorAll(".hs-table tbody tr").length === 1', 'filtro por estado');
  ck(listFilters.some(f => f.includes('estado=validada')), 'el filtro viaja como parámetro del backend');
  await page.type('select[aria-label="Estado de la solicitud"]', 0, ''); await page.wait('document.querySelectorAll(".hs-table tbody tr").length === 4', 'sin filtro');

  // Detalle con historial y duplicados
  await page.click('.hs-table button', 'Ver detalle de Pérez, Ana'); await page.wait('document.querySelector("dialog[open] .hm-history")', 'detalle');
  await page.wait('document.querySelector("dialog[open]")?.textContent.includes("Recibida")', 'historial');
  ck((await page.text('dialog')).includes('Posibles duplicados') && (await page.text('dialog')).includes('Historial'), 'detalle con duplicados e historial');
  await page.click('dialog button', 'Cerrar'); await page.wait('!document.querySelector("dialog[open]")', 'cierre');

  // Validar con doble envío
  await act(page, 'Pérez, Ana', 'Validar'); let before = writes;
  await page.evaluate('const f=document.querySelector("[data-prereg-operation]");f.requestSubmit();f.requestSubmit();true');
  await page.wait('!document.querySelector("dialog[open]")', 'validación confirmada');
  ck(writes === before + 1 && lastBody.revision === 1 && Object.keys(lastBody).length === 1, 'validar: una sola escritura con solo la revisión', lastBody);
  ck(items[0].estado === 'validada', 'la solicitud queda validada');

  // Descartar: motivo con datos personales no se envía
  await page.wait(settled, 'lista'); await act(page, 'Díaz, Rosa', 'Descartar'); before = writes;
  await page.type('dialog[open] textarea', 0, 'Escribió desde rosa@ejemplo.test'); await page.click('dialog button', 'Confirmar');
  await page.wait('document.querySelector("dialog[open] .hs-field-error")', 'motivo rechazado');
  ck(writes === before, 'un motivo con correo no se envía');
  await page.type('dialog[open] textarea', 0, 'Ya no puede asistir en ese horario'); await page.click('dialog button', 'Confirmar'); await page.wait('!document.querySelector("dialog[open]")', 'descartada');
  ck(lastPath === 'PUT descarte' && lastBody.motivo === 'Ya no puede asistir en ese horario', 'descartar envía revisión y motivo', lastBody);

  // Convertir: DNI inválido, identidad 409, reintento deliberado
  await page.wait(settled, 'lista'); await act(page, 'Gómez, Luis', 'Convertir en matrícula'); before = writes;
  await page.type('dialog[open] input[name=dni]', 0, '123'); await page.click('dialog button', 'Confirmar'); await page.wait('document.querySelector("dialog[open] .hs-field-error")', 'DNI inválido');
  ck(writes === before, 'un DNI inválido no se envía');
  identity409 = 1; await page.type('dialog[open] input[name=dni]', 0, '12345678'); await page.click('dialog button', 'Confirmar'); await page.wait('document.querySelector("dialog[open] [role=alert]")', 'identidad');
  const alertText = await page.text('dialog [role=alert]');
  ck(alertText.includes('nombres y apellidos') && alertText.includes('correo o el teléfono') && !/forzar|omitir|ignorar/i.test(alertText) && !(await page.evaluate('[...document.querySelectorAll("dialog[open] button")].some(b => /forzar|ignorar/i.test(b.textContent))')), 'el 409 de identidad explica qué corregir sin ofrecer forzar', alertText);
  ck(await page.evaluate('!document.querySelector("dialog[open] button[type=submit]").disabled'), 'tras un 409 de identidad se puede corregir y repetir a propósito');
  await page.type('dialog[open] input[name=dni]', 0, '87654321'); await page.click('dialog button', 'Confirmar'); await page.wait('!document.querySelector("dialog[open]")', 'conversión');
  ck(lastPath === 'POST conversion' && lastBody.doc_numero === '87654321' && lastBody.revision === 1 && Object.keys(lastBody).length === 2, 'convertir envía revisión y DNI', lastBody);
  ck(items[1].estado === 'matriculada', 'la solicitud queda matriculada');
  await page.wait(settled, 'lista'); ck(!(await page.evaluate('[...document.querySelectorAll(".hs-table button")].some(b => /Validar|Descartar|Convertir/.test(b.getAttribute("aria-label") || "") && /Gómez/.test(b.getAttribute("aria-label") || ""))')), 'una solicitud matriculada ya no ofrece operaciones');

  // 409 de revisión: bloquea y permite consultar
  await act(page, 'Soto, Iván', 'Validar'); conflict = true; await page.click('dialog button', 'Confirmar'); await page.wait('document.querySelector("dialog[open] .hs-conflict")', '409');
  ck(await page.evaluate('document.querySelector("dialog[open] button[type=submit]").disabled'), '409 bloquea el reenvío'); conflict = false;
  before = writes; await kit.sleep(250); ck(writes === before, '409 no se reintenta solo');
  await page.click('dialog button', 'Consultar versión actual'); await page.wait('document.querySelector("dialog[open] .hs-conflict")?.textContent.includes("Estado actual")', 'versión actual');
  await page.click('dialog button', 'Cerrar'); await page.wait('!document.querySelector("dialog[open]")', 'cierre');

  // 5xx: resultado incierto
  await page.wait(settled, 'lista'); await act(page, 'Soto, Iván', 'Validar'); failWrite = true; before = writes;
  await page.click('dialog button', 'Confirmar'); await page.wait('document.querySelector("dialog[open] [role=alert]")', '500');
  ck(await page.evaluate('document.querySelector("dialog[open] button[type=submit]").disabled && !document.querySelector("dialog").textContent.includes("Detalle técnico")'), '5xx bloquea el reenvío y oculta el detalle técnico');
  await kit.sleep(300); ck(writes === before + 1, 'resultado incierto no se reintenta'); failWrite = false;
  await page.click('dialog button', 'Cerrar'); await page.wait('!document.querySelector("dialog[open]")', 'cierre');

  // Corrección: solo lo que cambió
  await page.wait(settled, 'lista'); await act(page, 'Soto, Iván', 'Corregir datos');
  await page.click('dialog button', 'Guardar correcciones'); await page.wait('document.querySelector("dialog[open] .hs-field-error")', 'sin cambios');
  await page.type('dialog[open] input[name=telefono]', 0, '999111222'); await page.click('dialog button', 'Guardar correcciones'); await page.wait('!document.querySelector("dialog[open]")', 'corregido');
  ck(lastPath === 'PATCH undefined' && JSON.stringify(Object.keys(lastBody).sort()) === '["revision","telefono"]', 'la corrección envía solo el campo cambiado y la revisión', lastBody);

  // Avance por edición y recepción
  await page.click('button', 'Avance por edición'); await page.wait('document.querySelector(".hr-edition-card")', 'avance');
  ck(await page.evaluate('document.querySelector("[role=progressbar]").getAttribute("aria-valuenow") === "1" && document.querySelector("[role=progressbar]").getAttribute("aria-valuemax") === "10"'), 'el avance muestra 1 de 10 validadas');
  ck((await page.text('.hr-edition-card')).includes('Faltan 9') && (await page.text('.hr-edition-card')).includes('Recepción cerrada'), 'faltan 9 y recepción cerrada');
  await page.click('.hr-edition-card button', 'Habilitar recepción'); await page.wait('document.querySelector("dialog[open]")', 'confirmar recepción'); before = writes;
  await page.click('dialog button', 'Confirmar'); await page.wait('!document.querySelector("dialog[open]")', 'recepción');
  ck(lastPath === 'PUT recepcion' && lastBody.revision === 2 && lastBody.estado === 'abierta' && writes === before + 1, 'habilitar la recepción envía la revisión de la edición', lastBody);
  await page.wait('document.querySelector(".hr-edition-card")?.textContent.includes("Recepción abierta")', 'recepción abierta');
  await page.click('.hr-edition-card button', 'Ver solicitudes'); await page.wait(settled, 'solicitudes de la edición');
  ck(listFilters.some(f => f.includes('convocatoria_id=3')) && (await page.text('.hp-card-heading')).includes('Excel — Noviembre'), 'ver solicitudes filtra por la edición');
  ck(await page.evaluate(overflow), 'escritorio sin desborde'); await kit.closePages();

  // Móvil
  const mobile = await kit.session('/admin/dashboard?section=preinscripciones', 390); await mobile.wait(settled, 'móvil');
  ck(await mobile.evaluate(overflow), 'móvil sin desborde de página');
  await mobile.click('button', 'Avance por edición'); await mobile.wait('document.querySelector(".hr-edition-card")', 'avance móvil'); ck(await mobile.evaluate(overflow), 'avance móvil sin desborde'); await kit.closePages();

  // Permisos
  who = 'lectura'; const readOnly = await kit.session('/admin/dashboard?section=preinscripciones'); await readOnly.wait(settled, 'solo lectura'); const writesBefore = writes;
  ck(await readOnly.evaluate('![...document.querySelectorAll(".hs-table button")].some(b => /Validar|Descartar|Corregir|Convertir|desistimiento/.test(b.getAttribute("aria-label") || ""))'), 'solo lectura: sin operaciones');
  await readOnly.click('button', 'Avance por edición'); await readOnly.wait('document.querySelector(".hr-edition-card")', 'avance solo lectura');
  ck(!/(Habilitar|Cerrar) recepción/.test(await readOnly.text('.hr-edition-card')), 'solo lectura: sin control de la recepción'); await kit.closePages();
  who = 'secretaria'; const secretary = await kit.session('/admin/dashboard?section=preinscripciones'); await secretary.wait(settled, 'secretaría');
  ck(await secretary.evaluate('[...document.querySelectorAll(".hs-table button")].some(b => /Validar/.test(b.getAttribute("aria-label") || ""))'), 'secretaría puede validar y convertir');
  await secretary.click('button', 'Avance por edición'); await secretary.wait('document.querySelector(".hr-edition-card")', 'avance secretaría');
  ck(!/(Habilitar|Cerrar) recepción/.test(await secretary.text('.hr-edition-card')), 'secretaría no controla la recepción (convocatorias:editar)'); await kit.closePages();
  who = 'basica'; const beforeRequests = requests;
  const basic = await kit.session('/admin/dashboard?section=preinscripciones'); await basic.wait('document.querySelector(".hp-access-notice") || document.querySelector("main")?.textContent.includes("permiso") || document.querySelector("main")?.textContent.includes("Mi espacio")', 'cuenta básica denegada');
  ck(requests === beforeRequests && writes === writesBefore, 'cuenta básica no monta ni consulta Preinscripciones'); await kit.closePages();
  kit.finish('Preinscripciones con API simulada');
})().catch(error => { console.error(error.message); kit?.cleanup(); process.exit(1); });
