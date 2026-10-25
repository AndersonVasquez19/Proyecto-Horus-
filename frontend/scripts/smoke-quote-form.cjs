// Fase 3D: componente React compilado + API ficticia local. Sin datos ni correos reales.
// smoke-kit bloquea destinos externos antes de enviar y cierra el árbol de Edge.
const fs = require('node:fs'), path = require('node:path');
const { start, sleep } = require('./smoke-kit.cjs');
const dir = path.resolve(__dirname, '../.artifacts/phase3d/implementation');
const ROUTE = '/admin/dashboard?section=cotizaciones';
const all = ['cotizaciones:leer', 'cotizaciones:crear', 'cotizaciones:editar'];
const sample = { id: 1, numero: 'COT-0001', cliente: 'Empresa de prueba', email: 'cliente@example.test', telefono: '987654321', documento: 'Documento ficticio', direccion: 'Dirección de prueba', emisor: 'Horus Group', datos_emisor: 'Información ficticia del emisor', moneda: 'PEN', validez: '2030-01-01', condiciones: 'Condiciones de prueba', conceptos: [{ descripcion: 'Servicio ficticio', cantidad: 1, precio: 100 }], descuento: 0, tasa: 18, subtotal: 100, impuesto: 18, total: 118, revision: 4, estado: 'borrador', historial: [] };
let k, sim;
const reset = () => { sim = { quotes: [structuredClone(sample)], writes: [], keys: new Map(), mode: 'ok', permissions: all }; };
reset();
const handler = async (req, res, { route, json, body }) => {
  if (!route.startsWith('/api/')) return false;
  if (route === '/api/settings') { json({ ok: true, settings: {} }); return true; }
  if (route === '/api/admin/me') { json({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'prueba@example.test', rol: 'GERENTE_GENERAL', permisos: sim.permissions }, acceso: { modo: 'por_roles' } }); return true; }
  const sub = route.replace('/api/admin/', '');
  if (sub === 'cotizaciones' && req.method === 'POST') {
    const data = await body(), key = req.headers['idempotency-key'];
    sim.writes.push({ method: 'POST', data, key });
    if (sim.mode === '403') { json({ message: 'Permiso insuficiente.' }, 403); return true; }
    let q = sim.keys.get(key);
    if (!q) { q = { ...sample, ...data, id: sim.quotes.length + 1, numero: 'COT-000' + (sim.quotes.length + 1), revision: 1 }; sim.keys.set(key, q); sim.quotes.push(q); }
    await sleep(120);
    if (sim.mode === 'lost') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('respuesta ficticia ilegible'); return true; }
    json({ ok: true, item: q }); return true;
  }
  if (sub === 'cotizaciones') { json({ ok: true, items: sim.quotes, pagination: { total: sim.quotes.length, pages: 1, page: 1 } }); return true; }
  const match = sub.match(/^cotizaciones\/(\d+)$/);
  if (match) {
    const q = sim.quotes.find(x => x.id === +match[1]);
    if (req.method === 'PUT') {
      const data = await body(); sim.writes.push({ method: 'PUT', data });
      if (sim.mode === '409') { json({ message: 'La cotización cambió. Revisa la versión actual.' }, 409); return true; }
      Object.assign(q, data, { revision: q.revision + 1 });
    }
    json({ ok: true, item: q }); return true;
  }
  json({ ok: true, items: [], pagination: { total: 0, page: 1, pages: 0 } }); return true;
};
const form = p => p.wait('document.querySelector(".hqf-form")', 'formulario React');
const submit = p => p.evaluate('document.querySelector(".hqf-form").requestSubmit();true');
const openNew = async (width = 1280, height = 900) => {
  const p = await k.session(ROUTE, width);
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
  await p.wait('document.querySelector(".hqp-heading")', 'cotizaciones'); await p.click('button', 'Nueva cotización'); await form(p); return p;
};
const openExisting = async (action, reader = false) => {
  if (reader) sim.permissions = ['cotizaciones:leer'];
  const p = await k.session(ROUTE); await p.wait('document.querySelector(".hp-table button")', 'tabla');
  await p.click('.hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog[open] h2")?.textContent === "Detalle de cotización"', 'detalle');
  await p.click('dialog[open] button', action); await form(p); return p;
};
const fill = async p => { await p.label('Cliente', 'Cliente ficticio'); await p.label('Emisor de la propuesta', 'Horus Group'); await p.label('Descripción 1', 'Servicio ficticio'); };
const shot = async (p, name) => fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const key = async (p, name, modifiers = 0) => {
  const params = { key: name, code: name, windowsVirtualKeyCode: name === 'Tab' ? 9 : 13, modifiers };
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
};

(async () => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    k = await start({ prefix: 'phase3d-form', handler });
    const { ck } = k, measurements = [];
    for (const [width, height] of [[1440,900],[1280,900],[820,900],[390,900],[320,900],[390,844],[320,700],[820,360],[320,360]]) {
      reset(); const p = await openNew(width, height); await p.evaluate('document.fonts.ready'); await shot(p, 'after-' + width + 'x' + height + '-empty'); await fill(p);
      await p.label('Dirección', 'Dirección ficticia extensa '.repeat(10));
      await p.label('Datos del emisor', 'Información del emisor\n'.repeat(12));
      await p.label('Condiciones', 'Condiciones extensas\n'.repeat(25));
      const measure = () => p.evaluate(`(() => {
        const d=document.querySelector('.hqf-dialog'),b=d.querySelector('.hqf-body'),h=d.querySelector('header'),f=d.querySelector('.hqf-footer');
        const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
        const hit=e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
        return {dialog:rect(d),header:rect(h),footer:rect(f),body:rect(b),scrollTop:b.scrollTop,horizontal:d.scrollWidth>d.clientWidth||b.scrollWidth>b.clientWidth,outerScroll:d.scrollHeight>d.clientHeight+1,footerHit:[...f.querySelectorAll('button')].every(hit),font:getComputedStyle(d.querySelector('input')).fontFamily,headingSize:getComputedStyle(d.querySelector('.hqf-section h3')).fontSize,sections:d.querySelectorAll('.hqf-section').length,columns:getComputedStyle(d.querySelector('.hqf-line-grid')).gridTemplateColumns};
      })()`);
      await p.evaluate('document.querySelector(".hqf-body").scrollTop=0;true'); const before = await measure(); await shot(p, 'after-' + width + 'x' + height);
      await p.evaluate('document.querySelectorAll(".hqf-section")[2].scrollIntoView({block:"start"});true'); await shot(p, 'after-' + width + 'x' + height + '-concepts');
      await p.evaluate('document.querySelector(".hqf-body").scrollTop=100000;true'); const after = await measure(); await shot(p, 'after-' + width + 'x' + height + '-bottom');
      ck(before.sections === 4 && before.dialog.width <= 960, width + '×' + height + ': cuatro secciones y ancho máximo 960');
      ck(parseFloat(before.headingSize) >= 17 && before.font.includes('Montserrat'), width + '×' + height + ': títulos legibles y tipografía Montserrat');
      ck(!before.horizontal && !after.horizontal && !after.outerScroll, width + '×' + height + ': un solo scroll principal, sin desbordamiento horizontal');
      ck(after.header.top >= 0 && after.footer.bottom <= height && after.footerHit && after.scrollTop > 0 && before.header.top === after.header.top, width + '×' + height + ': encabezado y botones visibles y alcanzables al desplazar', after);
      if (width <= 390) ck(!after.columns.includes(' '), width + '×' + height + ': conceptos en una columna');
      await p.evaluate('document.querySelector(".hqf-dialog > header button").focus();true'); await key(p, 'Tab', 8);
      ck(await p.evaluate('document.activeElement.textContent.includes("Guardar borrador")'), width + '×' + height + ': Shift+Tab llega al último botón');
      await key(p, 'Tab'); ck(await p.evaluate('document.activeElement.getAttribute("aria-label")==="Cerrar ventana"'), width + '×' + height + ': Tab cierra el ciclo dentro del modal');
      measurements.push({ width, height, before, after }); await p.close();
    }
    fs.writeFileSync(path.join(dir, 'measurements.json'), JSON.stringify(measurements, null, 2));

    reset(); let p = await openNew();
    await submit(p); await p.wait('document.querySelector(".hqf-summary")', 'resumen de errores');
    ck(await p.evaluate('document.activeElement.id.endsWith("-cliente")') && sim.writes.length === 0, 'inválidos: foco en cliente y ninguna escritura');
    ck(await p.evaluate('[...document.querySelectorAll(".hqf-form [aria-invalid=true]")].every(e=>e.getAttribute("aria-describedby").split(" ").some(id=>document.getElementById(id)?.classList.contains("hp-field-error")))'), 'errores vinculados con aria-describedby');
    await p.click('.hqf-summary button', 'Emisor'); ck(await p.evaluate('document.activeElement.id.endsWith("-emisor")'), 'resumen navegable lleva al campo');
    await shot(p, 'validation'); await fill(p); await p.label('Correo del cliente', 'incorrecto'); await p.label('Cantidad', '0'); await p.label('Impuesto', '101'); await submit(p);
    ck(await p.evaluate('document.activeElement.type==="email" && document.querySelectorAll(".hqf-summary li").length===3') && sim.writes.length === 0, 'correo y rangos nativos bloquean el envío sin alterar restricciones');
    await p.label('Correo del cliente', ''); await p.label('Cantidad', '1'); await p.label('Impuesto', '18');
    ck(await p.evaluate('document.querySelector(".hqf-line-actions button").disabled'), 'límite mínimo: no se quita el único concepto');
    await p.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Añadir concepto").focus();true'); await key(p, 'Enter'); await p.wait('document.activeElement.id.endsWith("descripcion-1")', 'foco al concepto añadido con teclado'); await p.label('Descripción 2', 'Segundo concepto');
    await p.click('button', 'Quitar concepto 1'); await p.wait('document.querySelectorAll(".hqf-line").length===1', 'concepto quitado');
    ck(await p.evaluate('document.activeElement.value==="Segundo concepto"'), 'quitar preserva la identidad, el contenido y el foco del concepto restante');
    for (let i = 1; i < 50; i++) { await p.click('button', 'Añadir concepto'); await p.wait('document.querySelectorAll(".hqf-line").length===' + (i + 1), 'nuevo concepto'); }
    ck(await p.evaluate('document.querySelectorAll(".hqf-line").length===50 && [...document.querySelectorAll("button")].find(b=>b.textContent==="Añadir concepto").disabled'), 'límite máximo: 50 conceptos y añadir deshabilitado');
    await p.click('.hqf-footer button', 'Cancelar'); await p.wait('document.querySelector(".hp-unsaved-dialog[open]")', 'confirmar cancelación');
    ck(await p.evaluate('document.activeElement.textContent.includes("Seguir")') && sim.writes.length === 0, 'cancelar con cambios protege el borrador y enfoca la acción segura');
    await p.click('.hp-unsaved-dialog button', 'Seguir'); await p.wait('!document.querySelector(".hp-unsaved-dialog[open]")', 'continuar borrador');
    await p.evaluate(`(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;document.querySelectorAll('.hqf-line input[id*="descripcion-"]').forEach((e,i)=>{setter.call(e,'Servicio ficticio '+(i+1));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))});return true})()`);
    await submit(p); await p.wait('!document.querySelector(".hqf-form")', 'guardar 50 conceptos');
    ck(sim.writes.length === 1 && sim.writes[0].data.conceptos.length === 50, '50 conceptos válidos se guardan en una única solicitud'); await p.close();

    reset(); p = await openNew(); await fill(p);
    await p.evaluate('const f=document.querySelector(".hqf-form");f.requestSubmit();f.requestSubmit();true');
    await p.wait('!document.querySelector(".hqf-form")', 'creación guardada');
    ck(sim.writes.length === 1 && sim.writes[0].data.conceptos.length === 1 && !!sim.writes[0].key, 'creación: doble envío produce un POST con clave y contrato original'); await p.close();

    reset(); p = await openExisting('Editar borrador'); await p.label('Cliente', 'Cliente editado'); sim.mode = '409'; await submit(p);
    await p.wait('document.querySelector(".hqf-body .hp-error")', 'conflicto');
    ck(sim.writes.length === 1 && sim.writes[0].data.revision === 4 && await p.evaluate('document.querySelector(".hqf-form input").value==="Cliente editado"'), 'edición 409: conserva borrador y revisión, sin reenvío automático');
    sim.mode = 'ok'; await submit(p); await p.wait('!document.querySelector(".hqf-form")', 'edición guardada'); ck(sim.quotes[0].cliente === 'Cliente editado', 'edición confirmada actualiza la cotización'); await p.close();

    reset(); p = await openExisting('Preparar copia'); await submit(p); await p.wait('!document.querySelector(".hqf-form")', 'copia guardada');
    ck(sim.writes.length === 1 && sim.writes[0].method === 'POST' && !('revision' in sim.writes[0].data) && sim.writes[0].data.validez === sample.validez, 'copia: POST nuevo, misma vigencia y sin revisión heredada'); await p.close();
    reset(); p = await openExisting('Ver datos del formulario', true);
    ck(await p.evaluate('[...document.querySelectorAll(".hqf-form input,.hqf-form select,.hqf-form textarea,.hqf-fields button")].every(e=>e.matches(":disabled")) && !document.querySelector(".hqf-footer [type=submit]")'), 'solo lectura: campos y conceptos bloqueados, sin guardar');
    await submit(p); ck(sim.writes.length === 0, 'solo lectura: requestSubmit no escribe'); await p.close();

    for (const changed of [false, true]) {
      reset(); sim.mode = 'lost'; p = await openNew(changed ? 320 : 1280); await fill(p); await submit(p);
      await p.wait('document.querySelector("[data-quote-uncertain=uncertain]")', 'respuesta incierta');
      ck(sim.writes.length === 1 && await p.evaluate('document.activeElement.hasAttribute("data-quote-uncertain")'), 'resultado incierto: aviso enfocado, sin reintento automático');
      if (changed) await p.label('Cliente', 'Cliente modificado');
      await submit(p); await p.wait('document.querySelector("[data-quote-uncertain=confirming]")', 'confirmación de reintento');
      ck((await p.text('[data-quote-uncertain]')).includes(changed ? 'clave nueva' : 'misma clave') && sim.writes.length === 1, 'aviso preciso de idempotencia, contenido ' + (changed ? 'modificado' : 'idéntico'));
      ck(await p.evaluate('(()=>{const d=document.querySelector(".hqf-dialog"),b=d.querySelector(".hqf-body");return d.scrollWidth<=d.clientWidth && b.scrollWidth<=b.clientWidth && getComputedStyle(d.querySelector("[data-quote-uncertain]")).display==="block"})()'), 'aviso incierto legible y sin desbordamiento, incluso a 320 px');
      await shot(p, changed ? 'uncertain-320' : 'uncertain-1280');
      sim.mode = 'ok'; await p.click('button', 'Guardar de todos modos'); await p.wait('!document.querySelector(".hqf-form")', 'reintento confirmado');
      ck(sim.writes.length === 2 && (sim.writes[0].key === sim.writes[1].key) === !changed && sim.quotes.length === (changed ? 3 : 2), 'confirmación conserva/renueva clave según contenido; fixture aplica idempotencia'); await p.close();
    }
    reset(); sim.mode = '403'; p = await openNew(); await fill(p); await submit(p); await p.wait('document.querySelector(".hqf-body .hp-error")', '403');
    ck(sim.writes.length === 1 && await p.evaluate('document.querySelector(".hqf-form input").value==="Cliente ficticio"'), '403 conserva el formulario sin repetir el envío'); await p.close();
    await k.closePages(); k.finish('Formulario de Cotizaciones · Fase 3D');
  } catch (e) { console.error(e); if (k) k.cleanup(); process.exit(1); }
})();
