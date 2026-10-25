// API ficticia y bloqueo externo de smoke-kit; nunca consulta IA ni servicios reales.
const fs = require('node:fs');
const path = require('node:path');
const { start, sleep } = require('./smoke-kit.cjs');
const output = path.resolve(__dirname, '../.artifacts/chatbot-2b');
const baseline = process.argv.includes('--before');
const requests = [];
let release, fail = false, omitSuggestions = false;
const handler = async (req, res, { route, json, body }) => {
  if (route === '/api/chatbot/message') {
    requests.push(await body());
    await new Promise(resolve => { release = resolve; });
    return json(fail ? { message: 'Internal secret' } : { ok: true, mode: 'catalogo',
      answer: 'Respuesta ficticia de prueba.\n' + 'Información para comprobar la lectura.\n'.repeat(35),
      sources: [], suggestions: omitSuggestions ? undefined : [' Ver servicios ', 'ver SERVICIOS', null, 42, '', 'x'.repeat(161),
        '<img src=x onerror=alert(1)>', 'persona@example.test', 'DNI 12345678', 'https://example.test',
        '¿Cómo contactar al equipo?', 'Consultar capacitaciones', 'Ver convenios', 'Quinta opción'] }, fail ? 500 : 200) || true;
  }
  if (route.startsWith('/api/')) return json({ ok: true, items: [] }) || true;
  return false;
};
const key = async (p, key, code) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
};
// Esperar recepción en el fixture: el indicador React puede aparecer antes del POST.
const holding = async count => {
  const end = Date.now() + 8000;
  while (requests.length < count || !release) {
    if (Date.now() >= end) throw new Error('El fixture no recibió la consulta esperada');
    await sleep(20);
  }
};
const reply = () => { const done = release; release = undefined; done(); };
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const k = await start({ prefix: 'chatbot-2b', handler });
  const capture = async (p, name) => {
    const shot = await p.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  for (const width of [1280, 820, 390, 320]) {
    const p = await k.open(width, width === 320 ? 568 : 900);
    await p.go('/quienes-somos', 'document.querySelector(".hc-launcher")');
    await p.click('.hc-launcher');
    await p.wait('document.querySelector(".hc-dialog[open]")', 'chat abierto');
    await sleep(300);
    await capture(p, `${baseline ? 'antes' : 'despues'}-inicio-${width}`);
    if (baseline) { await p.close(); continue; }
    k.ck(await p.evaluate('document.querySelectorAll(".hc-suggestions button").length === 4'), width + ': cuatro sugerencias iniciales');
    const count = requests.length;
    await sleep(150);
    k.ck(requests.length === count, width + ': renderizar no envía consultas');
    k.ck(await p.evaluate('[...document.querySelectorAll(".hc-suggestions button")].every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44&&r.right<=innerWidth&&b.scrollWidth<=b.clientWidth})'), width + ': sugerencias táctiles sin recortes');
    await p.evaluate('document.querySelector(".hc-suggestions button").focus()');
    await key(p, 'Tab', 9);
    k.ck(await p.evaluate('document.activeElement===document.querySelectorAll(".hc-suggestions button")[1] && getComputedStyle(document.activeElement).outlineStyle!=="none"'), width + ': Tab recorre las sugerencias con foco visible');
    const contrasts = await p.evaluate(`(() => {
      const luminance = color => {
        const rgb = color.match(/[\\d.]+/g).slice(0,3).map(Number).map(n => {const x=n/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});
        return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
      };
      const ratio = (a,b) => {const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      return ['.hc-suggestions button','.hc-assistant','.hc-compose-heading','.hc-footer summary'].map(selector=>{
        const s=getComputedStyle(document.querySelector(selector));
        return {selector,color:s.color,ratio:ratio(s.color,'rgb(255,255,255)')};
      });
    })()`);
    k.ck(contrasts.every(c => c.ratio >= 4.5), width + ': contraste de textos sobre superficies blancas ≥ 4,5:1', contrasts);
    if (width === 1280) fs.writeFileSync(path.join(output, 'contrastes.json'), JSON.stringify(contrasts, null, 2));
    await p.evaluate('window.oldSuggestion=document.querySelector(".hc-suggestions button");oldSuggestion.focus()');
    await key(p, width === 820 ? ' ' : 'Enter', width === 820 ? 32 : 13);
    await p.wait('document.querySelector(".hc-thinking")', 'consulta de sugerencia');
    await holding(count + 1);
    await p.evaluate('oldSuggestion.click();document.querySelector(".hc-compose form").requestSubmit()');
    k.ck(requests.length === count + 1 && requests.at(-1).message === '¿Qué capacitaciones ofrecen?' && requests.at(-1).history.length === 0, width + ': activación nativa y bloqueo de doble envío');
    reply();
    await p.wait('document.querySelectorAll(".hc-assistant").length===2', 'respuesta');
    k.ck(await p.evaluate('JSON.stringify([...document.querySelectorAll(".hc-suggestions button")].map(b=>b.textContent))') === JSON.stringify(['Ver servicios', '¿Cómo contactar al equipo?', 'Consultar capacitaciones', 'Ver convenios']), width + ': filtro, deduplicación, longitud y máximo cuatro');
    await capture(p, `despues-respuesta-${width}`);
    await p.evaluate('document.querySelector(".hc-log").scrollTop=document.querySelector(".hc-log").scrollHeight');
    await capture(p, `despues-sugerencias-${width}`);
    await p.click('.hc-suggestions button');
    await p.wait('document.querySelector(".hc-thinking")', 'sugerencia dinámica');
    await holding(count + 2);
    k.ck(requests.at(-1).message === 'Ver servicios' && requests.at(-1).history.length === 2, width + ': sugerencia dinámica reutiliza historial');
    reply(); await p.wait('document.querySelectorAll(".hc-assistant").length===3', 'segunda respuesta');
    await p.click('.hc-toolbar button');
    const resetCount = requests.length;
    await p.evaluate('oldSuggestion.click()'); await sleep(100);
    k.ck(requests.length === resetCount && await p.evaluate('document.querySelectorAll(".hc-log article").length===1 && document.querySelectorAll(".hc-suggestions button").length===4'), width + ': reset descarta controles antiguos');
    fail = true;
    await p.click('.hc-suggestions button'); await p.wait('document.querySelector(".hc-thinking")', 'envío que fallará');
    await holding(resetCount + 1);
    reply(); await p.wait('document.querySelector(".hc-error")', 'error controlado');
    k.ck(await p.evaluate('!document.querySelector(".hc-suggestions") && document.querySelectorAll(".hc-user").length===0 && !document.querySelector(".hc-error").textContent.includes("secret")'), width + ': error sin turnos duplicados ni sugerencias activas');
    fail = false; await p.click('.hc-retry'); await p.wait('document.querySelector(".hc-thinking")', 'reintento explícito');
    await holding(resetCount + 2);
    reply(); await p.wait('document.querySelectorAll(".hc-assistant").length===2', 'reintento recibido');
    k.ck(await p.evaluate('document.querySelectorAll(".hc-user").length===1'), width + ': reintento produce un solo turno');
    if (width === 1280) {
      omitSuggestions = true;
      for (let i = 0; i < 16; i++) {
        const n = requests.length;
        await p.type('#hc-question', 0, 'Consulta ficticia ' + i);
        await p.evaluate('document.querySelector(".hc-compose form").requestSubmit()');
        await p.wait('document.querySelector(".hc-thinking")', 'historial en espera');
        await holding(n + 1);
        k.ck(requests.length === n + 1 && requests.at(-1).history.length <= 6, 'contexto de petición limitado a seis turnos: ' + i);
        reply(); await p.wait('!document.querySelector(".hc-thinking")', 'historial recibido');
      }
      k.ck(await p.evaluate('document.querySelectorAll(".hc-log article").length===30 && !document.querySelector(".hc-suggestions")'), 'historial visible limitado a 30 y respuestas sin sugerencias válidas');
      await p.type('#hc-question', 0, 'Consulta que agota el tiempo');
      const n = requests.length;
      await p.evaluate('document.querySelector(".hc-compose form").requestSubmit()');
      await p.wait('document.querySelector(".hc-error")', 'timeout real de 22 segundos', 25000);
      k.ck(requests.length === n + 1 && /tardó demasiado/.test(await p.text('.hc-error')) && await p.evaluate('!document.querySelector(".hc-thinking") && !document.querySelector("#hc-question").disabled && document.querySelectorAll(".hc-log article").length===30'), 'timeout conserva historial, rehabilita escritura y no reintenta solo');
      reply(); omitSuggestions = false;
    }
    await key(p, 'Escape', 27); await p.wait('!document.querySelector(".hc-dialog[open]")', 'Escape');
    k.ck(await p.evaluate('document.activeElement.matches(".hc-launcher")'), width + ': foco vuelve al lanzador');
    await p.close();
  }
  await k.closePages(); k.finish(baseline ? 'Capturas previas' : 'Sugerencias del chatbot');
})().catch(error => { console.error(error); process.exit(1); });
