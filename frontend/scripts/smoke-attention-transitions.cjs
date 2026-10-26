// D01: React real con API ficticia local; no acredita persistencia ni autorización HTTP real.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { start } = require('./smoke-kit.cjs');

// Se ejecutan en el navegador. Primero se desplaza cada control: estar fuera de
// pantalla antes de desplazarse no es un fallo de accesibilidad.
async function settledLayout(selector) {
  await document.fonts.ready;
  const element = document.querySelector(selector);
  if (!element) throw new Error('Falta el control: ' + selector);
  const hiddenScroll = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    const css = getComputedStyle(node);
    hiddenScroll.push({ node, x: /^(hidden|clip)$/.test(css.overflowX) ? node.scrollLeft : null,
      y: /^(hidden|clip)$/.test(css.overflowY) ? node.scrollTop : null });
  }
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  // scrollIntoView puede desplazar por código incluso overflow:hidden; eso no
  // demuestra acceso mediante las barras/gestos del usuario. Se conserva su posición.
  for (const { node, x, y } of hiddenScroll) { if (x !== null) node.scrollLeft = x; if (y !== null) node.scrollTop = y; }
  const deadline = performance.now() + 5000;
  let previous = '', equalFrames = 0;
  while (performance.now() < deadline) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const boxes = [];
    for (let node = element; node; node = node.parentElement) {
      const r = node.getBoundingClientRect();
      boxes.push([r.x, r.y, r.width, r.height, node.scrollLeft, node.scrollTop]);
    }
    const signature = JSON.stringify(boxes);
    const animating = document.getAnimations().some(animation => animation.playState === 'running' &&
      animation.effect?.target instanceof Element &&
      (animation.effect.target.contains(element) || element.contains(animation.effect.target)));
    equalFrames = signature === previous && !animating ? equalFrames + 1 : 0;
    if (equalFrames >= 3) return;
    previous = signature;
  }
  throw new Error('El diseño no se estabilizó: ' + selector);
}

function visibleControl(selector) {
  const element = document.querySelector(selector), issues = [], ancestors = [];
  if (!element) return { selector, issues: ['control ausente'] };
  const box = rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
  const r = element.getBoundingClientRect();
  const inside = (inner, outer, x = true, y = true) => (!x || inner.left >= outer.left - 1 && inner.right <= outer.right + 1) &&
    (!y || inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1);
  const viewport = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: innerHeight };
  if (!r.width || !r.height || !element.getClientRects().length) issues.push('dimensiones nulas');
  if (!inside(r, viewport)) issues.push('fuera del viewport tras desplazarse');
  const clips = value => /^(hidden|clip|scroll|auto)$/.test(value);
  for (let node = element; node; node = node.parentElement) {
    const css = getComputedStyle(node), b = node.getBoundingClientRect();
    if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) issues.push('control o ancestro invisible');
    if (node === element) continue;
    const client = { left: b.left + node.clientLeft, top: b.top + node.clientTop,
      right: b.left + node.clientLeft + node.clientWidth, bottom: b.top + node.clientTop + node.clientHeight };
    ancestors.push({ tag: node.tagName, className: node.className, rect: box(b), overflowX: css.overflowX, overflowY: css.overflowY,
      display: css.display, flexWrap: css.flexWrap, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollLeft: node.scrollLeft });
    if (!inside(r, client, clips(css.overflowX), clips(css.overflowY))) issues.push('recorte por ' + node.tagName + '.' + node.className);
    // Un grupo de acciones que desborda aunque overflow sea visible también
    // pierde su encaje en el panel. En un scroller basta poder acceder al control.
    if (node === element.parentElement && node.matches('.hp-actions') && !inside(r, client)) issues.push('fuera del grupo de acciones');
  }
  if (element.matches('button, a')) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const content = { left: r.left + element.clientLeft, top: r.top + element.clientTop,
        right: r.left + element.clientLeft + element.clientWidth, bottom: r.top + element.clientTop + element.clientHeight };
      for (const label of range.getClientRects()) if (!inside(label, content)) issues.push('etiqueta desborda el control');
    }
  }
  if (r.width && r.height && inside(r, viewport)) {
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (top && top !== element && !element.contains(top) && getComputedStyle(element).pointerEvents !== 'none') issues.push('centro oculto por otro elemento');
  }
  return { selector, text: element.textContent.trim(), rect: box(r), issues: [...new Set(issues)], ancestors };
}

(async () => {
  const { allowedTransitions, checkMessageChange } = await import(pathToFileURL(path.resolve(__dirname, '../../backend/src/attention/attention-rules.ts')));
  // Las concesiones se extraen igual que en smoke-panel-actions; sin importar módulos de aplicación o entorno.
  const policy = fs.readFileSync(path.resolve(__dirname, '../../backend/src/permissions/policy.ts'), 'utf8');
  const catalog = fs.readFileSync(path.resolve(__dirname, '../../backend/src/permissions/permissions.ts'), 'utf8');
  const rolePermissions = role => role === 'GERENTE_GENERAL'
    ? [...catalog.match(/RESOURCE_OPERATIONS = \{([\s\S]*?)\} as const/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)].flatMap(([, r, ops]) => [...ops.matchAll(/'([a-z_]+)'/g)].map(m => r + ':' + m[1]))
    : [...policy.match(new RegExp('const ' + role + ': readonly Permission\\[\\] = \\[([\\s\\S]*?)\\];'))[1].matchAll(/'([a-z_]+:[a-z_]+)'/g)].map(m => m[1]);
  let role = 'GERENTE_GENERAL', mode = 'valid', fail = 0, withdraw = false;
  let item, writes = [];
  const reset = estado => { item = { estado, responsable: '', notas: '', respuesta: '', revision: 1, historial: [] }; mode = 'valid'; fail = 0; withdraw = false; writes = []; };
  reset('nuevo');
  const contract = () => ({ ...item, ...(mode === 'missing' ? {} : { transiciones_permitidas: mode === 'invalid' ? ['atendido', 'inexistente'] : withdraw ? [] : allowedTransitions(item.estado) }) });
  const message = () => ({ id: 1, nombre: 'Persona ficticia', asunto: 'Consulta D01', email: 'persona@example.test', telefono: '', mensaje: 'Solicitud ficticia de información.', estado: item.estado, createdAt: '2026-10-20T12:00:00Z' });
  const handler = async (req, res, { route, json, body }) => {
    if (!route.startsWith('/api/')) return false;
    if (route === '/api/admin/me') return json({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'cuenta@example.test', rol: role, permisos: rolePermissions(role) }, acceso: { modo: 'por_roles' } }) || true;
    if (route === '/api/admin/messages') return json({ ok: true, messages: [message()], pagination: { page: 1, limit: 20, total: 1, pages: 1 }, metrics: { [item.estado]: 1 } }) || true;
    if (route === '/api/admin/messages/1') return json({ ok: true, message: message() }) || true;
    if (route === '/api/admin/seguimiento/messages/1') {
      if (req.method === 'GET') return json({ ok: true, item: contract() }) || true;
      const data = await body(); writes.push(data);
      if (fail) { const status = fail; fail = 0; return json({ message: status === 400 ? 'Registra una nota para atender la consulta.' : 'El seguimiento cambió en otra sesión.' }, status) || true; }
      if (data.revision !== item.revision) return json({ message: 'Revisión obsoleta.' }, 409) || true;
      const problem = checkMessageChange({ from: item.estado, to: data.estado, notas: data.notas, respuesta: data.respuesta });
      if (problem) return json({ message: problem }, 400) || true;
      item = { ...item, ...data, revision: item.revision + 1 };
      return json({ ok: true, item: contract() }) || true;
    }
    return json({ ok: true, settings: {}, items: [], pagination: { total: 0, pages: 1, page: 1 } }) || true;
  };
  const k = await start({ prefix: 'd01-transitions', handler });
  const open = async (width = 1280) => { const p = await k.session('/admin/messages?id=1', width); await p.wait('document.querySelector(".hw-inbox-detail form select") && document.querySelector(".hw-next-action")', 'contrato de seguimiento'); return p; };
  const options = p => p.evaluate('[...document.querySelector(".hw-inbox-detail form select").options].filter(o => !o.disabled).map(o => o.value)');
  const quickCount = p => p.evaluate('document.querySelectorAll(".hw-next-action button").length');
  const save = p => p.click('.hw-inbox-detail form button', 'Guardar seguimiento');
  const notes = p => p.evaluate('document.querySelector(".hw-inbox-detail form textarea").value');
  for (const estado of ['nuevo', 'en_proceso', 'atendido', 'archivado']) {
    reset(estado); const p = await open();
    k.ck(JSON.stringify(await options(p)) === JSON.stringify([estado, ...allowedTransitions(estado)]), estado + ': selector usa contrato GET y conserva estado');
    k.ck(await quickCount(p) === allowedTransitions(estado).length && writes.length === 0, estado + ': acciones rápidas autorizadas, abrir no escribe');
    await p.type('form textarea', 0, 'Nota conservando estado'); await save(p); await p.wait('document.querySelector("form .hp-notice")', 'PUT sin transición');
    k.ck(writes.length === 1 && writes[0].estado === estado && item.notas === 'Nota conservando estado', estado + ': edita notas sin transición');
    await p.close();
  }
  for (const invalid of ['missing', 'invalid']) {
    reset('en_proceso'); mode = invalid; const p = await open();
    k.ck(JSON.stringify(await options(p)) === '["en_proceso"]' && await quickCount(p) === 0, invalid + ': no habilita destinos');
    k.ck((await p.text('form')).includes('No se pudieron verificar'), invalid + ': aviso accesible');
    await p.type('form textarea', 0, 'Nota sin contrato'); await save(p); await p.wait('document.querySelector("form .hp-notice")', 'guardar mismo estado');
    k.ck(item.estado === 'en_proceso' && item.notas === 'Nota sin contrato', invalid + ': permite operación segura'); await p.close();
  }
  reset('nuevo'); {
    const p = await open(); await p.type('form textarea', 0, 'Mi borrador'); await p.type('form select', 0, 'atendido'); fail = 400; await save(p);
    await p.wait('document.querySelector("form .hp-error")', '400'); k.ck(await notes(p) === 'Mi borrador', '400 conserva borrador y explica rechazo');
    await save(p); await p.wait('document.querySelector("form .hp-notice")', 'PUT válido');
    k.ck(JSON.stringify(await options(p)) === JSON.stringify(['atendido', ...allowedTransitions('atendido')]) && await quickCount(p) === 2, 'PUT actualiza opciones de ambos controles'); await p.close();
  }
  reset('nuevo'); {
    const p = await open(); await p.type('form textarea', 0, 'Mi versión'); item = { ...item, notas: 'Versión remota', estado: 'en_proceso', revision: 2 }; await save(p);
    await p.wait('document.querySelector(".hp-conflict-field")', 'comparación 409');
    k.ck(await notes(p) === 'Mi versión' && writes.length === 1, '409 conserva borrador sin repetir PUT');
    await p.click('.hp-conflict-field button', 'Conservar mi versión'); await save(p); await p.wait('document.querySelector("form .hp-notice")', 'guardado explícito');
    k.ck(writes[1].revision === 2 && item.notas === 'Mi versión', '409 usa revisión comparada tras elección explícita'); await p.close();
  }
  reset('en_proceso'); {
    const p = await open(); withdraw = true; await p.click('.hw-next-action button', 'Archivar');
    await p.wait('document.querySelector(".hw-next-action").innerText.includes("Siguiente paso") && !document.querySelector(".hw-next-action button")', 'GET retira autorización');
    k.ck(writes.length === 0, 'GET previo retira destino: ninguna escritura'); await p.close();
  }
  reset('nuevo'); {
    const p = await open(); await p.click('.hw-next-action button', 'Iniciar atención'); await p.wait('document.querySelector("form select").value === "en_proceso"', 'acción rápida');
    k.ck(writes.length === 1 && await quickCount(p) === 2 && !(await options(p)).includes('nuevo'), 'acción rápida actualiza ambos controles'); await p.close();
  }
  for (const status of [400, 409]) {
    reset('nuevo'); const p = await open(); await p.type('form textarea', 0, 'Borrador de acción rápida'); fail = status;
    await p.click('.hw-next-action button', 'Iniciar atención'); await p.wait('document.querySelector("dialog[open]")', 'confirmación existente');
    await p.click('dialog[open] button', 'Descartar cambios');
    await p.wait('document.querySelector(".hp-error") && !document.querySelector(".hw-next-action button:disabled")', 'error rápido ' + status);
    k.ck(await notes(p) === 'Borrador de acción rápida' && writes.length === 1 && item.estado === 'nuevo', status + ': acción rápida conserva borrador y no repite escritura'); await p.close();
  }
  reset('nuevo'); {
    const p = await open(); await p.type('form textarea', 0, 'Borrador con destino retirado'); await p.type('form select', 0, 'atendido');
    item = { ...item, estado: 'en_proceso', revision: 2 }; withdraw = true; await save(p);
    await p.wait('document.querySelector(".hp-conflict-field")', 'estado en conflicto');
    k.ck(await p.evaluate('document.querySelector("form select").value === "atendido" && document.querySelector("form select").selectedOptions[0].disabled'), 'destino retirado conserva estado de borrador visible sin ofrecerlo como opción');
    await p.click('.hp-conflict-field button', 'Conservar mi versión'); await save(p); await p.wait('document.querySelector("form .hp-error")', 'destino bloqueado');
    k.ck(writes.length === 1 && await notes(p) === 'Borrador con destino retirado', 'ningún PUT para destino ya no autorizado tras reconciliar');
    await p.type('form select', 0, 'en_proceso'); await save(p); await p.wait('document.querySelector("form .hp-notice")', 'guardar notas con estado seguro');
    k.ck(item.notas === 'Borrador con destino retirado' && writes[1].revision === 2, 'recuperación explícita conserva notas y revisión comparada'); await p.close();
  }
  const artifacts = fs.mkdtempSync(path.resolve(__dirname, '../.artifacts/phase4e-d01-'));
  console.log('Evidencia nueva: ' + artifacts);
  const geometry = [];
  const settle = (p, selector) => p.evaluate('(' + settledLayout.toString() + ')(' + JSON.stringify(selector) + ')');
  const inspect = (p, selector) => p.evaluate('(' + visibleControl.toString() + ')(' + JSON.stringify(selector) + ')');
  for (const width of [1440, 1280, 820, 390, 320]) {
    reset('en_proceso'); const p = await open(width); await settle(p, 'form select');
    k.ck(await p.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width + ' px: sin desbordamiento horizontal');
    const selectors = await p.evaluate(`(() => {
      const controls = [...document.querySelectorAll('.hw-inbox-detail button, .hw-inbox-detail a.hp-btn, .hw-inbox-detail input, .hw-inbox-detail select, .hw-inbox-detail textarea')]
        .filter(control => !(control.matches('.hw-back') && matchMedia('(min-width: 761px)').matches)); // Volver solo existe visualmente en móvil.
      return controls.map((control, index) => { control.dataset.d01Control = String(index); return '[data-d01-control="' + index + '"]'; });
    })()`);
    for (const selector of selectors) {
      await settle(p, selector);
      const result = await inspect(p, selector); geometry.push({ width, ...result });
      k.ck(result.issues.length === 0, width + ' px: control accesible ' + (result.text || selector), result.issues);
    }
    // El mismo detector debe rechazar recorte deliberado en ambos ejes y
    // aceptar un control en un scroller después de hacerlo visible.
    await p.evaluate(`(() => {
      const host = document.createElement('div'); host.id = 'd01-geometry-fixture';
      host.style.cssText = 'position:fixed;left:20px;top:100px;z-index:2147483647;width:100px;height:22px;overflow:hidden;background:white';
      const button = document.createElement('button'); button.textContent = 'Acción de prueba recortada';
      button.style.cssText = 'display:block;width:240px;height:44px;white-space:nowrap'; host.append(button); document.body.append(host);
    })()`);
    await settle(p, '#d01-geometry-fixture button');
    const negative = await inspect(p, '#d01-geometry-fixture button');
    geometry.push({ width, negative: true, ...negative });
    k.ck(negative.issues.some(issue => issue.startsWith('recorte por')), width + ' px: detector rechaza botón recortado intencionadamente', negative);
    await p.evaluate(`(() => {
      const host = document.querySelector('#d01-geometry-fixture'); host.style.width = '260px'; host.style.height = '70px'; host.style.overflow = 'auto';
      const button = host.querySelector('button'); button.style.marginTop = '180px'; button.style.marginLeft = '300px';
    })()`);
    await settle(p, '#d01-geometry-fixture button');
    const scrollable = await inspect(p, '#d01-geometry-fixture button');
    geometry.push({ width, scrollable: true, ...scrollable });
    k.ck(scrollable.issues.length === 0 && await p.evaluate('document.querySelector("#d01-geometry-fixture").scrollTop > 0 && document.querySelector("#d01-geometry-fixture").scrollLeft > 0'), width + ' px: scroller permite acceder al control sin falso positivo', scrollable.issues);
    await p.evaluate('document.querySelector("#d01-geometry-fixture").remove()');
    await settle(p, 'form select');
    await p.evaluate('document.querySelector("form select").focus()');
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    k.ck(await p.evaluate('document.activeElement.matches("form input") && (getComputedStyle(document.activeElement).outlineStyle !== "none" || getComputedStyle(document.activeElement).boxShadow !== "none")'), width + ' px: teclado y foco visible');
    k.ck(await p.evaluate('document.querySelector("form select").labels[0].textContent.startsWith("Estado")'), width + ' px: etiqueta accesible');
    for (const [name, selector] of [['editor', 'form select'], ['acciones', '.hw-next-action']]) {
      await settle(p, selector);
      const shot = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(artifacts, width + '-' + name + '.png'), Buffer.from(shot.data, 'base64'));
    }
    await p.close();
  }
  fs.writeFileSync(path.join(artifacts, 'geometry.json'), JSON.stringify(geometry, null, 2), { flag: 'wx' });
  for (const accountRole of ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL', 'SECRETARIA']) {
    role = accountRole; reset('en_proceso'); const p = await open();
    k.ck(await quickCount(p) === 2 && await p.evaluate('!document.querySelector("form fieldset").disabled'), role + ': atención permitida');
    k.ck(await p.evaluate('!![...document.querySelectorAll("button")].find(b => b.textContent.includes("Eliminar consulta"))') === (role === 'GERENTE_GENERAL'), role + ': eliminar mantiene permiso'); await p.close();
  }
  console.log('Capturas: ' + artifacts);
  k.finish('D01 transiciones');
})().catch(error => { console.error(error); process.exit(1); });
