// React compilado + API ficticia local. smoke-kit bloquea destinos externos antes de enviar.
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./smoke-kit.cjs');
const { permissionsOf } = require('../../backend/dist/permissions/policy.js');
const out = path.resolve(__dirname, '../.artifacts/phase3e/implementation');
fs.mkdirSync(out, { recursive: true });
const students = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, nombres: 'María Alejandra de Prueba ' + (i + 1), apellidos: 'Fernández del Campo Ficticia', doc_numero: i === 22 ? null : String(i + 1).padStart(8, '0'), archivado_at: null }));
const editions = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, curso_id: 1, curso: { id: 1, titulo: 'Programa ficticio de especialización en infraestructura de redes y seguridad de sistemas empresariales', tipo: 'curso' }, nombre: 'Edición ficticia noviembre 2026 · grupo ' + (i + 1), fecha_inicio: i === 22 ? null : '2026-11-01', fecha_fin: i === 22 ? null : '2026-11-30', estado: i === 1 ? 'cerrada' : 'abierta', archivado_at: null, capacidad: i === 2 ? null : 25, ocupados: 17, disponibles: i === 2 ? null : 8, revision: 3 }));
let kit, mode = 'ok', failOptions = false, writes = [], items = [], history = [], reads = [], pending = 0;
const checks = [], shots = [], measurements = [];
const studentSelector = '[data-enrollment-picker="Estudiante"]';
const editionSelector = '[data-enrollment-picker="Edición"]';
(async () => {
  kit = await start({ prefix: 'enrollment-form', handler: async (req, _res, { route, url, json, body }) => {
    if (!route.startsWith('/api/')) return false;
    const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20), search = url.searchParams.get('search') || '';
    const list = rows => json({ ok: true, items: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) } });
    if (route === '/api/admin/me') { json({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'fixture@horus.test', rol: 'GERENTE_GENERAL', permisos: permissionsOf('GERENTE_GENERAL') }, acceso: { modo: 'por_roles' } }); return true; }
    if (route === '/api/admin/estudiantes' || route === '/api/admin/matriculas/ediciones') {
      reads.push({ route, search, page });
      if (failOptions) { json({ message: 'Detalle privado de fixture' }, 500); return true; }
      if (search === 'lenta') { pending++; await kit.sleep(700); pending--; }
      const rows = route.endsWith('estudiantes') ? students : editions;
      list(search === 'lenta' ? [rows[1]] : rows.filter(row => JSON.stringify(row).toLowerCase().includes(search.toLowerCase()))); return true;
    }
    if (route === '/api/admin/matriculas' && req.method === 'POST') {
      const input = await body(); writes.push(input); await kit.sleep(200);
      if (mode !== 'ok') { json({ message: mode === '409' ? 'La edición cambió. Consulta la lista.' : 'Detalle privado de fixture' }, Number(mode)); return true; }
      const item = { id: 1, ...input, estudiante: students.find(s => s.id === input.estudiante_id), convocatoria: editions.find(e => e.id === input.convocatoria_id), estado: 'activa', cumplimiento: 'pendiente', revision: 1, createdAt: '2026-10-25T15:00:00Z', updatedAt: '2026-10-25T15:00:00Z' };
      items = [item]; history = [{ id: 1, operacion: 'creacion', estado_nuevo: 'activa', revision: 1, actor_id: 1, actor_rol: 'GERENTE_GENERAL', createdAt: item.createdAt }]; json({ ok: true, item }, 201); return true;
    }
    if (route === '/api/admin/matriculas') { list(items); return true; }
    if (route.endsWith('/historial')) { list(history); return true; }
    if (route === '/api/admin/matriculas/1') { json({ ok: true, item: items[0] }); return true; }
    if (req.method === 'PUT' && /^\/api\/admin\/matriculas\/1\/(anulacion|reactivacion)$/.test(route)) {
      const input = await body(); writes.push(input); await kit.sleep(200);
      const item = items[0]; item.estado = route.endsWith('anulacion') ? 'anulada' : 'activa'; item.revision++;
      history.unshift({ id: item.revision, operacion: item.estado === 'anulada' ? 'anulacion' : 'cambio_estado', estado_nuevo: item.estado, motivo: input.motivo, revision: item.revision, actor_id: 1, actor_rol: 'GERENTE_GENERAL', createdAt: item.createdAt });
      json({ ok: true, item }); return true;
    }
    json({ ok: true, items: [], settings: {}, pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true;
  } });
  const ck = (value, name) => { checks.push({ name, ok: !!value }); kit.ck(value, name); };
  const key = async (p, name, shift = false) => {
    const code = { Enter: 13, Escape: 27, Tab: 9 }[name];
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0, ...(name === 'Enter' ? { text: '\r' } : {}) });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
  };
  const open = async (width = 1280, height = 900) => {
    const p = await kit.session('/admin/dashboard?section=matriculas', width);
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
    await p.wait('document.querySelector(".hm-enrollments .hp-heading")', 'Matrículas montado');
    await p.click('button', 'Registrar matrícula');
    await p.wait('document.querySelector("[data-enrollment-form]") && [...document.querySelectorAll("dialog select")].length===2 && [...document.querySelectorAll("dialog select")].every(s=>!s.disabled)', 'selectores cargados');
    return p;
  };
  const change = async (p, selector) => {
    await p.click(selector + ' .hme-selection-heading button');
    try { await p.wait('document.activeElement.matches(' + JSON.stringify(selector + ' input') + ')', 'foco en búsqueda'); }
    catch (error) { console.log('Focus diagnostic', await p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)}),i=s.querySelector('input');return {active:document.activeElement.outerHTML,hidden:s.querySelector('.hme-picker').hidden,disabled:i.disabled,rects:i.getClientRects().length}})()`)); throw error; }
  };
  const select = async (p, selector, id) => {
    await p.type(selector + ' select', 0, String(id));
    await p.wait('document.querySelector(' + JSON.stringify(selector + ' .hme-picker') + ').hidden && document.activeElement===document.querySelector(' + JSON.stringify(selector + ' .hme-selection-heading button') + ')', 'selector plegado y foco restaurado');
  };
  const search = async (p, selector, value) => {
    await p.wait('!document.querySelector(' + JSON.stringify(selector + ' .hp-actions button') + ').disabled', 'búsqueda disponible');
    await p.type(selector + ' input', 0, value); await p.click(selector + ' .hp-actions button', 'Buscar');
    await p.wait('document.querySelector(' + JSON.stringify(selector + ' input') + ').value===' + JSON.stringify(value), 'texto de búsqueda');
  };
  const shot = async (p, name) => { const r = await p.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.data, 'base64')); shots.push(name); };
  const measure = async (p, name) => {
    await p.evaluate('document.fonts.load("600 20px Montserrat").then(()=>document.fonts.ready).then(()=>true)');
    const metric = await p.evaluate(`(()=>{const d=document.querySelector('.hme-dialog'),b=d.querySelector('.hme-body'),h=d.querySelector('header'),f=d.querySelector('.hp-dialog-footer');const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};return {viewport:[innerWidth,innerHeight],dialog:rect(d),header:rect(h),footer:rect(f),body:rect(b),outer:[d.clientHeight,d.scrollHeight],width:[b.clientWidth,b.scrollWidth],font:getComputedStyle(h.querySelector('h2')).fontFamily}})()`);
    measurements.push({ name, ...metric });
    ck(metric.outer[1] <= metric.outer[0] + 1 && metric.width[1] <= metric.width[0] + 1 && metric.dialog.x >= 0 && metric.dialog.right <= metric.viewport[0] && metric.footer.bottom <= metric.viewport[1] && metric.footer.y >= metric.header.bottom && metric.body.width > 0, name + ': sin desborde exterior; encabezado y pie dentro del viewport');
    ck(await p.evaluate(`(()=>{const d=document.querySelector('.hme-dialog'),b=d.querySelector('.hme-body'),r=b.getBoundingClientRect();return [...d.querySelectorAll('button,input,select,textarea')].filter(e=>e.getClientRects().length).every(e=>{const c=e.getBoundingClientRect();return c.height>=44 && (!b.contains(e) || c.right<=r.left+b.clientWidth+1)})})()`), name + ': controles de 44 px y sin invasión del espacio del scrollbar');
    if (name.endsWith('-empty')) await shot(p, name + '-top');
    await p.evaluate('document.querySelector(".hme-body").scrollTop=99999;true');
    ck(await p.evaluate(`(()=>{const d=document.querySelector('.hme-dialog'),f=d.querySelector('.hp-dialog-footer').getBoundingClientRect(),b=d.querySelector('.hme-body').getBoundingClientRect();return d.scrollTop===0 && f.bottom<=innerHeight && b.right<=d.getBoundingClientRect().right})()`), name + ': desplazamiento interno conserva acciones y espacio del scrollbar');
    await shot(p, name);
    await p.evaluate('document.querySelector(".hme-body").scrollTop=0;true');
  };
  let p = await open();
  ck(await p.evaluate('[...document.querySelectorAll(".hme-picker")].every(e=>!e.hidden) && [...document.querySelectorAll("dialog select")].every(s=>s.value==="")'), 'sin selección: ambos buscadores abiertos, sin valor automático');
  await p.evaluate('document.querySelector("[data-enrollment-form]").requestSubmit();true');
  await p.wait('document.querySelector(".hp-form-summary")', 'resumen de validación');
  ck(writes.length === 0 && await p.evaluate('document.activeElement.matches(\'[data-enrollment-picker="Estudiante"] input\') && document.querySelectorAll(".hme-selection[aria-invalid=true][aria-describedby]").length===2'), 'validación sin escritura, errores asociados y foco al primer campo');
  ck(await p.evaluate('[...document.querySelectorAll("dialog select")].every(s=>s.getAttribute("aria-invalid")==="true" && s.getAttribute("aria-describedby").split(" ").some(id=>document.getElementById(id)?.classList.contains("hme-field-error")))'), 'cada selector enlaza directamente su error de campo');
  await shot(p, 'validation-1280');
  await p.click('.hp-form-summary button', 'edición');
  await p.wait('document.activeElement.matches(\'[data-enrollment-picker="Edición"] input\')', 'resumen navegable');
  ck(true, 'resumen navegable a la edición');
  ck(await p.evaluate('[...document.querySelectorAll(\'[data-enrollment-picker="Edición"] option\')].filter(o=>o.disabled).length===2'), 'ediciones cerradas o sin capacidad no seleccionables');
  for (const selector of [studentSelector, editionSelector]) {
    await select(p, selector, 1);
    ck(await p.evaluate('document.activeElement===document.querySelector(' + JSON.stringify(selector + ' .hme-selection-heading button') + ') && !document.querySelector(' + JSON.stringify(selector + ' input') + ').getClientRects().length'), selector + ': seleccionar pliega, restaura foco y oculta controles');
    await change(p, selector); await p.click(selector + ' button', 'Más opciones');
    await p.wait('document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("Página 2")', 'segunda página');
    ck(await p.evaluate('document.querySelector(' + JSON.stringify(selector + ' select') + ').value==="1"'), selector + ': selección fuera de página conservada');
    await p.type(selector + ' input', 0, 'consulta pendiente'); await key(p, 'Escape');
    await p.wait('document.querySelector(' + JSON.stringify(selector + ' .hme-picker') + ').hidden && document.activeElement===document.querySelector(' + JSON.stringify(selector + ' .hme-selection-heading button') + ')', 'Escape pliega y restaura foco');
    ck(await p.evaluate('document.querySelector("[data-enrollment-form]")!==null && document.activeElement===document.querySelector(' + JSON.stringify(selector + ' .hme-selection-heading button') + ')'), selector + ': Escape conserva formulario y devuelve foco');
    await change(p, selector);
    ck(await p.evaluate('document.querySelector(' + JSON.stringify(selector + ' input') + ').value==="consulta pendiente" && document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("Página 2")'), selector + ': reapertura conserva búsqueda y página');
    await select(p, selector, 23); await change(p, selector);
    await search(p, selector, 'no-existe-xyz');
    await p.wait('document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("0 resultados")', 'vacío');
    ck(await p.evaluate('document.querySelector(' + JSON.stringify(selector + ' select') + ').value==="23"'), selector + ': vacío conserva selección y la tarjeta');
    await search(p, selector, 'lenta'); await p.wait('document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("Cargando opciones")', 'consulta lenta');
    await p.type(selector + ' input', 0, 'no-existe-xyz'); await key(p, 'Enter');
    await p.wait('document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("0 resultados")', 'consulta reciente');
    await kit.sleep(850);
    ck(await p.evaluate('document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("0 resultados") && document.querySelector(' + JSON.stringify(selector + ' select') + ').value==="23"'), selector + ': respuesta tardía no pisa resultados recientes');
    failOptions = true; await search(p, selector, 'error'); await p.wait('document.querySelector(' + JSON.stringify(selector + ' [role=alert]') + ')', 'error del selector');
    ck(!(await p.text(selector)).includes('Detalle privado'), selector + ': error seguro y selección preservada');
    failOptions = false; await p.click(selector + ' button', 'Reintentar'); await p.wait('!document.querySelector(' + JSON.stringify(selector + ' select') + ').disabled', 'reintento de consulta completado');
    await search(p, selector, ''); await p.wait('document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("Página 1 de 2")', 'resultados');
    await select(p, selector, 1);
  }
  ck(writes.length === 0, 'buscar, paginar, cambiar, plegar y reabrir no registran matrículas');
  await p.evaluate('document.querySelector(".hme-dialog > header button").focus();true'); await key(p, 'Tab', true);
  ck(await p.evaluate('document.activeElement.matches("[type=submit]")'), 'Shift+Tab cierra el ciclo del foco hacia registrar');
  await key(p, 'Tab'); ck(await p.evaluate('document.activeElement.matches(".hme-dialog > header button")'), 'Tab cierra el ciclo hacia cerrar');
  await p.evaluate('document.querySelector(\'[data-enrollment-picker="Estudiante"] button\').focus();true'); await key(p, 'Enter');
  await p.wait('document.activeElement.matches(\'[data-enrollment-picker="Estudiante"] input\')', 'Enter abre buscador');
  await key(p, 'Escape'); ck(await p.evaluate('document.querySelector(\'[data-enrollment-picker="Estudiante"] .hme-picker\').hidden'), 'Enter y Escape operan el buscador por teclado');
  await p.click('.hp-dialog-footer button', 'Cancelar'); await p.wait('document.querySelector(".hp-unsaved-dialog[open]")', 'borrador protegido');
  await p.click('.hp-unsaved-dialog button', 'Seguir'); ck(await p.evaluate('[...document.querySelectorAll("dialog.hme-dialog select")].every(s=>s.value==="1")'), 'cancelación protegida conserva ambas selecciones');
  await p.evaluate('const f=document.querySelector("[data-enrollment-form]");f.requestSubmit();f.requestSubmit();true');
  await p.wait('!document.querySelector(".hme-dialog")', 'registro confirmado');
  ck(writes.length === 1 && JSON.stringify(writes[0]) === JSON.stringify({ estudiante_id: 1, convocatoria_id: 1, convocatoria_revision: 3 }), 'registro confirmado una sola vez con contrato original y revisión de edición');
  await kit.closePages();
  for (const status of ['409', '500', '403']) {
    mode = status; p = await open(320); await select(p, studentSelector, 1); await select(p, editionSelector, 1);
    const n = writes.length; await p.click('dialog button[type=submit]'); await p.wait('document.querySelector(".hme-body > [role=alert]")', 'error ' + status);
    await kit.sleep(250);
    ck(writes.length === n + 1 && await p.evaluate('[...document.querySelectorAll("dialog select")].every(s=>s.value==="1") && !document.querySelector("dialog").textContent.includes("Detalle privado")'), status + ': conserva selecciones, error seguro y sin reenvío automático');
    ck(await p.evaluate('document.querySelector("dialog button[type=submit]").disabled') === (status !== '403'), status + ': bloqueo conservado según contrato');
    await shot(p, 'error-' + status + '-320'); await kit.closePages();
  }
  mode = 'ok';
  for (const [w, h] of [[1440,900],[1280,900],[820,900],[390,900],[320,900],[390,844],[320,700],[820,360],[320,360]]) {
    p = await open(w, h); await measure(p, `${w}x${h}-empty`);
    await select(p, studentSelector, 1); await select(p, editionSelector, 1);
    await measure(p, `${w}x${h}-selected`);
    ck(await p.evaluate('document.fonts.check("600 20px Montserrat") && getComputedStyle(document.querySelector(".hme-dialog h2")).fontFamily.includes("Montserrat")'), `${w}x${h}: Montserrat cargada`);
    for (const [selector, suffix] of [[studentSelector, 'student'], [editionSelector, 'edition']]) {
      await change(p, selector); await measure(p, `${w}x${h}-${suffix}`);
      await key(p, 'Escape');
    }
    await kit.closePages();
  }
  // Cierre durante consulta y nueva instancia: ninguna respuesta anterior debe modificarla.
  p = await open(); await search(p, studentSelector, 'lenta'); await p.wait('document.querySelector(\'[data-enrollment-picker="Estudiante"]\').textContent.includes("Cargando opciones")', 'carga pendiente');
  await p.click('.hp-dialog-footer button', 'Cancelar'); await p.wait('!document.querySelector(".hme-dialog")', 'cierre sin selección');
  await p.click('button', 'Registrar matrícula'); await p.wait('document.querySelector("[data-enrollment-form]")', 'reapertura'); await kit.sleep(850);
  ck(pending === 0 && await p.evaluate('[...document.querySelectorAll("dialog select")].every(s=>s.value==="") && [...document.querySelectorAll("dialog input")].every(s=>s.value==="")'), 'cierre durante carga y reapertura limpia sin respuesta obsoleta');
  for (const selector of [studentSelector, editionSelector]) {
    await p.click(selector + ' button', 'Más opciones');
    await p.wait('document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("Página 2")', 'página de registros sin datos opcionales');
    await select(p, selector, 23);
  }
  ck((await p.text('.hme-summary')).length > 0 && (await p.text('.hme-dialog')).includes('DNI sin registrar') && (await p.text('.hme-dialog')).includes('Sin fecha definida'), 'tarjetas contemplan DNI y fechas ausentes sin inventar datos');
  await shot(p, 'nullable-selected'); await kit.closePages();
  for (const [width, height] of [[1440,900], [820,900], [390,900], [320,360]]) {
    p = await kit.session('/admin/dashboard?section=matriculas', width);
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
    await p.wait('document.querySelector(".hs-table")', 'matrícula registrada en lista');
    for (const [action, suffix] of [['Anular matrícula', 'annul'], ['Reactivar matrícula', 'reactivate']]) {
      await p.click('.hs-table button', action); await p.wait('document.querySelector("[data-enrollment-operation]")', action);
      ck(await p.evaluate('document.activeElement.textContent==="Volver"'), `${width}x${height}: ${action} enfoca la acción segura`);
      await p.evaluate('document.querySelector("[data-enrollment-operation]").requestSubmit();true');
      ck(await p.evaluate('document.activeElement.matches("textarea[aria-invalid=true][aria-describedby]")'), action + ': motivo obligatorio con foco y error asociado');
      await p.label('Motivo', 'Motivo ficticio de ' + action + '. Se conserva el historial.');
      await measure(p, `${width}x${height}-${suffix}`);
      const n = writes.length;
      await p.evaluate('(()=>{const f=document.querySelector("[data-enrollment-operation]");f.requestSubmit();f.requestSubmit();return true})()');
      await p.wait('!document.querySelector(".hme-dialog")', action + ' confirmada');
      await p.wait('!document.querySelector(".hp-card[aria-busy=true]")', 'lista actualizada');
      ck(writes.length === n + 1, action + ': una sola solicitud confirmada');
    }
    await p.click('.hs-table button', 'Detalle e historial'); await p.wait('document.querySelector(".hm-history")?.textContent.includes("Reactivación")', 'historial completo');
    await measure(p, `${width}x${height}-detail`);
    ck((await p.text('.hm-history')).includes('Motivo ficticio'), 'detalle conserva motivos e historial sin suponer cupos disponibles');
    await kit.closePages();
  }
  const n = writes.length;
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2));
  fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(measurements, null, 2));
  fs.writeFileSync(path.join(out, 'fixture-summary.json'), JSON.stringify({ writes: n, reads: reads.length, pending, tests: checks.length }, null, 2));
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Matrículas React · Fase 3E</title><style>body{font:16px system-ui;margin:24px;background:#edf1f6;color:#172c48}main{display:flex;flex-wrap:wrap;gap:20px}figure{margin:0;width:min(100%,600px)}img{max-width:100%;border:1px solid #8390a4}figcaption{padding:12px}</style><h1>Matrículas React · Fase 3E</h1><p>React compilado en Edge con API ficticia local. Capturas reales de la aplicación; datos simulados. No demuestra persistencia MySQL ni teclado virtual físico.</p><main>' + shots.map(name => `<figure><a href="${name}.png"><img loading="lazy" src="${name}.png" alt="${name}"></a><figcaption>${name}</figcaption></figure>`).join('') + '</main>');
  kit.finish('Formulario de Matrículas · Fase 3E');
})().catch(error => { console.error(error); kit?.cleanup(); process.exit(1); });
