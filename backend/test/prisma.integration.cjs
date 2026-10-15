require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { connect, prisma } = require('../scripts/database.cjs');
const { check } = require('../scripts/check-database.cjs');
const { ConfigService } = require('@nestjs/config');
const { CatalogoService } = require('../dist/catalogo/catalogo.service');
const { CotizacionesService } = require('../dist/cotizaciones/cotizaciones.service');
const { ChatbotService } = require('../dist/chatbot/chatbot.service');
const { AdminReclamacionesService } = require('../dist/admin/reclamaciones/admin-reclamaciones.service');
const { GaleriaService } = require('../dist/galeria/galeria.service');
const { ItemsService } = require('../dist/admin/items/items.service');
const { MessagesService } = require('../dist/admin/messages/messages.service');
const { NewsletterService } = require('../dist/newsletter/newsletter.service');
const { SettingsService } = require('../dist/settings/settings.service');
const { AuthService } = require('../dist/admin/auth/auth.service');
const { JwtService } = require('@nestjs/jwt');
const { NestFactory } = require('@nestjs/core');

test('Prisma works against MySQL and legacy-compatible SQL in an isolated database', async t => {
  const local = ['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST || 'localhost');
  if (!local && process.env.ALLOW_INTEGRATION_DB !== 'true') throw new Error('La integración requiere MySQL local o un destino de pruebas autorizado con ALLOW_INTEGRATION_DB=true.');
  const db = await connect();
  const originalName = process.env.DB_NAME;
  const name = 'horus_prisma_test_' + randomUUID().replaceAll('-', '');
  assert.match(name, /^horus_prisma_test_[a-f0-9]{32}$/);
  let client, created = false;
  function script(file) {
    const result = spawnSync(process.execPath, ['scripts/' + file], { cwd: require('node:path').join(__dirname, '..'), env: process.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  try {
    await db.query('CREATE DATABASE ' + name + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    created = true;
    process.env.DB_NAME = name;
    script('init-database.cjs');
    script('migrate.cjs');
    script('migrate.cjs');
    await db.query('USE ' + name);
    assert.deepEqual(await check(db), []);
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM horus_migrations');
    assert.equal(total, require('../scripts/migrate.cjs').versions.length);
    client = prisma();
    const catalog = new CatalogoService(client);
    // E3.6: AppModule registra AccessGuard, así que las cuentas ficticias necesitan un rol explícito para operar. Se asigna como
    // admin:assign-role (rol y session_version + 1, que revoca la sesión anterior) y se emite una sesión NUEVA con el login real.
    async function withRole(app, account, rol, password) {
      await client.adminUser.update({ where: { id: account.user.id }, data: { rol, session_version: { increment: 1 } } });
      const session = await app.get(AuthService).login({ email: account.user.email, password });
      assert.equal(session.user.rol, rol);
      assert.equal(session.acceso.modo, 'por_roles');
      return { ...session, user: { ...account.user, ...session.user } };
    }
    await t.test('Nest modules initialize with the shared Prisma provider', async () => {
      const { AppModule } = require('../dist/app.module');
      const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
      try {
        const { PrismaService } = require('../dist/database/prisma.service');
        const [row] = await app.get(PrismaService).$queryRawUnsafe('SELECT DATABASE() AS name');
        assert.equal(row.name, name);
      } finally { await app.close(); }
    });

    await t.test('courses and capacitaciones survive HTTP and direct DELETE, archive through PUT and republish with the same identity', async () => {
      const { AppModule } = require('../dist/app.module');
      const { createValidationPipe } = require('../dist/common/validation');
      const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'horus-course-conservation-'));
      const imageName = randomUUID() + '.png';
      const image = path.join(directory, imageName);
      fs.writeFileSync(image, 'synthetic course image');
      const previousUploadDir = process.env.UPLOAD_DIR;
      process.env.UPLOAD_DIR = directory;
      const ids = [];
      let app, auth, faqId, serviceId;
      try {
        app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
        app.setGlobalPrefix('api'); app.useGlobalPipes(createValidationPipe());
        await app.listen(0, '127.0.0.1');
        const origin = await app.getUrl();
        auth = await app.get(AuthService).register({ nombre: 'Conservación test', email: 'conservacion@example.test', password: 'Temporary-test-123!' }, null);
        const unassigned = auth.token;
        auth = await withRole(app, auth, 'GERENTE_GENERAL', 'Temporary-test-123!');
        assert.equal((await fetch(origin + '/api/admin/cursos', { headers: { Authorization: 'Bearer ' + unassigned } })).status, 401, 'la asignación revoca el JWT anterior');
        const request = async (route, method = 'GET', body) => {
          const response = await fetch(origin + '/api/' + route, { method, headers: {
            Authorization: 'Bearer ' + auth.token,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          }, ...(body ? { body: JSON.stringify(body) } : {}) });
          return { status: response.status, data: await response.json() };
        };
        for (const tipo of ['curso', 'capacitacion']) {
          const payload = { titulo: 'Conservar ' + tipo, slug: 'conservar-' + tipo, descripcion: 'Contenido histórico', tipo, modalidad: 'virtual', duracion: '2 horas', imagen_url: '/api/uploads/' + imageName, temario: 'Temario conservado', estado: 'borrador' };
          const created = await request('admin/cursos', 'POST', payload);
          assert.equal(created.status, 201);
          const id = created.data.item.id;
          ids.push(id);
          const route = 'admin/cursos/' + id;
          for (const estado of ['borrador', 'publicado', 'archivado']) {
            assert.equal((await request(route, 'PUT', { estado })).status, 200);
            const before = await client.curso.findUnique({ where: { id } });
            assert.equal((await request(route, 'DELETE')).status, 409);
            assert.deepEqual(await client.curso.findUnique({ where: { id } }), before, 'HTTP DELETE leaves every column intact');
            await assert.rejects(() => catalog.remove('cursos', id), e => e.getStatus() === 409);
            assert.deepEqual(await client.curso.findUnique({ where: { id } }), before, 'Direct service call leaves every column intact');
            assert.equal(fs.readFileSync(image, 'utf8'), 'synthetic course image');
            const detail = await request(route);
            assert.equal(detail.status, 200);
            assert.equal(detail.data.item.id, id); assert.equal(detail.data.item.slug, payload.slug);
            assert.equal(detail.data.item.estado, estado);
            assert.equal((await request('cursos/' + id)).status, estado === 'publicado' ? 200 : 404);
            const list = await request('cursos?estado=archivado&search=' + encodeURIComponent(payload.titulo));
            assert.equal(list.data.items.some(x => x.id === id), estado === 'publicado');
            assert.equal((await request('admin/cursos?estado=' + estado + '&tipo=' + tipo)).data.items.some(x => x.id === id), true);
            assert.equal((await request('admin/cursos', 'POST', payload)).status, 409, 'The slug remains reserved in every state');
          }
          assert.equal((await request(route, 'PUT', { estado: 'publicado' })).status, 200);
          const republished = (await request('cursos/' + id)).data.item;
          assert.equal(republished.id, id); assert.equal(republished.slug, payload.slug);
          assert.equal(republished.temario, payload.temario); assert.equal(republished.imagen_url, payload.imagen_url);
        }
        assert.equal((await request('admin/cursos/2147483647', 'DELETE')).status, 404);
        const service = await request('admin/servicios', 'POST', { titulo: 'Servicio desechable', slug: 'servicio-conservacion-test', descripcion: 'Servicio de prueba', categoria: 'soporte', estado: 'publicado' });
        assert.equal(service.status, 201); serviceId = service.data.item.id;
        assert.equal((await request('admin/servicios/' + serviceId, 'DELETE')).status, 200);
        assert.equal(await client.servicio.findUnique({ where: { id: serviceId } }), null);
        const faq = await request('admin/preguntas-frecuentes', 'POST', { pregunta: '¿Pregunta conservada?', respuesta: 'Respuesta de prueba', categoria: 'general', estado: 'publicado' });
        assert.equal(faq.status, 201); faqId = faq.data.item.id;
        const faqBefore = await client.preguntaFrecuente.findUnique({ where: { id: faqId } });
        assert.equal((await request('admin/preguntas-frecuentes/' + faqId, 'DELETE')).status, 200);
        const faqAfter = await client.preguntaFrecuente.findUnique({ where: { id: faqId } });
        assert.equal(faqAfter.estado, 'archivado');
        assert.equal(faqAfter.id, faqBefore.id); assert.equal(faqAfter.respuesta, faqBefore.respuesta);
      } finally {
        await app?.close();
        // Only synthetic fixtures in this suite's disposable database are removed.
        await client.curso.deleteMany({ where: { id: { in: ids } } });
        if (serviceId) await client.servicio.deleteMany({ where: { id: serviceId } });
        if (faqId) await client.preguntaFrecuente.delete({ where: { id: faqId } });
        if (auth) await client.adminUser.delete({ where: { id: auth.user.id } });
        if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploadDir;
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    await t.test('convenios API enforces JWT, visibility, paginated totals, photo ownership, order rollback and cascade', async () => {
      const { AppModule } = require('../dist/app.module');
      const { createValidationPipe } = require('../dist/common/validation');
      const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      app.setGlobalPrefix('api'); app.useGlobalPipes(createValidationPipe());
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const registered = await app.get(AuthService).register({ nombre: 'Convenios test', email: 'convenios-test@example.com', password: 'Temporary-test-123!' });
      // Sin rol solo hay autoservicio: 403 en convenios. La coordinadora gestiona convenios y sus fotos.
      assert.equal((await fetch(origin + '/api/admin/convenios', { headers: { Authorization: 'Bearer ' + registered.token } })).status, 403);
      const auth = await withRole(app, registered, 'COORDINADORA_INSTITUCIONAL', 'Temporary-test-123!');
      const request = async (route, method = 'GET', body, authenticated = false) => {
        const response = await fetch(origin + '/api/' + route, { method, headers: {
          ...(authenticated ? { Authorization: 'Bearer ' + auth.token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, data: await response.json() };
      };
      try {
        assert.equal((await request('admin/convenios')).status, 401);
        assert.equal((await request('admin/convenios', 'POST', { nombre: 'Sin token', descripcion_corta: 'Prueba' })).status, 401);
        const empty = await request('convenios?estado=oculto');
        assert.deepEqual(empty.data.items, []); assert.equal(empty.data.pagination.total, 0);
        assert.equal(await client.convenio.count(), 0, 'Las lecturas no importan contenido');
        const first = await request('admin/convenios', 'POST', { nombre: 'Entidad A', descripcion_corta: 'Descripción A', orden: 10 }, true);
        assert.equal(first.status, 201); assert.equal(first.data.item.visible, false);
        const id = first.data.item.id;
        const second = await request('admin/convenios', 'POST', { nombre: 'Entidad B', descripcion_corta: 'Descripción B', orden: 2, visible: true }, true);
        const otherId = second.data.item.id;
        assert.equal((await request('convenios/' + id)).status, 404);
        assert.equal((await request('convenios?estado=oculto')).data.pagination.total, 1);
        assert.equal((await request('admin/convenios/' + id, 'PUT', {}, true)).status, 400);
        assert.equal((await request('admin/convenios/' + id, 'PUT', { sigla: null }, true)).status, 400);
        assert.equal((await request('admin/convenios/' + id, 'PUT', { visible: 'true' }, true)).status, 400);
        assert.equal((await request('admin/convenios/' + id, 'PUT', { visible: true, descripcion_completa: 'Información completa', informacion_adicional: 'Más información' }, true)).status, 200);
        const page = await request('convenios?page=1&limit=1');
        assert.equal(page.data.items[0].id, otherId); assert.equal(page.data.pagination.total, 2); assert.equal(page.data.pagination.pages, 2);
        assert.equal('origen_local' in page.data.items[0], false);
        const photo = async orden => (await request('admin/convenios/' + id + '/fotos', 'POST', { imagen_url: 'https://example.com/' + orden + '.png', orden }, true)).data.item;
        const p1 = await photo(3), p2 = await photo(1);
        assert.deepEqual((await request('convenios/' + id)).data.item.fotos.map(x => x.id), [p2.id, p1.id]);
        assert.equal((await request('admin/convenios/' + otherId + '/fotos/' + p1.id, 'DELETE', undefined, true)).status, 404);
        assert.equal((await request('admin/convenios/' + id + '/fotos/orden', 'PUT', { fotos: [{ id: p1.id, orden: 0 }, { id: 2147483647, orden: 1 }] }, true)).status, 404);
        assert.equal((await client.convenioFoto.findUnique({ where: { id: p1.id } })).orden, 3, 'Orden fallido revierte la transacción');
        assert.equal((await request('admin/convenios/' + id + '/fotos/orden', 'PUT', { fotos: [{ id: p1.id, orden: 0 }, { id: p2.id, orden: 1 }] }, true)).status, 200);
        assert.deepEqual((await request('convenios/' + id)).data.item.fotos.map(x => x.id), [p1.id, p2.id]);
        assert.equal((await request('admin/convenios/' + id + '/fotos/' + p2.id, 'PUT', { orden: 0 }, true)).status, 200);
        assert.equal((await request('admin/convenios/' + id + '/fotos/' + p2.id, 'DELETE', undefined, true)).status, 200);
        assert.equal((await request('admin/convenios/' + id, 'PUT', { visible: false, logo_url: '', descripcion_completa: '', informacion_adicional: '' }, true)).status, 200);
        assert.equal((await request('convenios/' + id)).status, 404);
        assert.equal((await request('admin/convenios/' + id, 'DELETE', undefined, true)).status, 200);
        assert.equal(await client.convenioFoto.count({ where: { convenio_id: id } }), 0);
        assert.equal((await request('admin/convenios/' + otherId, 'DELETE', undefined, true)).status, 200);
        assert.equal((await request('convenios')).data.pagination.total, 0);
        await client.adminUser.update({ where: { id: auth.user.id }, data: { activo: false } });
        assert.equal((await request('admin/convenios', 'GET', undefined, true)).status, 401);
      } finally { await app.close(); await client.adminUser.delete({ where: { id: auth.user.id } }); }
    });

    await t.test('contenido global persiste tras reiniciar la API y lo ven un administrador nuevo y visitantes sin sesión', async () => {
      const { AppModule } = require('../dist/app.module');
      const { createValidationPipe } = require('../dist/common/validation');
      const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'horus-global-uploads-'));
      const previousUploadDir = process.env.UPLOAD_DIR;
      process.env.UPLOAD_DIR = directory;
      const savedSettings = await client.setting.findMany();
      const adminIds = [], records = [];
      let app;
      const start = async () => {
        app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
        app.setGlobalPrefix('api'); app.useGlobalPipes(createValidationPipe());
        await app.listen(0, '127.0.0.1');
        return app.getUrl();
      };
      let origin;
      const request = async (route, token, method = 'GET', body) => {
        const response = await fetch(origin + '/api/' + route, { method, headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const data = await response.json();
        assert.ok(response.ok, 'Solicitud aislada: ' + route + ' (' + response.status + ')');
        return data;
      };
      const password = 'Global-content-test-123!';
      try {
        origin = await start();
        // El primer administrador se crea por el proceso controlado (servicio/CLI): el registro HTTP exige una sesión.
        assert.equal((await fetch(origin + '/api/admin/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Intruso', email: 'intruso@example.com', password }) })).status, 401);
        const registeredFirst = await app.get(AuthService).register({ nombre: 'Admin global A', email: 'global-a@example.com', password });
        adminIds.push(registeredFirst.user.id);
        const first = await withRole(app, registeredFirst, 'GERENTE_GENERAL', password);
        const form = new FormData();
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQxQAAAAASUVORK5CYII=', 'base64');
        form.append('file', new Blob([png], { type: 'image/png' }), 'global.png');
        const upload = await fetch(origin + '/api/admin/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + first.token }, body: form });
        assert.equal(upload.status, 201);
        const image = '/api' + (await upload.json()).path;
        const entries = [
          ['cursos', { titulo: 'Curso global', slug: 'curso-global', descripcion: 'Contenido global de prueba', tipo: 'curso', modalidad: 'virtual', duracion: '20 horas', estado: 'publicado', imagen_url: image }, 'curso'],
          ['servicios', { titulo: 'Servicio global', slug: 'servicio-global', descripcion: 'Contenido global de prueba', categoria: 'cableado', estado: 'publicado', imagen_url: image }, 'servicio'],
          ['preguntas-frecuentes', { pregunta: 'Pregunta global', respuesta: 'Respuesta global', categoria: 'general', estado: 'publicado' }, 'preguntaFrecuente'],
          ['galeria', { titulo: 'Foto global', categoria: 'global', imagen_url: image, activo: true }, 'galeriaItem'],
          ['convenios', { nombre: 'Convenio global', descripcion_corta: 'Contenido global de prueba', logo_url: image, visible: true }, 'convenio'],
          ['convenios', { nombre: 'Convenio oculto', descripcion_corta: 'Borrador compartido de prueba', visible: false }, 'convenio'],
        ];
        for (const [route, body, model] of entries) {
          const created = (await request('admin/' + route, first.token, 'POST', body)).item;
          records.push([model, created.id]);
        }
        await request('admin/convenios/' + records[4][1] + '/fotos', first.token, 'POST', { imagen_url: image, orden: 0 });
        await request('admin/settings', first.token, 'PUT', { ajustes: { empresa_nombre: 'Empresa global de prueba' } });
        // El segundo administrador se registra después de crear el contenido.
        // Alta autorizada: la hace el primer administrador con su sesión y la cuenta nueva entra por el login normal.
        const created = await request('admin/register', first.token, 'POST', { nombre: 'Admin global B', email: 'global-b@example.com', password });
        assert.equal(created.token, undefined);
        adminIds.push(created.user.id);
        // La cuenta nace sin rol; con el rol de coordinadora (que lee todo lo de esta lista) entra con una sesión nueva.
        const second = await withRole(app, created, 'COORDINADORA_INSTITUCIONAL', password);
        assert.notEqual(first.user.id, second.user.id);
        const lists = ['cursos', 'servicios', 'preguntas-frecuentes', 'galeria', 'convenios', 'settings'];
        const snapshots = {};
        for (const route of lists) {
          snapshots[route] = await request('admin/' + route, first.token);
          assert.deepEqual(await request('admin/' + route, second.token), snapshots[route], 'Ambos administradores ven ' + route);
        }
        assert.equal(snapshots.convenios.pagination.total, 2);
        await app.close(); app = null;
        origin = await start();
        const loggedIn = await request('admin/login', null, 'POST', { email: 'global-b@example.com', password });
        for (const route of lists) assert.deepEqual(await request('admin/' + route, loggedIn.token), snapshots[route], 'Persistencia de ' + route + ' tras reiniciar');
        for (const route of ['cursos', 'servicios', 'preguntas-frecuentes', 'galeria', 'convenios']) {
          const data = await request(route, null);
          assert.equal(data.items.length, 1, 'Visitante ve contenido publicado de ' + route);
        }
        assert.equal((await request('settings', null)).settings.empresa_nombre, 'Empresa global de prueba');
        const detail = await request('convenios/' + records[4][1], null);
        assert.equal(detail.item.fotos[0].imagen_url, image);
        const picture = await fetch(origin + image);
        assert.equal(picture.status, 200);
        assert.deepEqual(Buffer.from(await picture.arrayBuffer()), png);
        const protectedResponse = await fetch(origin + '/api/admin/convenios');
        assert.equal(protectedResponse.status, 401, 'Los visitantes no obtienen permisos administrativos');
      } finally {
        if (app) await app.close();
        for (const [model, id] of records.reverse()) await client[model].delete({ where: { id } });
        await client.setting.deleteMany();
        for (const row of savedSettings) await client.setting.create({ data: row });
        await client.adminUser.deleteMany({ where: { id: { in: adminIds } } });
        if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploadDir;
        if (path.dirname(directory) !== fs.realpathSync(os.tmpdir()) || !path.basename(directory).startsWith('horus-global-uploads-')) throw new Error('Uploads fuera del directorio temporal');
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    await t.test('catalog publication, search, dates, duplicate slug and archive', async () => {
      const { item } = await catalog.create('cursos', { titulo: 'Curso de redes', slug: 'redes', descripcion: 'Redes locales', tipo: 'curso', modalidad: 'virtual', duracion: '20 horas', fecha_inicio: '2026-09-21' });
      assert.equal(item.estado, 'borrador');
      assert.ok(item.createdAt instanceof Date);
      await assert.rejects(() => catalog.detail('cursos', item.id, true), e => e.getStatus() === 404);
      await catalog.update('cursos', item.id, { estado: 'publicado' });
      const result = await catalog.list('cursos', { page: 1, limit: 10, search: 'redes', estado: 'borrador' }, true);
      assert.equal(result.pagination.total, 1);
      assert.equal(result.items[0].fecha_inicio.toISOString(), '2026-09-21T00:00:00.000Z');
      await assert.rejects(() => catalog.create('cursos', { titulo: 'Duplicado', slug: 'redes', descripcion: 'Redes locales', tipo: 'curso', modalidad: 'virtual', duracion: '20 horas' }), e => e.getStatus() === 409);
      const config = { get: () => undefined };
      const chatbot = new ChatbotService(client, config);
      assert.equal((await chatbot.reply({ message: 'curso virtual de redes' })).sources[0].id, 'curso-' + item.id);
      await catalog.archive('cursos', item.id);
      assert.equal((await catalog.list('cursos', { page: 1, limit: 10 }, true)).pagination.total, 0);
    });
    await t.test('CRUD, booleans, settings, subscriptions and authentication', async () => {
      const items = new ItemsService(client);
      const { item } = await items.create({ titulo: 'Prueba', descripcion: 'Contenido' });
      assert.equal((await items.update(item.id, { estado: 'inactivo' })).item.estado, 'inactivo');
      await items.remove(item.id);
      await assert.rejects(() => items.findOne(item.id), e => e.getStatus() === 404);
      const gallery = new GaleriaService(client);
      const { item: picture } = await gallery.create({ titulo: 'Foto', categoria: 'general', imagen_url: '/foto.jpg', activo: false });
      assert.equal((await gallery.findPublic()).items.length, 0);
      assert.equal((await gallery.update(picture.id, { activo: true })).item.activo, true);
      assert.equal((await gallery.findPublic()).items.length, 1);
      const messages = new MessagesService(client);
      const { message } = await messages.create({ nombre: 'Ana', email: 'ana@example.com', asunto: 'Consulta', mensaje: 'Prueba' });
      assert.equal(message.telefono, '');
      assert.equal((await messages.updateStatus(message.id, { estado: 'atendido' })).message.estado, 'atendido');
      const newsletter = new NewsletterService(client);
      await newsletter.subscribe({ email: 'ANA@example.com' });
      await client.newsletter.update({ where: { email: 'ana@example.com' }, data: { activo: false, interes: 'cursos' } });
      await newsletter.subscribe({ email: 'ANA@example.com' });
      const subscriber = await client.newsletter.findUnique({ where: { email: 'ana@example.com' } });
      assert.equal(subscriber.activo, true);
      assert.equal(subscriber.interes, 'cursos');
      assert.equal((await newsletter.findAll()).total, 1);
      const settings = new SettingsService(client);
      await settings.getPublicSettings();
      await settings.updateSettings({ ajustes: { empresa_nombre: 'Empresa prueba' } });
      await assert.rejects(() => settings.updateSettings({ ajustes: { empresa_nombre: 'Must not persist', email_contacto: 'invalid' } }), e => e.getStatus() === 400);
      assert.equal((await settings.getPublicSettings()).settings.empresa_nombre, 'Empresa prueba');
      const auth = new AuthService(client, new JwtService({ secret: 'x'.repeat(32) }));
      await auth.register({ nombre: 'Admin', email: 'admin@example.com', password: 'Password123' });
      assert.ok((await auth.login({ email: 'admin@example.com', password: 'Password123' })).token);
    });
    await t.test('DATEONLY complaint responses and nullable fields', async () => {
      const item = await client.reclamacion.create({ data: { nombres: 'Ana', apellidos: 'Perez', email: 'ana@example.com', telefono: '999888777', tipo_registro: 'reclamo', area: 'Soporte', fecha_incidente: new Date('2026-02-28'), descripcion_bien: 'Servicio', detalle_reclamo: 'Detalle' } });
      const service = new AdminReclamacionesService(client);
      assert.equal((await service.findOne(item.id)).reclamacion.fecha_incidente, '2026-02-28');
      assert.equal((await service.findAll({ search: 'Ana' })).total, 1);
    });
    await t.test('quotes preserve decimals, JSON and optimistic concurrency', async () => {
      const service = new CotizacionesService(client);
      const dto = { cliente: 'Cliente', email: '', telefono: '', documento: '', direccion: '', emisor: 'Horus', datos_emisor: '', moneda: 'PEN', validez: '2099-12-31', condiciones: '', conceptos: [{ descripcion: 'Servicio', cantidad: 3, precio: 0.1 }], descuento: 0, tasa: 18 };
      const { item } = await service.create(dto, 1);
      assert.equal(item.subtotal, 0.3);
      const detail = (await service.detail(item.id)).item;
      assert.equal(detail.validez, '2099-12-31');
      assert.equal(detail.subtotal, '0.30');
      assert.equal(detail.total, '0.35');
      assert.equal(detail.historial.length, 1);
      assert.equal(detail.conceptos[0].cantidad, 3);
      const list = await service.list({ page: 1, limit: 12, search: 'Cliente', estado: '' });
      assert.equal(list.pagination.total, 1);
      assert.equal(list.items[0].total, '0.35');
      assert.ok(!('historial' in list.items[0]));
      const results = await Promise.allSettled([
        service.edit(item.id, { ...dto, cliente: 'Edicion A', revision: 1 }, 1),
        service.edit(item.id, { ...dto, cliente: 'Edicion B', revision: 1 }, 2),
      ]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'fulfilled').value.item.total, 0.35);
      assert.equal(results.find(r => r.status === 'rejected').reason.getStatus(), 409);
      const edited = (await service.detail(item.id)).item;
      assert.equal(edited.revision, 2);
      assert.equal(edited.historial.length, 2);
      await service.status(item.id, { estado: 'enviada', revision: 2 }, 1);
      await assert.rejects(() => service.edit(item.id, { ...dto, revision: 3 }, 1), e => e.getStatus() === 409);
      const rolledBack = await client.cotizacion.findUnique({ where: { id: item.id } });
      assert.equal(rolledBack.revision, 3);
      assert.equal(rolledBack.historial.length, 3);
    });
    await t.test('quote creation is idempotent under the real UNIQUE constraint (migration 20261011)', async () => {
      const service = new CotizacionesService(client);
      const dto = { cliente: 'Idempotente', email: '', telefono: '', documento: '', direccion: '', emisor: 'Horus', datos_emisor: '', moneda: 'PEN', validez: '2099-12-31', condiciones: '', conceptos: [{ descripcion: 'Servicio', cantidad: 1, precio: 10 }], descuento: 0, tasa: 0 };
      const key = 'integration-key-' + randomUUID();
      const results = await Promise.all(Array.from({ length: 5 }, () => service.create(dto, 1, key)));
      assert.equal(await client.cotizacion.count({ where: { idempotencia_clave: key } }), 1);
      assert.equal(new Set(results.map(r => r.item.numero)).size, 1);
      assert.equal(results.filter(r => r.reutilizada === true).length, 4);
      assert.ok(results.every(r => !('idempotencia_clave' in r.item)));
      await assert.rejects(() => service.create({ ...dto, cliente: 'Otro' }, 1, key), e => e.getStatus() === 422);
      const first = await service.create(dto, 1), second = await service.create(dto, 1);
      assert.notEqual(first.item.numero, second.item.numero, 'sin clave no hay deduplicación');
    });
    await t.test('attention uses revision, preserves histories and protects complaints', async () => {
      const { AttentionService } = require('../dist/attention/attention.service');
      const service = new AttentionService(client, {sendMail:async()=>true}, new ConfigService({}));
      const message = await client.contacto.findFirst();
      const dto={revision:1,estado:'en_proceso',responsable:'Equipo',notas:'Revisión',respuesta:'Respuesta de prueba'};
      const {item}=await service.save('messages',message.id,dto,1);
      assert.equal(item.revision,2);assert.equal(item.historial.length,1);
      await assert.rejects(()=>service.save('messages',message.id,dto,1),e=>e.getStatus()===409);
      const results=await Promise.allSettled([service.save('messages',message.id,{...dto,revision:2,notas:'A'},1),service.save('messages',message.id,{...dto,revision:2,notas:'B'},2)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.find(r=>r.status==='rejected').reason.getStatus(),409);
      await assert.rejects(()=>new MessagesService(client).remove(message.id),e=>e.getStatus()===409);
      await assert.rejects(()=>client.contacto.delete({where:{id:message.id}}),e=>e.code==='P2003');
      const complaint=await client.reclamacion.findFirst();
      await assert.rejects(()=>new AdminReclamacionesService(client).remove(complaint.id),e=>e.getStatus()===409);
      await assert.rejects(()=>service.save('reclamaciones',complaint.id,{...dto,estado:'atendido',respuesta:''},1),e=>e.getStatus()===400);
      await service.save('reclamaciones',complaint.id,{...dto,estado:'atendido'},1);
      await assert.rejects(()=>client.reclamacion.delete({where:{id:complaint.id}}),e=>e.code==='P2003');
    });
    await t.test('MySQL quotas are shared across guard instances and clients cannot choose their IP',async()=>{
      const {PublicRateLimitGuard}=require('../dist/common/public-rate-limit.guard');
      const guards=[new PublicRateLimitGuard(client),new PublicRateLimitGuard(client)];
      const context={switchToHttp:()=>({getRequest:()=>({method:'POST',path:'/api/contacto',ip:'192.0.2.4',socket:{remoteAddress:'192.0.2.4'},headers:{'x-forwarded-for':Math.random().toString()}})})};
      const results=await Promise.allSettled(Array.from({length:6},(_,i)=>guards[i%2].canActivate(context)));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
      assert.equal(results.find(r=>r.status==='rejected').reason.getStatus(),429);
      const upper={switchToHttp:()=>({getRequest:()=>({...context.switchToHttp().getRequest(),path:'/API/CONTACTO'})})};
      await assert.rejects(()=>guards[0].canActivate(upper),e=>e.getStatus()===429);
    });
    await t.test('password recovery is single use and revokes previous sessions',async()=>{
      const {AccountsService}=require('../dist/admin/auth/accounts.service');
      const {JwtStrategy}=require('../dist/admin/auth/jwt.strategy');
      const secret='isolated-test-secret-'.repeat(3),config=new ConfigService({_PROCESS_ENV_VALIDATED:{JWT_SECRET:secret}});
      const jwt=new JwtService({secret,signOptions:{issuer:'horus-api',audience:'horus-panel'}});
      const service=new AccountsService(client,jwt,config,{sendMail:async()=>true});
      const user=await client.adminUser.findFirst();
      const {createHmac}=require('node:crypto');
      const token=jwt.sign({id:user.id},{secret:createHmac('sha256',secret).update('reset:'+user.password).digest('hex'),expiresIn:'30m',audience:'horus-password-reset'});
      await service.reset({token,password:'NewPassword123'});
      await assert.rejects(()=>service.reset({token,password:'AgainPassword123'}),e=>e.getStatus()===400);
      const strategy=new JwtStrategy(config,client);
      await assert.rejects(()=>strategy.validate({id:user.id,email:user.email,version:1}),e=>e.getStatus()===401);
      assert.equal((await strategy.validate({id:user.id,email:user.email,version:2})).id,user.id);
      await assert.rejects(()=>service.status(user.id,false,user.id),e=>e.getStatus()===409);
      await assert.rejects(()=>service.password(user.id,{current_password:'Incorrect123',password:'AnotherPassword123'}),e=>e.getStatus()===400);
      assert.equal((await strategy.validate({id:user.id,email:user.email,version:2})).id,user.id);
    });
    await t.test('quote contact foreign key prevents losing its origin',async()=>{
      const contact=await client.contacto.create({data:{nombre:'Origen',email:'origin@example.com',telefono:'',asunto:'Origen',mensaje:'Consulta'}});
      const quote=await client.cotizacion.findFirst();
      await client.cotizacion.update({where:{id:quote.id},data:{contacto_id:contact.id}});
      await assert.rejects(()=>new MessagesService(client).remove(contact.id),e=>e.getStatus()===409);
      await assert.rejects(()=>client.contacto.delete({where:{id:contact.id}}),e=>e.code==='P2003');
    });
    await t.test('signed newsletter opt-out preserves history and inactive filters include legacy nulls',async()=>{
      const {createHmac}=require('node:crypto');
      const secret='newsletter-isolated-secret-'.repeat(2);
      const service=new NewsletterService(client,new ConfigService({_PROCESS_ENV_VALIDATED:{JWT_SECRET:secret}}));
      await Promise.all([service.subscribe({email:'concurrent@example.com',interes:'cursos'}),service.subscribe({email:'CONCURRENT@example.com',interes:'cursos'})]);
      assert.equal(await client.newsletter.count({where:{email:'concurrent@example.com'}}),1);
      const row=await client.newsletter.findUnique({where:{email:'concurrent@example.com'}});
      assert.ok(row.consent_at instanceof Date);
      const value=String(row.id),signature=createHmac('sha256',secret).update('newsletter:'+value).digest('base64url');
      await assert.rejects(()=>service.unsubscribe(value+'.bad-signature'),e=>e.getStatus()===400);
      await service.unsubscribe(value+'.'+signature);
      const unsubscribed=await client.newsletter.findUnique({where:{id:row.id}});
      assert.equal(unsubscribed.activo,false);assert.equal(unsubscribed.interes,'cursos');
      await client.newsletter.update({where:{id:row.id},data:{activo:null}});
      const filtered=await service.findAll({page:1,limit:10,estado:'inactivo',search:'concurrent'});
      assert.equal(filtered.pagination.total,1);assert.equal(filtered.subscribers[0].id,row.id);
      const gallery=new GaleriaService(client);
      const {item:picture}=await gallery.create({titulo:'Imagen inactiva',categoria:'general',imagen_url:'/legacy.png'});
      await client.galeriaItem.update({where:{id:picture.id},data:{activo:null}});
      assert.equal((await gallery.findAllAdmin(undefined,{page:1,limit:10,estado:'inactivo',search:'inactiva'})).pagination.total,1);
      assert.ok(!(await gallery.findPublic()).items.some(item=>item.id===picture.id));
    });
    await t.test('image uploads persist only accepted files and reject path traversal',async()=>{
      const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
      const tmp=await fs.realpath(os.tmpdir()),directory=await fs.mkdtemp(path.join(tmp,'horus-upload-test-'));
      try{
        const {UploadsService}=require('../dist/uploads/uploads.service');
        const service=new UploadsService(new ConfigService({_PROCESS_ENV_VALIDATED:{UPLOAD_DIR:directory,NODE_ENV:'development'}}));
        const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==','base64');
        const result=await service.save(data),filename=path.basename(result.path);
        assert.match(filename,/^[a-f0-9-]{36}\.png$/);
        assert.deepEqual(await fs.readFile(path.join(directory,filename)),data);
        const file=await service.read(filename);assert.equal(file.getHeaders().type,'image/png');
        await assert.rejects(()=>service.read('../../outside.png'),e=>e.getStatus()===404);
        await assert.rejects(()=>service.save(Buffer.from('<svg></svg>')),e=>e.getStatus()===400);
        assert.equal((await fs.readdir(directory)).length,1);
      }finally{
        assert.equal(path.dirname(directory),tmp);assert.ok(path.basename(directory).startsWith('horus-upload-test-'));
        await fs.rm(directory,{recursive:true,force:true});
      }
    });
    await t.test('original design imports explicitly, preserves edits and hides drafts',async()=>{
      const {OriginalContentService}=require('../dist/content-original/content-original.service');
      const restore=new OriginalContentService(client);
      const before={services:await client.servicio.count(),programs:await client.curso.count(),gallery:await client.galeriaItem.count(),settings:await client.setting.findMany()};
      assert.equal(restore.inventory().sections.length,3);
      assert.equal(await client.servicio.count(),before.services);
      const imported=await restore.restore('servicios','borrador');assert.equal(imported.created,19);
      assert.equal((await catalog.list('servicios',{page:1,limit:100},true)).items.length,0);
      // `orden` se repite entre categorías (hay un servicio con orden 1 en cada una): sin categoría ni desempate por id, MySQL elige cualquiera de ellos
      // (con LIMIT 1 y filesort devolvió «asesoramiento») y la comprobación posterior sobre «cableado» fallaba. Se fija la categoría y un desempate estable.
      const first=await client.servicio.findFirst({where:{origen_original:{not:null},categoria:'cableado'},orderBy:[{orden:'asc'},{id:'asc'}]});
      await catalog.update('servicios',first.id,{titulo:'Contenido revisado desde el panel',slug:'nuevo-enlace-revisado',estado:'publicado',nombre_corto:'Nombre revisado',etiquetas:'Etiqueta editada'});
      const repeated=await restore.restore('servicios');assert.equal(repeated.created,0);
      const visible=await catalog.list('servicios',{categoria:'cableado',page:1,limit:100},true);
      assert.equal(visible.items.length,1);assert.equal(visible.items[0].titulo,'Contenido revisado desde el panel');assert.equal(visible.items[0].nombre_corto,'Nombre revisado');
      await catalog.archive('servicios',first.id);await restore.restore('servicios');
      assert.equal((await client.servicio.findUnique({where:{id:first.id}})).estado,'archivado');
      // Services are removed for real: the row disappears and its slug can be reused.
      const removable=await catalog.create('servicios',{titulo:'Servicio temporal',slug:'servicio-temporal',descripcion:'Se elimina de verdad',categoria:'soporte',estado:'borrador'});
      await assert.rejects(()=>catalog.create('servicios',{titulo:'Otro',slug:'servicio-temporal',descripcion:'Mismo slug',categoria:'soporte'}),error=>/«Servicio temporal» \(borrador\).*«servicio-temporal»/.test(error.getResponse().mensaje));
      assert.equal((await catalog.remove('servicios',removable.item.id)).ok,true);
      assert.equal(await client.servicio.findUnique({where:{id:removable.item.id}}),null);
      await assert.rejects(()=>catalog.detail('servicios',removable.item.id));
      const reused=await catalog.create('servicios',{titulo:'Servicio reutilizado',slug:'servicio-temporal',descripcion:'El slug quedó libre',categoria:'soporte',estado:'borrador'});
      await catalog.remove('servicios',reused.item.id);
      const sections=await catalog.list('servicios',{categoria:'cableado,camaras',page:1,limit:100});
      assert.ok(sections.items.length>0&&sections.items.every(x=>['cableado','camaras'].includes(x.categoria)));
      // "Otros servicios" is gone from the database too; each technology category can be created, published, edited and deleted.
      const [[column]]=await db.query('SELECT COLUMN_TYPE ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',[name,'servicios','categoria']);
      assert.equal(column.ct,"enum('cableado','camaras','soporte','asesoramiento')");
      await assert.rejects(()=>client.servicio.create({data:{titulo:'Otro servicio',slug:'otro-servicio',descripcion:'Esta categoría ya no existe',categoria:'otros'}}));
      for(const categoria of ['cableado','camaras','soporte']){
        const draft=await catalog.create('servicios',{titulo:'Prueba '+categoria,slug:'prueba-'+categoria,descripcion:'Servicio de prueba',categoria,estado:'borrador'});
        assert.equal((await catalog.list('servicios',{categoria,page:1,limit:100},true)).items.some(x=>x.id===draft.item.id),false,'Un borrador no es público');
        await catalog.update('servicios',draft.item.id,{estado:'publicado',titulo:'Prueba editada '+categoria});
        assert.equal((await catalog.list('servicios',{categoria,page:1,limit:100},true)).items.find(x=>x.id===draft.item.id)?.titulo,'Prueba editada '+categoria);
        await catalog.remove('servicios',draft.item.id);
        assert.equal(await client.servicio.findUnique({where:{id:draft.item.id}}),null);
      }
      await assert.rejects(()=>catalog.remove('preguntas-frecuentes',1));
      assert.equal((await restore.restore('capacitaciones')).created,4);
      const program=await client.curso.findFirst({where:{origen_original:{not:null}}});
      assert.equal(program.modalidad,null);assert.equal(program.duracion,null);assert.equal(program.fecha_inicio,null);
      await assert.rejects(()=>catalog.update('cursos',program.id,{tipo:'curso'}),e=>e.getStatus()===400);
      await catalog.update('cursos',program.id,{titulo:'Programa editado',slug:'programa-editado',certificacion:'Certificación revisada'});
      assert.equal((await restore.restore('capacitaciones')).created,0);
      assert.equal((await client.curso.findUnique({where:{id:program.id}})).certificacion,'Certificación revisada');
      assert.equal((await restore.restore('galeria')).created,61);
      const photo=await client.galeriaItem.findFirst({where:{origen_original:{not:null}}});
      const gallery=new GaleriaService(client);
      await gallery.update(photo.id,{titulo:'Foto editada',activo:false,imagen_url:'/foto-reemplazada.png'});
      assert.equal((await restore.restore('galeria')).created,0);
      assert.ok(!(await gallery.findPublic(undefined,1,100)).items.some(x=>x.id===photo.id));
      assert.deepEqual(await client.setting.findMany(),before.settings);
      assert.equal(await client.servicio.count(),before.services+19);assert.equal(await client.curso.count(),before.programs+4);assert.equal(await client.galeriaItem.count(),before.gallery+61);
    });
    await t.test('account status keeps one active GERENTE_GENERAL, clears roles and audits under real row locks (H-BACK-01 E3.1)', async () => {
      const { AccountsService } = require('../dist/admin/auth/accounts.service');
      const { ACCOUNTS_BUSY_MESSAGE, isLockConflict, isLockNowait, mysqlErrorCode } = require('../dist/admin/auth/account-locks');
      // Cliente de esta subprueba: el PrismaService real de la aplicación (pool de 2 conexiones, como en producción). El cliente de
      // scripts/database.cjs usa connectionLimit 1 y pondría en cola las operaciones simultáneas dentro del propio pool, sin que lleguen
      // a competir por los bloqueos de MySQL. Lee DB_* del entorno (DB_NAME ya apunta a la base desechable).
      const { PrismaService } = require('../dist/database/prisma.service');
      const poolConnections = async () => Number((await db.query('SELECT COUNT(*) AS n FROM information_schema.processlist WHERE DB = DATABASE() AND ID <> CONNECTION_ID()'))[0][0].n);
      const connectionsBefore = await poolConnections();
      const concurrent = new PrismaService(new ConfigService({}));
      await concurrent.$connect();
      const service = new AccountsService(concurrent, new JwtService({}), new ConfigService({}), { sendMail: async () => true });
      // Evidencia de contención: contador global de errores ER_LOCK_NOWAIT (3572) que lleva MySQL. Sube solo si dos transacciones
      // chocan de verdad por las filas de admin_users; se compara su valor antes y después de cada tramo.
      const nowaitErrors = async () => Number((await db.query('SELECT COALESCE(SUM(SUM_ERROR_RAISED), 0) AS n FROM performance_schema.events_errors_summary_global_by_error WHERE ERROR_NUMBER = 3572'))[0][0].n);
      const make = (email, rol) => client.adminUser.create({ data: { nombre: 'Cuenta E31', email, password: 'no-se-usa', rol } });
      const ids = [];
      try {
        const a = await make('e31-a@example.test', 'GERENTE_GENERAL'), b = await make('e31-b@example.test', 'GERENTE_GENERAL'), c = await make('e31-c@example.test', 'SECRETARIA');
        ids.push(a.id, b.id, c.id);
        const gerentes = () => client.adminUser.count({ where: { activo: true, rol: 'GERENTE_GENERAL' } });
        const audits = where => client.adminAuditoria.count({ where: { cuenta_id: { in: ids }, ...where } });
        // M-1: cada gerente desactiva al otro a la vez; el bloqueo de todas las filas las serializa (la que choca con NOWAIT reintenta y relee)
        // y siempre queda exactamente uno.
        const crossRound = async label => {
          const results = await Promise.allSettled([service.status(b.id, false, a.id), service.status(a.id, false, b.id)]);
          assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, label);
          assert.equal(results.find(r => r.status === 'rejected').reason.getStatus(), 409, label);
          assert.equal(await gerentes(), 1, label + ': nunca quedan cero gerentes activos');
          const off = await client.adminUser.findFirst({ where: { id: { in: [a.id, b.id] }, activo: false } });
          assert.equal(off.rol, null, 'la cuenta desactivada pierde el rol');
          await client.adminUser.update({ where: { id: off.id }, data: { activo: true, rol: 'GERENTE_GENERAL' } }); // preparación de la ronda siguiente
        };
        // Tramo natural: dos operaciones simultáneas con el pool real. El choque no está garantizado en cada ronda (depende de los tiempos),
        // por eso lo exige el contador de MySQL en el tramo siguiente, donde sí se fuerza.
        const naturalStart = await nowaitErrors();
        for (let round = 0; round < 10; round++) await crossRound('ronda natural ' + round);
        const naturalHits = (await nowaitErrors()) - naturalStart;
        // Tramo forzado: un trigger de prueba alarga 200 ms cada UPDATE de admin_users mientras se retienen las filas, así que la segunda
        // operación choca con NOWAIT de forma determinista, reintenta con una transacción nueva, relee y M-1 la rechaza.
        await db.query("CREATE TRIGGER e31_pausa BEFORE UPDATE ON admin_users FOR EACH ROW SET @e31_pausa = SLEEP(0.2)");
        const forcedStart = await nowaitErrors();
        try { for (let round = 0; round < 5; round++) await crossRound('ronda forzada ' + round); }
        finally { await db.query('DROP TRIGGER e31_pausa'); }
        const forcedHits = (await nowaitErrors()) - forcedStart;
        assert.ok(forcedHits >= 5, 'cada ronda forzada debe producir al menos un 3572 real en MySQL (hubo ' + forcedHits + ')');
        assert.ok(naturalHits + forcedHits >= 1, 'sin contención real la prueba no demuestra nada');
        assert.equal(await audits({ operacion: 'cuenta_desactivada', resultado: 'aplicado' }), 15, 'una entrada por desactivación aplicada');
        // M-2: desactivar y reactivar dejan el rol en NULL y revocan sesiones; la auditoría conserva el rol anterior.
        await service.status(c.id, false, a.id);
        assert.match((await service.status(c.id, true, a.id)).mensaje, /sin rol/);
        const back = await client.adminUser.findUnique({ where: { id: c.id } });
        assert.deepEqual([back.activo, back.rol, back.session_version], [true, null, 3]);
        const trail = await client.adminAuditoria.findMany({ where: { cuenta_id: c.id }, orderBy: { id: 'asc' } });
        assert.deepEqual(trail.map(x => [x.origen, x.actor_id, x.operacion, x.rol_anterior, x.rol_nuevo, x.activo_anterior, x.activo_nuevo]),
          [['panel', a.id, 'cuenta_desactivada', 'SECRETARIA', null, true, false], ['panel', a.id, 'cuenta_activada', null, null, false, true]]);
        // Sin cambio no hay escritura ni registro.
        assert.match((await service.status(c.id, true, a.id)).mensaje, /No se hicieron cambios/);
        assert.equal((await client.adminUser.findUnique({ where: { id: c.id } })).session_version, 3);
        // Sin registro no hay cambio: un error real de MySQL al insertar la auditoría revierte la desactivación.
        await db.query("CREATE TRIGGER e31_auditoria_falla BEFORE INSERT ON admin_auditoria FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fallo simulado'");
        // Es un error inesperado (SIGNAL 45000 → 1644), no un conflicto de bloqueo: no se convierte en 409 (O-1).
        try { await assert.rejects(() => service.status(c.id, false, a.id), e => !isLockConflict(e) && e?.getStatus?.() !== 409); }
        finally { await db.query('DROP TRIGGER e31_auditoria_falla'); }
        const kept = await client.adminUser.findUnique({ where: { id: c.id } });
        assert.deepEqual([kept.activo, kept.session_version], [true, 3]);
        assert.equal(await audits({ cuenta_id: c.id }), 2);
        // O-1: otra transacción retiene una fila de admin_users (en otra conexión). Primero, la forma real del error de NOWAIT en Prisma 6.19.3.
        const holdRow = async id => { await db.query('START TRANSACTION'); await db.query('SELECT id FROM admin_users WHERE id = ? FOR UPDATE', [id]); };
        await holdRow(b.id);
        try {
          const raw = await client.$transaction(tx => tx.$queryRaw`SELECT id FROM admin_users ORDER BY id FOR UPDATE NOWAIT`).then(() => null, e => e);
          assert.equal(mysqlErrorCode(raw), '3572', 'NOWAIT falla al instante con ER_LOCK_NOWAIT');
          assert.ok(isLockNowait(raw));
        } finally { await db.query('ROLLBACK'); }
        // Un bloqueo breve se libera durante los reintentos y la operación se aplica una vez.
        await holdRow(b.id);
        const release = new Promise(resolve => setTimeout(() => resolve(db.query('ROLLBACK')), 300));
        try { assert.match((await service.status(c.id, false, a.id)).mensaje, /desactivada/); } finally { await release; }
        assert.deepEqual(await client.adminUser.findUnique({ where: { id: c.id }, select: { activo: true, rol: true, session_version: true } }), { activo: false, rol: null, session_version: 4 });
        assert.equal(await audits({ cuenta_id: c.id }), 3);
        // Un bloqueo que dura más que los reintentos: 409 controlado en menos de 5 s (antes, 500 a los 50 s), sin cambios ni auditoría.
        await holdRow(b.id);
        let started = Date.now(), busy;
        try { busy = await service.status(c.id, true, a.id).then(() => null, e => e); } finally { await db.query('ROLLBACK'); }
        const waited = Date.now() - started;
        assert.equal(busy?.getStatus?.(), 409); assert.equal(busy.getResponse().message, ACCOUNTS_BUSY_MESSAGE);
        assert.ok(waited < 5000, 'esperó ' + waited + ' ms');
        assert.deepEqual(await client.adminUser.findUnique({ where: { id: c.id }, select: { activo: true, session_version: true } }), { activo: false, session_version: 4 });
        assert.equal(await audits({ cuenta_id: c.id }), 3);
        // Nada queda abierto: ni transacciones ni bloqueos, y las conexiones del pool vuelven a estar disponibles.
        const [[{ trx }]] = await db.query('SELECT COUNT(*) AS trx FROM information_schema.innodb_trx');
        const [[{ locks }]] = await db.query("SELECT COUNT(*) AS locks FROM performance_schema.data_locks WHERE OBJECT_SCHEMA = DATABASE() AND OBJECT_NAME = 'admin_users'");
        assert.deepEqual([Number(trx), Number(locks)], [0, 0]);
        started = Date.now();
        assert.match((await service.status(c.id, true, a.id)).mensaje, /sin rol/);
        assert.ok(Date.now() - started < 1000, 'sin contención responde sin esperas');
      } finally {
        await client.adminUser.deleteMany({ where: { id: { in: ids } } });
        // Cierre: el pool de esta subprueba se desconecta y no deja conexiones abiertas en MySQL.
        await concurrent.$disconnect();
        let left = Infinity;
        for (let i = 0; i < 50 && left > connectionsBefore; i++) { left = await poolConnections(); if (left > connectionsBefore) await new Promise(r => setTimeout(r, 100)); }
        assert.equal(left, connectionsBefore, 'el pool de la subprueba cerró todas sus conexiones');
      }
    });
    await t.test('migrations repeat safely and initialization refuses existing data', async () => {
      script('migrate.cjs');
      assert.equal(await client.adminUser.count(), 1);
      const result = spawnSync(process.execPath, ['scripts/init-database.cjs'], { env: process.env, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(await client.adminUser.count(), 1);
    });
  } finally {
    process.env.DB_NAME = originalName;
    if (client) await client.$disconnect();
    if (created) await db.query('DROP DATABASE ' + name);
    await db.end();
  }
});
