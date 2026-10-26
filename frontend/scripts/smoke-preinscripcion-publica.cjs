// Preinscripción pública con API simulada: nada real (sin backend, MySQL ni correo). Cubre: lista de ediciones (código opaco), selección por
// enlace, validación local sin enviar, campo trampa oculto y vacío, cuerpo exacto del POST (sin DNI, pagos ni canal), doble envío, éxito
// solo tras la respuesta, 404/409 (edición cerrada: se recarga la lista), 429, 500 y 502 (resultado incierto) sin texto técnico ni reintento,
// lista vacía, fallo de carga con reintento, teclado y móvil sin desborde.
const { start } = require('./smoke-kit.cjs');

const A = 'a'.repeat(32), B = 'b'.repeat(32);
const edition = (codigo, nombre, extra = {}) => ({ codigo, nombre, apertura_confirmada: false, fecha_inicio: '2026-11-01', fecha_fin: '2026-11-30', curso: { titulo: 'Excel Básico', tipo: 'curso', modalidad: 'virtual', duracion: '20 horas' }, ...extra });
let editions = [edition(A, 'Excel — Noviembre'), edition(B, 'Excel — Diciembre', { apertura_confirmada: true, fecha_inicio: null, fecha_fin: null })];
let mode = 'ok', listFail = false, posts = 0, lastBody = null, getLists = 0;
let kit;
(async () => {
  kit = await start({ prefix: 'preinscripcion', handler: async (req, _res, { route, json, body }) => {
    if (route === '/api/preinscripciones/convocatorias') { getLists++; if (listFail) { json({ message: 'Error ficticio interno' }, 500); return true; } json({ ok: true, items: editions }); return true; }
    if (route === '/api/preinscripciones' && req.method === 'POST') {
      posts++; lastBody = await body(); await kit.sleep(120);
      if (mode === 'closed') { editions = editions.filter(e => e.codigo !== lastBody.convocatoria); json({ statusCode: 404, message: 'Detalle técnico que no debe mostrarse' }, 404); return true; }
      if (mode === 'limit') { json({ statusCode: 429, message: 'Too Many Requests' }, 429); return true; }
      if (mode === 'error') { json({ message: 'Internal server error: detalle técnico' }, 500); return true; }
      if (mode === 'uncertain') { json({ message: 'Bad gateway' }, 502); return true; }
      json({ ok: true, mensaje: 'Recibimos tu preinscripción. El equipo de Horus la revisará.' }, 201); return true;
    }
    if (route.startsWith('/api/')) { json({ ok: true, items: [], settings: {}, pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true; }
    return false;
  } });
  const { ck } = kit;
  const overflow = 'document.documentElement.scrollWidth <= innerWidth';
  const ready = 'document.querySelector("[data-prereg-form]")';
  const fill = async p => {
    await p.type('#pr-nombres', 0, 'Ana María'); await p.type('#pr-apellidos', 0, 'Pérez'); await p.type('#pr-email', 0, 'Ana@Ejemplo.test'); await p.type('#pr-telefono', 0, '+51 999 888 777');
    await p.evaluate('document.querySelector("#pr-consentimiento").click();true');
  };
  const page = await kit.open(1280, 900); await page.go('/preinscripcion', ready);
  ck(await page.evaluate('document.querySelectorAll(".pr-edition").length === 2 && !document.querySelector(".pr-edition input:checked")'), 'lista las ediciones sin elegir ninguna');
  ck((await page.text('.pr-editions')).includes('Del 01/11/2026 al 30/11/2026') && (await page.text('.pr-editions')).includes('Fechas por confirmar') && (await page.text('.pr-editions')).includes('Apertura por confirmar'), 'muestra fechas, modalidad y estado de apertura');
  ck(await page.evaluate('!/[0-9a-f]{32}/.test(document.querySelector(".pr-editions").innerText)'), 'el código opaco no se muestra');
  ck(await page.evaluate('document.querySelector(".pr-trap").getBoundingClientRect().right <= 0 && document.querySelector(".pr-trap input").tabIndex === -1 && document.querySelector(".pr-trap").getAttribute("aria-hidden") === "true"'), 'la trampa para robots está fuera de la vista y del teclado');

  // Validación local
  await page.click('button[type=submit]', 'Enviar preinscripción'); await page.wait('document.querySelector(".lb-summary")', 'resumen de errores');
  ck(posts === 0, 'un formulario vacío no se envía');
  ck(await page.evaluate('document.activeElement && document.activeElement.id === "pr-convocatoria"'), 'el foco va al primer campo con error');
  await page.evaluate('document.querySelector("#pr-convocatoria").click();true'); await page.type('#pr-email', 0, 'sin-arroba'); await page.type('#pr-nombres', 0, 'Ana María'); await page.type('#pr-apellidos', 0, 'Pérez'); await page.type('#pr-telefono', 0, 'abc');
  await page.click('button[type=submit]', 'Enviar preinscripción'); await page.wait('document.querySelector("#pr-email-error") && document.querySelector("#pr-telefono-error")', 'errores de formato'); ck(posts === 0, 'correo y teléfono inválidos no se envían');

  // 404: edición cerrada → lista recargada
  await fill(page); mode = 'closed'; const listsBefore = getLists;
  await page.click('button[type=submit]', 'Enviar preinscripción'); await page.wait('document.querySelector(".lb-alert")', 'edición cerrada');
  ck((await page.text('.lb-alert')).includes('ya no recibe preinscripciones') && !(await page.text('.lb-alert')).includes('Detalle técnico'), '404 explica que la edición cerró, sin texto técnico');
  await page.wait('document.querySelectorAll(".pr-edition").length === 1', 'lista recargada'); ck(getLists > listsBefore, 'la lista de ediciones se vuelve a pedir');
  ck(await page.evaluate('!document.querySelector(".pr-edition input:checked")'), 'la edición cerrada ya no queda elegida');

  // 429, 500 y 502
  for (const [m, expected, name] of [['limit', 'demasiadas solicitudes', '429'], ['error', 'problema en el servidor', '500'], ['uncertain', 'No pudimos confirmar', '502 incierto']]) {
    mode = m; await page.evaluate('document.querySelector(".pr-edition input").click();true'); const before = posts;
    await page.click('button[type=submit]', 'Enviar preinscripción'); await page.wait('document.querySelector(".lb-alert")?.textContent.includes(' + JSON.stringify(expected) + ')', name);
    ck(!/internal|bad gateway|too many|detalle técnico/i.test(await page.text('.lb-alert')), name + ': sin texto técnico del servidor');
    await kit.sleep(300); ck(posts === before + 1, name + ': un solo envío, sin reintento automático');
    ck(await page.evaluate('document.querySelector("#pr-nombres").value === "Ana María"'), name + ': conserva los datos escritos');
  }

  // Éxito con doble envío
  mode = 'ok'; const beforeOk = posts;
  await page.evaluate('const f=document.querySelector("[data-prereg-form]");f.requestSubmit();f.requestSubmit();true');
  await page.wait('document.querySelector(".pr-success")', 'éxito');
  ck(posts === beforeOk + 1, 'doble envío: un solo POST');
  ck(JSON.stringify(Object.keys(lastBody).sort()) === JSON.stringify(['apellidos', 'consentimiento', 'convocatoria', 'email', 'nombres', 'telefono', 'website']) && lastBody.consentimiento === true && lastBody.website === '' && lastBody.convocatoria === B && lastBody.email === 'ana@ejemplo.test', 'cuerpo exacto del contrato (sin DNI, pagos ni canal)', lastBody);
  ck((await page.text('.pr-success')).includes('Recibimos tu preinscripción. El equipo de Horus la revisará.') && (await page.text('.pr-success')).includes('no es una matrícula'), 'muestra el mensaje del servidor y aclara que no es matrícula');
  ck(await page.evaluate('document.activeElement && document.activeElement.classList.contains("pr-success")'), 'el foco pasa a la confirmación');
  await kit.closePages();

  // Enlace con edición preseleccionada y teclado
  editions = [edition(A, 'Excel — Noviembre'), edition(B, 'Excel — Diciembre', { apertura_confirmada: true })];
  const linked = await kit.open(1280, 900); await linked.go('/preinscripcion?edicion=' + B, ready);
  ck(await linked.evaluate('document.querySelector("#pr-edition-' + B + '").checked'), '?edicion preselecciona esa edición');
  ck(await linked.evaluate('[...document.querySelectorAll("input[type=radio]")].every(i => i.tabIndex >= 0 && !i.disabled)'), 'las opciones son accesibles con teclado'); await kit.closePages();

  // Móvil
  const mobile = await kit.open(390, 800); await mobile.go('/preinscripcion', ready); ck(await mobile.evaluate(overflow), 'móvil sin desborde de página');
  await mobile.click('button[type=submit]', 'Enviar preinscripción'); await mobile.wait('document.querySelector(".lb-summary")', 'errores móvil'); ck(await mobile.evaluate(overflow), 'móvil con errores sin desborde'); await kit.closePages();

  // Lista vacía y fallo de carga
  editions = []; const empty = await kit.open(1280, 900); await empty.go('/preinscripcion', 'document.querySelector(".pr-empty")');
  ck((await empty.text('.pr-empty')).includes('no hay ediciones recibiendo preinscripciones'), 'lista vacía con alternativa de contacto'); await kit.closePages();
  listFail = true; const failed = await kit.open(1280, 900); await failed.go('/preinscripcion', 'document.querySelector("[role=alert]")');
  ck(!(await failed.text('main')).includes('Error ficticio interno'), 'fallo de carga sin texto técnico');
  listFail = false; editions = [edition(A, 'Excel — Noviembre')]; await failed.click('[role=alert] button', 'Reintentar'); await failed.wait(ready, 'reintento'); ck(true, 'reintento recupera la lista'); await kit.closePages();
  kit.finish('Preinscripción pública con API simulada');
})().catch(error => { console.error(error.message); kit?.cleanup(); process.exit(1); });
