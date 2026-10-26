// Fase 4B: React real con sesiones y API ficticias. Sin MySQL ni servicios externos.
const fs = require('node:fs');
const path = require('node:path');
const { start, sleep, TOKEN } = require('./smoke-kit.cjs');

// Leer la matriz existente; estas fixtures no definen una segunda política.
const backend = file => fs.readFileSync(path.join(__dirname, '../../backend/src/permissions', file), 'utf8');
const policy = backend('policy.ts');
const roleList = name => [...policy.match(new RegExp('const ' + name + ': readonly Permission\\[\\] = \\[([\\s\\S]*?)\\];'))[1].matchAll(/'([a-z_]+:[a-z_]+)'/g)].map(m => m[1]);
const all = [...backend('permissions.ts').match(/RESOURCE_OPERATIONS = \{([\s\S]*?)\} as const/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .flatMap(([, resource, ops]) => [...ops.matchAll(/'([a-z_]+)'/g)].map(m => resource + ':' + m[1]));
const permissions = { GERENTE_GENERAL: all, COORDINADORA_INSTITUCIONAL: roleList('COORDINADORA_INSTITUCIONAL'), SECRETARIA: roleList('SECRETARIA') };
const sim = { role: 'GERENTE_GENERAL', omitExport: false, status: 200, hold: false };
let release, meReads = 0;
const reads = [];
const messages = Array.from({ length: 21 }, (_, i) => ({ id: 21 - i, nombre: 'Persona ficticia ' + i, email: 'p' + i + '@example.test', telefono: '999000001', asunto: 'Consulta ficticia ' + i, mensaje: 'CUERPO_PRIVADO', estado: 'nuevo', createdAt: '2026-01-01T15:00:00Z' }));
const handler = async (req, res, { route, url, json }) => {
  if (!route.startsWith('/api/')) return false;
  if (route === '/api/settings') { json({ ok: true, settings: {} }); return true; }
  if (route === '/api/admin/me') {
    meReads++;
    json({ ok: true, user: { id: 1, nombre: 'Persona ficticia', email: 'p@example.test', rol: sim.role, permisos: permissions[sim.role].filter(p => !sim.omitExport || p !== 'mensajes:exportar') }, acceso: { modo: 'por_roles' } }); return true;
  }
  if (route === '/api/admin/messages') {
    reads.push(url.search);
    if (sim.status !== 200) { json({ message: 'ERROR_INTERNO_NO_MOSTRAR' }, sim.status); return true; }
    if (sim.hold && url.searchParams.get('limit') === '100') await new Promise(resolve => { release = resolve; });
    const search = url.searchParams.get('search') || '', estado = url.searchParams.get('estado') || '';
    const rows = messages.filter(m => (!search || m.nombre.includes(search)) && (!estado || m.estado === estado));
    const page = Number(url.searchParams.get('page')), limit = Number(url.searchParams.get('limit'));
    json({ ok: true, messages: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) }, metrics: { nuevo: 21 } }); return true;
  }
  json({ ok: true, items: [], pagination: { page: 1, total: 0, pages: 0 } }); return true;
};
const exportButton = "[...document.querySelectorAll('button')].find(b => /Exportar resultados|Exportando…/.test(b.textContent))";
const capture = `(() => { const b = ${exportButton}; if (!b) return false; const key = Object.keys(b).find(k => k.startsWith('__reactProps$')); window.__export = b[key].onClick; return true; })()`;
const watchDownloads = "window.__downloads = 0; window.__csv = ''; URL.createObjectURL = blob => { blob.text().then(t => window.__csv = t); return 'blob:fixture'; }; URL.revokeObjectURL = () => {}; HTMLAnchorElement.prototype.click = function () { window.__downloads++; }; true";

(async () => {
  const k = await start({ prefix: 'export-access', handler });
  const { ck } = k;
  try {
    for (const role of Object.keys(permissions)) {
      sim.role = role; sim.omitExport = false;
      const p = await k.session('/admin/dashboard?section=mensajes');
      await p.wait('document.querySelector(".hp-card-heading p")?.textContent.startsWith("21 consultas")', 'bandeja');
      ck((await p.text()).includes('21 consultas coinciden'), role + ': lectura de mensajes conservada');
      await p.evaluate(watchDownloads);
      const allowed = permissions[role].includes('mensajes:exportar');
      ck(await p.evaluate('!!(' + exportButton + ')') === allowed, role + ': exportación visible solo con permiso efectivo');
      await p.evaluate(`(${exportButton})?.click(); true`);
      if (allowed) await p.wait('window.__downloads === 1 && window.__csv', 'CSV autorizado');
      else await sleep(200);
      ck(await p.evaluate('window.__downloads') === (allowed ? 1 : 0), role + ': descargas según permiso');
      if (allowed) ck(await p.evaluate("window.__csv.replace(/^\\uFEFF/, '').split('\\r\\n')[0] === '\"id\",\"nombre\",\"correo\",\"telefono\",\"asunto\",\"origen\",\"estado\",\"fecha\"' && !window.__csv.includes('CUERPO_PRIVADO') && window.__csv.split('\\r\\n').length === 22"), 'Gerente exporta las 21 filas y las columnas actuales, sin cuerpo del mensaje');
      await p.type('input[aria-label="Buscar consultas"]', 0, 'Persona ficticia 20');
      await p.wait('document.querySelector(".hp-card-heading p")?.textContent.startsWith("1 consultas")', 'búsqueda conservada');
      await p.type('select[aria-label="Estado de atención"]', 0, 'nuevo');
      await p.wait('location.search.includes("estado=nuevo") && document.querySelector(".hp-card-heading p")?.textContent.startsWith("1 consultas")', 'filtro conservado');
      ck((await p.text()).includes('1 consultas coinciden'), role + ': búsqueda y filtro conservados');
      await p.close();
    }
    sim.role = 'GERENTE_GENERAL'; sim.omitExport = true;
    const limited = await k.session('/admin/dashboard?section=mensajes');
    await limited.wait('document.querySelector(".hp-card-heading p")?.textContent.startsWith("21 consultas")', 'gerente sin exportar');
    ck(await limited.evaluate('!(' + exportButton + ')'), 'el nombre Gerente no concede exportación si falta el permiso');
    await limited.close();

    sim.omitExport = false;
    const p = await k.session('/admin/dashboard?section=mensajes');
    await p.wait('document.querySelector(".hp-card-heading p")?.textContent.startsWith("21 consultas")', 'sesión para revocación');
    await p.evaluate(watchDownloads);
    ck(await p.evaluate(capture), 'se captura el manejador React real para probar una invocación fuera del control visible');
    // Dejar vencer el intervalo real de revalidación tras 403; no se acelera el reloj.
    await sleep(5100);
    sim.omitExport = true;
    await p.evaluate(`window.dispatchEvent(new CustomEvent('horus:access-denied', { detail: { token: ${JSON.stringify(TOKEN)} } })); true`);
    await p.wait(`!(${exportButton})`, 'permiso revocado en la sesión');
    ck(await p.evaluate(`!(${exportButton})`), 'retirada de la acción tras revalidación');
    const before = reads.length;
    await p.evaluate('window.__export(); true'); await sleep(200);
    ck(await p.evaluate('window.__downloads === 0') && reads.length === before, 'manejador retenido: sin permiso no consulta páginas ni descarga CSV');
    await p.close();

    sim.omitExport = false;
    const pending = await k.session('/admin/dashboard?section=mensajes');
    await pending.wait('document.querySelector(".hp-card-heading p")?.textContent.startsWith("21 consultas")', 'bandeja para exportación pendiente');
    await pending.evaluate(watchDownloads);
    await sleep(5100);
    sim.hold = true; release = null;
    await pending.evaluate(`(${exportButton}).click(); true`);
    for (let i = 0; i < 80 && !release; i++) await sleep(100);
    if (!release) throw new Error('La exportación no llegó al servidor simulado');
    sim.omitExport = true;
    const previousMe = meReads;
    await pending.evaluate(`window.dispatchEvent(new CustomEvent('horus:access-denied', { detail: { token: ${JSON.stringify(TOKEN)} } })); true`);
    await pending.wait(`!(${exportButton})`, 'revocación con GET de exportación pendiente');
    ck(meReads > previousMe, 'la revocación se recibe por /admin/me real del contexto React');
    release(); sim.hold = false;
    await pending.wait('!document.body.innerText.includes("Cancelar exportación")', 'fin de exportación cancelada');
    ck(await pending.evaluate('window.__downloads === 0 && !window.__csv'), 'revocación durante el último GET: no crea Blob ni descarga');
    await pending.close();

    for (const status of [403, 401]) {
      sim.omitExport = false; sim.status = 200;
      const q = await k.session('/admin/dashboard?section=mensajes');
      await q.wait('document.querySelector(".hp-card-heading p")?.textContent.startsWith("21 consultas")', 'sesión antes de error');
      await q.evaluate(watchDownloads); sim.status = status;
      await q.evaluate(`(${exportButton}).click(); true`);
      await q.wait(status === 401 ? 'location.pathname === "/admin/login"' : 'document.querySelector(".hp-error[role=alert]")', 'respuesta ' + status);
      ck(await q.evaluate('window.__downloads === 0 && !document.body.innerText.includes("ERROR_INTERNO_NO_MOSTRAR")'), status + ': sin descarga ni mensaje interno');
      sim.status = 200; await q.close();
    }
    k.finish('Exportación por permisos (4B)');
  } finally { release?.(); k.cleanup(); }
})().catch(error => { console.error(error); process.exit(1); });
