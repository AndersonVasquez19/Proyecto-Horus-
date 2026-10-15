// Operaciones del panel según los permisos (H-BACK-01, E3.4.3, fase 2) con API simulada: nada real (ni cuentas, ni datos, ni correo).
// Edge por DevTools (smoke-kit.cjs, sin cambios). Cubre: botones de crear, editar, duplicar, eliminar o archivar, recuperar contenido
// original, publicar convenios, enviar y anular cotizaciones, registrar, cambiar de estado, eliminar y responder consultas; secciones en
// modo consulta (Información de empresa, Cursos de la secretaria, una cuenta solo lectora); direcciones ?crear=1 y ?contacto= sin permiso;
// «archivado» sin permiso de archivar; Enter (envío del formulario) sin permiso; enlaces cruzados del Resumen y de la bandeja; navegación
// heredada intacta (gerente, backend antiguo y cuenta sin rol en modo heredado). En los casos denegados no debe salir ninguna solicitud
// de escritura; en la sección 6, las operaciones permitidas sí deben llegar al servidor simulado (que responde con error: nada se guarda).
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
  if (sub === 'stats') return json({ ok: true, stats: { mensajes: { total: 1, nuevos: 1, enProceso: 0, atendidos: 0, archivados: 0 }, contenido: { total: 0 }, catalogo: {} }, actividadReciente: { mensajes: [MESSAGE] } }) || true;
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
  const writes = async () => (await requests()).filter(r => r.method !== 'GET');
  const calls = async (token, prefix) => (await requests()).filter(r => r.token === token && r.route.startsWith('/api/admin/' + prefix));
  const clean = async (mode = 'heredado') => { await closePages(); await ctl('clear'); await ctl('mode', mode); const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.clear(); sessionStorage.clear(); 1'); await closePages(); };
  const PANEL = "/^\\/admin\\/(dashboard|messages)$/.test(location.pathname) && document.querySelector('.hp-sidebar')";
  const restore = async (token, route, ready) => {
    const p = await open(); await p.go('/__empty'); await p.evaluate('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(token) + '); 1');
    await p.go(route); await p.wait(PANEL, 'panel (' + route + ')'); if (ready) await p.wait(ready, 'contenido de ' + route); await sleep(400); return p;
  };
  // ¿Hay un botón o enlace visible cuyo texto (o aria-label) contenga `text` dentro de `scope`?
  const has = (p, text, scope = 'main') => p.evaluate('[...document.querySelectorAll(' + JSON.stringify(scope + ' button, ' + scope + ' a') + ')].some(b => (b.textContent + " " + (b.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").includes(' + JSON.stringify(text) + '))');
  const readonlyNotice = p => p.evaluate('!!document.querySelector("main [data-panel-readonly]")');
  const dialogOpen = p => p.evaluate('!!document.querySelector("dialog[open]")');
  const dialogForm = p => p.evaluate('!!document.querySelector("dialog[open] form")');
  // Envía el formulario como lo haría Enter (evento submit, sin depender de la validación del navegador).
  const submit = (p, selector) => p.evaluate('(() => { const f = document.querySelector(' + JSON.stringify(selector) + '); if (!f) return false; f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return true; })()');
  const estadoOptions = p => p.evaluate('[...(document.querySelector("dialog[open] #field-estado")?.options || [])].map(o => o.value)');
  const CAPACITACIONES = '/admin/dashboard?section=educacion&seccion=capacitaciones';
  const CARDS = 'document.querySelector(".hw-resource, .hp-table tbody tr")';

  // ===== 1. Secretaria: Cursos e Información de empresa en modo consulta =====
  console.log('\n== SECRETARIA (modo heredado y por_roles)');
  for (const mode of ['heredado', 'por_roles']) {
    const who = 'secretaria (' + mode + ')';
    await clean(mode);
    let p = await restore('tk-sec', CAPACITACIONES, CARDS);
    ck(!(await has(p, 'Crear capacitación')) && (await readonlyNotice(p)), who + ': Capacitaciones sin «Crear» y con aviso de modo consulta');
    ck(!(await has(p, 'Editar')) && !(await has(p, 'Duplicar')) && !(await has(p, 'Eliminar')) && !(await has(p, 'Recuperar contenido original')), who + ': sin Editar, Duplicar, Eliminar ni «Recuperar contenido original» en las tarjetas');
    await p.click('main .hw-resource footer button', 'Ver detalle'); await p.wait('document.querySelector("dialog[open]")', 'detalle del curso');
    ck(!(await dialogForm(p)) && !(await has(p, 'Editar registro', 'dialog[open]')), who + ': «Ver detalle» abre la ficha sin formulario ni «Editar registro»');
    await p.click('dialog[open] button', 'Cerrar'); await sleep(200);
    await p.click('main .hw-tabs button', 'Tabla'); await p.wait('document.querySelector(".hp-table tbody tr")', 'tabla');
    ck((await has(p, 'Ver Curso ficticio')) && !(await has(p, 'Editar Curso ficticio')) && !(await has(p, 'Eliminar Curso ficticio')), who + ': en la tabla solo queda «Ver»');
    await closePages();
    p = await restore('tk-sec', CAPACITACIONES + '&vista=agenda', 'document.querySelector(".hw-timeline button")');
    await p.click('main .hw-timeline button', 'Curso ficticio'); await p.wait('document.querySelector("dialog[open]")', 'ficha desde la agenda');
    ck(!(await dialogForm(p)), who + ': la agenda abre el curso en modo consulta');
    await closePages();
    p = await restore('tk-sec', '/admin/dashboard?section=educacion&seccion=cursos&crear=1', CARDS);
    ck(!(await dialogOpen(p)) && (await p.text('main')).includes('no puede crear registros'), who + ': ?crear=1 no abre el formulario y explica por qué', await p.text('main [data-panel-readonly]'));
    await closePages();
    p = await restore('tk-sec', '/admin/dashboard?section=ajustes', 'document.querySelector("main form input")');
    ck((await p.evaluate('[...document.querySelectorAll("main form input")].every(i => i.matches(":disabled"))')) && !(await has(p, 'Guardar configuración')) && !(await has(p, 'Restablecer cambios')) && (await readonlyNotice(p)), who + ': Información de empresa en modo consulta (campos deshabilitados, sin Guardar ni Restablecer)');
    await submit(p, 'main form'); await sleep(400);
    ck((await calls('tk-sec', 'settings')).every(r => r.method === 'GET') && (await p.text('main')).includes('no tiene permiso'), who + ': enviar el formulario (Enter) no hace PUT /admin/settings');
    await closePages();
    p = await restore('tk-sec', '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck((await has(p, 'Registro manual')) && (await has(p, 'Iniciar atención')) && (await has(p, 'Guardar seguimiento')) && (await has(p, 'Enviar respuesta guardada')), who + ': en Mensajes conserva el registro manual, los cambios de estado, el seguimiento y el envío de la respuesta');
    ck(!(await has(p, 'Eliminar consulta')) && !(await has(p, 'Preparar cotización')), who + ': sin «Eliminar consulta…» (mensajes:eliminar) ni «Preparar cotización» (sin Cotizaciones)');
    await closePages();
    p = await restore('tk-sec', '/admin/messages?crear=1', 'document.querySelector("dialog[open] form")');
    ck(await has(p, 'Registrar consulta', 'dialog[open]'), who + ': ?crear=1 abre el registro manual (tiene mensajes:crear)');
    ck((await writes()).length === 0, who + ': ninguna solicitud de escritura', await writes());
  }

  // ===== 2. Coordinadora: gestiona contenido salvo lo que no le corresponde =====
  console.log('\n== COORDINADORA');
  await clean();
  { let p = await restore('tk-coord', CAPACITACIONES, CARDS);
    ck((await has(p, 'Crear capacitación')) && (await has(p, 'Editar')) && (await has(p, 'Duplicar Curso ficticio')) && !(await readonlyNotice(p)), 'Capacitaciones: crear, editar y duplicar disponibles');
    ck(!(await has(p, 'Eliminar Curso ficticio')) && !(await has(p, 'Recuperar contenido original')), 'sin borrado definitivo (cursos:eliminar) ni «Recuperar contenido original» (contenido_original:*)');
    await p.click('main .hw-resource footer button', 'Editar'); await p.wait('document.querySelector("dialog[open] #field-estado")', 'formulario del curso');
    ck((await estadoOptions(p)).includes('archivado'), 'con cursos:archivar el estado ofrece «Archivado»', await estadoOptions(p));
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=servicios', CARDS);
    ck((await has(p, 'Crear servicio')) && (await has(p, 'Editar')) && !(await has(p, 'Eliminar Servicio ficticio')), 'Servicios: crear y editar, sin eliminar (servicios:eliminar)');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=faq', 'document.querySelector(".hw-faq details")');
    ck((await has(p, 'Editar respuesta')) && (await has(p, 'Archivar')), 'Preguntas frecuentes: editar y archivar');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=galeria', CARDS);
    ck((await has(p, 'Crear imagen')) && (await has(p, 'Eliminar Imagen ficticia')), 'Galería: crear y eliminar');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=convenios', 'document.querySelector(".hp-table tbody tr")');
    ck((await has(p, 'Nuevo convenio')) && (await has(p, 'Editar Convenio ficticio')) && (await has(p, 'Ocultar')) && (await has(p, 'Eliminar Convenio ficticio')), 'Convenios: nuevo, editar, ocultar y eliminar');
    await closePages();
    p = await restore('tk-coord', '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck((await has(p, 'Preparar cotización')) && !(await has(p, 'Eliminar consulta')), 'Mensajes: «Preparar cotización» sí; «Eliminar consulta…» no (mensajes:eliminar es del gerente)');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=ajustes', 'document.querySelector("main form input")');
    ck(!(await has(p, 'Guardar configuración')) && (await readonlyNotice(p)), 'Información de empresa: modo consulta (configuracion:editar es del gerente)');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=cotizaciones', 'document.querySelector(".hp-table tbody tr")');
    await p.click('main .hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog[open]")', 'detalle de la cotización');
    ck((await has(p, 'Nueva cotización')) && (await has(p, 'Editar borrador', 'dialog[open]')) && (await has(p, 'Preparar copia', 'dialog[open]')) && (await has(p, 'Enviar por correo', 'dialog[open]')) && (await has(p, 'Marcar anulada', 'dialog[open]')), 'Cotizaciones: crear, editar, copiar, enviar y anular');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard', 'document.querySelector(".hp-hero")');
    { const seen = { curso: await has(p, 'Crear un curso'), servicio: await has(p, 'Nuevo servicio'), cotizaciones: await has(p, 'Ir a cotizaciones') };
      ck(seen.curso && seen.servicio && seen.cotizaciones, 'Resumen: accesos de creación y enlaces disponibles', seen); }
    ck((await writes()).length === 0, 'coordinadora: ninguna solicitud de escritura', await writes()); }

  // ===== 3. Navegación heredada intacta =====
  console.log('\n== GERENTE, BACKEND ANTIGUO Y CUENTA SIN ROL (HEREDADO)');
  for (const [token, me, who] of [['tk-gerente', 'nuevo', 'gerente'], ['tk-sec', 'antiguo', 'backend antiguo'], ['tk-norol', 'nuevo', 'cuenta sin rol en modo heredado']]) {
    await clean(); await ctl('me', me);
    let p = await restore(token, CAPACITACIONES, CARDS);
    ck((await has(p, 'Crear capacitación')) && (await has(p, 'Editar')) && (await has(p, 'Eliminar Curso ficticio')) && (await has(p, 'Recuperar contenido original')) && !(await readonlyNotice(p)), who + ': Capacitaciones con todas sus acciones, como antes');
    await closePages();
    p = await restore(token, '/admin/dashboard?section=ajustes', 'document.querySelector("main form input")');
    ck((await has(p, 'Guardar configuración')) && (await p.evaluate('!document.querySelector("main form input").matches(":disabled")')), who + ': Información de empresa editable');
    await closePages();
    p = await restore(token, '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck((await has(p, 'Eliminar consulta')) && (await has(p, 'Preparar cotización')) && (await has(p, 'Registro manual')), who + ': Mensajes con eliminar, preparar cotización y registro manual');
    ck((await writes()).length === 0, who + ': ninguna solicitud de escritura', await writes());
  }

  // ===== 4. Cuenta solo lectora: todo en modo consulta =====
  console.log('\n== CUENTA SOLO LECTORA (por_roles)');
  await clean('por_roles');
  { let p = await restore('tk-lector', '/admin/dashboard', 'document.querySelector(".hp-hero")');
    { const seen = { curso: await has(p, 'Crear un curso'), atajos: await p.evaluate('!!document.querySelector(".hp-shortcuts")'), mensajes: await has(p, 'Ir a mensajes'), cotizaciones: await has(p, 'Ir a cotizaciones') };
      ck(!seen.curso && !seen.atajos && seen.mensajes && seen.cotizaciones, 'Resumen: sin accesos de creación; conserva los enlaces a secciones que puede abrir', seen); }
    await closePages();
    p = await restore('tk-lector', '/admin/dashboard?section=galeria', CARDS);
    ck(!(await has(p, 'Crear imagen')) && !(await has(p, 'Eliminar')) && (await readonlyNotice(p)), 'Galería en modo consulta');
    await closePages();
    p = await restore('tk-lector', '/admin/dashboard?section=convenios', 'document.querySelector(".hp-table tbody tr")');
    ck(!(await has(p, 'Nuevo convenio')) && (await has(p, 'Ver Convenio ficticio')) && !(await has(p, 'Ocultar')) && !(await has(p, 'Eliminar Convenio')) && (await readonlyNotice(p)), 'Convenios: solo «Ver», sin nuevo, publicar/ocultar ni eliminar');
    await p.click('main .hp-table button', 'Ver'); await p.wait('document.querySelector("dialog[open] fieldset")', 'detalle del convenio');
    ck((await p.evaluate('document.querySelector("dialog[open] fieldset").disabled')) && !(await has(p, 'Guardar convenio', 'dialog[open]')) && !(await has(p, 'Quitar fotografía', 'dialog[open]')) && !(await has(p, 'Subir', 'dialog[open]')) && (await p.text('dialog[open]')).includes('Detalle del convenio'), 'el convenio se abre en modo consulta: sin guardar, subir ni quitar fotografías');
    await submit(p, 'dialog[open] form'); await sleep(300);
    ck((await calls('tk-lector', 'convenios')).every(r => r.method === 'GET'), 'enviar el formulario del convenio (Enter) no hace ninguna escritura');
    await closePages();
    p = await restore('tk-lector', '/admin/dashboard?section=cotizaciones', 'document.querySelector(".hp-table tbody tr")');
    ck(!(await has(p, 'Nueva cotización')) && (await readonlyNotice(p)), 'Cotizaciones: sin «Nueva cotización»');
    await p.click('main .hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog[open]")', 'detalle');
    ck(!(await has(p, 'Editar borrador', 'dialog[open]')) && !(await has(p, 'Preparar copia', 'dialog[open]')) && !(await has(p, 'Enviar por correo', 'dialog[open]')) && !(await has(p, 'Marcar', 'dialog[open]')) && (await has(p, 'Ver datos del formulario', 'dialog[open]')), 'el detalle solo ofrece imprimir y ver los datos');
    await p.click('dialog[open] button', 'Ver datos del formulario'); await p.wait('document.querySelector("dialog[open] form fieldset")', 'datos de la cotización');
    ck((await p.evaluate('document.querySelector("dialog[open] form fieldset").disabled')) && !(await has(p, 'Guardar borrador', 'dialog[open]')), 'los datos se muestran sin poder guardarlos');
    await closePages();
    p = await restore('tk-lector', '/admin/dashboard?section=cotizaciones&contacto=71', 'document.querySelector(".hp-table tbody tr")');
    ck(!(await dialogOpen(p)) && (await p.text('main')).includes('no puede crear cotizaciones') && (await calls('tk-lector', 'messages/71')).length === 0, '?contacto= sin cotizaciones:crear: no abre el formulario ni consulta la consulta de origen');
    await closePages();
    p = await restore('tk-lector', '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    ck(!(await has(p, 'Registro manual')) && !(await has(p, 'Iniciar atención')) && !(await has(p, 'Marcar atendido')) && !(await has(p, 'Eliminar consulta')) && !(await has(p, 'Preparar cotización')), 'Mensajes: sin registro manual, cambios de estado, eliminar ni preparar cotización');
    ck((await p.evaluate('document.querySelector(".hw-inbox-detail form fieldset").disabled')) && !(await has(p, 'Guardar seguimiento')) && !(await has(p, 'Enviar respuesta guardada')) && !(await has(p, 'Reenviar constancia')) && (await p.evaluate('!!document.querySelector(".hw-inbox-detail [data-panel-readonly]")')), 'el seguimiento se muestra en modo consulta, sin guardar ni enviar correos');
    await submit(p, '.hw-inbox-detail form'); await sleep(300);
    ck((await calls('tk-lector', 'seguimiento')).every(r => r.method === 'GET'), 'enviar el formulario del seguimiento (Enter) no hace PUT');
    await closePages();
    p = await restore('tk-lector', '/admin/messages?crear=1', 'document.querySelector(".hw-inbox-list button, .hw-inbox-list table")');
    ck(!(await dialogOpen(p)) && (await p.text('main')).includes('no puede registrar consultas'), '?crear=1 en Mensajes sin mensajes:crear: no abre el registro manual');
    ck((await writes()).length === 0, 'cuenta solo lectora: ninguna solicitud de escritura', await writes()); }

  // ===== 4b. Enlaces cruzados del Resumen hacia secciones sin permiso =====
  console.log('\n== RESUMEN SIN MENSAJES NI COTIZACIONES');
  await clean('por_roles');
  { const p = await restore('tk-resumen', '/admin/dashboard', 'document.querySelector(".hp-activity-card .hp-quotes-chart")');
    const seen = { mensajes: await has(p, 'Ir a mensajes'), todas: await has(p, 'Ver todas'), cotizaciones: await has(p, 'Ir a cotizaciones'), curso: await has(p, 'Crear un curso'), atajos: await p.evaluate('!!document.querySelector(".hp-shortcuts")'),
      bandeja: await p.evaluate('!!document.querySelector(".hw-work a[href^=\\"/admin/messages\\"]")'), agenda: await p.evaluate('!!document.querySelector(".hw-work a[href*=\\"vista=agenda\\"]")'),
      reciente: await p.evaluate('[...document.querySelectorAll(".hp-activity button")].every(b => b.disabled)'), servicios: await p.evaluate('[...document.querySelectorAll(".hp-distribution-row")].find(b => b.textContent.includes("Servicios")).disabled') };
    ck(!seen.mensajes && !seen.todas && !seen.cotizaciones && !seen.curso && !seen.atajos && !seen.bandeja && seen.agenda && seen.reciente && seen.servicios,
      'sin Mensajes ni Cotizaciones: no se ofrecen sus enlaces (ni crear); la agenda de cursos sí; consultas recientes y Servicios quedan deshabilitados', seen); }

  // ===== 5. Editar sin archivar =====
  console.log('\n== EDITAR SIN PERMISO DE ARCHIVAR');
  await clean('por_roles');
  { const p = await restore('tk-editor', CAPACITACIONES, CARDS);
    ck(!(await has(p, 'Crear capacitación')) && (await has(p, 'Editar')) && !(await has(p, 'Duplicar')) && !(await has(p, 'Eliminar')) && !(await readonlyNotice(p)), 'con cursos:editar solo se ofrece editar');
    await p.evaluate('[...document.querySelectorAll("main .hw-resource")].find(c => c.textContent.includes("Curso ficticio")).querySelector("footer button").click(); 1');
    await p.wait('document.querySelector("dialog[open] #field-estado")', 'formulario');
    ck(!(await estadoOptions(p)).includes('archivado') && (await estadoOptions(p)).includes('publicado'), 'sin cursos:archivar el estado no ofrece «Archivado»', await estadoOptions(p));
    await p.click('dialog[open] button', 'Cancelar'); await sleep(300);
    await p.evaluate('[...document.querySelectorAll("main .hw-resource")].find(c => c.textContent.includes("Curso archivado")).querySelector("footer button").click(); 1');
    await p.wait('document.querySelector("dialog[open] #field-estado")', 'formulario del curso archivado');
    ck((await estadoOptions(p)).includes('archivado'), 'un curso ya archivado muestra su estado');
    await submit(p, 'dialog[open] form'); await p.wait('document.querySelector("dialog[open] [role=alert]")', 'aviso');
    ck((await p.text('dialog[open] [role=alert]')).includes('no puede guardar registros archivados') && (await writes()).length === 0, 'guardarlo como «archivado» se detiene con un aviso y sin PUT', await p.text('dialog[open] [role=alert]')); }

  // ===== 6. Operaciones permitidas: la solicitud sí sale =====
  // Que no salga nada en los casos denegados no prueba que una cuenta autorizada pueda guardar. Aquí cada operación permitida debe
  // llegar al servidor simulado con su método, ruta y cuerpo. El simulador sigue respondiendo con error: no se simula éxito.
  console.log('\n== OPERACIONES PERMITIDAS (la solicitud llega al servidor)');
  const sent = async (token, method, route, what) => {
    const end = Date.now() + 5000;
    while (Date.now() < end) { const hit = (await requests()).find(r => r.token === token && r.method === method && r.route === route); if (hit) return hit; await sleep(100); }
    throw new Error('No llegó ' + method + ' ' + route + ' (' + what + '). Escrituras: ' + JSON.stringify(await writes()));
  };
  const editCourse = async (p, title) => {
    await p.evaluate('[...document.querySelectorAll("main .hw-resource")].find(c => c.textContent.includes(' + JSON.stringify(title) + ')).querySelector("footer button").click(); 1');
    await p.wait('document.querySelector("dialog[open] #field-estado")', 'formulario de ' + title);
  };
  await clean('por_roles');
  { let p = await restore('tk-gerente', '/admin/dashboard?section=ajustes', 'document.querySelector("main form input")');
    await submit(p, 'main form');
    ck((await sent('tk-gerente', 'PUT', '/api/admin/settings', 'guardar configuración')).body?.ajustes?.empresa_nombre === 'Horus ficticio', 'gerente: «Guardar configuración» envía PUT /admin/settings (configuracion:editar)');
    await closePages();
    p = await restore('tk-coord', CAPACITACIONES, CARDS); await editCourse(p, 'Curso ficticio');
    await p.type('dialog[open] #field-estado', 0, 'archivado'); await submit(p, 'dialog[open] form');
    ck((await sent('tk-coord', 'PUT', '/api/admin/cursos/11', 'archivar curso')).body?.estado === 'archivado', 'coordinadora: con cursos:editar y cursos:archivar guarda un curso como «archivado» (PUT /admin/cursos/11)');
    await closePages();
    p = await restore('tk-editor', CAPACITACIONES, CARDS); await editCourse(p, 'Curso ficticio'); await submit(p, 'dialog[open] form');
    ck((await sent('tk-editor', 'PUT', '/api/admin/cursos/11', 'editar curso')).body?.estado === 'publicado', 'solo cursos:editar: guardar un curso publicado no se bloquea (PUT sin archivar)');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=convenios', 'document.querySelector(".hp-table tbody tr")');
    await p.click('main .hp-table button', 'Ocultar');
    ck((await sent('tk-coord', 'PUT', '/api/admin/convenios/51', 'ocultar convenio')).body?.visible === false, 'coordinadora: «Ocultar» envía PUT /admin/convenios/51 (convenios:editar)');
    await closePages();
    p = await restore('tk-coord', '/admin/dashboard?section=cotizaciones', 'document.querySelector(".hp-table tbody tr")');
    await p.click('main .hp-table button', 'Ver propuesta'); await p.wait('document.querySelector("dialog[open]")', 'detalle de la cotización');
    await p.click('dialog[open] button', 'Marcar anulada');
    ck((await sent('tk-coord', 'POST', '/api/admin/cotizaciones/61/estado', 'anular cotización')).body?.estado === 'anulada', 'coordinadora: «Marcar anulada» envía POST /admin/cotizaciones/61/estado (cotizaciones:anular)');
    await closePages();
    p = await restore('tk-sec', '/admin/messages?id=71', 'document.querySelector(".hw-inbox-detail form textarea")');
    await p.click('main .hw-next-action button', 'Iniciar atención');
    ck((await sent('tk-sec', 'PUT', '/api/admin/seguimiento/messages/71', 'cambiar estado')).body?.estado === 'en_proceso', 'secretaria: «Iniciar atención» envía PUT /admin/seguimiento/messages/71 (seguimiento_mensajes:editar)');
    const unexpected = (await writes()).filter(r => !['tk-gerente', 'tk-coord', 'tk-editor', 'tk-sec'].includes(r.token) || r.route.includes('/eliminar') || r.method === 'DELETE');
    ck(unexpected.length === 0, 'ninguna escritura distinta de las permitidas de esta sección', unexpected); }

  k.finish('Operaciones del panel por permisos');
})().catch(error => { console.error('FALLO DEL SMOKE:', error.message); process.exit(1); });
