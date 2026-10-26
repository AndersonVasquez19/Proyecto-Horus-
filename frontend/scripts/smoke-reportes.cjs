// Reportes con API simulada: nada real (sin backend, MySQL ni correo). Cubre: catálogo por grupos, filtros según lo que declara cada reporte,
// período inválido sin solicitudes, consulta con resumen y tabla, paginación con los filtros de la consulta mostrada, respuesta del reporte
// anterior descartada al cambiar de reporte, descarga (nombre de Content-Disposition, token solo en Authorization, sin page/limit, separador
// solo en CSV, un solo envío, recursos temporales liberados), errores 422/429/500 y tipo inesperado sin guardar archivo, cancelación,
// permisos (sin exportar), alternativa móvil de la tabla y sin desborde.
const { start } = require('./smoke-kit.cjs');

const READ = ['reportes_academicos:leer', 'convocatorias:leer', 'matriculas:leer', 'estudiantes:leer', 'configuracion:leer'];
const PERMS = { gerente: [...READ, 'reportes_academicos:exportar'], coordinadora: READ };
let who = 'gerente', slowTipo = '', exportMode = 'ok', catalogFail = false, previews = [], exportsSeen = [];
const entry = (tipo, titulo, extra = {}) => ({ tipo, titulo, descripcion: 'Descripción de ' + titulo, filtros: ['desde', 'hasta'], estados: [], datos_personales: false, ambito: 'academico', puede_consultar: true, puede_exportar: true, ...extra });
const catalog = () => ({ ok: true, formatos: ['csv', 'xlsx', 'pdf'], limites: { filas_exportacion: { csv: 20000, xlsx: 20000, pdf: 3000 }, filas_por_pagina: 100 }, reportes: [
  entry('ocupacion', 'Ocupación de cupos', { filtros: ['desde', 'hasta', 'curso_id', 'convocatoria_id', 'estado', 'archivo'], estados: ['planificada', 'abierta'] }),
  entry('estudiantes', 'Estudiantes registrados', { filtros: ['desde', 'hasta', 'estado'], estados: ['activos', 'inactivos', 'todos'], datos_personales: true }),
  entry('resumen', 'Resumen general'),
  entry('cotizaciones-importes', 'Importes de cotizaciones', { ambito: 'comercial', filtros: ['desde', 'hasta', 'moneda'] }),
  entry('matriculas-por-edicion', 'Matrículas por edición', { filtros: ['desde', 'hasta', 'agrupar'], puede_exportar: false }),
] });
const rows = (n, offset) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, curso: 'Excel Básico ' + (offset + i + 1), capacidad: 20, vigentes: 5, ocupacion: 25, inicio: '2026-11-01', registrado: '2026-10-19 10:30', observacion: i === 0 ? null : 'ok' }));
const COLUMNS = [{ clave: 'id', titulo: 'ID', tipo: 'entero', ancho: 6 }, { clave: 'curso', titulo: 'Curso', tipo: 'texto', ancho: 30 }, { clave: 'capacidad', titulo: 'Capacidad', tipo: 'entero', ancho: 10 }, { clave: 'ocupacion', titulo: 'Ocupación (%)', tipo: 'decimal', ancho: 10 }, { clave: 'inicio', titulo: 'Inicio', tipo: 'fecha', ancho: 12 }, { clave: 'registrado', titulo: 'Registrado', tipo: 'fecha_hora', ancho: 16 }, { clave: 'observacion', titulo: 'Observación', tipo: 'texto', ancho: 16 }];
const preview = (tipo, q) => {
  const page = Number(q.get('page') || 1), total = tipo === 'resumen' ? 0 : 25, n = tipo === 'resumen' ? 0 : page === 1 ? 20 : 5;
  const def = catalog().reportes.find(r => r.tipo === tipo);
  return { ok: true, reporte: { tipo, titulo: def.titulo, descripcion: def.descripcion, institucion: 'Horus Group SRL', generado_local: '2026-10-23 10:30', periodo: { desde: q.get('desde'), hasta: q.get('hasta'), etiqueta: q.get('desde') ? 'Del ' + q.get('desde') : 'Todo el historial' }, filtros: q.get('estado') ? [{ clave: 'estado', etiqueta: 'Estado', valor: q.get('estado') }] : [],
    resumen: [{ clave: 'a', etiqueta: 'Ediciones', valor: total, tipo: 'entero' }, { clave: 'o', etiqueta: 'Ocupación global (%)', valor: total ? 40 : null, tipo: 'decimal' }], notas: ['Solo las matrículas vigentes ocupan cupo.'], datos_personales: def.datos_personales,
    tabla: { titulo: 'Tabla de ' + def.titulo, columnas: COLUMNS, filas: rows(n, (page - 1) * 20), totales: total ? { id: 'Total', curso: null, capacidad: 500, ocupacion: 25, inicio: null, registrado: null, observacion: null } : null, total_filas: total } },
    pagination: { page, limit: 20, total, pages: Math.ceil(total / 20) } };
};
const session = () => ({ ok: true, user: { id: 1, nombre: 'Cuenta ficticia', email: 'g@reportes.test', rol: who === 'gerente' ? 'GERENTE_GENERAL' : 'COORDINADORA_INSTITUCIONAL', permisos: PERMS[who] }, acceso: { modo: 'por_roles' } });
let kit;
(async () => {
  kit = await start({ prefix: 'reportes', handler: async (req, res, { route, url, json }) => {
    if (!route.startsWith('/api/')) return false;
    if (route === '/api/admin/me') { json(session()); return true; }
    if (route === '/api/admin/convocatorias/cursos') { json({ ok: true, items: [{ id: 1, titulo: 'Excel Básico', tipo: 'curso', estado: 'publicado' }], pagination: { page: 1, limit: 20, total: 1, pages: 1 } }); return true; }
    if (route === '/api/admin/matriculas/ediciones') { json({ ok: true, items: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true; }
    if (route === '/api/admin/reportes') { if (catalogFail) { json({ message: 'Error ficticio interno' }, 500); return true; } json(catalog()); return true; }
    const exp = route.match(/^\/api\/admin\/reportes\/([a-z-]+)\/exportar$/);
    if (exp) {
      exportsSeen.push({ tipo: exp[1], search: url.search, auth: req.headers.authorization || '' }); await kit.sleep(exportMode === 'slow' ? 1500 : 150);
      if (exportMode === 'unprocessable') { json({ statusCode: 422, message: 'El reporte tiene 25000 filas y el máximo para el formato PDF es 3000.' }, 422); return true; }
      if (exportMode === 'limit') { json({ statusCode: 429, message: 'Hay otras exportaciones en curso. Inténtalo de nuevo en unos segundos.' }, 429); return true; }
      if (exportMode === 'error') { json({ message: 'Internal server error: detalle técnico' }, 500); return true; }
      if (exportMode === 'wrongtype') { json({ ok: true }); return true; }
      const format = url.searchParams.get('formato'), types = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };
      res.writeHead(200, { 'Content-Type': types[format], 'Content-Disposition': 'attachment; filename="horus-reporte-' + exp[1] + '-20261023-1030.' + format + '"', 'Cache-Control': 'no-store' }); res.end(Buffer.from('contenido-ficticio-' + format)); return true;
    }
    const match = route.match(/^\/api\/admin\/reportes\/([a-z-]+)$/);
    if (match) { previews.push({ tipo: match[1], search: url.search }); if (match[1] === slowTipo) await kit.sleep(900); json(preview(match[1], url.searchParams)); return true; }
    json({ ok: true, items: [], settings: {}, pagination: { page: 1, limit: 20, total: 0, pages: 0 } }); return true;
  } });
  const { ck } = kit;
  const overflow = 'document.documentElement.scrollWidth <= innerWidth';
  const ready = 'document.querySelector(".hr-report-grid") && !document.querySelector(".hp-loading")';
  const choose = async (p, title) => { await p.click('.hr-report-card', title); await p.wait('document.querySelector("[aria-label^=\\"Filtros de\\"]")?.textContent.includes(' + JSON.stringify(title) + ')', 'filtros de ' + title); };
  // Registro de descargas del navegador: no se guarda ningún archivo, solo se anota el nombre y se cuentan los enlaces temporales.
  const instrument = p => p.evaluate('(() => { window.__dl = { names: [], created: 0, revoked: 0, sizes: [] }; const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL); URL.createObjectURL = b => { window.__dl.created++; window.__dl.sizes.push(b.size); return c(b); }; URL.revokeObjectURL = u => { window.__dl.revoked++; return r(u); }; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.names.push(this.download); }; return true; })()');
  const dl = p => p.evaluate('JSON.stringify(window.__dl)').then(JSON.parse);

  const page = await kit.session('/admin/dashboard?section=reportes', 1365); await page.wait(ready, 'catálogo de reportes');
  await instrument(page);
  ck((await page.text('.hr-catalog')).includes('Académicos') && (await page.text('main')).includes('Comerciales y de atención'), 'agrupa los reportes académicos y los comerciales');
  ck(await page.evaluate('document.querySelectorAll(".hr-report-card").length === 5'), 'lista los reportes que la cuenta puede consultar');

  // Filtros según el catálogo
  await choose(page, 'Ocupación de cupos');
  ck(await page.evaluate('["desde","hasta","estado","archivo"].every(n => document.querySelector(".hr-filters [name=" + n + "]")) && !document.querySelector(".hr-filters [name=moneda]") && document.querySelectorAll(".hr-picker").length === 2'), 'ofrece solo los filtros que declara el reporte (con selectores de curso y edición)');
  await choose(page, 'Estudiantes registrados'); ck(await page.evaluate('!document.querySelector(".hr-picker") && !!document.querySelector(".hr-filters [name=estado]")'),'un reporte sin curso ni edición no los ofrece');
  ck((await page.text('[aria-label^="Filtros de"]')).includes('Confidencial'), 'avisa de los datos personales');

  // Período inválido
  await choose(page, 'Ocupación de cupos'); await page.type('.hr-filters [name=desde]', 0, '2026-03-01'); await page.type('.hr-filters [name=hasta]', 0, '2026-02-01');
  await page.wait('document.querySelector("#report-error-hasta")', 'error de período'); const before = previews.length + exportsSeen.length;
  ck(await page.evaluate('[...document.querySelectorAll(".hr-filters button[type=submit], .hr-export button")].every(b => b.disabled)'), 'un período inválido bloquea consultar y descargar'); ck(previews.length + exportsSeen.length === before, 'sin solicitudes con un período inválido');

  // Consulta y paginación con los filtros mostrados
  await page.type('.hr-filters [name=hasta]', 0, '2026-12-31'); await page.type('.hr-filters [name=desde]', 0, '2026-01-01'); await page.type('.hr-filters [name=estado]', 0, 'abierta');
  await page.click('.hr-filters button[type=submit]', 'Consultar'); await page.wait('document.querySelector(".hr-table")', 'tabla');
  ck((await page.text('.hr-summary')).includes('Ocupación global (%)') && (await page.text('.hr-summary')).includes('40.0'), 'resumen con decimales');
  ck(await page.evaluate('document.querySelectorAll(".hr-table tbody tr").length === 20 && !!document.querySelector(".hr-table tfoot")'), 'tabla paginada con fila de totales');
  ck((await page.text('.hr-table tbody tr')).includes('01/11/2026') && (await page.text('.hr-table tbody tr')).includes('19/10/2026 10:30') && (await page.text('.hr-table tbody tr')).includes('—'), 'fechas locales y dato ausente como guion (no cero)');
  const firstQuery = previews[previews.length - 1].search; ck(firstQuery.includes('desde=2026-01-01') && firstQuery.includes('estado=abierta') && firstQuery.includes('page=1') && firstQuery.includes('limit=20') && !firstQuery.includes('moneda'), 'la consulta lleva solo los filtros del reporte', firstQuery);
  await page.type('.hr-filters [name=estado]', 0, 'planificada'); await page.wait('document.querySelector(".hr-result .hp-notice")', 'aviso de filtros cambiados');
  await page.click('.hp-pagination button', 'Siguiente'); await page.wait('document.querySelectorAll(".hr-table tbody tr").length === 5', 'página 2');
  const secondQuery = previews[previews.length - 1].search; ck(secondQuery.includes('estado=abierta') && secondQuery.includes('page=2'), 'la página 2 conserva los filtros de la consulta mostrada, no los que se están escribiendo', secondQuery);
  await page.click('.hp-pagination button', 'Anterior'); await page.wait('document.querySelectorAll(".hr-table tbody tr").length === 20', 'página 1');

  // Cambiar de reporte con una consulta lenta en curso
  slowTipo = 'ocupacion'; await page.click('.hr-filters button[type=submit]', 'Consultar'); await choose(page, 'Estudiantes registrados'); await kit.sleep(1300);
  ck(await page.evaluate('!document.querySelector(".hr-table") && document.querySelector(".hr-result").textContent.includes("pulsa")'), 'la respuesta del reporte anterior no se pinta en el nuevo'); slowTipo = '';

  // Descarga
  await choose(page, 'Ocupación de cupos'); await page.type('.hr-filters [name=desde]', 0, '2026-01-01'); await page.type('.hr-export select', 0, 'coma');
  await page.click('.hr-export button', 'CSV'); await page.wait('window.__dl.names.length === 1', 'descarga CSV'); await page.wait('document.querySelector(".hr-status")?.textContent.includes("Descarga lista")', 'estado de descarga');
  let seen = exportsSeen[exportsSeen.length - 1], info = await dl(page);
  ck(info.names[0] === 'horus-reporte-ocupacion-20261023-1030.csv', 'el nombre sugerido por el servidor se respeta', info.names);
  ck(seen.search.includes('formato=csv') && seen.search.includes('separador=coma') && seen.search.includes('desde=2026-01-01') && !seen.search.includes('page') && !seen.search.includes('limit'), 'la exportación lleva los filtros y el formato, sin page ni limit', seen.search);
  ck(seen.auth.startsWith('Bearer ') && !seen.search.includes(seen.auth.slice(7)), 'el token viaja solo en Authorization, nunca en la URL');
  await page.click('.hr-export button', 'Excel'); await page.wait('window.__dl.names.length === 2', 'descarga XLSX'); seen = exportsSeen[exportsSeen.length - 1];
  ck(!seen.search.includes('separador') && seen.search.includes('formato=xlsx'), 'el separador solo viaja en CSV');
  await kit.sleep(1300); info = await dl(page); ck(info.created === 2 && info.revoked === 2 && info.sizes.every(size => size > 0), 'cada descarga crea y libera su enlace temporal', info);
  const beforeDouble = exportsSeen.length;
  await page.evaluate('const b=[...document.querySelectorAll(".hr-export button")].find(x=>x.textContent.includes("PDF"));b.click();b.click();true'); await page.wait('window.__dl.names.length === 3', 'descarga PDF'); ck(exportsSeen.length === beforeDouble + 1, 'doble clic: una sola descarga');

  // Errores de descarga
  for (const [mode, expected, name] of [['unprocessable', 'Acota', '422'], ['limit', 'otras exportaciones', '429'], ['error', 'servidor no pudo', '500'], ['wrongtype', 'archivo inesperado', 'tipo inesperado']]) {
    exportMode = mode; const files = (await dl(page)).names.length, requestsBefore = exportsSeen.length;
    await page.click('.hr-export button', 'CSV'); await page.wait('document.querySelector(".hr-export [role=alert]")?.textContent.includes(' + JSON.stringify(expected) + ')', 'error ' + name);
    ck(!/internal|detalle técnico|select/i.test(await page.text('.hr-export')), name + ': sin texto técnico'); await kit.sleep(250);
    ck((await dl(page)).names.length === files && exportsSeen.length === requestsBefore + 1, name + ': no guarda archivo y no reintenta');
  }
  exportMode = 'slow'; const filesBeforeCancel = (await dl(page)).names.length;
  await page.click('.hr-export button', 'CSV'); await page.wait('[...document.querySelectorAll(".hr-export button")].some(b => b.textContent.includes("Cancelar descarga"))', 'botón cancelar'); await page.click('.hr-export button', 'Cancelar descarga');
  await page.wait('document.querySelector(".hr-export [role=alert]")?.textContent.includes("cancel")', 'cancelada'); await kit.sleep(300); ck((await dl(page)).names.length === filesBeforeCancel, 'cancelar no guarda ningún archivo'); exportMode = 'ok';

  // Sin permiso de exportar en el reporte
  await choose(page, 'Matrículas por edición'); ck(!(await page.evaluate('!!document.querySelector(".hr-export")')), 'un reporte sin puede_exportar no ofrece descargas');
  ck(await page.evaluate(overflow), 'escritorio sin desborde'); await kit.closePages();

  // Móvil: tabla en tarjetas
  const mobile = await kit.session('/admin/dashboard?section=reportes', 390); await mobile.wait(ready, 'móvil'); await choose(mobile, 'Ocupación de cupos');
  await mobile.click('.hr-filters button[type=submit]', 'Consultar'); await mobile.wait('document.querySelector(".hr-table")', 'tabla móvil');
  ck(await mobile.evaluate('getComputedStyle(document.querySelector(".hr-table tbody td")).display === "flex" && document.querySelector(".hr-table tbody td").dataset.label === "ID"'), 'en móvil cada fila es una tarjeta «columna: valor»');
  ck(await mobile.evaluate(overflow), 'móvil sin desborde de página'); await kit.closePages();

  // Coordinación: consulta sin exportar
  who = 'coordinadora'; const coordinator = await kit.session('/admin/dashboard?section=reportes'); await coordinator.wait(ready, 'coordinación'); await choose(coordinator, 'Ocupación de cupos');
  ck(!(await coordinator.evaluate('!!document.querySelector(".hr-export")')), 'sin reportes_academicos:exportar no se ofrecen descargas'); await kit.closePages();
  who = 'gerente'; catalogFail = true; const failed = await kit.session('/admin/dashboard?section=reportes'); await failed.wait('document.querySelector("main [role=alert]")', 'error de catálogo');
  ck(!(await failed.text('main')).includes('Error ficticio interno'), 'error de catálogo sin texto técnico'); catalogFail = false;
  await failed.click('main button', 'Reintentar'); await failed.wait(ready, 'reintento'); ck(true, 'reintento recupera el catálogo'); await kit.closePages();
  kit.finish('Reportes con API simulada');
})().catch(error => { console.error(error.message); kit?.cleanup(); process.exit(1); });
