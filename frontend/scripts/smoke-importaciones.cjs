const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./smoke-kit.cjs');
const { permissionsOf } = require('../../backend/dist/permissions/policy.js');
if (process.env.IMPORTACIONES_API_URL) throw new Error('API real solo por IPC de la integración aislada.');
let kit, live, targetId = 1, role = 'GERENTE_GENERAL', writes = 0;
const importRequests = [];
const tokens = {}, operation = '11111111-1111-4111-8111-111111111111';
const summary = { importados: 1, omitidos: 0, rechazados: 1, estudiantes_nuevos: 1 };
const rows = [{ fila: 2, datos: { doc_numero: '00012345', nombres: 'Ana', apellidos: 'Ficticia' }, estado: 'aceptable', errores: [], avisos: [] }, { fila: 3, datos: { doc_numero: '123', nombres: 'Otra', apellidos: 'Ficticia' }, estado: 'rechazada', errores: ['El DNI debe tener exactamente 8 dígitos.'], avisos: [] }];
const target = { id: 1, nombre: 'Edición de prueba', curso: { titulo: 'Curso ficticio', tipo: 'curso', id: 1 }, curso_id: 1, estado: 'abierta', archivado_at: null, capacidad: 50, disponibles: 50, ocupados: 0, revision: 1 };
const receipt = Buffer.from(JSON.stringify({ id: operation })).toString('base64url') + '.firma';
(async () => {
  if (process.env.HORUS_IMPORTACIONES_BROWSER_CHILD === 'true') {
    assert.equal(typeof process.send, 'function');
    const config = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Falta IPC')), 5000); process.once('message', m => { clearTimeout(timer); resolve(m); }); process.send({ type: 'request-isolated-api' }); });
    assert.equal(config.type, 'isolated-api'); assert.match(config.base, /^http:\/\/127\.0\.0\.1:\d+\/api$/); assert.match(config.database, /^horus_importaciones_it_[0-9a-f]{24}$/); live = config.base; targetId = config.edition;
    for (const [key, value] of [['g','GERENTE_GENERAL'], ['c','COORDINADORA_INSTITUCIONAL'], ['s','SECRETARIA'], ['b',null]]) {
      const r = await fetch(live + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: key + '@importacion.test', password: config.password }) }); assert.equal(r.status, 200); tokens[String(value)] = (await r.json()).token;
    }
  }
  kit = await start({ prefix: 'importaciones', handler: async (req, _res, { route, url, json, body }) => {
    if (!route.startsWith('/api/')) return false;
    if (route.startsWith('/api/admin/importaciones')) { importRequests.push({ route, page: req.headers.referer || '' }); if (route.endsWith('/confirmacion')) writes++; }
    if (live) { const input = req.method === 'GET' ? undefined : await body(); const r = await fetch(live + route.slice(4) + url.search, { method: req.method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[String(role)] }, ...(input ? { body: JSON.stringify(input) } : {}) }); json(await r.json(), r.status); return true; }
    if (route === '/api/admin/me') { json({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'ficticia@example.test', rol: role, permisos: permissionsOf(role) }, acceso: { modo: 'por_roles' } }); return true; }
    if (route.endsWith('/ediciones')) { json({ ok: true, items: [target], pagination: { page: 1, limit: 20, pages: 1, total: 1 } }); return true; }
    if (route.endsWith('/archivo')) { json({ ok: true, columnas: ['DNI','Nombres','Apellidos'], encabezado: 1, codificacion: 'utf-8', separador: ';', mapeo: { doc_numero: 0, nombres: 1, apellidos: 2 }, muestra: [['DNI','Nombres','Apellidos'], ['00012345','Ana','Ficticia']] }); return true; }
    if (route.endsWith('/vista-previa')) { json({ ok: true, filas: rows, resumen: summary, bloqueos: [], comprobante: receipt, destino: { id: 1, nombre: target.nombre, curso: target.curso.titulo, capacidad: 50, disponibles: 50 } }); return true; }
    if (route.endsWith('/confirmacion')) { await kit.sleep(200); json({ ok: true, operacion: operation, resumen: summary, filas: rows.map(r => ({ ...r, estado: r.estado === 'aceptable' ? 'importada' : r.estado })) }); return true; }
    json({ ok: true, items: [], pagination: { page: 1, limit: 20, pages: 0, total: 0 } }); return true;
  } });
  const { ck } = kit;
  const upload = async p => {
    await p.evaluate(`(() => { const f=new File([${JSON.stringify('DNI;Nombres;Apellidos\n00012345;Ana;Ficticia\n123;Otra;Ficticia')}], 'ficticio.csv', {type:'text/csv'});const dt=new DataTransfer();dt.items.add(f);const el=document.querySelector('input[type=file]');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await p.wait('document.querySelector(".hi-import details")', 'archivo reconocido');
    await p.wait('document.querySelector(".he-course-picker select") && !document.querySelector(".he-course-picker select").disabled', 'ediciones disponibles');
    await p.type('.he-course-picker select', 0, String(targetId));
    await p.click('.hi-import button', 'Generar vista previa'); await p.wait('document.querySelector(".hi-import")?.textContent.includes("1 aceptables")', 'vista previa');
  };
  const capture = async (p, name) => { const dir = path.resolve(__dirname, '../.artifacts/importaciones'); fs.mkdirSync(dir, { recursive: true }); const metrics = await p.send('Page.getLayoutMetrics'); const shot = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } }); fs.writeFileSync(path.join(dir, name), Buffer.from(shot.data, 'base64')); };
  const p = await kit.session('/admin/dashboard?section=importacion-excel', 1365);
  await p.wait('document.querySelector(".hi-import")', 'pantalla'); await upload(p);
  ck((await p.text('.hi-import')).includes('123') && (await p.text('.hi-import')).includes('rechazada'), 'errores por fila visibles'); ck(writes === 0, 'la vista previa no confirma');
  await capture(p, live ? 'real-escritorio.png' : 'escritorio.png');
  await p.click('.hi-import button', 'Revisar y confirmar'); await p.wait('document.querySelector("dialog[open] input[type=checkbox]")', 'confirmación');
  ck(await p.evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("Confirmar y guardar")).disabled'), 'confirmación explícita obligatoria');
  await p.evaluate('document.querySelector("dialog input[type=checkbox]").click();true');
  await p.evaluate('(() => {const b=[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("Confirmar y guardar"));b.click();b.click();return true;})()');
  await p.wait('document.querySelector(".hi-import")?.textContent.includes("Importación confirmada")', 'importación confirmada'); ck(writes === 1, 'doble clic envía una sola confirmación'); await kit.closePages();
  const m = await kit.session('/admin/dashboard?section=importacion-excel', 390); await m.wait('document.querySelector(".hi-import")', 'móvil');
  // En modo real se evita reimportar el archivo ya confirmado.
  if (!live) await upload(m);
  ck(await m.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'móvil sin desborde'); await capture(m, live ? 'real-movil.png' : 'movil.png'); await kit.closePages();
  role = 'COORDINADORA_INSTITUCIONAL'; const c = await kit.session('/admin/dashboard?section=importacion-excel'); await c.wait('document.querySelector(".hi-import")', 'coordinación');
  if (!live) { await upload(c); ck(!(await c.text('.hi-import')).includes('Revisar y confirmar importación'), 'coordinación solo previsualiza'); } await kit.closePages();
  // Atribuir solicitudes a su documento: una consulta cancelada de la pestaña anterior
  // puede alcanzar el servidor después de cerrarla y no pertenece a la cuenta denegada.
  for (const denied of ['SECRETARIA', null]) { role = denied; const marker = 'smoke-profile=' + String(denied); const b = await kit.session('/admin/dashboard?section=importacion-excel&' + marker); await b.wait('document.querySelector("[data-panel-access=denegado]")', 'acceso restringido'); ck(!importRequests.some(r => r.page.includes(marker)), String(role) + ' no monta ni consulta importaciones'); await kit.closePages(); }
  kit.finish(live ? 'Importaciones React ↔ NestJS ↔ MySQL' : 'Importaciones con API simulada');
})().catch(e => { console.error(e.message); kit?.cleanup(); process.exit(1); });
