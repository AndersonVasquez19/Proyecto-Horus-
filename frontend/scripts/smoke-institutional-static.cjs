// Prueba de integración para Carlos: compila una copia de revisión que adapta SOLO las lecturas editoriales.
// Nunca escribe componentes públicos ni modifica el dist principal. El sitio normal sigue pendiente de integración en su rama.
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./smoke-kit.cjs');
const frontend = path.resolve(__dirname, '..');
const artifacts = path.join(frontend, '.artifacts/institutional-static');
const output = path.join(artifacts, 'dist');

(async () => {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { default: tailwind } = await import('@tailwindcss/vite');
  fs.mkdirSync(artifacts, { recursive: true });
  const entry = path.join(artifacts, 'index.html');
  fs.writeFileSync(entry, '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/src/main.tsx"></script></html>');
  const adapted = new Set();
  await build({ root: frontend, configFile: false, envDir: false, logLevel: 'warn',
    define: { 'import.meta.env.VITE_API_BASE_URL': '"/api"', 'import.meta.env.VITE_CONTENT_PROVIDER': '"nestjs"', 'import.meta.env.VITE_CONTENT_API_BASE_URL': '""' },
    plugins: [{ name: 'institutional-review-only', enforce: 'pre', transform(code, id) {
      const name = id.replaceAll('\\', '/');
      const publicConsumer = /\/src\/pages\//.test(name) || /\/src\/components\/(home|gallery|tech|edu)\//.test(name) || name.endsWith('/src/components/CompanySettingsProvider.tsx');
      if (!publicConsumer || !code.includes('usePublicResource')) return null;
      const next = code.replace(/import\s*\{\s*usePublicResource\s*\}\s*from\s*(['"])[^'"]*\/hooks\/usePublicResource\1/g, "import { useInstitutionalResource as usePublicResource } from '/src/institutional/useInstitutionalResource'");
      if (next !== code) adapted.add(path.relative(frontend, id));
      return { code: next, map: null };
    } }, react(), tailwind()],
    build: { outDir: output, emptyOutDir: false, rolldownOptions: { input: entry } },
  });
  const html = fs.readFileSync(path.join(output, '.artifacts/institutional-static/index.html'));
  fs.writeFileSync(path.join(output, 'index.html'), html);
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
  for (const width of [1280, 390]) {
    const p = await k.open(width);
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'for (const key of ["localStorage","sessionStorage"]) Object.defineProperty(window,key,{get(){throw new DOMException("Storage blocked","SecurityError")}});' });
    const routes = [['/', '.home-conv-card', 'Colegio de Administradores'], ['/quienes-somos', 'h1', 'Quiénes'], ['/educacion/asesoramiento', '.edu-card', 'Asesoramiento'], ['/educacion/capacitaciones', '.edu-card', 'Salud y Primeros Auxilios'], ['/educacion/cursos', '.edu-empty', 'Cursos'], ['/tecnologias/cableado-estructurado', '.cable-panel-info', 'Cableado'], ['/tecnologias/camaras-seguridad', 'main h1', 'Cámaras'], ['/tecnologias/soporte-mantenimiento', 'main h1', 'Soporte'], ['/galeria', '.gl-card', 'Nuestro trabajo'], ['/preguntas-frecuentes', 'main h1', 'Preguntas'], ['/contactos', 'main h1', 'Contact']];
    for (const [route, selector, text] of routes) {
      await p.go(route, 'document.querySelector(' + JSON.stringify(selector) + ')');
      k.ck((await p.text('main')).includes(text), width + ' px: contenido institucional en ' + route);
      k.ck(await p.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width + ' px: sin desborde en ' + route);
      k.ck(!(await p.evaluate('!!document.querySelector("main [role=alert]")')), width + ' px: sin error de contenido en ' + route);
      if (route === '/galeria') {
        await p.wait('[...document.querySelectorAll(".gl-card img")].some(img => img.naturalWidth > 0)', 'imágenes locales');
        k.ck(await p.evaluate('document.querySelectorAll(".gl-card").length === 24'), 'galería local paginada');
      }
    }
    await p.go('/educacion/capacitaciones/1', 'document.querySelector(".edu-detail")');
    k.ck((await p.text('main')).includes('Salud y Primeros Auxilios'), 'detalle local sin API');
    await p.go('/', 'document.querySelector(".home-conv-card")');
    await p.click('.home-conv-card', 'Colegio de Administradores'); await p.wait('document.querySelector("#convNombre")', 'detalle de convenio');
    k.ck((await p.text('#convNombre')).includes('Colegio de Administradores'), 'detalle de convenio local sin API');
    await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }).then(shot => fs.writeFileSync(path.join(artifacts, 'web-' + width + '.png'), Buffer.from(shot.data, 'base64')));
    await p.close();
  }
  k.ck(calls.length === 0, 'todas las páginas editoriales y sus detalles sin backend, cuenta ni storage', calls);
  fs.writeFileSync(path.join(artifacts, 'adapted-consumers.json'), JSON.stringify([...adapted].sort(), null, 2));
  await k.closePages(); k.finish('Contenido institucional estático (compilación de revisión)');
})().catch(error => { console.error('FALLO DEL SMOKE ESTÁTICO:', error.message); process.exit(1); });
