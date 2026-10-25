// Fase 3B: navegador real contra API HTTP ficticia. Sin backend, MySQL, OpenAI ni correo.
// smoke-kit bloquea destinos externos antes de enviar y limpia su navegador/perfil.
const assert = require('node:assert/strict');
const { start } = require('./smoke-kit.cjs');
let kit;
const permissions = ['estudiantes:leer', 'estudiantes:crear', 'estudiantes:editar', 'cotizaciones:leer', 'cotizaciones:crear', 'cotizaciones:editar', 'cotizaciones:enviar', 'cotizaciones:anular'];
const student = { id: 1, nombres: 'Ana', apellidos: 'Prueba', doc_numero: '00112233', email: '', telefono: '', archivado_at: null, revision: 1 };
const quote = id => ({ id, numero: 'COT-' + id, cliente: 'Cliente ' + id, estado: 'borrador', revision: 1, moneda: 'PEN', subtotal: 100, impuesto: 18, total: 118, descuento: 0, tasa: 18, email: 'cliente@example.test', telefono: '', documento: '', direccion: '', emisor: 'Horus', datos_emisor: '', condiciones: '', validez: '2030-01-01', conceptos: [{ descripcion: 'Servicio', cantidad: 1, precio: 100 }], historial: [] });
let sim;
const reset = () => { sim = { students: [], quotes: [quote(1), quote(2)], writes: [], reads: [], studentCode: 500, statusCode: 200, detail: 'ok', pending: [], perm: permissions }; };
reset();
const handler = async (req, res, { route, url, json, body }) => {
  if (!route.startsWith('/api/')) return false;
  if (route === '/api/settings') { json({ ok: true, settings: {} }); return true; }
  if (route === '/api/admin/me') { json({ ok: true, user: { id: 1, nombre: 'Prueba', email: 'prueba@example.test', rol: 'GERENTE_GENERAL', permisos: sim.perm }, acceso: { modo: 'por_roles' } }); return true; }
  const sub = route.replace('/api/admin/', '');
  if (req.method === 'GET') sim.reads.push(sub + url.search);
  if (sub === 'estudiantes') {
    if (req.method === 'POST') {
      const data = await body(); sim.writes.push({ sub, data });
      // Simula persistencia ANTES de un 500: no permite asumir que falló el registro.
      if (sim.studentCode === 500) sim.students = [{ ...student, ...data }];
      json({ message: sim.studentCode === 409 ? 'Ya existe un estudiante con ese DNI.' : 'Error ficticio' }, sim.studentCode); return true;
    }
    json({ ok: true, items: sim.students, pagination: { total: sim.students.length, page: 1, limit: 20, pages: 1 } }); return true;
  }
  if (sub === 'cotizaciones') { json({ ok: true, items: sim.quotes, pagination: { total: 2, pages: 1 } }); return true; }
  const match = sub.match(/^cotizaciones\/(\d+)(\/estado)?$/);
  if (match) {
    const q = sim.quotes.find(item => item.id === +match[1]);
    if (req.method === 'POST') {
      const data = await body(); sim.writes.push({ sub, data });
      if (sim.statusCode === 'hang') { sim.pending.push(() => { if (!res.destroyed) json({ ok: true, item: { ...q, estado: data.estado, revision: q.revision + 1 } }); }); return true; }
      if (sim.statusCode !== 200) { json({ message: 'Conflicto o permiso insuficiente.' }, sim.statusCode); return true; }
      assert.equal(data.revision, q.revision, 'se envía la revisión vigente');
      q.estado = data.estado; q.revision++; json({ ok: true, item: q }); return true;
    }
    if (sim.detail === 'hang') { sim.pending.push(() => { if (!res.destroyed) json({ ok: true, item: q }); }); return true; }
    json({ ok: true, item: q }); return true;
  }
  json({ ok: true, items: [], pagination: { total: 0, pages: 1 } }); return true;
};
const STUDENTS = '/admin/dashboard?section=estudiantes', QUOTES = '/admin/dashboard?section=cotizaciones';
const ready = p => p.wait('document.querySelector(".hp-table tbody tr")', 'listado');
const detailReady = p => p.wait('[...document.querySelectorAll("dialog[open] h2")].some(x=>x.textContent==="Detalle de cotización")', 'detalle');
const top = 'dialog.hq-void-confirm[open]';
const blockedStudent = p => p.wait('document.querySelector("[data-student-form] button[type=submit]")?.disabled && !!document.querySelector(".hs-conflict")', 'registro bloqueado');
const fillStudent = async p => { await p.click('button', 'Registrar estudiante'); await p.label('Nombres', 'Ana'); await p.label('Apellidos', 'Prueba'); await p.label('DNI', '00112233'); };
const submitStudent = p => p.evaluate('(()=>{const f=document.querySelector("[data-student-form]"); f.requestSubmit(); f.requestSubmit(); return true;})()');
// Reloj acelerado SOLO para los límites de operación: comprueba el timeout real del componente sin esperar 20 s.
const fastDeadlines = p => p.evaluate('const original=window.setTimeout; window.setTimeout=(fn,ms,...args)=>original(fn,(ms===15000||ms===20000)?350:ms,...args); true');
(async () => {
  kit = await start({ prefix: 'admin-reliability', handler });
  const { ck } = kit;
  const clean = async () => { await kit.closePages(); reset(); };
  let p = await kit.session(STUDENTS); await p.wait('document.querySelector(".hs-students")', 'estudiantes');
  await fillStudent(p); await submitStudent(p); await blockedStudent(p);
  ck(sim.writes.length === 1, '500 después de persistir: un solo POST pese al doble envío');
  await submitStudent(p); await kit.sleep(150);
  ck(sim.writes.length === 1, 'un segundo envío accidental tras 500 no genera POST');
  ck(await p.evaluate('document.querySelector("input[name=nombres]").value==="Ana" && document.querySelector("input[name=doc_numero]").value==="00112233"'), '500 conserva el borrador y el DNI con ceros');
  ck((await p.text('dialog')).includes('No se pudo confirmar el resultado'), '500 advierte resultado incierto sin declararlo fallido');
  await p.click('dialog button', 'Consultar por DNI'); await p.wait('document.querySelector(".hs-conflict dl")', 'registro persistido');
  ck(sim.reads.some(s => s.includes('estado=todos') && s.includes('search=00112233')), 'consulta existente por DNI incluye archivados y no escribe');
  ck(await p.evaluate('document.querySelector("[data-student-form] button[type=submit]").disabled'), 'consultar no habilita otro POST');
  sim.students = []; await p.click('dialog button', 'Consultar por DNI'); await p.wait('document.querySelector(".hs-conflict")?.textContent.includes("Esto no confirma")', 'ausencia no concluyente');
  ck(sim.writes.length === 1, 'lista vacía no se interpreta como autorización para repetir');
  await clean(); sim.studentCode = 400;
  p = await kit.session(STUDENTS); await p.wait('document.querySelector(".hs-students")', 'estudiantes'); await fillStudent(p); await submitStudent(p);
  await p.wait('document.querySelector("[data-student-form] [role=alert]")', 'validación del servidor');
  ck(await p.evaluate('!document.querySelector("[data-student-form] button[type=submit]").disabled'), '400 de validación permite corregir sin bloquear');
  sim.studentCode = 409; await submitStudent(p); await kit.sleep(200);
  ck(await p.evaluate('!document.querySelector("input[name=doc_numero]").readOnly'), '409 por DNI conserva posibilidad de corregir el documento');
  await clean();

  p = await kit.session(QUOTES); await ready(p); await fastDeadlines(p); sim.detail = 'hang';
  await p.click('.hp-table button', 'Ver propuesta'); await p.wait('document.body.innerText.includes("tardó demasiado")', 'timeout de apertura');
  ck(await p.evaluate('![...document.querySelectorAll(".hp-table button")].some(x=>x.disabled)'), 'GET sin respuesta libera el estado ocupado al vencer el límite');
  sim.detail = 'ok'; await p.click('.hp-table button', 'Ver propuesta'); await detailReady(p);
  ck((await p.text('dialog')).includes('COT-1'), 'se puede abrir tras el timeout');
  await clean();

  p = await kit.session(QUOTES); await ready(p); sim.detail = 'hang'; await p.click('.hp-table button', 'Ver propuesta');
  await p.wait('document.body.innerText.includes("Cancelar consulta")', 'cancelación disponible'); await p.click('button', 'Cancelar consulta');
  await p.wait('![...document.querySelectorAll(".hp-table button")].some(x=>x.disabled)', 'limpieza tras cancelar');
  sim.detail = 'ok'; await p.evaluate('document.querySelectorAll(".hp-table tbody button")[1].click(); true'); await detailReady(p);
  sim.pending.splice(0).forEach(fn => fn()); await kit.sleep(200);
  ck((await p.text('dialog')).includes('COT-2') && !(await p.text('dialog')).includes('COT-1'), 'respuesta tardía de apertura cancelada no reemplaza otro detalle');
  await clean();

  p = await kit.session(QUOTES); await ready(p); await p.click('.hp-table button', 'Ver propuesta'); await detailReady(p);
  await p.click('dialog button', 'Marcar anulada'); await p.wait('document.body.innerText.includes("Confirmar anulación")', 'confirmación');
  ck((await p.text(top)).includes('estado terminal') && await p.evaluate('document.activeElement.textContent==="Cancelar"'), 'confirmación explica consecuencias y enfoca Cancelar');
  await p.click(top + ' button', 'Cancelar');
  ck(sim.writes.length === 0, 'cancelar anulación no envía ninguna solicitud');
  await p.click('dialog button', 'Marcar anulada');
  await p.evaluate('const b=[...document.querySelectorAll("dialog[open] button")].find(x=>x.textContent==="Confirmar anulación");b.click();b.click();true');
  await p.wait('document.querySelector("dialog[open]")?.textContent.includes("Estado actualizado")', 'anulación confirmada');
  ck(sim.writes.length === 1 && sim.writes[0].data.estado === 'anulada' && sim.quotes[0].revision === 2, 'doble confirmación envía una sola transición con revisión');
  await clean();

  for (const mode of ['timeout', 'cancel', 500, 409, 403]) {
    p = await kit.session(QUOTES); await ready(p); await p.click('.hp-table button', 'Ver propuesta'); await detailReady(p);
    sim.statusCode = mode === 'timeout' || mode === 'cancel' ? 'hang' : mode;
    if (mode === 'timeout') await fastDeadlines(p);
    await p.click('dialog button', 'Marcar enviada');
    if (mode === 'cancel') { await p.wait('document.querySelector("dialog button")?.disabled', 'escritura pendiente'); await p.click('dialog button', 'Detener espera'); }
    await p.wait('document.querySelector("dialog [role=alert]") && !document.querySelector("dialog button")?.disabled', 'fin de transición ' + mode);
    ck(sim.writes.length === 1, 'transición ' + mode + ': sin reintento automático y estado ocupado liberado');
    if (mode !== 403) {
      ck(await p.evaluate('[...document.querySelectorAll("dialog button")].find(x=>x.textContent==="Marcar enviada").disabled'), 'transición ' + mode + ': bloqueada hasta consultar');
      sim.pending.splice(0).forEach(fn => fn());
      await p.click('dialog button', 'Consultar versión actual'); await p.wait('![...document.querySelectorAll("dialog button")].find(x=>x.textContent==="Marcar enviada").disabled', 'versión actual');
      ck(sim.writes.length === 1 && (await p.text('dialog')).includes('COT-1'), 'transición ' + mode + ': consulta solo lectura recupera revisión e historial');
    } else ck((await p.text('dialog')).includes('permiso'), '403 conserva el mensaje de permisos del panel');
    await clean();
  }
  sim.perm = ['cotizaciones:leer', 'estudiantes:leer']; p = await kit.session(QUOTES); await ready(p); await p.click('.hp-table button', 'Ver propuesta'); await detailReady(p);
  ck(!await p.evaluate('[...document.querySelectorAll("dialog button")].some(x=>x.textContent.startsWith("Marcar "))'), 'sin permisos de escritura no se ofrecen transiciones ni anulación');
  await clean();

  p = await kit.session(QUOTES); await ready(p); sim.detail = 'hang'; await p.click('.hp-table button', 'Ver propuesta');
  await p.click('nav button', 'Estudiantes'); await p.wait('document.querySelector(".hs-students")', 'desmontaje de cotizaciones');
  sim.pending.splice(0).forEach(fn => fn()); await kit.sleep(150);
  ck(!await p.evaluate('!!document.querySelector("dialog[open]")'), 'respuesta pendiente tras desmontar no abre detalle en otra sección');
  kit.finish('Fiabilidad administrativa 3B');
})().catch(error => { console.error(error); kit?.cleanup(); process.exit(1); });
