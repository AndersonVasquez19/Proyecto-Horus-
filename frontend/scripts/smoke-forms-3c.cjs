// Fase 3C: Edge real y API ficticia; smoke-kit bloquea toda salida externa.
// --before captura el build anterior sin exigir las mejoras nuevas.
const fs = require('node:fs'), path = require('node:path');
const { start } = require('./smoke-kit.cjs');
const before = process.argv.includes('--before');
const dir = path.resolve(__dirname, '../.artifacts/forms-3c', before ? 'before' : 'after');
let kit, writes = 0, code = 201, pending, readOnly = false;
const permissions = ['estudiantes:leer', 'estudiantes:crear', 'estudiantes:editar', 'mensajes:leer', 'mensajes:crear', 'cotizaciones:leer'];
const student = { id: 1, nombres: 'Ana', apellidos: 'Prueba', doc_numero: '00112233', revision: 1, archivado_at: null };
const handler = async (req, _res, { route, json, body }) => {
  if (!route.startsWith('/api/')) return false;
  if (route === '/api/settings') json({ ok: true, settings: {} });
  else if (route === '/api/admin/me') json({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'ui@example.test', rol: 'GERENTE_GENERAL', permisos: readOnly ? ['estudiantes:leer'] : permissions }, acceso: { modo: 'por_roles' } });
  else if (route === '/api/admin/estudiantes' && req.method === 'POST') {
    writes++; const data = await body();
    const respond = () => json(code === 201 ? { ok: true, item: { ...student, ...data } } : { message: 'Error ficticio' }, code);
    if (pending === true) pending = respond; else respond();
  } else if (route === '/api/admin/estudiantes') json({ ok: true, items: [], pagination: { total: 0, page: 1, limit: 20, pages: 0 } });
  else if (route === '/api/admin/messages') json({ ok: true, messages: [], pagination: { total: 0, page: 1, limit: 20, pages: 0 }, metrics: { nuevo: 0, en_proceso: 0, atendido: 0, archivado: 0 } });
  else json({ ok: true, items: [], pagination: { total: 0, pages: 0 } });
  return true;
};
const STUDENTS = '/admin/dashboard?section=estudiantes';
const open = async width => {
  const p = await kit.session(STUDENTS, width);
  await p.wait('document.querySelector(".hs-students")', 'estudiantes');
  await p.click('button', 'Registrar estudiante');
  await p.wait('document.querySelector("[data-student-form]")', 'formulario');
  await p.evaluate('document.fonts.ready');
  return p;
};
const shot = async (p, name) => {
  await p.evaluate('document.fonts.ready');
  fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
};
const key = async (p, name, virtual, shift = false) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: virtual, modifiers: shift ? 8 : 0, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: virtual, modifiers: shift ? 8 : 0 });
  await kit.sleep(50);
};
const revealActions = async p => {
  // La fuente cambia el alto del título y del cuerpo: esperar ANTES de calcular el scroll.
  await p.evaluate('document.fonts.ready');
  return p.evaluate(`(()=>{
    const dialog=document.querySelector('dialog[open]'), footer=dialog.querySelector('.hp-dialog-footer');
    let scroller=footer.parentElement;
    while(scroller!==dialog && !(/auto|scroll/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight>scroller.clientHeight)) scroller=scroller.parentElement;
    scroller.scrollTop=scroller.scrollHeight;
    return {tag:scroller.tagName, className:scroller.className, scrollTop:scroller.scrollTop};
  })()`);
};
const geometry = async p => {
  await p.evaluate('document.fonts.ready');
  return p.evaluate(`(()=>{
  const d=document.querySelector('dialog[open]'), r=d.getBoundingClientRect();
  const buttons=[...d.querySelectorAll('.hp-dialog-footer button')];
  const left=r.left+d.clientLeft, top=r.top+d.clientTop;
  const visible={left:Math.max(0,left),right:Math.min(innerWidth,left+d.clientWidth),top:Math.max(0,top),bottom:Math.min(innerHeight,top+d.clientHeight)};
  return {width:innerWidth, left:r.left, right:r.right, client:d.clientWidth, scroll:d.scrollWidth,
    visible,font:getComputedStyle(d).fontFamily,controls:[...d.querySelectorAll('input, textarea, select')].map(el=>getComputedStyle(el).fontFamily),
    buttons:buttons.map(b=>{const x=b.getBoundingClientRect();return {text:b.textContent,left:x.left,right:x.right,top:x.top,bottom:x.bottom,height:x.height,font:getComputedStyle(b).fontFamily,
      fullyVisible:x.width>0 && x.height>0 && x.left>=visible.left && x.right<=visible.right && x.top>=visible.top && x.bottom<=visible.bottom}})};
})()`);
};
const fill = async p => { await p.label('Nombres', 'Ana'); await p.label('Apellidos', 'Prueba'); await p.label('DNI', '00112233'); };
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  kit = await start({ prefix: 'forms-3c', handler });
  const evidence = [];
  for (const width of [1440, 1280, 820, 390, 320]) {
    const p = await open(width);
    await shot(p, 'estudiantes-' + width);
    if (!before) kit.ck(await p.evaluate('(()=>{const d=document.querySelector("dialog[open]"), b=d.querySelector(".hs-student-body"); const f=d.querySelector(".hp-dialog-footer").getBoundingClientRect();return f.bottom<=innerHeight && f.top>=0 && b.scrollWidth<=b.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth+1})()'), width + ': pie visible desde la apertura y cuerpo sin desborde');
    const studentScroller = await revealActions(p);
    await shot(p, 'estudiantes-acciones-' + width);
    const g = await geometry(p); evidence.push({ module: 'estudiantes', scroller: studentScroller, ...g });
    if (!before) {
      kit.ck(g.left >= 0 && g.right <= width && g.scroll <= g.client + 1, width + ': diálogo sin desborde horizontal');
      kit.ck(g.buttons.every(b => b.fullyVisible && b.height >= 44), width + ': acciones completas dentro del diálogo y del viewport, y táctiles');
      kit.ck(g.font.startsWith('Montserrat') && g.controls.every(f => f.startsWith('Montserrat')) && g.buttons.every(b => b.font.startsWith('Montserrat')), width + ': Estudiantes mantiene Montserrat en diálogo, campos y botones');
      await p.click('dialog button', 'Cancelar');
      kit.ck(await p.evaluate('!document.querySelector("dialog[open]") && document.activeElement.textContent.includes("Registrar estudiante")'), width + ': Cancelar cierra y restaura foco');
    }
    await kit.closePages();
    const m = await kit.session('/admin/dashboard?section=mensajes&crear=1', width);
    await m.wait('document.querySelector("dialog[open] form")', 'registro manual');
    const manualScroller = await revealActions(m);
    await shot(m, 'consulta-acciones-' + width);
    const gm = await geometry(m); evidence.push({ module: 'consulta', scroller: manualScroller, ...gm });
    if (!before) {
      kit.ck(gm.left >= 0 && gm.right <= width && gm.scroll <= gm.client + 1 && gm.buttons.every(b => b.fullyVisible && b.height >= 44), width + ': registro manual con acciones completas dentro del diálogo y del viewport, sin desborde');
      kit.ck(gm.font.startsWith('Montserrat') && gm.controls.every(f => f.startsWith('Montserrat')) && gm.buttons.every(b => b.font.startsWith('Montserrat')), width + ': registro manual mantiene Montserrat');
      if (width === 320) {
        // Control negativo: recortar un botón dentro del viewport debe fallar, como en la regresión original.
        await m.evaluate(`(()=>{const d=document.querySelector('dialog[open]'),b=[...d.querySelectorAll('.hp-dialog-footer button')].at(-1);const bottom=d.getBoundingClientRect().top+d.clientTop+d.clientHeight;b.style.transform='translateY('+(bottom-b.getBoundingClientRect().bottom+2)+'px)';return true})()`);
        const clipped = (await geometry(m)).buttons.at(-1);
        kit.ck(!clipped.fullyVisible && clipped.bottom <= 900, 'el harness rechaza un botón recortado por el diálogo aunque quepa en el viewport');
        await m.evaluate('document.querySelector("dialog[open] .hp-dialog-footer button:last-child").style.removeProperty("transform");true');
      }
    }
    await kit.closePages();
    if (!before) {
      const q = await kit.session('/admin/dashboard?section=cotizaciones&vista=tablero', width);
      await q.wait('document.querySelector("input[aria-label=\\"Buscar cotización\\"]")', 'barra de Cotizaciones');
      await q.evaluate('document.fonts.ready');
      const fonts = await q.evaluate(`(()=>{const form=document.querySelector('input[aria-label="Buscar cotización"]').form;return {input:getComputedStyle(form.querySelector('input')).fontFamily,filter:getComputedStyle(form.querySelector('select')).fontFamily,button:getComputedStyle(form.querySelector('button')).fontFamily}})()`);
      kit.ck(fonts.input.startsWith('Inter') && fonts.filter.startsWith('Inter') && fonts.button.startsWith('Montserrat'), width + ': búsqueda y filtro del Pipeline conservan Inter y su botón conserva Montserrat', fonts);
      evidence.push({ module: 'barra-cotizaciones', width, fonts });
      await kit.closePages();
    }
  }
  fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify(evidence, null, 2));
  if (before) return kit.finish('Capturas anteriores 3C');
  let p = await open(320);
  kit.ck(await p.evaluate('document.activeElement.name === "nombres"'), 'foco inicial en Nombres');
  await key(p, 'Tab', 9); kit.ck(await p.evaluate('document.activeElement.name === "apellidos"'), 'Tab sigue el orden de campos');
  await p.evaluate('document.querySelector("[data-student-form]").requestSubmit();true');
  await p.wait('document.querySelector(".hp-form-summary")', 'resumen accesible');
  kit.ck(writes === 0 && await p.evaluate('document.activeElement.classList.contains("hp-form-summary") && document.querySelectorAll("input[aria-invalid=true]").length===3'), 'obligatorios: resumen enfocado y tres campos inválidos sin POST');
  kit.ck(await p.evaluate('[...document.querySelectorAll("input[aria-invalid=true]")].every(i=>i.getAttribute("aria-describedby").split(" ").every(id=>!!document.getElementById(id)))'), 'descripciones y errores tienen destinos accesibles');
  const fields = (await p.send('Accessibility.getFullAXTree')).nodes.filter(n => n.role?.value === 'textbox').map(n => ({ name: n.name?.value, description: n.description?.value, invalid: n.properties?.find(v => v.name === 'invalid')?.value.value }));
  fs.writeFileSync(path.join(dir, 'accessibility.json'), JSON.stringify(fields, null, 2));
  kit.ck(fields.length === 5 && fields.every(f => f.name) && fields.filter(f => f.invalid === 'true').length === 3 && fields.some(f => f.name.startsWith('DNI') && f.description.includes('ceros iniciales') && f.description.includes('exactamente 8')), 'árbol accesible de Edge: nombres, errores y ayuda de DNI simultáneos');
  const contrast = await p.evaluate(`(()=>{
    const lum=color=>{const c=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
    const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
    const input=getComputedStyle(document.querySelector('input[name=email]'));
    return {border:ratio(input.borderTopColor,input.backgroundColor),help:ratio(getComputedStyle(document.querySelector('.hp-field-help')).color,'rgb(255,255,255)'),error:ratio(getComputedStyle(document.querySelector('.hp-field-error')).color,'rgb(255,255,255)')};
  })()`);
  fs.writeFileSync(path.join(dir, 'contrast.json'), JSON.stringify(contrast, null, 2));
  kit.ck(contrast.border>=3 && contrast.help>=4.5 && contrast.error>=4.5, 'contraste medido: borde ≥3:1; ayudas y errores ≥4.5:1', contrast);
  await shot(p, 'estudiantes-errores-320');
  await key(p, 'Tab', 9); await key(p, 'Enter', 13);
  kit.ck(await p.evaluate('document.activeElement.name==="nombres"'), 'Enter en primer error lleva a Nombres');
  await fill(p);
  await p.label('Correo electrónico', 'incorrecto'); await p.label('Teléfono', 'abc');
  await p.evaluate('document.querySelector("[data-student-form]").requestSubmit();true');
  await p.wait('document.querySelectorAll("input[aria-invalid=true]").length===2', 'formato de contacto');
  kit.ck(writes === 0, 'correo y teléfono inválidos conservan el borrador sin POST');
  await p.label('Correo electrónico', 'ana@example.test'); await p.label('Teléfono', '+51 987654321');
  await key(p, 'Escape', 27);
  await p.wait('document.querySelector(".hp-unsaved-dialog")', 'protección por Escape');
  kit.ck(await p.evaluate('document.activeElement.textContent==="Seguir editando"'), 'aviso de borrador enfoca la acción segura');
  await key(p, 'Escape', 27);
  await p.wait('!document.querySelector(".hp-unsaved-dialog")', 'seguir editando con Escape');
  kit.ck(await p.evaluate('document.querySelector("input[name=nombres]").value==="Ana" && document.querySelector("dialog[open]").contains(document.activeElement)'), 'Escape anidado conserva datos y restaura foco al formulario');
  await p.click('dialog button', 'Cancelar'); await p.wait('document.querySelector(".hp-unsaved-dialog")', 'cancelar con cambios');
  await p.click('.hp-unsaved-dialog button', 'Seguir editando');
  // Tab y Shift+Tab se mantienen dentro del diálogo nativo, incluso con cuerpo largo.
  await p.evaluate('document.querySelector("dialog[open] .hp-icon-btn").focus();true');
  await key(p, 'Tab', 9, true);
  kit.ck(await p.evaluate('document.activeElement.type==="submit"'), 'Shift+Tab cierra el ciclo de foco', await p.evaluate('document.activeElement.outerHTML.slice(0,220)'));
  await key(p, 'Tab', 9);
  kit.ck(await p.evaluate('document.activeElement.getAttribute("aria-label")==="Cerrar ventana"'), 'Tab vuelve al primer control');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 480, deviceScaleFactor: 1, mobile: true });
  kit.ck(await p.evaluate('(()=>{const b=document.querySelector(".hs-student-body"), f=document.querySelector("dialog .hp-dialog-footer").getBoundingClientRect();return b.scrollHeight>b.clientHeight && f.bottom<=innerHeight && f.top>=0})()'), '320 × 480: cuerpo desplazable y pie completo');
  await shot(p, 'estudiantes-altura-480');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
  // Enter real en un campo envía; durante la espera bloquea Escape/Cancelar/X y el doble envío.
  pending = true;
  await p.evaluate('document.querySelector("input[name=nombres]").focus();true');
  await key(p, 'Enter', 13);
  await p.wait('document.querySelector("[data-student-form]").getAttribute("aria-busy")==="true"', 'guardando');
  await p.evaluate('document.querySelector("[data-student-form]").requestSubmit();true'); await key(p, 'Escape', 27);
  kit.ck(writes === 1 && await p.evaluate('!!document.querySelector("dialog[open]") && [...document.querySelectorAll("dialog button")].every(b=>b.disabled)'), 'guardado pendiente bloquea cierre y doble envío');
  code = 500; pending(); pending = false;
  await p.wait('document.querySelector(".hs-conflict")', '500 incierto');
  await p.evaluate('document.querySelector("[data-student-form]").requestSubmit();true');
  kit.ck(writes === 1 && await p.evaluate('document.querySelector("input[name=nombres]").readOnly && document.querySelector("input[name=nombres]").value==="Ana" && document.querySelector("[data-student-form] button[type=submit]").disabled'), '500 mantiene bloqueo 3B y borrador sin reenvío');
  await p.evaluate('document.querySelector("[data-student-form] [role=alert]").scrollIntoView({block:"start"});true');
  await shot(p, 'estudiantes-incierto-320'); await kit.closePages();
  code = 201; p = await open(390); await fill(p); await p.click('dialog button', 'Registrar estudiante');
  await p.wait('!document.querySelector("dialog[open]")', 'guardado correcto'); kit.ck(writes === 2, 'Guardar confirmado cierra el formulario');
  await kit.closePages();
  readOnly = true; p = await kit.session(STUDENTS, 320);
  await p.wait('document.querySelector(".hs-students")', 'solo lectura');
  kit.ck(!await p.evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("Registrar estudiante"))'), 'sin permiso no ofrece registrar');
  const comparisons = [1440, 1280, 820, 390, 320].map(width => `<section><h2>${width} px</h2>${['estudiantes', 'estudiantes-acciones', 'consulta-acciones'].map(name => `<h3>${name}</h3><div class="pair">${['before','after'].map(phase => `<figure><figcaption>${phase === 'before' ? 'Antes' : 'Después'}</figcaption><a href="${phase}/${name}-${width}.png"><img loading="lazy" src="${phase}/${name}-${width}.png" alt="${name} a ${width} px, ${phase === 'before' ? 'antes' : 'después'}"></a></figure>`).join('')}</div>`).join('')}</section>`).join('');
  fs.writeFileSync(path.join(dir, '../comparativa.html'), `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Horus · Fase 3C</title><style>body{font:16px system-ui;margin:24px;background:#f5f6f8;color:#172c48}h1{border-bottom:4px solid #b79342;padding-bottom:12px}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{font-weight:700;padding:12px}section{margin:40px 0}a{color:inherit}@media(max-width:600px){.pair{grid-template-columns:1fr}}</style><h1>Formularios y modales · Fase 3C</h1><p>Capturas de Edge con API ficticia. Altura 900 px; cada imagen enlaza al original.</p><nav>${[1440,1280,820,390,320].map(w=>`<a href="#w${w}">${w} px</a>`).join(' · ')}</nav>${comparisons.replace(/<section><h2>(\d+)/g,'<section id="w$1"><h2>$1')}<h2>Estados accesibles</h2><p><a href="after/estudiantes-errores-320.png">Errores</a> · <a href="after/estudiantes-incierto-320.png">HTTP 500 incierto</a> · <a href="after/estudiantes-altura-480.png">Altura 480 px</a></p></html>`);
  await kit.closePages(); kit.finish('Formularios y modales 3C');
})().catch(error => { console.error(error); kit?.cleanup(); process.exitCode = 1; });
