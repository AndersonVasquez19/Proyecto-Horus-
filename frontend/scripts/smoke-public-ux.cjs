// Revisión pública aislada: catálogo versionado y respuestas ficticias, sin NestJS ni IA.
// Montserrat se carga e inyecta solo en el navegador de prueba; nunca en la aplicación.
const fs = require('node:fs');
const path = require('node:path');
const { start, sleep } = require('./smoke-kit.cjs');
const output = path.resolve(__dirname, '../.artifacts/public-ux');
let release;
const answer = 'Inicio de la respuesta de prueba.\n' + 'Información extensa para comprobar la lectura desde el comienzo.\n'.repeat(45);
const handler = async (req, res, { route, json }) => {
  if (route === '/__release') { release?.(); return json({ ok: true }) || true; }
  if (route === '/__montserrat.ttf') {
    res.setHeader('Content-Type', 'font/ttf');
    res.end(fs.readFileSync(path.resolve(__dirname, '../src/panel/assets/fonts/Montserrat-Variable.ttf'))); return true;
  }
  if (route === '/api/chatbot/message') {
    await new Promise(resolve => { release = resolve; });
    return json({ ok: true, mode: 'catalogo', answer, sources: [], suggestions: ['Sugerencia de prueba'] }) || true;
  }
  if (route.startsWith('/api/')) return json({ ok: true, items: [] }) || true;
  return false;
};
const key = async (p, name, code) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
};
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const k = await start({ prefix: 'public-ux', handler });
  const metrics = [];
  const capture = async (p, name) => {
    const shot = await p.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  for (const width of [1280, 820, 390, 320]) {
    const p = await k.open(width, width === 320 ? 568 : 900);
    await p.go('/', 'document.querySelectorAll("[data-agreement-card]").length === 4');
    await p.wait('!document.querySelector(".home-welcome")', 'fin de bienvenida');
    await p.evaluate('document.querySelector(".home-convenios").scrollIntoView({block:"start",behavior:"instant"})');
    await p.wait('[...document.querySelectorAll("[data-agreement-logo] img")].every(i => i.naturalWidth > 0)', 'logos');
    await p.evaluate('document.fonts.ready');
    await capture(p, 'convenios-' + width);
    k.ck(await p.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width + ': sin desbordamiento de Home');
    k.ck(await p.evaluate('[...document.querySelectorAll("[data-agreement-card]")].every(c=>{const r=c.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})'), width + ': cuatro tarjetas dentro de pantalla');
    k.ck(await p.evaluate('(()=>{const rows=new Map();for(const c of document.querySelectorAll("[data-agreement-card]")){const r=c.getBoundingClientRect(),b=c.querySelector("[data-agreement-cta]").getBoundingClientRect();const y=Math.round(r.top);if(rows.has(y)&&Math.abs(rows.get(y)-b.top)>1)return false;rows.set(y,b.top)}return true})()'), width + ': llamadas a la acción alineadas por fila');
    // Comparación temporal de títulos cortos; hero, navegación, párrafos y chatbot quedan fuera del selector.
    const selector = '.home-services h2, .home-convenios h2, [data-agreement-logo] + span > span:first-child';
    const measure = () => p.evaluate('(()=>{return [...document.querySelectorAll(' + JSON.stringify(selector) + ')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);return {text:e.textContent,font:s.fontFamily,width:r.width,height:r.height,lines:new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size,overflow:e.scrollWidth>e.clientWidth+1}})})()');
    const original = await measure();
    await p.evaluate('(async()=>{const f=new FontFace("HorusMontserratReview","url(/__montserrat.ttf)",{weight:"100 900"});await f.load();document.fonts.add(f);const s=document.createElement("style");s.id="font-review";s.textContent=' + JSON.stringify(selector + '{font-family:HorusMontserratReview,sans-serif!important}') + ';document.head.append(s)})()');
    const montserrat = await measure();
    k.ck(montserrat.length > 0 && montserrat.every(m => !m.overflow), width + ': títulos Montserrat sin desbordamiento');
    await capture(p, 'montserrat-' + width);
    metrics.push({ width, original, montserrat });
    await p.evaluate('document.querySelector("#font-review").remove()');
    await p.evaluate('document.querySelectorAll("[data-agreement-toggle]")[1].focus()');
    await key(p, 'Enter', 13);
    await p.wait('document.querySelector("[data-flipped=true]")', 'giro con Enter');
    k.ck(await p.evaluate('document.activeElement.matches("[data-agreement-return]")'), width + ': foco en reverso');
    await capture(p, 'convenio-reverso-' + width);
    await p.evaluate('document.querySelector("[data-flipped=true] [data-agreement-detail]").focus()');
    await key(p, 'Enter', 13);
    await p.wait('document.querySelector("#convModal[open]")', 'detalle');
    await capture(p, 'convenio-detalle-' + width);
    await key(p, 'Escape', 27);
    await p.wait('!document.querySelector("#convModal")', 'cierre del detalle');
    k.ck(await p.evaluate('document.activeElement.matches("[data-agreement-detail]")'), width + ': retorno al detalle');
    await key(p, 'Escape', 27);
    await p.wait('!document.querySelector("[data-flipped=true]")', 'volver al frente');
    await p.evaluate('document.querySelector(".hc-launcher").focus()');
    await key(p, 'Enter', 13);
    await p.wait('document.querySelector(".hc-dialog[open]")', 'abrir chatbot con Enter');
    await key(p, 'Escape', 27);
    await p.wait('!document.querySelector(".hc-dialog[open]")', 'cerrar chatbot');
    k.ck(await p.evaluate('document.activeElement.matches(".hc-launcher")'), width + ': Escape devuelve el foco al lanzador');
    await key(p, 'Enter', 13);
    await p.wait('document.querySelector(".hc-dialog[open]")', 'reabrir con Enter');
    k.ck(true, width + ': reapertura nativa con Enter');
    await p.type('#hc-question', 0, 'Respuesta larga');
    await p.evaluate('document.querySelector(".hc-compose form").requestSubmit()');
    await p.wait('document.querySelector(".hc-thinking")', 'espera');
    const before = await p.evaluate('document.querySelector(".hc-log").scrollTop');
    await sleep(150);
    k.ck(Math.abs(before - await p.evaluate('document.querySelector(".hc-log").scrollTop')) < 1, width + ': indicador de espera estable');
    await fetch(k.origin + '/__release');
    await p.wait('document.querySelectorAll(".hc-assistant").length===2', 'respuesta larga');
    const readable = await p.evaluate('(()=>{const l=document.querySelector(".hc-log"),r=l.getBoundingClientRect(),a=l.querySelector("article:last-of-type").getBoundingClientRect();return {top:a.top-r.top,height:l.clientHeight,scroll:l.scrollTop}})()');
    k.ck(readable.top >= -1 && readable.top < readable.height / 2, width + ': inicio de respuesta larga visible', readable);
    await capture(p, 'chatbot-' + width);
    k.ck(await p.evaluate('[...document.querySelectorAll(".hc-close,.hc-compose form button")].every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})'), width + ': cierre y envío de al menos 44 × 44 visibles');
    k.ck(await p.evaluate('[".hc-compose-heading>span",".hc-footer summary",".hc-message>strong"].every(s=>parseFloat(getComputedStyle(document.querySelector(s)).fontSize)>=12)'), width + ': textos auxiliares de al menos 12 px');
    k.ck(await p.evaluate('!document.querySelector(".hc-followups")'), width + ': sugerencias sin activar');
    await p.type('#hc-question', 0, 'Otra respuesta');
    await p.evaluate('document.querySelector(".hc-compose form").requestSubmit()');
    await p.wait('document.querySelector(".hc-thinking")', 'segunda espera');
    await p.evaluate('document.querySelector(".hc-log").scrollTop=0;document.querySelector(".hc-close").focus()');
    await sleep(150);
    await fetch(k.origin + '/__release');
    await p.wait('document.querySelectorAll(".hc-assistant").length===3', 'segunda respuesta');
    k.ck(await p.evaluate('document.querySelector(".hc-log").scrollTop===0 && document.activeElement.matches(".hc-close")'), width + ': lectura anterior y foco conservados al recibir respuesta');
    await key(p, 'Escape', 27);
    await p.wait('!document.querySelector(".hc-dialog[open]")', 'cierre con historial');
    await key(p, 'Enter', 13);
    await p.wait('document.querySelector(".hc-dialog[open]")', 'reapertura con historial');
    k.ck(await p.evaluate('document.querySelectorAll(".hc-assistant").length===3&&document.querySelector(".hc-log").scrollTop===0'), width + ': reapertura conserva historial y posición');
    await p.evaluate('document.querySelector(".hc-log").focus()');
    await key(p, 'ArrowDown', 40);
    await sleep(250);
    k.ck(await p.evaluate('document.querySelector(".hc-log").scrollTop>0'), width + ': historial desplazable con teclado');
    await p.click('.hc-footer summary');
    k.ck(await p.evaluate('(()=>{const d=document.querySelector(".hc-dialog"),l=document.querySelector(".hc-log"),b=document.querySelector(".hc-compose form button").getBoundingClientRect();return d.scrollWidth<=d.clientWidth&&l.clientHeight>=60&&b.bottom<=innerHeight})()'), width + ': privacidad expandida conserva espacio y envío visible');
    await capture(p, 'chatbot-privacidad-' + width);
    if (width === 1280) {
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await key(p, 'Escape', 27);
      await p.wait('!document.querySelector(".hc-dialog[open]")', 'cierre animado');
      await key(p, 'Enter', 13);
      await p.wait('document.querySelector(".hc-dialog[open]")', 'reapertura animada');
      k.ck(true, 'Escape y Enter también funcionan con animaciones activas');
    }
    await p.close();
  }
  fs.writeFileSync(path.join(output, 'typography.json'), JSON.stringify(metrics, null, 2));
  await k.closePages();
  k.finish('UX pública, teclado, lectura y comparación tipográfica');
})().catch(error => { console.error(error); process.exit(1); });
