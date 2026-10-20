// Operaciones del panel según los permisos (H-BACK-01, E3.4.3, fase 2) con API simulada: nada real (ni cuentas, ni datos, ni correo).
// Edge por DevTools: rutas editoriales retiradas incluso con ?crear=1 y sus permisos antiguos;
// atención y cotizaciones según permisos (también cuenta solo lectora y navegación heredada), ?crear=1 y ?contacto= sin permiso,
// Enter sin permiso y accesos operativos del resumen. Abrir formularios o visitar rutas retiradas nunca debe enviar escrituras;
// las operaciones permitidas (anular cotización, iniciar atención) sí deben llegar al servidor simulado.
// Las listas de permisos de cada rol se leen del código del backend (como hace el servidor real); el panel solo recibe la lista.
const fs = require('node:fs');
const path = require('node:path');
const { start, sleep, KEY } = require('./smoke-kit.cjs');

const backend = file => fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'src', 'permissions', file), 'utf8');
const literals = text => [...text.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map(match => match[1]);
const policy = backend('policy.ts');
const roleList = name => literals(policy.match(new RegExp('const ' + name + ': readonly Permission\\[\\] = \\[([\\s\\S]*?)\\];'))[1]);
const ALL = [...backend('permissions.ts').match(/RESOURCE_OPERATIONS = \{([\s\S]*?)\} as const/)[1].matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
  .flatMap(([, resource, ops]) => [...ops.matchAll(/'([a-z_]+)'/g)].map(op => resource + ':' + op[1]));
const PERMS = { GERENTE_GENERAL: ALL, COORDINADORA_INSTITUCIONAL: roleList('COORDINADORA_INSTITUCIONAL'), SECRETARIA: roleList('SECRETARIA') };
// Cuenta ficticia que puede leer todo lo que existe en el panel y no puede modificar nada.
const READ_ONLY = ['estadisticas:leer', 'cursos:leer', 'servicios:leer', 'preguntas_frecuentes:leer', 'galeria:leer', 'convenios:leer', 'cotizaciones:leer', 'mensajes:leer', 'seguimiento_mensajes:leer', 'configuracion:leer', 'chatbot_consultas:leer'];

// ---------- API simulada ----------
const account = (id, nombre, rol, permisos = rol ? PERMS[rol] : []) => ({ id, nombre, email: nombre.split(' ')[0].toLowerCase() + '@example.test', rol, permisos });
const ACCOUNTS = {
  'tk-gerente': account(1, 'Gloria Gerente', 'GERENTE_GENERAL'),
  'tk-coord': account(2, 'Carla Coordinadora', 'COORDINADORA_INSTITUCIONAL'),
  'tk-sec': account(3, 'Sofía Secretaria', 'SECRETARIA'),
  'tk-norol': account(4, 'Nora Sinrol', null),
  'tk-lector': account(5, 'Lucía Lectora', 'COORDINADORA_INSTITUCIONAL', READ_ONLY),
  'tk-editor': account(6, 'Elena Editora', 'SECRETARIA', ['cursos:leer', 'cursos:editar']),
  'tk-resumen': account(7, 'Rosa Resumen', 'SECRETARIA', ['estadisticas:leer', 'cursos:leer']),
};
const CURSO = { id: 11, titulo: 'Curso ficticio', slug: 'curso-ficticio', tipo: 'capacitacion', estado: 'publicado', descripcion: 'Descripción ficticia.', modalidad: 'virtual', duracion: '4 semanas', fecha_inicio: '2030-01-10', imagen_url: '', orden: 0 };
const ARCHIVADO = { ...CURSO, id: 12, titulo: 'Curso archivado', slug: 'curso-archivado', estado: 'archivado', fecha_inicio: null };
const SERVICIO = { id: 21, titulo: 'Servicio ficticio', slug: 'servicio-ficticio', categoria: 'camaras', presentacion: 'normal', estado: 'publicado', descripcion: 'Descripción ficticia.', imagen_url: '', orden: 0 };
const FAQ = { id: 31, pregunta: '¿Pregunta ficticia?', respuesta: 'Respuesta ficticia.', categoria: 'General', estado: 'publicado', orden: 0 };
const IMAGEN = { id: 41, titulo: 'Imagen ficticia', descripcion: '', categoria: 'Proyectos', imagen_url: '', orden: 0, activo: true };
const CONVENIO = { id: 51, nombre: 'Convenio ficticio', sigla: 'CF', logo_url: '', orden: 1, visible: true };
const CONVENIO_DETALLE = { ...CONVENIO, descripcion_corta: 'Resumen ficticio.', descripcion_completa: '', informacion_adicional: '', fotos: [{ id: 1, imagen_url: '', orden: 0 }] };
const QUOTE = { id: 61, numero: 'COT-0001', cliente: 'Cliente Ficticio', email: 'cliente@example.test', telefono: '', documento: '', direccion: '', emisor: 'Horus', datos_emisor: '', moneda: 'PEN', validez: '2030-01-01', condiciones: '', conceptos: [{ descripcion: 'Concepto ficticio', cantidad: 1, precio: 100 }], descuento: 0, tasa: 18, estado: 'borrador', revision: 1, subtotal: 100, impuesto: 18, total: 118, historial: [] };
const MESSAGE = { id: 71, nombre: 'Persona Ficticia', email: 'persona@example.test', telefono: '999999999', asunto: 'Consulta ficticia', mensaje: 'Mensaje ficticio.', estado: 'nuevo', createdAt: '2030-01-01T10:00:00.000Z' };
const page = items => ({ ok: true, items, pagination: { page: 1, total: items.length, pages: 1, limit: 20 }, metrics: { total: items.length, upcoming: 1 } });

const fresh = () => ({ mode: 'heredado', me: 'nuevo', requests: [] });
let sim = fresh();
const shape = acc => {
  const user = { id: acc.id, nombre: acc.nombre, email: acc.email };
  return sim.me === 'antiguo' ? { user } : { user: { ...user, rol: acc.rol, permisos: acc.permisos }, acceso: { modo: sim.mode } };
};
const handler = async (req, res, { route, json, body }) => {
  if (route.startsWith('/__s/')) {
    const [, , key, value] = route.split('/');
    if (key === 'clear') sim = fresh(); else sim[key] = decodeURIComponent(value);
    return json({ ok: true }) || true;
  }
  if (route === '/__log') return json({ requests: sim.requests }) || true;
  if (!route.startsWith('/api/')) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  // El cuerpo de las escrituras se registra para comprobar que una operación permitida envía lo que exige su permiso (sección 6).
  if (route.startsWith('/api/admin/')) sim.requests.push({ method: req.method, route, token, ...(req.method !== 'GET' && { body: await body() }) });
  if (!route.startsWith('/api/admin/')) return json({ ok: true, settings: {}, items: [], pagination: { page: 1, total: 0, pages: 1, limit: 12 } }) || true;
  if (!ACCOUNTS[token]) return json({ message: 'Unauthorized' }, 401) || true;
  // Toda escritura se responde con un error: si alguna llegara a salir, el smoke la detecta por el registro (no se simula éxito).
  if (req.method !== 'GET') return json({ ok: false, mensaje: 'Escritura no esperada en el smoke.' }, 418) || true;
  const sub = route.slice('/api/admin/'.length);
  if (sub === 'me') return json({ ok: true, ...shape(ACCOUNTS[token]) }) || true;
  if (sub === 'stats') return json({ ok: true, stats: { academico: { estudiantes: 0, edicionesActivas: 0, matriculasRegistradas: 0, matriculasVigentes: 0 }, mensajes: { total: 1, nuevos: 1, enProceso: 0, atendidos: 0, archivados: 0, pendientes: 1 } }, actividadReciente: { mensajes: [MESSAGE] } }) || true;
  if (sub === 'stats/actividad') { // el gráfico solo se dibuja con un día por cada día del rango pedido
    const dias = Number(new URL(req.url, 'http://x').searchParams.get('dias')) || 30;
    const mensajes = Array.from({ length: dias }, (_, i) => ({ fecha: new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10), total: 0, chatbot: 0 }));
    return json({ ok: true, dias, desde: mensajes[0].fecha, hasta: mensajes[dias - 1].fecha, mensajes, cotizaciones: { total: 1, porEstado: { borrador: 1 } } }) || true;
  }
  if (sub === 'cursos') return json(page([CURSO, ARCHIVADO])) || true;
  if (sub === 'cursos/11') return json({ ok: true, item: CURSO }) || true;
  if (sub === 'cursos/12') return json({ ok: true, item: ARCHIVADO }) || true;
  if (sub === 'servicios') return json(page([SERVICIO])) || true;
  if (sub === 'servicios/21') return json({ ok: true, item: SERVICIO }) || true;
  if (sub === 'preguntas-frecuentes') return json(page([FAQ])) || true;
  if (sub === 'galeria') return json(page([IMAGEN])) || true;
  if (sub === 'convenios') return json(page([CONVENIO])) || true;
  if (sub === 'convenios/51') return json({ ok: true, item: CONVENIO_DETALLE }) || true;
  if (sub === 'cotizaciones') return json(page([QUOTE])) || true;
  if (sub === 'cotizaciones/61') return json({ ok: true, item: QUOTE }) || true;
  if (sub === 'messages') return json({ ok: true, messages: [MESSAGE], pagination: { page: 1, total: 1, pages: 1, limit: 20 }, metrics: { nuevo: 1 } }) || true;
  if (sub === 'messages/71') return json({ ok: true, message: MESSAGE }) || true;
  if (sub === 'seguimiento/messages/71') return json({ ok: true, item: { estado: 'nuevo', responsable: '', notas: '', respuesta: 'Respuesta guardada ficticia.', revision: 1, historial: [] } }) || true;
  if (sub === 'settings') return json({ ok: true, settings: [{ clave: 'empresa_nombre', valor: 'Horus ficticio', descripcion: 'Nombre de la empresa', grupo: 'empresa' }] }) || true;
  if (sub === 'contenido-original') return json({ ok: true, sections: [] }) || true;
  return json({ ok: true, items: [], messages: [], settings: [], sections: [], pagination: { page: 1, total: 0, pages: 1, limit: 20 }, metrics: {} }) || true;
};

(async () => {
  const k = await start({ prefix: 'acciones', handler });
  const { ck, open, closePages, origin } = k;
  const ctl = (...parts) => fetch(origin + '/__s/' + parts.map(encodeURIComponent).join('/'));
  const requests = async () => (await fetch(origin + '/__log').then(r => r.json())).requests;
  const clean = async (mode = 'por_roles') => { await closePages(); await ctl('clear'); await ctl('mode', mode); };
  const restore = async (token, route, ready) => {
    const p = await open(); await p.go('/__empty');
    await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(token) + '); 1');
    await p.go(route); if (ready) await p.wait(ready, route); await sleep(300); return p;
  };
  const has = (p, text, scope = 'main') => p.evaluate('[...document.querySelectorAll(' + JSON.stringify(scope + ' button, ' + scope + ' a') + ')].some(b => (b.textContent + " " + (b.getAttribute("aria-label") || "")).includes(' + JSON.stringify(text) + '))');
  const submit = (p, selector) => p.evaluate('document.querySelector(' + JSON.stringify(selector) + ')?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); true');
  const noWrites = async name => ck(!(await requests()).some(r => r.method !== 'GET'), name, await requests());
  const writes = async () => (await requests()).filter(r => r.method !== 'GET');
  const calls = async (token, prefix) => (await requests()).filter(r => r.token === token && r.route.startsWith('/api/admin/' + prefix));
  const readonlyNotice = p => p.evaluate('!!document.querySelector("main [data-panel-readonly]")');
  const dialogOpen = p => p.evaluate('!!document.querySelector("dialog[open]")');
  // Una operación permitida debe llegar al servidor simulado con su método, ruta y cuerpo (el simulador responde con error: nada se guarda).
  const sent = async (token, method, route, what) => {
    const end = Date.now() + 5000;
    while (Date.now() < end) { const hit = (await requests()).find(r => r.token === token && r.method === method && r.route === route); if (hit) return hit; await sleep(100); }
    throw new Error('No llegó ' + method + ' ' + route + ' (' + what + '). Escrituras: ' + JSON.stringify(await writes()));
  };

  console.log('\n== RUTAS EDITORIALES RETIRADAS');
  for (const token of ['tk-gerente', 'tk-coord', 'tk-sec', 'tk-lector']) {
    await clean();
    for (const section of ['educacion', 'cursos', 'servicios', 'galeria', 'faq', 'contenido', 'convenios', 'ajustes']) {
      const p = await restore(token, '/admin/dashboard?section=' + section + '&crear=1', 'document.querySelector("[data-panel-editorial-retired]")');
      ck(!(await p.evaluate('!!document.querySelector("main form, dialog[open]")')), token + ': ' + section + ' no monta un gestor ni abre alta');
      await closePages();
    }
    ck(!(await requests()).some(r => /\/admin\/(cursos|servicios|galeria|preguntas-frecuentes|items|convenios|settings|contenido-original)/.test(r.route)), token + ': sin solicitudes editoriales');
    await noWrites(token + ': sin escrituras');
  }

  console.log('\n== ATENCIÓN SEGÚN PERMISOS');
  for (const [token, canQuote, canDelete] of [['tk-sec', false, false], ['tk-coord', true, false], ['tk-gerente', true, true]]) {
    await clean();
    let p = await restore(token, '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck(await has(p, 'Registro manual') && await has(p, 'Guardar seguimiento') && await has(p, 'Enviar respuesta guardada'), token + ': registro y seguimiento disponibles');
    ck(await has(p, 'Preparar cotización') === canQuote && await has(p, 'Eliminar consulta') === canDelete, token + ': cotización y eliminación respetan permisos');
    await closePages();
    p = await restore(token, '/admin/messages?crear=1', 'document.querySelector("dialog[open] form")');
    ck(await has(p, 'Registrar consulta', 'dialog[open]'), token + ': alta manual disponible');
    await noWrites(token + ': abrir formularios no escribe');
  }
  await clean();
  {
    const p = await restore('tk-lector', '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck(!(await has(p, 'Registro manual')) && !(await has(p, 'Guardar seguimiento')) && !(await has(p, 'Enviar respuesta guardada')), 'lector: sin acciones de escritura');
    ck(await p.evaluate('document.querySelector(".hw-inbox-detail form fieldset").disabled'), 'lector: seguimiento deshabilitado');
    await submit(p, '.hw-inbox-detail form'); await sleep(250); await noWrites('Enter sin permiso no envía PUT');
  }
  await clean();
  {
    const p = await restore('tk-lector', '/admin/messages?crear=1', 'document.querySelector(".hw-inbox-list button, .hw-inbox-list table")');
    ck(!(await p.evaluate('!!document.querySelector("dialog[open]")')), 'lector: ?crear=1 no abre registro manual');
    await noWrites('lector: ninguna escritura por URL');
  }

  console.log('\n== COTIZACIONES CONSERVADAS');
  for (const token of ['tk-coord', 'tk-gerente', 'tk-lector']) {
    await clean();
    const p = await restore(token, '/admin/dashboard?section=cotizaciones', 'document.querySelector(".hp-table tbody tr")');
    await p.click('main .hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog[open]")', 'detalle');
    const editable = token !== 'tk-lector';
    ck(await has(p, 'Nueva cotización') === editable && await has(p, 'Editar borrador', 'dialog[open]') === editable && await has(p, 'Enviar por correo', 'dialog[open]') === editable, token + ': cotización conserva permisos');
    await noWrites(token + ': consultar cotización no escribe');
  }

  // Cobertura conservada de la versión anterior del smoke: atención y cotizaciones siguen en el panel.
  console.log('\n== ATENCIÓN Y COTIZACIONES: DETALLE POR PERMISOS');
  await clean();
  {
    let p = await restore('tk-sec', '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck(await has(p, 'Iniciar atención') && !(await has(p, 'Eliminar consulta')) && !(await has(p, 'Preparar cotización')), 'secretaria: cambia el estado, sin eliminar consultas ni preparar cotizaciones');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=cotizaciones', 'document.querySelector(".hp-table tbody tr")');
    await p.click('main .hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog[open]")', 'detalle de la cotización');
    ck(await has(p, 'Preparar copia', 'dialog[open]') && await has(p, 'Marcar anulada', 'dialog[open]'), 'coordinadora: cotización con copiar y anular');
    await noWrites('coordinadora: abrir la cotización no escribe');
  }
  await clean();
  {
    let p = await restore('tk-lector', '/admin/dashboard?section=cotizaciones', 'document.querySelector(".hp-table tbody tr")');
    ck(!(await has(p, 'Nueva cotización')) && await readonlyNotice(p), 'lector: Cotizaciones sin «Nueva cotización» y con aviso de consulta');
    await p.click('main .hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog[open]")', 'detalle');
    ck(!(await has(p, 'Editar borrador', 'dialog[open]')) && !(await has(p, 'Preparar copia', 'dialog[open]')) && !(await has(p, 'Marcar', 'dialog[open]')) && await has(p, 'Ver datos del formulario', 'dialog[open]'), 'lector: el detalle solo ofrece imprimir y ver los datos');
    await p.click('dialog[open] button', 'Ver datos del formulario'); await p.wait('document.querySelector("dialog[open] form fieldset")', 'datos de la cotización');
    ck(await p.evaluate('document.querySelector("dialog[open] form fieldset").disabled') && !(await has(p, 'Guardar borrador', 'dialog[open]')), 'lector: los datos se muestran sin poder guardarlos');
    await closePages();
    p = await restore('tk-lector', '/admin/dashboard?section=cotizaciones&contacto=71', 'document.querySelector(".hp-table tbody tr")');
    ck(!(await dialogOpen(p)) && (await p.text('main')).includes('no puede crear cotizaciones') && (await calls('tk-lector', 'messages/71')).length === 0, 'lector: ?contacto= sin cotizaciones:crear no abre el formulario ni consulta la consulta de origen');
    await closePages();
    p = await restore('tk-lector', '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck(!(await has(p, 'Iniciar atención')) && !(await has(p, 'Marcar atendido')) && !(await has(p, 'Eliminar consulta')) && !(await has(p, 'Preparar cotización')) && !(await has(p, 'Reenviar constancia')) && await p.evaluate('!!document.querySelector(".hw-inbox-detail [data-panel-readonly]")'), 'lector: Mensajes sin cambios de estado, eliminar, cotizar ni correos');
    await submit(p, '.hw-inbox-detail form'); await sleep(300);
    ck((await calls('tk-lector', 'seguimiento')).every(r => r.method === 'GET'), 'lector: Enter en el seguimiento no hace PUT');
    await closePages();
    p = await restore('tk-lector', '/admin/messages?crear=1', 'document.querySelector(".hw-inbox-list button, .hw-inbox-list table")');
    ck((await p.text('main')).includes('no puede registrar consultas'), 'lector: ?crear=1 explica que no puede registrar consultas');
    ck((await writes()).length === 0, 'lector: ninguna solicitud de escritura', await writes());
  }

  console.log('\n== NAVEGACIÓN HEREDADA EN ATENCIÓN');
  for (const [token, me, who] of [['tk-gerente', 'nuevo', 'gerente'], ['tk-sec', 'antiguo', 'backend antiguo'], ['tk-norol', 'nuevo', 'cuenta sin rol en modo heredado']]) {
    await clean('heredado'); await ctl('me', me);
    const p = await restore(token, '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck(await has(p, 'Eliminar consulta') && await has(p, 'Preparar cotización') && await has(p, 'Registro manual'), who + ': Mensajes con eliminar, preparar cotización y registro manual');
    ck((await writes()).length === 0, who + ': ninguna solicitud de escritura', await writes());
  }

  console.log('\n== OPERACIONES PERMITIDAS (la solicitud llega al servidor)');
  await clean();
  {
    let p = await restore('tk-coord', '/admin/dashboard?section=cotizaciones', 'document.querySelector(".hp-table tbody tr")');
    await p.click('main .hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog[open]")', 'detalle de la cotización');
    await p.click('dialog[open] button', 'Marcar anulada');
    ck((await sent('tk-coord', 'POST', '/api/admin/cotizaciones/61/estado', 'anular cotización')).body?.estado === 'anulada', 'coordinadora: «Marcar anulada» envía POST /admin/cotizaciones/61/estado (cotizaciones:anular)');
    await closePages();
    p = await restore('tk-sec', '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    await p.click('main .hw-next-action button', 'Iniciar atención');
    ck((await sent('tk-sec', 'PUT', '/api/admin/seguimiento/messages/71', 'cambiar estado')).body?.estado === 'en_proceso', 'secretaria: «Iniciar atención» envía PUT /admin/seguimiento/messages/71 (seguimiento_mensajes:editar)');
    const unexpected = (await writes()).filter(r => !['tk-coord', 'tk-sec'].includes(r.token) || r.method === 'DELETE');
    ck(unexpected.length === 0, 'ninguna escritura distinta de las permitidas de esta sección', unexpected);
  }

  console.log('\n== ACCESOS DEL RESUMEN');
  for (const token of ['tk-gerente', 'tk-coord', 'tk-lector', 'tk-resumen']) {
    await clean();
    const p = await restore(token, '/admin/dashboard', 'document.querySelector(".hp-operational-hero")');
    const creates = token === 'tk-gerente' || token === 'tk-coord';
    ck(await has(p, 'Registrar estudiante') === creates && await has(p, 'Crear edición') === creates && await has(p, 'Registrar matrícula') === creates, token + ': accesos académicos filtrados');
    ck(!(await has(p, 'Crear un curso')) && !(await has(p, 'Nuevo servicio')), token + ': sin accesos editoriales');
    if (token === 'tk-resumen') ck(!(await has(p, 'Atender consultas')) && !(await p.evaluate('!!document.querySelector(".hp-activity-card, .hp-activity")')), 'solo estadísticas: no monta actividad ni enlaza atención');
    await noWrites(token + ': resumen solo lectura');
  }
  await closePages();
  k.finish('Operaciones del panel académico y de atención');
})().catch(error => { console.error('FALLO DEL SMOKE:', error.message); process.exit(1); });
