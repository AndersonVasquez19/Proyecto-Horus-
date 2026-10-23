// Prueba de integración: el sitio público (frontend/dist) muestra el contenido editorial desde src/institutional/ con el backend APAGADO.
// Cualquier petición a /api/ responde 503 y se registra: las páginas editoriales y sus detalles no deben hacer ninguna.
// Requiere compilar antes (npm run build). Recorre las páginas a 1280 y 390 px con el almacenamiento bloqueado.
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./smoke-kit.cjs');
const output = path.resolve(__dirname, '..', 'dist');

(async () => {
  if (!fs.existsSync(path.join(output, 'index.html'))) throw new Error('Falta frontend/dist: ejecuta npm run build antes de este smoke.');
  const html = fs.readFileSync(path.join(output, 'index.html'));
  const calls = [];
  const handler = (req, res, { route, json }) => {
    if (route.startsWith('/api/')) { calls.push(req.method + ' ' + route); return json({ ok: false, message: 'Backend apagado en esta prueba.' }, 503) || true; }
    const requested = path.resolve(output, '.' + decodeURIComponent(route));
    const file = requested.startsWith(output + path.sep) && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : null;
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', file ? mime[path.extname(file)] || 'application/octet-stream' : 'text/html');
    res.end(file ? fs.readFileSync(file) : html); return true;
  };
  const k = await start({ prefix: 'institucional-estatico', handler });
  const lower = value => String(value).toLowerCase();
  for (const width of [1280, 390]) {
    const p = await k.open(width);
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'for (const key of ["localStorage","sessionStorage"]) Object.defineProperty(window,key,{get(){throw new DOMException("Storage blocked","SecurityError")}});' });
    const routes = [['/', '[data-agreement-toggle]', 'Economistas'], ['/quienes-somos', 'h1', 'Quiénes'], ['/educacion/asesoramiento', '.edu-card', 'Asesoramiento'],
      ['/educacion/capacitaciones', '.edu-card', 'Capacitaciones empresariales'], ['/educacion/cursos', '.edu-empty', 'Cursos'], ['/tecnologias/cableado-estructurado', '.cable-panel-info', 'Cableado'],
      ['/tecnologias/camaras-seguridad', 'main h1', 'Cámaras'], ['/tecnologias/soporte-mantenimiento', 'main h1', 'Soporte'], ['/galeria', '.gl-card', 'Nuestro trabajo'],
      ['/preguntas-frecuentes', 'main h1', 'Preguntas'], ['/contactos', 'main h1', 'Contact']];
    for (const [route, selector, text] of routes) {
      await p.go(route, 'document.querySelector(' + JSON.stringify(selector) + ')');
      k.ck(lower(await p.text('main')).includes(lower(text)), width + ' px: contenido institucional en ' + route);
      k.ck(await p.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width + ' px: sin desborde en ' + route);
      k.ck(!(await p.evaluate('!!document.querySelector("main [role=alert]")')), width + ' px: sin error de contenido en ' + route);
      if (route === '/galeria') {
        await p.wait('[...document.querySelectorAll(".gl-card img")].some(img => img.naturalWidth > 0)', 'imágenes locales');
        k.ck(await p.evaluate('document.querySelectorAll(".gl-card").length === 24'), 'galería local paginada');
      }
      if (route === '/educacion/capacitaciones') {
        await p.wait('[...document.querySelectorAll(".edu-card img")].some(img => img.naturalWidth > 0)', 'imágenes versionadas de capacitaciones');
        k.ck(await p.evaluate('[...document.querySelectorAll(".edu-card img")].every(img => !img.src.includes("/api/"))'), 'las imágenes no dependen de /api');
      }
    }
    await p.go('/educacion/capacitaciones/7', 'document.querySelector(".edu-detail")');
    k.ck(lower(await p.text('main')).includes('capacitaciones empresariales'), 'detalle local sin API');
    await p.go('/', 'document.querySelector("[data-agreement-toggle]")');
    await p.evaluate('document.querySelector(".home-convenios").scrollIntoView({block:"start",behavior:"instant"})');
    await p.wait('[...document.querySelectorAll("[data-agreement-logo] img")].every(img => img.naturalWidth > 0)', 'logos institucionales');
    const capture = async suffix => {
      if (!process.env.SMOKE_SCREENSHOTS) return;
      await p.wait('!document.querySelector(".home-welcome")', 'fin de la bienvenida');
      await p.evaluate('document.querySelector(' + JSON.stringify(suffix === 'frente' ? '.home-convenios' : '[data-flipped=true]') + ').scrollIntoView({block:' + JSON.stringify(suffix === 'frente' ? 'start' : 'center') + ',behavior:"instant"})');
      const result = await p.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(process.env.SMOKE_SCREENSHOTS, { recursive: true });
      fs.writeFileSync(path.join(process.env.SMOKE_SCREENSHOTS, 'convenios-reales-' + width + '-' + suffix + '.png'), Buffer.from(result.data, 'base64'));
    };
    await capture('frente');
    await p.click('[data-agreement-toggle]', 'Economistas');
    await p.wait('document.querySelectorAll("[data-agreement-toggle]")[1].getAttribute("aria-expanded")==="true"', 'reverso de convenio');
    k.ck(!(await p.evaluate('!!document.querySelector("#convModal")')), 'el giro muestra el reverso sin abrir un diálogo');
    k.ck(await p.evaluate('(()=>{const region=document.querySelector("[data-flipped=true] [role=region]");return region.clientHeight>0&&region.scrollHeight<=region.clientHeight+1})()'), 'el resumen del reverso se lee sin desplazamiento interno');
    await capture('reverso');
    await p.click('[data-flipped=true] [data-agreement-detail]', 'Ver detalle completo'); await p.wait('document.querySelector("#convNombre")', 'detalle de convenio');
    k.ck((await p.text('#convNombre')).includes('Economistas'), 'detalle de convenio local sin API');
    await p.close();
  }
  k.ck(calls.length === 0, 'todas las páginas editoriales y sus detalles sin backend, cuenta ni storage', calls);
  await k.closePages(); k.finish('Contenido institucional estático (sitio compilado, API apagada)');
})().catch(error => { console.error('FALLO DEL SMOKE ESTÁTICO:', error.message); process.exit(1); });
